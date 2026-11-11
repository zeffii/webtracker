// Sympathetic strings: a set of tuned resonators that ring when the input has a partial of their pitch, the way the undamped strings of
// a piano or a sitar answer a note. Each is a short feedback delay (a string) with a low-pass in its loop (the string loses its top as it rings).
// The chord picks which pitches are strung, `ringtime` how long they ring, `detune` how far they are from perfectly in tune (a little makes
// them shimmer). Each string has a DC blocker in its loop, so an offset in the sound does not pile up in the strings. Up to 12 strings, spread across the stereo field. The dry sound stays; `mix` is the level of the strings.
//
// follow notes: instead of a fixed chord, the strings are tuned to the notes the instrument is playing (the node hears every note that
// is played, once, whatever the voices do). For each recent note the strings are the nearest piano strings (equal tempered, so a little
// off the true partials, as on a piano) to its first `partials` harmonics: the note itself, the octave, the twelfth, two octaves ...
// Newest notes and lowest harmonics are strung first, `strings` is the most that sound. A string that is already ringing and is still wanted
// is left alone; one that is no longer wanted gives way to a new one. Released notes stay in the bag until newer ones crowd them out, as the
// undamped strings of a piano go on ringing after the key is up.
import { stringsOf, midiHz, wantedStrings, MAX_STRINGS } from '../spacecore.js';

const ROOT = 0, CHORD = 1, STRINGS = 2, RING = 3, DAMP = 4, DETUNE = 5, WIDTH = 6, MIX = 7, FOLLOW = 8, PARTIALS = 9;
const BAG = 12;   // the notes remembered
const LOWEST = 30;
const REACH = 36;   // semitones from the played note at which a string is as far out as `width` allows   // Hz: the longest string

