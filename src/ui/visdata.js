// What the song is doing right now, as numbers a picture can use. Each frame it reads the playhead and, for every lane (not the master
// lane), looks at the pattern cells the playhead has passed: a note makes that lane's `hit` jump to 1 (and then fade away), and sets its
// `pitch` (0 to 1 across the 128 notes), `vel` (0 to 1) and `held` (1 until a note off, a note cut or the next note's off). A trigger
// column (the hi-hat's) counts as a hit too. These are the song's own values, not the sound's: they are exact, and they do not depend
// on the audio engine, so the same numbers can be made offline, tick by tick, for a video.
//
// A shader reads them through the lane's name (its id, or its instrument's name) or its place in the lane list, which the preprocess
// below turns into a look-up in the LANE array:  hit("kick")  pitch("acid")  vel(2)  held("pad")  hits()
import { PAGE_TICKS } from '../audio/sequencer.js';
import { MASTER, SHADER, GRAPH } from '../instruments.js';
import { EMPTY, CUT, OFF, relativeNote, decodeNote, decodeHex1, decodeHex2 } from '../seq/cells.js';

export const MAX_LANES = 16;
export const WIN = 32, BEHIND = 8;   // the pattern window a shader can read: WIN ticks across, the playhead BEHIND ticks from the left edge

// The lanes a picture can see: every lane but the master lane, in order, at most MAX_LANES.
export const visibleLanes = lanes => (lanes ?? []).filter(l => l.instrument !== MASTER && l.instrument !== SHADER && l.instrument !== GRAPH).slice(0, MAX_LANES);

// The shader the picture shows at `tick`: the last Shd value the shader lane holds at or before it (0 when it holds none yet), so
// starting or jumping into the middle of a song shows the right shader. The lane is the shader machine's; col is its Shd column.
export function shaderAt(lane, tick) {
  const col = lane?.columns?.find(c => c.kind === 'param' && c.param === 'shader');
  if (!col || !lane.pages) return 0;
  const channels = lane.channels ?? lane.columns.reduce((n, c) => Math.max(n, c.ch + (c.kind === 'cmd' ? 2 : 1)), 0);
  for (let t = Math.min(tick, lane.pages.length * PAGE_TICKS - 1); t >= 0; t--) {
    const page = lane.pages[(t / PAGE_TICKS) | 0];
    if (!page) { t = ((t / PAGE_TICKS) | 0) * PAGE_TICKS; continue; }   // an empty page: on to the one before
    const v = page[(t % PAGE_TICKS) * channels + col.ch];
    if (v !== EMPTY) return decodeHex1(v);
  }
  return 0;
}

// Reads one lane's cells at one tick into the state { hit, pitch, vel, held }. Returns true when it started something.
export function readTick(lane, state, tick) {
  const page = lane.pages?.[(tick / PAGE_TICKS) | 0];
  if (!page || (lane.mask && (lane.mask[tick] & 3) > 0)) return false;
  const channels = lane.channels ?? lane.columns.reduce((n, c) => Math.max(n, c.ch + (c.kind === 'cmd' ? 2 : 1)), 0);   // as the sequencer counts them
  const base = (tick % PAGE_TICKS) * channels;
  const notes = [], vels = [];
  let hit = false;
  for (const col of lane.columns) {
    const v = page[base + col.ch];
    if (v === EMPTY) continue;
    if (col.kind === 'vel') vels[col.nc] = decodeHex2(v) / 255;
    else if (col.kind === 'trig') { const g = decodeHex1(v) / 15; if (g > 0) { state.hit = 1; state.vel = g; state.pitch = Math.max(0, Math.min(1, (col.note ?? 60) / 127)); hit = true; } }
    else if (col.kind === 'note') notes[col.nc] = col.rel ? relativeNote(v, col.root) : v;
  }
  for (let k = 0; k < notes.length; k++) {
    const note = notes[k];
    if (note === undefined || note === EMPTY) continue;
    if (note === CUT || note === OFF) { state.held = 0; continue; }
    state.hit = 1; state.pitch = Math.max(0, Math.min(1, decodeNote(note) / 127)); state.vel = vels[k] ?? 1; state.held = 1;
    hit = true;
  }
  return hit;
}

// What one row of a lane holds, without touching any state: [note starts (0 or 1), pitch 0..1, velocity 0..1, note off or cut (0 or 1)].
export function peek(lane, tick) {
  const page = lane.pages?.[(tick / PAGE_TICKS) | 0];
  if (!page || tick < 0) return null;
  const channels = lane.channels ?? lane.columns.reduce((n, c) => Math.max(n, c.ch + (c.kind === 'cmd' ? 2 : 1)), 0);
  const base = (tick % PAGE_TICKS) * channels;
  let hit = 0, pitch = 0, vel = 1, off = 0, any = false;
  for (const col of lane.columns) {
    const v = page[base + col.ch];
    if (v === EMPTY) continue;
    if (col.kind === 'vel') vel = decodeHex2(v) / 255;
    else if (col.kind === 'trig') { if (decodeHex1(v) > 0) { hit = 1; pitch = Math.max(pitch, (col.note ?? 60) / 127); vel = decodeHex1(v) / 15; any = true; } }
    else if (col.kind === 'note') { any = true; const n = col.rel ? relativeNote(v, col.root) : v; if (n === CUT || n === OFF) off = 1; else { hit = 1; pitch = Math.max(pitch, decodeNote(n) / 127); } }
  }
  return any ? [hit, Math.min(1, pitch), Math.min(1, vel), off] : null;
}

