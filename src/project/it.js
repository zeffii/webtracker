import { noteToken } from '../seq/cells.js';
import { synthKinds, ensureMaster } from '../instruments.js';
import { cleanName, idFromName, uniqueId } from './ops.js';
import { FX } from '../audio/nodes/itchan.js';

// Impulse Tracker module files (.it) -> a project: a lane on an `itchan` machine for each channel that is used, every
// sample, and the arrangement played out. See the itchan node for what it plays. As for XM files, the song runs at 24 ticks
// to the beat, so the BPM is the IT tempo and one song tick is one IT tick; a row becomes `speed` ticks long.
//
// Left to the arrangement (played out here): A speed, T tempo and its slides, B / C jumps and breaks, SBx pattern loops,
// SEx pattern delay, S6x tick delay, V / W global volume. Not played: MIDI macros other than the default Z filter ones, random
// volume / pan variation, old-format instruments (before IT 2.00), the mixing volume, note fade (notes 246-253) and the notes
// above G-9, which Wax has no cell for.

export const TICKS_PER_BEAT = 24;
const hex = (n, w) => n.toString(16).toUpperCase().padStart(w, '0');
const text = (b, from, to) => String.fromCharCode(...b.subarray(from, to)).replace(/\0.*$/s, '').replace(/[^\x20-\x7e]/g, '').trim();
const NOTE_CUT = 254, NOTE_OFF = 255, TOP_NOTE = 115;   // G-9, the highest note a Wax cell holds

function reader(buffer) {
  const b = new Uint8Array(buffer), v = new DataView(buffer instanceof ArrayBuffer ? buffer : b.buffer, b.byteOffset, b.byteLength);
  const need = at => { if (at < 0 || at > b.length) throw new Error('The IT file stops short.'); };
  return {
    b, length: b.length,
    u8: at => { need(at + 1); return b[at]; },
    s8: at => { need(at + 1); return v.getInt8(at); },
    u16: at => { need(at + 2); return v.getUint16(at, true); },
    u32: at => { need(at + 4); return v.getUint32(at, true); },
  };
}

// IT 2.14 / 2.15 sample compression: blocks of up to 0x8000 bytes, each with a 16-bit length, a bit stream (low bits first)
// whose width changes by escape codes, and one or two running sums (the second for IT 2.15). Returns Int8 / Int16 values.
export function decompress(b, at, count, sixteen, second) {
  const out = sixteen ? new Int16Array(count) : new Int8Array(count);
  const blockMax = sixteen ? 0x4000 : 0x8000, start = sixteen ? 17 : 9, bits = sixteen ? 16 : 8;
  let done = 0;
  while (done < count && at + 2 <= b.length) {
    const size = b[at] | (b[at + 1] << 8);
    at += 2;
    const end = Math.min(b.length, at + size);
    let bitBuffer = 0, bitCount = 0, q = at;
    const read = n => {
      let value = 0;
      for (let got = 0; got < n;) {
        if (bitCount === 0) { bitBuffer = q < end ? b[q++] : 0; bitCount = 8; }
        const take = Math.min(n - got, bitCount);
        value |= (bitBuffer & ((1 << take) - 1)) << got;
        bitBuffer >>= take; bitCount -= take; got += take;
      }
      return value >>> 0;
    };
    const length = Math.min(blockMax, count - done);
    let width = start, d1 = 0, d2 = 0, n = 0;
    while (n < length) {
      if (width > start) break;   // a corrupt block
      let value = read(width);
      if (width < 7) {
        if (value === 1 << (width - 1)) { const v = read(sixteen ? 4 : 3) + 1; width = v < width ? v : v + 1; continue; }
      } else if (width < start) {
        const border = ((sixteen ? 0xffff : 0xff) >>> (start - width)) - (sixteen ? 8 : 4), span = sixteen ? 16 : 8;
        if (value > border && value <= border + span) { value -= border; width = value < width ? value : value + 1; continue; }
      } else if (value & (1 << (start - 1))) { width = (value + 1) & 0xff; continue; }
      let v;
      if (width < bits) { const shift = 32 - width; v = (value << shift) >> shift; } else v = sixteen ? (value << 16) >> 16 : (value << 24) >> 24;
      d1 += v; d2 += d1;
      out[done + n++] = second ? d2 : d1;   // the typed array wraps it to 8 or 16 bits
    }
    done += length;
    at = end;
  }
  return { values: out, next: at };
}

