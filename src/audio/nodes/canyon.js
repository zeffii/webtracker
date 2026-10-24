// Prisma Canyon (the `prismacanyon` node): a tape echo with four playback heads. One tape loop is recorded and four heads read it at 1, 2, 3 and 4
// times the repeat `time` (so every echo falls on a multiple of it, which on a song with ticks is a grid). Each head is its own
// delay line with a level (0 switches it off), a pan, and a darkening: the line's low-pass sits at `cutoff` lowered by `damp`
// (0 leaves it, 1 takes it four octaves down), so the far lines can be soft and the near ones bright.
//   intensity   how much of the heads goes back to the tape (past 1 it feeds on itself, held in check by the saturation)
//   bass, treble  tone of the sound that goes round the loop, so each repeat is warmer or thinner than the one before
//   echo, reverb, dry   the volume of the echoes, of a small spring-like reverb of the input, and of the input itself
//   wow, flutter  the tape speed drifting slowly and shivering; saturation  the tape squashing what is recorded
// Changing `time` moves the tape speed, so the echoes bend in pitch as it moves, as a tape echo does.
const TIME = 0, INTENSITY = 1, CUTOFF = 2, BASS = 3, TREBLE = 4, ECHO = 5, REVERB = 6, DRY = 7, WOW = 8, FLUTTER = 9, SATURATION = 10, LINE = 11;   // then level, pan, damp for each line
export const LINES = 4, MAX_TIME_MS = 700;
const PER = 3;

const LEVELS = [1, 0.7, 0.5, 0.35], PANS = [-0.7, 0.7, -0.35, 0.35], DAMPS = [0.1, 0.25, 0.4, 0.55];

// How loud the recording is, and the echoes of each line, `count` repeat-times along (the same sum the node runs): r[m] is the tape at
// m repeat-times for a click recorded at 0, and line k plays r[m - k] at m. Used by the view and the tests.
export function repeats({ levels, intensity }, count) {
  const sum = levels.reduce((a, b) => a + b, 0), w = levels.map(l => (sum > 1e-6 ? l / sum : 0)), r = new Float64Array(count + 1);
  r[0] = 1;
  for (let m = 1; m <= count; m++) { let v = 0; for (let k = 1; k <= Math.min(LINES, m); k++) v += w[k - 1] * r[m - k]; r[m] = intensity * v; }
  return r;
}

// The cutoff of a line in Hz.
export const lineCutoff = (cutoff, damp) => cutoff * Math.pow(2, -4 * damp);

const lineParams = () => Array.from({ length: LINES }, (_, k) => [
  { name: `level${k + 1}`, min: 0, max: 1, def: LEVELS[k] },
  { name: `pan${k + 1}`, min: -1, max: 1, def: PANS[k] },
  { name: `damp${k + 1}`, min: 0, max: 1, def: DAMPS[k] },
]).flat();

class Shelf {
  b0 = 1; b1 = 0; b2 = 0; a1 = 0; a2 = 0; x1 = 0; x2 = 0; y1 = 0; y2 = 0;
  // RBJ shelf: high or low, gain in dB
  set(high, f, db, sr) {
    const A = Math.pow(10, db / 40), w = 2 * Math.PI * Math.min(f, sr * 0.45) / sr, cs = Math.cos(w), sn = Math.sin(w), al = sn / 2 * Math.SQRT2, t = 2 * Math.sqrt(A) * al;
    let b0, b1, b2, a0, a1, a2;
    if (high) { b0 = A * ((A + 1) + (A - 1) * cs + t); b1 = -2 * A * ((A - 1) + (A + 1) * cs); b2 = A * ((A + 1) + (A - 1) * cs - t); a0 = (A + 1) - (A - 1) * cs + t; a1 = 2 * ((A - 1) - (A + 1) * cs); a2 = (A + 1) - (A - 1) * cs - t; }
    else { b0 = A * ((A + 1) - (A - 1) * cs + t); b1 = 2 * A * ((A - 1) - (A + 1) * cs); b2 = A * ((A + 1) - (A - 1) * cs - t); a0 = (A + 1) + (A - 1) * cs + t; a1 = -2 * ((A - 1) + (A + 1) * cs); a2 = (A + 1) + (A - 1) * cs - t; }
    this.b0 = b0 / a0; this.b1 = b1 / a0; this.b2 = b2 / a0; this.a1 = a1 / a0; this.a2 = a2 / a0;
  }
  run(x) {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1; this.x1 = x; this.y2 = this.y1; this.y1 = Math.abs(y) < 1e-20 ? 0 : y;
    return y;
  }
}

