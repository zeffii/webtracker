// One FastTracker 2 channel: an XM playroutine for XM files and XM-style patterns. It plays instruments, not bare
// samples: an instrument maps each note to one of its samples (the keymap), and has a volume and a panning envelope
// (points, a sustain point, a loop), a fadeout after the key is let go, and an automatic vibrato.
//
// Timing works as for the MOD channel: the song's tick is the XM tick, a row is `speed` song ticks (the importer lays
// the rows out that way, at 24 ticks to the beat, so the BPM is the XM BPM). A row starts when the Cmd column writes
// `fx` (command 01); the note, the Ins cell and the Vol cell of that tick come with it. The ticks after it are blank and
// carry the effects on.
//
// The pattern cells:
//   note      C-0 to B-7 play a note, === is the key off (the envelopes leave their sustain, the fadeout starts)
//   Ins       the instrument, 00 is XM instrument 1
//   Vol       the volume column byte, as in the XM: 10-50 set volume, 60-6F slide down, 70-7F slide up, 80-8F fine down,
//             90-9F fine up, Ax vibrato speed, Bx vibrato, Cx set panning, Dx pan left, Ex pan right, Fx tone portamento
//   Cmd 01    the effect word: the effect number (0 to 23 hex, the letters G to X are 10 to 21) then the parameter byte,
//             so 010C40 is C40 and 01143F is K3F (14 is K)
// Effects: 0 arpeggio, 1/2 portamento up/down, 3 tone portamento, 4 vibrato, 5 tone portamento + volume slide,
// 6 vibrato + volume slide, 7 tremolo, 8 set panning, 9 sample offset, A volume slide, C set volume, E1/E2 fine
// portamento, E4 vibrato waveform, E7 tremolo waveform, E9 retrigger, EA/EB fine volume slide, EC note cut, ED note
// delay, K key off, L envelope position, P panning slide, R multi retrigger, T tremor, X1/X2 extra fine portamento.
// B, D, E6, EE, F, G and H belong to the song: the importer plays them out into the arrangement (the global volume of
// G and H goes to the master lane's Vol column), so here they do nothing. E3 (glissando) and E5 (finetune) are ignored.
//
// A sample whose loop is marked `pingpong` runs through the loop forwards, then backwards, and on.
//
// Pitch: every sample says how it is tuned through its rate. A sample recorded at 8363 Hz plays at its own pitch on
// C-4; the importer folds the XM relative note and finetune into the rate, so a sample one octave up has 16726.
// Periods follow the module: linear (64 to a semitone) or Amiga (the classic table, times four), `data.linear`.
//
// data (set by the importer, kept with the node): { linear, ins: [instrument or null] }, where an instrument is
//   { map: slot or [96 slots, one per note from C-0], fade, vib: [type, sweep, depth, rate], vol: envelope, pan: envelope }
//   and an envelope is { pts: [x0, y0, x1, y1, ...] (ticks, 0..64), sus: point or -1, ls: point or -1, le: point }.
// Without data (a channel made by hand) instrument n plays sample slot n, with no envelopes.
const SPEC = [
  { name: 'ins', min: 0, max: 255, def: 0, int: true },        // the instrument a note plays (XM instrument number minus one)
  { name: 'vcol', min: 0, max: 255, def: 0, int: true },       // the volume column byte of the row
  { name: 'fx', min: 0, max: 0x23ff, def: 0, int: true },      // the effect word of the row: effect number then parameter byte
  { name: 'level', min: 0, max: 1, def: 0.45 },
  { name: 'interp', min: 0, max: 1, def: 1, int: true },       // 1: linear interpolation, 0: nearest sample
];
const P = {};
SPEC.forEach((s, i) => { P[s.name] = i; });

// Effect numbers past 9 and F, by letter.
export const FX = { A: 0xA, C: 0xC, E: 0xE, G: 0x10, H: 0x11, K: 0x14, L: 0x15, P: 0x19, R: 0x1B, T: 0x1D, X: 0x21 };

