// Mosh: what a video codec does when a keyframe is lost, done to a spectrogram. A codec stores one whole picture now and
// then (a keyframe) and between them only how the picture moves; drop the keyframe and the movement of the new scene is
// laid over the old picture, which smears, slides and blooms. Here the picture is the spectrum of the sound at `in`,
// and the movement comes from the sound at `mod`.
//
// The picture is held per frequency as a loudness, a phase and a frequency (so a held partial keeps sounding as the tone
// it was). At a keyframe, every `keyframe` ms, it is replaced by the live sound. Between keyframes each frame (a quarter
// of the frame length) the spectrum of `mod` is compared with the one before it, in two ways, as a codec would:
//   - brightness: how much louder or quieter each frequency became is added to the picture (`motion`);
//   - motion: around every frequency, the best sideways shift of the modulator's spectrum from one frame to the next
//     is searched for (block matching, like the macroblocks of a video, but overlapping). The picture is slid by that
//     much (`slide`), partials and all. A voice gliding up drags the pad up with it.
// `hold` says how much of the input's own movement is thrown away between keyframes (1: the picture is frozen, only
// the modulator moves it), `heal` lets the loudness drift slowly back toward the live sound, and `bloom` says how far
// new energy may grow in frequencies that were empty at the keyframe (ghost partials). With nothing on `mod` the
// picture only holds (a freeze with a stutter at each keyframe); with nothing on `in` there is nothing to smear.
//   motion    how much of the modulator's change in loudness is applied (1: dB for dB)
//   slide     how much of the modulator's sideways motion is applied
//   keyframe  ms between clean pictures; 0 means only the first
//   hold      how much of the input's own movement is dropped between keyframes
//   heal      how quickly the loudness drifts back to the live sound between keyframes
//   bloom     how far a frequency that was empty at the keyframe can grow
//   smooth    how much the modulator's spectrum is blurred before it is measured
// Stereo, each side on its own. Latency is one frame: 1024, 2048 or 4096 samples (`size`).
import { Analyser, Resynth, sizeOf, mirror, peakOf, MAX_SIZE } from './stft.js';

const MOTION = 0, SLIDE = 1, KEYFRAME = 2, HOLD = 3, HEAL = 4, BLOOM = 5, SMOOTH = 6, MIX = 7, SIZE = 8;
const WINDOW = 0.25;        // the window each bin matches motion over reaches this fraction of its own number up and down (at least 8 bins)
const REACH = 6;            // the furthest a block can be found to have moved in one frame, in bins
const STEP = 18;            // the most any bin's loudness can change in one frame, in dB
const FLOOR = -120;         // dB below full scale: silence
const QUIET = -90;          // the modulator below this does not move anything
const TAU = 2 * Math.PI;

const wrap = x => x - TAU * Math.round(x / TAU);   // an angle brought into -pi..pi