// One sample's frames as floats in -1..1, left and right when it is stereo.
function readSampleData(r, h) {
  const { pointer, length, sixteen, stereo, compressed, signed, delta } = h;
  const channels = stereo ? 2 : 1, result = [];
  let at = pointer;
  for (let c = 0; c < channels; c++) {
    const out = new Float32Array(length);
    if (compressed) {
      const { values, next } = decompress(r.b, at, length, sixteen, delta);
      at = next;
      for (let i = 0; i < length; i++) out[i] = (signed ? values[i] : values[i] ^ (sixteen ? -32768 : -128)) / (sixteen ? 32768 : 128);
    } else {
      const unit = sixteen ? 2 : 1, have = Math.max(0, Math.min(length, Math.floor((r.length - at) / unit)));
      let sum = 0;
      for (let i = 0; i < have; i++) {
        let v = sixteen ? r.b[at + i * 2] | (r.b[at + i * 2 + 1] << 8) : r.b[at + i];
        if (sixteen && v > 32767) v -= 65536; else if (!sixteen && v > 127) v -= 256;
        if (delta) { sum += v; v = sixteen ? (sum << 16) >> 16 : (sum << 24) >> 24; }
        else if (!signed) v = sixteen ? v ^ -32768 : v ^ -128;
        out[i] = v / (sixteen ? 32768 : 128);
      }
      at += length * unit;
    }
    result.push(out);
  }
  return { data: result[0], right: result[1] ?? null };
}

// An envelope from its 82 bytes: flags, node count, loop and sustain points, 25 (value, tick) nodes. Returns null when it is off.
// Values are shifted to 0..64 for all three (panning and pitch are stored -32..32).
function readEnvelope(r, at, centred) {
  const flags = r.u8(at), count = Math.min(25, r.u8(at + 1));
  if (!(flags & 1) || count < 1) return { env: null, filter: (flags & 0x80) !== 0 };
  const pts = [];
  for (let i = 0; i < count; i++) {
    const y = centred ? r.s8(at + 6 + i * 3) + 32 : r.s8(at + 6 + i * 3);
    pts.push(r.u16(at + 7 + i * 3), Math.max(0, Math.min(64, y)));
  }
  const inside = k => (k < count ? k : -1);
  return {
    env: { pts, ls: flags & 2 ? inside(r.u8(at + 2)) : -1, le: flags & 2 ? inside(r.u8(at + 3)) : -1, ss: flags & 4 ? inside(r.u8(at + 4)) : -1, se: flags & 4 ? inside(r.u8(at + 5)) : -1 },
    filter: (flags & 0x80) !== 0,
  };
}

