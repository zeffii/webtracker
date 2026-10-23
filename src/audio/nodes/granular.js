// Granular synth. A cloud of short grains read from one of the instrument's samples (the sample list and the
// `sample` parameter work as on the sampler). Every grain starts at `position` (a fraction of the sample) plus a
// random `spray`, lasts `size` ms, is shaped by a window and placed in the stereo field; `density` grains start
// every second. `scan` moves the position along the sample over time (a fraction per second, negative goes back),
// so a note can crawl through a sound. Grain pitch follows the note (from `root`) when `keytrack` is 1, plus `tune`
// semitones and a random `pitchRand` in cents. `reverse` is the chance that a grain plays backwards, `spread` how
// far grains are scattered across the stereo field. `shape` is how much of a grain is fade in and out (1 a full
// Hann window, near 0 a rectangle). The level is kept steady as grains overlap more. The ADSR shapes the whole
// cloud; the voices node makes it polyphonic. Monophonic per node, last note wins.
import { Adsr } from './adsr.js';

const MAX_GRAINS = 96;
const TS = 512;   // the fade in and out come from a table: a quarter-cycle cosine, rather than a cos() per grain per sample
const FADE = Float64Array.from({ length: TS + 2 }, (_, j) => 0.5 - 0.5 * Math.cos(Math.PI * Math.min(j, TS) / TS));
const SPEC = [
  { name: 'sample', min: 0, max: 255, def: 0, int: true },
  { name: 'position', min: 0, max: 1, def: 0.2 },
  { name: 'spray', min: 0, max: 1, def: 0.02 },
  { name: 'scan', min: -1, max: 1, def: 0 },            // fraction of the sample per second
  { name: 'size', min: 5, max: 1000, def: 80 },         // ms
  { name: 'density', min: 1, max: 300, def: 30 },       // grains per second
  { name: 'shape', min: 0.02, max: 1, def: 1 },
  { name: 'tune', min: -48, max: 48, def: 0 },
  { name: 'pitchRand', min: 0, max: 1200, def: 0 },     // cents
  { name: 'keytrack', min: 0, max: 1, def: 1, int: true },
  { name: 'root', min: 0, max: 127, def: 60 },
  { name: 'reverse', min: 0, max: 1, def: 0 },
  { name: 'spread', min: 0, max: 1, def: 0.5 },
  { name: 'vel', min: 0, max: 1, def: 0.5 },
  { name: 'level', min: 0, max: 1, def: 0.7 },
  { name: 'attack', min: 0.1, max: 5000, def: 20 },
  { name: 'decay', min: 1, max: 5000, def: 300 },
  { name: 'sustain', min: 0, max: 1, def: 1 },
  { name: 'release', min: 1, max: 5000, def: 300 },
];
const P = {};
SPEC.forEach((s, i) => { P[s.name] = i; });

