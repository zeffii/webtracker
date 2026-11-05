// Bongo: a small hand drum, played with the fingers and the palm. It is a short bank of ringing modes (the same family of ratios as a
// drum skin: 1, 1.59, 2.14, 2.30, 2.65, 2.92 times the main pitch, plus a high rim ring), a knock from the shell under it, and the
// noise of the hand.
//   strike    how the head is hit, as a slide from 0 to 1: 0 is a muted hit (fingers left on the skin, a dull knock), 0.5 an open tone
//             (the fingertips bounce off and the head rings), 1 a slap (the hand cracks across the rim: bright, short, with a crack).
//             Every point between is a mix of the neighbours, so the strike can be a pattern command.
//   ring      how long the head rings, in ms, for an open tone. The strike scales it: muted rings for a fifth of this, a slap for half.
//   skin      how fast the high modes die compared with the low ones: higher is a duller, wetter head.
//   snap      the pitch jump of a hard hit: the skin tightens when struck and falls back in a few milliseconds.
//   crack     the noise of the hand on the skin. It follows the strike, so a slap cracks and a muted hit does not.
//   shell     the wooden shell's knock, a short note an octave under the head.
//   rim       the high ring from the hoop.
//   human     every hit a little different: its pitch, level and where the hand lands.
//   vel       how much the velocity changes level and brightness (0 none, 1 all of it).
// The note is the pitch of the main tone (the (1,1) mode). A high bongo is around D5 and the low one around A4. Monophonic: a new
// hit adds to what is ringing; the voices node makes it polyphonic.
const SPEC = [
  { name: 'strike', min: 0, max: 1, def: 0.5 },
  { name: 'ring', min: 30, max: 1500, def: 260 },        // ms for an open tone to fall 60 dB
  { name: 'skin', min: 0, max: 1, def: 0.45 },
  { name: 'snap', min: 0, max: 1, def: 0.4 },
  { name: 'crack', min: 0, max: 1, def: 0.5 },
  { name: 'shell', min: 0, max: 1, def: 0.35 },
  { name: 'rim', min: 0, max: 1, def: 0.25 },
  { name: 'human', min: 0, max: 1, def: 0.3 },
  { name: 'tune', min: -48, max: 48, def: 0 },
  { name: 'vel', min: 0, max: 1, def: 0.6 },
  { name: 'level', min: 0, max: 1, def: 0.6 },
];
const P = {};
SPEC.forEach((s, i) => { P[s.name] = i; });

// the ratios of the head's modes and how loud each one starts (open tone), then the rim ring
const MODES = [
  { ratio: 1, weight: 1 },
  { ratio: 1.593, weight: 0.55 },
  { ratio: 2.136, weight: 0.4 },
  { ratio: 2.296, weight: 0.3 },
  { ratio: 2.653, weight: 0.22 },
  { ratio: 2.917, weight: 0.16 },
];
const RIM_RATIO = 4.6;
const COUNT = MODES.length + 1;

// Three strikes and how they differ. `strike` slides between them: muted (0), open (0.5), slap (1).
const MUTED = { decay: 0.2, bright: -0.8, crack: 0.15, snap: 0.3, level: 0.8 };
const OPEN = { decay: 1, bright: 0, crack: 0.25, snap: 0.6, level: 1 };
const SLAP = { decay: 0.5, bright: 1.2, crack: 1, snap: 1, level: 1.05 };
const mixStrike = (a, b, t) => Object.fromEntries(Object.keys(a).map(k => [k, a[k] + (b[k] - a[k]) * t]));
const strikeAt = s => (s < 0.5 ? mixStrike(MUTED, OPEN, s * 2) : mixStrike(OPEN, SLAP, (s - 0.5) * 2));

