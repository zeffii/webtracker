// Tap: records the signal passing through it into a sample slot, started and stopped from a pattern. The audio goes on
// to the output untouched, so it can sit in the middle of any chain.
//
// Parameters (expose them as pattern columns): `trig` 1 starts a take on that row and 0 ends the one in progress (every
// write to the cell counts, so 1 on every row retakes); `len` is the length in ticks (0 records until a 0 arrives);
// `smp` is the pool slot, 1 to 16 for tap01 to tap16 (0 records nothing); `ch` 1 or 2 channels; `fade` fades the end of
// the take out and `fadein` fades its start in, in ms, so a take never clicks; `copy` is a normal sample number that
// also receives a copy (0 for none). The node only gathers audio: blocks of it go to the page, which assembles the
// sample, applies the fades and puts it in the project (see main.js).
const TRIG = 0, LEN = 1, SMP = 2, CH = 3, FADE = 4, FADEIN = 5, COPY = 6;
const CHUNK = 8192, MAX_SECONDS = 120;

export default {
  type: 'tap',
  inputs: ['in'],
  outputs: ['out'],
  category: 'Effects',
  kinds: { in: 'stereo', out: 'stereo' },
  shape: 'box',
  glyph: 'tap',
  params: [
    { name: 'trig', min: 0, max: 1, def: 0, int: true },
    { name: 'len', min: 0, max: 255, def: 16, int: true },
    { name: 'smp', min: 0, max: 16, def: 1, int: true },
    { name: 'ch', min: 1, max: 2, def: 2, int: true },
    { name: 'fade', min: 0, max: 255, def: 20, int: true },
    { name: 'fadein', min: 0, max: 255, def: 5, int: true },
    { name: 'copy', min: 0, max: 255, def: 0, int: true },
  ],
  create({ sampleRate, clock, emit }) {
    const stamps = clock?.stamps;
    let seen = null, take = null, counter = 0;
    const send = (msg, transfer) => emit?.(msg, transfer);
    const flush = final => {
      if (!take) return;
      const n = take.fill;
      if (n) {
        const l = take.l.slice(0, n), r = take.ch === 2 ? take.r.slice(0, n) : null;
        send({ phase: 'chunk', take: take.id, l, r }, r ? [l.buffer, r.buffer] : [l.buffer]);
        take.fill = 0;
      }
      if (final) { send({ phase: 'end', take: take.id }); take = null; }
    };
    return {
      process(inputs, outputs, n, params, slots) {
        const [inL, inR] = inputs[0], [outL, outR] = outputs[0];
        if (stamps) {
          const stamp = stamps[slots[TRIG]];
          if (seen === null) seen = stamp;
          else if (stamp !== seen) {   // the pattern wrote the trig cell
            seen = stamp;
            flush(true);
            const slot = Math.round(params[slots[SMP]]);
            if (params[slots[TRIG]] >= 1 && slot >= 1 && slot <= 16) {
              const ch = Math.round(params[slots[CH]]) >= 2 ? 2 : 1;
              take = { id: ++counter, ch, l: new Float32Array(CHUNK), r: ch === 2 ? new Float32Array(CHUNK) : null, fill: 0, frames: 0, startTick: clock.tickId | 0, ticks: Math.round(params[slots[LEN]]) };
              send({ phase: 'start', take: take.id, smp: slot, ch, rate: sampleRate, ticks: take.ticks, fade: params[slots[FADE]], fadeIn: params[slots[FADEIN]], copy: Math.round(params[slots[COPY]]) });
            }
          }
        }
        if (take) {
          // a take ends on the tick boundary, when the song stops, or at the cap
          if ((take.ticks > 0 && (clock.tickId | 0) - take.startTick >= take.ticks) || clock?.playing === false || take.frames >= MAX_SECONDS * sampleRate) flush(true);
        }
        if (take) {
          for (let i = 0; i < n; i++) {
            if (take.ch === 2) { take.l[take.fill] = inL[i]; take.r[take.fill] = inR[i]; } else take.l[take.fill] = (inL[i] + inR[i]) * 0.5;
            if (++take.fill === CHUNK) { take.frames += CHUNK; flush(false); }
          }
        }
        if (outL !== inL) outL.set(inL.subarray(0, n), 0);
        if (outR !== inR) outR.set(inR.subarray(0, n), 0);
      },
    };
  },
};
