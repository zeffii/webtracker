// Noise in every colour. `tilt` is the slope of the spectrum in dB per octave: -6 brown (a deep rumble), -3 pink (even
// across the octaves, like rain), 0 white, +3 blue, +6 violet (a thin hiss); the values between blend neighbours. The
// colours are matched in loudness, so moving tilt changes the tone, not the level. Silent until the first note, like the
// oscillator, unless `free` is on, and then it runs by itself. A note restarts the noise from the same seed, so every hit
// is the same hit (a snare that never changes under your hands); set `seed` to another number for another texture.
const LEVEL = 0, TILT = 1, SEED = 2, RESTART = 3, FREE = 4;
// loudness of each colour against white, measured
const G_BROWN = 0.03189, G_PINK = 0.33605, G_BLUE = 0.55922, G_VIOLET = 0.70775;

export default {
  type: 'noise',
  inputs: [],
  outputs: ['out'],
  category: 'Sources',
  generator: true,   // makes sound from notes, so the instrument screen can play it from the keyboard
  shape: 'rounded',
  glyph: 'noise',
  kinds: { out: 'audio' },
  params: [
    { name: 'level', min: 0, max: 1, def: 1 },
    { name: 'tilt', min: -6, max: 6, def: 0 },   // dB per octave: -6 brown, -3 pink, 0 white, 3 blue, 6 violet
    { name: 'seed', min: 1, max: 9999, def: 1, int: true },
    { name: 'restart', min: 0, max: 1, def: 1, int: true },   // 1: a note starts the noise over, so each hit is identical
    { name: 'free', min: 0, max: 1, def: 0, int: true },   // 1: runs without notes
  ],
  create() {
    let state = 0x9e3779b9, started = false, pending = false;
    let p0 = 0, p1 = 0, p2 = 0, brown = 0, pinkPrev = 0, whitePrev = 0, idx = -1;
    return {
      note(msg) {
        if (msg.type === 'noteOn') { started = true; pending = true; }
        else if (msg.type === 'noteCut') started = false;
      },
      process(inputs, outputs, n, params, slots) {
        const out = outputs[0];
        const free = params[slots[FREE]] >= 0.5;
        if (!started && !free) { out.fill(0, 0, n); return; }
        if (pending) {
          pending = false;
          if (params[slots[RESTART]] >= 0.5) state = (Math.round(params[slots[SEED]]) * 2654435761) >>> 0 || 1;
        }
        const level = params[slots[LEVEL]];
        const target = (Math.min(6, Math.max(-6, params[slots[TILT]])) + 6) / 3;   // 0 brown ... 4 violet
        if (idx < 0) idx = target;
        const step = (target - idx) / n;
        let s = state;
        for (let i = 0; i < n; i++) {
          s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0;
          const w = (s / 2147483648) - 1;
          idx += step;
          // pink: three one-pole filters summed (Kellet); brown: a leaky integral; blue and violet: the difference of pink and of white
          p0 = 0.99765 * p0 + w * 0.0990460; p1 = 0.963 * p1 + w * 0.2965164; p2 = 0.57 * p2 + w * 1.0526913;
          const pink = p0 + p1 + p2 + w * 0.1848;
          brown = 0.9995 * brown + w;
          const blue = pink - pinkPrev, violet = w - whitePrev;
          pinkPrev = pink; whitePrev = w;
          const k = Math.min(3, Math.floor(idx)), f = idx - k;
          let a, b;
          if (k === 0) { a = brown * G_BROWN; b = pink * G_PINK; }
          else if (k === 1) { a = pink * G_PINK; b = w; }
          else if (k === 2) { a = w; b = blue * G_BLUE; }
          else { a = blue * G_BLUE; b = violet * G_VIOLET; }
          out[i] = (a + (b - a) * f) * level;
        }
        state = s;
        for (const v of [p0, p1, p2, brown]) if (!Number.isFinite(v)) { p0 = p1 = p2 = brown = 0; break; }
      },
    };
  },
};
