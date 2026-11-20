// The editing model behind the IT channel's panel: plain functions on the node's data, no drawing and no page. Every function returns a
// new data object (or a new envelope) and leaves its argument alone, so the panel can keep an undo list and the tests can call them.
//
// Sample proxies. A slot of the node plays a sample of the bank. By default it plays all of it, with the loops the bank gives it. A
// slot's proxy, `data.smp[slot].proxy`, picks a stretch of the sample (`start`, `end`, in the bank sample's frames) and may give it loops of
// its own (`loop`, `sus`: { on, start, end, pingpong, xfade }, also in the bank sample's frames). The node does the rest (itchan.js, buildSlot).
//
// Instruments and their envelopes follow the node's own data (see itchan.js): an envelope is { pts: [tick, value, ...], ls, le, ss, se }.

export const ENVELOPES = ['vol', 'pan2', 'pit'];
export const ENVELOPE_NAMES = { vol: 'Volume', pan2: 'Panning', pit: 'Pitch' };
export const ENV_MAX_POINTS = 25;   // what an IT file holds
export const ENV_MAX_TICK = 9999;

// ---- sample proxies ---------------------------------------------------------------------------------------------------------

export const proxyOf = (data, slot) => data?.smp?.[slot]?.proxy ?? null;

// The stretch a slot plays: [start, end) in the bank sample's frames.
export function rangeOf(proxy, length) {
  const start = proxy ? Math.max(0, Math.min(length - 1, Math.floor(proxy.start ?? 0))) : 0;
  const end = proxy ? Math.max(start + 1, Math.min(length, Math.floor(proxy.end ?? length))) : length;
  return [start, end];
}

// The loops a slot has, in the bank sample's frames, and where each comes from: 'own' (the proxy's) or 'bank' (the sample's). `active` is
// false when the loop is off, or lies outside the stretch (which the node drops).
export function loopsOf(bank, proxy) {
  const [a, b] = rangeOf(proxy, bank.data.length);
  const pick = (own, on, start, end, xfade, ping) => {
    const loop = own
      ? { on: own.on !== false, start: own.start ?? 0, end: own.end ?? 0, xfade: own.xfade ?? 0, pingpong: own.pingpong === true }
      : { on: on !== false, start: start ?? 0, end: end ?? 0, xfade: xfade ?? 0, pingpong: ping === true };
    const exists = loop.end - loop.start >= 2, inside = exists && loop.start >= a && loop.end <= b;
    return { ...loop, on: loop.on && exists, from: own ? 'own' : 'bank', exists, active: loop.on && inside, inside };
  };
  return {
    loop: pick(proxy?.loop, bank.loopOn, bank.loopStart, bank.loopEnd, bank.loopXfade, bank.pingpong),
    sus: pick(proxy?.sus, bank.susOn, bank.susStart, bank.susEnd, bank.susXfade, bank.susPingpong),
  };
}

// The data with a change to a slot's proxy. `patch` may hold start, end, loop, sus; a key set to null goes back to the bank's.
export function withProxy(data, slot, patch) {
  const smp = [...(data?.smp ?? [])];
  while (smp.length <= slot) smp.push(null);
  const proxy = { ...(smp[slot]?.proxy ?? {}) };
  for (const [key, value] of Object.entries(patch)) { if (value === null) delete proxy[key]; else proxy[key] = value; }
  const entry = { ...(smp[slot] ?? {}) };
  if (Object.keys(proxy).length) entry.proxy = proxy; else delete entry.proxy;
  smp[slot] = Object.keys(entry).length ? entry : null;
  return { ...data, smp };
}

// Moves the stretch's start or end (`edge` 'start' or 'end') to `frame`, keeping at least 2 frames. The loops stay where they are (the node
// drops a loop that no longer fits, and the panel shows it as dropped).
export function moveRangeEdge(data, slot, edge, frame, length) {
  const [a, b] = rangeOf(proxyOf(data, slot), length);
  const value = Math.round(frame);
  const start = edge === 'start' ? Math.max(0, Math.min(b - 2, value)) : a;
  const end = edge === 'end' ? Math.min(length, Math.max(a + 2, value)) : b;
  const whole = start === 0 && end === length;
  return withProxy(data, slot, whole ? { start: null, end: null } : { start, end });
}

// Sets one loop ('loop' or 'sus') of a slot's proxy. `bank` is the bank sample (its own loop is the starting point when the slot has
// none of its own yet), `change` the fields to change. The loop is kept inside the stretch.
export function setLoop(data, slot, which, bank, change) {
  const have = loopsOf(bank, proxyOf(data, slot))[which];
  const [a, b] = rangeOf(proxyOf(data, slot), bank.data.length);
  const next = { on: have.on, start: have.inside ? have.start : a, end: have.inside ? have.end : b, pingpong: have.pingpong, xfade: have.xfade, ...change };
  next.start = Math.max(a, Math.min(b - 2, Math.round(next.start)));
  next.end = Math.max(next.start + 2, Math.min(b, Math.round(next.end)));
  next.xfade = Math.max(0, Math.min(Math.round(next.xfade), next.start - a, next.end - next.start));
  return withProxy(data, slot, { [which]: next });
}

