import { noteToken } from '../seq/cells.js';
import { synthKinds, ensureMaster } from '../instruments.js';
import { cleanName, idFromName, uniqueId } from './ops.js';
import { FX } from '../audio/nodes/xmchan.js';

// FastTracker 2 module files (.xm) -> a project: a lane on an `xmchan` machine for each channel, every sample of every
// instrument, and the arrangement played out. See the xmchan node for what it plays. As for MOD files, the song runs
// at 24 ticks to the beat, so the BPM is the XM BPM and one song tick is one XM tick; a row becomes `speed` ticks long.

export const TICKS_PER_BEAT = 24;
const hex = (n, w) => n.toString(16).toUpperCase().padStart(w, '0');
const text = (b, from, to) => String.fromCharCode(...b.subarray(from, to)).replace(/\0.*$/s, '').replace(/[^\x20-\x7e]/g, '').trim();
const KEY_OFF = 97;

// A little-endian reader over the file.
function reader(buffer) {
  const b = new Uint8Array(buffer), v = new DataView(buffer instanceof ArrayBuffer ? buffer : b.buffer, b.byteOffset, b.byteLength);
  const need = at => { if (at > b.length) throw new Error('The XM file stops short.'); };
  return {
    b, length: b.length,
    u8: at => { need(at + 1); return b[at]; },
    s8: at => { need(at + 1); return v.getInt8(at); },
    u16: at => { need(at + 2); return v.getUint16(at, true); },
    u32: at => { need(at + 4); return v.getUint32(at, true); },
  };
}

// An envelope from its 12 points (x, y words), the count and the sustain / loop points, or null when it is off.
function readEnvelope(r, at, count, sus, ls, le, type) {
  if (!(type & 1) || count < 1) return null;
  const pts = [];
  for (let i = 0; i < Math.min(12, count); i++) pts.push(r.u16(at + i * 4), Math.min(64, r.u16(at + i * 4 + 2)));
  const n = pts.length / 2, inside = k => (k < n ? k : -1);
  return { pts, sus: type & 2 ? inside(sus) : -1, ls: type & 4 ? inside(ls) : -1, le: type & 4 ? inside(le) : -1 };
}

// Delta-coded sample data -> floats in -1..1.
function decodeSample(r, at, bytes, sixteen) {
  if (sixteen) {
    const n = bytes >> 1, out = new Float32Array(n);
    let old = 0;
    for (let i = 0; i < n; i++) { old = (old + r.b[at + i * 2] + (r.b[at + i * 2 + 1] << 8)) & 0xffff; out[i] = (old > 32767 ? old - 65536 : old) / 32768; }
    return out;
  }
  const out = new Float32Array(bytes);
  let old = 0;
  for (let i = 0; i < bytes; i++) { old = (old + r.b[at + i]) & 0xff; out[i] = (old > 127 ? old - 256 : old) / 128; }
  return out;
}

