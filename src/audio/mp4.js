// An MP4 file of a rendered song: a still picture (the album art, 300 x 300 by default) as the video, and the stereo sound as AAC.
// The browser's own encoders do the work (WebCodecs); the file is put together by the vendored mp4-muxer. The picture is
// encoded once a second, and the repeats cost almost nothing (the encoder sees nothing has changed), so a song stays about the
// size of its audio. If this browser cannot encode H.264 or AAC the file falls back to VP9 and Opus, which most players read too.
import { Muxer, ArrayBufferTarget } from '../vendor/mp4-muxer.mjs';

const VIDEO = [
  { codec: 'avc1.42001f', muxer: 'avc', label: 'H.264' },
  { codec: 'vp09.00.10.08', muxer: 'vp9', label: 'VP9' },
];
const AUDIO = [
  { codec: 'mp4a.40.2', muxer: 'aac', label: 'AAC' },
  { codec: 'opus', muxer: 'opus', label: 'Opus' },
];

export const mp4Supported = () => typeof VideoEncoder === 'function' && typeof AudioEncoder === 'function' && typeof VideoFrame === 'function' && typeof AudioData === 'function';

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
  if (!mp4Supported()) throw new Error('this browser cannot encode video or audio (WebCodecs is missing)');
  const { left, right, sampleRate } = out;
  const vcfg = { width: size, height: size, framerate: 1, bitrate: 1500000, latencyMode: 'quality' };
  const acfg = { sampleRate, numberOfChannels: 2, bitrate: audioBitrate };
  let video = null, audio = null;
  for (const v of VIDEO) if ((await VideoEncoder.isConfigSupported({ ...vcfg, codec: v.codec }).catch(() => ({}))).supported) { video = v; break; }
  for (const a of AUDIO) if ((await AudioEncoder.isConfigSupported({ ...acfg, codec: a.codec }).catch(() => ({}))).supported) { audio = a; break; }
  if (!video) throw new Error('this browser has no video encoder for H.264 or VP9');
  if (!audio) throw new Error('this browser has no audio encoder for AAC or Opus');

  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: { codec: video.muxer, width: size, height: size, frameRate: 1 },
    audio: { codec: audio.muxer, numberOfChannels: 2, sampleRate },
    fastStart: 'in-memory',
  });
  let failure = null;
  const venc = new VideoEncoder({ output: (chunk, meta) => muxer.addVideoChunk(chunk, meta), error: e => { failure = e; } });
  venc.configure({ ...vcfg, codec: video.codec });
  const aenc = new AudioEncoder({ output: (chunk, meta) => muxer.addAudioChunk(chunk, meta), error: e => { failure = e; } });
  aenc.configure({ ...acfg, codec: audio.codec });

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
    const planar = new Float32Array(n * 2);
    planar.set(left.subarray(at, at + n), 0); planar.set(right.subarray(at, at + n), n);
    const data = new AudioData({ format: 'f32-planar', sampleRate, numberOfFrames: n, numberOfChannels: 2, timestamp: Math.round((at / sampleRate) * 1e6), data: planar });
    aenc.encode(data);
    data.close();
    while (aenc.encodeQueueSize > 4) await new Promise(r => setTimeout(r, 5));
    if (failure) throw failure;
    onProgress(Math.min(1, (at + n) / left.length));
  }
  if (cancel.on) { venc.close(); aenc.close(); return null; }
  await venc.flush(); await aenc.flush();
  if (failure) throw failure;
  muxer.finalize();
  venc.close(); aenc.close();
  return { blob: new Blob([muxer.target.buffer], { type: 'video/mp4' }), video: video.label, audio: audio.label };
}
