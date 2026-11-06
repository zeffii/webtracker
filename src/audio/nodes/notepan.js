// Note pan: each note gets its own place in the stereo field, chosen from the notes being played, and can swing or circle round the listener.
// It belongs inside the voices (before the voices node): every sounding note is its own copy of this node, and the copies share what is held
// and what came before (`shared`), which is how a note can be placed among the others (fan, alternate, cluster ...).
//
//   style     keyboard: pitch decides (low left, high right).  fan: the held notes spread evenly, in the order played.  alternate: left, right, left ...
//             random: a fixed place for each pitch.  cluster: placed by how far the note is from the average of what is held.  mirror: notes in pairs either side.
//   range     how much of the field is used; centre moves the whole field.
//   rotation  turns every note round the listener at `rate` (cycles per second, negative the other way). The shape: swing goes back and forth by `amp`
//             (1 is half a turn either way), triangle the same with a straight sweep, orbit goes all the way round (amp is not used).
//             `spread` starts each note's turn a little later than the last, so a chord opens and closes like a fan.
//   behind    a place round the head has a front and a back: the way round, the sound passes behind the listener and gets quieter and duller.
import { panPlace, panRotation, orbitOf, PAN_STYLES } from '../spacecore.js';

const STYLE = 0, RANGE = 1, CENTRE = 2, GLIDE = 3, RATE = 4, AMP = 5, SHAPE = 6, SPREAD = 7, BEHIND = 8;
const fract = v => v - Math.floor(v);

export default {
  type: 'notepan',
  inputs: ['in'],
  outputs: ['out'],
  category: 'Effects',
  kinds: { in: 'stereo', out: 'stereo' },
  shape: 'box',
  glyph: 'notepan',
  editor: 'notepan',
  params: [
    { name: 'style', min: 0, max: PAN_STYLES.length - 1, def: 0, int: true },
    { name: 'range', min: 0, max: 1, def: 0.7 },
    { name: 'centre', min: -1, max: 1, def: 0 },
    { name: 'glide', min: 0, max: 1000, def: 60 },        // ms
    { name: 'rate', min: -4, max: 4, def: 0 },            // cycles per second; 0 holds still
    { name: 'amp', min: 0, max: 1, def: 0.25 },
    { name: 'shape', min: 0, max: 2, def: 0, int: true },
    { name: 'spread', min: 0, max: 1, def: 0 },
    { name: 'behind', min: 0, max: 1, def: 0.4 },
  ],
  create({ sampleRate, shared, emit }) {
    const S = shared ?? {};
    S.held ??= new Map(); S.seq ??= 0; S.phase ??= 0; S.ids ??= 0;
    const id = S.ids++;
    let mine = -1, seq = 0, held = false, x = 0, phi0 = 0, phase = 0, started = false, lpL = 0, lpR = 0, watchLeft = 0, sent = 0;
    return {
      message(m) { if (m?.type === 'watch') watchLeft = sampleRate * 3; },
      note(msg) {
        if (msg.type === 'noteOn' && Number.isFinite(msg.note)) {
          mine = msg.note; seq = S.seq++; held = true; started = false;   // a new note starts where it belongs
          S.held.delete(mine); S.held.set(mine, seq);
          phase = S.phase;   // joins the turn where the others are
        } else if (msg.type === 'noteOff') {
          S.held.delete(msg.note);
          if (msg.note === mine) held = false;
        } else if (msg.type === 'allOff' || msg.type === 'noteCut') { S.held.clear(); held = false; }
      },
      process(inputs, outputs, n, params, slots) {
        const [inL, inR] = inputs[0], [outL, outR] = outputs[0];
        const p = i => params[slots[i]];
        const style = p(STYLE), range = p(RANGE), centre = p(CENTRE), rate = p(RATE), amp = p(AMP), shape = p(SHAPE), spread = p(SPREAD), behind = p(BEHIND);
        if (held || !started) {
          const list = [...S.held.entries()].sort((a, b) => a[1] - b[1]).map(e => e[0]);
          x = mine < 0 ? 0 : panPlace(style, mine, seq, list);
        }
        const target = Math.max(-1, Math.min(1, x * range + centre)) * Math.PI / 2;
        if (!started) { phi0 = target; started = true; }
        const slew = 1 - Math.exp(-1 / (sampleRate * Math.max(1, p(GLIDE)) / 1000));
        const inc = rate / sampleRate, off = spread * fract(seq * 0.618034);
        const lpLo = 1 - Math.exp(-2 * Math.PI * 4000 / sampleRate);   // the one-pole coefficient for 4 kHz; in front the sound is not filtered at all (1)
        let angle = 0;
        for (let i = 0; i < n; i++) {
          phi0 += (target - phi0) * slew;
          angle = phi0 + panRotation(shape, phase + off, amp);
          const { pan, behind: back } = orbitOf(angle);
          const q = (pan + 1) * Math.PI / 4, g = (1 - 0.5 * back * behind) * Math.SQRT2;
          const c = 1 - (1 - lpLo) * back * behind;
          lpL += (inL[i] - lpL) * c; lpR += (inR[i] - lpR) * c;
          outL[i] = lpL * Math.cos(q) * g; outR[i] = lpR * Math.sin(q) * g;
          phase += inc;
        }
        S.phase = phase;
        if (watchLeft > 0 && emit) {
          watchLeft -= n; sent += n;
          if (sent >= sampleRate * 0.06) { sent = 0; emit({ type: 'orbit', id, note: mine, angle, held }); }
        }
      },
    };
  },
};
