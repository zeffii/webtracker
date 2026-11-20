// One Impulse Tracker channel: an IT playroutine for IT files and IT-style patterns. Like the XM channel it plays instruments (keymaps,
// volume / panning / pitch envelopes with sustain and loop points, fadeout, pitch-pan separation), and on top of that it has what makes
// IT what it is:
//   * New Note Actions. A new note on the channel does not have to cut the one still playing: the old voice goes to the background and
//     is cut, carried on, released or faded (the instrument's NNA), and the duplicate check (DCT, DCA) can silence background voices
//     that play the same note, sample or instrument. Up to MAX_BACK voices play behind the host voice.
//   * A resonant low-pass filter on every voice: cutoff and resonance from the instrument, the Zxx effects, and a filter envelope.
//   * Sample sustain loops (kept while the key is down) and ping-pong loops, sample auto-vibrato.
//
// Timing is as for the XM channel: the song's tick is the IT tick, a row is `speed` song ticks, and a row starts when the Cmd column
// writes `fx` (command 01); the note, the Ins cell and the Vol cell of that tick come with it.
//
// The pattern cells:
//   note      C-0 to G-9 play a note, === is the key off, ^^^ cuts the host voice
//   Ins       the instrument (the sample, when the data has no instruments), 00 is number 1
//   Vol       the volume column byte, as in IT: 00-40 set volume, 41-4A fine up, 4B-54 fine down, 55-5E slide up, 5F-68 slide down,
//             69-72 portamento down, 73-7C portamento up, 80-C0 panning, C1-CA tone portamento, CB-D4 vibrato depth
//   Cmd 01    the effect word: the effect number (A is 1 ... Z is 26, written in hex) then the parameter byte, so 010404 is D04
// Effects: D volume slide, E/F portamento down/up, G tone portamento, H vibrato, I tremor, J arpeggio, K/L vibrato / tone portamento
// + volume slide, M channel volume, N channel volume slide, O sample offset, P pan slide, Q retrigger, R tremolo, S0-SF (S3 S4 S5
// waveforms, S7 NNA and envelope switches, S8 pan, SA high offset, SC note cut, SD note delay, SF macro), U fine vibrato, X pan, Y
// panbrello, Z filter (Z00-Z7F cutoff, Z80-Z8F resonance). A, B, C, SB, SE, T, V, W and S6 belong to the song: the importer plays them
// out into the arrangement, so here they do nothing.
//
// IT 3 mode (data.it3): stereo samples and crossfaded loops (the sample's loopXfade / susXfade), neither of which IT has.
// data (set by the importer, kept with the node): { linear, oldEffects, compatG, chanVol, chanPan, ins: [instrument or null],
//   smp: [sample extras] }, an instrument being { nna, dct, dca, fade, pps, ppc, gbv, pan, ifc, ifr, map: [120 slots, -1 for none],
//   notes: [120 notes] (optional remap), vol / pan / pit: envelope, filter: the pitch envelope moves the cutoff }, an envelope
//   { pts: [x0, y0, x1, y1, ...] (ticks, 0..64), ls, le, ss, se: point numbers or -1 }, and the sample extras { pp, spp (ping-pong
//   loop, ping-pong sustain loop), pan (-1: none, else 0..64), vib: [speed, depth, rate, type] }.
// Without data, instrument n plays sample slot n.
const SPEC = [
  { name: 'ins', min: 0, max: 255, def: 0, int: true },
  { name: 'vcol', min: 0, max: 255, def: 0, int: true },
  { name: 'fx', min: 0, max: 0x1aff, def: 0, int: true },
  { name: 'level', min: 0, max: 1, def: 0.45 },
  { name: 'interp', min: 0, max: 1, def: 1, int: true },
];
const P = {};
SPEC.forEach((s, i) => { P[s.name] = i; });

const SINE = [0, 24, 49, 74, 97, 120, 141, 161, 180, 197, 212, 224, 235, 244, 250, 253, 255, 253, 250, 244, 235, 224, 212, 197, 180, 161, 141, 120, 97, 74, 49, 24];
const MIDI_C0 = 12;
const C5 = 60;                         // the note a sample plays at its own rate (IT note numbers count from C-0)
const MAX_BACK = 31;                   // background voices
const MAX_PERIOD = 32000;
const FADE_FULL = 65536;               // the fadeout volume of a new note; every tick of a fade takes 64 times the instrument's fadeout

// Pitch is kept as a "period": linear (64 to a semitone, higher notes have smaller periods) or Amiga (the classic table, times four).
// A note is counted in semitones from C-0 as an XM note would be (IT C-5 is the note an XM plays at 8363 Hz on C-4), a sample's own
// speed folded in as a tuning.
const periodOf = (note, linear) => (linear ? 7680 - (note - 12) * 64 : 1712 * Math.pow(2, (60 - note) / 12));
const rateOf = (period, linear) => (linear ? 8363 * Math.pow(2, (4608 - period) / 768) : 8363 * 1712 / period);

