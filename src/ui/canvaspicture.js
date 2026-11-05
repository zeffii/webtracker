// A canvas picture: the live picture drawn by JavaScript on a 2D canvas, the way Processing does it. The text is a program with an optional
// setup() that runs once and a draw() that runs every frame; its variables stay between frames. It is the other kind of picture beside the
// GLSL shader: both live in the project's list of pictures and the shader lane's Shd column picks between them.
//
// What the program can use is the object `world` below: names like T, hit("kick"), ticked() and ctx are looked up in it (the program runs
// inside `with (world)`), so they are plain names in the code and always hold this frame's value. The manual is canvasguide.js.
//
// The canvas is not cleared between frames (call background() or fade() at the start of draw(), or leave the old frame for trails).
// A mistake while it runs stops that picture and shows the message under the picture; changing the text starts it again.
const TAU = Math.PI * 2;
const clamp = (v, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
const lerp = (a, b, t) => a + (b - a) * t;
const ease = t => { t = clamp(t); return t * t * (3 - 2 * t); };   // slow-fast-slow, 0 to 1

// a small hash noise, the same every run: noise(x) or noise(x, y), smooth, 0 to 1
const hash = (x, y) => { let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263)) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
const noise = (x, y = 0) => {
  const xi = Math.floor(x), yi = Math.floor(y), fx = ease(x - xi), fy = ease(y - yi);
  return lerp(lerp(hash(xi, yi), hash(xi + 1, yi), fx), lerp(hash(xi, yi + 1), hash(xi + 1, yi + 1), fx), fy);
};

const css = c => `rgb(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)})`;

// Runs the program once and returns { setup, draw }. The two lines before the text are why a line number from an error is 3 too big.
export const WRAP_LINES = 3;
function compile(text) {
  // eslint-disable-next-line no-new-func
  return new Function('world', `with (world) {\n${text}\n;return { setup: typeof setup === 'function' ? setup : null, draw: typeof draw === 'function' ? draw : null };\n}\n//# sourceURL=wax-canvas`);
}
export const lineOf = err => {
  const m = /wax-canvas:(\d+):/.exec(String(err?.stack ?? '')) ?? /<anonymous>:(\d+):/.exec(String(err?.stack ?? ''));
  return m ? Math.max(1, Number(m[1]) - WRAP_LINES) : 0;
};
const say = err => `${String(err?.message ?? err)}${lineOf(err) ? ` (line ${lineOf(err)})` : ''}`;

