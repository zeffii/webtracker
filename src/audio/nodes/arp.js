// Arpeggiator: sits in an instrument's graph (no wires) and changes what that instrument does with the notes it is
// given. Held keys no longer sound together; they become a pool, and the arp plays them one at a time, a step at a time,
// in the order the mode asks for. It works for notes from the pattern, from the keyboard and from MIDI alike, because it
// takes them before the voices do (see GraphRuntime.note).
//
// Time. A step lasts `rate` ticks, so the arp follows the song's tempo. While the song plays, steps sit on the song's
// grid (step 0 is the start of the song) and the arp never drifts; while it is stopped, the arp runs on its own clock at
// the same tempo, so a keyboard can be played with the song stopped. A new arp starts on the next step, never mid-step.
// Events are made once per audio block, so a step can land a few ms off its ideal place (the block is about 3 ms).
//
// The 16 bars drawn under the node are the step mask: the bar's height is the velocity of that step, and no bar is a rest.
// `steps` says how many of the 16 are used (the mask is read by step number, so a rest is a rest whatever the mode).
//
// Modes (what the pool is turned into; the pool is the held notes, repeated over `octaves` octaves):
export const MODES = [
  'up', 'down', 'up/down', 'down/up', 'up/down+', 'down/up+', 'converge', 'diverge', 'converge/diverge',
  'as played', 'random', 'random other', 'random once', 'chord', 'repeat x2', 'repeat x4',
  'pinky up', 'pinky up/down', 'thumb up', 'thumb up/down', 'interval cycle',
];
// A step is this many ticks long: 1 is a sixteenth with the usual 4 ticks to the beat.
export const RATES = [0.25, 1 / 3, 0.5, 2 / 3, 1, 1.5, 2, 3, 4, 6, 8, 16];
export const RATE_NAMES = ['1/4 tick', '1/3 tick', '1/2 tick', '2/3 tick', '1 tick', '1.5 ticks', '2 ticks', '3 ticks', '4 ticks', '6 ticks', '8 ticks', '16 ticks'];
export const RETRIGGER = ['off', 'every note', 'every 4 steps', 'every 8 steps', 'every 16 steps'];

const MODE = 0, RATE = 1, GATE = 2, SWING = 3, OCT = 4, TRANSPOSE = 5, STEPS = 6, HOLD = 7, RETRIG = 8, OFFSET = 9,
  REPEATS = 10, SEED = 11, VELTYPE = 12, LEVEL = 13, HUMAN = 14, CYC1 = 15, CYC2 = 16, THRU = 17;

// Small seeded generator, so the same seed always gives the same random arp.
const rng = seed => {
  let a = (seed * 2654435761 + 1) >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
};

// The note order for one pass of a (non-random) mode. `pool` is sorted low to high, or in played order for 'as played'.
export function orderOf(mode, pool, x = 4, y = 7) {
  const n = pool.length, up = pool, down = [...pool].reverse();
  if (!n) return [];
  const mid = list => (list.length > 2 ? list.slice(1, -1) : []);   // without the two ends
  const converge = () => { const out = []; for (let i = 0, j = n - 1; i <= j; i++, j--) { out.push(up[i]); if (j !== i) out.push(up[j]); } return out; };
  switch (MODES[mode]) {
    case 'up': case 'as played': case 'random once': return [...up];
    case 'down': return [...down];
    case 'up/down': return [...up, ...mid(down)];
    case 'down/up': return [...down, ...mid(up)];
    case 'up/down+': return [...up, ...down];
    case 'down/up+': return [...down, ...up];
    case 'converge': return converge();
    case 'diverge': return converge().reverse();
    case 'converge/diverge': { const c = converge(); return [...c, ...mid(c.slice().reverse())]; }
    case 'chord': return [...up];
    case 'repeat x2': return up.flatMap(v => [v, v]);
    case 'repeat x4': return up.flatMap(v => [v, v, v, v]);
    case 'pinky up': return n < 2 ? [...up] : up.slice(0, -1).flatMap(v => [v, up[n - 1]]);
    case 'pinky up/down': {
      if (n < 2) return [...up];
      const top = up[n - 1], asc = up.slice(0, -1).flatMap(v => [v, top]);
      return [...asc, ...up.slice(1, -1).reverse().flatMap(v => [v, top])];
    }
    case 'thumb up': return n < 2 ? [...up] : up.slice(1).flatMap(v => [up[0], v]);
    case 'thumb up/down': {
      if (n < 2) return [...up];
      const low = up[0], asc = up.slice(1).flatMap(v => [low, v]);
      return [...asc, ...up.slice(1, -1).reverse().flatMap(v => [low, v])];
    }
    case 'interval cycle': return up.flatMap(v => [v, v + x, v + y]);
    default: return [...up];
  }
}

