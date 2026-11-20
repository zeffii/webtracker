// Builds a small Impulse Tracker module in memory, for the tests: no real IT files are needed.
// patterns: [{ rows: count, data: rows }], a row being an array of channel cells [note, ins, vol, effect, param]; note -1 (or
// missing) and vol -1 (or missing) are absent, ins 0 and effect 0 too. Notes are 0 (C-0) to 119, 254 the cut, 255 the key off.
// instruments: [{ name?, nna?, dct?, dca?, fade?, pps?, ppc?, gbv?, dfp?, ifc?, ifr?, map? (sample numbers, 1-based, 0 none; a
// number fills all 120), notes?, vol?, pan?, pit? : { pts: [tick, value, ...], ls?, le?, ss?, se?, filter? } }]
// samples: [{ name?, data (numbers in -1..1), sixteen?, stereo?, right?, volume?, gvl?, c5?, dfp?, loop?: [a, b], sus?: [a, b],
//   pingpong?, susPingpong?, vib?: [speed, depth, rate, type] }]
const u16 = n => [n & 255, (n >> 8) & 255];
const u32 = n => [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255];
const ascii = (s, n) => Array.from({ length: n }, (_, i) => (i < s.length ? s.charCodeAt(i) : 0));

function packPattern(p) {
  const rows = p.rows ?? 64, out = [];
  for (let r = 0; r < rows; r++) {
    (p.data?.[r] ?? []).forEach((cell, c) => {
      if (!cell) return;
      const [note = -1, ins = 0, vol = -1, effect = 0, param = 0] = cell;
      const fields = [];
      let mask = 0;
      if (note >= 0) { mask |= 1; fields.push(note); }
      if (ins) { mask |= 2; fields.push(ins); }
      if (vol >= 0) { mask |= 4; fields.push(vol); }
      if (effect) { mask |= 8; fields.push(effect, param); }
      if (mask) out.push((c + 1) | 128, mask, ...fields);
    });
    out.push(0);
  }
  return [...u16(out.length), ...u16(rows), 0, 0, 0, 0, ...out];
}

function envelope(env, centred) {
  const out = new Array(82).fill(0);
  if (!env) return out;
  const count = env.pts.length / 2;
  out[0] = 1 | (env.ls >= 0 && env.ls !== undefined ? 2 : 0) | (env.ss !== undefined && env.ss >= 0 ? 4 : 0) | (env.filter ? 0x80 : 0);
  out[1] = count; out[2] = env.ls ?? 0; out[3] = env.le ?? 0; out[4] = env.ss ?? 0; out[5] = env.se ?? 0;
  for (let i = 0; i < count; i++) {
    const v = env.pts[i * 2 + 1] - (centred ? 32 : 0);
    out[6 + i * 3] = v & 255; out[7 + i * 3] = env.pts[i * 2] & 255; out[8 + i * 3] = (env.pts[i * 2] >> 8) & 255;
  }
  return out;
}

function instrumentBytes(i) {
  const out = [...ascii('IMPI', 4), ...ascii('', 12), 0, i.nna ?? 0, i.dct ?? 0, i.dca ?? 0, ...u16(i.fade ?? 0), (i.pps ?? 0) & 255, i.ppc ?? 60, i.gbv ?? 128, i.dfp ?? 128, 0, 0, ...u16(0x200), 0, 0,
    ...ascii(i.name ?? '', 26), i.ifc ?? 0, i.ifr ?? 0, 0, 0, ...u16(0)];
  const map = typeof i.map === 'number' ? new Array(120).fill(i.map) : i.map ?? new Array(120).fill(1);
  for (let n = 0; n < 120; n++) out.push(i.notes?.[n] ?? n, map[n] ?? 0);
  out.push(...envelope(i.vol, false), ...envelope(i.pan, true), ...envelope(i.pit, true), 0, 0, 0, 0);
  return out;
}

export function makeIt({ title = '', speed = 6, bpm = 125, gv = 128, flags = 4 | 8, orders = [0], patterns = [{}], instruments = [], samples = [], chanPan, chanVol } = {}) {
  const head = [...ascii('IMPM', 4), ...ascii(title, 26), 0, 0, ...u16(orders.length), ...u16(instruments.length), ...u16(samples.length), ...u16(patterns.length),
    ...u16(0x217), ...u16(0x217), ...u16(flags), ...u16(0), gv, 48, speed, bpm, 128, 0, ...u16(0), ...u32(0), ...u32(0)];
  const pans = Array.from({ length: 64 }, (_, c) => chanPan?.[c] ?? 32), vols = Array.from({ length: 64 }, (_, c) => chanVol?.[c] ?? 64);
  const tables = [...head, ...pans, ...vols, ...orders];
  const listLength = (instruments.length + samples.length + patterns.length) * 4;
  let at = tables.length + listLength;
  const blocks = [], insAt = [], smpAt = [], patAt = [];
  for (const i of instruments) { insAt.push(at); const b = instrumentBytes(i); blocks.push(b); at += b.length; }
  const sampleHeaderAt = at;
  at += samples.length * 80;
  for (const p of patterns) { patAt.push(at); const b = packPattern(p); blocks.push(b); at += b.length; }
  const dataBlocks = [], dataAt = [];
  for (const s of samples) {
    dataAt.push(at);
    const out = [];
    for (const channel of [s.data, ...(s.stereo ? [s.right] : [])]) {
      for (const v of channel) {
        if (s.sixteen) out.push(...u16(Math.round(Math.max(-1, Math.min(1, v)) * 32767) & 0xffff));
        else out.push(Math.round(Math.max(-1, Math.min(1, v)) * 127) & 255);
      }
    }
    dataBlocks.push(out); at += out.length;
  }
  const sampleHeaders = samples.map((s, k) => {
    smpAt.push(sampleHeaderAt + k * 80);
    const flag = 1 | (s.sixteen ? 2 : 0) | (s.stereo ? 4 : 0) | (s.loop ? 16 : 0) | (s.sus ? 32 : 0) | (s.pingpong ? 64 : 0) | (s.susPingpong ? 128 : 0);
    return [...ascii('IMPS', 4), ...ascii('', 12), 0, s.gvl ?? 64, flag, s.volume ?? 64, ...ascii(s.name ?? '', 26), 1, s.dfp ?? 0, ...u32(s.data.length),
      ...u32(s.loop?.[0] ?? 0), ...u32(s.loop?.[1] ?? 0), ...u32(s.c5 ?? 8363), ...u32(s.sus?.[0] ?? 0), ...u32(s.sus?.[1] ?? 0), ...u32(dataAt[k]), ...(s.vib ?? [0, 0, 0, 0])];
  });
  const list = [...insAt, ...smpAt, ...patAt].flatMap(u32);
  return new Uint8Array([...tables, ...list, ...blocks.slice(0, instruments.length).flat(), ...sampleHeaders.flat(), ...blocks.slice(instruments.length).flat(), ...dataBlocks.flat()]).buffer;
}
