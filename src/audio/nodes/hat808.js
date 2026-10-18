// 808-style hi-hat, closed and open in one voice. The metal is the 808's own: six square waves at fixed, inharmonic
// frequencies, summed, then a band-pass and a high-pass (`tone`), then an amplitude envelope. Closed and open share that
// one bank, as on the real machine, and differ only in their decay. A note with number 0 is a closed hit and number 1
// an open hit (the hat lane's Cl and Op columns send them); the velocity is the digit, 1 to F. A closed hit chokes the
// open hat with a plain 8 ms fade (`choke` off lets the open tail ring). When both hit on the same row the open hat
// starts and the closed one cuts it at once. `snap` adds a short bright click at the start of a hit.
// Monophonic: a new hit of a kind restarts that kind's envelope.
const SPEC = [
  { name: 'tune', min: -12, max: 12, def: 0 },         // semitones, moves the whole bank
  { name: 'tone', min: 3000, max: 12000, def: 7000 },  // Hz, high-pass: higher is thinner
  { name: 'snap', min: 0, max: 1, def: 0.3 },
  { name: 'level', min: 0, max: 1, def: 0.6 },
  { name: 'cdec', min: 10, max: 200, def: 45 },        // ms for the closed hat to fall 40 dB
  { name: 'odec', min: 100, max: 2000, def: 400 },     // ms for the open hat to fall 40 dB
  { name: 'clvl', min: 0, max: 1, def: 1 },            // closed hat level
  { name: 'olvl', min: 0, max: 1, def: 1 },            // open hat level
  { name: 'choke', min: 0, max: 1, def: 1, int: true },   // 1: a closed hit cuts the open hat
];
const P = {};
SPEC.forEach((s, i) => { P[s.name] = i; });

const BANK = [205.3, 304.4, 369.6, 522.7, 540, 800];
const CHOKE_MS = 8;
const polyBlep = (t, dt) => {
  if (t < dt) { t /= dt; return t + t - t * t - 1; }
  if (t > 1 - dt) { t = (t - 1) / dt; return t * t + t + t + 1; }
  return 0;
};

export default {
  type: 'hat808',
  inputs: [],
  outputs: ['out'],
  category: 'Sources',
  generator: true,
  shared: true,   // one hat for the instrument, never copied for each voice
  shape: 'rounded',
  glyph: 'hat808',
  kinds: { out: 'stereo' },
  params: SPEC,
  create({ sampleRate }) {
    const phase = new Float64Array(6).map((_, i) => i / 6);
    let closed = 0, open = 0, click = 0, choking = false, chokeStep = 0;
    let pendClosed = 0, pendOpen = 0, noise = 0x1234567;
    // band-pass (state-variable) then high-pass (two one-pole stages)
    let ic1 = 0, ic2 = 0, hp1 = 0, hp1x = 0, hp2 = 0, hp2x = 0;
    return {
      note(msg) {
        if (msg.type === 'noteOn') {
          const v = Math.max(0, Math.min(1, msg.vel ?? 1));
          if (msg.note === 1) pendOpen = v; else pendClosed = v;
        } else if (msg.type === 'noteCut') { closed = open = click = 0; choking = false; pendClosed = pendOpen = 0; }
      },
      process(inputs, outputs, n, params, slots) {
        const [outL, outR] = outputs[0];
        const ratio = Math.pow(2, params[slots[P.tune]] / 12);
        const snap = params[slots[P.snap]], level = params[slots[P.level]] * 0.45;
        const clvl = params[slots[P.clvl]], olvl = params[slots[P.olvl]], chokeOn = params[slots[P.choke]] >= 0.5;
        const cDecay = Math.exp(-4.6 / (sampleRate * params[slots[P.cdec]] * 0.001));
        const oDecay = Math.exp(-4.6 / (sampleRate * params[slots[P.odec]] * 0.001));
        const clickDecay = Math.exp(-1 / (sampleRate * 0.0015));
        // events: the open hat starts first, so a closed hit on the same row cuts it
        if (pendOpen > 0) { open = pendOpen; choking = false; click = Math.max(click, pendOpen); pendOpen = 0; }
        if (pendClosed > 0) {
          closed = pendClosed; click = Math.max(click, pendClosed); pendClosed = 0;
          if (chokeOn && open > 0) { choking = true; chokeStep = open / (CHOKE_MS * 0.001 * sampleRate); }
        }
        // band-pass around 9 kHz, high-pass at `tone`
        const g = Math.tan(Math.PI * Math.min(0.45, 9000 / sampleRate)), kq = 1 / 0.8;
        const a1 = 1 / (1 + g * (g + kq)), a2 = g * a1, a3 = g * a2;
        const rh = Math.exp(-2 * Math.PI * Math.min(params[slots[P.tone]], sampleRate * 0.45) / sampleRate);
        for (let i = 0; i < n; i++) {
          let metal = 0;
          for (let k = 0; k < 6; k++) {
            const dt = Math.min(0.45, BANK[k] * ratio / sampleRate);
            let p = phase[k] + dt;
            if (p >= 1) p -= 1;
            phase[k] = p;
            metal += (p < 0.5 ? 1 : -1) + polyBlep(p, dt) - polyBlep((p + 0.5) % 1, dt);
          }
          noise ^= noise << 13; noise ^= noise >>> 17; noise ^= noise << 5;
          const amp = closed * clvl + open * olvl;
          const x = metal * amp + snap * click * ((noise >>> 0) / 2147483648 - 1) * 3;
          const v3 = x - ic2, v1 = a1 * ic1 + a2 * v3, v2 = ic2 + a2 * ic1 + a3 * v3;   // trapezoidal state-variable filter: stable at any cutoff
          ic1 = 2 * v1 - ic1; ic2 = 2 * v2 - ic2;
          const bpBand = v1;
          const y1 = bpBand - hp1x + rh * hp1; hp1x = bpBand; hp1 = y1;
          const y2 = y1 - hp2x + rh * hp2; hp2x = y1; hp2 = y2;
          const s = y2 * level;
          outL[i] = s; outR[i] = s;
          closed *= cDecay;
          click *= clickDecay;
          if (choking) { open -= chokeStep; if (open <= 0) { open = 0; choking = false; } } else open *= oDecay;
        }
        if (closed < 1e-6) closed = 0;
        if (open < 1e-6) open = 0;
        if (!Number.isFinite(ic1 + ic2 + hp1 + hp2)) { ic1 = ic2 = hp1 = hp2 = hp1x = hp2x = 0; }
      },
    };
  },
};
