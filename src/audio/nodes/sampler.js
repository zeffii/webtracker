// Voice-aware sample player with a new-note action (NNA).
//
// A new note never interrupts a sample that is playing to its end, so percussion can
// ring over the next hit. A looping sample cannot end by itself, so a new note fades
// the looping voices out over nnaFade ms (0 cuts them at once). Note off releases
// looping voices over release ms and leaves one-shots to finish; all-off (transport
// stop) releases everything; note cut stops everything immediately. A note off that the
// sequencer implies by playing a new note (msg.implied) is ignored here: the new note's
// fade does that job.
const VOICES = 16;
const LEVEL = 0, ROOT = 1, RELEASE = 2, NNA_FADE = 3;
const PLAYING = 0, RELEASING = 1, FADING = 2;   // voice modes

export default {
  type: 'sampler',
  inputs: [],
  outputs: ['out'],
  category: 'Sources',
  shape: 'rounded',
  glyph: 'sample',
  kinds: { out: 'audio' },   // ports are audio unless listed
  params: [
    { name: 'level', min: 0, max: 1, def: 0.8 },
    { name: 'root', min: 0, max: 127, def: 60 },
    { name: 'release', min: 5, max: 2000, def: 150 },
    { name: 'nnaFade', min: 0, max: 2000, def: 20 },
  ],
  create({ sampleRate }) {
    let sample = null, ratio = 1, stamp = 0;
    let looping = false, loopStart = 0, loopEnd = 0;
    const active = new Uint8Array(VOICES), mode = new Uint8Array(VOICES);
    const note = new Int32Array(VOICES);
    const pos = new Float64Array(VOICES), age = new Float64Array(VOICES);
    const gain = new Float32Array(VOICES), env = new Float32Array(VOICES);
    const attack = 1 / (0.002 * sampleRate);   // also the 2 ms ramp used for a cut

    return {
      // { type: 'sample', data, rate, loopStart?, loopEnd? } with loop points in frames.
      message(msg) {
        if (msg.type !== 'sample') return;
        sample = msg.data;
        ratio = msg.rate / sampleRate;
        loopStart = msg.loopStart ?? 0;
        loopEnd = msg.loopEnd ?? 0;
        looping = loopEnd - loopStart >= 2 && loopEnd <= sample.length;
      },
      note(msg) {
        if (msg.type === 'noteOn') {
          if (looping) {
            for (let v = 0; v < VOICES; v++) if (active[v] && mode[v] === PLAYING) mode[v] = FADING;
          }
          let v = active.indexOf(0);
          if (v < 0) {   // all voices busy: take the oldest
            v = 0;
            for (let k = 1; k < VOICES; k++) if (age[k] < age[v]) v = k;
          }
          active[v] = 1; mode[v] = PLAYING; note[v] = msg.note;
          pos[v] = 0; gain[v] = msg.vel ?? 1; env[v] = 0; age[v] = ++stamp;
        } else if (msg.type === 'noteOff') {
          if (looping && !msg.implied) {   // an implied release (a new note in the same column) is left to nnaFade
            for (let v = 0; v < VOICES; v++) {
              if (active[v] && mode[v] === PLAYING && note[v] === msg.note) mode[v] = RELEASING;
            }
          }
        } else if (msg.type === 'allOff') {
          for (let v = 0; v < VOICES; v++) if (active[v] && mode[v] === PLAYING) mode[v] = RELEASING;
        } else if (msg.type === 'noteCut') {
          active.fill(0);
        }
      },
      process(inputs, outputs, n, params, slots) {
        const out = outputs[0];
        out.fill(0, 0, n);
        if (!sample) return;
        const level = params[slots[LEVEL]], root = params[slots[ROOT]];
        const relStep = 1 / (Math.max(1, params[slots[RELEASE]]) * 0.001 * sampleRate);
        const fadeMs = params[slots[NNA_FADE]];
        const fadeStep = fadeMs <= 0 ? attack : 1 / (fadeMs * 0.001 * sampleRate);
        const last = sample.length - 1;
        for (let v = 0; v < VOICES; v++) {
          if (!active[v]) continue;
          const rate = Math.pow(2, (note[v] - root) / 12) * ratio;
          const m = mode[v];
          let p = pos[v], e = env[v];
          for (let i = 0; i < n; i++) {
            if (looping) {
              if (p >= loopEnd) p = loopStart + (p - loopStart) % (loopEnd - loopStart);
            } else if (p >= last) {
              active[v] = 0;
              break;
            }
            if (m === PLAYING) {
              if (e < 1) e = Math.min(1, e + attack);
            } else {
              e -= m === RELEASING ? relStep : fadeStep;
              if (e <= 0) { active[v] = 0; break; }
            }
            const k = p | 0, f = p - k;
            const k1 = looping && k + 1 >= loopEnd ? loopStart : Math.min(k + 1, last);
            out[i] += (sample[k] + (sample[k1] - sample[k]) * f) * e * gain[v] * level;
            p += rate;
          }
          pos[v] = p; env[v] = e;
        }
      },
    };
  },
};