// Returns { title, channels, linear, speed, bpm, restart, orders, patterns: [[row of { note, ins, vol, effect, param } per
// channel]], instruments: [{ name, map: [96 sample numbers], vol, pan, fade, vib, samples: [{ name, data, loopStart,
// loopEnd, loopType, volume, finetune, pan, relNote }] }] }. Loops are in samples (not bytes).
export function parseXm(buffer) {
  const r = reader(buffer);
  if (r.length < 80 || text(r.b, 0, 17) !== 'Extended Module:') throw new Error('Not an XM file.');
  const version = r.u16(58);
  if (version < 0x0104) throw new Error('This XM file is from an old FastTracker (before 2.04); its layout is not supported.');
  const headerSize = r.u32(60);
  const songLength = Math.max(1, Math.min(256, r.u16(64))), restart = r.u16(66), channels = r.u16(68);
  const patternCount = r.u16(70), instrumentCount = r.u16(72), flags = r.u16(74);
  if (channels < 1 || channels > 64) throw new Error('That XM file has no channels.');
  const orders = Array.from(r.b.subarray(80, 80 + songLength));
  let at = 60 + headerSize;
  const empty = () => ({ note: 0, ins: 0, vol: 0, effect: 0, param: 0 });
  const patterns = [];
  for (let p = 0; p < patternCount; p++) {
    const len = r.u32(at), rowsCount = r.u16(at + 5), packed = r.u16(at + 7);
    at += len;
    const rows = Array.from({ length: rowsCount || 64 }, () => Array.from({ length: channels }, empty));
    let q = at;
    const end = at + packed;
    for (let row = 0; packed && row < rows.length; row++) {
      for (let c = 0; c < channels && q < end; c++) {
        const cell = rows[row][c], first = r.u8(q++);
        if (first & 0x80) {
          if (first & 1) cell.note = r.u8(q++);
          if (first & 2) cell.ins = r.u8(q++);
          if (first & 4) cell.vol = r.u8(q++);
          if (first & 8) cell.effect = r.u8(q++);
          if (first & 16) cell.param = r.u8(q++);
        } else {
          cell.note = first; cell.ins = r.u8(q++); cell.vol = r.u8(q++); cell.effect = r.u8(q++); cell.param = r.u8(q++);
        }
      }
    }
    at = end;
    patterns.push(rows);
  }
  const instruments = [];
  for (let i = 0; i < instrumentCount && at + 29 <= r.length; i++) {
    const size = r.u32(at), count = r.u16(at + 27);
    const inst = { name: text(r.b, at + 4, at + 26), map: new Array(96).fill(0), vol: null, pan: null, fade: 0, vib: [0, 0, 0, 0], samples: [] };
    if (count === 0) { instruments.push(inst); at += size; continue; }
    const sampleHeader = r.u32(at + 29);
    for (let k = 0; k < 96; k++) inst.map[k] = r.u8(at + 33 + k);
    inst.vol = readEnvelope(r, at + 129, r.u8(at + 225), r.u8(at + 227), r.u8(at + 228), r.u8(at + 229), r.u8(at + 233));
    inst.pan = readEnvelope(r, at + 177, r.u8(at + 226), r.u8(at + 230), r.u8(at + 231), r.u8(at + 232), r.u8(at + 234));
    inst.vib = [r.u8(at + 235), r.u8(at + 236), r.u8(at + 237), r.u8(at + 238)];
    inst.fade = r.u16(at + 239);
    at += size;
    const heads = [];
    for (let k = 0; k < count; k++, at += sampleHeader) {
      const type = r.u8(at + 14), sixteen = (type & 16) !== 0, unit = sixteen ? 2 : 1;
      heads.push({
        bytes: r.u32(at), loopStart: Math.floor(r.u32(at + 4) / unit), loopLength: Math.floor(r.u32(at + 8) / unit),
        volume: Math.min(64, r.u8(at + 12)), finetune: r.s8(at + 13), loopType: type & 3, sixteen,
        pan: r.u8(at + 15), relNote: r.s8(at + 16), name: text(r.b, at + 18, at + 40),
      });
    }
    for (const h of heads) {
      const have = Math.max(0, Math.min(h.bytes, r.length - at));
      const data = decodeSample(r, at, have, h.sixteen);
      at += h.bytes;
      const loops = h.loopType !== 0 && h.loopLength > 1 && h.loopStart + h.loopLength <= data.length;
      inst.samples.push({
        name: h.name, data, volume: h.volume, finetune: h.finetune, pan: h.pan, relNote: h.relNote,
        loopType: loops ? h.loopType : 0, loopStart: loops ? h.loopStart : 0, loopEnd: loops ? h.loopStart + h.loopLength : 0,
      });
    }
    instruments.push(inst);
  }
  return {
    title: text(r.b, 17, 37), channels, linear: (flags & 1) !== 0, speed: r.u16(76) || 6, bpm: r.u16(78) || 125,
    restart, orders, patterns, instruments,
  };
}

