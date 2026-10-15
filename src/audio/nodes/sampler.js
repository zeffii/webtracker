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
//
// Where a note starts and how it repeats (the settings are read as the note starts, and the pattern writes
// them just before): `offset` is the start position as a fraction of the sample; `reverse` plays backwards,
// the offset then measured from the end. `retrig` is the time between repeats of the note in ticks (0 is
// no repeats; in a pattern hex 1000 is one tick), `repeats` how many (0 until the note ends), `shift` how far
// each repeat's start moves along the sample (a fraction of it, negative goes back; the repeats stop when it
// runs off the sample) and `ramp` what each repeat's volume is multiplied by (below 1 fades out). A repeat
// restarts the sound with a 2 ms crossfade from the one before. Repeats end at the next note, note off or cut.
const VOICES = 16;
const LEVEL = 0, ROOT = 1, RELEASE = 2, NNA_FADE = 3, OFFSET = 4, REVERSE = 5, RETRIG = 6, REPEATS = 7, SHIFT = 8, RAMP = 9, SAMPLE = 10, SLICE = 11;
const PLAYING = 0, RELEASING = 1, FADING = 2, CUTTING = 3;   // voice modes (cutting: the 2 ms fade of a sound a repeat replaces)

export default {
  type: 'sampler',
  inputs: [],
  outputs: ['out'],
  category: 'Sources',
  generator: true,   // makes sound from notes, so the instrument screen can play it from the keyboard
  shape: 'rounded',
  glyph: 'sample',
  kinds: { out: 'audio' },   // ports are audio unless listed
  stereoOptional: ['out'],   // stereo when the sample has two channels
  params: [
    { name: 'level', min: 0, max: 1, def: 0.8 },
    { name: 'root', min: 0, max: 127, def: 60 },
    { name: 'release', min: 5, max: 2000, def: 150 },
    { name: 'nnaFade', min: 0, max: 2000, def: 20 },
    { name: 'offset', min: 0, max: 1, def: 0 },                        // where the note starts, as a fraction of the sample
    { name: 'reverse', min: 0, max: 1, def: 0, int: true },
    { name: 'retrig', min: 0, max: 65535 / 4096, def: 0 },             // ticks between repeats; hex 1000 is one tick
    { name: 'repeats', min: 0, max: 255, def: 0, int: true },          // 0: until the note ends
    { name: 'shift', min: -1, max: 65535 / 32768 - 1, def: 0 },        // per repeat; hex 8000 is zero
    { name: 'ramp', min: 0, max: 65535 / 49152, def: 1 },              // per repeat; hex C000 is one
    { name: 'sample', min: 0, max: 255, def: 0, int: true },           // which sample of the instrument's list plays
    { name: 'slice', min: 0, max: 65535, def: 65535, int: true },      // start at this slice marker of the sample (a number past the last: off, use `offset`)
  ],
  create({ sampleRate, stereo = false, clock }) {
    // The samples this node can play, by slot (the instrument's sample list); a note picks one by the `sample`
    // parameter as it starts. Each has its own data, tuning, levels and loops.
    const bank = [];
    let stamp = 0;
    const fromSlice = new Uint8Array(VOICES);   // the chain started at a slice marker, where reverse plays backwards from the marker
    const sm = new Int32Array(VOICES), loopy = new Uint8Array(VOICES);   // each voice's slot, and whether that sample loops
    const inSus = new Uint8Array(VOICES);
    const active = new Uint8Array(VOICES), mode = new Uint8Array(VOICES);
    const note = new Int32Array(VOICES);
    const pos = new Float64Array(VOICES), age = new Float64Array(VOICES);
    const gain = new Float32Array(VOICES), env = new Float32Array(VOICES);
    const attack = 1 / (0.002 * sampleRate);   // also the 2 ms ramp used for a cut
    // Repeats: per voice, the samples to the next one (Infinity: none), how many are left, and the chain's settings.
    // skip: samples of the block before a voice starts; cutAt: the sample of the block where a repeat replaces it.
    const fresh = new Uint8Array(VOICES), dir = new Float64Array(VOICES).fill(1), frac = new Float64Array(VOICES);
    const countdown = new Float64Array(VOICES).fill(Infinity), left = new Float64Array(VOICES);
    const interval = new Float64Array(VOICES), shiftBy = new Float64Array(VOICES), rampBy = new Float64Array(VOICES).fill(1);
    const skip = new Int32Array(VOICES), cutAt = new Float64Array(VOICES).fill(Infinity);
    const endChain = v => { countdown[v] = Infinity; };

    // A loop in frames; it counts only when it fits inside the sample. The crossfade needs that many
    // frames before the loop start and cannot be longer than the loop.
    const setLoop = (S, loop, on, start = 0, end = 0, xfade = 0) => {
      const ok = end - start >= 2 && end <= S.sample.length && start >= 0;
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
      // { type: 'sample', slot?, data, right?, rate, volume?, globalVolume?, pan?,
      //   loopStart?, loopEnd?, loopOn?, loopXfade?, susStart?, susEnd?, susOn?, susXfade? } in frames.
      message(msg) {
        if (msg.type !== 'sample') return;
        const S = bank[msg.slot | 0] = {
          sample: msg.data,
          right: msg.right ?? null,   // second channel of a stereo sample
          ratio: msg.rate / sampleRate,
          volume: msg.volume ?? 1,
          globalVolume: msg.globalVolume ?? 1,
          pan: Math.max(-1, Math.min(1, msg.pan ?? 0)),
          slices: Array.isArray(msg.slices) ? msg.slices.filter(Number.isFinite) : [],   // marker frames, sorted
          norm: { on: false, start: 0, end: 0, xf: 0 }, sus: { on: false, start: 0, end: 0, xf: 0 },
        };
        setLoop(S, S.norm, msg.loopOn, msg.loopStart, msg.loopEnd, msg.loopXfade);
        setLoop(S, S.sus, msg.susOn, msg.susStart, msg.susEnd, msg.susXfade);
      },
      note(msg) {
        if (msg.type === 'noteOn') {
          for (let v = 0; v < VOICES; v++) if (active[v]) endChain(v);   // a new note ends the repeats of the one before
          // a looping sample cannot end by itself, so a new note fades it; choke: the keyjazz in the sample screen,
          // where a new note fades the old one even if it is a one-shot
          for (let v = 0; v < VOICES; v++) if (active[v] && mode[v] === PLAYING && (loopy[v] || msg.choke)) mode[v] = FADING;
          let v = active.indexOf(0);
          if (v < 0) {   // all voices busy: take the oldest
            v = 0;
            for (let k = 1; k < VOICES; k++) if (age[k] < age[v]) v = k;
          }
          active[v] = 1; mode[v] = PLAYING; note[v] = msg.note; inSus[v] = 0; loopy[v] = 0;
          pos[v] = 0; gain[v] = msg.vel ?? 1; env[v] = 0; age[v] = ++stamp;
          fresh[v] = 1; countdown[v] = Infinity; dir[v] = 1; skip[v] = 0; cutAt[v] = Infinity;
        } else if (msg.type === 'noteOff') {
          for (let v = 0; v < VOICES; v++) if (active[v] && note[v] === msg.note) endChain(v);
          if (!msg.implied) {   // an implied release (a new note in the same column) is left to nnaFade
            for (let v = 0; v < VOICES; v++) {
              if (!active[v] || !loopy[v] || mode[v] !== PLAYING || note[v] !== msg.note) continue;
              const S = bank[sm[v]], wasSus = inSus[v];
              inSus[v] = 0;
              if (S.norm.on || !wasSus) mode[v] = RELEASING;   // with only a sustain loop the tail plays out
            }
          }
        } else if (msg.type === 'allOff') {
          for (let v = 0; v < VOICES; v++) {
            if (active[v]) endChain(v);
            if (active[v] && mode[v] === PLAYING) { mode[v] = RELEASING; inSus[v] = 0; }
          }
        } else if (msg.type === 'noteCut') {
          active.fill(0);
          countdown.fill(Infinity);
        }
      },
      process(inputs, outputs, n, params, slots) {
        // a stereo node has a [left, right] pair; a mono node plays a stereo sample as its average
        const outL = stereo ? outputs[0][0] : outputs[0], outR = stereo ? outputs[0][1] : null;
        outL.fill(0, 0, n);
        if (outR) outR.fill(0, 0, n);
        if (!bank.length) return;
        const root = params[slots[ROOT]];
        const relStep = 1 / (Math.max(1, params[slots[RELEASE]]) * 0.001 * sampleRate);
        const fadeMs = params[slots[NNA_FADE]];
        const fadeStep = fadeMs <= 0 ? attack : 1 / (fadeMs * 0.001 * sampleRate);
        // Voices that have just started read where to start and whether to repeat.
        const tickSamples = clock?.tickSamples ?? 0;
        for (let v = 0; v < VOICES; v++) {
          if (!active[v] || !fresh[v]) continue;
          fresh[v] = 0;
          const si = Math.max(0, Math.min(255, Math.floor(params[slots[SAMPLE]]) || 0));
          if (!bank[si]) { active[v] = 0; continue; }   // no sample in that slot: the note is silent
          sm[v] = si;
          const last = bank[si].sample.length - 1;
          inSus[v] = bank[si].sus.on ? 1 : 0; loopy[v] = bank[si].norm.on || bank[si].sus.on ? 1 : 0;
          const marker = bank[si].slices[Math.floor(params[slots[SLICE]])];   // a slice marker, when the slice command picked one, wins over the offset
          const off = marker !== undefined ? Math.min(1, marker / Math.max(1, last)) : Math.max(0, Math.min(1, params[slots[OFFSET]]));
          frac[v] = off; fromSlice[v] = marker !== undefined ? 1 : 0;
          dir[v] = params[slots[REVERSE]] >= 1 ? -1 : 1;
          pos[v] = dir[v] > 0 || fromSlice[v] ? off * last : last - off * last;
          const every = params[slots[RETRIG]] * tickSamples;
          if (every >= 1) {
            interval[v] = every; countdown[v] = every;
            const reps = Math.floor(params[slots[REPEATS]]);
            left[v] = reps > 0 ? reps : Infinity;
            shiftBy[v] = params[slots[SHIFT]]; rampBy[v] = params[slots[RAMP]];
          }
        }
        // Repeats that fall in this block: the new voice starts part way through it and the old one is cut there.
        const heads = [];
        for (let v = 0; v < VOICES; v++) if (active[v] && countdown[v] < Infinity) heads.push(v);
        for (let cur of heads) {
          while (countdown[cur] < n) {
            const at = Math.max(0, Math.ceil(countdown[cur]));
            const nextFrac = frac[cur] + shiftBy[cur];
            if (left[cur] < 1 || nextFrac < 0 || nextFrac > 1) { countdown[cur] = Infinity; break; }   // the chain is finished
            let w = active.indexOf(0);
            if (w < 0) {   // all voices busy: take the oldest, not the one being repeated
              w = cur === 0 ? 1 : 0;
              for (let k = 0; k < VOICES; k++) if (k !== cur && age[k] < age[w]) w = k;
            }
            const last = bank[sm[cur]].sample.length - 1;
            active[w] = 1; mode[w] = PLAYING; note[w] = note[cur]; inSus[w] = 0; fresh[w] = 0; sm[w] = sm[cur]; loopy[w] = loopy[cur];
            env[w] = 0; age[w] = ++stamp; skip[w] = at; cutAt[w] = Infinity;
            gain[w] = gain[cur] * rampBy[cur]; dir[w] = dir[cur]; frac[w] = nextFrac; fromSlice[w] = fromSlice[cur];
            pos[w] = dir[w] > 0 || fromSlice[w] ? nextFrac * last : last - nextFrac * last;
            interval[w] = interval[cur]; shiftBy[w] = shiftBy[cur]; rampBy[w] = rampBy[cur];
            left[w] = left[cur] - 1; countdown[w] = countdown[cur] + interval[cur];
            cutAt[cur] = at; countdown[cur] = Infinity;
            cur = w;
          }
          if (countdown[cur] < Infinity) countdown[cur] -= n;
        }
        for (let v = 0; v < VOICES; v++) {
          if (!active[v]) continue;
          const S = bank[sm[v]], sample = S.sample, right = S.right, norm = S.norm, sus = S.sus, last = sample.length - 1;
          const level = params[slots[LEVEL]] * S.globalVolume * S.volume;
          const panL = Math.min(1, 1 - S.pan), panR = Math.min(1, 1 + S.pan);
          const rate = Math.pow(2, (note[v] - root) / 12) * S.ratio;
          let m = mode[v];
          const back = dir[v] < 0;
          const loop = back ? null : inSus[v] ? sus : norm.on ? norm : null;
          const ls = loop ? loop.start : 0, le = loop ? loop.end : 0, xf = loop ? loop.xf : 0;
          const span = le - ls;
          let p = pos[v], e = env[v];
          for (let i = skip[v]; i < n; i++) {
            if (i >= cutAt[v]) m = mode[v] = CUTTING;
            if (loop) {
              if (p >= le) p = ls + (p - ls) % span;
            } else if (back ? p <= 0 : p >= last) {
              active[v] = 0;
              break;
            }
            if (m === PLAYING) {
              if (e < 1) e = Math.min(1, e + attack);
            } else {
              e -= m === RELEASING ? relStep : m === FADING ? fadeStep : attack;
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
            p += back ? -rate : rate;
          }
          pos[v] = p; env[v] = e; skip[v] = 0;
        }
        cutAt.fill(Infinity);
      },
    };
  },
};