const wave = (kind, pos) => {   // -64..64 for a position 0..63 of the cycle: sine, ramp down, square (random is left to the caller)
  const w = kind & 3, p = pos & 63;
  if (w === 0) return (p & 32 ? -1 : 1) * Math.round(SINE[p & 31] / 4);
  if (w === 1) return 64 - p * 2;
  if (w === 2) return p < 32 ? 64 : -64;
  return 0;
};

const envValue = (env, pos) => {
  const p = env.pts, last = p.length - 2;
  if (pos <= p[0]) return p[1];
  for (let i = 0; i < last; i += 2) {
    const x0 = p[i], x1 = p[i + 2];
    if (pos < x1) return x1 > x0 ? p[i + 1] + (p[i + 3] - p[i + 1]) * (pos - x0) / (x1 - x0) : p[i + 3];
  }
  return p[last + 1];
};
// The tick after `pos`: the sustain loop holds while the key is down, the loop turns at its end.
const envNext = (env, pos, keyOn) => {
  const p = env.pts;
  const next = pos + 1;
  if (keyOn && env.ss >= 0 && next > p[env.se * 2]) return p[env.ss * 2];
  if (env.ls >= 0 && next > p[env.le * 2]) return p[env.ls * 2];
  return next;
};
const validEnvelope = e => (e && Array.isArray(e.pts) && e.pts.length >= 2
  ? { pts: e.pts.map(Number), ls: e.ls ?? -1, le: e.le ?? -1, ss: e.ss ?? -1, se: e.se ?? -1 } : null);

export const FX = { A: 1, B: 2, C: 3, D: 4, E: 5, F: 6, G: 7, H: 8, I: 9, J: 10, K: 11, L: 12, M: 13, N: 14, O: 15, P: 16, Q: 17, R: 18, S: 19, T: 20, U: 21, V: 22, W: 23, X: 24, Y: 25, Z: 26 };

