// An MP4 file of a rendered song: a still picture (the album art, 300 x 300 by default) as the video, and the stereo sound as AAC.
// The browser's own encoders do the work (WebCodecs); the file is put together by the vendored mp4-muxer. The picture is
// encoded once a second, and the repeats cost almost nothing (the encoder sees nothing has changed), so a song stays about the
// size of its audio. The sound is always AAC-LC, which is what sites like X accept: where the browser has no AAC encoder (Brave
// has none) the vendored Fraunhofer FDK encoder, compiled to WebAssembly, does it. Without H.264 the picture falls back to VP9.
import { Muxer, ArrayBufferTarget } from '../vendor/mp4-muxer.mjs';

const VIDEO = [
  { codec: 'avc1.42001f', muxer: 'avc', label: 'H.264' },
  { codec: 'vp09.00.10.08', muxer: 'vp9', label: 'VP9' },
];
const AAC = 'mp4a.40.2';
const RATES = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350];

// AAC through the FDK encoder: interleaved 16-bit in, ADTS frames out. Each frame is handed on without its header, as the
// MP4 file wants it, with the two-byte AudioSpecificConfig that tells a player the profile, rate and channels.
async function fdkEncoder(sampleRate, bitrate, emit) {
  const m = await (await import('../vendor/fdk-aac.mjs')).default();
  const h = m._ae_create(sampleRate, 2, bitrate, 2, 0);
  if (!h) throw new Error(`the AAC encoder refused ${sampleRate} Hz at ${bitrate} bit/s`);
  const rate = RATES.indexOf(sampleRate);
  if (rate < 0) throw new Error(`AAC has no ${sampleRate} Hz mode`);
  const asc = new Uint8Array([(2 << 3) | (rate >> 1), ((rate & 1) << 7) | (2 << 3)]);
  let frame = 0, first = true, freed = false;
  const drain = () => {
    const len = m._ae_output_len(h);
    if (!len) return;
    const bytes = m.HEAPU8.slice(m._ae_output_ptr(h), m._ae_output_ptr(h) + len);
    m._ae_output_reset(h);
    for (let at = 0; at + 7 <= bytes.length;) {
      const size = ((bytes[at + 3] & 3) << 11) | (bytes[at + 4] << 3) | (bytes[at + 5] >> 5), head = bytes[at + 1] & 1 ? 7 : 9;
      if (bytes[at] !== 0xff || size < head || at + size > bytes.length) break;
      emit(bytes.slice(at + head, at + size), Math.round(frame++ * 1024 / sampleRate * 1e6), first ? asc : null);
      first = false; at += size;
    }
  };
  return {
    encode(left, right) {
      const n = left.length, k0 = m._ae_input(h, n) >> 1, heap = m.HEAP16;   // read the view after the call: memory may grow
      for (let i = 0, k = k0; i < n; i++) {
        const l = left[i], r = right[i];
        heap[k++] = l <= -1 ? -32767 : l >= 1 ? 32767 : Math.floor(l * 32767 + 0.5);
        heap[k++] = r <= -1 ? -32767 : r >= 1 ? 32767 : Math.floor(r * 32767 + 0.5);
      }
      const r = m._ae_encode(h, n);
      if (r < 0) throw new Error(`the AAC encoder failed (0x${(-r).toString(16)})`);
      drain();
    },
    flush() { m._ae_flush(h); drain(); this.free(); },
    free() { if (!freed) { freed = true; m._ae_destroy(h); } },
  };
}

export const mp4Supported = () => typeof VideoEncoder === 'function' && typeof VideoFrame === 'function';

// The picture as a square canvas of `size` pixels: an image fitted to cover it (cropped from the middle), or, with no image, a
// plain card with the project's name.
export async function artCanvas(source, { size = 300, title = '' } = {}) {
  const c = new OffscreenCanvas(size, size), g = c.getContext('2d');
  if (source) {
    const bmp = await createImageBitmap(source), s = Math.min(bmp.width, bmp.height);
    g.imageSmoothingQuality = 'high';
    g.drawImage(bmp, (bmp.width - s) / 2, (bmp.height - s) / 2, s, s, 0, 0, size, size);
    bmp.close?.();
    return c;
  }
  const grad = g.createLinearGradient(0, 0, size, size);
  grad.addColorStop(0, '#15333a'); grad.addColorStop(1, '#4ac0cc');
  g.fillStyle = grad; g.fillRect(0, 0, size, size);
  g.fillStyle = 'rgba(255,255,255,0.92)'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = `600 ${Math.round(size / 9)}px ui-monospace, Consolas, monospace`;
  g.fillText(String(title || 'WAX').slice(0, 24), size / 2, size / 2, size * 0.86);
  return c;
}

