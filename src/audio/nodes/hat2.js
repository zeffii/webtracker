// Hi-hat 2: a hat that is less of a machine. Closed and open hits in one voice, like hat808 (note 0 is a closed hit, note 1 an open
// hit, the velocity is the digit), but built to sound played rather than looped, and finished with a flanger and a bit crusher.
//   Metal   six square waves at inharmonic frequencies. `spread` pulls them off their exact ratios so the ring is less pure.
//   Noise   white noise mixed in by `noise` (0 all metal, 1 all noise). Most real hats are somewhere in the middle.
//   Tone    a band-pass at `body` Hz, then a high-pass at `tone` Hz: higher `tone` is thinner.
//   Human   `human` makes every hit a little different: the level, the brightness, the pitch of the metal and where its waves start.
//   Shape   each of the two hats has a drawing for its volume, played once from the hit. `crate` and `orate` are how fast
//           (1 takes the reference time: closed 140 ms, open 700 ms; 2 half as long). After its end a drawing holds its last level.
//   Choke   a closed hit cuts the open hat in 8 ms (`choke` off lets it ring). If both hit on one row, the open hat starts and the
//           closed one cuts it at once.
//   Flange  after the hat: a short delay swept by a slow wave, the two channels a quarter turn apart. `flange` is how much is
//           heard, `frate` the sweep speed in Hz, `fdepth` how far it sweeps, `ffeed` the feedback (negative makes a hollower sound).
//   Crush   after the flanger: `bits` is the depth, `down` holds each sample for that many, `crush` is how much is heard.
// Monophonic per kind: a new hit of a kind restarts that kind's drawing.
import { envelopeTable, readEnvelope, cleanSpline } from './bezier.js';

const SPEC = [
  { name: 'tune', min: -12, max: 12, def: 0 },           // semitones, moves the whole metal bank
  { name: 'spread', min: 0, max: 1, def: 0.35 },
  { name: 'noise', min: 0, max: 1, def: 0.45 },
  { name: 'body', min: 2000, max: 14000, def: 9000 },    // Hz, centre of the band-pass
  { name: 'tone', min: 2000, max: 12000, def: 6000 },    // Hz, high-pass
  { name: 'human', min: 0, max: 1, def: 0.4 },
  { name: 'level', min: 0, max: 1, def: 0.6 },
  { name: 'crate', min: 0.1, max: 10, def: 1 },
  { name: 'orate', min: 0.1, max: 10, def: 1 },
  { name: 'clvl', min: 0, max: 1, def: 1 },
  { name: 'olvl', min: 0, max: 1, def: 1 },
  { name: 'choke', min: 0, max: 1, def: 1, int: true },
  { name: 'flange', min: 0, max: 1, def: 0 },
  { name: 'frate', min: 0.05, max: 6, def: 0.35 },
  { name: 'fdepth', min: 0, max: 1, def: 0.6 },
  { name: 'ffeed', min: -0.9, max: 0.9, def: 0.5 },
  { name: 'crush', min: 0, max: 1, def: 0 },
  { name: 'bits', min: 2, max: 16, def: 8, int: true },
  { name: 'down', min: 1, max: 32, def: 4, int: true },
];
const P = {};
SPEC.forEach((s, i) => { P[s.name] = i; });

export const KEYS = ['closed', 'open'];
export const REFERENCE_MS = { closed: 140, open: 700 };
export const DEFAULT_SHAPES = {
  closed: () => [{ x: 0, y: 1, l: null, r: [0.02, -0.3] }, { x: 1, y: 0, l: [-0.45, 0], r: null }],
  open: () => [{ x: 0, y: 1, l: null, r: [0.04, -0.15] }, { x: 1, y: 0, l: [-0.5, 0], r: null }],
};

const BANK = [205.3, 304.4, 369.6, 522.7, 540, 800];
const OFFSET = [-0.07, 0.11, -0.04, 0.09, -0.12, 0.06];   // how `spread` moves each of the six
const CHOKE_MS = 8;
const FLANGE_BASE_MS = 1.2, FLANGE_SWEEP_MS = 4;
const polyBlep = (t, dt) => {
  if (t < dt) { t /= dt; return t + t - t * t - 1; }
  if (t > 1 - dt) { t = (t - 1) / dt; return t * t + t + t + 1; }
  return 0;
};

