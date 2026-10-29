// Listening to a file before it is loaded: read it, decode it, play it once, draw its shape. Used by the sample browser (ui/samplebrowser.js).
// Nothing here touches the project; the sound goes straight to the audio output on its own small gain, one file at a time.
import { audioInfo } from './audioinfo.js';
import { computePeaks } from './waveform.js';

// Reads the file and decodes it with the browser (which resamples to the rate of the audio engine). Gives
// { buffer, info, bytes } where info is what the file's own header says (audioInfo, or null).
export async function readPreview(file, ctx) {
  const data = await file.arrayBuffer();
  const info = audioInfo(new Uint8Array(data, 0, Math.min(data.byteLength, 1 << 16)));   // before decoding: the decoder takes the buffer over
  const buffer = await ctx.decodeAudioData(data);
  return { buffer, info, bytes: file.size };
}

// One voice: playing a new buffer stops the old one (with a very short fade, so it does not click).
export function createPlayer({ getCtx, level = 0.8 }) {
  let source = null, gain = null, startedAt = 0, length = 0;
  const stop = () => {
    if (!source) return;
    const ctx = getCtx(), now = ctx?.currentTime ?? 0, s = source, g = gain;
    source = gain = null;
    try { g.gain.setTargetAtTime(0, now, 0.004); s.stop(now + 0.03); } catch { /* already stopped */ }
    s.onended = () => { s.disconnect(); g.disconnect(); };
  };
  return {
    stop,
    get playing() { return !!source; },
    // how far through the sample it is, 0..1, or -1 when nothing is playing
    progress() { const ctx = getCtx(); return source && ctx && length ? Math.min(1, Math.max(0, (ctx.currentTime - startedAt) / length)) : -1; },
    play(buffer, onEnd = () => {}) {
      stop();
      const ctx = getCtx();
      if (!ctx) return false;
      const s = ctx.createBufferSource(), g = ctx.createGain();
      s.buffer = buffer; g.gain.value = level;
      s.connect(g); g.connect(ctx.destination);
      s.onended = () => { if (source === s) { source = gain = null; onEnd(); } s.disconnect(); g.disconnect(); };
      source = s; gain = g; length = buffer.duration; startedAt = ctx.currentTime;
      s.start();
      return true;
    },
  };
}

// Draws the shape of the sound (the first channel, a min and max for every pixel column) in the colour given, on a canvas. With no buffer it clears it.
export function drawWave(canvas, buffer, colour) {
  const g = canvas.getContext('2d'), { width, height } = canvas;
  g.clearRect(0, 0, width, height);
  if (!buffer) return;
  const peaks = computePeaks(buffer.getChannelData(0), width), mid = height / 2;
  g.fillStyle = colour;
  for (let x = 0; x < width; x++) {
    const lo = Math.max(-1, peaks[2 * x]), hi = Math.min(1, peaks[2 * x + 1]);
    const top = mid - hi * mid, h = Math.max(1, (hi - lo) * mid);
    g.fillRect(x, top, 1, h);
  }
  g.globalAlpha = 0.35;
  g.fillRect(0, mid, width, 1);
  g.globalAlpha = 1;
}

// "3.2 s", "1:04", for the readout
export const lengthText = seconds => (seconds < 60 ? `${seconds < 10 ? seconds.toFixed(2) : seconds.toFixed(1)} s` : `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, '0')}`);
