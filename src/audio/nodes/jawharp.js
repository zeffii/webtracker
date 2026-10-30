// Jaw harp. A steel tongue (the reed) is plucked beside the player's mouth. The reed itself is nearly pure and quiet;
// what is heard is the air: each time the reed swings through the gap it lets a narrow puff of air into the mouth, so the
// sound is a train of pulses at the reed's pitch (a drone, whatever the mouth does). The mouth is a resonant cavity that
// picks out whichever of the harmonics lie near its own resonances, and moving the tongue and lips (the vowel) sweeps
// those resonances up and down, which is where the tune and the "wah" come from.
//
//   reed         plucked: a sine at the note's pitch that dies away over `decay`. Just after the pluck it twangs: the
//                pitch is a little high and a slap of noise (`twang`) is added
//   gap          the pulse of air for each swing: `drive` narrows it, which makes the sound richer in harmonics
//   mouth        three resonators for the cavity, at the formants of a vowel, `vowel` going u, o, a, e, i from 0 to 1;
//                `mouth` makes the cavity bigger or smaller, `track` has the vowel follow the note, `focus` is how sharply
//                the cavity picks harmonics. `body` lets some of the plain reed through
//   breath       noise in the airflow
//
// Monophonic, a new note plucks the reed again; the voices node makes it polyphonic. Note off damps the reed over `release`.
const SPEC = [
  { name: 'vowel', min: 0, max: 1, def: 0.4 },
  { name: 'mouth', min: -12, max: 12, def: 0 },         // semitones: the size of the cavity
  { name: 'track', min: 0, max: 1, def: 0 },            // how far the cavity follows the note (1: a semitone for a semitone)
  { name: 'focus', min: 2, max: 40, def: 12 },          // the resonators' Q
  { name: 'drive', min: 0, max: 1, def: 0.5 },
  { name: 'twang', min: 0, max: 1, def: 0.4 },
  { name: 'breath', min: 0, max: 1, def: 0.1 },
  { name: 'body', min: 0, max: 1, def: 0.15 },
  { name: 'decay', min: 0.1, max: 8, def: 1.5 },        // seconds for the reed to fall by 60 dB
  { name: 'tune', min: -48, max: 48, def: 0 },
  { name: 'vel', min: 0, max: 1, def: 0.5 },
  { name: 'level', min: 0, max: 1, def: 0.5 },
  { name: 'release', min: 5, max: 3000, def: 120 },     // ms
];
const P = {};
SPEC.forEach((s, i) => { P[s.name] = i; });

// The first three resonances (Hz) of the mouth for the vowels u, o, a, e, i.
const VOWELS = [[300, 870, 2240], [400, 800, 2600], [700, 1200, 2600], [500, 1850, 2600], [300, 2300, 3000]];
const WEIGHTS = [1, 0.7, 0.35];   // how loud each resonance is

// The resonances for a vowel position from 0 to 1, in Hz.
function formants(vowel, out) {
  const x = Math.min(0.9999, Math.max(0, vowel)) * (VOWELS.length - 1), i = Math.floor(x), f = x - i;
  for (let k = 0; k < 3; k++) out[k] = VOWELS[i][k] + (VOWELS[i + 1][k] - VOWELS[i][k]) * f;
}

export default {
  type: 'jawharp',
  inputs: ['pitch'],
  outputs: ['out'],
  category: 'Sources',
  generator: true,
  shape: 'rounded',
  glyph: 'jawharp',
  kinds: { pitch: 'control', out: 'stereo' },
  params: SPEC,
  create({ sampleRate, connected }) {
    const pitchOn = connected[0];
    let note = 60, velocity = 1, held = false, active = false, pending = false;
    let phase = 0, amp = 0, age = 0, gain = 1, hp = 0, hpIn = 0, slap = 0;
    const fs = [0, 0, 0], target = [0, 0, 0];                       // the resonances, smoothed from block to block
    const s1 = [0, 0, 0], s2 = [0, 0, 0];                            // the resonators' state
    let seed = 0x9e3779b9;
    const rand = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 4294967296 * 2 - 1; };
    const dcR = 1 - (2 * Math.PI * 30) / sampleRate;                 // the highpass that takes the air flow's mean away

    const aim = g => {   // where the three resonances should be for the settings and the note
      formants(g('vowel'), target);
      const shift = Math.pow(2, (g('mouth') + g('track') * (note - 60)) / 12);
      for (let k = 0; k < 3; k++) target[k] = Math.min(sampleRate * 0.45, target[k] * shift);
    };

    return {
      note(msg) {
        if (msg.type === 'noteOn') { note = msg.note; velocity = msg.vel ?? 1; pending = true; held = true; active = true; }
        else if (msg.type === 'noteOff' || msg.type === 'allOff') held = false;
        else if (msg.type === 'noteCut') { active = false; held = false; amp = 0; s1.fill(0); s2.fill(0); }
      },
      process(inputs, outputs, n, params, slots) {
        const [outL, outR] = outputs[0];
        if (!active) { outL.fill(0, 0, n); outR.fill(0, 0, n); return; }
        const g = name => params[slots[P[name]]];
        aim(g);
        if (pending) {
          pending = false;
          phase = 0; amp = 1; age = 0; slap = 1; hp = 0; hpIn = 0;
          gain = 1 - g('vel') + g('vel') * velocity;
          for (let k = 0; k < 3; k++) fs[k] = target[k];
          s1.fill(0); s2.fill(0);
        } else for (let k = 0; k < 3; k++) fs[k] += (target[k] - fs[k]) * 0.35;
        const base = 440 * Math.pow(2, (note + g('tune') - 69) / 12 + (pitchOn ? inputs[0][0] : 0));
        const twang = g('twang'), power = 1 + 7 * g('drive'), breath = g('breath') * 0.3, body = g('body');
        const k = 1 / g('focus'), perSample = Math.pow(10, -3 / (g('decay') * sampleRate)), relSample = Math.pow(10, -3 / (g('release') * 0.001 * sampleRate));
        // a state variable filter (trapezoidal) for each resonance
        const gc = fs.map(f => Math.tan((Math.PI * f) / sampleRate)), a1 = gc.map(x => 1 / (1 + x * (x + k))), a2 = gc.map((x, i) => x * a1[i]), a3 = gc.map((x, i) => x * a2[i]);
        const out = g('level') * gain * 6;
        for (let i = 0; i < n; i++) {
          const dip = 1 + twang * 0.05 * Math.exp(-age / (0.05 * sampleRate));   // just after the pluck the reed is a little sharp
          phase += (base * dip) / sampleRate; phase -= Math.floor(phase);
          amp *= held ? perSample : perSample * relSample;
          age++;
          const swing = Math.sin(2 * Math.PI * phase), puff = Math.pow(Math.max(0, swing), power);
          slap *= 0.995;
          const air = amp * (puff + rand() * (breath + twang * slap * 0.8));
          hp = air - hpIn + dcR * hp; hpIn = air;
          let y = 0;
          for (let r = 0; r < 3; r++) {   // the mouth: the resonances picked out of the air
            const v3 = hp - s2[r], v1 = a1[r] * s1[r] + a2[r] * v3, v2 = s2[r] + a2[r] * s1[r] + a3[r] * v3;
            s1[r] = 2 * v1 - s1[r]; s2[r] = 2 * v2 - s2[r];
            y += WEIGHTS[r] * k * v1;
          }
          y = (y + body * hp) * out;
          outL[i] = outR[i] = y;
        }
        if (amp < 1e-5) { active = false; amp = 0; s1.fill(0); s2.fill(0); }
      },
    };
  },
};