export default {
  type: 'sympathy',
  inputs: ['in'],
  outputs: ['out'],
  category: 'Effects',
  kinds: { in: 'stereo', out: 'stereo' },
  shape: 'box',
  glyph: 'sympathy',
  editor: 'sympathy',
  params: [
    { name: 'root', min: 24, max: 84, def: 48, int: true },   // MIDI note
    { name: 'chord', min: 0, max: 7, def: 1, int: true },
    { name: 'strings', min: 1, max: MAX_STRINGS, def: 8, int: true },
    { name: 'ringtime', min: 100, max: 8000, def: 2500 },   // ms to fall 60 dB
    { name: 'damp', min: 1000, max: 16000, def: 6000 },     // Hz
    { name: 'detune', min: 0, max: 30, def: 4 },            // cents
    { name: 'width', min: 0, max: 1, def: 0.25 },   // how far from the middle the strings furthest from the played note sit (a little for a piano, 1 for a wide synth)
    { name: 'mix', min: 0, max: 1.5, def: 0.5 },
    { name: 'follow', min: 0, max: 1, def: 0, int: true },  // 1: tune the strings to the notes being played
    { name: 'partials', min: 1, max: 6, def: 3, int: true }, // follow: how many harmonics of each note get a string
  ],
  create({ sampleRate, emit }) {
    const size = Math.ceil(sampleRate / LOWEST) + 4;
    const bufs = Array.from({ length: MAX_STRINGS }, () => new Float32Array(size));
    const pos = new Int32Array(MAX_STRINGS), lp = new Float64Array(MAX_STRINGS), len = new Float64Array(MAX_STRINGS), fb = new Float64Array(MAX_STRINGS), energy = new Float64Array(MAX_STRINGS);
    const pitch = new Int16Array(MAX_STRINGS).fill(-1);   // the note each string is tuned to, -1 for a string not in use
    const pan = Array.from({ length: MAX_STRINGS }, () => [Math.SQRT1_2, Math.SQRT1_2]), panTo = Array.from({ length: MAX_STRINGS }, () => [Math.SQRT1_2, Math.SQRT1_2]);
    const bag = [];   // the notes played, newest first
    let key = '', dirty = true, watchLeft = 0, sent = 0, active = 0;
    const hx = new Float64Array(MAX_STRINGS), hy = new Float64Array(MAX_STRINGS);   // each string's DC blocker (see below)
    const DC_HZ = 2, dcR = 1 - 2 * Math.PI * DC_HZ / sampleRate;   // a one-pole high pass at 2 Hz: low enough to leave the strings' pitch alone

    // string i gets its pitch (a little off true, more for the ones further out), its loop gain from the ring time, and its place in the stereo field
    const tune = (i, p) => {
      const detune = p.detune * ((i >> 1) + 1) / 3 * (i % 2 ? 1 : -1);
      const hz = Math.max(LOWEST, midiHz(pitch[i]) * Math.pow(2, detune / 1200));
      len[i] = Math.min(size - 3, sampleRate / hz + sampleRate * Math.atan(DC_HZ / hz) / (2 * Math.PI * hz));   // the blocker leads the phase a little, which would tune the string sharp: the line is made as much longer
      fb[i] = Math.pow(0.001, len[i] / (p.ring / 1000 * sampleRate));   // the loop gain that falls 60 dB in the ring time
    };
    // Each string sits in the stereo field by how far its pitch is from the note that was played (the newest note when following, else the root):
    // the string on the note itself is in the middle, the ones further away (the octave, the twelfth, the neighbours) move out, taking turns
    // left and right so a pair of equally far strings is on both sides. `width` is how far the furthest ones go: a little for a piano, all the way
    // for a synth. Not by pitch: a high string next to the played note stays near the middle.
    const place = (reference, width, jump) => {
      const used = [];
      for (let i = 0; i < MAX_STRINGS; i++) if (pitch[i] >= 0) used.push({ i, d: Math.abs(pitch[i] - reference) });
      used.sort((a, b) => a.d - b.d || a.i - b.i);
      used.forEach(({ i, d }, rank) => {
        const a = Math.min(1, d / REACH) * width * (rank % 2 ? 1 : -1), q = (a + 1) * Math.PI / 4;
        panTo[i][0] = Math.cos(q); panTo[i][1] = Math.sin(q);
        if (jump.has(i)) { pan[i][0] = panTo[i][0]; pan[i][1] = panTo[i][1]; }   // a new string starts where it belongs; ringing ones glide there
      });
    };
    // string the notes in `list`: a string already on a wanted note keeps ringing; the others are freed and given to the new notes
    const assign = (list, p) => {
      const want = list.slice(0, MAX_STRINGS), fresh = new Set();
      for (let i = 0; i < MAX_STRINGS; i++) if (pitch[i] >= 0 && !want.includes(pitch[i])) pitch[i] = -1;
      for (const note of want) {
        if (pitch.includes(note)) continue;
        const i = pitch.indexOf(-1);
        if (i < 0) break;
        fresh.add(i); pitch[i] = note; bufs[i].fill(0); lp[i] = 0; hx[i] = 0; hy[i] = 0; energy[i] = 0;
      }
      active = 0;
      for (let i = 0; i < MAX_STRINGS; i++) if (pitch[i] >= 0) { tune(i, p); active++; }
      place(p.reference, p.width, fresh);
    };

    return {
      message(m) { if (m?.type === 'watch') watchLeft = sampleRate * 3; },
      note(msg) {
        if (msg.type === 'noteOn' && Number.isFinite(msg.note)) {
          const at = bag.indexOf(msg.note);
          if (at >= 0) bag.splice(at, 1);
          bag.unshift(msg.note);
          if (bag.length > BAG) bag.pop();
          dirty = true;
        } else if (msg.type === 'noteCut') { bag.length = 0; dirty = true; }
      },
      process(inputs, outputs, n, params, slots) {
        const [inL, inR] = inputs[0], [outL, outR] = outputs[0];
        const v = i => params[slots[i]];
        const follow = v(FOLLOW) >= 0.5;
        const k = [v(ROOT), v(CHORD), v(STRINGS), v(RING), v(DAMP), v(DETUNE), v(WIDTH), follow, v(PARTIALS)].join();
        if (k !== key || (follow && dirty)) {
          key = k; dirty = false;
          const list = follow ? wantedStrings(bag, v(PARTIALS), v(STRINGS)) : stringsOf(v(ROOT), v(CHORD), v(STRINGS));
          assign(list, { detune: v(DETUNE), ring: v(RING), width: v(WIDTH), reference: follow && bag.length ? bag[0] : v(ROOT) });
        }
        for (let s = 0; s < MAX_STRINGS; s++) if (pitch[s] >= 0) { pan[s][0] += (panTo[s][0] - pan[s][0]) * 0.1; pan[s][1] += (panTo[s][1] - pan[s][1]) * 0.1; }   // glide, so a new note does not make the ringing strings jump
        const mix = v(MIX) / Math.sqrt(Math.max(1, active)) * 2, c = 1 - Math.exp(-2 * Math.PI * v(DAMP) / sampleRate), feed = 0.15;
        for (let i = 0; i < n; i++) {
          const x = (inL[i] + inR[i]) * 0.5 * feed;
          let l = 0, r = 0;
          for (let s = 0; s < MAX_STRINGS; s++) {
            if (pitch[s] < 0) continue;
            const b = bufs[s];
            let rp = pos[s] - len[s]; if (rp < 0) rp += size;
            const j = rp | 0, f = rp - j, y = b[j] + (b[j + 1 === size ? 0 : j + 1] - b[j]) * f;
            lp[s] += (y - lp[s]) * c;
            // The DC blocker is inside the loop: a string with a low-pass in its loop passes DC with a gain of 1 / (1 - loop gain), large
            // for a long ring time, so a constant part in the input (or a step) would pile up as an offset that decays only with the ring time.
            // With the blocker in the loop (after the input is added) the string has no DC gain at all.
            const u = lp[s] * fb[s] + x, d = u - hx[s] + dcR * hy[s];
            hx[s] = u; hy[s] = Math.abs(d) < 1e-20 ? 0 : d;
            const w = d;
            b[pos[s]] = Math.abs(w) < 1e-20 ? 0 : w;
            if (++pos[s] === size) pos[s] = 0;
            l += y * pan[s][0]; r += y * pan[s][1];
            if (watchLeft > 0) energy[s] = Math.max(energy[s] * 0.9995, Math.abs(y));
          }
          outL[i] = inL[i] + l * mix; outR[i] = inR[i] + r * mix;
        }
        if (watchLeft > 0 && emit) {
          watchLeft -= n; sent += n;
          if (sent >= sampleRate * 0.08) {
            sent = 0;
            const notes = [], e = [], pans = [];
            for (let s = 0; s < MAX_STRINGS; s++) if (pitch[s] >= 0) { notes.push(pitch[s]); e.push(energy[s]); pans.push([pan[s][0], pan[s][1]]); }
            emit({ type: 'sym', energy: e, notes, pans });   // pans: each string's left and right gain, for the panel's stacked bars
          }
        }
      },
    };
  },
};