export default {
  type: 'mosh',
  inputs: ['in', 'mod'],
  outputs: ['out'],
  category: 'Effects',
  kinds: { in: 'stereo', mod: 'stereo', out: 'stereo' },
  shape: 'box',
  glyph: 'mosh',
  latency: p => sizeOf(p.size) - 1,   // one frame
  params: [
    { name: 'motion', min: 0, max: 2, def: 1 },
    { name: 'slide', min: 0, max: 1, def: 0.6 },
    { name: 'keyframe', min: 0, max: 8000, def: 2000 },   // ms
    { name: 'hold', min: 0, max: 1, def: 0.85 },
    { name: 'heal', min: 0, max: 1, def: 0.1 },
    { name: 'bloom', min: 0, max: 1, def: 0.4 },
    { name: 'smooth', min: 0, max: 1, def: 0.3 },
    { name: 'mix', min: 0, max: 1, def: 1 },
    { name: 'size', min: 0, max: 2, def: 1, int: true },   // frame length: 1024, 2048, 4096 samples
  ],
  create({ sampleRate }) {
    const bins = MAX_SIZE / 2 + 1;
    const re = new Float64Array(MAX_SIZE), im = new Float64Array(MAX_SIZE);
    const reM = new Float64Array(MAX_SIZE), imM = new Float64Array(MAX_SIZE);
    const logA = new Float64Array(bins), logM = new Float64Array(bins), phaseA = new Float64Array(bins);
    const sum = new Float64Array(bins + 1), blur = new Float64Array(bins);
    const tmpCur = new Float64Array(bins), tmpKey = new Float64Array(bins), tmpFq = new Float64Array(bins), tmpPh = new Float64Array(bins);
    const shiftAt = new Int16Array(bins), cost = new Float64Array(2 * REACH + 1), found = new Float64Array(bins), five = new Float64Array(5);
    const costSum = Array.from({ length: 2 * REACH + 1 }, () => new Float64Array(bins + 1)), liveSum = new Float64Array(bins + 1);
    const tmpCarry = new Float64Array(bins);
    let n = 0, ch = null;

    const start = size => {
      n = size;
      ch = [0, 1].map(() => ({
        carrier: new Analyser(n), mod: new Analyser(n), out: new Resynth(n),
        cur: new Float64Array(bins),       // the picture's loudness per bin, in dB
        key: new Float64Array(bins),       // the loudness at the last keyframe (moves with the picture)
        fq: new Float64Array(bins),        // the frequency of what is in each bin, in bins (a tone between bins 9 and 10 reads 9.4)
        ph: new Float64Array(bins),        // its phase
        prevPhase: new Float64Array(bins), // the live sound's phases one frame ago, to measure frequencies from
        prevA: new Float64Array(bins), prevM: new Float64Array(bins),
        carry: new Float64Array(bins),     // sideways motion found but not yet a whole bin (moves with the picture)
        since: 0, peak: FLOOR, primed: false, started: false,
      }));
      for (const s of ch) s.cur.fill(FLOOR);
    };

    // dB below full scale of each bin of a spectrum in r and i (and the phases, when asked for)
    const levels = (r, i, out, half, peak, phases) => {
      for (let k = 0; k <= half; k++) {
        out[k] = Math.max(FLOOR, 20 * Math.log10(Math.hypot(r[k], i[k]) / peak + 1e-9));
        if (phases) phases[k] = Math.atan2(i[k], r[k]);
      }
    };

    // A keyframe: the picture becomes the live sound, with the frequency of each bin read from how its phase turned.
    const keyframe = (s, half) => {
      for (let k = 0; k <= half; k++) {
        const turned = wrap(phaseA[k] - s.prevPhase[k] - Math.PI / 2 * k);   // beyond what a tone exactly at the bin's centre would do
        s.cur[k] = logA[k]; s.key[k] = logA[k];
        s.fq[k] = k + Math.max(-2, Math.min(2, turned / (Math.PI / 2)));
        s.ph[k] = phaseA[k];
      }
      let peak = FLOOR; for (let k = 0; k <= half; k++) if (logA[k] > peak) peak = logA[k];
      s.peak = peak; s.since = 0; s.started = true;
      s.carry.fill(0);
    };

    // The sideways motion of the modulator since the last frame around every bin, in bins. Each bin looks at a window of
    // its neighbours (wider higher up, as pitch is) and finds the shift that best matches the last frame of the
    // modulator to this one: block matching, with the blocks overlapping so that a tone can cross from one to the next.
    // The motion is found to a fraction and handed on in whole bins as it adds up; shiftAt gets the whole bins.
    const findMotion = (s, half, slide) => {
      for (let d = -REACH; d <= REACH; d++) {   // the cost of every window at every shift, from running sums
        const sums = costSum[d + REACH];
        sums[0] = 0;
        for (let k = 0; k <= half; k++) { const j = k - d; sums[k + 1] = sums[k] + Math.abs(logM[k] - (j < 0 || j > half ? FLOOR : s.prevM[j])); }
      }
      liveSum[0] = 0;
      for (let k = 0; k <= half; k++) liveSum[k + 1] = liveSum[k] + (logM[k] > QUIET ? 1 : 0);
      for (let k = 0; k <= half; k++) {
        const w = Math.max(8, Math.round(k * WINDOW)), lo = Math.max(0, k - w), hi = Math.min(half, k + w);
        found[k] = 0;
        if (liveSum[hi + 1] - liveSum[lo] < 3) continue;
        let best = 0, bestCost = Infinity;
        for (let d = -REACH; d <= REACH; d++) {
          const c = costSum[d + REACH][hi + 1] - costSum[d + REACH][lo];
          cost[d + REACH] = c;
          if (c < bestCost) { bestCost = c; best = d; }
        }
        if (best !== 0 && bestCost >= 0.85 * cost[REACH]) continue;   // only a clear win moves anything (a codec prefers no motion)
        let part = 0;
        if (best > -REACH && best < REACH) {   // between the samples
          const l = cost[best + REACH - 1], h = cost[best + REACH + 1], m = cost[best + REACH], rise = Math.max(l, h) - m;
          if (rise > 1e-9) part = Math.max(-0.5, Math.min(0.5, 0.5 * (l - h) / rise));
        }
        found[k] = best + part;
      }
      // neighbours move together: the median of five takes out the odd one
      for (let k = 0; k <= half; k++) {
        let v = 0;
        if (k >= 2 && k <= half - 2) { five[0] = found[k - 2]; five[1] = found[k - 1]; five[2] = found[k]; five[3] = found[k + 1]; five[4] = found[k + 2]; five.sort(); v = five[2]; }
        else v = found[k];
        s.carry[k] += v * slide;
        const whole = Math.trunc(s.carry[k]);
        s.carry[k] -= whole;
        shiftAt[k] = whole;
      }
    };

    // Slides the picture by shiftAt: what was at j is now at j + shift, as the same tone moved up by that many bins.
    const slidePicture = (s, half) => {
      for (let k = 0; k <= half; k++) {
        const j = Math.min(half, Math.max(0, k - shiftAt[k]));
        tmpCur[k] = s.cur[j]; tmpKey[k] = s.key[j]; tmpFq[k] = s.fq[j] + (k - j); tmpPh[k] = s.ph[j]; tmpCarry[k] = s.carry[j];
      }
      for (let k = 0; k <= half; k++) { s.cur[k] = tmpCur[k]; s.key[k] = tmpKey[k]; s.fq[k] = tmpFq[k]; s.ph[k] = tmpPh[k]; s.carry[k] = tmpCarry[k]; }
    };

    const frame = (c, p) => {
      const half = n >> 1, s = ch[c], peak = peakOf(n);
      levels(re, im, logA, half, peak, phaseA);
      s.mod.fill(reM, imM); levels(reM, imM, logM, half, peak);
      // blur the modulator's levels a little, so that single noisy bins do not move things
      if (p.reach > 0) {
        sum[0] = 0;
        for (let k = 0; k <= half; k++) sum[k + 1] = sum[k] + logM[k];
        for (let k = 0; k <= half; k++) { const lo = Math.max(0, k - p.reach), hi = Math.min(half, k + p.reach); blur[k] = (sum[hi + 1] - sum[lo]) / (hi - lo + 1); }
        for (let k = 0; k <= half; k++) logM[k] = blur[k];
      }
      s.since++;
      if (!s.primed) s.primed = true;   // the first frame only gives the phases to measure the next one against
      else if (!s.started || (p.every > 0 && s.since >= p.every)) keyframe(s, half);
      else {
        // motion first (the picture moves), then brightness
        shiftAt.fill(0, 0, half + 1);
        if (p.slide > 0) { findMotion(s, half, p.slide); slidePicture(s, half); }
        const refresh = 1 - p.hold, ceilingEmpty = s.peak - 60 * (1 - p.bloom);
        for (let k = 0; k <= half; k++) {
          let d = 0;
          if (logM[k] > QUIET || s.prevM[k] > QUIET) d += p.motion * Math.max(-STEP, Math.min(STEP, logM[k] - s.prevM[k]));
          d += refresh * (logA[k] - s.prevA[k]);
          let v = s.cur[k] + d + p.heal * (logA[k] - s.cur[k]);
          const ceiling = Math.max(s.key[k] + 12, ceilingEmpty);
          s.cur[k] = Math.min(ceiling, Math.max(FLOOR, v));
          s.ph[k] = wrap(s.ph[k] + Math.PI / 2 * s.fq[k]);   // the held tone goes on turning
        }
      }
      for (let k = 0; k <= half; k++) { s.prevM[k] = logM[k]; s.prevA[k] = logA[k]; s.prevPhase[k] = phaseA[k]; }
      // the picture back into a spectrum
      for (let k = 0; k <= half; k++) {
        const a = cur2amp(s.cur[k], peak);
        re[k] = a * Math.cos(s.ph[k]); im[k] = a * Math.sin(s.ph[k]);
      }
      mirror(re, im, n);
      s.out.add(re, im, s.carrier.t);
    };
    const cur2amp = (db, peak) => (db <= FLOOR ? 0 : peak * Math.pow(10, db / 20));

    return {
      process(inputs, outputs, count, params, slots) {
        const size = sizeOf(params[slots[SIZE]]);
        if (size !== n) start(size);
        const hop = n / 4, heal = params[slots[HEAL]];
        const p = {
          motion: params[slots[MOTION]], slide: params[slots[SLIDE]], hold: params[slots[HOLD]], bloom: params[slots[BLOOM]],
          every: Math.round(params[slots[KEYFRAME]] * sampleRate / 1000 / hop),
          // the pull toward the live sound each frame: a time constant of 2 s at a heal near 0, 0.1 s at 1 (nothing at 0)
          heal: heal > 0 ? 1 - Math.exp(-hop / (sampleRate * 2 * Math.pow(0.05, heal))) : 0,
          reach: Math.round(params[slots[SMOOTH]] * 6),
        };
        const mix = params[slots[MIX]];
        for (let c = 0; c < 2; c++) {
          const s = ch[c], x = inputs[0][c], m = inputs[1][c], y = outputs[0][c];
          for (let i = 0; i < count; i++) {
            s.mod.push(m[i]);
            if (s.carrier.push(x[i])) { s.carrier.fill(re, im); frame(c, p); }
            const dry = s.carrier.delayed(), wet = s.out.take(s.carrier.t);
            y[i] = dry + (wet - dry) * mix;
          }
        }
      },
    };
  },
};