// Returns { title, flags, speed, bpm, gv, chanPan, chanVol, orders, patterns: [[row of cells per channel]], instruments,
// samples, useInstruments, hasStereo }; a cell is { note, ins, vol, effect, param } with note -1, ins 0, vol -1 and effect 0
// when empty (note 0 is C-0, 254 is the cut, 255 the key off).
export function parseIt(buffer) {
  const r = reader(buffer);
  if (r.length < 192 || text(r.b, 0, 4) !== 'IMPM') throw new Error('Not an IT file.');
  const orderCount = r.u16(32), instrumentCount = r.u16(34), sampleCount = r.u16(36), patternCount = r.u16(38);
  const compatible = r.u16(42), flags = r.u16(44);
  if (compatible < 0x200) throw new Error('This IT file is from before Impulse Tracker 2.00 and is not supported.');
  const orders = Array.from(r.b.subarray(192, 192 + orderCount));
  const listAt = 192 + orderCount;
  const instrumentAt = Array.from({ length: instrumentCount }, (_, i) => r.u32(listAt + i * 4));
  const sampleAt = Array.from({ length: sampleCount }, (_, i) => r.u32(listAt + instrumentCount * 4 + i * 4));
  const patternAt = Array.from({ length: patternCount }, (_, i) => r.u32(listAt + (instrumentCount + sampleCount) * 4 + i * 4));
  const useInstruments = (flags & 4) !== 0;
  const empty = () => ({ note: -1, ins: 0, vol: -1, effect: 0, param: 0 });

  const patterns = patternAt.map(offset => {
    if (!offset) return Array.from({ length: 64 }, () => Array.from({ length: 64 }, empty));
    const length = r.u16(offset), rowCount = Math.max(1, Math.min(256, r.u16(offset + 2)));
    const rows = Array.from({ length: rowCount }, () => Array.from({ length: 64 }, empty));
    const last = Array.from({ length: 64 }, () => ({ mask: 0, note: -1, ins: 0, vol: -1, effect: 0, param: 0 }));
    let q = offset + 8, row = 0;
    const end = Math.min(r.length, q + length);
    while (row < rowCount && q < end) {
      const tag = r.u8(q++);
      if (tag === 0) { row++; continue; }
      const c = (tag - 1) & 63, memory = last[c];
      if (tag & 128) memory.mask = r.u8(q++);
      const mask = memory.mask, cell = rows[row][c];
      if (mask & 1) memory.note = r.u8(q++);
      if (mask & 2) memory.ins = r.u8(q++);
      if (mask & 4) memory.vol = r.u8(q++);
      if (mask & 8) { memory.effect = r.u8(q++); memory.param = r.u8(q++); }
      if (mask & 0x11) cell.note = memory.note;
      if (mask & 0x22) cell.ins = memory.ins;
      if (mask & 0x44) cell.vol = memory.vol;
      if (mask & 0x88) { cell.effect = memory.effect; cell.param = memory.param; }
    }
    return rows;
  });

  const samples = sampleAt.map(at => {
    if (!at || text(r.b, at, at + 4) !== 'IMPS') return null;
    const flag = r.u8(at + 18), cvt = r.u8(at + 46), sixteen = (flag & 2) !== 0;
    const head = {
      name: text(r.b, at + 20, at + 46), globalVolume: Math.min(64, r.u8(at + 17)), volume: Math.min(64, r.u8(at + 19)),
      pan: r.u8(at + 47), length: r.u32(at + 48), loopStart: r.u32(at + 52), loopEnd: r.u32(at + 56), rate: r.u32(at + 60),
      susStart: r.u32(at + 64), susEnd: r.u32(at + 68), pointer: r.u32(at + 72),
      vib: [r.u8(at + 76), r.u8(at + 77), r.u8(at + 78), r.u8(at + 79)],
      loop: (flag & 16) !== 0, sus: (flag & 32) !== 0, pingpong: (flag & 64) !== 0, susPingpong: (flag & 128) !== 0,
      sixteen, stereo: (flag & 4) !== 0, compressed: (flag & 8) !== 0, signed: (cvt & 1) !== 0, delta: (cvt & 4) !== 0,
    };
    if (!(flag & 1) || !head.length) { head.data = new Float32Array(0); head.right = null; }
    else Object.assign(head, readSampleData(r, head));
    return head;
  });

  const instruments = instrumentAt.map(at => {
    if (!at || text(r.b, at, at + 4) !== 'IMPI') return null;
    const map = [], notes = [];
    for (let n = 0; n < 120; n++) { notes.push(r.u8(at + 64 + n * 2)); map.push(r.u8(at + 65 + n * 2) - 1); }
    const volume = readEnvelope(r, at + 304, false), panning = readEnvelope(r, at + 386, true), pitch = readEnvelope(r, at + 468, true);
    const dfp = r.u8(at + 25), ifc = r.u8(at + 58), ifr = r.u8(at + 59);
    return {
      name: text(r.b, at + 32, at + 58), nna: Math.min(3, r.u8(at + 17)), dct: Math.min(3, r.u8(at + 18)), dca: Math.min(2, r.u8(at + 19)),
      fade: r.u16(at + 20), pps: r.s8(at + 22), ppc: Math.min(119, r.u8(at + 23)), gbv: Math.min(128, r.u8(at + 24)),
      pan: dfp & 128 ? -1 : Math.min(64, dfp), ifc: ifc & 128 ? ifc & 127 : -1, ifr: ifr & 128 ? ifr & 127 : -1,
      map, notes, vol: volume.env, pan2: panning.env, pit: pitch.env, filter: pitch.filter && !!pitch.env,
    };
  });

  return {
    title: text(r.b, 4, 30), flags, speed: r.u8(50) || 6, bpm: Math.max(32, r.u8(51) || 125), gv: Math.min(128, r.u8(48)),
    chanPan: Array.from(r.b.subarray(64, 128)), chanVol: Array.from(r.b.subarray(128, 192)),
    orders: orders.filter(o => o < 254), patterns, instruments, samples, useInstruments,
    hasStereo: samples.some(s => s?.right),
  };
}

