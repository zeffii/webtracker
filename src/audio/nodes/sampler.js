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
//
// Grains. With `grain` set, every sound the note makes (the first and each repeat) lasts that many ticks, with a fade in and out
// (`edge`), and the repeats no longer cut the one before: they overlap, so a short interval with a long grain is a cloud. Each
// repeat can also change the pitch (`step`, semitones), speed up or slow down the repeats (`accel`), and play backwards in turn
// (`flip`); `prob` is the chance that a repeat sounds at all. The jitters (`jOffset`, `jPitch`, `jPan`, `jTime`, `jLevel`) move each
// sound by a random amount up to the value set, which is what makes a stutter into a texture. `slide` bends the pitch while a sound
// plays (semitones per tick). All of them are off by default.
const VOICES = 16;
const LEVEL = 0, ROOT = 1, RELEASE = 2, NNA_FADE = 3, OFFSET = 4, REVERSE = 5, RETRIG = 6, REPEATS = 7, SHIFT = 8, RAMP = 9, SAMPLE = 10, SLICE = 11;
const VS = 24, VS_KINDS = ['lin', 'log', 'down', 'up', 'fineDown', 'fineUp', 'downMs', 'upMs', 'fineDownMs', 'fineUpMs'];   // volume slides: ten parameters, 24 to 33
const ABS = 35;     // the `blockCount` parameter: below 65535, Off holds the low four hex digits of a frame number and this the blocks of 65536 frames before it
const SUBDIV = 34;   // the `subdivide` parameter: subticks per tick, for the times of the slides (UnwieldyTracker's Subdivide, default 6)
const FLOOR = 1e-6;   // a slide to nothing stops at -120 dB, as UnwieldyTracker's does
const GRAIN = 12, EDGE = 13, ACCEL = 14, STEP = 15, SLIDE = 16, FLIP = 17, PROB = 18, JOFF = 19, JPITCH = 20, JPAN = 21, JTIME = 22, JLEVEL = 23;
const DEFAULTS = { [ABS]: 65535, [SUBDIV]: 6, [EDGE]: 0.5, [ACCEL]: 1, [PROB]: 1, [RAMP]: 1 };   // for a node whose parameter list is older than these
const PLAYING = 0, RELEASING = 1, FADING = 2, CUTTING = 3;   // voice modes (cutting: the 2 ms fade of a sound a repeat replaces)