export default {
  type: 'itchan',
  inputs: [],
  outputs: ['out'],
  category: 'Sources',
  samples: true,
  generator: true,
  shared: true,
  shape: 'rounded',
  glyph: 'itchan',
  kinds: { out: 'stereo' },
  params: SPEC,
  create({ sampleRate, clock, data }) {
    const it3 = data?.it3 === true;   // IT 3 mode: stereo samples and crossfaded loops, which IT itself does not have
    let linear = data?.linear !== false, oldEffects = data?.oldEffects === true, compatG = data?.compatG !== false;
    const hasInstruments = Array.isArray(data?.ins) && data.ins.length > 0;
    const instruments = (Array.isArray(data?.ins) ? data.ins : []).map(i => (i ? {
      nna: i.nna | 0, dct: i.dct | 0, dca: i.dca | 0, fade: i.fade | 0, pps: i.pps | 0, ppc: i.ppc ?? C5, gbv: i.gbv ?? 128,
      pan: i.pan ?? -1, ifc: i.ifc ?? -1, ifr: i.ifr ?? -1, map: Array.isArray(i.map) ? i.map : [], notes: Array.isArray(i.notes) ? i.notes : null,
      vol: validEnvelope(i.vol), pan2: validEnvelope(i.pan2), pit: validEnvelope(i.pit), filter: i.filter === true,
    } : null));
    const extras = Array.isArray(data?.smp) ? data.smp : [];
    const bank = [];
    let dice = 0x2545f491;
    const random = () => { dice ^= dice << 13; dice >>>= 0; dice ^= dice >>> 17; dice ^= dice << 5; dice >>>= 0; return dice; };

    // channel state
    let chanVol = data?.chanVol ?? 64, chanPan = data?.chanPan ?? 32, cut = 127, res = 0;
    let curIns = 0;
    // memories
    let memD = 0, memEF = 0, memG = 0, memH = 0, memI = 0, memJ = 0, memM = 0, memN = 0, memO = 0, memP = 0, memQ = 0, memR = 0, memS = 0, memY = 0, memHigh = 0, memVol = 0;
    let vibWave = 0, tremWave = 0, panWave = 0, vibPos = 0, vibSpeed = 0, vibDepth = 0, tremPos = 0, tremSpeed = 0, tremDepth = 0, panPos = 0, panSpeed = 0, panDepth = 0;
    let tremorCount = 0, tremorOn = true, retrigCount = 0, nnaOverride = -1, macro = 0, panbrelloOut = 0;
    // the row
    let cmd = 0, par = 0, vcol = 0, tickInRow = 0, delayedRow = null, noteCutAt = -1, delayTicks = 0;
    let pendingNote = -1, pendingOff = false, pendingCut = false, lastTick = 0, lastFx = -1, lastIns = -1, lastVcol = -1, idleSamples = 0;
    let envOverride = [true, true, true];   // volume, panning and pitch envelopes on (S77 to S7C)

    const newVoice = () => ({
      active: false, slot: -1, pos: 0, dir: 1, note: C5, ins: -1, period: 0, outPeriod: 0, target: 0,
      vol: 64, outVol: 64, pan: 32, gain: 0, keyOn: true, fading: false, fadeVol: FADE_FULL,
      volEnvPos: 0, panEnvPos: 0, pitEnvPos: 0, autoPos: 0, autoAmp: 0, cut: 127, res: 0, envVol: 64, envPan: 32, envMod: 0, pitchOff: 0, autoDelta: 0,
      fg: 1, fb0: 0, fb1: 0, filterOn: false, y: [0, 0, 0, 0],
    });
    let host = newVoice();
    let back = [];
    host.period = host.outPeriod = host.target = periodOf(C5, linear);

    const clampVol = v => Math.max(0, Math.min(64, Math.round(v)));
    const clampPan = v => Math.max(0, Math.min(64, Math.round(v)));
    const clampPeriod = v => Math.max(1, Math.min(MAX_PERIOD, v));
    const instrumentOf = v => (hasInstruments ? instruments[v.ins] ?? null : null);
    const slotFor = (insNo, n) => {   // [the sample slot, the note it plays] for an instrument number and a note
      if (!hasInstruments) return [insNo, n];
      const I = instruments[insNo];
      if (!I) return [-1, n];
      const slot = I.map[n] ?? -1;
      return [slot, I.notes?.[n] ?? n];
    };
    const extra = slot => extras[slot] ?? null;
    const tuneOf = slot => (bank[slot] ? bank[slot].tune : 0);

    const silence = v => { v.active = false; };
    const keyOffVoice = v => {
      v.keyOn = false; v.fading = true;
      if (!instrumentOf(v)) v.vol = 0;   // without an instrument a key off is a cut
    };
    const resetVoiceEnvelopes = v => {
      v.keyOn = true; v.fading = false; v.fadeVol = FADE_FULL; v.volEnvPos = v.panEnvPos = v.pitEnvPos = 0; v.autoPos = 0; v.autoAmp = 0;
    };

    // The filter coefficients of a voice for this tick (IT's resonant two-pole low-pass, in OpenMPT's form).
    const setupFilter = v => {
      const c = Math.max(0, Math.min(127, v.cut)), r = Math.max(0, Math.min(127, v.res));
      const computed = Math.trunc(c * (v.envMod + 256) / 256);
      if (r === 0 && computed >= 254) { v.filterOn = false; return; }
      let freq = 110 * Math.pow(2, 0.25 + c * (v.envMod + 256) / (24 * 512));
      freq = Math.max(120, Math.min(20000, freq));
      freq = Math.min(freq, sampleRate / 2);
      const dmp = Math.pow(10, -r * (24 / 128 / 20));
      const fc = freq * 2 * Math.PI, rr = sampleRate / fc;
      const d = dmp * rr + dmp - 1, e = rr * rr;
      v.fg = 1 / (1 + d + e); v.fb0 = (d + e + e) * v.fg; v.fb1 = -e * v.fg;
      v.filterOn = true;
    };

    // A note arrives on the channel: the host voice's note action, the duplicate check, and the new host voice.
    const newNote = (n, insNo, insWritten, offset) => {
      const [slot, played] = slotFor(insNo, n);
      const I = hasInstruments ? instruments[insNo] ?? null : null;
      if (slot < 0 || !bank[slot]) { return false; }
      // duplicate check on the new note's instrument
      if (I && I.dct) {
        const same = v => v.active && (I.dct === 1 ? v.note === played && v.ins === insNo : I.dct === 2 ? v.slot === slot : v.ins === insNo);
        for (const v of [host, ...back]) {
          if (!same(v)) continue;
          if (I.dca === 0) silence(v); else if (I.dca === 1) keyOffVoice(v); else { v.fading = true; }
        }
      }
      // the note action of the voice that was playing
      if (host.active) {
        const old = instrumentOf(host);
        const action = nnaOverride >= 0 ? nnaOverride : old ? old.nna : 0;
        if (action !== 0) {
          const bg = { ...host, y: host.y.slice() };
          if (action === 2) keyOffVoice(bg); else if (action === 3) bg.fading = true;
          back.push(bg);
          if (back.length > MAX_BACK) back.shift();
        }
      }
      const v = newVoice();
      v.slot = slot; v.ins = insNo; v.note = played; v.active = true;
      v.vol = host.vol; v.pan = host.pan; v.cut = cut; v.res = res;
      v.period = v.outPeriod = v.target = clampPeriod(periodOf(played + tuneOf(slot) - 0, linear));
      v.pos = offset;
      v.active = v.pos < bank[slot].sample.length;
      host = v;
      return true;
    };

    const takeDefaults = (v, insNo) => {   // an instrument number on the row: volume, panning and filter of the instrument and sample
      const S = bank[v.slot];
      if (!S) return;
      const I = hasInstruments ? instruments[insNo] ?? null : null;
      v.vol = clampVol(S.volume * 64);
      const x = extra(v.slot);
      if (I && I.pan >= 0) v.pan = I.pan;
      else if (x && x.pan >= 0) v.pan = x.pan;
      else if (S.panSet) v.pan = clampPan(S.pan * 32 + 32);
      if (I) {
        if (I.ifc >= 0) cut = I.ifc;
        if (I.ifr >= 0) res = I.ifr;
        v.cut = cut; v.res = res;
      }
    };

    // The row's first tick: the note, the instrument, the volume column and the effect's first move.
    const startRow = row => {
      const { note: n, off, insWritten, insValue, v: vc, cutNote } = row;
      const porta = cmd === 7 || cmd === 11 || (vc >= 0xC1 && vc <= 0xCA);
      if (insWritten) curIns = insValue;
      if (cutNote) silence(host);
      else if (off) keyOffVoice(host);
      else if (n >= 0) {
        if (porta && host.active) {
          const [, played] = slotFor(curIns, n);
          host.target = clampPeriod(periodOf(played + tuneOf(host.slot), linear));
          if (insWritten) { takeDefaults(host, curIns); resetVoiceEnvelopes(host); }
        } else {
          if (cmd === 15 && par) memO = par;
          const offset = cmd === 15 ? (memO + memHigh * 256) * 256 : 0;
          if (newNote(n, curIns, insWritten, offset)) {
            if (insWritten) takeDefaults(host, curIns);
            else if (hasInstruments) { const I = instruments[curIns]; if (I && I.ifc >= 0) { cut = I.ifc; host.cut = cut; } if (I && I.ifr >= 0) { res = I.ifr; host.res = res; } }
            const dontReset = (vibWave & 4) !== 0;
            if (!dontReset) vibPos = 0;
            if ((tremWave & 4) === 0) tremPos = 0;
            if ((panWave & 4) === 0) panPos = 0;
            tremorCount = 0; tremorOn = true; retrigCount = 0;
          } else host.active = false;
        }
      } else if (insWritten) { takeDefaults(host, curIns); resetVoiceEnvelopes(host); }
      volumeColumnFirstTick(vc);
    };

    const volumeColumnFirstTick = vc => {
      if (vc < 0) return;
      if (vc <= 64) host.vol = vc;
      else if (vc <= 74) { const x = vc - 65 || memVol; if (vc - 65) memVol = vc - 65; host.vol = clampVol(host.vol + x); }
      else if (vc <= 84) { const x = vc - 75 || memVol; if (vc - 75) memVol = vc - 75; host.vol = clampVol(host.vol - x); }
      else if (vc <= 94) { if (vc - 85) memVol = vc - 85; }
      else if (vc <= 104) { if (vc - 95) memVol = vc - 95; }
      else if (vc <= 114) { if (vc - 105) memEF = (vc - 105) << 2; }
      else if (vc <= 124) { if (vc - 115) memEF = (vc - 115) << 2; }
      else if (vc >= 128 && vc <= 192) host.pan = Math.min(64, vc - 128);
      else if (vc >= 193 && vc <= 202) { const speed = [0, 1, 4, 8, 16, 32, 64, 96, 128, 255][vc - 193]; if (speed) (compatG ? memEF = speed << 2 : memG = speed << 2); }
      else if (vc >= 203 && vc <= 212) { if (vc - 203) vibDepth = vc - 203; }
    };
    const volumeColumnLaterTick = vc => {
      if (vc < 0) return;
      if (vc >= 85 && vc <= 94) host.vol = clampVol(host.vol + memVol);
      else if (vc >= 95 && vc <= 104) host.vol = clampVol(host.vol - memVol);
      else if (vc >= 105 && vc <= 114) { host.period = clampPeriod(host.period + memEF); host.outPeriod = host.period; }
      else if (vc >= 115 && vc <= 124) { host.period = clampPeriod(host.period - memEF); host.outPeriod = host.period; }
      else if (vc >= 193 && vc <= 202) slideToTarget();
      else if (vc >= 203 && vc <= 212) vibrato(false);
    };

    const slideToTarget = () => {
      const speed = compatG ? memEF : memG;
      if (host.period > host.target) host.period = Math.max(host.target, host.period - speed);
      else if (host.period < host.target) host.period = Math.min(host.target, host.period + speed);
      host.outPeriod = host.period;
    };
    const vibrato = fine => {
      const delta = (wave(vibWave, vibPos) * vibDepth) >> (fine ? 7 : oldEffects ? 4 : 5);
      host.outPeriod = host.period + delta;
      vibPos = (vibPos + vibSpeed) & 63;
    };
    const volumeSlide = (param, first) => {
      const x = param >> 4, y = param & 15;
      if (first) {
        if (y === 15 && x > 0) host.vol = clampVol(host.vol + x);        // DxF: fine up
        else if (x === 15 && y > 0) host.vol = clampVol(host.vol - y);   // DFy: fine down
        return;
      }
      if (y === 15 && x > 0) return;
      if (x === 15 && y > 0) return;
      if (y === 0) host.vol = clampVol(host.vol + x); else if (x === 0) host.vol = clampVol(host.vol - y);
    };
    const arpeggio = t => {
      const off = t % 3 === 0 ? 0 : t % 3 === 1 ? memJ >> 4 : memJ & 15;
      host.outPeriod = host.period - off * 64;
    };

    const effectFirstTick = () => {
      const x = par & 15, hi = par >> 4;
      switch (cmd) {
        case 4: if (par) memD = par; volumeSlide(memD, true); break;                              // D
        case 5: case 6: {                                                                         // E, F
          if (par) memEF = par;
          const dir = cmd === 5 ? 1 : -1;
          if (memEF >= 0xF0) host.period = clampPeriod(host.period + dir * (memEF & 15) * 4);
          else if (memEF >= 0xE0) host.period = clampPeriod(host.period + dir * (memEF & 15));
          host.outPeriod = host.period;
          break;
        }
        case 7: if (par) { if (compatG) memEF = par; else memG = par; } break;                    // G (speed is kept as written; x4 on slides)
        case 8: if (hi) vibSpeed = hi; if (x) vibDepth = x; if (par) memH = par; if (oldEffects) vibrato(false); break;   // H
        case 9: if (par) memI = par; break;                                                       // I
        case 10: if (par) memJ = par; break;                                                      // J
        case 11: if (par) memD = par; volumeSlide(memD, true); break;                             // K
        case 12: if (par) memD = par; volumeSlide(memD, true); break;                             // L
        case 13: if (par) memM = par; chanVol = Math.min(64, memM); break;                        // M
        case 14: if (par) memN = par; { const a = memN >> 4, b = memN & 15; if (b === 15 && a > 0) chanVol = Math.min(64, chanVol + a); else if (a === 15 && b > 0) chanVol = Math.max(0, chanVol - b); } break;   // N
        case 16: if (par) memP = par; { const a = memP >> 4, b = memP & 15; if (b === 15 && a > 0) host.pan = clampPan(host.pan - a); else if (a === 15 && b > 0) host.pan = clampPan(host.pan + b); } break;   // P
        case 17: if (par) memQ = par; break;                                                      // Q
        case 18: if (hi) tremSpeed = hi; if (x) tremDepth = x; break;                             // R
        case 19: sFirstTick(); break;                                                             // S
        case 21: if (hi) vibSpeed = hi; if (x) vibDepth = x; break;                               // U
        case 24: host.pan = Math.min(64, (par * 64 + 128) >> 8); break;                           // X
        case 25: if (hi) panSpeed = hi; if (x) panDepth = x; break;                               // Y
        case 26: zFilter(); break;                                                                // Z
        default: break;
      }
    };
    const sFirstTick = () => {
      if (par) memS = par;
      const sub = memS >> 4, x = memS & 15;
      switch (sub) {
        case 3: vibWave = x; break;
        case 4: tremWave = x; break;
        case 5: panWave = x; break;
        case 7:   // NNA and envelope switches
          if (x === 0) { for (const b of back) silence(b); }
          else if (x === 1) { for (const b of back) keyOffVoice(b); }
          else if (x === 2) { for (const b of back) b.fading = true; }
          else if (x >= 3 && x <= 6) nnaOverride = x - 3;
          else if (x >= 7 && x <= 12) envOverride[(x - 7) >> 1] = (x & 1) === 1;
          break;
        case 8: host.pan = Math.min(64, x * 4 + (x >> 2)); break;
        case 10: memHigh = x; break;
        case 12: if (x === 0) silence(host); else noteCutAt = x; break;
        case 15: macro = x; break;
        default: break;
      }
    };
    const zFilter = () => {   // the default macros: Z00-Z7F set the cutoff, Z80-Z8F the resonance
      if (par <= 0x7f) { cut = par; host.cut = cut; }
      else if (par <= 0x8f) { res = (par - 0x80) * 8; host.res = res; }
    };

    const effectLaterTick = t => {
      const x = par & 15, hi = par >> 4;
      switch (cmd) {
        case 4: volumeSlide(memD, false); break;
        case 5: if (memEF < 0xE0) { host.period = clampPeriod(host.period + memEF * 4); host.outPeriod = host.period; } break;
        case 6: if (memEF < 0xE0) { host.period = clampPeriod(host.period - memEF * 4); host.outPeriod = host.period; } break;
        case 7: slideToTarget(); break;
        case 8: vibrato(false); break;
        case 9: {
          const on = (memI >> 4) + 1, off = (memI & 15) + 1;
          tremorOn = tremorCount % (on + off) < on;
          tremorCount++;
          break;
        }
        case 10: arpeggio(t); break;
        case 11: vibrato(false); volumeSlide(memD, false); break;
        case 12: slideToTarget(); volumeSlide(memD, false); break;
        case 14: { const a = memN >> 4, b = memN & 15; if (b === 0) chanVol = Math.min(64, chanVol + a); else if (a === 0) chanVol = Math.max(0, chanVol - b); break; }
        case 16: { const a = memP >> 4, b = memP & 15; if (b === 0) host.pan = clampPan(host.pan - a); else if (a === 0) host.pan = clampPan(host.pan + b); break; }
        case 17: {
          const rate = memQ & 15;
          if (rate && ++retrigCount >= rate) {
            retrigCount = 0;
            const vx = memQ >> 4;
            const changes = [v => v, v => v - 1, v => v - 2, v => v - 4, v => v - 8, v => v - 16, v => v * 2 / 3, v => v / 2,
              v => v, v => v + 1, v => v + 2, v => v + 4, v => v + 8, v => v + 16, v => v * 3 / 2, v => v * 2];
            host.pos = 0; host.dir = 1;
            if (bank[host.slot]) host.active = true;
            host.vol = clampVol(changes[vx](host.vol));
          }
          break;
        }
        case 18: {
          const delta = (wave(tremWave, tremPos) * tremDepth) >> 5;
          host.outVol = clampVol(host.vol + delta);
          tremPos = (tremPos + tremSpeed) & 63;
          break;
        }
        case 19: {
          const sub = memS >> 4, sx = memS & 15;
          if (sub === 12 && t === noteCutAt) { silence(host); noteCutAt = -1; }
          else if (sub === 13 && delayedRow && t === sx) { const row = delayedRow; delayedRow = null; startRow(row); }
          break;
        }
        case 21: vibrato(true); break;
        case 25: panbrelloOut = (wave(panWave, panPos) * panDepth) >> 6; panPos = (panPos + panSpeed) & 63; break;
        default: break;
      }
      if (x === 99 || hi === 99) return;
    };

    // Every tick, playing or not: each voice's envelopes, fadeout, auto-vibrato and filter move on.
    const voiceTick = (v, isHost) => {
      const I = instrumentOf(v), S = bank[v.slot], X = extra(v.slot);
      v.envVol = 64; v.envPan = 32; v.envMod = 0; v.pitchOff = 0; v.autoDelta = 0;
      if (I) {
        if (I.vol && envOverride[0]) { v.envVol = envValue(I.vol, v.volEnvPos); v.volEnvPos = envNext(I.vol, v.volEnvPos, v.keyOn); }
        if (I.pan2 && envOverride[1]) { v.envPan = envValue(I.pan2, v.panEnvPos); v.panEnvPos = envNext(I.pan2, v.panEnvPos, v.keyOn); }
        if (I.pit && envOverride[2]) {
          const e = envValue(I.pit, v.pitEnvPos); v.pitEnvPos = envNext(I.pit, v.pitEnvPos, v.keyOn);
          if (I.filter) v.envMod = (e - 32) * 8; else v.pitchOff = (e - 32) * 32;
        }
        if (v.fading) {
          if (I.fade) v.fadeVol = Math.max(0, v.fadeVol - I.fade * 64);
          else if (!I.vol || !envOverride[0]) v.fadeVol = 0;
        }
      } else if (v.fading) v.fadeVol = 0;
      if (X && X.vib && X.vib[1] && X.vib[2]) {
        const [speed, depth, rate, type] = X.vib;
        v.autoAmp = Math.min(depth << 8, v.autoAmp + (rate << 2));
        const w = type === 3 ? ((random() >> 8) & 127) - 64 : wave(type, v.autoPos);
        v.autoDelta = (w * v.autoAmp) >> 14;
        v.autoPos = (v.autoPos + speed) & 63;
      }
      if (isHost) { v.cut = cut; v.res = res; }
      setupFilter(v);
      if (v.fading && v.fadeVol === 0) v.active = false;
    };
    const allTick = () => {
      voiceTick(host, true);
      for (const b of back) voiceTick(b, false);
      back = back.filter(b => b.active);
    };

    // One song tick of the channel.
    const tick = (params, slots) => {
      const stamps = clock.stamps;
      const stamp = stamps ? stamps[slots[P.fx]] : 0;
      if (stamp !== lastFx) {
        lastFx = stamp;
        const word = Math.round(params[slots[P.fx]]);
        cmd = (word >> 8) & 0x3f; par = word & 255; tickInRow = 0; noteCutAt = -1; panbrelloOut = 0;
        const insStamp = stamps ? stamps[slots[P.ins]] : 0, vStamp = stamps ? stamps[slots[P.vcol]] : 0;
        const insWritten = insStamp !== lastIns && insStamp !== 0;
        const vWritten = vStamp !== lastVcol && vStamp !== 0;
        lastIns = insStamp; lastVcol = vStamp;
        vcol = vWritten ? Math.round(params[slots[P.vcol]]) : -1;
        const row = { note: pendingNote, off: pendingOff, cutNote: pendingCut, insWritten, insValue: Math.max(0, Math.round(params[slots[P.ins]])), v: vcol };
        pendingNote = -1; pendingOff = false; pendingCut = false; delayedRow = null;
        if (cmd === 19 && ((par ? par : memS) >> 4) === 13 && ((par ? par : memS) & 15) > 0) { if (par) memS = par; delayedRow = row; }   // SDx: the row starts later
        else startRow(row);
        effectFirstTick();
        host.outPeriod = host.period; host.outVol = host.vol;
        if (cmd === 8 && oldEffects) { /* vibrato already applied */ }
      } else {
        tickInRow++;
        host.outPeriod = host.period; host.outVol = host.vol; panbrelloOut = cmd === 25 ? panbrelloOut : 0;
        volumeColumnLaterTick(vcol);
        effectLaterTick(tickInRow);
        if (cmd !== 18) host.outVol = host.vol;
      }
      allTick();
    };

    // The sound of one voice into the block.
    const mixVoice = (v, n, outL, outR, level, interpolate) => {
      const S = bank[v.slot];
      if (!v.active || !S) { v.gain = 0; return; }
      const sample = S.sample, len = sample.length, X = extra(v.slot);
      const I = instrumentOf(v);
      const pitch = clampPeriod(v.outPeriod - v.pitchOff + (v.autoDelta ? (linear ? -v.autoDelta : v.autoDelta) : 0));
      const inc = rateOf(pitch, linear) / sampleRate;
      let pan = v.pan + (I ? (v.note - I.ppc) * I.pps / 8 : 0);
      pan += panbrelloOut * (v === host ? 1 : 0);
      pan = clampPan(pan + (v.envPan - 32) * (32 - Math.abs(pan - 32)) / 32);
      const gl = Math.min(1, (64 - pan) / 32), gr = Math.min(1, pan / 32);
      const outVol = v === host ? v.outVol : v.vol;
      const goal = (v === host && !tremorOn) ? 0
        : outVol / 64 * chanVol / 64 * S.globalVolume * (I ? I.gbv / 128 : 1) * v.envVol / 64 * v.fadeVol / FADE_FULL * level;
      const useSus = v.keyOn && S.sus, mainLoop = S.loop;
      const ls = useSus ? S.ss : S.ls, le = useSus ? S.se : S.le;
      const looping = useSus || mainLoop;
      const pingpong = looping && (useSus ? S.spp : S.pp), span = le - ls, top = le - 1;
      if (!pingpong) v.dir = 1;
      const right = it3 ? S.right : null;
      const xf = it3 && looping && !pingpong ? (useSus ? S.sxf : S.xf) : 0;
      const read = (a, q) => {
        const k = Math.floor(q);
        const s0 = a[k] ?? 0;
        if (!interpolate) return s0;
        let k2 = k + 1;
        if (pingpong) k2 = Math.min(top, k2);
        else if (looping && k2 >= le) k2 = ls + (k2 - ls) % span;
        return s0 + ((k2 < len ? a[k2] : 0) - s0) * (q - k);
      };
      let p = v.pos;
      const filterOn = v.filterOn, fg = v.fg, fb0 = v.fb0, fb1 = v.fb1, y = v.y;
      for (let i = 0; i < n; i++) {
        if (pingpong) {
          if (v.dir > 0 && p >= top) { p = top - ((p - top) % (2 * (top - ls))); v.dir = -1; if (p < ls) { p = 2 * ls - p; v.dir = 1; } }
          else if (v.dir < 0 && p <= ls) { p = ls + ((ls - p) % (2 * (top - ls))); v.dir = 1; if (p > top) { p = 2 * top - p; v.dir = -1; } }
        } else if (looping) { if (p >= le) p = ls + (p - ls) % span; } else if (p >= len) { v.active = false; break; }
        let sl = read(sample, p), sr2 = right ? read(right, p) : sl;
        if (xf > 0 && p >= le - xf) {   // inside the crossfade the loop's tail blends into the audio before its start
          const t = (p - (le - xf)) / xf, wa = Math.cos(t * Math.PI / 2), wb = Math.sin(t * Math.PI / 2);
          sl = sl * wa + read(sample, p - span) * wb;
          if (right) sr2 = sr2 * wa + read(right, p - span) * wb;
        }
        const s = sl;
        v.gain += (goal - v.gain) * 0.02;
        let l = s * v.gain * gl, r = sr2 * v.gain * gr;
        if (filterOn) {
          const fl = l * fg + y[0] * fb0 + y[1] * fb1; y[1] = y[0]; y[0] = fl; l = fl;
          const fr = r * fg + y[2] * fb0 + y[3] * fb1; y[3] = y[2]; y[2] = fr; r = fr;
        }
        outL[i] += l; outR[i] += r;
        p += inc * v.dir;
      }
      v.pos = p;
    };

    return {
      message(msg) {
        if (msg.type !== 'sample') return;
        const slot = msg.slot | 0;
        const S = bank[slot] = {
          sample: msg.data, volume: msg.volume ?? 1, globalVolume: msg.globalVolume ?? 1, pan: Math.max(-1, Math.min(1, msg.pan ?? 0)), panSet: msg.panOn === true, pp: msg.pingpong === true, spp: msg.susPingpong === true,
          tune: 12 * Math.log2(Math.max(1, msg.rate) / 8363) - 0,   // semitones from C-4 at 8363 Hz (IT's C-5 is that note: see periodOf)
          loop: false, ls: 0, le: 0, sus: false, ss: 0, se: 0, right: msg.right ?? null, xf: 0, sxf: 0,
        };
        S.tune = 12 * Math.log2(Math.max(1, msg.rate) / 8363);
        const start = msg.loopStart ?? 0, end = msg.loopEnd ?? 0;
        if (msg.loopOn !== false && end - start >= 2 && end <= S.sample.length && start >= 0) { S.loop = true; S.ls = start; S.le = end; S.xf = Math.max(0, Math.min(Math.floor(msg.loopXfade ?? 0), start, end - start)); }
        const ss = msg.susStart ?? 0, se = msg.susEnd ?? 0;
        if (msg.susOn === true && se - ss >= 2 && se <= S.sample.length && ss >= 0) { S.sus = true; S.ss = ss; S.se = se; S.sxf = Math.max(0, Math.min(Math.floor(msg.susXfade ?? 0), ss, se - ss)); }
      },
      note(msg) {
        if (msg.type === 'noteOn') { pendingNote = msg.note - MIDI_C0; pendingOff = false; pendingCut = false; }
        else if (msg.type === 'noteOff' && !msg.implied) { pendingOff = true; if (clock?.playing !== true) keyOffVoice(host); }
        else if (msg.type === 'noteCut') { pendingCut = true; if (clock?.playing !== true) silence(host); }
        else if (msg.type === 'allOff') { silence(host); for (const b of back) silence(b); back = []; pendingNote = -1; pendingOff = false; pendingCut = false; delayedRow = null; cmd = par = 0; vcol = -1; lastFx = -1; }
      },
      process(inputs, outputs, n, params, slots) {
        const [outL, outR] = outputs[0];
        const playing = clock?.playing === true;
        const id = clock?.tickId ?? 0;
        if (playing && id !== lastTick) { lastTick = id; tick(params, slots); }
        else if (!playing) {
          lastTick = id;
          if (pendingNote >= 0) {   // not playing: a note from the keyboard sounds at once, with the Ins column's instrument
            curIns = Math.max(0, Math.round(params[slots[P.ins]]));
            cmd = par = 0; vcol = -1;
            if (newNote(pendingNote, curIns, true, 0)) takeDefaults(host, curIns);
            host.outPeriod = host.period; host.outVol = host.vol; pendingNote = -1; pendingOff = false;
            idleSamples = 0; allTick();
          }
          idleSamples += n;   // the envelopes keep time on their own, so an instrument can be heard as it will play
          const tickSamples = clock?.tickSamples || sampleRate / 50;
          while (idleSamples >= tickSamples) { idleSamples -= tickSamples; allTick(); }
        }
        outL.fill(0, 0, n); outR.fill(0, 0, n);
        const level = params[slots[P.level]], interpolate = params[slots[P.interp]] >= 0.5;
        mixVoice(host, n, outL, outR, level, interpolate);
        for (const b of back) mixVoice(b, n, outL, outR, level, interpolate);
      },
    };
  },
};
