import { noteToken } from '../seq/cells.js';
import { synthKinds, ensureMaster } from '../instruments.js';
import { PERIODS } from '../audio/nodes/modchan.js';
import { cleanName, idFromName, uniqueId } from './ops.js';

// ProTracker module files (.mod) -> a project: a lane on a `modchan` machine for each channel, the 31 samples, and the
// arrangement played out. See the modchan node for the effects. The song runs at 24 ticks to the beat, so the BPM
// is the MOD tempo and one song tick is one MOD tick; a row becomes `speed` ticks long.

const text = (b, from, to) => String.fromCharCode(...b.subarray(from, to)).replace(/\0.*$/s, '').replace(/[^\x20-\x7e]/g, '').trim();
export const TICKS_PER_BEAT = 24;
const hex = (n, w) => n.toString(16).toUpperCase().padStart(w, '0');

// Returns { title, channels, orders: [pattern numbers], patterns: [[row of { period, sample, effect, param } per channel] x 64],
// samples: [{ name, length, finetune, volume, loopStart, loopLength, data: Float32Array }] x 31 }.
export function parseMod(buffer) {
  const b = new Uint8Array(buffer);
  if (b.length < 1084) throw new Error('Not a MOD file.');
  const sig = text(b, 1080, 1084);
  let channels = 0;
  if (sig === 'M.K.' || sig === 'M!K!' || sig === 'FLT4' || sig === '4CHN') channels = 4;
  else if (/^\dCHN$/.test(sig)) channels = Number(sig[0]);
  else if (/^\d\dCH$/.test(sig)) channels = Number(sig.slice(0, 2));
  else if (sig === 'FLT8') throw new Error('Startrekker 8-channel modules are not supported.');
  if (channels < 1 || channels > 32) throw new Error('Not a 31-sample MOD file (no M.K. mark).');
  const samples = [];
  for (let i = 0; i < 31; i++) {
    const o = 20 + i * 30;
    const ft = b[o + 24] & 15;
    samples.push({
      name: text(b, o, o + 22), length: ((b[o + 22] << 8) | b[o + 23]) * 2, finetune: ft > 7 ? ft - 16 : ft,
      volume: Math.min(64, b[o + 25]), loopStart: ((b[o + 26] << 8) | b[o + 27]) * 2, loopLength: ((b[o + 28] << 8) | b[o + 29]) * 2,
    });
  }
  const songLength = Math.min(128, Math.max(1, b[950]));
  const orders = Array.from(b.subarray(952, 952 + songLength));
  const count = Math.max(...b.subarray(952, 1080)) + 1;
  const patterns = [];
  let at = 1084;
  for (let p = 0; p < count; p++) {
    const rows = [];
    for (let r = 0; r < 64; r++) {
      const row = [];
      for (let c = 0; c < channels; c++, at += 4) {
        const [a, bb, cc, d] = [b[at] ?? 0, b[at + 1] ?? 0, b[at + 2] ?? 0, b[at + 3] ?? 0];
        row.push({ period: ((a & 15) << 8) | bb, sample: (a & 0xf0) | (cc >> 4), effect: cc & 15, param: d });
      }
      rows.push(row);
    }
    patterns.push(rows);
  }
  for (const s of samples) {   // 8-bit signed; a file that stops short just has shorter samples
    const have = Math.max(0, Math.min(s.length, b.length - at));
    s.data = Float32Array.from(b.subarray(at, at + have), v => (v > 127 ? v - 256 : v) / 128);
    s.length = have;
    at += have;
  }
  return { title: text(b, 0, 20), channels, orders, patterns, samples };
}

// Plays the song out in order, following jumps (Bxx, Dxx), pattern loops (E6x) and pattern delays (EEx), and keeping
// the speed and tempo: returns the rows in the order they sound, { pattern, row, speed, delay, tempo? }, where tempo is
// set on a row that changes it. It stops where the song comes round to a row it has played, or runs off the end.
export function playOut(mod, { maxRows = 40000 } = {}) {
  const steps = [];
  let speed = 6, tempo = 125, pos = 0, row = 0;
  const seen = new Set(), loopRow = new Array(mod.channels).fill(0), loopCount = new Array(mod.channels).fill(0);
  while (pos < mod.orders.length && steps.length < maxRows) {
    const pattern = mod.orders[pos], rows = mod.patterns[pattern];
    if (!rows) break;
    const key = pos * 64 + row;
    if (seen.has(key) && !loopCount.some(c => c > 0)) break;
    seen.add(key);
    let jump = null, brk = null, loop = null, delay = 0, stop = false, tempoHere;
    rows[row].forEach((cell, c) => {
      const { effect: e, param: p } = cell, x = p & 15;
      if (e === 0xF) { if (p === 0) stop = true; else if (p < 32) speed = p; else { tempo = p; tempoHere = p; } }
      else if (e === 0xB) jump = p;
      else if (e === 0xD) brk = (p >> 4) * 10 + x;
      else if (e === 0xE && (p >> 4) === 6) {
        if (x === 0) loopRow[c] = row;
        else { if (loopCount[c] === 0) loopCount[c] = x; else loopCount[c]--; if (loopCount[c] > 0) loop = loopRow[c]; }
      } else if (e === 0xE && (p >> 4) === 0xE) delay = x;
    });
    steps.push({ pattern, row, speed, delay, ...(tempoHere ? { tempo: tempoHere } : {}) });
    if (stop) break;
    if (jump === null && brk === null && loop !== null) { row = loop; continue; }
    if (jump !== null || brk !== null) { pos = jump ?? pos + 1; row = brk !== null && brk < 64 ? brk : 0; }
    else if (++row >= 64) { pos++; row = 0; }
  }
  return { steps, tempo: 125 };
}

