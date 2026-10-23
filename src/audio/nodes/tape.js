// Tape, stereo: what a recording on tape does to a sound. `type` picks the kind of tape and machine, `age` how worn it is.
//   studio reel      a clean, fast machine: a little warmth, barely any wobble or hiss
//   chrome cassette  a good cassette: bright, a touch of wobble
//   ferric cassette  an ordinary cassette: duller, warm low end, a steady hiss
//   worn cassette    a tired tape on a tired machine: dark, wobbling, hissy, with dropouts
//   dictaphone       a speech recorder: only the middle of the sound survives, a lot of wobble
//   dubbed copy      a copy of a copy: dark, saturated, hissy, with its wobble doubled
// What it does, in the order the sound meets it: wow (slow pitch drift, shared by both channels) and flutter (fast, a little
// different in each) by a moving delay; a low cut; tape saturation (`drive`; it squashes and adds harmonics as it gets louder);
// the head bump (a low boost); the loss of highs (`tone` moves it, `age` lowers it); dropouts (short dips in level and
// brightness, in each channel on its own); and hiss. `mix` blends with the clean sound, which is delayed to match.
const TYPE = 0, AGE = 1, DRIVE = 2, WOW = 3, FLUTTER = 4, HISS = 5, DROP = 6, TONE = 7, MIX = 8;

//          highs Hz, low cut Hz, bump Hz, bump dB, drive, hiss dB, wow, flutter, dropouts, poles of the high loss
const KINDS = [
  { fc: 19000, hpf: 20, bumpHz: 70, bumpDb: 1.2, drive: 0.6, hiss: -72, wow: 0.25, flutter: 0.25, drop: 0.15, poles: 2 },
  { fc: 15000, hpf: 25, bumpHz: 80, bumpDb: 1.5, drive: 0.8, hiss: -64, wow: 0.5, flutter: 0.6, drop: 0.3, poles: 2 },
  { fc: 11000, hpf: 30, bumpHz: 90, bumpDb: 2.2, drive: 1.0, hiss: -56, wow: 0.7, flutter: 0.8, drop: 0.5, poles: 2 },
  { fc: 6500, hpf: 40, bumpHz: 100, bumpDb: 2.5, drive: 1.2, hiss: -48, wow: 1.0, flutter: 1.0, drop: 1.0, poles: 2 },
  { fc: 3400, hpf: 280, bumpHz: 420, bumpDb: 3.0, drive: 1.4, hiss: -42, wow: 1.2, flutter: 1.3, drop: 0.8, poles: 3 },
  { fc: 7500, hpf: 35, bumpHz: 90, bumpDb: 2.5, drive: 1.6, hiss: -46, wow: 0.9, flutter: 1.1, drop: 0.9, poles: 3 },
];
const SIZE = 4096, MASK = SIZE - 1;
const CENTRE_MS = 4.5, WOW_MS = 2.6, FLUTTER_MS = 0.12;   // the fixed delay, and the most the wobble moves it

