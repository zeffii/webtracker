// The node types of the Node Sequencer. A node has event ports (a message at a moment: a value and a velocity, delivered on a tick or a
// subtick) and control ports (a number that is always there, 0 to 1, read every audio block). The editor draws from these definitions
// and the audio thread runs them, so this file has no dependencies on either: `create(cx)` gets what it needs in `cx` and returns the
// node's behaviour.
//
//   cx.p            the node's parameters by name, live (an edit changes the number under the node)
//   cx.data         the node's own data (a list of steps, a script, a target), live
//   cx.info         where the song is: tick, subIdx, subs (subticks a tick), tpb, barTicks, abs (every subtick since the start), tickSec
//   cx.emit(out, value, vel)   send an event out of a port (vel -1: the sender has no velocity, the receiver picks its own)
//   cx.read(inName)            the control wired into a port, or NaN when none is
//   cx.ctl(outName, x)         set a control output
//   cx.after(subs, fn)         run fn a number of subticks from now (0 is now); it is dropped if the node's group has stopped by then
//   cx.rand()                  a random number in [0, 1)
//   cx.host                    notes, parameters, groups and messages to the page (see nodeseq.js)
//
// The behaviour: event(port, value, vel), tick(), sub(), control(dt), reset() (the graph starts again), stop() (the transport stopped), view()
// (a small object the editor draws: where a sequence is, a level).

const NAMES = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };

