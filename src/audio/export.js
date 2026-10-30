// Rendering the song to a sound file, offline: the same runtime and sequencer as the audio thread, fed the same messages,
// run as fast as the computer allows. The song is played once from the top; when its last row has sounded the notes are
// released and `tail` more seconds are rendered, so reverbs and delays can die out.
import { GraphRuntime } from './runtime.js';
import { Sequencer } from './sequencer.js';

const BLOCK = 128;

// A sequencer that plays the song once: when the last row has had its full length it stops (every note is released) instead
// of starting again from the top.
class Once extends Sequencer {
  fireTick() {
    if (this.wrapped) { this.stop(); return; }
    super.fireTick();
    if (this.tick === 0) this.wrapped = true;
  }
}

// state: Engine.exportState(). Resolves to { left, right, sampleRate, seconds, peak }; onProgress(0..1 of the song) is
// called now and then, and the render hands the thread back between slices so the page stays alive. `cancel.on` stops it.
export async function renderSong(state, { tail = 10, onProgress = () => {}, cancel = { on: false }, maxSeconds = 7200 } = {}) {
  const { messages, params, wasm, sampleRate } = state;
  const rt = new GraphRuntime({ sampleRate, params, wasm, maxBlock: BLOCK });
  const seq = new Once({ sampleRate, runtime: rt, params, transport: new Int32Array(new SharedArrayBuffer(16)) });
  for (const m of messages) {
    if (m.type === 'delaycomp') rt.setDelayComp(m.on);
    else if (m.type === 'load') rt.load(m.graph);
    else if (m.type === 'node') rt.message(m.instrument, m.node, m.msg);
    else if (m.type === 'song') seq.setSong({ ...m.song, loop: undefined });
    else if (m.type === 'nodeseq') seq.setNodeseq(m.graph, m.resolve);
    else if (m.type === 'lane') seq.setLane(m.lane);
  }
  if (!seq.song?.length) throw new Error('There is no song to render.');
  const chunks = [], limit = Math.floor(sampleRate * maxSeconds);
  const lag = rt.alignment();   // with delay compensation on, the whole mix comes out this many samples late: the start is trimmed off below
  let frames = 0, tailLeft = Math.round(tail * sampleRate) + lag, peak = 0, slice = performance.now();
  seq.play(0);
  const l = new Float32Array(BLOCK), r = new Float32Array(BLOCK);
  while (frames < limit && !cancel.on) {
    if (!seq.playing && tailLeft <= 0) break;
    seq.process(l, r, BLOCK);
    if (!seq.playing) tailLeft -= BLOCK;
    for (let i = 0; i < BLOCK; i++) peak = Math.max(peak, Math.abs(l[i]), Math.abs(r[i]));
    chunks.push([l.slice(), r.slice()]);
    frames += BLOCK;
    if (performance.now() - slice > 40) {
      onProgress(seq.playing ? Math.min(1, seq.tick / seq.song.length) : 1);
      await new Promise(done => setTimeout(done));
      slice = performance.now();
    }
  }
  if (cancel.on) return null;
  const all = new Float32Array(frames), allR = new Float32Array(frames);
  chunks.forEach(([a, b], i) => { all.set(a, i * BLOCK); allR.set(b, i * BLOCK); });
  const left = all.subarray(Math.min(lag, frames)), right = allR.subarray(Math.min(lag, frames));
  return { left, right, sampleRate, seconds: left.length / sampleRate, peak };
}

// A stereo WAV file. bits: 16, 24 (whole numbers, clipped at full scale) or 32 (floating point, no clipping).
export function encodeWav({ left, right, sampleRate }, bits = 24) {
  const n = left.length, bytes = bits / 8, size = n * 2 * bytes;
  const buf = new ArrayBuffer(44 + size), v = new DataView(buf);
  const str = (at, s) => { for (let i = 0; i < s.length; i++) v.setUint8(at + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + size, true); str(8, 'WAVE'); str(12, 'fmt '); v.setUint32(16, 16, true);
  v.setUint16(20, bits === 32 ? 3 : 1, true); v.setUint16(22, 2, true); v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2 * bytes, true); v.setUint16(32, 2 * bytes, true); v.setUint16(34, bits, true);
  str(36, 'data'); v.setUint32(40, size, true);
  let at = 44;
  const put = x => {
    if (bits === 32) v.setFloat32(at, x, true);
    else if (bits === 16) v.setInt16(at, Math.round(Math.max(-1, Math.min(1, x)) * 32767), true);
    else { const q = Math.round(Math.max(-1, Math.min(1, x)) * 8388607); v.setUint8(at, q & 255); v.setUint8(at + 1, (q >> 8) & 255); v.setUint8(at + 2, (q >> 16) & 255); }
    at += bytes;
  };
  for (let i = 0; i < n; i++) { put(left[i]); put(right[i]); }
  return new Blob([buf], { type: 'audio/wav' });
}