export default {
  type: 'tape',
  inputs: ['in'],
  outputs: ['out'],
  category: 'Effects',
  kinds: { in: 'stereo', out: 'stereo' },
  shape: 'box',
  glyph: 'tape',
  params: [
    { name: 'type', min: 0, max: 5, def: 2, int: true },
    { name: 'age', min: 0, max: 1, def: 0.4 },
    { name: 'drive', min: 0, max: 1, def: 0.35 },
    { name: 'wow', min: 0, max: 1, def: 0.5 },
    { name: 'flutter', min: 0, max: 1, def: 0.5 },
    { name: 'hiss', min: 0, max: 1, def: 0.5 },
    { name: 'dropouts', min: 0, max: 1, def: 0.3 },
    { name: 'tone', min: -1, max: 1, def: 0 },
    { name: 'mix', min: 0, max: 1, def: 1 },
  ],
  create({ sampleRate: sr, maxBlock }) {
    const pole = fc => 1 - Math.exp(-2 * Math.PI * Math.min(fc, sr * 0.45) / sr);
    const wowArr = new Float32Array(maxBlock);
    const lpa = pole(1.2), norm = 1 / (3 * Math.sqrt((1 / 3) * lpa / (2 - lpa)));
    let wowPh = 0, wowNz = 0, seed = 0x2545f491;
    const rand = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 4294967296; };
    const channel = side => {
      const buf = new Float32Array(SIZE);
      let w = 0, hp = 0, hx1 = 0, hx2 = 0, hy1 = 0, hy2 = 0, p1 = 0, p2 = 0, p3 = 0, d2 = 0, lp2 = 0, nzLp = 0, hissLp = 0, dropLeft = 0, dropDepth = 0, drop = 0;
      let flPh = side * 1.7, flPh2 = side * 0.9, flNz = 0, dc = 0;
      const flA = pole(25), flNorm = 1 / (3 * Math.sqrt((1 / 3) * flA / (2 - flA)));
      const centre = Math.round(CENTRE_MS * 0.001 * sr);
      return (inp, out, n, P) => {
        for (let i = 0; i < n; i++) {
          const x = inp[i];
          buf[w] = x;
          // the moving delay: wow from the shared array, flutter of its own
          flPh += 7.3 / sr; flPh2 += 11.9 / sr; if (flPh > 1) flPh -= 1; if (flPh2 > 1) flPh2 -= 1;
          flNz += (rand() * 2 - 1 - flNz) * flA;
          const flut = (Math.sin(2 * Math.PI * flPh) * 0.6 + Math.sin(2 * Math.PI * flPh2) * 0.35 + flNz * flNorm * 0.3) * P.flutMs;
          const d = Math.max(2, (CENTRE_MS + wowArr[i] * P.wowMs + flut) * 0.001 * sr);
          const pos = w - d, i0 = Math.floor(pos), f = pos - i0;
          const ym = buf[(i0 - 1) & MASK], y0 = buf[i0 & MASK], y1 = buf[(i0 + 1) & MASK], y2 = buf[(i0 + 2) & MASK];
          const c1 = 0.5 * (y1 - ym), c2 = ym - 2.5 * y0 + 2 * y1 - 0.5 * y2, c3 = 0.5 * (y2 - ym) + 1.5 * (y0 - y1);
          let y = ((c3 * f + c2) * f + c1) * f + y0;
          const dry = buf[(w - centre) & MASK];
          w = (w + 1) & MASK;
          // low cut, saturation
          hp += (y - hp) * P.hpA; y -= hp;
          y = (Math.tanh(P.gain * y + P.bias) - P.biasT) * P.makeup;
          // the head bump
          const b = P.b0 * y + P.b1 * hx1 + P.b2 * hx2 - P.a1 * hy1 - P.a2 * hy2;
          hx2 = hx1; hx1 = y; hy2 = hy1; hy1 = b; y = b;
          // the loss of highs
          p1 += (y - p1) * P.lossA; y = p1;
          p2 += (y - p2) * P.lossA; y = p2;
          if (P.poles === 3) { p3 += (y - p3) * P.lossA; y = p3; }
          // dropouts: now and then the level dips for a few ms, and the highs go with it
          if (P.dropP > 0 && dropLeft <= 0 && rand() < P.dropP) { dropLeft = (0.005 + rand() * 0.04) * sr; dropDepth = 0.3 + rand() * 0.6; }
          drop += ((dropLeft > 0 ? dropDepth : 0) - drop) * P.dropA;
          dropLeft--;
          if (drop > 1e-4) { lp2 += (y - lp2) * P.lossB; y = (y + (lp2 - y) * drop) * (1 - 0.6 * drop); } else lp2 = y;
          // hiss, brighter than white and limited by the same machine
          nzLp += (rand() * 2 - 1 - nzLp) * 0.1;
          const nz = (rand() * 2 - 1) - nzLp;
          hissLp += (nz - hissLp) * P.hissA;
          y += hissLp * P.hissGain;
          out[i] = dry + (y - dry) * P.mix;
        }
      };
    };
    const left = channel(0), right = channel(1);
    return {
      process(inputs, outputs, n, params, slots) {
        const [inL, inR] = inputs[0], [outL, outR] = outputs[0];
        const g = k => params[slots[k]];
        const kind = KINDS[Math.max(0, Math.min(KINDS.length - 1, Math.round(g(TYPE))))];
        const age = g(AGE), wear = 0.35 + 0.65 * age;
        // the wow: a slow sine and a slow random drift, the same for both channels
        const wowRate = 0.55 / sr;
        for (let i = 0; i < n; i++) {
          wowPh += wowRate; if (wowPh > 1) wowPh -= 1;
          wowNz += (rand() * 2 - 1 - wowNz) * lpa;
          wowArr[i] = Math.max(-1, Math.min(1, Math.sin(2 * Math.PI * wowPh) * 0.65 + wowNz * norm * 0.35));
        }
        const fc = Math.max(700, kind.fc * (1 - 0.65 * age) * Math.pow(2, g(TONE) * 1.2));
        const driveG = 1 + g(DRIVE) * kind.drive * 5, bias = 0.08 * g(DRIVE);
        // peaking filter for the head bump (RBJ cookbook)
        const A = Math.pow(10, kind.bumpDb / 40), w0 = 2 * Math.PI * kind.bumpHz / sr, al = Math.sin(w0) / (2 * 0.9), cw = Math.cos(w0), a0 = 1 + al / A;
        const P = {
          flutMs: FLUTTER_MS * g(FLUTTER) * kind.flutter * wear, wowMs: WOW_MS * g(WOW) * kind.wow * wear,
          hpA: pole(kind.hpf), gain: driveG, bias, biasT: Math.tanh(bias), makeup: 1 / Math.sqrt(driveG),
          b0: (1 + al * A) / a0, b1: -2 * cw / a0, b2: (1 - al * A) / a0, a1: -2 * cw / a0, a2: (1 - al / A) / a0,
          lossA: pole(fc), lossB: pole(1200), poles: kind.poles,
          dropP: g(DROP) * kind.drop * (0.1 + 3.5 * age) / sr, dropA: pole(160),
          hissA: pole(fc * 1.3), hissGain: Math.pow(10, kind.hiss / 20) * g(HISS) * 2 * (0.6 + 0.8 * age) * 1.7,
          mix: g(MIX),
        };
        left(inL, outL, n, P);
        right(inR, outR, n, P);
      },
    };
  },
};