const SINE = [0, 24, 49, 74, 97, 120, 141, 161, 180, 197, 212, 224, 235, 244, 250, 253, 255, 253, 250, 244, 235, 224, 212, 197, 180, 161, 141, 120, 97, 74, 49, 24];
const C4 = 48;                         // C-4 counted in semitones from C-0: the note a sample plays at its own rate
const MIDI_C0 = 12;                    // a note cell's number for C-0
const MAX_PERIOD = 32000;
const FADE_FULL = 32768;               // the fadeout volume at the start of a note

// The period of a note (semitones from C-0, a fraction allowed) and the playback rate a period stands for.
export const periodOf = (note, linear) => (linear ? 7680 - note * 64 : 1712 * Math.pow(2, (C4 - note) / 12));
export const rateOf = (period, linear) => (linear ? 8363 * Math.pow(2, (4608 - period) / 768) : 8363 * 1712 / period);

const wave = (kind, pos) => {   // 0..255 for a position 0..63 in the cycle (the half is in bit 5)
  const w = kind & 3, p = pos & 31;
  if (w === 0) return SINE[p];
  if (w === 1) return (pos & 32) ? 255 - p * 8 : p * 8;   // ramp
  return 255;                                              // square
};
const autoWave = (type, pos) => {   // -64..64 for a position 0..255: sine, square, ramp down, ramp up
  if (type === 1) return pos < 128 ? 64 : -64;
  if (type === 2) return 64 - (pos >> 1);
  if (type === 3) return (pos >> 1) - 64;
  return Math.round(Math.sin(pos / 128 * Math.PI) * 64);
};
// Multi retrigger: what each volume nibble does to the volume.
const RETRIG_VOL = [v => v, v => v - 1, v => v - 2, v => v - 4, v => v - 8, v => v - 16, v => v * 2 / 3, v => v / 2,
  v => v, v => v + 1, v => v + 2, v => v + 4, v => v + 8, v => v + 16, v => v * 3 / 2, v => v * 2];

// An envelope's value at a tick, and the tick after it (held on the sustain point while the key is down, and taken
// back to the loop start at the loop end).
const envValue = (env, pos) => {
  const p = env.pts, last = p.length - 2;
  if (pos <= p[0]) return p[1];
  for (let i = 0; i < last; i += 2) {
    const x0 = p[i], x1 = p[i + 2];
    if (pos < x1) return x1 > x0 ? p[i + 1] + (p[i + 3] - p[i + 1]) * (pos - x0) / (x1 - x0) : p[i + 3];
  }
  return p[last + 1];
};
const envNext = (env, pos, keyOn) => {
  const p = env.pts;
  if (keyOn && env.sus >= 0 && pos === p[env.sus * 2]) return pos;
  let next = pos + 1;
  if (env.ls >= 0 && env.le >= 0 && next >= p[env.le * 2]) next = p[env.ls * 2];
  return next;
};
const validEnvelope = e => (e && Array.isArray(e.pts) && e.pts.length >= 2 ? { pts: e.pts.map(Number), sus: e.sus ?? -1, ls: e.ls ?? -1, le: e.le ?? -1 } : null);