// transport: the Int32Array the sequencer fills ([tick, playing, fraction of the tick in 1/65536]); song: { ticksPerBeat }.
export function createVisData({ lanes, transport, song, decayMs = () => 220, knob = () => undefined }) {
  let states = [], key = '', lastTick = -1, last = 0, time = 0;
  const out = { knob, T: 0, BEAT: 0, HITS: 0, NL: 1, lane: new Float32Array(MAX_LANES * 4), names: [], pat: new Uint8Array(WIN * MAX_LANES * 4) };
  let patTick = -2, patKey = '';
  const sync = () => {
    const list = visibleLanes(lanes()), k = list.map(l => `${l.id}\u0000${l.instrument}`).join('\u0001');
    if (k !== key) { key = k; states = list.map(() => ({ hit: 0, pitch: 0.5, vel: 0, held: 0 })); out.names = list.map(l => [l.id, l.instrument]); lastTick = -1; }
    return list;
  };
  return {
    out,
    // `now` in ms (requestAnimationFrame's clock). Returns the numbers for this frame.
    frame(now) {
      const list = sync(), dt = last ? Math.min(0.1, (now - last) / 1000) : 0;
      last = now; time += dt;
      const tick = Atomics.load(transport, 0), playing = Atomics.load(transport, 1) === 1, frac = playing ? Atomics.load(transport, 2) / 65536 : 0;
      const fade = Math.exp(-dt / Math.max(0.02, decayMs() / 1000));
      for (const s of states) s.hit *= fade;
      if (playing) {
        // every tick the playhead passed since the last frame (a jump, or the song looping, only reads the tick it is on)
        const from = lastTick >= 0 && tick > lastTick && tick - lastTick <= 24 ? lastTick + 1 : tick;
        if (tick !== lastTick) for (let t = from; t <= tick; t++) list.forEach((lane, i) => readTick(lane, states[i], t));
        lastTick = tick;
      } else { lastTick = -1; for (const s of states) s.held = 0; }
      let sum = 0;
      states.forEach((s, i) => { out.lane.set([s.hit, s.pitch, s.vel, s.held], i * 4); sum += s.hit; });
      out.lane.fill(0, states.length * 4);
      out.HITS = Math.min(1, sum / 2);
      // the window of rows around the playhead, rebuilt when the playhead moves or the lanes change
      if (tick !== patTick || patKey !== key) {
        patTick = tick; patKey = key; out.pat.fill(0);
        list.forEach((lane, i) => {
          for (let c = 0; c < WIN; c++) {
            const cell = peek(lane, tick + c - BEHIND);
            if (cell) out.pat.set([cell[0] * 255, cell[1] * 255, cell[2] * 255, cell[3] * 255], (i * WIN + c) * 4);
          }
        });
      }
      out.shader = shaderAt(lanes().find(l => l.instrument === SHADER), tick);
      out.NL = Math.max(1, states.length);
      out.T = time;
      out.BEAT = ((tick + frac) / Math.max(1, song()?.ticksPerBeat ?? 4));
      return out;
    },
  };
}

// The look-ups in a shader, turned into reads of the LANE array: hit("kick") becomes LANE[0].x, pitch(2) LANE[2].y, and so on. A name that
// matches no lane reads 0. `names` is [[id, instrument], ...] in lane order. hits() is the sum of every lane's hit, 0 to 1.
// A number exposed to the patterns is written kn("name", start, low, high): the value a lane of the shader machine gives it (0 to 1) stretched
// from low to high, or `start` while the project has no such input. knobCalls finds them in the text (start and end are where the call sits);
// preprocess turns each one into KN[j], j counting the different names, which the picture fills in every frame from the same list.
const NUM = String.raw`[-+]?(?:\d+\.?\d*|\.\d+)`;
export const KN_SOURCE = String.raw`\bkn\s*\(\s*"([^"\n]*)"\s*,\s*(${NUM})\s*,\s*(${NUM})\s*,\s*(${NUM})\s*\)`;
export function knobCalls(text) {
  text = String(text);
  return [...text.matchAll(new RegExp(KN_SOURCE, 'g'))].filter(m => !text.slice(text.lastIndexOf('\n', m.index) + 1, m.index).includes('//')).map(m => ({ start: m.index, end: m.index + m[0].length, name: m[1], start0: Number(m[2]), lo: Number(m[3]), hi: Number(m[4]), text: m[0] }));
}
export const MAX_KNOBS = 16;
export function preprocess(source, names, knobs = []) {
  const at = name => names.findIndex(([id, inst]) => id === name || inst === name);
  const comp = { hit: 'x', pitch: 'y', vel: 'z', held: 'w' };
  return String(source)
    .replace(new RegExp(KN_SOURCE, 'g'), (m, name, d, lo, hi) => {
      let j = knobs.findIndex(k => k.name === name);
      if (j < 0 && knobs.length < MAX_KNOBS) { knobs.push({ name, d: Number(d), lo: Number(lo), hi: Number(hi) }); j = knobs.length - 1; }
      return j >= 0 ? `KN[${j}]` : (/\./.test(d) ? d : `${d}.`);
    })
    .replace(/\bhits\s*\(\s*\)/g, 'HITS')
    .replace(/\bcell\s*\(\s*(?:"([^"]*)"|'([^']*)')\s*,/g, (m, a, b) => { const i = at(a ?? b); return i >= 0 ? `cell(${i}.,` : `cell(-1.,`; })
    .replace(/\b(hit|pitch|vel|held)\s*\(\s*(?:"([^"]*)"|'([^']*)'|([^()]*?))\s*\)/g, (_, fn, a, b, expr) => {
      if (expr !== undefined) return expr.trim() === '' ? _ : `LANE[${expr.trim()}].${comp[fn]}`;
      const i = at(a ?? b);
      return i >= 0 ? `LANE[${i}].${comp[fn]}` : '0.0';
    });
}