export default {
  type: 'granular',
  inputs: [],
  outputs: ['out'],
  category: 'Sources',
  generator: true,
  samples: true,   // plays the samples listed for the node, like the sampler
  adsr: [{ atk: 'attack', dec: 'decay', sus: 'sustain', rel: 'release' }],
  shape: 'rounded',
  glyph: 'granular',
  kinds: { out: 'stereo' },
  params: SPEC,
  create({ sampleRate, maxBlock = 512, emit }) {
    const bank = [];
    const env = new Adsr(sampleRate);
    // grain state, in parallel arrays
    const live = new Uint8Array(MAX_GRAINS);
    const gPos = new Float64Array(MAX_GRAINS), gStep = new Float64Array(MAX_GRAINS);
    const gAge = new Float64Array(MAX_GRAINS), gLen = new Float64Array(MAX_GRAINS);
    const gL = new Float32Array(MAX_GRAINS), gR = new Float32Array(MAX_GRAINS);
    const gInv = new Float64Array(MAX_GRAINS), gFade = new Float64Array(MAX_GRAINS), gLast = new Float64Array(MAX_GRAINS);   // 1/length, table steps per unit of position in the fade, last readable position
    const gData = new Array(MAX_GRAINS).fill(null), gRight = new Array(MAX_GRAINS).fill(null), gGain = new Float64Array(MAX_GRAINS);
    const act = new Int32Array(MAX_GRAINS);   // the grains that are sounding, so a quiet node does not look at the empty slots
    let nAct = 0;
    const gOff = new Int32Array(MAX_GRAINS);   // the sample of the block a new grain starts at
    let mixL = new Float64Array(maxBlock), mixR = new Float64Array(maxBlock);
    let watch = false, batch = [], quiet = 0;   // a scope on the node asks for its grains: 'cloud' messages for the page's drawing
    let seed = 0x2545f491, clock = 1, scanned = 0, note = 60, velocity = 1;
    const rand = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 4294967296; };

    const spawn = g => {   // starts a grain; returns its slot, or -1 when there is no sample to play
      const S = bank[Math.max(0, Math.min(255, Math.floor(g('sample')) || 0))];
      if (!S) return -1;
      let k = live.indexOf(0);
      if (k < 0) { k = 0; for (let j = 1; j < MAX_GRAINS; j++) if (gAge[j] > gAge[k]) k = j; }   // all busy: replace the oldest
      const last = S.data.length - 1;
      let at = g('position') + scanned + (rand() * 2 - 1) * g('spray');
      at -= Math.floor(at);
      const semis = (g('keytrack') >= 1 ? note - g('root') : 0) + g('tune') + (rand() * 2 - 1) * g('pitchRand') / 100;
      const back = rand() < g('reverse');
      const len = Math.max(8, g('size') * 0.001 * sampleRate);
      const step = Math.pow(2, semis / 12) * S.ratio * (back ? -1 : 1);
      // a grain must fit in the sample: keep it from running off an end at once
      gPos[k] = Math.max(0, Math.min(last, at * last));
      const taper = Math.max(0.02, g('shape'));
      gStep[k] = step; gAge[k] = 0; gLen[k] = len; gInv[k] = 1 / len; gFade[k] = 2 * TS / taper; gLast[k] = last;
      gData[k] = S.data; gRight[k] = S.right; gGain[k] = S.gain;
      const pan = (rand() * 2 - 1) * g('spread');
      const a = (pan + 1) * Math.PI / 4;
      gL[k] = Math.cos(a); gR[k] = Math.sin(a);
      if (watch && batch.length < 24) batch.push([at, step, len, taper]);
      if (!live[k]) act[nAct++] = k;   // a replaced grain is already in the list
      live[k] = 1;
      return k;
    };

    return {
      message(msg) {
        if (msg.type === 'watch') { watch = !!msg.on; batch = []; return; }
        if (msg.type !== 'sample') return;
        bank[msg.slot | 0] = { data: msg.data, right: msg.right ?? null, ratio: msg.rate / sampleRate, gain: (msg.volume ?? 1) * (msg.globalVolume ?? 1) };
      },
      note(msg) {
        if (msg.type === 'noteOn') {
          if (env.idle) clock = 1;
          scanned = 0;   // every note starts the cloud at `position`, even one that retriggers a voice still sounding
          note = msg.note; velocity = msg.vel ?? 1;
          env.on();
        } else if (msg.type === 'noteOff' || msg.type === 'allOff') env.off();
        else if (msg.type === 'noteCut') { env.cut(); live.fill(0); nAct = 0; }
      },
      process(inputs, outputs, n, params, slots) {
        const [outL, outR] = outputs[0];
        if (env.idle || !bank.length) { outL.fill(0, 0, n); outR.fill(0, 0, n); live.fill(0); nAct = 0; return; }
        const g = name => params[slots[P[name]]];
        env.set(g('attack'), g('decay'), g('sustain'), g('release'));
        const every = sampleRate / Math.max(1, g('density'));
        const overlap = Math.max(1, g('density') * g('size') * 0.001);
        const level = g('level') * (1 - g('vel') + g('vel') * velocity) / Math.sqrt(overlap);
        const scanStep = g('scan') / sampleRate;
        // New grains first: each starts at its own sample of this block, then every grain runs through the block in one go
        // (its state held in locals), which is far cheaper than visiting every grain for every sample.
        if (mixL.length < n) { mixL = new Float64Array(n); mixR = new Float64Array(n); }
        const scanned0 = scanned;
        for (let i = 0; i < n; i++) {
          clock += 1;
          if (clock >= every) {
            clock -= every;
            scanned = scanned0 + scanStep * (i + 1);
            const k = spawn(g);
            if (k >= 0) gOff[k] = i;
          }
        }
        scanned = scanned0 + scanStep * n;
        if (watch && emit && (batch.length || ++quiet >= 8)) {   // the new grains, and now and then where the read position is
          quiet = 0;
          const head = g('position') + scanned;
          emit({ type: 'cloud', head: head - Math.floor(head), grains: batch });
          batch = [];
        }
        mixL.fill(0, 0, n); mixR.fill(0, 0, n);
        for (let q = 0; q < nAct; q++) {
          const k = act[q];
          let i = gOff[k], p = gPos[k], age = gAge[k], dead = false;
          gOff[k] = 0;
          const step = gStep[k], inv = gInv[k], fade = gFade[k], last = gLast[k], a = gData[k], right = gRight[k], gain0 = gGain[k];
          const pl = gL[k] * (right ? 1.4142 : 1), pr = gR[k] * (right ? 1.4142 : 1);
          for (; i < n; i++) {
            const u = age * inv;
            if (u >= 1 || p < 0 || p >= last) { dead = true; break; }
            const j = p | 0, f = p - j;
            const x = (u < 0.5 ? u : 1 - u) * fade;      // where the nearer end of the grain is in the fade table
            let w = gain0;
            if (x < TS) { const m = x | 0; w *= FADE[m] + (FADE[m + 1] - FADE[m]) * (x - m); }
            mixL[i] += (a[j] + (a[j + 1] - a[j]) * f) * w * pl;
            mixR[i] += (right ? right[j] + (right[j + 1] - right[j]) * f : a[j] + (a[j + 1] - a[j]) * f) * w * pr;
            p += step; age += 1;
          }
          gPos[k] = p; gAge[k] = age;
          if (dead) { live[k] = 0; act[q--] = act[--nAct]; }
        }
        for (let i = 0; i < n; i++) {
          const e = env.next() * level;
          outL[i] = mixL[i] * e; outR[i] = mixR[i] * e;
        }
        scanned -= Math.floor(scanned);
      },
    };
  },
};