export default {
  type: 'arp',
  inputs: [],
  outputs: [],
  category: 'Control',
  shared: true,       // one for the instrument, never copied for each voice
  noteFilter: true,   // the runtime gives it the instrument's notes first, and plays what it makes
  editor: 'gate',     // the step mask: the same 16-bar drawing as the trance gate
  shape: 'rounded',
  glyph: 'arp',
  face: 'arp',        // the patcher draws the step mask and the settings on the node itself
  size: { w: 236, h: 92 },
  params: [
    { name: 'mode', min: 0, max: MODES.length - 1, def: 0, int: true },
    { name: 'rate', min: 0, max: RATES.length - 1, def: 4, int: true },    // index into RATES, in ticks
    { name: 'gate', min: 0.05, max: 2, def: 0.6 },                          // note length, as a fraction of the step
    { name: 'swing', min: 50, max: 75, def: 50 },                           // percent, like the song's swing: 50 straight, 66.7 triplet
    { name: 'octaves', min: 1, max: 4, def: 1, int: true },                 // the pool repeats this many octaves up
    { name: 'transpose', min: -24, max: 24, def: 0, int: true },            // semitones
    { name: 'steps', min: 1, max: 16, def: 16, int: true },                 // length of the step mask
    { name: 'hold', min: 0, max: 1, def: 0, int: true },                    // keep playing after the keys are let go
    { name: 'retrigger', min: 0, max: RETRIGGER.length - 1, def: 1, int: true },
    { name: 'offset', min: 0, max: 15, def: 0, int: true },                 // start this many steps into the pattern
    { name: 'repeats', min: 0, max: 16, def: 0, int: true },                // passes of the pattern before it stops; 0 is for ever
    { name: 'seed', min: 0, max: 255, def: 1, int: true },                  // for the random modes
    { name: 'veltype', min: 0, max: 1, def: 0, int: true },                 // 0 the played velocity, 1 a fixed one
    { name: 'level', min: 0, max: 1, def: 1 },                              // the fixed velocity, and the master level of the arp
    { name: 'humanize', min: 0, max: 1, def: 0 },                           // random variation of the velocity
    { name: 'cycle1', min: 0, max: 24, def: 4 , int: true },                // interval cycle: first interval, semitones
    { name: 'cycle2', min: 0, max: 24, def: 7, int: true },                 // interval cycle: second interval, semitones
    { name: 'thru', min: 0, max: 1, def: 0, int: true },                    // the played keys sound as well
  ],
  create({ sampleRate, clock, data, notes }) {
    const send = msg => notes?.(msg);
    let mask = (data?.gate?.length === 16 ? data.gate : null) ?? Array(16).fill(1);
    const keys = [];            // physically held keys: { note, vel }
    let pool = [];              // what the arp plays from: the keys, or the latched ones
    let latched = false;        // hold: the pool outlives the keys until a new key is pressed
    let cursor = 0, started = false;   // position in steps (see process)
    let lastVel = 1;            // the velocity the keys were pressed with
    let idx = 0;                // position in the pattern
    let passes = 0;
    let restart = false;        // the pattern starts again at the next step
    let sounding = [];          // { note, off } notes the arp has started and not yet ended; off in samples from now
    let bag = [], bagAt = 0, once = null, rand = rng(1), lastSeed = 1;
    let clockSamples = 0;       // counts samples, to time the note offs
    let lastSig = '';           // the pool and mode the random-once pattern was made for

    const stopAll = () => { for (const s of sounding) send({ type: 'noteOff', note: s.note }); sounding = []; };
    const reseed = seed => { rand = rng(seed); lastSeed = seed; bag = []; once = null; };

    return {
      message(msg) { if (msg.type === 'gate' && Array.isArray(msg.points)) mask = msg.points.slice(0, 16); },
      // Called by the runtime for every note event on the instrument.
      input(msg, params, slots) {
        const hold = params && slots ? params[slots[HOLD]] >= 0.5 : false;
        const thru = params && slots ? params[slots[THRU]] >= 0.5 : false;
        const retrig = params && slots ? Math.round(params[slots[RETRIG]]) : 1;
        if (msg.type === 'noteOn') {
          if (latched && keys.length === 0) { pool = []; latched = false; }   // a new chord replaces a latched one
          const at = keys.findIndex(k => k.note === msg.note);
          if (at >= 0) keys.splice(at, 1);
          keys.push({ note: msg.note, vel: msg.vel ?? 1 });
          lastVel = msg.vel ?? 1;
          pool = keys.map(k => k.note);
          if (retrig === 1) restart = true;
          if (thru) send(msg);
        } else if (msg.type === 'noteOff') {
          const at = keys.findIndex(k => k.note === msg.note);
          if (at >= 0) keys.splice(at, 1);
          if (hold) { latched = true; if (keys.length) pool = keys.map(k => k.note); } else pool = keys.map(k => k.note);
          if (thru) send(msg);
          if (!hold && keys.length === 0) { stopAll(); }
        } else if (msg.type === 'allOff') {
          keys.length = 0; pool = []; latched = false; stopAll();
          if (thru) send(msg);
        } else if (msg.type === 'noteCut') {
          keys.length = 0; pool = []; latched = false; sounding = [];
          send(msg);
        }
      },
      process(inputs, outputs, n, params, slots) {
        const p = i => params[slots[i]];
        // turning hold off with no keys down ends the arp
        if (latched && p(HOLD) < 0.5 && keys.length === 0) { latched = false; pool = []; stopAll(); }
        const seed = Math.round(p(SEED));
        if (seed !== lastSeed) reseed(seed);

        // note offs that fall due by the start of this block
        if (sounding.length) {
          const keep = [];
          for (const s of sounding) { if (s.off <= clockSamples) send({ type: 'noteOff', note: s.note }); else keep.push(s); }
          sounding = keep;
        }
        const tickSamples = clock?.tickSamples ?? sampleRate * 0.125;
        const rate = RATES[Math.max(0, Math.min(RATES.length - 1, Math.round(p(RATE))))];
        const stepSamples = tickSamples * rate;
        // where this block starts, in steps: on the song's grid while it plays (and back on it if the song jumped), else on the arp's own clock
        let start = cursor;
        if (clock?.playing === true) {
          const at = (clock.songPos ?? 0) / rate;
          if (!started || Math.abs(at - cursor) > 0.5) start = at;
        }
        started = true;
        const end = start + n / stepSamples;
        const swing = (Math.max(50, Math.min(75, p(SWING))) - 50) / 50;   // 0 to 0.5 of a step
        for (let m = Math.max(0, Math.floor(start) - 1); m <= Math.ceil(end) + 1; m++) {
          const t = m + (m % 2 === 1 ? swing : 0);
          if (t >= start && t < end) fire(m, p);
        }
        cursor = end;
        clockSamples += n;
      },
    };

    // One step: choose the note and start it.
    function fire(m, p) {
      const activeKeys = pool;
      if (!activeKeys.length) { idx = 0; passes = 0; restart = false; return; }
      const steps = Math.max(1, Math.min(16, Math.round(p(STEPS))));
      const retrig = Math.round(p(RETRIG));
      if (retrig >= 2 && m % ([4, 8, 16][retrig - 2]) === 0) restart = true;
      if (restart) { idx = Math.round(p(OFFSET)); passes = 0; restart = false; bag = []; once = null; reseed(Math.round(p(SEED))); }
      const mode = Math.round(p(MODE)), name = MODES[mode];
      const octaves = Math.max(1, Math.min(4, Math.round(p(OCT)))), shift = Math.round(p(TRANSPOSE));
      // the pool, over the octaves
      const played = name === 'as played';
      const base = played ? [...activeKeys] : [...activeKeys].sort((a, b) => a - b);
      const wide = [];
      for (let o = 0; o < octaves; o++) for (const v of base) wide.push(v + 12 * o + shift);
      const repeats = Math.round(p(REPEATS));
      const level = mask[m % steps] ?? 1;
      let chosen = [];
      let length;
      if (name === 'random' || name === 'random other') {
        length = 1;
        if (name === 'random') chosen = [wide[Math.floor(rand() * wide.length)]];
        else {
          if (bagAt >= bag.length || bag.length !== wide.length) { bag = [...wide]; for (let i = bag.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [bag[i], bag[j]] = [bag[j], bag[i]]; } bagAt = 0; }
          chosen = [bag[bagAt++]];
        }
      } else if (name === 'chord') {
        chosen = wide; length = 1;
      } else {
        let order;
        if (name === 'random once') {
          const sig = wide.join(',');
          if (!once || sig !== lastSig) { once = [...wide]; for (let i = once.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [once[i], once[j]] = [once[j], once[i]]; } lastSig = sig; }
          order = once;
        } else order = orderOf(mode, wide, Math.round(p(CYC1)), Math.round(p(CYC2)));
        length = order.length;
        chosen = length ? [order[idx % length]] : [];
        if (repeats > 0 && Math.floor(idx / length) >= repeats) { chosen = []; }   // the passes are used up
      }
      if (name === 'random' || name === 'random other' || name === 'chord') { if (repeats > 0 && idx >= repeats * Math.max(1, wide.length)) chosen = []; }
      idx++;
      if (level <= 0 || !chosen.length) return;   // a rest
      const fixed = Math.round(p(VELTYPE)) === 1;
      const gate = p(GATE), master = p(LEVEL);
      const stepSamples = (clock?.tickSamples ?? sampleRate * 0.125) * RATES[Math.max(0, Math.min(RATES.length - 1, Math.round(p(RATE))))];
      for (const note of chosen) {
        let vel = fixed ? master : lastVel * master;
        vel *= level;
        const human = p(HUMAN);
        if (human > 0) vel *= 1 - human * 0.5 * rand();
        const n = Math.max(0, Math.min(127, Math.round(note)));
        // a note still sounding from the last step on the same key is ended first, so it can be heard again
        const again = sounding.findIndex(s => s.note === n);
        if (again >= 0) { send({ type: 'noteOff', note: n }); sounding.splice(again, 1); }
        send({ type: 'noteOn', note: n, vel: Math.max(0.01, Math.min(1, vel)) });
        sounding.push({ note: n, off: clockSamples + Math.max(64, stepSamples * gate) });
      }
    }
  },
};
