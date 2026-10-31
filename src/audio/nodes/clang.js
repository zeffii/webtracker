// Clang: struck metal. A body is hit once and rings through a set of resonances (modes), each with its own pitch, loudness and
// way of dying away: this is how a plate, a bell, a pipe or a barrel sounds, and the difference between them is mostly which
// resonances there are.
//
//   shape      0 is a thin round plate (cymbal, ride): many resonances at awkward, uneven spacings that stay bright and ring on.
//              1 is a large hollow barrel: fewer, lower and more even resonances that fade quickly towards the top, a dull wooden-metal boom.
//   damping    how fast the ringing dies. This is the damping ratio of the body, set for its lowest resonance: 0 rings for seconds, 1 is a dead clack.
//   highdamp   how much faster the high resonances die than the low ones (a rubbed or taped plate, a thick wall)
//   thump      the body of the hit: a low, pitch-falling push underneath the ring, and a little saturation to make it hit harder
//   strike     the beater: 0 a soft mallet (only the low resonances are shaken), 1 a hard stick (all of them, and a click)
//   position   where it is hit: the middle or the rim, which changes how loud each resonance is
//   stretch    pulls the resonances further apart (above 1) or closer together (below 1): toward a bell or toward a pipe
//   wash       the sizzle of a cymbal: noise keeps feeding the high resonances for a while after the hit
//   width      the resonances are spread over the stereo field
//
// Monophonic, a new note hits it again (what is still ringing carries on); the voices node makes it polyphonic.
// Note off damps the ringing over `release`, like a hand on a cymbal.
const SPEC = [
  { name: 'shape', min: 0, max: 1, def: 0.25 },
  { name: 'damping', min: 0, max: 1, def: 0.45 },
  { name: 'highdamp', min: 0, max: 1, def: 0.5 },
  { name: 'thump', min: 0, max: 1, def: 0.3 },
  { name: 'strike', min: 0, max: 1, def: 0.6 },
  { name: 'position', min: 0, max: 1, def: 0.4 },
  { name: 'stretch', min: 0.6, max: 1.6, def: 1 },
  { name: 'wash', min: 0, max: 1, def: 0.3 },
  { name: 'width', min: 0, max: 1, def: 0.4 },
  { name: 'tune', min: -48, max: 48, def: 0 },
  { name: 'vel', min: 0, max: 1, def: 0.5 },
  { name: 'level', min: 0, max: 1, def: 0.5 },
  { name: 'release', min: 5, max: 3000, def: 400 },   // ms
];
const P = {};
SPEC.forEach((s, i) => { P[s.name] = i; });

const MODES = 28;
const golden = k => (k * 0.6180339887) % 1;

// Pitch ratios of the resonances, each relative to the lowest. The plate is a free round plate (its first resonances are the
// known ones, then they carry on getting denser); the barrel is a shell with the air inside it.
const PLATE = [1, 1.73, 2.33, 3.9, 4.15, 5.95, 6.72, 7.33, 9.9, 10.4, 12.5, 13.2];
const BARREL = [1, 1.6, 2.12, 2.4, 3.0, 3.55, 4.18, 4.8, 5.6, 6.3, 7.2, 8.1];
for (let k = PLATE.length; k < MODES; k++) PLATE.push(PLATE[k - 1] + 1.1 + 0.8 * golden(k));
for (let k = BARREL.length; k < MODES; k++) BARREL.push(BARREL[k - 1] + 0.85 + 0.3 * golden(k));