// "57", "C-5", "C#4", "Db4", "c5" -> a number; "." and "_" are a rest (NaN); anything else is null.
export function parseValue(tok) {
  if (tok === '.' || tok === '_') return NaN;
  if (tok !== '' && Number.isFinite(Number(tok))) return Number(tok);
  const m = /^([A-Ga-g])([#b-]?)(-?\d)$/.exec(tok);
  if (!m) return null;
  return (Number(m[3]) * 12) + NAMES[m[1].toLowerCase()] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
}

// The numbers in a list's text ("57 60 C-5 . 64"); the words it cannot read are returned as `bad`.
export function parseList(text) {
  const items = [], bad = [];
  for (const tok of String(text ?? '').split(/[\s,]+/).filter(Boolean)) {
    const v = parseValue(tok);
    if (v === null) bad.push(tok); else items.push(v);
  }
  return { items, bad };
}

const ev = (n, hot = true) => ({ n, k: 'e', hot });
const ct = n => ({ n, k: 'c' });
const par = (name, min, max, def, extra = {}) => ({ name, min, max, def, ...extra });
const clamp01 = x => (x < 0 ? 0 : x > 1 ? 1 : x);

// Euclid: whether step k of `steps` has a hit when `pulses` are spread out, rotated by `rot`.
export const euclidHit = (k, steps, pulses, rot) => {
  const s = Math.max(1, Math.round(steps)), kk = (((k + Math.round(rot)) % s) + s) % s;
  return (kk * Math.max(0, Math.round(pulses))) % s < Math.round(pulses);
};

// The compiled form of a script node's code: a function of the event and the api object, or an error message.
export function compileScript(code) {
  try {
    const fn = new Function('ev', 'api', `"use strict";\nconst { out, out2, ctl, state, rand, tick, sub, a, b, bpm, mtof } = api;\n${code}\n`);
    return { fn, error: null };
  } catch (e) {
    return { fn: null, error: String(e.message ?? e) };
  }
}

export const DEFAULT_SCRIPT = `// Runs for every event that arrives at "in".
// ev.value, ev.vel     what came in
// out(value, vel)      send an event on, out2(...) on the second port
// ctl(x)               set the control output (0 to 1)
// state                keeps its values from one event to the next
// rand()  tick  sub  a  b  bpm  mtof(n)
state.n = (state.n ?? 0) + 1;
out(ev.value + (state.n % 4 === 0 ? 12 : 0), ev.vel);
`;

export const NS_TYPES = {
  clock: {
    title: 'clock', cat: 'time', hint: 'the song\'s tick and the subticks between ticks',
    ins: [], outs: [ev('tick'), ev('sub'), ev('beat'), ev('bar')].map(({ n, k }) => ({ n, k })), params: [],
    create: cx => ({
      tick() { const i = cx.info; cx.emit('tick', i.tick, -1); if (i.tick % i.tpb === 0) cx.emit('beat', i.tick / i.tpb, -1); if (i.tick % i.barTicks === 0) cx.emit('bar', i.tick / i.barTicks, -1); },
      sub() { cx.emit('sub', cx.info.subIdx, -1); },
    }),
  },
  every: {
    title: 'every', cat: 'time', hint: 'passes every nth event',
    ins: [ev('in'), ev('reset')], outs: [{ n: 'out', k: 'e' }],
    params: [par('n', 1, 64, 4, { int: true }), par('offset', 0, 63, 0, { int: true })],
    create: cx => { let count = 0; return {
      event(port, v, vel) { if (port === 'reset') { count = 0; return; } const n = Math.max(1, Math.round(cx.p.n)); if (count % n === Math.round(cx.p.offset) % n) cx.emit('out', v, vel); count++; },
      reset() { count = 0; },
      view: () => ({ i: count }),
    }; },
  },
  euclid: {
    title: 'euclid', cat: 'rhythm', hint: 'spreads pulses evenly over steps, one step for each event',
    ins: [ev('in'), ev('reset')], outs: [{ n: 'hit', k: 'e' }, { n: 'miss', k: 'e' }],
    params: [par('steps', 1, 32, 8, { int: true }), par('pulses', 0, 32, 5, { int: true }), par('rot', 0, 31, 0, { int: true })],
    create: cx => { let i = 0, last = -1; return {
      event(port, v) { if (port === 'reset') { i = 0; return; } const s = Math.max(1, Math.round(cx.p.steps)); last = i % s; cx.emit(euclidHit(last, s, cx.p.pulses, cx.p.rot) ? 'hit' : 'miss', last, -1); i = (last + 1) % s; },
      reset() { i = 0; last = -1; },
      view: () => ({ i: last }),
    }; },
  },
  steps: {
    title: 'steps', cat: 'rhythm', hint: 'a row of steps, each off or on with its own level',
    ins: [ev('in'), ev('reset')], outs: [{ n: 'out', k: 'e' }, { n: 'val', k: 'c' }],
    params: [par('n', 1, 32, 16, { int: true })], body: 'steps',
    create: cx => { let i = 0, last = -1; return {
      event(port) {
        if (port === 'reset') { i = 0; return; }
        const n = Math.max(1, Math.round(cx.p.n)), cells = cx.data.cells ?? [];
        last = i % n; const c = Number(cells[last]) || 0; i = (last + 1) % n;
        if (c > 0) { cx.ctl('val', c); cx.emit('out', last, c); }
      },
      reset() { i = 0; last = -1; },
      view: () => ({ i: last }),
    }; },
  },
  Pseq: {
    title: 'Pseq', cat: 'values', hint: 'steps through a list of numbers or notes, one for each event; a dot is a rest',
    ins: [ev('next'), ev('reset')], outs: [{ n: 'value', k: 'e' }],
    params: [par('repeats', 0, 64, 0, { int: true })], body: 'list',
    create: cx => { let idx = 0, loops = 0, done = false, text = null, list = [], last = -1; return {
      event(port) {
        if (port === 'reset') { idx = 0; loops = 0; done = false; return; }
        if (text !== cx.data.text) { text = cx.data.text; list = parseList(text).items; idx = 0; }
        if (!list.length || done) return;
        last = idx; const v = list[idx]; idx++;
        if (idx >= list.length) { idx = 0; loops++; if (cx.p.repeats > 0 && loops >= cx.p.repeats) done = true; }
        if (!Number.isNaN(v)) cx.emit('value', v, -1);
      },
      reset() { idx = 0; loops = 0; done = false; last = -1; },
      view: () => ({ i: last }),
    }; },
  },
  Prand: {
    title: 'Prand', cat: 'values', hint: 'picks any value from a list at random, one for each event',
    ins: [ev('next')], outs: [{ n: 'value', k: 'e' }], params: [], body: 'list',
    create: cx => { let text = null, list = [], last = -1; return {
      event() {
        if (text !== cx.data.text) { text = cx.data.text; list = parseList(text).items; }
        if (!list.length) return;
        last = Math.floor(cx.rand() * list.length); const v = list[last];
        if (!Number.isNaN(v)) cx.emit('value', v, -1);
      },
      reset() { last = -1; },
      view: () => ({ i: last }),
    }; },
  },
  Pwhite: {
    title: 'Pwhite', cat: 'values', hint: 'a random number between two limits for each event, sent out and held as a control',
    ins: [ev('next')], outs: [{ n: 'value', k: 'e' }, { n: 'out', k: 'c' }],
    params: [par('lo', -127, 127, 0), par('hi', -127, 127, 1), par('int', 0, 1, 0, { int: true, labels: ['no', 'whole'] })],
    create: cx => { let v = 0; return {
      event() { const lo = cx.p.lo, hi = cx.p.hi; v = lo + cx.rand() * (hi - lo); if (cx.p.int >= 0.5) v = Math.round(v); cx.ctl('out', v); cx.emit('value', v, -1); },
      view: () => ({ v }),
    }; },
  },
  delay: {
    title: 'delay', cat: 'time', hint: 'passes an event on some subticks later',
    ins: [ev('in')], outs: [{ n: 'out', k: 'e' }], params: [par('subs', 0, 64, 2, { int: true })],
    create: cx => ({ event(_p, v, vel) { cx.after(Math.round(cx.p.subs), () => cx.emit('out', v, vel)); } }),
  },
  chance: {
    title: 'chance', cat: 'values', hint: 'lets an event through with a probability',
    ins: [ev('in')], outs: [{ n: 'out', k: 'e' }, { n: 'else', k: 'e' }], params: [par('p', 0, 1, 0.5)],
    create: cx => ({ event(_p, v, vel) { cx.emit(cx.rand() < cx.p.p ? 'out' : 'else', v, vel); } }),
  },
  math: {
    title: 'math', cat: 'values', hint: 'value times a number, plus a number',
    ins: [ev('in')], outs: [{ n: 'out', k: 'e' }], params: [par('mul', -8, 8, 1), par('add', -127, 127, 0)],
    create: cx => ({ event(_p, v, vel) { cx.emit('out', v * cx.p.mul + cx.p.add, vel); } }),
  },
  hold: {
    title: 'hold', cat: 'values', hint: 'turns an event\'s value into a control (lo to hi becomes 0 to 1)',
    ins: [ev('in')], outs: [{ n: 'out', k: 'c' }], params: [par('lo', -127, 127, 0), par('hi', -127, 127, 127)],
    create: cx => { let x = 0; return {
      event(_p, v) { const span = cx.p.hi - cx.p.lo; x = clamp01(span === 0 ? 0 : (v - cx.p.lo) / span); cx.ctl('out', x); },
      view: () => ({ v: x }),
    }; },
  },
  lfo: {
    title: 'lfo', cat: 'control', hint: 'a slow wave, as a control',
    ins: [ev('reset')], outs: [{ n: 'out', k: 'c' }],
    params: [par('rate', 0.01, 20, 0.5, { log: true }), par('sync', 0, 1, 0, { int: true, labels: ['Hz', 'per bar'] }), par('shape', 0, 4, 0, { int: true, labels: ['sine', 'triangle', 'saw', 'square', 'random'] }), par('depth', 0, 1, 1), par('center', 0, 1, 0.5)],
    create: cx => { let ph = 0, held = 0.5, x = 0.5; return {
      event() { ph = 0; },
      control(dt) {
        const i = cx.info, sync = cx.p.sync >= 0.5, barSec = i.barTicks * i.tickSec;
        const step = sync ? (barSec > 0 ? dt / barSec * cx.p.rate : 0) : dt * cx.p.rate;
        const before = ph; ph = (ph + step) % 1;
        let w;
        switch (Math.round(cx.p.shape)) {
          case 1: w = ph < 0.5 ? ph * 4 - 1 : 3 - ph * 4; break;
          case 2: w = ph * 2 - 1; break;
          case 3: w = ph < 0.5 ? 1 : -1; break;
          case 4: if (ph < before) held = cx.rand() * 2 - 1; w = held; break;
          default: w = Math.sin(ph * 2 * Math.PI);
        }
        x = clamp01(cx.p.center + w * 0.5 * cx.p.depth);
        cx.ctl('out', x);
      },
      reset() { ph = 0; },
      view: () => ({ v: x }),
    }; },
  },
  ad: {
    title: 'ad', cat: 'control', hint: 'an envelope that rises and falls each time an event arrives, as a control',
    ins: [ev('trig')], outs: [{ n: 'out', k: 'c' }],
    params: [par('attack', 0, 2000, 5, { log: false }), par('decay', 5, 5000, 250), par('level', 0, 1, 1)],
    create: cx => { let t = Infinity, top = 1, x = 0; return {
      event(_p, _v, vel) { t = 0; top = (vel > 0 ? vel : 1) * cx.p.level; },
      control(dt) {
        if (t === Infinity) { if (x !== 0) { x = 0; cx.ctl('out', 0); } return; }
        t += dt * 1000;
        const a = Math.max(0.1, cx.p.attack);
        if (t < a) x = top * (t / a);
        else { const d = (t - a) / Math.max(1, cx.p.decay); x = top * Math.exp(-5 * d); if (d > 1.2) { t = Infinity; x = 0; } }
        cx.ctl('out', x);
      },
      reset() { t = Infinity; x = 0; },
      view: () => ({ v: x }),
    }; },
  },
  scale: {
    title: 'scale', cat: 'control', hint: 'squeezes a control into a smaller range, or turns it upside down',
    ins: [ct('in')], outs: [{ n: 'out', k: 'c' }], params: [par('lo', 0, 1, 0), par('hi', 0, 1, 1), par('curve', 0.25, 4, 1, { log: true })],
    create: cx => { let x = 0; return {
      control() { const v = cx.read('in'); if (Number.isNaN(v)) return; x = cx.p.lo + Math.pow(clamp01(v), cx.p.curve) * (cx.p.hi - cx.p.lo); cx.ctl('out', x); },
      view: () => ({ v: x }),
    }; },
  },
  note: {
    title: 'note', cat: 'output', hint: 'plays an instrument',
    ins: [ev('trig'), ev('pitch', false), ev('note'), ct('vel'), ct('len')], outs: [], params: [par('pitch', 0, 127, 60, { int: true }), par('vel', 0, 1, 0.8), par('len', 0.05, 16, 1, { log: true })],
    data: 'instrument',
    create: cx => { let pitch = NaN, sounding = -1, token = 0, last = -1; return {
      event(port, v, vel) {
        if (port === 'pitch') { if (Number.isFinite(v)) pitch = v; return; }
        const n = Math.round(port === 'note' && Number.isFinite(v) ? v : Number.isFinite(pitch) ? pitch : cx.p.pitch);
        if (n < 0 || n > 127) return;
        const cv = cx.read('vel'), v2 = !Number.isNaN(cv) ? cv : vel > 0 ? vel : cx.p.vel;
        const cl = cx.read('len'), lenTicks = !Number.isNaN(cl) ? 0.05 + cl * 4 : cx.p.len;
        const subs = Math.max(1, Math.round(lenTicks * cx.info.subs));
        if (sounding >= 0) cx.host.noteOff(cx.data.target, sounding);
        cx.host.noteOn(cx.data.target, n, v2, sounding, `ns:${cx.id}`);
        sounding = n; last = n; const mine = ++token;
        cx.host.recordNote(cx.id, cx.data.target, n, v2, subs);
        cx.after(subs, () => { if (token === mine && sounding >= 0) { cx.host.noteOff(cx.data.target, sounding); sounding = -1; } }, true);
      },
      reset() { pitch = NaN; },
      stop() { if (sounding >= 0) { cx.host.noteOff(cx.data.target, sounding); sounding = -1; } token++; },
      view: () => ({ n: last, on: sounding >= 0 }),
    }; },
  },
  set: {
    title: 'set', cat: 'output', hint: 'moves a parameter of an instrument',
    ins: [ct('in'), ev('set')], outs: [], params: [par('lo', 0, 1, 0), par('hi', 0, 1, 1), par('smooth', 0, 2000, 30)],
    data: 'parameter',
    create: cx => { let cur = NaN, want = NaN, sent = NaN; return {
      event(_p, v) { want = clamp01(v); },
      control(dt) {
        const c = cx.read('in'); if (!Number.isNaN(c)) want = clamp01(c);
        if (Number.isNaN(want)) return;
        const k = cx.p.smooth > 0 ? 1 - Math.exp(-dt * 1000 / cx.p.smooth) : 1;
        cur = Number.isNaN(cur) ? want : cur + (want - cur) * k;
        if (Math.abs(cur - want) < 1e-4) cur = want;
        const x = cx.p.lo + cur * (cx.p.hi - cx.p.lo);
        if (x !== sent) { sent = x; cx.host.setParam(cx.id, x); }
      },
      reset() { cur = NaN; want = NaN; sent = NaN; },
      view: () => ({ v: Number.isNaN(sent) ? 0 : sent }),
    }; },
  },
  script: {
    title: 'script', cat: 'code', hint: 'a few lines of JavaScript that run for each event',
    ins: [ev('in'), ct('a'), ct('b')], outs: [{ n: 'out', k: 'e' }, { n: 'out2', k: 'e' }, { n: 'ctl', k: 'c' }], params: [], body: 'script',
    create: cx => {
      let code = null, fn = null, failed = false;
      const state = {}, evt = { value: 0, vel: -1 };
      const api = {
        out: (v, vel = evt.vel) => cx.emit('out', Number(v), vel), out2: (v, vel = evt.vel) => cx.emit('out2', Number(v), vel), ctl: x => cx.ctl('ctl', clamp01(Number(x))),
        state, rand: () => cx.rand(), tick: 0, sub: 0, a: 0, b: 0, bpm: 120, mtof: n => 440 * Math.pow(2, (n - 69) / 12),
      };
      return {
        event(_p, v, vel) {
          if (code !== cx.data.code) { code = cx.data.code; const r = compileScript(code ?? DEFAULT_SCRIPT); fn = r.fn; failed = !!r.error; if (r.error) cx.host.report(cx.id, r.error); else cx.host.report(cx.id, null); }
          if (!fn || failed) return;
          const i = cx.info;
          evt.value = v; evt.vel = vel; api.tick = i.tick; api.sub = i.subIdx; api.a = cx.read('a'); api.b = cx.read('b'); api.bpm = i.bpm;
          if (Number.isNaN(api.a)) api.a = 0; if (Number.isNaN(api.b)) api.b = 0;
          try { fn(evt, api); } catch (e) { failed = true; cx.host.report(cx.id, `${e.name}: ${e.message}`); }
        },
        reset() { for (const k of Object.keys(state)) delete state[k]; if (code !== null && !failed) cx.host.report(cx.id, null); failed = false; code = null; },
      };
    },
  },
  run: {
    title: 'run', cat: 'groups', hint: 'starts, stops or flips a group of nodes when an event arrives',
    ins: [ev('in')], outs: [], params: [par('group', 1, 8, 2, { int: true }), par('mode', 0, 2, 0, { int: true, labels: ['start', 'stop', 'flip'] })],
    create: cx => ({ event() { cx.host.setGroup(Math.round(cx.p.group) - 1, Math.round(cx.p.mode)); } }),
  },
  monitor: {
    title: 'monitor', cat: 'output', hint: 'shows the events that pass through it',
    ins: [ev('in')], outs: [{ n: 'out', k: 'e' }], params: [],
    create: cx => { let v = 0, vel = -1; return {
      event(_p, value, velocity) { v = value; vel = velocity; cx.host.monitor(cx.id, v, vel); cx.emit('out', value, velocity); },
      view: () => ({ v, vel }),
    }; },
  },
};

// Port names of a node type: { ins, outs } as [{ n, k }].
export const portsOf = type => ({ ins: NS_TYPES[type]?.ins ?? [], outs: NS_TYPES[type]?.outs ?? [] });

// Params a new node of this type starts with, by name.
export const defaultParams = type => Object.fromEntries((NS_TYPES[type]?.params ?? []).map(p => [p.name, p.def]));
