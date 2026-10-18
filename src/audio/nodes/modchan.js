// One Amiga tracker channel: a ProTracker playroutine for MOD files and MOD-style patterns. Notes are ProTracker
// notes (C-1 is period 856, B-3 is 113), samples are 8-bit style one-shots with loops, played at a period (the
// Paula clock divided by the period), and the effects are the usual ones, written in the Cmd column.
//
// The song's tick is the MOD tick: a MOD row is `speed` song ticks (the importer lays the rows out that way and
// sets the song to 24 ticks per beat, so the BPM is the MOD tempo). A row starts when the Cmd column is written;
// the note and the Smp cell of that tick come with it. Cmd command 01 writes `fx`, the effect word of a MOD cell
// (effect and parameter, `0C40` is "C40", set volume to 40 hex), so a row with nothing to say writes 0000.
// The ticks after it are blank and carry the effect on: slides, vibrato, arpeggio, retrigger and cut count them.
// Effects: 0 arpeggio, 1 slide up, 2 slide down, 3 tone portamento, 4 vibrato, 5 portamento + volume slide,
// 6 vibrato + volume slide, 7 tremolo, 8 pan, 9 sample offset, A volume slide, C set volume, E1 fine slide up,
// E2 fine slide down, E4 vibrato waveform, E5 finetune, E7 tremolo waveform, E8 pan, E9 retrigger, EA fine volume
// up, EB fine volume down, EC note cut, ED note delay. B, D, E6, EE and F (jumps, loops, delays, speed) belong to
// the song, not the channel: the importer plays them out into the arrangement, so here they do nothing.
// A sample number without a note sets the volume to the sample's volume; a note with one does the same and plays
// it, a note alone plays the channel's last sample at the channel's volume. With a 3 or 5 effect a note only sets
// the target of the slide. The channel is hard-panned by `pan` (the Amiga: left, right, right, left).
// The sample bank is filled by `sample` messages, as for the sampler: slot n is MOD sample n+1, `rate` 8363 is the
// recording rate at C-2 (period 428), `volume` the sample's default volume and the loop is a normal loop.
const SPEC = [
  { name: 'smp', min: 0, max: 255, def: 0, int: true },        // the sample slot a note plays (MOD sample number minus one)
  { name: 'fx', min: 0, max: 4095, def: 0, int: true },        // the effect word of the row: effect nibble then parameter byte
  { name: 'level', min: 0, max: 1, def: 0.45 },
  { name: 'pan', min: -1, max: 1, def: 0 },
  { name: 'interp', min: 0, max: 1, def: 1, int: true },       // 1: linear interpolation, 0: nearest (the Amiga's own crunch)
];
const P = {};
SPEC.forEach((s, i) => { P[s.name] = i; });

export const PERIODS = [856, 808, 762, 720, 678, 640, 604, 570, 538, 508, 480, 453, 428, 404, 381, 360, 339, 320, 302, 285, 269, 254, 240, 226, 214, 202, 190, 180, 170, 160, 151, 143, 135, 127, 120, 113];
export const FIRST_NOTE = 24;   // the note number (MIDI numbering) of C-1
const SINE = [0, 24, 49, 74, 97, 120, 141, 161, 180, 197, 212, 224, 235, 244, 250, 253, 255, 253, 250, 244, 235, 224, 212, 197, 180, 161, 141, 120, 97, 74, 49, 24];
const PAULA = 3579545;
const MIN_PERIOD = 113, MAX_PERIOD = 856;

export const periodOf = note => {
  const i = note - FIRST_NOTE;
  return i >= 0 && i < PERIODS.length ? PERIODS[i] : Math.max(20, Math.min(3000, Math.round(856 * Math.pow(2, -i / 12))));
};

const wave = (kind, pos) => {   // 0..255 for a position 0..63 in the cycle
  const w = kind & 3, p = pos & 31;
  if (w === 0) return SINE[p];
  if (w === 1) return (pos & 32) ? 255 - p * 8 : p * 8;   // ramp
  return 255;                                              // square
};