// canvas: a 2D canvas, `size` pixels square; onError(text) hears a mistake in the picture on show ('' when it runs fine).
export function createCanvasPicture(canvas, { size = 300, colours = [[.30, .74, .80], [.62, .97, .98]], onError = () => {} } = {}) {
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext('2d');
  let sources = [], shown = null, frames = 0, paletteC1 = css(colours[0]), paletteC2 = css(colours[1]);
  const entries = new Map();   // picture number -> { text, fn, handlers, error, ready }
  let names = [];
  let events = [];

  const laneAt = key => (typeof key === 'number' ? (key >= 0 && key < names.length ? key : -1) : names.findIndex(([id, inst]) => id === key || inst === key));
  const data = { current: null };
  const world = {
    ctx, W: size, H: size, S: size,
    T: 0, dt: 0, frame: 0, tick: 0, frac: 0, song: 0, beat: 0, bar: 0, playing: false,
    C1: paletteC1, C2: paletteC2,
    TAU, PI: Math.PI, lerp, clamp, ease, noise,
    map: (v, a, b, c, d) => c + (d - c) * ((v - a) / ((b - a) || 1)),
    easeOut: t => 1 - (1 - clamp(t)) ** 3, easeIn: t => clamp(t) ** 3,
    fract: v => v - Math.floor(v),
    rand: (a = 1, b) => { const r = Math.random(); return b === undefined ? r * a : a + r * (b - a); },
    hash: (a, b = 0) => hash(a, b),
    hsl: (h, s = 0.7, l = 0.55, a = 1) => `hsla(${((h % 1) + 1) % 1 * 360},${clamp(s) * 100}%,${clamp(l) * 100}%,${clamp(a)})`,
    alpha: (colour, a) => {   // a colour from C1 or C2 (or rgb(...)) with an opacity
      const m = /rgba?\(([^)]*)\)/.exec(String(colour));
      if (!m) return colour;
      const [r, g, b] = m[1].split(',').map(Number);
      return `rgba(${r},${g},${b},${clamp(a)})`;
    },
    background(colour = '#111') { ctx.save(); ctx.globalAlpha = 1; ctx.fillStyle = colour; ctx.fillRect(0, 0, world.W, world.H); ctx.restore(); },
    fade(amount = 0.15, colour = '#111') { ctx.save(); ctx.globalAlpha = clamp(amount); ctx.fillStyle = colour; ctx.fillRect(0, 0, world.W, world.H); ctx.restore(); },
    // the song, by lane name (its id or its instrument's name) or number from 0; an unknown name reads 0
    hit: key => { const i = laneAt(key); return i < 0 ? 0 : data.current.lane[i * 4]; },
    pitch: key => { const i = laneAt(key); return i < 0 ? 0 : data.current.lane[i * 4 + 1]; },
    vel: key => { const i = laneAt(key); return i < 0 ? 0 : data.current.lane[i * 4 + 2]; },
    held: key => { const i = laneAt(key); return i < 0 ? 0 : data.current.lane[i * 4 + 3]; },
    hits: () => data.current.HITS,
    since: key => { const i = laneAt(key); return i < 0 ? 1e3 : data.current.since[i]; },
    cell: (key, ahead = 0) => { const i = laneAt(key); const c = i < 0 ? null : data.current.peek(i, ahead); return c ? { hit: c[0], pitch: c[1], vel: c[2], off: c[3] } : null; },
    lanes: () => names.map(([id, inst]) => ({ id, inst })),
    ticked: () => events,
    onNote(key, fn) { current?.handlers.push({ key, fn }); },
  };
  let current = null;
  for (const name of ['abs', 'acos', 'asin', 'atan', 'atan2', 'ceil', 'cos', 'exp', 'floor', 'hypot', 'log', 'max', 'min', 'pow', 'round', 'sign', 'sin', 'sqrt', 'tan']) world[name] = Math[name];

  const build = (i, text) => {
    const e = { text, fn: null, handlers: [], error: '', ready: false, broken: false };
    entries.set(i, e);
    const before = current; current = e;
    try {
      const made = compile(text)(world);
      e.fn = made;
      world.W = world.H = world.S = size;
      ctx.save();
      made.setup?.();
      ctx.restore();
    } catch (err) { e.error = say(err); e.broken = true; }
    current = before;
    return e;
  };

  return {
    // one text per picture; null where that picture is a shader, not a canvas. Only the ones whose text changed start again.
    setSources(list) {
      sources = list;
      for (const [i, e] of [...entries]) if (list[i] == null || list[i] !== e.text) entries.delete(i);
      shown = null;
    },
    isCanvas: i => sources[Math.max(0, Math.min(sources.length - 1, Math.floor(i ?? 0)))] != null,
    setColours(pair) { paletteC1 = world.C1 = css(pair[0]); paletteC2 = world.C2 = css(pair[1]); },
    resize(s) { if (s === size) return; size = s; canvas.width = s; canvas.height = s; world.W = world.H = world.S = s; for (const i of [...entries.keys()]) entries.delete(i); shown = null; },
    // Draws the picture `d.shader` if it is a canvas picture and says so (true). `d` is createVisData's object.
    draw(d) {
      const i = Math.max(0, Math.min(sources.length - 1, Math.floor(d.shader ?? 0)));
      const text = sources[i];
      if (text == null) { shown = null; return false; }
      let e = entries.get(i);
      if (!e) {
        ctx.fillStyle = '#111'; ctx.fillRect(0, 0, size, size);
        e = build(i, text);
      }
      if (shown !== e) { shown = e; onError(e.error); }
      if (e.broken) return true;
      data.current = d; names = d.names;
      frames++;
      Object.assign(world, { T: d.T, dt: d.dt, frame: frames, tick: d.tick, frac: d.frac, song: d.song, beat: d.BEAT, bar: d.BEAT / (d.beatsPerBar ?? 4), playing: d.playing });
      world.W = world.H = world.S = size;
      events = d.ticks;
      current = e;
      try {
        for (const t of events) for (const n of t.notes) for (const h of e.handlers) if (h.key === '*' || laneAt(h.key) === n.lane) h.fn(n);
        if (e.fn.draw) { ctx.save(); e.fn.draw(); ctx.restore(); }
      } catch (err) { e.broken = true; e.error = say(err); onError(e.error); }
      current = null;
      return true;
    },
    get size() { return size; },
  };
}
