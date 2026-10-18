// Squelch: a bassline machine after the TB-303. One voice, a band-limited saw or square, a resonant four-pole ladder low-pass
// whose feedback saturates (so it squeals and, turned right up, rings by itself), and the three things that make the sound:
//
//  - the filter envelope: a note restarts it and the cutoff rises `envmod` (up to five octaves) and falls back over `decay`;
//  - slide: a note written with the Sld flag glides to its pitch from the note before, over `slide` ms, and, because the gate
//    stays up, does not restart either envelope (legato). A slide with no note sounding is just a note;
//  - accent: a note written with the Acc flag (1 to F) is louder and punchier, a transient on top of its level, and opens the
//    filter further. Its filter envelope is always short, and a run of accents charges a sweep that builds on itself.
//
// Acc and Sld are for one note only: they count when the pattern writes them on the row of the note, and a blank cell is off.
// (A parameter column normally keeps its value; here the node looks at whether the row wrote it.) A note off lets the amplitude
// go over `rel` ms; a new note while another sounds is not a release. Note cut silences it at once.
const SPEC = [
  { name: 'wave', min: 0, max: 1, def: 0, int: true },        // 0 saw, 1 square
  { name: 'tune', min: -48, max: 48, def: 0 },                // semitones
  { name: 'cutoff', min: 30, max: 12000, def: 700 },          // Hz, before the envelope
  { name: 'res', min: 0, max: 1, def: 0.65 },
  { name: 'envmod', min: 0, max: 1, def: 0.55 },              // how far the envelope opens the filter, up to 5 octaves
  { name: 'decay', min: 30, max: 3000, def: 350 },            // ms for the filter envelope to fall 60 dB
  { name: 'accent', min: 0, max: 1, def: 0.6 },               // how much an accent adds
  { name: 'slide', min: 1, max: 500, def: 60 },               // ms
  { name: 'drive', min: 0, max: 1, def: 0.25 },
  { name: 'rel', min: 1, max: 500, def: 12 },                 // ms, amplitude release after a note off
  { name: 'vel', min: 0, max: 1, def: 0.3 },                  // how much velocity changes the level
  { name: 'level', min: 0, max: 1, def: 0.7 },
  { name: 'acc', min: 0, max: 15, def: 0, int: true },        // the Acc column: 1 an accent, up to F a stronger one
  { name: 'sld', min: 0, max: 1, def: 0, int: true },         // the Sld column: 1 slides into the note
];
const P = {};
SPEC.forEach((s, i) => { P[s.name] = i; });

const polyBlep = (t, dt) => {
  if (t < dt) { t /= dt; return t + t - t * t - 1; }
  if (t > 1 - dt) { t = (t - 1) / dt; return t * t + t + t + 1; }
  return 0;
};
const clip = x => (x > 3 ? 1 : x < -3 ? -1 : x * (27 + x * x) / (27 + 9 * x * x));   // a smooth tanh
const ATTACK = 1, HELD = 2, RELEASE = 3;