// Slides a loop along the sample, its length unchanged: its start goes to `start`, held inside the stretch.
export function moveLoop(data, slot, which, bank, start) {
  const have = loopsOf(bank, proxyOf(data, slot))[which];
  const [a, b] = rangeOf(proxyOf(data, slot), bank.data.length), size = have.end - have.start;
  const first = Math.max(a, Math.min(b - size, Math.round(start)));
  return setLoop(data, slot, which, bank, { start: first, end: first + size, on: true });
}

// Back to the bank's stretch and loops.
export const clearProxy = (data, slot) => withProxy(data, slot, { start: null, end: null, loop: null, sus: null });

// ---- instruments ------------------------------------------------------------------------------------------------------------

// A new instrument fades out at this speed once its note is released (the user's choice; IT's own default is none).
export const DEFAULT_FADE = 10;

export function newInstrument(slot = 0) {
  return { nna: 0, dct: 0, dca: 0, fade: DEFAULT_FADE, pps: 0, ppc: 60, gbv: 128, pan: -1, ifc: -1, ifr: -1, map: new Array(120).fill(slot), notes: null, vol: null, pan2: null, pit: null, filter: false };
}

// An instrument table with one instrument for each sample, each playing its own sample on every key: the same as having none,
// until it is edited.
export const instrumentsFor = count => Array.from({ length: Math.max(1, count) }, (_, i) => newInstrument(i));

export function withInstrument(data, index, patch) {
  const ins = [...(data?.ins ?? [])];
  while (ins.length <= index) ins.push(null);
  ins[index] = { ...(ins[index] ?? newInstrument(0)), ...patch };
  return { ...data, ins };
}

// ---- envelopes --------------------------------------------------------------------------------------------------------------

// A starting envelope for the kind: volume a short rise and fall with a sustain point, panning and pitch flat in the middle.
export function newEnvelope(kind) {
  return kind === 'vol'
    ? { pts: [0, 0, 8, 64, 48, 40, 96, 0], ls: -1, le: -1, ss: 2, se: 2 }
    : { pts: [0, 32, 96, 32], ls: -1, le: -1, ss: -1, se: -1 };
}

const pairs = env => { const out = []; for (let i = 0; i < env.pts.length; i += 2) out.push([env.pts[i], env.pts[i + 1]]); return out; };
const flat = list => list.flatMap(([x, y]) => [x, y]);
const clampValue = v => Math.max(0, Math.min(64, Math.round(v)));

// Shifts the point numbers of the marks when a point is added at index `at` (delta +1) or removed (delta -1).
function shifted(env, at, delta) {
  const fix = i => (i < 0 ? i : delta > 0 ? (i >= at ? i + 1 : i) : (i > at ? i - 1 : i));
  return { ...env, ls: fix(env.ls), le: fix(env.le), ss: fix(env.ss), se: fix(env.se) };
}

// Adds a point at a tick and value, keeping the ticks in order. Returns { env, index }; the same envelope and index -1 when it is full or the tick is taken.
export function addPoint(env, tick, value) {
  const list = pairs(env), t = Math.max(0, Math.min(ENV_MAX_TICK, Math.round(tick)));
  if (list.length >= ENV_MAX_POINTS || list.some(([x]) => x === t)) return { env, index: -1 };
  let at = list.findIndex(([x]) => x > t);
  if (at < 0) at = list.length;
  list.splice(at, 0, [t, clampValue(value)]);
  return { env: { ...shifted(env, at, +1), pts: flat(list) }, index: at };
}

// Moves a point; its tick stays between its neighbours' (the first point stays at tick 0). Returns the new envelope.
export function movePoint(env, index, tick, value) {
  const list = pairs(env);
  const lo = index === 0 ? 0 : list[index - 1][0] + 1;
  const hi = index === 0 ? 0 : index === list.length - 1 ? ENV_MAX_TICK : list[index + 1][0] - 1;
  list[index] = [Math.max(lo, Math.min(Math.max(lo, hi), Math.round(tick))), clampValue(value)];
  return { ...env, pts: flat(list) };
}

// Removes a point (an envelope keeps at least two).
export function removePoint(env, index) {
  const list = pairs(env);
  if (list.length <= 2 || index < 0 || index >= list.length) return env;
  list.splice(index, 1);
  return { ...shifted(env, index, -1), pts: flat(list) };
}

// Sets the loop or sustain marks to a pair of point numbers (kind 'loop' or 'sus'); `from` null clears them.
export function setMarks(env, kind, from, to) {
  const keys = kind === 'loop' ? ['ls', 'le'] : ['ss', 'se'];
  if (from === null) return { ...env, [keys[0]]: -1, [keys[1]]: -1 };
  return { ...env, [keys[0]]: Math.min(from, to), [keys[1]]: Math.max(from, to) };
}