// A small reverb of the input, in the manner of a spring tank: four damped combs into two allpasses, a little different for each side.
class Verb {
  constructor(sr, side) {
    const scale = sr / 44100, c = [1557, 1617, 1491, 1422].map(n => Math.round((n + side * 23) * scale)), a = [225, 556].map(n => Math.round((n + side * 11) * scale));
    this.combs = c.map(n => ({ buf: new Float32Array(n), i: 0, lp: 0 }));
    this.aps = a.map(n => ({ buf: new Float32Array(n), i: 0 }));
  }
  run(x) {
    let sum = 0;
    for (const c of this.combs) {
      const y = c.buf[c.i];
      c.lp += (y - c.lp) * 0.45;
      c.buf[c.i] = x + c.lp * 0.82;
      if (++c.i === c.buf.length) c.i = 0;
      sum += y;
    }
    let v = sum * 0.25;
    for (const p of this.aps) {
      const y = p.buf[p.i], o = y - v;
      p.buf[p.i] = v + y * 0.5;
      if (++p.i === p.buf.length) p.i = 0;
      v = o;
    }
    return v;
  }
}

export default {
  type: 'prismacanyon',
  inputs: ['in'],
  outputs: ['out'],
  category: 'Effects',
  kinds: { in: 'stereo', out: 'stereo' },
  shape: 'box',
  glyph: 'prismacanyon',
  editor: 'canyon',   // the patcher panel draws the echoes against the song's ticks
  params: [
    { name: 'time', min: 20, max: MAX_TIME_MS, def: 300 },    // ms: the first head; the others are at 2, 3 and 4 times it
    { name: 'intensity', min: 0, max: 1.15, def: 0.45 },
    { name: 'cutoff', min: 800, max: 18000, def: 9000 },      // Hz: the brightest a line gets
    { name: 'bass', min: -12, max: 12, def: 0 },              // dB
    { name: 'treble', min: -12, max: 12, def: 0 },            // dB
    { name: 'echo', min: 0, max: 1.5, def: 0.7 },
    { name: 'reverb', min: 0, max: 1, def: 0 },
    { name: 'dry', min: 0, max: 1, def: 1 },
    { name: 'wow', min: 0, max: 1, def: 0.25 },
    { name: 'flutter', min: 0, max: 1, def: 0.25 },
    { name: 'saturation', min: 0, max: 1, def: 0.3 },
    ...lineParams(),
  ],
  create({ sampleRate: sr }) {
    const size = Math.ceil(sr * (LINES * MAX_TIME_MS + 30) / 1000) + 8;
    const tape = [new Float32Array(size), new Float32Array(size)];
    const lp = Array.from({ length: LINES }, () => [[0, 0], [0, 0]]);   // per line, per channel, two poles
    const shelves = [0, 1].map(() => ({ bass: new Shelf(), treble: new Shelf() }));
    const verb = [new Verb(sr, 0), new Verb(sr, 1)];
    const dc = [0, 0], dcx = [0, 0], X = new Float64Array(2), O = new Float64Array(2), REC = new Float64Array(2);   // kept here so a sample allocates nothing
    let w = 0, d = -1, wowPh = 0, flPh = 0, flPh2 = 0, flNz = 0, wowNz = 0, seed = 0x9e3779b9;
    const rand = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 4294967296 * 2 - 1; };
    const slew = 1 - Math.exp(-1 / (sr * 0.08)), nzA = 1 - Math.exp(-2 * Math.PI * 1.2 / sr), flA = 1 - Math.exp(-2 * Math.PI * 25 / sr);
    const pole = f => 1 - Math.exp(-2 * Math.PI * Math.min(f, sr * 0.45) / sr);
    const a = new Float64Array(LINES), gl = new Float64Array(LINES), gr = new Float64Array(LINES), pa = new Float64Array(LINES), wgt = new Float64Array(LINES);
    return {
      process(inputs, outputs, n, params, slots) {
        const [inL, inR] = inputs[0], [outL, outR] = outputs[0];
        const g = k => params[slots[k]];
        const target = Math.min(MAX_TIME_MS, Math.max(20, g(TIME))) * 0.001 * sr;
        if (d < 0) d = target;
        const c = g(INTENSITY), echo = g(ECHO), rev = g(REVERB), dry = g(DRY), sat = 1 + g(SATURATION) * 2.5, cutoff = g(CUTOFF);
        const wowMs = 1.8 * g(WOW), flMs = 0.12 * g(FLUTTER);
        let sum = 0;
        for (let k = 0; k < LINES; k++) {
          a[k] = g(LINE + k * PER); sum += a[k];
          const p = g(LINE + k * PER + 1);
          gl[k] = a[k] * Math.min(1, 1 - p) * echo; gr[k] = a[k] * Math.min(1, 1 + p) * echo;   // the pan only shapes what is heard; the loop gets the line as it is
          pa[k] = pole(lineCutoff(cutoff, g(LINE + k * PER + 2)));
        }
        for (let k = 0; k < LINES; k++) wgt[k] = sum > 1e-6 ? a[k] / sum : 0;
        for (const s of shelves) { s.bass.set(false, 150, g(BASS), sr); s.treble.set(true, 3500, g(TREBLE), sr); }
        for (let i = 0; i < n; i++) {
          d += (target - d) * slew;
          wowPh += 0.55 / sr; if (wowPh > 1) wowPh -= 1;
          flPh += 7.3 / sr; if (flPh > 1) flPh -= 1;
          flPh2 += 11.9 / sr; if (flPh2 > 1) flPh2 -= 1;
          wowNz += (rand() - wowNz) * nzA; flNz += (rand() - flNz) * flA;
          const mod = (Math.sin(2 * Math.PI * wowPh) * 0.7 + wowNz * 2.5 * 0.3) * wowMs * 0.001 * sr + (Math.sin(2 * Math.PI * flPh) * 0.6 + Math.sin(2 * Math.PI * flPh2) * 0.35 + flNz * 0.9 * 0.3) * flMs * 0.001 * sr;
          X[0] = inL[i]; X[1] = inR[i];
          for (let ch = 0; ch < 2; ch++) {
            const buf = tape[ch];
            let fb = 0, bus = 0;
            for (let k = 0; k < LINES; k++) {
              if (a[k] === 0 && wgt[k] === 0) continue;
              let r = w - d * (k + 1) - mod;
              while (r < 0) r += size;
              const j = r | 0, f = r - j, j1 = j + 1 === size ? 0 : j + 1;
              let v = buf[j] + (buf[j1] - buf[j]) * f;
              const s = lp[k][ch];
              s[0] += (v - s[0]) * pa[k]; s[1] += (s[0] - s[1]) * pa[k]; v = s[1];
              fb += v * wgt[k];
              bus += v * (ch ? gr[k] : gl[k]);
            }
            let loop = shelves[ch].treble.run(shelves[ch].bass.run(fb)) * c;
            const hp = loop - dcx[ch] + 0.995 * dc[ch]; dcx[ch] = loop; dc[ch] = hp; loop = hp;
            const v = X[ch] + loop;
            REC[ch] = Math.tanh(sat * v) / sat;
            O[ch] = bus;
          }
          const m = (X[0] + X[1]) * 0.5 * 0.3;
          const rl = rev > 0 ? verb[0].run(m) * rev : 0, rr = rev > 0 ? verb[1].run(m) * rev : 0;
          tape[0][w] = Math.abs(REC[0]) < 1e-20 ? 0 : REC[0]; tape[1][w] = Math.abs(REC[1]) < 1e-20 ? 0 : REC[1];
          if (++w === size) w = 0;
          outL[i] = X[0] * dry + O[0] + rl;
          outR[i] = X[1] * dry + O[1] + rr;
        }
      },
    };
  },
};
