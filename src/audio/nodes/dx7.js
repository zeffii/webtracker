// DX7 voice data: the 32 algorithms, the packed 128-byte voice format of a 32-voice bank (.syx), reading a
// bank or a single voice dump, and a small built-in bank so the node makes sound before you load one.
// Operators are numbered 0..5 here (operator 1 is index 0). The dump stores operator 6 first.

// Each algorithm: carriers (what you hear), mods as [receiver, sender] pairs, fb = [from, to] (the operator whose
// output feeds back, and the one it feeds; usually the same). Written from the DX7 algorithm chart.
const A = (carriers, edges, fb, fbTo = fb) => ({
  carriers: carriers.map(n => n - 1),
  mods: edges.map(([from, to]) => [to - 1, from - 1]),
  fb: [fb - 1, fbTo - 1],
});
export const ALGORITHMS = [
  A([3, 1], [[6, 5], [5, 4], [4, 3], [2, 1]], 6),
  A([3, 1], [[6, 5], [5, 4], [4, 3], [2, 1]], 2),
  A([4, 1], [[6, 5], [5, 4], [3, 2], [2, 1]], 6),
  A([4, 1], [[6, 5], [5, 4], [3, 2], [2, 1]], 4, 6),
  A([5, 3, 1], [[6, 5], [4, 3], [2, 1]], 6),
  A([5, 3, 1], [[6, 5], [4, 3], [2, 1]], 5, 6),
  A([3, 1], [[6, 5], [5, 3], [4, 3], [2, 1]], 6),
  A([3, 1], [[6, 5], [5, 3], [4, 3], [2, 1]], 4),
  A([3, 1], [[6, 5], [5, 3], [4, 3], [2, 1]], 2),
  A([4, 1], [[6, 4], [5, 4], [3, 2], [2, 1]], 3),
  A([4, 1], [[6, 4], [5, 4], [3, 2], [2, 1]], 6),
  A([3, 1], [[6, 3], [5, 3], [4, 3], [2, 1]], 2),
  A([3, 1], [[6, 3], [5, 3], [4, 3], [2, 1]], 6),
  A([3, 1], [[6, 4], [5, 4], [4, 3], [2, 1]], 6),
  A([3, 1], [[6, 4], [5, 4], [4, 3], [2, 1]], 2),
  A([1], [[6, 5], [5, 1], [4, 3], [3, 1], [2, 1]], 6),
  A([1], [[6, 5], [5, 1], [4, 3], [3, 1], [2, 1]], 2),
  A([1], [[6, 5], [5, 4], [4, 1], [3, 1], [2, 1]], 3),
  A([5, 4, 1], [[6, 5], [6, 4], [3, 2], [2, 1]], 6),
  A([4, 2, 1], [[6, 4], [5, 4], [3, 2], [3, 1]], 3),
  A([5, 4, 2, 1], [[6, 5], [6, 4], [3, 2], [3, 1]], 3),
  A([5, 4, 3, 1], [[6, 5], [6, 4], [6, 3], [2, 1]], 6),
  A([5, 4, 2, 1], [[6, 5], [6, 4], [3, 2]], 6),
  A([5, 4, 3, 2, 1], [[6, 5], [6, 4], [6, 3]], 6),
  A([5, 4, 3, 2, 1], [[6, 5], [6, 4]], 6),
  A([4, 2, 1], [[6, 4], [5, 4], [3, 2]], 6),
  A([4, 2, 1], [[6, 4], [5, 4], [3, 2]], 3),
  A([6, 3, 1], [[5, 4], [4, 3], [2, 1]], 5),
  A([5, 3, 2, 1], [[6, 5], [4, 3]], 6),
  A([6, 3, 2, 1], [[5, 4], [4, 3]], 5),
  A([5, 4, 3, 2, 1], [[6, 5]], 6),
  A([6, 5, 4, 3, 2, 1], [], 6),
];

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v | 0));

// A voice as a plain object. ops[k] is operator k+1.
export function blankOp(over = {}) {
  return { r: [99, 99, 99, 99], l: [99, 99, 99, 0], bp: 39, ld: 0, rd: 0, lc: 0, rc: 0, rs: 0, det: 7, ams: 0, kvs: 0, ol: 0, mode: 0, fc: 1, ff: 0, ...over };
}
export function initVoice(over = {}) {
  return { ops: [blankOp({ ol: 99 }), ...Array.from({ length: 5 }, () => blankOp())], pr: [99, 99, 99, 99], pl: [50, 50, 50, 50], alg: 0, fb: 0, oks: 1, lfs: 35, lfd: 0, lpmd: 0, lamd: 0, lks: 1, lfw: 0, pms: 3, trnsp: 24, name: 'INIT VOICE', ...over };
}

