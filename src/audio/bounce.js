// Bouncing part of a song to a sample, offline: the same runtime and sequencer as the audio thread, run as fast as the
// computer allows. The song is played from the top with the notes before `from` held back (a lane's parameter cells are
// still read, so a filter set earlier is where it should be), the sound starts at tick `from`, and at tick `to` the notes
// are let go. Then the render goes on until nothing rings any more, so reverbs, delays and long releases are in the sample.
// The sample is as long as the range plus those tails, and `marker` is the frame where the range ended.
import { Sequencer } from './sequencer.js';
import { BLOCK, buildOffline } from './export.js';

// A sequencer that remembers which frame of the output each tick fired on, and stops at the end of the range.
class RangeSequencer extends Sequencer {
  from = 0;
  to = 0;
  blockStart = 0;   // the frame the block being processed starts on
  at = 0;           // how far into that block the chunk now processed starts
  startFrame = -1;  // the frame tick `from` fired on
  endFrame = -1;    // the frame tick `to` fired on: where the sound stops being played and starts to ring out
  wrapped = false;

  fireTick() {
    if (this.wrapped || this.tick >= this.to) { this.endFrame = this.blockStart + this.at; this.stop(); return; }
    if (this.startFrame < 0 && this.tick >= this.from) this.startFrame = this.blockStart + this.at;
    super.fireTick();
    if (this.tick === 0) this.wrapped = true;   // the song's own end
  }

  // Processes in pieces that each start where a tick fires, so the frame of a tick is exact and not just the block it was in.
  process(left, right, n) {
    let at = 0;
    while (at < n) {
      const chunk = this.playing ? Math.min(n - at, Math.max(1, Math.ceil(this.countdown))) : n - at;
      this.at = at;
      super.process(left.subarray(at, at + chunk), right.subarray(at, at + chunk), chunk);
      at += chunk;
    }
  }
}

// What a lane message becomes: before the range no notes (parameters are still written); with `only`, every other lane silent.
const withMask = (message, length, from, only) => {
  const mask = new Uint8Array(length);
  if (message.lane.mask?.length) mask.set(message.lane.mask.subarray(0, length));
  if (only !== null && message.lane.id !== only) mask.fill(1);
  else for (let t = 0; t < Math.min(from, length); t++) mask[t] |= 1;
  return { ...message, lane: { ...message.lane, mask } };
};

// state: Engine.exportState(). from, to: ticks (to is the first tick that is not played). lane: a lane id to play on its own,
// or null for everything. quiet: the level (dB) under which a tail counts as over. maxTail: seconds, at most, after the range.
// Resolves to { left, right (null when both sides are alike), sampleRate, marker, seconds, peak }, or null when cancelled.
export async function bounceRange(state, { from, to, lane = null, quiet = -72, maxTail = 10, onProgress = () => {}, cancel = { on: false } }) {
  if (!(to > from) || from < 0) throw new Error('The range is empty.');
  let length = 0;
  const { rt, seq, sampleRate } = buildOffline(state, RangeSequencer, (m, s) => {
    if (m.type === 'song') length = m.song.length;
    if (m.type === 'nodeseq' && lane !== null) return null;   // the Node Sequencer plays any lane's machines; on its own, a lane does not
    return m.type === 'lane' ? withMask(m, length, from, lane) : m;
  });
  if (!seq.song?.length) throw new Error('There is no song to render.');
  seq.from = from;
  seq.to = Math.min(to, seq.song.length);
  const lag = rt.alignment() + rt.carveLatency();   // the mix comes out this many samples late with delay compensation on
  const threshold = 10 ** (quiet / 20), calm = Math.round(0.15 * sampleRate), tailCap = Math.round(maxTail * sampleRate);
  const chunks = [];
  let frames = 0, kept = -1, quietRun = 0, peak = 0, slice = performance.now();
  seq.play(0);
  const l = new Float32Array(BLOCK), r = new Float32Array(BLOCK);
  while (!cancel.on) {
    seq.blockStart = frames;
    seq.process(l, r, BLOCK);
    frames += BLOCK;
    if (seq.startFrame >= 0) {   // the range has begun: keep the output from the block it began in
      if (kept < 0) kept = frames - BLOCK;
      chunks.push([l.slice(), r.slice()]);
      let top = 0;
      for (let i = 0; i < BLOCK; i++) top = Math.max(top, Math.abs(l[i]), Math.abs(r[i]));
      peak = Math.max(peak, top);
      quietRun = top < threshold ? quietRun + BLOCK : 0;
    }
    if (seq.endFrame >= 0 && (quietRun >= calm || frames - seq.endFrame >= tailCap + lag)) break;
    if (!seq.playing && seq.endFrame < 0) break;   // stopped before the range could begin
    if (performance.now() - slice > 40) {
      onProgress(seq.playing ? Math.min(1, seq.tick / seq.to) : 1);
      await new Promise(done => setTimeout(done));
      slice = performance.now();
    }
  }
  if (cancel.on) return null;
  if (kept < 0) throw new Error('Nothing to render: the range starts after the end of the song.');
  const all = [new Float32Array(chunks.length * BLOCK), new Float32Array(chunks.length * BLOCK)];
  chunks.forEach(([a, b], i) => { all[0].set(a, i * BLOCK); all[1].set(b, i * BLOCK); });
  const first = Math.min(all[0].length, Math.max(0, seq.startFrame + lag - kept));   // frame 0 of the sample
  const marker = seq.endFrame - seq.startFrame;
  const trimmed = quietRun >= calm ? all[0].length - quietRun + Math.round(0.01 * sampleRate) : all[0].length;
  const stop = Math.min(all[0].length, Math.max(first + marker + 1, trimmed));
  const left = all[0].slice(first, stop), right = all[1].slice(first, stop);
  let alike = true;
  for (let i = 0; i < left.length && alike; i++) if (Math.abs(left[i] - right[i]) > 1e-6) alike = false;
  return { left, right: alike ? null : right, sampleRate, marker: Math.min(marker, left.length - 1), seconds: left.length / sampleRate, peak };
}
