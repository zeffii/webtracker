// The island pass on a whole recording at once (the sample editor's "Islands → new sample"): the same pass as the islands
// node, but offline, so the frames can be as long as the notes want (8192 by default), the loudest level to count
// brightness from is the whole recording's (the same reference the spectrogram uses), and nothing is late: the
// result lines up with the original, frame for frame.
import { Analyser, Resynth, mirror, peakOf } from '../audio/nodes/stft.js';
import { IslandMask } from '../audio/islandcore.js';

// `channels` is [left] or [left, right]; returns the processed channels, the same length.
export function renderIslands(channels, { contrast = 0.5, islands = 0.7, depth = 40, smooth = 0.5, size = 8192 } = {}) {
  const n = size, len = channels[0].length, re = new Float64Array(n), im = new Float64Array(n);
  // the recording is fed in with a frame of silence before and after, so its first and last samples are covered as fully as the middle
  const frames = (x, onFrame) => {
    const a = new Analyser(n);
    for (let i = 0; i < len + 2 * n; i++) {
      const j = i - n;
      if (a.push(j >= 0 && j < len ? x[j] : 0)) { a.fill(re, im); onFrame(a); }
    }
  };
  // pass one: the loudest bin of any frame of any channel
  let ref = -Infinity;
  const probe = new IslandMask(n);
  for (const x of channels) frames(x, () => { ref = Math.max(ref, probe.measure(re, im, peakOf(n))); });
  // pass two: each channel on its own
  return channels.map(x => {
    const mask = new IslandMask(n), r = new Resynth(n), out = new Float32Array(len), a = new Analyser(n);
    const params = { contrast, islands, depth, smooth };
    for (let i = 0; i < len + 2 * n; i++) {
      const j = i - n;
      if (a.push(j >= 0 && j < len ? x[j] : 0)) {
        a.fill(re, im);
        mask.measure(re, im, peakOf(n));
        mask.decide(ref, params);
        mask.apply(re, im);
        mirror(re, im, n);
        r.add(re, im, a.t);
      }
      const v = r.take(a.t), k = i - (2 * n - 1);   // a frame late, and the silence that was put in front
      if (k >= 0 && k < len) out[k] = v;
    }
    return out;
  });
}