export default {
  type: 'squelch',
  inputs: [],
  outputs: ['out'],
  category: 'Sources',
  generator: true,
  shared: true,   // one voice for the instrument
  shape: 'rounded',
  glyph: 'squelch',
  kinds: { out: 'stereo' },
  params: SPEC,
  create({ sampleRate, clock }) {
    const sr = sampleRate, stamps = clock?.stamps ?? new Uint32Array(1024);
    let phase = 0, pitch = 36, target = 36, gate = false, active = false, pend = null;
    let stage = RELEASE, vca = 0, velocity = 1, env = 0, envS = 0, accNote = false, accEnv = 0, accCap = 0, accNow = 0;
    let lastS = -1, lastA = -1;
    const s = new Float64Array(4);
    let dc = 0, dcx = 0;
    const attackStep = 1 / (0.003 * sr), heldCoef = Math.exp(-1 / (0.02 * sr)), envSmooth = 1 - Math.exp(-1 / (0.002 * sr));
    const accDecay = Math.exp(-1 / (0.25 * sr)), capDecay = Math.exp(-1 / (0.6 * sr));
    return {
      note(msg) {
        if (msg.type === 'noteOn') pend = { note: msg.note, vel: Math.max(0, Math.min(1, msg.vel ?? 1)) };
        else if (msg.type === 'noteOff') { if (!msg.implied && gate) { gate = false; stage = RELEASE; } }
        else if (msg.type === 'allOff') { if (gate) { gate = false; stage = RELEASE; } }
        else if (msg.type === 'noteCut') { gate = false; active = false; pend = null; vca = 0; env = envS = 0; accEnv = accCap = 0; s.fill(0); dc = dcx = 0; }
      },
      process(inputs, outputs, n, params, slots) {
        const [outL, outR] = outputs[0];
        const g = name => params[slots[P[name]]];
        // Did this row write the flags? A blank cell is not a write, so the flag counts for this block's note only.
        const sStamp = stamps[slots[P.sld]], aStamp = stamps[slots[P.acc]];
        const slideFlag = sStamp !== lastS && (lastS !== -1 || sStamp > 0) && g('sld') >= 1, accFlag = aStamp !== lastA && (lastA !== -1 || aStamp > 0) && g('acc') >= 1;   // the very first block counts too: the song may start on a flagged row
        lastS = sStamp; lastA = aStamp;
        if (pend) {
          const sliding = slideFlag && gate;
          velocity = pend.vel;
          target = pend.note;
          if (!sliding) {
            pitch = target; env = 1; stage = ATTACK;
            accNote = accFlag;
            if (accFlag) { accNow = 1 + (g('acc') - 1) / 14; accEnv = accNow; accCap += (1 - accCap) * 0.45; }
          }
          gate = true; active = true; pend = null;
        }
        if (!active) { outL.fill(0, 0, n); outR.fill(0, 0, n); return; }
        const cutoff = g('cutoff'), res = g('res'), envmod = g('envmod') * 5, accent = g('accent'), drive = g('drive'), level = g('level') * 0.9;
        const decayMs = accNote ? Math.min(g('decay'), 200) : g('decay');
        const envCoef = Math.exp(-6.9078 / (sr * decayMs * 0.001));
        const slideCoef = 1 - Math.exp(-3 / (sr * g('slide') * 0.001));
        const relCoef = Math.exp(-6.9078 / (sr * g('rel') * 0.001));
        const tune = g('tune'), square = g('wave') >= 0.5, vel = g('vel');
        const velGain = 1 - vel + vel * velocity, driveGain = 1 + drive * 7;
        let inc = 0, G = 0, k = 0, G4 = 0;
        for (let i = 0; i < n; i++) {
          if ((i & 7) === 0) {   // pitch, cutoff and the filter's coefficients are worked out every 8 samples
            inc = 440 * Math.pow(2, (pitch + tune - 69) / 12) / sr;
            const accSum = Math.min(2, accEnv + 0.6 * accCap);
            const octs = envmod * envS * (1 + accent * accSum) + accent * 0.6 * accSum;
            const fc = Math.min(0.45 * sr, Math.max(20, cutoff * Math.pow(2, octs)));
            const gg = Math.tan(Math.PI * fc / (2 * sr));   // the filter runs twice per sample
            G = gg / (1 + gg); G4 = G * G * G * G;
            k = 4.2 * Math.min(1, res + accent * 0.12 * accSum);
          }
          // the oscillator, band-limited
          phase += inc; if (phase >= 1) phase -= 1;
          let x;
          if (square) x = (phase < 0.5 ? 1 : -1) + polyBlep(phase, inc) - polyBlep((phase + 0.5) % 1, inc);
          else x = 2 * phase - 1 - polyBlep(phase, inc);
          const xin = x * 1.6;
          // the ladder, twice per sample
          let y = 0;
          for (let sub = 0; sub < 2; sub++) {
            const rest = (1 - G) * (G * G * G * s[0] + G * G * s[1] + G * s[2] + s[3]);
            const y4 = (G4 * xin + rest) / (1 + k * G4);
            const u = clip(xin - k * y4);
            const v1 = (u - s[0]) * G, y1 = v1 + s[0]; s[0] = y1 + v1;
            const v2 = (y1 - s[1]) * G, y2 = v2 + s[1]; s[1] = y2 + v2;
            const v3 = (y2 - s[2]) * G, y3 = v3 + s[2]; s[2] = y3 + v3;
            const v4 = (y3 - s[3]) * G, y4n = v4 + s[3]; s[3] = y4n + v4;
            y += y4n * 0.5;
          }
          // amplitude: a quick attack, a small settle, held until the note off; an accent adds a transient on top
          if (stage === ATTACK) { vca += attackStep; if (vca >= 1) { vca = 1; stage = HELD; } }
          else if (stage === HELD) vca = 0.85 + (vca - 0.85) * heldCoef;
          else vca *= relCoef;
          let o = y * vca * (1 + accent * accEnv * 1.3) * velGain;
          o = drive > 0 ? clip(o * driveGain) / Math.sqrt(driveGain) * 1.4 : o;
          const r = o - dcx + 0.995 * dc; dcx = o; dc = r;
          outL[i] = outR[i] = r * level;
          env *= envCoef; envS += (env - envS) * envSmooth;
          accEnv *= accDecay; accCap *= capDecay;
          pitch += (target - pitch) * slideCoef;
          if (Math.abs(target - pitch) < 1e-3) pitch = target;
        }
        if (!Number.isFinite(dc + dcx + s[0] + s[3])) { s.fill(0); dc = dcx = 0; }
        if (stage === RELEASE && vca < 1e-5) { active = false; vca = 0; s.fill(0); dc = dcx = 0; }
      },
    };
  },
};
