// Builds a small ProTracker module in memory, for the tests: no real MOD files are needed.
// samples: [{ name?, data: Int8-ish array, volume?, finetune?, loopStart?, loopLength? }] (loops in bytes), orders: [pattern numbers],
// patterns: [ rows ] where each row is an array of channel cells [period, sample, effect, param] (rows missing are empty).
export function makeMod({ title = 'test', samples = [], orders = [0], patterns = [[]], channels = 4 }) {
  const parts = [];
  const head = new Uint8Array(1084);
  [...title].slice(0, 20).forEach((c, i) => { head[i] = c.charCodeAt(0); });
  for (let i = 0; i < 31; i++) {
    const s = samples[i], o = 20 + i * 30;
    if (!s) continue;
    [...(s.name ?? '')].slice(0, 22).forEach((c, k) => { head[o + k] = c.charCodeAt(0); });
    const words = Math.floor(s.data.length / 2);
    head[o + 22] = words >> 8; head[o + 23] = words & 255;
    head[o + 24] = (s.finetune ?? 0) & 15; head[o + 25] = s.volume ?? 64;
    const ls = (s.loopStart ?? 0) / 2, ll = (s.loopLength ?? 0) / 2 || 1;
    head[o + 26] = ls >> 8; head[o + 27] = ls & 255; head[o + 28] = ll >> 8; head[o + 29] = ll & 255;
  }
  head[950] = orders.length; head[951] = 127;
  orders.forEach((p, i) => { head[952 + i] = p; });
  [...(channels === 4 ? 'M.K.' : `${channels}CHN`)].forEach((c, i) => { head[1080 + i] = c.charCodeAt(0); });
  parts.push(head);
  for (const rows of patterns) {
    const pat = new Uint8Array(64 * channels * 4);
    rows.forEach((row, r) => row.forEach((cell, c) => {
      if (!cell) return;
      const [period, sample, effect, param] = [cell[0] ?? 0, cell[1] ?? 0, cell[2] ?? 0, cell[3] ?? 0];
      const o = (r * channels + c) * 4;
      pat[o] = (sample & 0xf0) | (period >> 8); pat[o + 1] = period & 255; pat[o + 2] = ((sample & 15) << 4) | effect; pat[o + 3] = param;
    }));
    parts.push(pat);
  }
  for (let i = 0; i < 31; i++) if (samples[i]) parts.push(Uint8Array.from(samples[i].data, v => v & 255));
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out.buffer;
}