// Plays the song out in order, following jumps (B), breaks (D), pattern loops (E6x), pattern delays (EEx), the speed and
// BPM (F) and the global volume (G, H): returns the rows in the order they sound, { pattern, row, speed, delay, tempo?,
// gv, gslide }, where gv is the global volume (0..64) on the row's first tick and gslide what H adds on each later tick.
export function playOut(xm, { maxRows = 40000 } = {}) {
  const steps = [];
  let speed = xm.speed, pos = 0, row = 0, gv = 64, memH = 0;
  const seen = new Set(), loopRow = new Array(xm.channels).fill(0), loopCount = new Array(xm.channels).fill(0);
  while (pos < xm.orders.length && steps.length < maxRows) {
    const pattern = xm.orders[pos], rows = xm.patterns[pattern];
    if (!rows) { pos++; row = 0; continue; }   // an order past the patterns plays nothing
    if (row >= rows.length) { pos++; row = 0; continue; }
    const key = `${pos}:${row}`;
    if (seen.has(key) && !loopCount.some(c => c > 0)) break;
    seen.add(key);
    let jump = null, brk = null, loop = null, delay = 0, stop = false, tempoHere, gslide = 0;
    rows[row].forEach((cell, c) => {
      const { effect: e, param: p } = cell, x = p & 15;
      if (e === 0xF) { if (p === 0) stop = true; else if (p < 32) speed = p; else tempoHere = p; }
      else if (e === 0xB) jump = p;
      else if (e === 0xD) brk = (p >> 4) * 10 + x;
      else if (e === 0xE && (p >> 4) === 6) {
        if (x === 0) loopRow[c] = row;
        else { if (loopCount[c] === 0) loopCount[c] = x; else loopCount[c]--; if (loopCount[c] > 0) loop = loopRow[c]; }
      } else if (e === 0xE && (p >> 4) === 0xE) delay = x;
      else if (e === FX.G) gv = Math.min(64, p);
      else if (e === FX.H) { if (p) memH = p; gslide = memH >> 4 ? memH >> 4 : -(memH & 15); }
    });
    steps.push({ pattern, row, speed, delay, gv, gslide, ...(tempoHere ? { tempo: tempoHere } : {}) });
    const later = speed * (1 + delay) - 1;
    gv = Math.max(0, Math.min(64, gv + gslide * later));
    if (stop) break;
    if (jump === null && brk === null && loop !== null) { row = loop; continue; }
    if (jump !== null || brk !== null) {
      pos = jump ?? pos + 1;
      const next = xm.patterns[xm.orders[pos]];
      row = brk !== null && next && brk < next.length ? brk : 0;
    } else if (++row >= rows.length) { pos++; row = 0; }
  }
  return { steps };
}

// A ping-pong loop played as a forward one: the loop is followed by itself backwards, and the loop covers both.
export function unrollPingPong(data, start, end) {
  const back = data.subarray(start, end).slice().reverse();
  const out = new Float32Array(end + back.length);
  out.set(data.subarray(0, end)); out.set(back, end);
  return { data: out, loopStart: start, loopEnd: end + back.length };
}

// The rate a sample is played at on C-4: its relative note and finetune folded in (8363 Hz is untransposed).
const sampleRate = s => Math.max(1000, Math.min(384000, Math.round(8363 * Math.pow(2, (s.relNote + s.finetune / 128) / 12))));