// 128 bytes of a bank entry <-> a voice
export function unpackVoice(b, at = 0) {
  const ops = Array(6);
  for (let i = 0; i < 6; i++) {
    const o = at + (5 - i) * 17;   // the dump holds operator 6 first
    ops[i] = {
      r: [b[o] & 127, b[o + 1] & 127, b[o + 2] & 127, b[o + 3] & 127], l: [b[o + 4] & 127, b[o + 5] & 127, b[o + 6] & 127, b[o + 7] & 127],
      bp: b[o + 8] & 127, ld: b[o + 9] & 127, rd: b[o + 10] & 127, lc: b[o + 11] & 3, rc: (b[o + 11] >> 2) & 3,
      rs: b[o + 12] & 7, det: (b[o + 12] >> 3) & 15, ams: b[o + 13] & 3, kvs: (b[o + 13] >> 2) & 7,
      ol: b[o + 14] & 127, mode: b[o + 15] & 1, fc: (b[o + 15] >> 1) & 31, ff: b[o + 16] & 127,
    };
  }
  const g = at + 102;
  let name = '';
  for (let i = 0; i < 10; i++) { const c = b[g + 16 + i] & 127; name += c >= 32 && c < 127 ? String.fromCharCode(c) : ' '; }
  return {
    ops, pr: [b[g], b[g + 1], b[g + 2], b[g + 3]].map(v => v & 127), pl: [b[g + 4], b[g + 5], b[g + 6], b[g + 7]].map(v => v & 127),
    alg: b[g + 8] & 31, fb: b[g + 9] & 7, oks: (b[g + 9] >> 3) & 1, lfs: b[g + 10] & 127, lfd: b[g + 11] & 127, lpmd: b[g + 12] & 127, lamd: b[g + 13] & 127,
    lks: b[g + 14] & 1, lfw: (b[g + 14] >> 1) & 7, pms: (b[g + 14] >> 4) & 7, trnsp: Math.min(48, b[g + 15] & 127), name: name.trimEnd(),
  };
}

export function packVoice(v, out = new Uint8Array(128), at = 0) {
  for (let i = 0; i < 6; i++) {
    const p = v.ops[i], o = at + (5 - i) * 17;
    for (let k = 0; k < 4; k++) { out[o + k] = clamp(p.r[k], 0, 99); out[o + 4 + k] = clamp(p.l[k], 0, 99); }
    out[o + 8] = clamp(p.bp, 0, 99); out[o + 9] = clamp(p.ld, 0, 99); out[o + 10] = clamp(p.rd, 0, 99);
    out[o + 11] = clamp(p.lc, 0, 3) | (clamp(p.rc, 0, 3) << 2);
    out[o + 12] = clamp(p.rs, 0, 7) | (clamp(p.det, 0, 14) << 3);
    out[o + 13] = clamp(p.ams, 0, 3) | (clamp(p.kvs, 0, 7) << 2);
    out[o + 14] = clamp(p.ol, 0, 99);
    out[o + 15] = clamp(p.mode, 0, 1) | (clamp(p.fc, 0, 31) << 1);
    out[o + 16] = clamp(p.ff, 0, 99);
  }
  const g = at + 102;
  for (let k = 0; k < 4; k++) { out[g + k] = clamp(v.pr[k], 0, 99); out[g + 4 + k] = clamp(v.pl[k], 0, 99); }
  out[g + 8] = clamp(v.alg, 0, 31); out[g + 9] = clamp(v.fb, 0, 7) | (clamp(v.oks, 0, 1) << 3);
  out[g + 10] = clamp(v.lfs, 0, 99); out[g + 11] = clamp(v.lfd, 0, 99); out[g + 12] = clamp(v.lpmd, 0, 99); out[g + 13] = clamp(v.lamd, 0, 99);
  out[g + 14] = clamp(v.lks, 0, 1) | (clamp(v.lfw, 0, 5) << 1) | (clamp(v.pms, 0, 7) << 4);
  out[g + 15] = clamp(v.trnsp, 0, 48);
  const name = (v.name ?? '').padEnd(10, ' ');
  for (let i = 0; i < 10; i++) out[g + 16 + i] = name.charCodeAt(i) & 127 || 32;
  return out;
}

export const VOICES = 32;

// A bank (4096 bytes, or the plain list of numbers stored on the node) -> 32 voices. Anything else: the built-in bank.
export function unpackBank(bank) {
  const bytes = bank && bank.length >= VOICES * 128 ? bank : DEFAULT_BANK;
  return Array.from({ length: VOICES }, (_, i) => unpackVoice(bytes, i * 128));
}
export const voiceNames = bank => unpackBank(bank).map(v => v.name);