export default {
  type: 'modchan',
  inputs: [],
  outputs: ['out'],
  category: 'Sources',
  samples: true,     // plays the samples listed for the node
  generator: true,
  shared: true,
  shape: 'rounded',
  glyph: 'modchan',
  kinds: { out: 'stereo' },
  params: SPEC,
  create({ sampleRate, clock }) {
    const bank = [];
    let active = false, pos = 0, period = 428, outPeriod = 428, vol = 64, outVol = 64, gain = 0;
    let cur = 0, noteIdx = 0, target = 428, portaSpeed = 0, offsetMem = 0, ftMul = 1;
    let vibSpeed = 0, vibDepth = 0, vibPos = 0, vibWave = 0, tremSpeed = 0, tremDepth = 0, tremPos = 0, tremWave = 0;
    let cmd = 0, par = 0, tickInRow = 0, panFx = null;
    let pendingNote = -1, delayed = -1, lastTick = 0, lastFx = -1, lastSmp = -1;

    const silence = () => { active = false; pendingNote = delayed = -1; };
    const clampVol = v => Math.max(0, Math.min(64, v));
    const trigger = note => {
      const S = bank[cur];
      noteIdx = note - FIRST_NOTE;
      period = outPeriod = periodOf(note);
      pos = cmd === 9 ? offsetMem * 256 : 0;
      if ((vibWave & 4) === 0) vibPos = 0;
      if ((tremWave & 4) === 0) tremPos = 0;
      active = !!S && pos < S.sample.length;
    };
    const slide = () => {
      if (period > target) period = Math.max(target, period - portaSpeed);
      else if (period < target) period = Math.min(target, period + portaSpeed);
      outPeriod = period;
    };
    const vibrato = () => {
      const delta = (wave(vibWave, vibPos) * vibDepth) >> 7;
      outPeriod = (vibPos & 32) ? period - delta : period + delta;
      vibPos = (vibPos + vibSpeed) & 63;
    };
    const volSlide = () => { vol = clampVol(vol + (par >> 4 ? par >> 4 : -(par & 15))); outVol = vol; };

    // One song tick of the channel: the row's first tick reads the effect word, note and sample; the others carry on.
    const tick = (params, slots) => {
      const stamp = clock.stamps ? clock.stamps[slots[P.fx]] : 0, smpStamp = clock.stamps ? clock.stamps[slots[P.smp]] : 0;
      const newRow = stamp !== lastFx;
      if (newRow) {
        lastFx = stamp;
        const word = Math.round(params[slots[P.fx]]);
        cmd = (word >> 8) & 15; par = word & 255; tickInRow = 0;
        const smpWritten = smpStamp !== lastSmp && smpStamp !== 0;   // a Smp cell on this row
        lastSmp = smpStamp;
        if (smpWritten) { cur = Math.max(0, Math.round(params[slots[P.smp]])); ftMul = 1; }
        if (cmd === 9 && par) offsetMem = par;
        const note = pendingNote; pendingNote = -1; delayed = -1;
        const S = bank[cur];
        if (smpWritten && S) vol = clampVol(Math.round((S.volume ?? 1) * 64));
        if (cmd === 3 || cmd === 5) { if (cmd === 3 && par) portaSpeed = par; if (note >= 0) target = periodOf(note); }
        else if (note >= 0) {
          if (cmd === 0xE && (par >> 4) === 0xD && (par & 15) > 0) delayed = note;
          else trigger(note);
        }
        if (cmd === 4 || cmd === 6) { if (par >> 4 && cmd === 4) vibSpeed = par >> 4; if ((par & 15) && cmd === 4) vibDepth = par & 15; }
        if (cmd === 7) { if (par >> 4) tremSpeed = par >> 4; if (par & 15) tremDepth = par & 15; }
        const x = par & 15;
        if (cmd === 0xC) vol = clampVol(par);
        else if (cmd === 8) panFx = (par - 128) / 128;
        else if (cmd === 0xE) {
          const sub = par >> 4;
          if (sub === 1) period = Math.max(MIN_PERIOD, period - x);
          else if (sub === 2) period = Math.min(MAX_PERIOD, period + x);
          else if (sub === 4) vibWave = x;
          else if (sub === 5) ftMul = Math.pow(2, (x > 7 ? x - 16 : x) / 96);
          else if (sub === 7) tremWave = x;
          else if (sub === 8) panFx = (x * 17 - 128) / 128;
          else if (sub === 0xA) vol = clampVol(vol + x);
          else if (sub === 0xB) vol = clampVol(vol - x);
          else if (sub === 0xC && x === 0) vol = 0;
        }
        outPeriod = period; outVol = vol;
        return;
      }
      tickInRow++;
      const t = tickInRow, x = par & 15;
      if (cmd !== 0 && cmd !== 4 && cmd !== 6) outPeriod = period;
      if (cmd !== 7) outVol = vol;
      switch (cmd) {
        case 0:
          if (par) {
            const off = t % 3 === 0 ? 0 : t % 3 === 1 ? par >> 4 : x, i = noteIdx + off;
            outPeriod = i >= 0 && i < PERIODS.length ? PERIODS[i] : period;
          } else outPeriod = period;
          break;
        case 1: period = Math.max(MIN_PERIOD, period - par); outPeriod = period; break;
        case 2: period = Math.min(MAX_PERIOD, period + par); outPeriod = period; break;
        case 3: slide(); break;
        case 4: vibrato(); break;
        case 5: slide(); volSlide(); break;
        case 6: vibrato(); volSlide(); break;
        case 7: {
          const delta = (wave(tremWave, tremPos) * tremDepth) >> 6;
          outVol = clampVol((tremPos & 32) ? vol - delta : vol + delta);
          tremPos = (tremPos + tremSpeed) & 63;
          break;
        }
        case 0xA: volSlide(); break;
        case 0xE: {
          const sub = par >> 4;
          if (sub === 9 && x && t % x === 0) { pos = 0; active = !!bank[cur]; }
          else if (sub === 0xC && t === x) { vol = 0; outVol = 0; }
          else if (sub === 0xD && delayed >= 0 && t === x) { trigger(delayed); delayed = -1; }
          break;
        }
        default: break;
      }
    };

    return {
      message(msg) {
        if (msg.type !== 'sample') return;
        const S = bank[msg.slot | 0] = { sample: msg.data, rate: msg.rate, volume: msg.volume ?? 1, loop: false, ls: 0, le: 0 };
        const start = msg.loopStart ?? 0, end = msg.loopEnd ?? 0;
        if (msg.loopOn !== false && end - start >= 2 && end <= S.sample.length && start >= 0) { S.loop = true; S.ls = start; S.le = end; }
      },
      note(msg) {
        if (msg.type === 'noteOn') pendingNote = msg.note;
        else if (msg.type === 'allOff' || msg.type === 'noteCut') { silence(); cmd = par = 0; panFx = null; lastFx = -1; }
      },
      process(inputs, outputs, n, params, slots) {
        const [outL, outR] = outputs[0];
        const playing = clock?.playing === true;
        const id = clock?.tickId ?? 0;
        if (playing && id !== lastTick) { lastTick = id; tick(params, slots); }
        else if (pendingNote >= 0 && !playing) {   // not playing: a note from the keyboard sounds at once
          cur = Math.max(0, Math.round(params[slots[P.smp]]));
          cmd = par = 0;
          const S = bank[cur];
          if (S) vol = outVol = clampVol(Math.round((S.volume ?? 1) * 64));
          trigger(pendingNote); pendingNote = -1;
        }
        if (!playing) lastTick = id;
        outL.fill(0, 0, n); outR.fill(0, 0, n);
        const S = active ? bank[cur] : null;
        if (!S) { gain = 0; return; }
        const sample = S.sample, len = sample.length;
        const inc = PAULA / Math.max(20, outPeriod) * (S.rate / 8363) * ftMul / sampleRate;
        const pan = Math.max(-1, Math.min(1, panFx ?? params[slots[P.pan]]));
        const level = params[slots[P.level]], target = outVol / 64 * level;
        const gl = pan > 0 ? 1 - pan : 1, gr = pan < 0 ? 1 + pan : 1;
        const linear = params[slots[P.interp]] >= 0.5;
        const loop = S.loop, ls = S.ls, le = S.le, span = le - ls;
        let p = pos;
        for (let i = 0; i < n; i++) {
          if (loop) { if (p >= le) p = ls + (p - ls) % span; } else if (p >= len) { active = false; break; }
          const k = Math.floor(p);
          let v = sample[k];
          if (linear) {
            let k2 = k + 1;
            if (loop && k2 >= le) k2 = ls + (k2 - ls) % span;
            v += ((k2 < len ? sample[k2] : 0) - v) * (p - k);
          }
          gain += (target - gain) * 0.02;
          outL[i] = v * gain * gl; outR[i] = v * gain * gr;
          p += inc;
        }
        pos = p;
      },
    };
  },
};