export default {
  type: 'xmchan',
  inputs: [],
  outputs: ['out'],
  category: 'Sources',
  samples: true,     // plays the samples listed for the node
  generator: true,
  shared: true,
  shape: 'rounded',
  glyph: 'xmchan',
  kinds: { out: 'stereo' },
  params: SPEC,
  create({ sampleRate, clock, data }) {
    const linear = data?.linear !== false;
    const instruments = (Array.isArray(data?.ins) ? data.ins : []).map(i => (i ? {
      map: i.map, fade: i.fade | 0, vib: Array.isArray(i.vib) ? i.vib : [0, 0, 0, 0], vol: validEnvelope(i.vol), pan: validEnvelope(i.pan),
    } : null));
    const bank = [];

    // what is playing
    let active = false, pos = 0, dir = 1, cur = 0, ins = 0, note = C4, period = periodOf(C4, linear), outPeriod = period;
    let vol = 64, outVol = 64, pan = 128, gain = 0;
    let keyOn = true, fadeVol = FADE_FULL, volEnvPos = 0, panEnvPos = 0, autoPos = 0, autoAmp = 0;
    // the row
    let cmd = 0, par = 0, vcol = 0, tickInRow = 0, delayedRow = null, keyOffAt = -1;
    // effect memories (FT2 keeps one for each)
    let mem1 = 0, mem2 = 0, memE1 = 0, memE2 = 0, memX1 = 0, memX2 = 0, memVol = 0, memFineUp = 0, memFineDown = 0, memPan = 0, memOffset = 0;
    let target = period, portaSpeed = 0, vibSpeed = 0, vibDepth = 0, vibPos = 0, vibWave = 0;
    let tremSpeed = 0, tremDepth = 0, tremPos = 0, tremWave = 0, retrigVol = 0, retrigRate = 0, retrigCount = 0, tremorMem = 0, tremorCount = 0, tremorOn = true;
    // what came in since the last tick, and what has been seen
    let pendingNote = -1, pendingOff = false, lastTick = 0, lastFx = -1, lastIns = -1, lastVcol = -1, idleSamples = 0;

    const clampVol = v => Math.max(0, Math.min(64, Math.round(v)));
    const clampPan = v => Math.max(0, Math.min(255, Math.round(v)));
    const clampPeriod = v => Math.max(1, Math.min(MAX_PERIOD, v));
    const instrument = () => instruments[ins] ?? null;
    const slotFor = (i, n) => {   // the sample slot instrument i plays for note n (semitones from C-0), or -1
      const I = instruments[i];
      if (!I) return instruments.length ? -1 : i;   // no data: instrument n is slot n
      const m = I.map;
      return Array.isArray(m) ? (m[Math.max(0, Math.min(95, n))] ?? -1) : (m ?? -1);
    };
    const sampleNote = n => n + (bank[cur]?.tune ?? 0);   // the note with the sample's own tuning added

    const silence = () => { active = false; pendingNote = -1; pendingOff = false; delayedRow = null; };
    const resetEnvelopes = () => {
      keyOn = true; fadeVol = FADE_FULL; volEnvPos = panEnvPos = 0; autoPos = 0; autoAmp = 0;
      if ((vibWave & 4) === 0) vibPos = 0;
      if ((tremWave & 4) === 0) tremPos = 0;
      retrigCount = 0; tremorCount = 0; tremorOn = true;
    };
    const takeSampleDefaults = () => {   // an instrument number on the row: the volume and panning of its sample
      const S = bank[cur];
      if (!S) return;
      vol = clampVol(S.volume * 64);
      pan = clampPan(S.pan * 128 + 128);
    };
    const keyOff = () => {
      keyOn = false;
      if (!instrument()?.vol) vol = 0;   // without a volume envelope a key off is a cut
    };
    const trigger = (n, offset) => {   // plays note n (semitones from C-0) on the instrument
      const slot = slotFor(ins, n);
      if (slot < 0 || !bank[slot]) { active = false; return false; }
      cur = slot;
      note = n;
      period = outPeriod = target = clampPeriod(periodOf(sampleNote(n), linear));
      pos = offset; dir = 1;
      active = pos < bank[cur].sample.length;
      resetEnvelopes();
      return true;
    };

    // The row's first tick: the note, the instrument, the volume column and the effect's first move.
    const startRow = row => {
      const { note: n, off, insWritten, insValue, v } = row;
      const porta = cmd === 3 || cmd === 5 || (v >> 4) === 0xF;
      if (insWritten) ins = insValue;
      if (off) keyOff();
      else if (n >= 0) {
        if (porta && active) {
          target = clampPeriod(periodOf(sampleNote(n), linear));
          if (insWritten) { takeSampleDefaults(); resetEnvelopes(); }
        } else {
          if (cmd === 9 && par) memOffset = par;
          trigger(n, cmd === 9 ? memOffset * 256 : 0);
          if (insWritten) takeSampleDefaults();
        }
      } else if (insWritten) { takeSampleDefaults(); resetEnvelopes(); }
      volumeColumnFirstTick(v);
    };

    const volumeColumnFirstTick = v => {
      const hi = v >> 4, x = v & 15;
      if (v >= 0x10 && v <= 0x50) vol = v - 0x10;
      else if (hi === 0x8) vol = clampVol(vol - x);
      else if (hi === 0x9) vol = clampVol(vol + x);
      else if (hi === 0xA) vibSpeed = x;
      else if (hi === 0xB) { if (x) vibDepth = x; }
      else if (hi === 0xC) pan = x << 4;
      else if (hi === 0xF && x) portaSpeed = x << 6;
    };
    const volumeColumnLaterTick = v => {
      const hi = v >> 4, x = v & 15;
      if (hi === 0x6) vol = clampVol(vol - x);
      else if (hi === 0x7) vol = clampVol(vol + x);
      else if (hi === 0xB) vibrato();
      else if (hi === 0xD) pan = clampPan(pan - x);
      else if (hi === 0xE) pan = clampPan(pan + x);
      else if (hi === 0xF) slideToTarget();
    };

    const slideToTarget = () => {
      if (period > target) period = Math.max(target, period - portaSpeed);
      else if (period < target) period = Math.min(target, period + portaSpeed);
      outPeriod = period;
    };
    const vibrato = () => {
      const delta = (wave(vibWave, vibPos) * vibDepth) >> 5;
      outPeriod = (vibPos & 32) ? period - delta : period + delta;
      vibPos = (vibPos + vibSpeed) & 63;
    };
    const volumeSlide = () => { vol = clampVol(vol + (memVol >> 4 ? memVol >> 4 : -(memVol & 15))); };
    const arpeggio = t => {
      const off = t % 3 === 0 ? 0 : t % 3 === 1 ? par >> 4 : par & 15;
      outPeriod = linear ? period - off * 64 : period * Math.pow(2, -off / 12);
    };

    const effectFirstTick = () => {
      const x = par & 15, sub = par >> 4;
      switch (cmd) {
        case 1: if (par) mem1 = par; break;
        case 2: if (par) mem2 = par; break;
        case 3: if (par) portaSpeed = par << 2; break;
        case 4: if (sub) vibSpeed = sub; if (x) vibDepth = x; break;
        case 5: case 6: case 0xA: if (par) memVol = par; break;
        case 7: if (sub) tremSpeed = sub; if (x) tremDepth = x; break;
        case 8: pan = par; break;
        case 0xC: vol = clampVol(par); break;
        case 0xE:
          if (sub === 1) { if (x) memE1 = x; period = clampPeriod(period - memE1 * 4); }
          else if (sub === 2) { if (x) memE2 = x; period = clampPeriod(period + memE2 * 4); }
          else if (sub === 4) vibWave = x;
          else if (sub === 7) tremWave = x;
          else if (sub === 0xA) { if (x) memFineUp = x; vol = clampVol(vol + memFineUp); }
          else if (sub === 0xB) { if (x) memFineDown = x; vol = clampVol(vol - memFineDown); }
          else if (sub === 0xC && x === 0) vol = 0;
          break;
        case 0x14: if (par === 0) keyOff(); else keyOffAt = par; break;   // K
        case 0x15: volEnvPos = panEnvPos = par; break;                       // L
        case 0x19: if (par) memPan = par; break;                             // P
        case 0x1B: if (sub) retrigVol = sub; if (x) retrigRate = x; break;   // R
        case 0x1D: if (par) tremorMem = par; break;                          // T
        case 0x21:                                                           // X
          if (sub === 1) { if (x) memX1 = x; period = clampPeriod(period - memX1); }
          else if (sub === 2) { if (x) memX2 = x; period = clampPeriod(period + memX2); }
          break;
        default: break;
      }
    };
    const effectLaterTick = t => {
      const x = par & 15, sub = par >> 4;
      switch (cmd) {
        case 0: if (par) arpeggio(t); break;
        case 1: period = clampPeriod(period - mem1 * 4); outPeriod = period; break;
        case 2: period = clampPeriod(period + mem2 * 4); outPeriod = period; break;
        case 3: slideToTarget(); break;
        case 4: vibrato(); break;
        case 5: slideToTarget(); volumeSlide(); break;
        case 6: vibrato(); volumeSlide(); break;
        case 7: {
          const delta = (wave(tremWave, tremPos) * tremDepth) >> 6;
          outVol = clampVol((tremPos & 32) ? vol - delta : vol + delta);
          tremPos = (tremPos + tremSpeed) & 63;
          break;
        }
        case 0xA: volumeSlide(); break;
        case 0xE:
          if (sub === 9 && x && t % x === 0) { pos = 0; dir = 1; active = !!bank[cur]; }
          else if (sub === 0xC && t === x) vol = 0;
          else if (sub === 0xD && delayedRow && t === x) { startRow(delayedRow); delayedRow = null; }
          break;
        case 0x14: if (t === keyOffAt) keyOff(); break;
        case 0x19: pan = clampPan(memPan >> 4 ? pan + (memPan >> 4) : pan - (memPan & 15)); break;
        case 0x1B:
          if (retrigRate && ++retrigCount >= retrigRate) { retrigCount = 0; pos = 0; dir = 1; active = !!bank[cur]; vol = clampVol(RETRIG_VOL[retrigVol](vol)); }
          break;
        case 0x1D: {
          const on = (tremorMem >> 4) + 1, off = (tremorMem & 15) + 1;
          tremorOn = tremorCount % (on + off) < on;
          tremorCount++;
          break;
        }
        default: break;
      }
    };

    // Every tick, playing or not: the envelopes, the fadeout and the automatic vibrato move on.
    let envVol = 64, envPan = 32, autoDelta = 0;
    const instrumentTick = () => {
      const I = instrument();
      envVol = 64; envPan = 32; autoDelta = 0;
      if (!I) return;
      if (I.vol) { envVol = envValue(I.vol, volEnvPos); volEnvPos = envNext(I.vol, volEnvPos, keyOn); }
      if (I.pan) { envPan = envValue(I.pan, panEnvPos); panEnvPos = envNext(I.pan, panEnvPos, keyOn); }
      if (!keyOn && I.vol) fadeVol = Math.max(0, fadeVol - I.fade);
      const [type, sweep, depth, rate] = I.vib;
      if (depth && rate) {
        const full = depth << 8;
        autoAmp = sweep ? Math.min(full, autoAmp + full / sweep) : full;
        autoDelta = (autoWave(type, autoPos) * autoAmp) >> 14;
        autoPos = (autoPos + rate) & 255;
      }
    };

    // One song tick of the channel.
    const tick = (params, slots) => {
      const stamps = clock.stamps;
      const stamp = stamps ? stamps[slots[P.fx]] : 0;
      if (stamp !== lastFx) {
        lastFx = stamp;
        const word = Math.round(params[slots[P.fx]]);
        cmd = (word >> 8) & 0x3f; par = word & 255; tickInRow = 0; keyOffAt = -1;
        const insStamp = stamps ? stamps[slots[P.ins]] : 0, vStamp = stamps ? stamps[slots[P.vcol]] : 0;
        const insWritten = insStamp !== lastIns && insStamp !== 0;
        const vWritten = vStamp !== lastVcol && vStamp !== 0;
        lastIns = insStamp; lastVcol = vStamp;
        vcol = vWritten ? Math.round(params[slots[P.vcol]]) : 0;
        const row = { note: pendingNote, off: pendingOff, insWritten, insValue: Math.max(0, Math.round(params[slots[P.ins]])), v: vcol };
        pendingNote = -1; pendingOff = false; delayedRow = null;
        if (cmd === 0xE && (par >> 4) === 0xD && (par & 15) > 0) delayedRow = row;   // ED: the row starts later
        else startRow(row);
        effectFirstTick();
        outPeriod = period; outVol = vol;
      } else {
        tickInRow++;
        outPeriod = period; outVol = vol;
        volumeColumnLaterTick(vcol);
        effectLaterTick(tickInRow);
        if (cmd !== 7) outVol = vol;
      }
      instrumentTick();
    };

    return {
      message(msg) {
        if (msg.type !== 'sample') return;
        const S = bank[msg.slot | 0] = {
          sample: msg.data, volume: msg.volume ?? 1, pan: Math.max(-1, Math.min(1, msg.pan ?? 0)),
          tune: 12 * Math.log2(Math.max(1, msg.rate) / 8363),   // semitones from C-4 at 8363 Hz
          loop: false, pingpong: msg.pingpong === true, ls: 0, le: 0,
        };
        const start = msg.loopStart ?? 0, end = msg.loopEnd ?? 0;
        if (msg.loopOn !== false && end - start >= 2 && end <= S.sample.length && start >= 0) { S.loop = true; S.ls = start; S.le = end; }
      },
      note(msg) {
        if (msg.type === 'noteOn') { pendingNote = msg.note - MIDI_C0; pendingOff = false; }
        else if (msg.type === 'noteOff' && !msg.implied) { pendingOff = true; if (clock?.playing !== true) keyOff(); }
        else if (msg.type === 'allOff' || msg.type === 'noteCut') { silence(); cmd = par = vcol = 0; lastFx = -1; }
      },
      process(inputs, outputs, n, params, slots) {
        const [outL, outR] = outputs[0];
        const playing = clock?.playing === true;
        const id = clock?.tickId ?? 0;
        if (playing && id !== lastTick) { lastTick = id; tick(params, slots); }
        else if (!playing) {
          lastTick = id;
          if (pendingNote >= 0) {   // not playing: a note from the keyboard sounds at once, with the Ins column's instrument
            ins = Math.max(0, Math.round(params[slots[P.ins]]));
            cmd = par = vcol = 0;
            if (trigger(pendingNote, 0)) takeSampleDefaults();
            outPeriod = period; outVol = vol; pendingNote = -1; pendingOff = false;
            idleSamples = 0; instrumentTick();
          }
          idleSamples += n;   // the envelopes keep time on their own, so an instrument can be heard as it will play
          const tickSamples = clock?.tickSamples || sampleRate / 50;
          while (idleSamples >= tickSamples) { idleSamples -= tickSamples; instrumentTick(); }
        }
        outL.fill(0, 0, n); outR.fill(0, 0, n);
        const S = active ? bank[cur] : null;
        if (!S) { gain = 0; return; }
        const sample = S.sample, len = sample.length;
        const inc = rateOf(clampPeriod(outPeriod + autoDelta), linear) / sampleRate;
        const p0 = clampPan(pan + (envPan - 32) * (128 - Math.abs(pan - 128)) / 32);
        const gl = Math.min(1, (255 - p0) / 127.5), gr = Math.min(1, p0 / 127.5);
        const level = params[slots[P.level]];
        const goal = tremorOn ? outVol / 64 * envVol / 64 * fadeVol / FADE_FULL * level : 0;
        const linearInterp = params[slots[P.interp]] >= 0.5;
        const loop = S.loop, ls = S.ls, le = S.le, span = le - ls;
        const pingpong = loop && S.pingpong, top = le - 1;   // a ping-pong loop turns on its last frame and on its first
        let p = pos;
        for (let i = 0; i < n; i++) {
          if (pingpong) {
            if (dir > 0 && p >= top) { p = top - ((p - top) % (2 * (top - ls))); dir = -1; if (p < ls) { p = 2 * ls - p; dir = 1; } }
            else if (dir < 0 && p <= ls) { p = ls + ((ls - p) % (2 * (top - ls))); dir = 1; if (p > top) { p = 2 * top - p; dir = -1; } }
          } else if (loop) { if (p >= le) p = ls + (p - ls) % span; } else if (p >= len) { active = false; break; }
          const k = Math.floor(p);
          let v = sample[k];
          if (linearInterp) {
            let k2 = k + 1;
            if (pingpong) k2 = Math.min(top, k2);
            else if (loop && k2 >= le) k2 = ls + (k2 - ls) % span;
            v += ((k2 < len ? sample[k2] : 0) - v) * (p - k);
          }
          gain += (goal - gain) * 0.02;
          outL[i] = v * gain * gl; outR[i] = v * gain * gr;
          p += inc * dir;
        }
        pos = p;
      },
    };
  },
};
