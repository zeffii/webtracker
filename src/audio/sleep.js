// Machine sleep: a machine that has gone quiet stops costing anything until something could make it sound again.
//
// A machine that runs with no voices still computes its whole effect chain every block (filters, delays, reverbs), even
// when nothing has gone into it for minutes. Here, once a machine has no sounding voice and its output has stayed below
// SILENT (about −90 dB) for long enough, it is put to sleep: the runtime skips it, its buffers hold silence, and all its
// state is kept exactly as it was (filter memories, delay lines, envelopes, phases), so waking costs nothing at all.
//
// "Long enough" is HOLD_S seconds, or longer when the machine has a delay-like setting with a longer time (a 3 s delay can
// be silent between its echoes while one is still in the line).
//
// It wakes, at the start of a block, on: a note or a node message for it (runtime.js note / message), a change to any of its
// parameters or a pattern writing one of them (even the same value), or the machine its sidechain listens to sounding.
//
// Some machines never sleep, because they can start sounding with none of the above: a code machine (genexpr) or a modular
// (glsl, oscout, modchan ...) that may run on its own, or a machine set to `sleep: never`. A free-running modulator (lfo, ctrl) keeps a machine awake
// unless its sound is shaped by notes (an envelope, a note trigger or a synth that plays only while a note sounds): then the
// modulator can only change a sound that a note has to start, and a quiet machine stays quiet. (A drone whose level an LFO
// swells in and out, with nothing note-gated in the machine, never sleeps; anything else odd can be kept awake with its Sleep switch.)

export const SILENT = 3e-5;      // about −90 dB
export const HOLD_S = 2;         // the shortest silence before a machine sleeps
const MARGIN_S = 0.5;            // added to the longest delay time found
const NEVER = new Set(['genexpr', 'glsl', 'tempo', 'nsgroups', 'oscout', 'modchan']);
export const FREE = new Set(['lfo', 'ctrl']);   // modulators that run with no note: they keep running while the machine sleeps (they cost next to nothing), so a sweep or a synced LFO is where it should be when it wakes
const GATED = new Set(['env', 'env2', 'notetrig', 'sampler', 'drumsynth', 'drumsynth2', 'clap', 'membrane', 'clang', 'subsynth', 'pulsar', 'pulsetrain', 'westcoast', 'pluckgate', 'fourpole', 'oberheim', 'cardinal', 'piano', 'fmsynth', 'dvii',
  'wavetable', 'granular', 'woodblock', 'jawharp', 'snarl', 'string', 'hat808', 'hat2', 'bongo', 'combperc', 'squelch', 'duette', 'compass', 'waveseq']);   // sound only while a note does
const TIME_PARAM = /^(time|length|delay|predelay|maxdelay|mindelay|ringtime)$/;   // in ms, on the effect node types that have them

// What the runtime keeps per machine for sleeping, made when the machine is loaded. Returns null for a machine that never sleeps.
//   compiled: the compiled graph (runtime.load); nodeTypes: NODE_TYPES
export function sleepState(compiled, nodeTypes) {
  if (compiled.sleep === false) return null;
  if (compiled.nodes.some(n => NEVER.has(n.type))) return null;
  if (compiled.nodes.some(n => FREE.has(n.type)) && !compiled.nodes.some(n => GATED.has(n.type))) return null;
  const slots = new Set();
  const times = [];   // the slots holding a delay time, in ms
  for (const n of compiled.nodes) {
    const params = nodeTypes[n.type]?.params ?? [];
    n.slots.forEach((slot, i) => {
      if (slot === undefined || slot < 0) return;
      slots.add(slot);
      if (TIME_PARAM.test(params[i]?.name ?? '') && (params[i]?.unit ?? 'ms') === 'ms') times.push(slot);
    });
  }
  if (compiled.amp !== undefined) slots.add(compiled.amp);
  if (compiled.send !== undefined) slots.add(compiled.send);
  const watched = Int32Array.from(slots);
  return {
    asleep: false,
    quiet: 0,                                 // samples of silence so far
    watched,                                  // the parameter slots that wake it
    values: new Float32Array(watched.length), // their values when it fell asleep
    stamps: new Uint32Array(watched.length),  // and how often a pattern had written them
    times: Int32Array.from(times),
    sources: compiled.nodes.filter(n => n.type === 'sidechain' && n.source).map(n => n.source),
    woken: false,                             // a note or message came in since the last block
  };
}

// The silence a machine needs before it sleeps, in samples: HOLD_S, or its longest delay time plus a margin.
export function holdSamples(z, params, sampleRate) {
  let longest = 0;
  for (const slot of z.times) longest = Math.max(longest, params[slot] || 0);
  return Math.round(Math.max(HOLD_S, longest / 1000 + MARGIN_S) * sampleRate);
}

// Goes to sleep: remembers the parameters as they are now.
export function fallAsleep(z, params, stamps) {
  for (let i = 0; i < z.watched.length; i++) { z.values[i] = params[z.watched[i]]; z.stamps[i] = stamps[z.watched[i]]; }
  z.asleep = true;
  z.woken = false;
}

// Whether a sleeping machine has a reason to wake this block. peakOf(id): the last peak of another machine, or 0.
export function shouldWake(z, params, stamps, peakOf) {
  if (z.woken) return true;
  for (let i = 0; i < z.watched.length; i++) {
    const s = z.watched[i];
    if (params[s] !== z.values[i] || stamps[s] !== z.stamps[i]) return true;
  }
  for (const id of z.sources) if (peakOf(id) >= SILENT) return true;
  return false;
}
