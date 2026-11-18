// Builds a small FastTracker 2 module in memory, for the tests: no real XM files are needed.
// patterns: [ rows ] or [{ rows: count, data: rows }], where each row is an array of channel cells [note, ins, vol, effect, param]
// (rows and cells missing are empty; a cell given as { raw: [...] } is written unpacked).
// instruments: [{ name?, map? (96 sample numbers), vol?: { pts, sus?, ls?, le? }, pan?, fade?, vib?, samples: [{ data (numbers in
// -1..1), sixteen?, volume?, finetune?, pan?, relNote?, loopType?, loopStart?, loopLength? (in samples) }] }].
const u16 = n => [n & 255, (n >> 8) & 255];
const u32 = n => [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255];
const ascii = (s, n) => Array.from({ length: n }, (_, i) => (i < s.length ? s.charCodeAt(i) : 0));

function packRow(row, channels) {
  const out = [];
  for (let c = 0; c < channels; c++) {
    const cell = row?.[c];
    if (cell?.raw) { out.push(...cell.raw); continue; }
    const [note, ins, vol, effect, param] = [cell?.[0] ?? 0, cell?.[1] ?? 0, cell?.[2] ?? 0, cell?.[3] ?? 0, cell?.[4] ?? 0];
    const fields = [note, ins, vol, effect, param];
    let bits = 0x80;
    fields.forEach((v, i) => { if (v) bits |= 1 << i; });
    out.push(bits, ...fields.filter(v => v));
  }
  return out;
}

function envelopeBytes(env) {
  const pts = [];
  for (let i = 0; i < 12; i++) pts.push(...u16(env?.pts?.[i * 2] ?? 0), ...u16(env?.pts?.[i * 2 + 1] ?? 0));
  return pts;
}
const envType = env => (env ? 1 | (env.sus >= 0 ? 2 : 0) | (env.ls >= 0 ? 4 : 0) : 0);

function sampleBytes(s) {
  const out = [];
  let old = 0;
  for (const v of s.data) {
    if (s.sixteen) { const n = Math.max(-32768, Math.min(32767, Math.round(v * 32768))); out.push(...u16((n - old) & 0xffff)); old = n; }
    else { const n = Math.max(-128, Math.min(127, Math.round(v * 128))); out.push((n - old) & 255); old = n; }
  }
  return out;
}

export function makeXm({ title = 'test', channels = 4, linear = true, speed = 6, bpm = 125, orders = [0], patterns = [[]], instruments = [] }) {
  const bytes = [];
  bytes.push(...ascii('Extended Module: ', 17), ...ascii(title, 20), 0x1a, ...ascii('FastTracker v2.00', 20), ...u16(0x0104));
  bytes.push(...u32(276), ...u16(orders.length), ...u16(0), ...u16(channels), ...u16(patterns.length), ...u16(instruments.length), ...u16(linear ? 1 : 0), ...u16(speed), ...u16(bpm));
  bytes.push(...Array.from({ length: 256 }, (_, i) => orders[i] ?? 0));
  for (const p of patterns) {
    const count = Array.isArray(p) ? 64 : p.rows, rows = Array.isArray(p) ? p : p.data;
    const data = [];
    for (let r = 0; r < count; r++) data.push(...packRow(rows[r], channels));
    bytes.push(...u32(9), 0, ...u16(count), ...u16(data.length), ...data);
  }
  for (const inst of instruments) {
    const samples = inst.samples ?? [];
    const head = [...ascii(inst.name ?? '', 22), 0, ...u16(samples.length)];
    if (!samples.length) { bytes.push(...u32(29), ...head); continue; }
    const vol = inst.vol, pan = inst.pan;
    head.push(...u32(40), ...(inst.map ?? new Array(96).fill(0)), ...envelopeBytes(vol), ...envelopeBytes(pan),
      vol ? vol.pts.length / 2 : 0, pan ? pan.pts.length / 2 : 0,
      vol?.sus ?? 0, vol?.ls ?? 0, vol?.le ?? 0, pan?.sus ?? 0, pan?.ls ?? 0, pan?.le ?? 0,
      envType(vol), envType(pan), ...(inst.vib ?? [0, 0, 0, 0]), ...u16(inst.fade ?? 0), 0, 0);
    while (head.length < 263 - 4) head.push(0);
    bytes.push(...u32(263), ...head);
    const datas = samples.map(sampleBytes);
    samples.forEach((s, k) => {
      const unit = s.sixteen ? 2 : 1;
      bytes.push(...u32(datas[k].length), ...u32((s.loopStart ?? 0) * unit), ...u32((s.loopLength ?? 0) * unit),
        s.volume ?? 64, (s.finetune ?? 0) & 255, (s.loopType ?? 0) | (s.sixteen ? 16 : 0), s.pan ?? 128, (s.relNote ?? 0) & 255, 0, ...ascii(s.name ?? '', 22));
    });
    for (const d of datas) bytes.push(...d);
  }
  return Uint8Array.from(bytes).buffer;
}