// The project data ({ song, instruments, samples }) for a parsed module.
export function xmToProject(xm, name = 'xm') {
  const { steps } = playOut(xm);
  if (!steps.length) throw new Error('That module has no rows to play.');
  // the samples: every sample of every instrument gets a slot, and each instrument's keymap points at its slots
  const samples = {}, slots = [], used = new Set(), ins = [];
  xm.instruments.forEach((inst, i) => {
    const first = slots.length;
    inst.samples.forEach((s, k) => {
      let { data, loopStart, loopEnd } = s;
      if (s.loopType === 2) ({ data, loopStart, loopEnd } = unrollPingPong(data, loopStart, loopEnd));
      const id = uniqueId(used, idFromName(`${hex(i + 1, 2)}_${k}_${s.name || inst.name || 'sample'}`));
      used.add(id);
      samples[id] = {
        rate: sampleRate(s), data: data.length ? data : new Float32Array(2), volume: s.volume / 64,
        ...(s.pan !== 128 ? { pan: Math.max(-1, Math.min(1, (s.pan - 128) / 128)) } : {}),
        ...(s.loopType ? { loopStart, loopEnd, loopOn: true } : {}),
      };
      slots.push(id);
    });
    if (!inst.samples.length) { ins.push(null); return; }
    const map = inst.map.map(k => (k < inst.samples.length ? first + k : -1));
    ins.push({
      map: map.every(m => m === map[0]) ? map[0] : map, fade: inst.fade,
      ...(inst.vib.some(v => v) ? { vib: inst.vib } : {}),
      ...(inst.vol ? { vol: inst.vol } : {}), ...(inst.pan ? { pan: inst.pan } : {}),
    });
  });
  if (!slots.length) throw new Error('That XM file has no samples.');
  // Rows that go together become one pattern: consecutive rows of one XM pattern at one speed. A row with a pattern delay stands alone.
  const runs = [];
  for (const s of steps) {
    const last = runs[runs.length - 1];
    if (last && !s.delay && !last.delay && last.pattern === s.pattern && last.speed === s.speed && last.start + last.count === s.row) last.count++;
    else runs.push({ pattern: s.pattern, start: s.row, count: 1, speed: s.speed, delay: s.delay });
  }
  const song = { name: cleanName(xm.title) || name, bpm: xm.bpm, ticksPerBeat: TICKS_PER_BEAT, swing: 0.5, length: 16, lanes: [] };
  const instruments = {};
  const total = steps.reduce((n, s) => n + s.speed * (1 + s.delay), 0);
  const puidOf = r => `p${hex(r.pattern, 2)}${r.start || r.count !== xm.patterns[r.pattern].length ? `-r${r.start}-${r.start + r.count - 1}` : ''}${r.speed !== 6 ? `-s${r.speed}` : ''}${r.delay ? `-d${r.delay}` : ''}`;
  const lanes = Array.from({ length: xm.channels }, (_, c) => {
    const def = structuredClone(synthKinds.xmchan.make());
    def.samples = { ch: [...slots] };
    def.graph.nodes.find(n => n.id === 'ch').data = { linear: xm.linear, ins: structuredClone(ins) };
    const id = uniqueId(new Set(Object.keys(instruments)), `ch${c + 1}`);
    instruments[id] = def;
    return { id, instrument: id, patterns: {}, placements: [] };
  });
  const cellText = cell => {
    const note = cell.note === KEY_OFF ? '===' : cell.note >= 1 && cell.note <= 96 ? noteToken(cell.note - 1) : '...';
    const insCell = cell.ins >= 1 && cell.ins <= 128 ? hex(cell.ins - 1, 2) : '..';
    const vol = cell.vol >= 0x10 ? hex(cell.vol, 2) : '..';
    const effect = cell.effect <= 0x23 ? cell.effect : 0;
    return `${note} ${insCell} ${vol} 01${hex((effect << 8) | cell.param, 4)}`;
  };
  let tick = 0;
  for (const run of runs) {
    const puid = puidOf(run), rowTicks = run.speed * (1 + run.delay);
    lanes.forEach((lane, c) => {
      if (!lane.patterns[puid]) {
        const lines = [];
        for (let r = run.start; r < run.start + run.count; r++) {
          lines.push(cellText(xm.patterns[run.pattern][r][c]));
          for (let t = 1; t < rowTicks; t++) lines.push('... .. .. ......');
        }
        lane.patterns[puid] = { name: puid, text: lines.join('\n') };
      }
      lane.placements.push({ puid, start: tick, length: run.count * rowTicks });
    });
    tick += run.count * rowTicks;
  }
  // The master lane: tempo changes in the BPM column on the tick the row starts, and the global volume in the Vol column
  // on every tick it changes.
  const master = { id: 'master', instrument: 'master', patterns: {}, placements: [] };
  const lines = new Array(total).fill(null).map(() => ({ bpm: '....', vol: '..' }));
  let at = 0, gvNow = 64, any = false;
  const volHex = gv => hex(Math.round(gv / 64 * 255), 2);
  for (const s of steps) {
    if (s.tempo) { lines[at].bpm = hex(s.tempo, 4); any = true; }
    const ticks = s.speed * (1 + s.delay);
    for (let t = 0; t < ticks; t++) {
      const gv = Math.max(0, Math.min(64, s.gv + s.gslide * t));
      if (gv !== gvNow) { lines[at + t].vol = volHex(gv); gvNow = gv; any = true; }
    }
    at += ticks;
  }
  if (any) {
    master.patterns.song = { name: 'song', text: lines.map(l => `${l.bpm} .. .. ${l.vol}`).join('\n') };
    master.placements.push({ puid: 'song', start: 0, length: total });
  }
  song.length = Math.max(16, Math.ceil(total / 16) * 16);
  song.lanes = [master, ...lanes];
  const data = { song, instruments, samples };
  ensureMaster(data);
  return data;
}
