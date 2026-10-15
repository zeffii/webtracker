// Voice-aware sample player with a new-note action (NNA).
//
// A new note never interrupts a sample that is playing to its end, so percussion can
// ring over the next hit. A looping sample cannot end by itself, so a new note fades
// the looping voices out over nnaFade ms (0 cuts them at once). Note off releases
// looping voices over release ms and leaves one-shots to finish; all-off (transport
// stop) releases everything; note cut stops everything immediately. A note off that the
// sequencer implies by playing a new note (msg.implied) is ignored here: the new note's
// fade does that job.
//
// A sample has a normal loop and a sustain loop, each with its own crossfade. The sustain loop
// plays while the key is held; at note off the voice leaves it and carries on into the normal loop
// (fading out over `release`), or, with no normal loop, plays on to the end of the sample. A loop
// crossfade blends the last frames of the loop with the audio just before its start, so the seam
// disappears. The sample's volume, global volume and pan apply to every note it plays.
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
  stereoOptional: ['out'],   // stereo when the sample has two channels
  params: [
    { name: 'level', min: 0, max: 1, def: 0.8 },
    { name: 'root', min: 0, max: 127, def: 60 },
    { name: 'release', min: 5, max: 2000, def: 150 },
    { name: 'nnaFade', min: 0, max: 2000, def: 20 },
  ],
  create({ sampleRate, stereo = false }) {
    let sample = null, right = null, ratio = 1, stamp = 0;
    let volume = 1, globalVolume = 1, pan = 0;
    const norm = { on: false, start: 0, end: 0, xf: 0 }, sus = { on: false, start: 0, end: 0, xf: 0 };
    const inSus = new Uint8Array(VOICES);
    const active = new Uint8Array(VOICES), mode = new Uint8Array(VOICES);
    const note = new Int32Array(VOICES);
    const pos = new Float64Array(VOICES), age = new Float64Array(VOICES);
    const gain = new Float32Array(VOICES), env = new Float32Array(VOICES);
    const attack = 1 / (0.002 * sampleRate);   // also the 2 ms ramp used for a cut

    // A loop in frames; it counts only when it fits inside the sample. The crossfade needs that many
    // frames before the loop start and cannot be longer than the loop.
    const setLoop = (loop, on, start = 0, end = 0, xfade = 0) => {
      const ok = sample && end - start >= 2 && end <= sample.length && start >= 0;
      loop.on = !!ok && on !== false;
      loop.start = start; loop.end = end;
      loop.xf = ok ? Math.max(0, Math.min(Math.floor(xfade), start, end - start)) : 0;
    };

    // The sample at frame q, interpolated; when wrapAt > 0 the frame after wrapAt - 1 is `to`.
    const tap = (a, q, wrapAt, to) => {
      const k = q | 0, f = q - k;
      const k1 = wrapAt > 0 && k + 1 >= wrapAt ? to : Math.min(k + 1, a.length - 1);
      return a[k] + (a[k1] - a[k]) * f;
    };

    return {
      // { type: 'sample', data, right?, rate, volume?, globalVolume?, pan?,
      //   loopStart?, loopEnd?, loopOn?, loopXfade?, susStart?, susEnd?, susOn?, susXfade? } in frames.
      message(msg) {
        if (msg.type !== 'sample') return;
        sample = msg.data;
        right = msg.right ?? null;   // second channel of a stereo sample
        ratio = msg.rate / sampleRate;
        volume = msg.volume ?? 1;
        globalVolume = msg.globalVolume ?? 1;
        pan = Math.max(-1, Math.min(1, msg.pan ?? 0));
        setLoop(norm, msg.loopOn, msg.loopStart, msg.loopEnd, msg.loopXfade);
        setLoop(sus, msg.susOn, msg.susStart, msg.susEnd, msg.susXfade);
      },
      note(msg) {
        const looping = norm.on || sus.on;
        if (msg.type === 'noteOn') {
          if (looping) {
            for (let v = 0; v < VOICES; v++) if (active[v] && mode[v] === PLAYING) mode[v] = FADING;
          }
          let v = active.indexOf(0);
          if (v < 0) {   // all voices busy: take the oldest
            v = 0;
            for (let k = 1; k < VOICES; k++) if (age[k] < age[v]) v = k;
          }
          active[v] = 1; mode[v] = PLAYING; note[v] = msg.note; inSus[v] = sus.on ? 1 : 0;
          pos[v] = 0; gain[v] = msg.vel ?? 1; env[v] = 0; age[v] = ++stamp;
        } else if (msg.type === 'noteOff') {
          if (looping && !msg.implied) {   // an implied release (a new note in the same column) is left to nnaFade
            for (let v = 0; v < VOICES; v++) {
              if (!active[v] || mode[v] !== PLAYING || note[v] !== msg.note) continue;
              const wasSus = inSus[v];
              inSus[v] = 0;
              if (norm.on || !wasSus) mode[v] = RELEASING;   // with only a sustain loop the tail plays out
            }
          }
        } else if (msg.type === 'allOff') {
          for (let v = 0; v < VOICES; v++) if (active[v] && mode[v] === PLAYING) { mode[v] = RELEASING; inSus[v] = 0; }
        } else if (msg.type === 'noteCut') {
          active.fill(0);
        }
      },
      process(inputs, outputs, n, params, slots) {
        // a stereo node has a [left, right] pair; a mono node plays a stereo sample as its average
        const outL = stereo ? outputs[0][0] : outputs[0], outR = stereo ? outputs[0][1] : null;
        outL.fill(0, 0, n);
        if (outR) outR.fill(0, 0, n);
        if (!sample) return;
        const level = params[slots[LEVEL]] * globalVolume * volume, root = params[slots[ROOT]];
        const panL = Math.min(1, 1 - pan), panR = Math.min(1, 1 + pan);
        const relStep = 1 / (Math.max(1, params[slots[RELEASE]]) * 0.001 * sampleRate);
        const fadeMs = params[slots[NNA_FADE]];
        const fadeStep = fadeMs <= 0 ? attack : 1 / (fadeMs * 0.001 * sampleRate);
        const last = sample.length - 1;
        for (let v = 0; v < VOICES; v++) {
          if (!active[v]) continue;
          const rate = Math.pow(2, (note[v] - root) / 12) * ratio;
          const m = mode[v];
          const loop = inSus[v] ? sus : norm.on ? norm : null;
          const ls = loop ? loop.start : 0, le = loop ? loop.end : 0, xf = loop ? loop.xf : 0;
          const span = le - ls;
          let p = pos[v], e = env[v];
          for (let i = 0; i < n; i++) {
            if (loop) {
              if (p >= le) p = ls + (p - ls) % span;
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
            const amp = e * gain[v] * level;
            // inside the crossfade the loop's tail blends into the audio before its start
            const t = xf > 0 && p >= le - xf ? (p - (le - xf)) / xf : -1;
            const wa = t < 0 ? 1 : Math.cos(t * Math.PI / 2), wb = t < 0 ? 0 : Math.sin(t * Math.PI / 2);
            let l = tap(sample, p, le, ls), r = 0;
            if (t >= 0) l = l * wa + tap(sample, p - span, 0, 0) * wb;
            if (right) {
              r = tap(right, p, le, ls);
              if (t >= 0) r = r * wa + tap(right, p - span, 0, 0) * wb;
            }
            if (!right) {
              if (outR) { outL[i] += l * amp * panL; outR[i] += l * amp * panR; } else outL[i] += l * amp;
            } else if (outR) {
              outL[i] += l * amp * panL; outR[i] += r * amp * panR;
            } else {
              outL[i] += (l + r) * 0.5 * amp;
            }
            p += rate;
          }
          pos[v] = p; env[v] = e;
        }
      },
    };
  },
};
