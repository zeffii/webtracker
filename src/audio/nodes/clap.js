// Hand clap, in the 808 and 909 manner: noise through a band-pass, shaped by an envelope that is a short run of
// quick bursts (the individual hands, `bursts` of them every `spacing` ms, each dying in `burstDecay` ms) followed by
// one longer tail (`tailDecay` ms, `tailLevel` against the bursts) that starts with the last burst. `tone` and `q` set
// the band-pass, `spread` makes the two channels carry different noise for width, `drive` rounds the peaks.
// A note with any number is a hit; the velocity is the digit (1 to F). A new hit restarts the sound.
const SPEC = [
  { name: 'tone', min: 300, max: 4000, def: 1200 },      // Hz, centre of the band-pass
  { name: 'q', min: 0.4, max: 8, def: 1.8 },
  { name: 'bursts', min: 1, max: 6, def: 4, int: true },
  { name: 'spacing', min: 2, max: 30, def: 10 },         // ms between the bursts
  { name: 'burstDecay', min: 0.5, max: 25, def: 8 },     // ms for a burst to fall by 40 dB
  { name: 'tailDecay', min: 20, max: 800, def: 220 },    // ms for the tail to fall by 40 dB
  { name: 'tailLevel', min: 0, max: 1, def: 0.6 },
  { name: 'spread', min: 0, max: 1, def: 0.5 },
  { name: 'drive', min: 0, max: 1, def: 0.2 },
  { name: 'vel', min: 0, max: 1, def: 0.6 },
  { name: 'level', min: 0, max: 1, def: 0.7 },
];
const P = {};
SPEC.forEach((s, i) => { P[s.name] = i; });

export default {
  type: 'clap',
  inputs: [],
  outputs: ['out'],
  category: 'Sources',
  generator: true,
  shared: true,   // one clap for the instrument, never copied for each voice
  shape: 'rounded',
  glyph: 'clap',
  kinds: { out: 'stereo' },
  params: SPEC,
  create({ sampleRate }) {
    let pend = 0, velocity = 0, since = -1, next = 0, burst = 0, tail = 0, hp = [0, 0], hpx = [0, 0];
    let ic1 = [0, 0], ic2 = [0, 0], seed = [0x1234567, 0x7654321, 0x2468ace];
    const rand = k => { let s = seed[k]; s ^= s << 13; s ^= s >>> 17; s ^= s << 5; seed[k] = s; return (s >>> 0) / 2147483648 - 1; };
    const ms = sampleRate * 0.001;
    return {
      note(msg) {
        if (msg.type === 'noteOn') pend = Math.max(0, Math.min(1, msg.vel ?? 1)) || 0.01;
        else if (msg.type === 'noteCut') { since = -1; burst = tail = 0; pend = 0; }
      },
      process(inputs, outputs, n, params, slots) {
        const [outL, outR] = outputs[0];
        const g = name => params[slots[P[name]]];
        if (pend > 0) { velocity = pend; pend = 0; since = 0; next = 0; burst = tail = 0; }
        if (since < 0 && burst < 1e-5 && tail < 1e-5) { outL.fill(0, 0, n); outR.fill(0, 0, n); return; }
        const bursts = Math.round(g('bursts')), gap = g('spacing') * ms;
        const bDec = Math.exp(-4.6 / (g('burstDecay') * ms)), tDec = Math.exp(-4.6 / (g('tailDecay') * ms)), tailLevel = g('tailLevel');
        const spread = g('spread'), drive = 1 + g('drive') * 4, v = 1 - g('vel') + g('vel') * velocity, level = g('level') * v * 1.6;
        // a trapezoidal state-variable band-pass, unity gain at the centre
        const f = Math.tan(Math.PI * Math.min(0.45, g('tone') / sampleRate)), k = 1 / g('q');
        const a1 = 1 / (1 + f * (f + k)), a2 = f * a1, a3 = f * a2;
        const rh = Math.exp(-2 * Math.PI * 250 / sampleRate);   // a gentle high-pass to keep rumble out
        for (let i = 0; i < n; i++) {
          if (since >= 0) {
            if (next < bursts && since >= Math.round(next * gap)) {
              burst = 1; next++;
              if (next === bursts) tail = 1;   // the tail starts with the last burst
            }
            since++;
          }
          const env = burst + tail * tailLevel;
          const common = rand(2);
          for (let c = 0; c < 2; c++) {
            const x = common * (1 - spread) + rand(c) * spread;
            const v3 = x - ic2[c], v1 = a1 * ic1[c] + a2 * v3, v2 = ic2[c] + a2 * ic1[c] + a3 * v3;
            ic1[c] = 2 * v1 - ic1[c]; ic2[c] = 2 * v2 - ic2[c];
            const bp = v1 * k;
            const y = bp - hpx[c] + rh * hp[c]; hpx[c] = bp; hp[c] = y;
            const s = Math.tanh(y * env * drive) / Math.tanh(drive) * level;
            (c ? outR : outL)[i] = s;
          }
          burst *= bDec; tail *= tDec;
        }
        if (burst < 1e-6) burst = 0;
        if (tail < 1e-6) tail = 0;
        if (burst === 0 && tail === 0 && next >= bursts) since = -1;
        if (!Number.isFinite(ic1[0] + ic2[0] + ic1[1] + ic2[1] + hp[0] + hp[1])) { ic1 = [0, 0]; ic2 = [0, 0]; hp = [0, 0]; hpx = [0, 0]; }
      },
    };
  },
};