// Reads a .syx file: a 32-voice bank (4104 bytes, or the bare 4096), or one voice (163 bytes, or the bare 155),
// which becomes the first voice of a bank of the built-in voices. Returns the 4096 bank bytes, or null.
export function parseSyx(file) {
  const b = file instanceof Uint8Array ? file : Uint8Array.from(file);
  let start = 0;
  if (b[0] === 0xf0 && b[1] === 0x43) {
    const format = b[3];
    if (format === 0x09 && b.length >= 6 + 4096) return b.slice(6, 6 + 4096);
    if (format === 0x00 && b.length >= 6 + 155) { start = 6; return bankWithFirst(unpackLong(b, start)); }
    return null;
  }
  if (b.length === 4096) return b.slice();
  if (b.length === 155) return bankWithFirst(unpackLong(b, 0));
  return null;
}
function bankWithFirst(voice) {
  const bank = DEFAULT_BANK.slice();
  packVoice(voice, bank, 0);
  return bank;
}
// the 155-byte single voice layout (21 bytes per operator, operator 6 first)
function unpackLong(b, at) {
  const ops = Array(6);
  for (let i = 0; i < 6; i++) {
    const o = at + (5 - i) * 21;
    ops[i] = { r: [b[o], b[o + 1], b[o + 2], b[o + 3]], l: [b[o + 4], b[o + 5], b[o + 6], b[o + 7]], bp: b[o + 8], ld: b[o + 9], rd: b[o + 10], lc: b[o + 11] & 3, rc: b[o + 12] & 3, rs: b[o + 13] & 7, ams: b[o + 14] & 3, kvs: b[o + 15] & 7, ol: b[o + 16], mode: b[o + 17] & 1, fc: b[o + 18] & 31, ff: b[o + 19], det: b[o + 20] & 15 };
  }
  const g = at + 126;
  let name = '';
  for (let i = 0; i < 10; i++) { const c = b[g + 19 + i] & 127; name += c >= 32 && c < 127 ? String.fromCharCode(c) : ' '; }
  return { ops, pr: [b[g], b[g + 1], b[g + 2], b[g + 3]], pl: [b[g + 4], b[g + 5], b[g + 6], b[g + 7]], alg: b[g + 8], fb: b[g + 9] & 7, oks: b[g + 10] & 1, lfs: b[g + 11], lfd: b[g + 12], lpmd: b[g + 13], lamd: b[g + 14], lks: b[g + 15] & 1, lfw: b[g + 16] & 7, pms: b[g + 17] & 7, trnsp: Math.min(48, b[g + 18]), name: name.trimEnd() };
}

// ---- the built-in bank: a few voices written by hand, the rest the DX7's own "init voice" ----
const ratioOp = (ratio, over) => {
  const fc = Math.floor(ratio), ff = fc ? Math.round((ratio / fc - 1) * 100) : 0;
  return blankOp(ratio < 1 ? { fc: 0, ...over } : { fc, ff, ...over });
};
const handmade = [
  initVoice(),
  initVoice({   // an electric piano: three carrier / modulator pairs, a bright tine on one
    name: 'E.PIANO', alg: 4, fb: 5,
    ops: [
      ratioOp(1, { ol: 99, r: [96, 25, 25, 67], l: [99, 75, 0, 0], kvs: 2 }),
      ratioOp(1, { ol: 58, r: [95, 50, 35, 78], l: [99, 75, 0, 0], kvs: 3, rs: 2 }),
      ratioOp(1, { ol: 99, r: [95, 29, 20, 50], l: [99, 95, 0, 0], det: 8, kvs: 2 }),
      ratioOp(14, { ol: 79, r: [95, 50, 35, 78], l: [99, 75, 0, 0], kvs: 4 }),
      ratioOp(1, { ol: 90, r: [95, 29, 20, 50], l: [99, 95, 0, 0], det: 6, kvs: 2 }),
      ratioOp(1, { ol: 56, r: [95, 33, 20, 50], l: [99, 75, 0, 0], kvs: 3 }),
    ],
  }),
  initVoice({   // a punchy FM bass
    name: 'FM BASS', alg: 0, fb: 5,
    ops: [
      ratioOp(1, { ol: 99, r: [99, 60, 40, 70], l: [99, 90, 80, 0] }),
      ratioOp(1, { ol: 78, r: [99, 70, 40, 70], l: [99, 55, 0, 0] }),
      ratioOp(0.5, { ol: 88, r: [99, 60, 40, 70], l: [99, 90, 80, 0] }),
      ratioOp(1, { ol: 66, r: [99, 75, 40, 70], l: [99, 45, 0, 0] }),
      ratioOp(1, { ol: 0 }),
      ratioOp(1, { ol: 58, r: [99, 80, 40, 70], l: [99, 30, 0, 0] }),
    ],
  }),
  initVoice({   // a struck bell: inharmonic ratios, slow decay
    name: 'BELL', alg: 4, fb: 3,
    ops: [
      ratioOp(1, { ol: 99, r: [99, 30, 25, 40], l: [99, 85, 0, 0] }),
      ratioOp(3.5, { ol: 72, r: [99, 45, 30, 45], l: [99, 60, 0, 0] }),
      ratioOp(2, { ol: 90, r: [99, 33, 25, 40], l: [99, 80, 0, 0] }),
      ratioOp(5.19, { ol: 70, r: [99, 50, 30, 45], l: [99, 55, 0, 0] }),
      ratioOp(4, { ol: 85, r: [99, 36, 25, 40], l: [99, 75, 0, 0] }),
      ratioOp(7.1, { ol: 64, r: [99, 55, 30, 45], l: [99, 50, 0, 0] }),
    ],
  }),
  initVoice({   // an organ: six carriers, drawbars as levels
    name: 'ORGAN', alg: 31, fb: 0,
    ops: [
      ratioOp(0.5, { ol: 90, r: [90, 99, 99, 80], l: [99, 99, 99, 0] }),
      ratioOp(1, { ol: 99, r: [90, 99, 99, 80], l: [99, 99, 99, 0] }),
      ratioOp(2, { ol: 88, r: [90, 99, 99, 80], l: [99, 99, 99, 0] }),
      ratioOp(3, { ol: 70, r: [90, 99, 99, 80], l: [99, 99, 99, 0] }),
      ratioOp(4, { ol: 72, r: [90, 99, 99, 80], l: [99, 99, 99, 0] }),
      ratioOp(6, { ol: 55, r: [90, 99, 99, 80], l: [99, 99, 99, 0] }),
    ],
  }),
];
export const DEFAULT_BANK = (() => {
  const bank = new Uint8Array(VOICES * 128);
  for (let i = 0; i < VOICES; i++) packVoice(handmade[i] ?? initVoice(), bank, i * 128);
  return bank;
})();