export default {
  type: 'bongo',
  inputs: [],
  outputs: ['out'],
  category: 'Sources',
  generator: true,
  shape: 'rounded',
  glyph: 'bongo',
  kinds: { out: 'stereo' },
  params: SPEC,
  create({ sampleRate }) {
    const phase = new Float64Array(COUNT), amp = new Float64Array(COUNT), decay = new Float64Array(COUNT), freq = new Float64Array(COUNT);
    let note = 74, velocity = 1, pending = false, age = 1e9;
    let shellPhase = 0, shellAmp = 0, crackAmp = 0, hp = 0, hpx = 0, lp = 0, pitchLift = 0, hitGain = 1;
    let seed = 0x3c6ef372;
    const rand = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 4294967296 * 2 - 1; };

    return {
      note(msg) {
        if (msg.type === 'noteOn') { note = msg.note; velocity = Math.max(0, Math.min(1, msg.vel ?? 1)); pending = true; }
        else if (msg.type === 'noteCut') { amp.fill(0); shellAmp = crackAmp = 0; }
      },
      process(inputs, outputs, n, params, slots) {
        const [outL, outR] = outputs[0];
        const g = name => params[slots[P[name]]];
        const human = g('human'), s = strikeAt(g('strike'));
        const ring = g('ring') * 0.001 * s.decay, skin = g('skin');
        const base = 440 * Math.pow(2, (note + g('tune') - 69) / 12);

        if (pending) {
          pending = false; age = 0;
          const velAmt = g('vel'), loud = 1 - velAmt + velAmt * velocity;
          const pitchJitter = 1 + rand() * 0.012 * human, levelJitter = 1 - Math.abs(rand()) * 0.25 * human;
          hitGain = loud * levelJitter * s.level;
          const bright = s.bright + (velocity - 0.7) * velAmt * 1.2 + rand() * 0.25 * human;   // a hard hit or a slap excites the high modes
          for (let k = 0; k < COUNT; k++) {
            const isRim = k === MODES.length, ratio = isRim ? RIM_RATIO : MODES[k].ratio;
            freq[k] = base * ratio * pitchJitter;
            const w = (isRim ? g('rim') * 0.7 : MODES[k].weight) * Math.pow(ratio, bright);
            amp[k] += w * hitGain;
            // the high modes die faster: `skin` sets how much (the rim ring is short whatever the skin)
            const t60 = Math.max(0.004, ring * Math.pow(ratio, -skin * 1.6) * (isRim ? 0.5 : 1));
            decay[k] = Math.pow(10, -3 / (t60 * sampleRate));
          }
          shellAmp = g('shell') * hitGain; crackAmp = g('crack') * s.crack * hitGain; shellPhase = 0;
          pitchLift = g('snap') * s.snap * (0.5 + 0.5 * velocity);
        }
        const out = g('level') * 0.3;
        const shellFreq = base * 0.5, shellDecay = Math.exp(-1 / (0.035 * sampleRate)), crackDecay = Math.exp(-1 / (0.004 * sampleRate));
        const hpCoef = Math.exp(-2 * Math.PI * 1800 / sampleRate), lpCoef = 1 - Math.exp(-2 * Math.PI * 9000 / sampleRate);
        for (let i = 0; i < n; i++) {
          const lift = 1 + 0.35 * pitchLift * Math.exp(-age / (0.006 * sampleRate));
          let y = 0;
          for (let k = 0; k < COUNT; k++) {
            if (amp[k] < 1e-6) continue;
            phase[k] += freq[k] * lift / sampleRate; phase[k] -= Math.floor(phase[k]);
            y += Math.sin(2 * Math.PI * phase[k]) * amp[k];
            amp[k] *= decay[k];
          }
          if (shellAmp > 1e-6) {
            shellPhase += shellFreq * (1 + 0.5 * Math.exp(-age / (0.01 * sampleRate))) / sampleRate; shellPhase -= Math.floor(shellPhase);
            y += Math.sin(2 * Math.PI * shellPhase) * shellAmp * 0.8; shellAmp *= shellDecay;
          }
          if (crackAmp > 1e-5) {   // the hand on the skin: noise through a high-pass and a low-pass, gone in a few milliseconds
            const r = rand();
            hp = r - hpx + hpCoef * hp; hpx = r;
            lp += (hp - lp) * lpCoef;
            y += lp * crackAmp * 1.4; crackAmp *= crackDecay;
          }
          age++;
          const o = y * out;
          outL[i] = o; outR[i] = o;
        }
        if (!Number.isFinite(hp + lp + shellPhase)) { hp = lp = hpx = 0; amp.fill(0); }
      },
    };
  },
};