// Plays the song out in order, following jumps (B), breaks (C), pattern loops (SBx), pattern delays (SEx), tick delays (S6x),
// the speed and tempo (A, T) and the global volume (V, W): returns the rows in the order they sound,
// { pattern, row, speed, ticks, tempo, tslide, gv, gslide }. `tempo` is the tempo on the row's first tick, `tslide` what T0x / T1x
// adds on each later tick, `gv` the global volume (0..128) on the first tick and `gslide` what W adds on each later one.
export function playOut(it, { maxRows = 40000 } = {}) {
  const steps = [];
  let speed = it.speed, tempo = it.bpm, gv = it.gv, pos = 0, row = 0, memT = 0, memW = 0;
  const seen = new Set(), loopRow = new Array(64).fill(0), loopCount = new Array(64).fill(0), memS = new Array(64).fill(0);
  const clampTempo = t => Math.max(32, Math.min(255, t));
  while (pos < it.orders.length && steps.length < maxRows) {
    const pattern = it.orders[pos], rows = it.patterns[pattern];
    if (!rows || row >= rows.length) { pos++; row = 0; continue; }
    const key = `${pos}:${row}`;
    if (seen.has(key) && !loopCount.some(c => c > 0)) break;
    seen.add(key);
    let jump = null, brk = null, loop = null, delay = 0, tickDelay = 0, tslide = 0, gslide = 0;
    rows[row].forEach((cell, c) => {
      const { effect: e, param: p } = cell;
      if (e === FX.A) { if (p) speed = p; }
      else if (e === FX.T) {
        if (p) memT = p;
        if (memT >= 0x20) { if (p) tempo = clampTempo(p); } else tslide = memT >> 4 === 1 ? memT & 15 : -(memT & 15);
      } else if (e === FX.B) jump = p;
      else if (e === FX.C) brk = p;
      else if (e === FX.V) gv = Math.min(128, p);
      else if (e === FX.W) {
        if (p) memW = p;
        const x = memW >> 4, y = memW & 15;
        if (y === 15 && x) gv = Math.min(128, gv + x);
        else if (x === 15 && y) gv = Math.max(0, gv - y);
        else if (y === 0) gslide = x; else if (x === 0) gslide = -y;
      } else if (e === FX.S) {
        if (p) memS[c] = p;
        const sub = memS[c] >> 4, x = memS[c] & 15;
        if (sub === 0xB) {
          if (x === 0) loopRow[c] = row;
          else { if (loopCount[c] === 0) loopCount[c] = x; else loopCount[c]--; if (loopCount[c] > 0) loop = loopRow[c]; }
        } else if (sub === 0xE) { if (!delay) delay = x; }
        else if (sub === 6) tickDelay += x;
      }
    });
    const rowTempo = tempo, ticks = speed * (1 + delay) + tickDelay;
    steps.push({ pattern, row, speed, ticks, tempo: rowTempo, tslide, gv, gslide });
    tempo = clampTempo(tempo + tslide * (ticks - 1));
    gv = Math.max(0, Math.min(128, gv + gslide * (ticks - 1)));
    if (jump === null && brk === null && loop !== null) { row = loop; continue; }
    if (jump !== null || brk !== null) {
      pos = jump ?? pos + 1;
      const next = it.patterns[it.orders[pos]];
      row = brk !== null && next && brk < next.length ? brk : 0;
    } else if (++row >= rows.length) { pos++; row = 0; }
  }
  return { steps };
}