export default {
  type: 'clang',
  inputs: ['pitch'],
  outputs: ['out'],
  category: 'Sources',
  generator: true,
  shape: 'rounded',
  glyph: 'clang',
  kinds: { pitch: 'control', out: 'stereo' },
  params: SPEC,
  create({ sampleRate, connected }) {
    const pitchOn = connected[0];
    let note = 60, velocity = 1, held = false, active = false, pending = false, age = 0, amp = 1, gain = 1;
    let lp = 0, thumpPhase = 0;
    const y1 = new Float64Array(MODES), y2 = new Float64Array(MODES);
    const a1 = new Float64Array(MODES), a2 = new Float64Array(MODES), gk = new Float64Array(MODES), washK = new Float64Array(MODES);
    const panL = new Float64Array(MODES), panR = new Float64Array(MODES);
    let used = 0;
    let seed = 0x1234abcd;
    const rand = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 4294967296 * 2 - 1; };

    // The resonators for the settings and the note: coefficients, loudness, and how much sizzle each one gets.
    const aim = (g, base) => {
      const shape = g('shape'), stretch = g('stretch'), strike = g('strike'), position = g('position'), width = g('width'), high = g('highdamp');
      const t60 = 6 * Math.pow(0.08 / 6, g('damping'));                     // seconds for the lowest resonance to fall 60 dB
      const slope = (0.35 + 0.65 * shape) * (0.5 + 1.5 * high);             // how fast the decay time shortens up the resonances
      const tilt = 0.25 + 1.45 * shape;                                       // how fast the loudness falls up the resonances
      const reach = 1 + 9 * strike;                                          // how many resonances the beater can shake
      used = 0;
      for (let k = 0; k < MODES; k++) {
        const ratio = Math.pow(Math.exp(Math.log(PLATE[k]) + (Math.log(BARREL[k]) - Math.log(PLATE[k])) * shape), stretch);
        const f = base * ratio;
        if (f > sampleRate * 0.45) { gk[k] = 0; continue; }
        used = k + 1;
        const t = Math.max(0.004, t60 * Math.pow(ratio, -slope));
        const r = Math.pow(10, -3 / (t * sampleRate)), th = 2 * Math.PI * f / sampleRate;
        a1[k] = 2 * r * Math.cos(th); a2[k] = r * r;
        const where = 0.3 + 0.7 * Math.abs(Math.cos(Math.PI * position * (k + 1) * 0.37));
        const w = Math.pow(k + 1, -tilt) * where * Math.min(1, reach / (k + 1)) * (k < 3 ? 1 : 0.8 + 0.2 * strike);
        gk[k] = w * Math.sin(th) * 1.6;
        washK[k] = k >= 6 ? gk[k] * 0.5 : 0;
        const p = (golden(k + 1) * 2 - 1) * width;
        panL[k] = Math.sqrt(0.5 * (1 - p)); panR[k] = Math.sqrt(0.5 * (1 + p));
      }
    };

    return {
      note(msg) {
        if (msg.type === 'noteOn') { note = msg.note; velocity = msg.vel ?? 1; pending = true; held = true; active = true; }
        else if (msg.type === 'noteOff' || msg.type === 'allOff') held = false;
        else if (msg.type === 'noteCut') { active = false; held = false; y1.fill(0); y2.fill(0); }
      },
      process(inputs, outputs, n, params, slots) {
        const [outL, outR] = outputs[0];
        if (!active) { outL.fill(0, 0, n); outR.fill(0, 0, n); return; }
        const g = name => params[slots[P[name]]];
        const base = 440 * Math.pow(2, (note + g('tune') - 69) / 12 + (pitchOn ? inputs[0][0] : 0));
        aim(g, base);
        if (pending) { pending = false; age = 0; amp = 1; thumpPhase = 0; gain = 1 - g('vel') + g('vel') * velocity; }
        const strike = g('strike'), thump = g('thump'), shape = g('shape'), wash = g('wash');
        const fc = 600 * Math.pow(30, strike), beat = 1 - Math.exp(-2 * Math.PI * fc / sampleRate);   // the beater's brightness
        const click = 0.0004 * sampleRate * (1 + 8 * (1 - strike));                                     // how long the beater is in contact
        const washLen = (0.3 + 1.5 * (1 - g('damping'))) * sampleRate;
        const rel = Math.pow(10, -3 / (g('release') * 0.001 * sampleRate));
        const thumpTau = (0.03 + 0.2 * shape) * sampleRate, thumpF0 = base * (0.5 - 0.15 * shape);
        const drive = 1 + 2.5 * thump, out = g('level') * gain * 1.1 / Math.tanh(drive * 0.5);
        for (let i = 0; i < n; i++) {
          if (!held) amp *= rel;
          const hit = age < click ? (age === 0 ? 1 : 0.5 * rand()) * (1 - age / click) : 0;
          lp += (hit - lp) * beat;
          const sizzle = wash * Math.exp(-age / washLen) * rand() * 0.15 * amp;
          let L = 0, R = 0;
          for (let k = 0; k < used; k++) {
            const y = gk[k] * lp + washK[k] * sizzle + a1[k] * y1[k] - a2[k] * y2[k];
            y2[k] = y1[k]; y1[k] = y;
            L += y * panL[k]; R += y * panR[k];
          }
          let body = 0;
          if (thump > 0) {
            const e = Math.exp(-age / thumpTau);
            thumpPhase += thumpF0 * (1 + 1.5 * Math.exp(-age / (0.012 * sampleRate))) / sampleRate; thumpPhase -= Math.floor(thumpPhase);
            body = Math.sin(2 * Math.PI * thumpPhase) * e * thump * 1.2 * Math.min(1, age / 8);
          }
          age++;
          outL[i] = Math.tanh((L * amp + body) * drive * 0.5) * out;
          outR[i] = Math.tanh((R * amp + body) * drive * 0.5) * out;
        }
        // finished when what rings has fallen far below hearing (and the thump is over), so a quiet voice stops costing anything
        if (age > thumpTau * 5 && age > sampleRate * 0.05) {
          let e = 0; for (let k = 0; k < used; k++) e += y1[k] * y1[k] + y2[k] * y2[k];
          if (e * amp * amp < 1e-14 || amp < 1e-5) { active = false; y1.fill(0); y2.fill(0); }
        }
      },
    };
  },
};