const NODE = {
  type: 'hat2',
  inputs: [],
  outputs: ['out'],
  category: 'Sources',
  generator: true,
  shared: true,   // one hat for the instrument, never copied for each voice
  editor: 'hat2',
  shape: 'rounded',
  glyph: 'hat2',
  kinds: { out: 'stereo' },
  params: SPEC,
  create({ sampleRate, data }) {
    const tables = {};
    const setTable = (key, points) => { tables[key] = envelopeTable(cleanSpline(points, DEFAULT_SHAPES[key])); };
    for (const key of KEYS) setTable(key, data?.env?.[key]);

    const phase = new Float64Array(6);
    let rng = 0x2545f491;
    const rand = () => { rng ^= rng << 13; rng ^= rng >>> 17; rng ^= rng << 5; return (rng >>> 0) / 4294967296; };
    // one hit of each kind: how far into its drawing it is (in samples), how loud, and the per-hit variation
    const hat = { closed: { age: -1, vel: 0 }, open: { age: -1, vel: 0 } };
    let chokeLeft = 0, pendClosed = 0, pendOpen = 0;
    let pitchJitter = 1, toneJitter = 1, levelJitter = 1;
    let ic1 = 0, ic2 = 0, hp1 = 0, hp1x = 0, hp2 = 0, hp2x = 0;
    let noiseState = 0x1234567;
    const line = [new Float32Array(Math.ceil(sampleRate * 0.02)), new Float32Array(Math.ceil(sampleRate * 0.02))];
    let write = 0, lfo = 0, heldL = 0, heldR = 0, holdCount = 0;

    const start = (kind, vel) => {
      hat[kind].age = 0; hat[kind].vel = vel;
    };
    const vary = human => {
      pitchJitter = 1 + (rand() * 2 - 1) * 0.04 * human;
      toneJitter = 1 + (rand() * 2 - 1) * 0.25 * human;
      levelJitter = 1 - rand() * 0.35 * human;
      if (human > 0) for (let k = 0; k < 6; k++) phase[k] = rand();
    };

    return {
      message(msg) { if (msg.type === 'env' && KEYS.includes(msg.slot)) setTable(msg.slot, msg.points); },
      note(msg) {
        if (msg.type === 'noteOn') {
          const v = Math.max(0, Math.min(1, msg.vel ?? 1));
          if (msg.note === 1) pendOpen = v; else pendClosed = v;
        } else if (msg.type === 'noteCut' || msg.type === 'allOff') {
          hat.closed.age = hat.open.age = -1; chokeLeft = 0; pendClosed = pendOpen = 0;
        }
      },
      process(inputs, outputs, n, params, slots) {
        const [outL, outR] = outputs[0];
        const get = name => params[slots[P[name]]];
        const human = get('human'), choke = get('choke') >= 0.5;
        const level = get('level') * 0.45, mixNoise = get('noise'), spread = get('spread');
        const clvl = get('clvl'), olvl = get('olvl');
        const closedLen = REFERENCE_MS.closed * 0.001 * sampleRate / get('crate');
        const openLen = REFERENCE_MS.open * 0.001 * sampleRate / get('orate');
        const flange = get('flange'), fstep = get('frate') / sampleRate, fdepth = get('fdepth'), ffeed = get('ffeed');
        const crush = get('crush'), bits = Math.round(get('bits')), down = Math.max(1, Math.round(get('down')));
        const quant = Math.pow(2, bits - 1);

        // new hits: the open hat starts first, so a closed hit on the same row cuts it
        if (pendOpen > 0) { vary(human); start('open', pendOpen); chokeLeft = 0; pendOpen = 0; }
        if (pendClosed > 0) {
          if (pendOpen === 0 && hat.open.age < 0) vary(human);
          start('closed', pendClosed); pendClosed = 0;
          if (choke && hat.open.age >= 0) { chokeLeft = CHOKE_MS * 0.001 * sampleRate; }
        }

        const centre = Math.min(sampleRate * 0.45, get('body') * toneJitter);
        const g = Math.tan(Math.PI * centre / sampleRate), kq = 1 / 0.8;
        const a1 = 1 / (1 + g * (g + kq)), a2 = g * a1, a3 = g * a2;
        const rh = Math.exp(-2 * Math.PI * Math.min(get('tone') * toneJitter, sampleRate * 0.45) / sampleRate);
        const ratio = Math.pow(2, get('tune') / 12) * pitchJitter;
        const dts = BANK.map((f, k) => Math.min(0.45, f * ratio * (1 + spread * OFFSET[k]) / sampleRate));
        const lineLen = line[0].length;

        for (let i = 0; i < n; i++) {
          // the two drawings
          let amp = 0;
          for (const kind of KEYS) {
            const h = hat[kind];
            if (h.age < 0) continue;
            const len = kind === 'closed' ? closedLen : openLen;
            const pos = h.age / len;
            let env = readEnvelope(tables[kind], Math.min(1, pos));
            if (kind === 'open' && chokeLeft > 0) { env *= chokeLeft / (CHOKE_MS * 0.001 * sampleRate); chokeLeft--; if (chokeLeft <= 0) { h.age = -1; continue; } }
            amp += env * h.vel * (kind === 'closed' ? clvl : olvl);
            h.age++;
            if (pos >= 1 && Math.abs(env) < 1e-4) h.age = -1;
          }
          let metal = 0;
          for (let k = 0; k < 6; k++) {
            const dt = dts[k];
            let p = phase[k] + dt; if (p >= 1) p -= 1;
            phase[k] = p;
            metal += (p < 0.5 ? 1 : -1) + polyBlep(p, dt) - polyBlep((p + 0.5) % 1, dt);
          }
          noiseState ^= noiseState << 13; noiseState ^= noiseState >>> 17; noiseState ^= noiseState << 5;
          const white = (noiseState >>> 0) / 2147483648 - 1;
          const x = (metal * 0.25 * (1 - mixNoise) + white * 1.2 * mixNoise) * amp * levelJitter;
          const v3 = x - ic2, v1 = a1 * ic1 + a2 * v3, v2 = ic2 + a2 * ic1 + a3 * v3;
          ic1 = 2 * v1 - ic1; ic2 = 2 * v2 - ic2;
          const y1 = v1 - hp1x + rh * hp1; hp1x = v1; hp1 = y1;
          const y2 = y1 - hp2x + rh * hp2; hp2x = y1; hp2 = y2;
          const dry = y2 * level;

          // flanger: a short delay on each side, swept by a wave a quarter turn apart
          let sL = dry, sR = dry;
          if (flange > 0) {
            lfo += fstep; if (lfo >= 1) lfo -= 1;
            const outs = [0, 0];
            for (let c = 0; c < 2; c++) {
              const w = 0.5 + 0.5 * Math.sin(2 * Math.PI * (lfo + c * 0.25));
              const delay = (FLANGE_BASE_MS + FLANGE_SWEEP_MS * fdepth * w) * 0.001 * sampleRate;
              let rp = write - delay; if (rp < 0) rp += lineLen;
              const ia = Math.floor(rp), fr = rp - ia, ib = ia + 1 >= lineLen ? 0 : ia + 1;
              outs[c] = line[c][ia] * (1 - fr) + line[c][ib] * fr;
              line[c][write] = dry + outs[c] * ffeed;
            }
            write = write + 1 >= lineLen ? 0 : write + 1;
            sL = dry + outs[0] * flange; sR = dry + outs[1] * flange;
          }
          // bit crusher: hold every `down` samples, round to the depth
          if (crush > 0) {
            if (holdCount <= 0) { heldL = Math.round(sL * quant) / quant; heldR = Math.round(sR * quant) / quant; holdCount = down; }
            holdCount--;
            sL += (heldL - sL) * crush; sR += (heldR - sR) * crush;
          }
          outL[i] = sL; outR[i] = sR;
        }
        if (!Number.isFinite(ic1 + ic2 + hp1 + hp2 + heldL + heldR)) { ic1 = ic2 = hp1 = hp2 = hp1x = hp2x = heldL = heldR = 0; line[0].fill(0); line[1].fill(0); }
      },
    };
  },
};

export default NODE;