// The cell text of an IT cell for the itchan machine.
function cellText(cell) {
  const note = cell.note === NOTE_OFF ? '===' : cell.note === NOTE_CUT ? '^^^' : cell.note >= 0 && cell.note <= TOP_NOTE ? noteToken(cell.note) : '...';
  const ins = cell.ins >= 1 ? hex(cell.ins - 1, 2) : '..';
  const vol = cell.vol >= 0 ? hex(cell.vol, 2) : '..';
  const word = cell.effect >= 1 && cell.effect <= 26 ? (cell.effect << 8) | cell.param : 0;
  return `${note} ${ins} ${vol} 01${hex(word, 4)}`;   // the Cmd cell on every row: it is what starts the row on the machine
}
const isEmptyCell = c => c.note < 0 && !c.ins && c.vol < 0 && !c.effect;

// The project data ({ song, instruments, samples }) for a parsed module.
export function itToProject(it, name = 'it') {
  const { steps } = playOut(it);
  if (!steps.length) throw new Error('That module has no rows to play.');
  const samples = {}, slots = [], used = new Set();
  it.samples.forEach((s, i) => {
    const id = uniqueId(used, idFromName(`${hex(i + 1, 2)}_${s?.name || 'sample'}`));
    used.add(id);
    slots.push(id);
    if (!s) { samples[id] = { rate: 8363, data: new Float32Array(2) }; return; }
    const lengthOk = (a, b) => b - a >= 2 && b <= s.data.length && a >= 0;
    samples[id] = {
      rate: Math.max(1000, Math.min(384000, s.rate || 8363)), data: s.data.length ? s.data : new Float32Array(2),
      ...(s.right ? { right: s.right } : {}), volume: s.volume / 64, ...(s.globalVolume !== 64 ? { globalVolume: s.globalVolume / 64 } : {}),
      ...(s.pan & 128 ? { pan: Math.max(-1, Math.min(1, ((s.pan & 127) - 32) / 32)), panOn: true } : {}),
      ...(s.loop && lengthOk(s.loopStart, s.loopEnd) ? { loopStart: s.loopStart, loopEnd: s.loopEnd, loopOn: true, ...(s.pingpong ? { pingpong: true } : {}) } : {}),
      ...(s.sus && lengthOk(s.susStart, s.susEnd) ? { susStart: s.susStart, susEnd: s.susEnd, susOn: true, ...(s.susPingpong ? { susPingpong: true } : {}) } : {}),
    };
  });
  if (!slots.length) throw new Error('That IT file has no samples.');
  const smp = it.samples.map(s => (s && s.vib[1] && s.vib[2] ? { vib: [s.vib[0], s.vib[1], s.vib[2], s.vib[3] & 3] } : null));
  const ins = it.useInstruments ? it.instruments.map(i => (i ? { ...i, name: undefined } : null)) : null;

  // The channels that sound anything.
  const channelsUsed = [];
  for (let c = 0; c < 64; c++) {
    if (steps.some(s => !isEmptyCell(it.patterns[s.pattern][s.row][c]))) channelsUsed.push(c);
  }
  if (!channelsUsed.length) throw new Error('That module has no notes.');

  // Rows that go together become one pattern: consecutive rows of one IT pattern at one speed. A row with extra ticks stands alone.
  const extra = s => s.ticks !== s.speed;
  const runs = [];
  for (const s of steps) {
    const last = runs[runs.length - 1];
    if (last && !extra(s) && !extra(last) && last.pattern === s.pattern && last.speed === s.speed && last.start + last.count === s.row) last.count++;
    else runs.push({ pattern: s.pattern, start: s.row, count: 1, speed: s.speed, ticks: s.ticks });
  }
  const song = { name: cleanName(it.title) || name, bpm: it.bpm, ticksPerBeat: TICKS_PER_BEAT, swing: 0.5, length: 16, lanes: [] };
  const instruments = {};
  const total = steps.reduce((n, s) => n + s.ticks, 0);
  const puidOf = r => `p${hex(r.pattern, 2)}${r.start || r.count !== it.patterns[r.pattern].length ? `-r${r.start}-${r.start + r.count - 1}` : ''}${r.speed !== 6 ? `-s${r.speed}` : ''}${extra(r) ? `-t${r.ticks}` : ''}`;
  const lanes = channelsUsed.map(c => {
    const def = structuredClone(synthKinds.itchan.make());
    def.samples = { ch: [...slots] };
    const pan = it.chanPan[c], data = {
      linear: (it.flags & 8) !== 0, oldEffects: (it.flags & 16) !== 0, compatG: (it.flags & 32) !== 0,
      chanVol: Math.min(64, it.chanVol[c]), chanPan: pan < 65 ? pan : 32, ...(it.hasStereo ? { it3: true } : {}),
      ...(ins ? { ins: structuredClone(ins) } : {}), smp: structuredClone(smp),
    };
    def.graph.nodes.find(n => n.id === 'ch').data = data;
    const id = uniqueId(new Set(Object.keys(instruments)), `ch${c + 1}`);
    instruments[id] = def;
    return { id, instrument: id, patterns: {}, placements: [], channel: c };
  });
  let tick = 0;
  for (const run of runs) {
    const puid = puidOf(run), rowTicks = run.ticks;
    lanes.forEach(lane => {
      if (!lane.patterns[puid]) {
        const lines = [];
        for (let r = run.start; r < run.start + run.count; r++) {
          lines.push(cellText(it.patterns[run.pattern][r][lane.channel]));
          for (let t = 1; t < rowTicks; t++) lines.push('... .. .. ......');
        }
        lane.patterns[puid] = { name: puid, text: lines.join('\n') };
      }
      lane.placements.push({ puid, start: tick, length: run.count * rowTicks });
    });
    tick += run.count * rowTicks;
  }
  // The master lane: the tempo in the BPM column on the tick it changes, the global volume in the Vol column.
  const master = { id: 'master', instrument: 'master', patterns: {}, placements: [] };
  const lines = new Array(total).fill(null).map(() => ({ bpm: '....', vol: '..' }));
  let at = 0, gvNow = 128, tempoNow = it.bpm, any = false;
  const volHex = gv => hex(Math.round(gv / 128 * 255), 2);
  for (const s of steps) {
    for (let t = 0; t < s.ticks; t++) {
      const gv = Math.max(0, Math.min(128, s.gv + s.gslide * t)), tempo = Math.max(32, Math.min(255, s.tempo + s.tslide * t));
      if (gv !== gvNow) { lines[at + t].vol = volHex(gv); gvNow = gv; any = true; }
      if (tempo !== tempoNow) { lines[at + t].bpm = hex(tempo, 4); tempoNow = tempo; any = true; }
    }
    at += s.ticks;
  }
  if (any) {
    master.patterns.song = { name: 'song', text: lines.map(l => `${l.bpm} .. .. ${l.vol}`).join('\n') };
    master.placements.push({ puid: 'song', start: 0, length: total });
  }
  song.length = Math.max(16, Math.ceil(total / 16) * 16);
  song.lanes = [master, ...lanes.map(({ channel, ...lane }) => lane)];
  const data = { song, instruments, samples };
  ensureMaster(data);
  return data;
}
