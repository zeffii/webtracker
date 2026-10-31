// Pogue: a grubby multi-voice chorus. Several voices read the sound back from a short delay line, each at a
// delay that wanders between `mindelay` and `maxdelay`; the voices are averaged, filtered, saturated and
// bit-reduced, and that wet sound is fed back into the line.
//
// How a voice moves:
//   Each voice has its own slow sine, at a rate between a third of `rate` and `rate` (fixed per voice, so they
//   drift against each other). `change` blends the sine towards a random target that is picked anew now and
//   then: at 0 the voices are smooth sines, at 1 they wander at random.
//   The movement is worked out `resolution` times a second (low values step audibly, which is part of the
//   sound), and every voice glides to its new delay over `inertia` ms.
//
// The wet path, in order:
//   high-pass (`hpcut`, `hpq`) -> low-pass (`lpcut`, `lpq`) -> saturation -> degrade.
//   `degrade` lowers the bit depth (0 leaves it clean, 1 is 2 bits); `dither` feeds the rounding error back
//   into the next sample (error-feedback noise shaping); `errormix` blends towards the rounding error itself,
//   a hiss that follows the sound.
//   `feedback` returns the wet sound to its own channel, `xfeedback` to the other one.
//
// Stereo modes:
//   mono   - both channels use the same voice delays.
//   wide   - the right channel has its own set of voices.
//   spread - each voice reads both channels and is panned somewhere across the stereo field.
//
// Interpolation is how a delay between two samples is read: none (the nearest sample, gritty), linear, or cubic.
// Gains are in dB: `pregain` before the effect (the dry sound too), `postgain` on the output.

const PREGAIN = 0, VOICES = 1, RATE = 2, RESOLUTION = 3, CHANGE = 4, MINDELAY = 5, MAXDELAY = 6, STEREO = 7, INTERP = 8;
const FEEDBACK = 9, XFEEDBACK = 10, SATURATION = 11, DEGRADE = 12, DITHER = 13, ERRORMIX = 14;
const LPCUT = 15, LPQ = 16, HPCUT = 17, HPQ = 18, INERTIA = 19, POSTGAIN = 20, MIX = 21;

// A state-variable filter (topology-preserving transform). The state is [ic1eq, ic2eq].
const svfCoefs = (cutoff, q, sampleRate) => {
  const g = Math.tan(Math.PI * Math.min(cutoff, sampleRate * 0.45) / sampleRate), k = 1 / q;
  const a1 = 1 / (1 + g * (g + k));
  return { g, k, a1, a2: g * a1, a3: g * g * a1 };
};
const svf = (state, c, x, high) => {
  const v3 = x - state[1];
  const v1 = c.a1 * state[0] + c.a2 * v3, v2 = state[1] + c.a2 * state[0] + c.a3 * v3;
  state[0] = 2 * v1 - state[0];
  state[1] = 2 * v2 - state[1];
  return high ? x - c.k * v1 - v2 : v2;
};

const MAX_VOICES = 8;
const MAX_MS = 60;
const MONO = 0, WIDE = 1, SPREAD = 2;
const NEAREST = 0, LINEAR = 1;