export default {
  type: 'sampler',
  inputs: [],
  outputs: ['out'],
  category: 'Sources',
  samples: true,     // plays the samples listed for the node
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
    { name: 'grain', min: 0, max: 65535 / 4096, def: 0 },              // how long each sound lasts, in ticks (hex 1000 is one tick); 0: the sample's own length
    { name: 'edge', min: 0, max: 1, def: 0.5 },                        // how much of a grain is fade: 0 hard edges (2 ms), 1 triangle
    { name: 'accel', min: 0, max: 65535 / 32768, def: 1 },             // each repeat's interval is multiplied by this; hex 8000 is 1
    { name: 'step', min: -16, max: 65535 / 2048 - 16, def: 0 },        // semitones each repeat is higher; hex 8000 is 0, 0800 is one semitone
    { name: 'slide', min: -16, max: 65535 / 2048 - 16, def: 0 },       // pitch bend while a sound plays, semitones per tick; hex 8000 is 0
    { name: 'flip', min: 0, max: 1, def: 0, int: true },               // 1: every repeat plays the other way round
    { name: 'prob', min: 0, max: 1, def: 1 },                          // chance that a repeat sounds; hex FFFF is always
    { name: 'jOffset', min: 0, max: 1, def: 0 },                       // random start position, up to this fraction of the sample either way
    { name: 'jPitch', min: 0, max: 12, def: 0 },                       // random pitch, up to this many semitones either way
    { name: 'jPan', min: 0, max: 1, def: 0 },                          // random pan, up to this far left or right
    { name: 'jTime', min: 0, max: 1, def: 0 },                         // each repeat comes late by a random part of the interval, up to this
    { name: 'jLevel', min: 0, max: 1, def: 0 },                        // random volume: down by up to this fraction
    // Volume slides, as in UnwieldyTracker. Each is a 16-bit value XXYY: XX the time (in subticks, six to a tick; the Ms ones in tens of
    // milliseconds, 0 at once) and YY the amount. Written to a sound that is playing it slides that sound; written before a note it slides
    // every sound of the note from its start.
    { name: 'volLin', min: 0, max: 65535, def: 0, int: true },           // linear slide to the level YY / 40 hex (40 is the sound's own level)
    { name: 'volLog', min: 0, max: 65535, def: 0, int: true },           // the same, even in dB
    { name: 'volDown', min: 0, max: 65535, def: 0, int: true },          // logarithmic slide down by YY dB
    { name: 'volUp', min: 0, max: 65535, def: 0, int: true },            // logarithmic slide up by YY dB
    { name: 'volFineDown', min: 0, max: 65535, def: 0, int: true },      // logarithmic slide down by YY / 256 dB
    { name: 'volFineUp', min: 0, max: 65535, def: 0, int: true },        // logarithmic slide up by YY / 256 dB
    { name: 'volDownMs', min: 0, max: 65535, def: 0, int: true },        // as volDown, in 10 * XX milliseconds
    { name: 'volUpMs', min: 0, max: 65535, def: 0, int: true },
    { name: 'volFineDownMs', min: 0, max: 65535, def: 0, int: true },
    { name: 'volFineUpMs', min: 0, max: 65535, def: 0, int: true },
    { name: 'subdivide', min: 1, max: 255, def: 6, int: true },        // subticks in a tick, for the time of the volume slides
    { name: 'blockCount', min: 0, max: 65535, def: 65535, int: true },   // absolute offset: the 65536-frame block Off counts from (the FF command); 65535 is off, Off is a fraction of the sample (the F0 command)
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
    // Repeats are chains: each remembers where the next sound comes from and when. nom is the time of the next repeat in samples
    // from the start of the block, spawnIn the same plus its random lateness.
    // skip: samples of the block before a voice starts; cutAt: the sample of the block where a repeat replaces it.
    const fresh = new Uint8Array(VOICES), dir = new Float64Array(VOICES).fill(1);
    const skip = new Int32Array(VOICES), cutAt = new Float64Array(VOICES).fill(Infinity);
    const pitchMul = new Float64Array(VOICES).fill(1), slideMul = new Float64Array(VOICES).fill(1), vpan = new Float64Array(VOICES);
    const grainLeft = new Float64Array(VOICES).fill(Infinity), atkStep = new Float64Array(VOICES).fill(1), fadeStep = new Float64Array(VOICES).fill(1);
    const volMul = new Float64Array(VOICES).fill(1), vsKind = new Uint8Array(VOICES), vsLeft = new Float64Array(VOICES), vsStep = new Float64Array(VOICES);
    const lastVs = new Float64Array(VS_KINDS.length);   // the slide values seen last, to notice a new one written to a sound that is playing
    let chains = [];
    const endChain = v => { for (const c of chains) if (c.v === v) c.alive = false; };
    let seed = 0x2545f491;
    const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
    const jit = () => rnd() * 2 - 1;
    const MIN_GAP = 0.001 * sampleRate;

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
          for (const c of chains) c.alive = false;   // a new note ends the repeats of the one before
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
          fresh[v] = 1; dir[v] = 1; skip[v] = 0; cutAt[v] = Infinity; grainLeft[v] = Infinity;
        } else if (msg.type === 'noteOff') {
          for (const c of chains) if (c.note === msg.note) c.alive = false;
          if (!msg.implied) {   // an implied release (a new note in the same column) is left to nnaFade
            for (let v = 0; v < VOICES; v++) {
              if (!active[v] || !loopy[v] || mode[v] !== PLAYING || note[v] !== msg.note) continue;
              const S = bank[sm[v]], wasSus = inSus[v];
              inSus[v] = 0;
              if (S.norm.on || !wasSus) mode[v] = RELEASING;   // with only a sustain loop the tail plays out
            }
          }
        } else if (msg.type === 'allOff') {
          for (const c of chains) c.alive = false;
          for (let v = 0; v < VOICES; v++) if (active[v] && mode[v] === PLAYING) { mode[v] = RELEASING; inSus[v] = 0; }
        } else if (msg.type === 'noteCut') {
          active.fill(0);
          chains = [];
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
        const fadeStepNna = fadeMs <= 0 ? attack : 1 / (fadeMs * 0.001 * sampleRate);
        // Voices that have just started read where to start and whether to repeat.
        const tickSamples = clock?.tickSamples ?? 0;
        const clamp01 = x => Math.max(0, Math.min(1, x));
        // A volume slide on voice w: kind index into VS_KINDS, value XXYY.
        const subdivide = Math.max(1, Math.floor(Number.isFinite(params[slots[SUBDIV]]) ? params[slots[SUBDIV]] : 6));
        const startSlide = (w, kind, value) => {
          const t = (value >> 8) & 255, a = value & 255, cur = Math.max(FLOOR, volMul[w]);
          const n = Math.max(1, Math.round(kind >= 6 ? t * 0.01 * sampleRate : t / subdivide * tickSamples));   // the Ms ones: 10 * t milliseconds
          vsLeft[w] = n;
          if (kind === 0) { vsKind[w] = 1; vsStep[w] = (a / 64 - volMul[w]) / n; return; }
          const k = kind >= 6 ? kind - 4 : kind, down = k === 2 || k === 4, fine = k >= 4;   // the Ms kinds are the same slides with another unit of time
          const target = k === 1 ? Math.max(FLOOR, a / 64) : cur * Math.pow(10, (down ? -1 : 1) * (fine ? a / 256 : a) / 20);
          vsKind[w] = 2; vsStep[w] = Math.pow(Math.max(FLOOR, target) / cur, 1 / n);
        };
        // Starts a sound on voice w from a chain's state: where in the sample, which way, how loud, how high; the jitters apply here.
        const begin = (w, st, at) => {
          const S = bank[st.si], cfg = st.cfg, last = S.sample.length - 1;
          const start = st.fromSlice ? st.base : clamp01(st.base + cfg.jOffset * jit());
          sm[w] = st.si; note[w] = st.note; dir[w] = st.dir; fromSlice[w] = st.fromSlice ? 1 : 0;
          inSus[w] = S.sus.on ? 1 : 0; loopy[w] = S.norm.on || S.sus.on ? 1 : 0;
          pos[w] = dir[w] > 0 || fromSlice[w] ? start * last : last - start * last;
          gain[w] = st.gain * (1 - cfg.jLevel * rnd());
          pitchMul[w] = Math.pow(2, (st.pitch + cfg.jPitch * jit()) / 12);
          volMul[w] = 1; vsLeft[w] = 0; vsKind[w] = 0;
          if (cfg.vs) startSlide(w, cfg.vs.kind, cfg.vs.value);
          slideMul[w] = cfg.slide !== 0 && tickSamples > 0 ? Math.pow(2, cfg.slide / 12 / tickSamples) : 1;
          vpan[w] = cfg.jPan * jit();
          skip[w] = at;
          if (cfg.grain >= 1) {
            const fade = Math.max(0.002 * sampleRate, cfg.edge * cfg.grain / 2);
            atkStep[w] = fadeStep[w] = 1 / Math.min(fade, cfg.grain / 2 + 1);
            grainLeft[w] = Math.max(0, cfg.grain - fade);
          } else { atkStep[w] = attack; fadeStep[w] = attack; grainLeft[w] = Infinity; }
        };
        for (let v = 0; v < VOICES; v++) {
          if (!active[v] || !fresh[v]) continue;
          fresh[v] = 0;
          const si = Math.max(0, Math.min(255, Math.floor(params[slots[SAMPLE]]) || 0));
          if (!bank[si]) { active[v] = 0; continue; }   // no sample in that slot: the note is silent
          const last = bank[si].sample.length - 1;
          const marker = bank[si].slices[Math.floor(params[slots[SLICE]])];   // a slice marker, when the slice command picked one, wins over the offset
          const block = Math.floor(Number.isFinite(params[slots[ABS]]) ? params[slots[ABS]] : 65535);
          const frame = block < 65535 ? block * 65536 + Math.round(Math.max(0, Math.min(1, params[slots[OFFSET]])) * 65535) : -1;   // absolute: Off is the low part of the frame number
          const off = marker !== undefined ? Math.min(1, marker / Math.max(1, last)) : frame >= 0 ? Math.min(1, frame / Math.max(1, last)) : Math.max(0, Math.min(1, params[slots[OFFSET]]));
          const P = i => { const x = params[slots[i]]; return Number.isFinite(x) ? x : DEFAULTS[i] ?? 0; };
          const cfg = {
            shift: P(SHIFT), ramp: P(RAMP), accel: P(ACCEL), step: P(STEP), flip: P(FLIP) >= 1, prob: P(PROB), slide: P(SLIDE),
            grain: P(GRAIN) * tickSamples, edge: P(EDGE), jOffset: P(JOFF), jPitch: P(JPITCH), jPan: P(JPAN), jTime: P(JTIME), jLevel: P(JLEVEL),
          };
          let vs = null;
          VS_KINDS.forEach((_, k) => { const x = Math.floor(P(VS + k)); lastVs[k] = x; if (!vs && x > 0) vs = { kind: k, value: x }; });
          cfg.vs = vs;
          const st = { si, note: note[v], dir: P(REVERSE) >= 1 ? -1 : 1, fromSlice: marker !== undefined, base: off, gain: gain[v], pitch: 0, cfg };
          begin(v, st, 0);
          const every = P(RETRIG) * tickSamples;
          if (every >= 1) {
            const reps = Math.floor(P(REPEATS));
            chains.push({ alive: true, v, vAge: age[v], note: note[v], st, interval: every, nom: every, spawnIn: every + cfg.jTime * every * rnd(), left: reps > 0 ? reps : Infinity });
          }
        }
        // A slide value written while sounds play slides them (the sounds that are playing and not yet fading out).
        for (let k = 0; k < VS_KINDS.length; k++) {
          const x = Math.floor(params[slots[VS + k]]);
          if (!Number.isFinite(x)) continue;
          if (x !== lastVs[k] && x > 0) for (let v = 0; v < VOICES; v++) if (active[v] && mode[v] === PLAYING) startSlide(v, k, x);
          lastVs[k] = x;
        }
        // Repeats that fall in this block: the new sound starts part way through it and, with no grain length, the one before is cut there.
        chains = chains.filter(c => c.alive);
        for (const c of chains) {
          const st = c.st, cfg = st.cfg;
          while (c.spawnIn < n) {
            const nextBase = st.base + cfg.shift;
            if (c.left < 1 || nextBase < 0 || nextBase > 1) { c.alive = false; break; }   // the chain is finished
            st.base = nextBase; st.gain *= cfg.ramp; st.pitch += cfg.step; if (cfg.flip) st.dir = -st.dir;
            c.left--;
            const at = Math.max(0, Math.ceil(c.spawnIn));
            if (rnd() < cfg.prob) {
              let w = active.indexOf(0);
              if (w < 0) {   // all voices busy: take the oldest, not the one being repeated
                w = c.v === 0 ? 1 : 0;
                for (let k = 0; k < VOICES; k++) if (k !== c.v && age[k] < age[w]) w = k;
              }
              if (cfg.grain < 1 && active[c.v] && age[c.v] === c.vAge) cutAt[c.v] = at;
              active[w] = 1; mode[w] = PLAYING; inSus[w] = 0; fresh[w] = 0; env[w] = 0; age[w] = ++stamp; cutAt[w] = Infinity;
              begin(w, st, at);
              c.v = w; c.vAge = age[w];
            }
            c.nom += c.interval;
            c.interval = Math.max(MIN_GAP, c.interval * cfg.accel);
            c.spawnIn = c.nom + cfg.jTime * c.interval * rnd();
          }
          if (c.alive) { c.nom -= n; c.spawnIn -= n; }
        }
        for (let v = 0; v < VOICES; v++) {
          if (!active[v]) continue;
          const S = bank[sm[v]], sample = S.sample, right = S.right, norm = S.norm, sus = S.sus, last = sample.length - 1;
          const level = params[slots[LEVEL]] * S.globalVolume * S.volume;
          const pn = Math.max(-1, Math.min(1, S.pan + vpan[v]));
          const panL = Math.min(1, 1 - pn), panR = Math.min(1, 1 + pn);
          const baseRate = Math.pow(2, (note[v] - root) / 12) * S.ratio, slideBy = slideMul[v];
          let pm = pitchMul[v], gl = grainLeft[v], cs = attack, vm = volMul[v], vl = vsLeft[v];
          const vk = vsKind[v], vstep = vsStep[v];
          const atk = atkStep[v];
          let m = mode[v];
          const back = dir[v] < 0;
          const loop = back ? null : inSus[v] ? sus : norm.on ? norm : null;
          const ls = loop ? loop.start : 0, le = loop ? loop.end : 0, xf = loop ? loop.xf : 0;
          const span = le - ls;
          let p = pos[v], e = env[v];
          for (let i = skip[v]; i < n; i++) {
            if (i >= cutAt[v]) { m = mode[v] = CUTTING; cs = attack; }
            else if (gl <= 0 && m !== CUTTING) { m = mode[v] = CUTTING; cs = fadeStep[v]; }
            gl--;
            const rate = baseRate * pm;
            if (loop) {
              if (p >= le) p = ls + (p - ls) % span;
            } else if (back ? p <= 0 : p >= last) {
              active[v] = 0;
              break;
            }
            if (m === PLAYING) {
              if (e < 1) e = Math.min(1, e + atk);
            } else {
              e -= m === RELEASING ? relStep : m === FADING ? fadeStepNna : cs;
              if (e <= 0) { active[v] = 0; break; }
            }
            if (vl > 0) { vm = vk === 1 ? Math.max(0, vm + vstep) : vm * vstep; vl--; }
            const amp = e * gain[v] * level * vm;
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
            pm *= slideBy;
          }
          pos[v] = p; env[v] = e; skip[v] = 0; pitchMul[v] = pm; grainLeft[v] = gl; volMul[v] = vm; vsLeft[v] = vl;
        }
        cutAt.fill(Infinity);
      },
    };
  },
};