const nearestNote = period => {
  let best = 0;
  for (let i = 1; i < PERIODS.length; i++) if (Math.abs(PERIODS[i] - period) < Math.abs(PERIODS[best] - period)) best = i;
  return best;
};

// The project data ({ song, instruments, samples }) for a parsed module.
export function modToProject(mod, name = 'mod') {
  const { steps } = playOut(mod);
  if (!steps.length) throw new Error('That module has no rows to play.');
  const samples = {}, slots = [];
  const used = new Set();
  mod.samples.forEach((s, i) => {
    if (s.length < 2) {   // an empty slot: one silent sample stands in, so the slots stay in step with the MOD's numbers
      if (!samples['mod-empty']) samples['mod-empty'] = { rate: 8363, data: new Float32Array(2) };
      slots.push('mod-empty');
      return;
    }
    const id = uniqueId(used, idFromName(`${hex(i + 1, 2)}_${s.name || 'sample'}`));
    used.add(id);
    const loops = s.loopLength > 2 && s.loopStart + s.loopLength <= s.length;
    samples[id] = {
      rate: Math.round(8363 * Math.pow(2, s.finetune / 96)), data: s.data, volume: s.volume / 64,
      ...(loops ? { loopStart: s.loopStart, loopEnd: s.loopStart + s.loopLength, loopOn: true } : {}),
    };
    slots.push(id);
  });
  // Rows that go together become one pattern: consecutive rows of one MOD pattern at one speed. A row with a pattern delay stands alone.
  const runs = [];
  for (const s of steps) {
    const last = runs[runs.length - 1];
    if (last && !s.delay && !last.delay && last.pattern === s.pattern && last.speed === s.speed && last.start + last.count === s.row) last.count++;
    else runs.push({ pattern: s.pattern, start: s.row, count: 1, speed: s.speed, delay: s.delay });
  }
  const song = { name: cleanName(mod.title) || name, bpm: 125, ticksPerBeat: TICKS_PER_BEAT, swing: 0.5, length: 16, lanes: [] };
  const instruments = {};
  const total = steps.reduce((n, s) => n + s.speed * (1 + s.delay), 0);
  const pans = [-1, 1, 1, -1];
  const puidOf = r => `p${hex(r.pattern, 2)}${r.start || r.count !== 64 ? `-r${r.start}-${r.start + r.count - 1}` : ''}${r.speed !== 6 ? `-s${r.speed}` : ''}${r.delay ? `-d${r.delay}` : ''}`;
  const lanes = Array.from({ length: mod.channels }, (_, c) => {
    const def = structuredClone(synthKinds.modchan.make());
    def.samples = { ch: [...slots] };
    def.graph.nodes.find(n => n.id === 'ch').params = { pan: pans[c % 4] * 0.8 };
    const id = uniqueId(new Set(Object.keys(instruments)), `ch${c + 1}`);
    instruments[id] = def;
    return { id, instrument: id, patterns: {}, placements: [] };
  });
  let tick = 0;
  const master = { id: 'master', instrument: 'master', patterns: {}, placements: [] };
  const tempoRows = new Map();
  for (const run of runs) {
    const puid = puidOf(run), rowTicks = run.speed * (1 + run.delay);
    lanes.forEach((lane, c) => {
      if (!lane.patterns[puid]) {
        const lines = [];
        for (let r = run.start; r < run.start + run.count; r++) {
          const cell = mod.patterns[run.pattern][r][c];
          const note = cell.period ? noteToken(12 + nearestNote(cell.period)) : '...';
          const smp = cell.sample ? hex(cell.sample - 1, 2) : '..';
          lines.push(`${note} ${smp} 01${hex((cell.effect << 8) | cell.param, 4)}`);
          for (let t = 1; t < rowTicks; t++) lines.push('... .. ......');
        }
        lane.patterns[puid] = { name: puid, text: lines.join('\n') };
      }
      lane.placements.push({ puid, start: tick, length: run.count * rowTicks });
    });
    tick += run.count * rowTicks;
  }
  // tempo changes: the master lane's BPM column, on the tick the row starts
  let at = 0;
  const lines = new Array(total).fill('.... .. .. ..');
  for (const s of steps) {
    if (s.tempo) { lines[at] = `${hex(s.tempo, 4)} .. .. ..`; tempoRows.set(at, s.tempo); }
    at += s.speed * (1 + s.delay);
  }
  if (tempoRows.size) {
    master.patterns.tempo = { name: 'tempo', text: lines.join('\n') };
    master.placements.push({ puid: 'tempo', start: 0, length: total });
  }
  song.length = Math.max(16, Math.ceil(total / 16) * 16);
  song.lanes = [master, ...lanes];
  const data = { song, instruments, samples };
  ensureMaster(data);
  return data;
}
