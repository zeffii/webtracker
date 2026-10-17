// Helpers for the wavetable synth: frames are FRAME points long, stored as 16-bit numbers in base64 so a table
// can sit in a project file (and be read inside the audio worklet, which has no atob).
import { BRAIDS_B64, BRAIDS_WAVES, BRAIDS_POINTS } from './braids-waves.js';

export const FRAME = 512, MAX_FRAMES = 128;
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const LOOKUP = new Int16Array(128).fill(-1);
[...ALPHABET].forEach((c, i) => { LOOKUP[c.charCodeAt(0)] = i; });

export function base64Bytes(text) {
  const clean = text.replace(/[^A-Za-z0-9+/]/g, '');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let acc = 0, bits = 0, k = 0;
  for (let i = 0; i < clean.length; i++) {
    acc = (acc << 6) | LOOKUP[clean.charCodeAt(i)]; bits += 6;
    if (bits >= 8) { bits -= 8; if (k < out.length) out[k++] = (acc >> bits) & 255; }
  }
  return out;
}

export function bytesBase64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    s += ALPHABET[(n >> 18) & 63] + ALPHABET[(n >> 12) & 63] + (i + 1 < bytes.length ? ALPHABET[(n >> 6) & 63] : '=') + (i + 2 < bytes.length ? ALPHABET[n & 63] : '=');
  }
  return s;
}

// Frames (flat, FRAME points each, -1 to 1) <-> base64 of little-endian 16-bit numbers.
export function encodeFrames(flat) {
  const bytes = new Uint8Array(flat.length * 2);
  for (let i = 0; i < flat.length; i++) {
    const v = Math.max(-32767, Math.min(32767, Math.round(flat[i] * 32767)));
    bytes[2 * i] = v & 255; bytes[2 * i + 1] = (v >> 8) & 255;
  }
  return bytesBase64(bytes);
}
export function decodeFrames(text) {
  const bytes = base64Bytes(text), out = new Float32Array(Math.floor(bytes.length / 2));
  for (let i = 0; i < out.length; i++) out[i] = ((((bytes[2 * i + 1] << 8) | bytes[2 * i]) << 16) >> 16) / 32767;
  return out;
}

// One cycle resampled to FRAME points (linear, or cubic when going up), the jump between its end and its start
// removed with a ramp, the mean taken out and the peak set to `peak`.
export function cycle(src, peak = 0.95, cubic = false) {
  const n = src.length, out = new Float32Array(FRAME);
  const at = i => src[((i % n) + n) % n];
  for (let i = 0; i < FRAME; i++) {
    const x = (i / FRAME) * n, k = Math.floor(x), f = x - k;
    if (cubic) {
      const a = at(k - 1), b = at(k), c = at(k + 1), d = at(k + 2);
      out[i] = b + 0.5 * f * (c - a + f * (2 * a - 5 * b + 4 * c - d + f * (3 * (b - c) + d - a)));
    } else out[i] = at(k) + (at(k + 1) - at(k)) * f;
  }
  return settle(out, peak);
}
function settle(w, peak) {
  const jump = w[FRAME - 1] - w[0];
  let mean = 0;
  for (let i = 0; i < FRAME; i++) { w[i] -= jump * (i / FRAME); mean += w[i]; }
  mean /= FRAME;
  let top = 1e-9;
  for (let i = 0; i < FRAME; i++) { w[i] -= mean; top = Math.max(top, Math.abs(w[i])); }
  for (let i = 0; i < FRAME; i++) w[i] = (w[i] / top) * peak;
  return w;
}

let braids = null;
export function braidsFrames() {   // 256 frames, shared by every node
  if (braids) return braids;
  const bytes = base64Bytes(BRAIDS_B64), flat = new Float32Array(BRAIDS_WAVES * FRAME);
  for (let k = 0; k < BRAIDS_WAVES; k++) {
    const raw = Float32Array.from({ length: BRAIDS_POINTS }, (_, i) => (bytes[k * BRAIDS_POINTS + i] - 128) / 128);
    flat.set(cycle(raw, 0.95, true), k * FRAME);
  }
  return (braids = flat);
}

// FRAME points cut from a sample at `start` (a frame number); a ramp removes the jump between the window's end
// and its start, so that looping it does not click.
export function windowFrom(data, start) {
  const out = new Float32Array(FRAME), s0 = Math.max(0, Math.min(Math.floor(start), Math.max(0, data.length - FRAME)));
  for (let i = 0; i < FRAME; i++) out[i] = data[s0 + i] ?? 0;
  return settle(out, 0.95);
}

// A table cut from a sample: consecutive pieces of `size` points, at most MAX_FRAMES of them (spread evenly
// when there are more). A size of 0 takes the whole sample as one cycle (one frame).
export function framesFromSample(data, size) {
  const n = size > 0 ? Math.max(1, Math.floor(data.length / size)) : 1, len = size > 0 ? size : data.length;
  const count = Math.min(n, MAX_FRAMES), flat = new Float32Array(count * FRAME);
  for (let k = 0; k < count; k++) {
    const at = count === n ? k : Math.round((k * (n - 1)) / Math.max(1, count - 1));
    flat.set(cycle(data.subarray(at * len, at * len + len), 0.95, len < FRAME), k * FRAME);
  }
  return flat;
}

// The default A/B pair: a sine and a saw.
export function defaultPair() {
  const flat = new Float32Array(2 * FRAME);
  for (let i = 0; i < FRAME; i++) { flat[i] = 0.9 * Math.sin((2 * Math.PI * i) / FRAME); flat[FRAME + i] = 0.9 * (1 - (2 * i) / FRAME); }
  return flat;
}
