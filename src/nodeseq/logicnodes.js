// Nodes that decide where events go and when: switches, gates, counters and the like. They have no dependencies, so nodes.js can take them in.
// See nodes.js for what `cx` offers a node and for how a node type is written.
const ev = n => ({ n, k: 'e', hot: true });
const out = n => ({ n, k: 'e' });
const par = (name, min, max, def, extra = {}) => ({ name, min, max, def, ...extra });

export const LOGIC_TYPES = {
  section: {
    title: 'section', cat: 'time', hint: 'passes the events of the clock on only while the song is between start and end: a part of the song. Ticks, or bars; with "end inclusive" off the end tick itself is left out, so the next section can start on it. start and end are events too, on the first and the last tick; on is a control that is 1 inside; pos runs 0 to 1 across the section',
    ins: [ev('in')], outs: [out('out'), out('start'), out('end'), { n: 'on', k: 'c' }, { n: 'pos', k: 'c' }],
    params: [par('start', 0, 100000, 0, { int: true }), par('end', 0, 100000, 64, { int: true }), par('inclusive', 0, 1, 0, { int: true, labels: ['no', 'yes'] }), par('unit', 0, 1, 0, { int: true, labels: ['ticks', 'bars'] })],
    create: cx => {
      let was = false;
      // the first and the last tick of the section, from the node's own parameters (in bars, a bar is barTicks ticks)
      const span = () => { const k = Math.round(cx.p.unit) === 1 ? cx.info.barTicks : 1, e = Math.round(cx.p.end) * k; return { a: Math.round(cx.p.start) * k, z: cx.p.inclusive >= 0.5 ? e : e - 1 }; };
      const inside = tick => { const { a, z } = span(); return tick >= a && tick <= z; };
      return {
        event(_p, v, vel) { if (inside(cx.info.tick)) cx.emit('out', v, vel); },
        tick() {
          const t = cx.info.tick, { a, z } = span(), now = t >= a && t <= z;
          if (now && !was) cx.emit('start', t, -1);
          if (now && t === z) cx.emit('end', t, -1);
          was = now; cx.ctl('on', now ? 1 : 0); cx.ctl('pos', now ? (z === a ? 0 : (t - a) / (z - a)) : 0);
        },
        reset() { was = false; },
        view: () => ({ v: was ? 1 : 0 }),
      };
    },
  },
  switch: {
    title: 'switch', cat: 'logic', hint: 'sends each event out of one of four outputs. A number at pick chooses which (0 is the first); or, with "by" set to value, the event\'s own number chooses',
    ins: [ev('in'), ev('pick')], outs: [out('o1'), out('o2'), out('o3'), out('o4')],
    params: [par('by', 0, 1, 0, { int: true, labels: ['pick port', 'event value'] })],
    create: cx => { let at = 0, last = -1; return {
      event(port, v, vel) {
        if (port === 'pick') { at = Math.max(0, Math.round(v)) % 4; return; }
        last = cx.p.by >= 0.5 ? ((Math.round(v) % 4) + 4) % 4 : at;
        cx.emit(`o${last + 1}`, v, vel);
      },
      reset() { at = 0; last = -1; },
      view: () => ({ i: last }),
    }; },
  },
  pick: {
    title: 'pick', cat: 'logic', hint: 'lets only one of four inputs through: a number at pick chooses which (0 is the first), the others are blocked',
    ins: [ev('pick'), ev('a'), ev('b'), ev('c'), ev('d')], outs: [out('out')],
    params: [],
    create: cx => { let at = 0; return {
      event(port, v, vel) {
        if (port === 'pick') { at = Math.max(0, Math.round(v)) % 4; return; }
        if ('abcd'.indexOf(port) === at) cx.emit('out', v, vel);
      },
      reset() { at = 0; },
      view: () => ({ i: at }),
    }; },
  },
  gate: {
    title: 'gate', cat: 'logic', hint: 'combines two event streams. and: an event at a or b goes through only if the other has fired in the last "window" subticks; or: either goes through; a unless b: a goes through unless b fired in the window',
    ins: [ev('a'), ev('b')], outs: [out('out')],
    params: [par('mode', 0, 2, 0, { int: true, labels: ['and', 'or', 'a unless b'] }), par('window', 0, 64, 0, { int: true })],
    create: cx => { let lastA = -1e9, lastB = -1e9; return {
      event(port, v, vel) {
        const now = cx.info.abs, win = Math.round(cx.p.window), mode = Math.round(cx.p.mode);
        if (port === 'a') lastA = now; else lastB = now;
        const other = port === 'a' ? lastB : lastA, near = now - other <= win;
        if (mode === 0 ? near : mode === 1 ? true : (port === 'a' && !near)) cx.emit('out', v, vel);
      },
      reset() { lastA = lastB = -1e9; },
    }; },
  },
  counter: {
    title: 'counter', cat: 'logic', hint: 'counts the events that arrive and sends the count (0, 1, 2 ...), wrapping round at n; wrap sends an event each time it wraps. Reset starts again',
    ins: [ev('in'), ev('reset')], outs: [out('out'), out('wrap')],
    params: [par('n', 1, 256, 8, { int: true })],
    create: cx => { let count = 0, last = -1; return {
      event(port) {
        if (port === 'reset') { count = 0; return; }
        const n = Math.max(1, Math.round(cx.p.n)); last = count % n;
        cx.emit('out', last, -1); count = last + 1;
        if (count >= n) { count = 0; cx.emit('wrap', last, -1); }
      },
      reset() { count = 0; last = -1; },
      view: () => ({ i: last }),
    }; },
  },
  compare: {
    title: 'compare', cat: 'logic', hint: 'tests an event\'s number against x: the event leaves by yes if the test is true, by no if not',
    ins: [ev('in')], outs: [out('yes'), out('no')],
    params: [par('test', 0, 5, 0, { int: true, labels: ['>', '<', '=', '≥', '≤', '≠'] }), par('x', -127, 127, 0)],
    create: cx => ({
      event(_p, v, vel) {
        const x = cx.p.x, t = Math.round(cx.p.test);
        const yes = t === 0 ? v > x : t === 1 ? v < x : t === 2 ? v === x : t === 3 ? v >= x : t === 4 ? v <= x : v !== x;
        cx.emit(yes ? 'yes' : 'no', v, vel);
      },
    }),
  },
  flip: {
    title: 'flip', cat: 'logic', hint: 'sends events out of a, then b, then a again: every other event goes each way. Reset starts at a',
    ins: [ev('in'), ev('reset')], outs: [out('a'), out('b')],
    params: [],
    create: cx => { let on = false; return {
      event(port, v, vel) { if (port === 'reset') { on = false; return; } cx.emit(on ? 'b' : 'a', v, vel); on = !on; },
      reset() { on = false; },
      view: () => ({ i: on ? 1 : 0 }),
    }; },
  },
  once: {
    title: 'once', cat: 'logic', hint: 'lets through only the nth event after the start (or after reset), and nothing else: a thing that happens once',
    ins: [ev('in'), ev('reset')], outs: [out('out')],
    params: [par('n', 1, 4096, 1, { int: true })],
    create: cx => { let seen = 0; return {
      event(port, v, vel) { if (port === 'reset') { seen = 0; return; } seen++; if (seen === Math.round(cx.p.n)) cx.emit('out', v, vel); },
      reset() { seen = 0; },
      view: () => ({ i: seen }),
    }; },
  },
  ratchet: {
    title: 'ratchet', cat: 'logic', hint: 'repeats an event: it is sent "count" times, "gap" subticks apart, each a little quieter by "fade"',
    ins: [ev('in')], outs: [out('out')],
    params: [par('count', 1, 16, 3, { int: true }), par('gap', 1, 16, 1, { int: true }), par('fade', 0, 1, 0)],
    create: cx => ({
      event(_p, v, vel) {
        const n = Math.max(1, Math.round(cx.p.count)), gap = Math.max(1, Math.round(cx.p.gap)), base = vel >= 0 ? vel : 1;
        for (let k = 0; k < n; k++) {
          const level = vel >= 0 || cx.p.fade > 0 ? base * (1 - cx.p.fade * k / n) : -1;
          if (k === 0) cx.emit('out', v, level); else cx.after(k * gap, () => cx.emit('out', v, level));
        }
      },
    }),
  },
  latch: {
    title: 'latch', cat: 'logic', hint: 'remembers the last number that arrived at in, and sends it again each time an event arrives at fire: a number that can be asked for later (sample and hold)',
    ins: [ev('in'), ev('fire')], outs: [out('out')],
    params: [],
    create: cx => { let held = NaN; return {
      event(port, v, vel) { if (port === 'in') { held = v; return; } if (!Number.isNaN(held)) cx.emit('out', held, vel); },
      reset() { held = NaN; },
      view: () => ({ v: Number.isNaN(held) ? 0 : held }),
    }; },
  },
  drunk: {
    title: 'drunk', cat: 'values', hint: 'a random walk: each event moves the number up or down by up to "step", kept between lo and hi; sent out and held as a control',
    ins: [ev('next'), ev('reset')], outs: [out('value'), { n: 'out', k: 'c' }],
    params: [par('lo', -127, 127, 0), par('hi', -127, 127, 12), par('step', 0, 24, 2), par('int', 0, 1, 1, { int: true, labels: ['no', 'whole'] })],
    create: cx => { let x = null; return {
      event(port) {
        const lo = Math.min(cx.p.lo, cx.p.hi), hi = Math.max(cx.p.lo, cx.p.hi);
        if (port === 'reset' || x === null) x = (lo + hi) / 2;
        else x = Math.min(hi, Math.max(lo, x + (cx.rand() * 2 - 1) * cx.p.step));
        const v = cx.p.int >= 0.5 ? Math.round(x) : x;
        cx.ctl('out', hi === lo ? 0 : (v - lo) / (hi - lo)); cx.emit('value', v, -1);
      },
      reset() { x = null; },
      view: () => ({ v: x ?? 0 }),
    }; },
  },
};