// out: { left, right, sampleRate } from renderSong. art: a canvas, ImageBitmap or any image source the size of the picture.
// Resolves to { blob, video, audio } (the codec names used), or null when cancelled.
export async function encodeMp4(out, { art, size = 300, onProgress = () => {}, cancel = { on: false }, audioBitrate = 256000 } = {}) {
  if (!mp4Supported()) throw new Error('this browser cannot encode video (WebCodecs is missing)');
  const { left, right, sampleRate } = out;
  const vcfg = { width: size, height: size, framerate: 1, bitrate: 1500000, latencyMode: 'quality' };
  const acfg = { sampleRate, numberOfChannels: 2, bitrate: audioBitrate };
  let video = null;
  for (const v of VIDEO) if ((await VideoEncoder.isConfigSupported({ ...vcfg, codec: v.codec }).catch(() => ({}))).supported) { video = v; break; }
  if (!video) throw new Error('this browser has no video encoder for H.264 or VP9');
  // the browser's own AAC encoder when it has one, else the WebAssembly one
  const native = typeof AudioEncoder === 'function' && typeof AudioData === 'function'
    && (await AudioEncoder.isConfigSupported({ ...acfg, codec: AAC }).catch(() => ({}))).supported;

  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: { codec: video.muxer, width: size, height: size, frameRate: 1 },
    audio: { codec: 'aac', numberOfChannels: 2, sampleRate },
    fastStart: 'in-memory',
  });
  let failure = null;
  const venc = new VideoEncoder({ output: (chunk, meta) => muxer.addVideoChunk(chunk, meta), error: e => { failure = e; } });
  venc.configure({ ...vcfg, codec: video.codec });
  const aenc = native ? new AudioEncoder({ output: (chunk, meta) => muxer.addAudioChunk(chunk, meta), error: e => { failure = e; } }) : null;
  aenc?.configure({ ...acfg, codec: AAC });
  const fdk = native ? null : await fdkEncoder(sampleRate, audioBitrate, (data, timestamp, asc) => muxer.addAudioChunkRaw(data, 'key', timestamp, Math.round(1024 / sampleRate * 1e6),
    asc ? { decoderConfig: { codec: AAC, numberOfChannels: 2, sampleRate, description: asc } } : undefined));

  const seconds = left.length / sampleRate;
  // the picture: once a second, a key frame at the start and every 30 s
  const frames = Math.max(1, Math.ceil(seconds));
  for (let i = 0; i < frames && !cancel.on; i++) {
    const frame = new VideoFrame(art, { timestamp: i * 1e6, duration: 1e6 });
    venc.encode(frame, { keyFrame: i % 30 === 0 });
    frame.close();
    if (venc.encodeQueueSize > 8) await new Promise(r => setTimeout(r));
    if (failure) throw failure;
  }
  // the sound, a second at a time
  const step = sampleRate;
  for (let at = 0; at < left.length && !cancel.on; at += step) {
    const n = Math.min(step, left.length - at);
    if (fdk) {
      fdk.encode(left.subarray(at, at + n), right.subarray(at, at + n));
      await new Promise(r => setTimeout(r));
    } else {
      const planar = new Float32Array(n * 2);
      planar.set(left.subarray(at, at + n), 0); planar.set(right.subarray(at, at + n), n);
      const data = new AudioData({ format: 'f32-planar', sampleRate, numberOfFrames: n, numberOfChannels: 2, timestamp: Math.round((at / sampleRate) * 1e6), data: planar });
      aenc.encode(data);
      data.close();
      while (aenc.encodeQueueSize > 4) await new Promise(r => setTimeout(r, 5));
    }
    if (failure) throw failure;
    onProgress(Math.min(1, (at + n) / left.length));
  }
  if (cancel.on) { venc.close(); aenc?.close(); fdk?.free(); return null; }
  await venc.flush();
  if (aenc) await aenc.flush(); else fdk.flush();
  if (failure) throw failure;
  muxer.finalize();
  venc.close(); aenc?.close();
  return { blob: new Blob([muxer.target.buffer], { type: 'video/mp4' }), video: video.label, audio: native ? 'AAC' : 'AAC (built-in encoder)' };
}