// ---- shared maths, used by the engine and by the editor's graphs ----
const OL_LOW = [0, 5, 9, 13, 17, 20, 23, 25, 27, 29, 31, 33, 35, 37, 39, 41, 42, 43, 45, 46];
export const scaleOL = v => (v < 20 ? OL_LOW[v] : v + 28);   // 0..99 -> 0..127 steps of 0.75 dB
export const EXP_SCALE = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 14, 16, 19, 23, 27, 33, 39, 47, 56, 66, 80, 94, 110, 126, 142, 158, 174, 190, 206, 222, 238, 250];
const curveScale = (group, depth, curve) => {
  let scale = curve === 0 || curve === 3 ? (group * depth * 329) >> 12 : (EXP_SCALE[Math.min(group, 32)] * depth * 329) >> 15;
  if (curve < 2) scale = -scale;
  return scale;
};
// the change in output level (in 0.75 dB steps) that keyboard scaling makes at a note, for an operator's settings
export const levelScaling = (note, p) => {
  const offset = note - p.bp - 17;
  return offset >= 0 ? curveScale((offset / 3) | 0, p.rd, p.rc) : curveScale(((-offset) / 3) | 0, p.ld, p.lc);
};

// ---- writing .syx files ----
const checksum = bytes => (-bytes.reduce((a, b) => a + b, 0)) & 127;
export function bankToSyx(bank) {
  const out = new Uint8Array(4104);
  out.set([0xf0, 0x43, 0x00, 0x09, 0x20, 0x00]);
  out.set(Uint8Array.from(bank), 6);
  out[4102] = checksum(out.subarray(6, 4102));
  out[4103] = 0xf7;
  return out;
}
// one voice as a 155-byte single voice dump (21 bytes per operator, operator 6 first)
export function voiceToSyx(v) {
  const d = new Uint8Array(155);
  for (let i = 0; i < 6; i++) {
    const p = v.ops[i], o = (5 - i) * 21;
    d.set([...p.r, ...p.l, p.bp, p.ld, p.rd, p.lc, p.rc, p.rs, p.ams, p.kvs, p.ol, p.mode, p.fc, p.ff, p.det], o);
  }
  d.set([...v.pr, ...v.pl, v.alg, v.fb, v.oks, v.lfs, v.lfd, v.lpmd, v.lamd, v.lks, v.lfw, v.pms, v.trnsp], 126);
  const name = (v.name ?? '').padEnd(10, ' ');
  for (let i = 0; i < 10; i++) d[145 + i] = name.charCodeAt(i) & 127 || 32;
  const out = new Uint8Array(163);
  out.set([0xf0, 0x43, 0x00, 0x00, 0x01, 0x1b]);
  out.set(d, 6);
  out[161] = checksum(d);
  out[162] = 0xf7;
  return out;
}