export default {
  type: 'pogue',
  inputs: ['in'],
  outputs: ['out'],
  category: 'Effects',
  kinds: { in: 'stereo', out: 'stereo' },
  shape: 'box',
  glyph: 'pogue',
  params: [
    { name: 'pregain', min: -24, max: 24, def: 0 },            // dB
    { name: 'voices', min: 1, max: MAX_VOICES, def: 3, int: true },
    { name: 'rate', min: 0.02, max: 10, def: 0.8 },             // Hz, the fastest voice
    { name: 'resolution', min: 10, max: 2000, def: 1000 },      // movement updates per second
    { name: 'change', min: 0, max: 1, def: 0.3 },
    { name: 'mindelay', min: 0.5, max: 50, def: 6 },            // ms
    { name: 'maxdelay', min: 0.5, max: 50, def: 14 },           // ms
    { name: 'stereo', min: 0, max: 2, def: WIDE, int: true },   // mono, wide, spread
    { name: 'interp', min: 0, max: 2, def: LINEAR, int: true }, // none, linear, cubic
    { name: 'feedback', min: -0.95, max: 0.95, def: 0 },
    { name: 'xfeedback', min: -0.95, max: 0.95, def: 0 },
    { name: 'saturation', min: 0, max: 1, def: 0 },
    { name: 'degrade', min: 0, max: 1, def: 0 },
    { name: 'dither', min: 0, max: 1, def: 0 },
    { name: 'errormix', min: 0, max: 1, def: 0 },
    { name: 'lpcut', min: 200, max: 20000, def: 12000 },        // Hz
    { name: 'lpq', min: 0.5, max: 8, def: 0.7 },
    { name: 'hpcut', min: 10, max: 2000, def: 60 },             // Hz
    { name: 'hpq', min: 0.5, max: 8, def: 0.7 },
    { name: 'inertia', min: 0, max: 500, def: 20 },             // ms
    { name: 'postgain', min: -24, max: 24, def: 0 },            // dB
    { name: 'mix', min: 0, max: 1, def: 0.5 },
  ],
  create({ sampleRate }) {
    const size = Math.ceil(sampleRate * MAX_MS / 1000) + 4;
    const bufL = new Float32Array(size), bufR = new Float32Array(size);
    let write = 0;

    let seed = 0x2545f491;
    const random = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 4294967296; };

    // Two sets of voices: the left (and mono/spread) set, and the right set used in wide mode.
    const makeVoice = () => ({ phase: random(), speed: 1 / 3 + (2 / 3) * random(), target: random(), want: -1, delay: -1 });
    const voices = [Array.from({ length: MAX_VOICES }, makeVoice), Array.from({ length: MAX_VOICES }, makeVoice)];
    const pans = new Float32Array(MAX_VOICES * 2);   // equal-power gains for spread mode: [left, right] per voice

    const filters = { hpL: [0, 0], hpR: [0, 0], lpL: [0, 0], lpR: [0, 0] };
    const quant = { errL: 0, errR: 0 };
    let wetL = 0, wetR = 0;          // the last wet samples, for feedback
    let untilMove = 0;               // samples until the next movement update

    const read = (buf, delaySamples, interp) => {
      let pos = write - delaySamples;
      if (pos < 0) pos += size;
      const k = pos | 0, f = pos - k;
      const at = i => buf[(k + i + size) % size];
      if (interp === NEAREST) return f < 0.5 ? at(0) : at(1);
      if (interp === LINEAR) return at(0) + (at(1) - at(0)) * f;
      const y0 = at(-1), y1 = at(0), y2 = at(1), y3 = at(2);   // 4-point Hermite
      const c1 = 0.5 * (y2 - y0), c2 = y0 - 2.5 * y1 + 2 * y2 - 0.5 * y3, c3 = 0.5 * (y3 - y0) + 1.5 * (y1 - y2);
      return ((c3 * f + c2) * f + c1) * f + y1;
    };

    const saturate = (x, amount) => {
      if (amount <= 0) return x;
      const drive = 1 + 9 * amount;
      return Math.tanh(x * drive) / Math.tanh(drive);
    };

    // Rounds to `levels` steps each side of zero; the error is fed back by `dither`. errormix blends to the error.
    const degrade = (x, levels, dither, errormix, side) => {
      if (levels <= 0) return x;
      const errKey = side === 0 ? 'errL' : 'errR';
      const shaped = x - dither * quant[errKey];
      const rounded = Math.round(shaped * levels) / levels;
      quant[errKey] = rounded - shaped;
      const error = x - rounded;
      return rounded + (error - rounded) * errormix;   // errormix 1: only the error
    };

    const moveVoices = (count, rate, change, lo, hi, stepSeconds) => {
      for (const set of voices) {
        for (let v = 0; v < count; v++) {
          const voice = set[v];
          const hz = rate * voice.speed;
          voice.phase += hz * stepSeconds;
          if (voice.phase >= 1) voice.phase -= Math.floor(voice.phase);
          if (random() < change * hz * stepSeconds * 2) voice.target = random();   // about twice a cycle at change 1
          const sine = 0.5 + 0.5 * Math.sin(2 * Math.PI * voice.phase);
          const where = sine + (voice.target - sine) * change;
          voice.want = (lo + (hi - lo) * where) * sampleRate / 1000;
          if (voice.delay < 0) voice.delay = voice.want;
        }
      }
    };

    return {
      process(inputs, outputs, n, params, slots) {
        const [inL, inR] = inputs[0], [outL, outR] = outputs[0];
        const p = i => params[slots[i]];
        const pre = Math.pow(10, p(PREGAIN) / 20), post = Math.pow(10, p(POSTGAIN) / 20);
        const count = Math.max(1, Math.min(MAX_VOICES, Math.round(p(VOICES))));
        const rate = p(RATE), change = p(CHANGE);
        const lo = Math.min(p(MINDELAY), p(MAXDELAY)), hi = Math.max(p(MINDELAY), p(MAXDELAY));
        const stereo = Math.round(p(STEREO)), interp = Math.round(p(INTERP));
        const feedback = p(FEEDBACK), xfeedback = p(XFEEDBACK), saturation = p(SATURATION);
        const bits = 16 - 14 * p(DEGRADE), levels = p(DEGRADE) > 0 ? Math.pow(2, bits - 1) : 0;
        const dither = p(DITHER), errormix = p(ERRORMIX), mix = p(MIX);
        const hp = svfCoefs(p(HPCUT), p(HPQ), sampleRate), lp = svfCoefs(p(LPCUT), p(LPQ), sampleRate);
        const hop = Math.max(1, Math.round(sampleRate / p(RESOLUTION)));
        const glide = p(INERTIA) > 0 ? 1 - Math.exp(-1000 / (sampleRate * p(INERTIA))) : 1;
        for (let v = 0; v < count; v++) {
          const pan = count > 1 ? v / (count - 1) : 0.5;   // 0 left .. 1 right
          pans[v * 2] = Math.cos(pan * Math.PI / 2) * Math.SQRT2;
          pans[v * 2 + 1] = Math.sin(pan * Math.PI / 2) * Math.SQRT2;
        }

        for (let i = 0; i < n; i++) {
          if (untilMove <= 0) { moveVoices(count, rate, change, lo, hi, hop / sampleRate); untilMove = hop; }
          untilMove--;

          let sumL = 0, sumR = 0;
          for (let v = 0; v < count; v++) {
            const left = voices[0][v], right = stereo === WIDE ? voices[1][v] : left;
            left.delay += (left.want - left.delay) * glide;
            if (right !== left) right.delay += (right.want - right.delay) * glide;
            if (stereo === SPREAD) {
              const both = 0.5 * (read(bufL, left.delay, interp) + read(bufR, left.delay, interp));
              sumL += both * pans[v * 2];
              sumR += both * pans[v * 2 + 1];
            } else {
              sumL += read(bufL, left.delay, interp);
              sumR += read(bufR, right.delay, interp);
            }
          }
          let l = sumL / count, r = sumR / count;
          l = svf(filters.lpL, lp, svf(filters.hpL, hp, l, true), false);
          r = svf(filters.lpR, lp, svf(filters.hpR, hp, r, true), false);
          l = degrade(saturate(l, saturation), levels, dither, errormix, 0);
          r = degrade(saturate(r, saturation), levels, dither, errormix, 1);
          wetL = Math.abs(l) < 1e-20 ? 0 : l;
          wetR = Math.abs(r) < 1e-20 ? 0 : r;

          const dryL = inL[i] * pre, dryR = inR[i] * pre;
          bufL[write] = dryL + feedback * wetL + xfeedback * wetR;
          bufR[write] = dryR + feedback * wetR + xfeedback * wetL;
          if (++write === size) write = 0;

          outL[i] = (dryL + wetL * mix) * post;
          outR[i] = (dryR + wetR * mix) * post;
        }
      },
    };
  },
};
