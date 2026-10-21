import { samplerPreset } from './presets.js';

// The sampler's pattern format is fixed by these lists. Each exposed entry becomes
// a column that writes the named node parameter (2hex, or 4hex with bits: 16).
// The command table gives the CCXXYY column its meaning; the ids are free to change.
export const samplerExposed = [
  { node: 'sampler', param: 'sample', label: 'Smp' },             // which sample of the instrument's list: 00 the first
  { node: 'sampler', param: 'offset', label: 'Off', bits: 16 },   // where the note starts: 0000 start, FFFF end
  { node: 'sampler', param: 'retrig', label: 'Rtg', bits: 16 },   // ticks between repeats: 1000 is one tick, 0 off
  { node: 'filter', param: 'cutoff', label: 'Cut', scale: 'log' },
  { node: 'filter', param: 'resonance', label: 'Res' },
  { node: 'delay', param: 'mix', label: 'Mix' },
  { node: 'delay', param: 'time', label: 'Time', bits: 16 },
];

export const samplerCommands = [
  { id: 0x01, node: 'filter', param: 'cutoff', scale: 'log' },
  { id: 0x02, node: 'filter', param: 'resonance' },
  { id: 0x03, node: 'delay', param: 'time' },
  { id: 0x04, node: 'delay', param: 'feedback' },
  { id: 0x05, node: 'delay', param: 'mix' },
  { id: 0x06, node: 'sampler', param: 'nnaFade' },
  // Repeats (Off and Rtg are columns); each stays set until written again. 07 repeats: how many (a count;
  // 0 until the note ends). 08 shift: how far each repeat's start moves (8000 none, above goes forward, below
  // back). 09 ramp: each repeat's volume multiplier (C000 is x1, 8000 halves it). 0A reverse: 1 plays backwards,
  // the offset then counting from the end.
  { id: 0x07, node: 'sampler', param: 'repeats' },
  { id: 0x08, node: 'sampler', param: 'shift' },
  { id: 0x09, node: 'sampler', param: 'ramp' },
  { id: 0x0A, node: 'sampler', param: 'reverse' },
  // 10 slice: start at a slice marker of the sample (set on the Samples screen), 0000 the first, 0001 the second
  // and so on, sorted by position. It wins over the Off column while it points at a marker; FFFF puts Off back in charge.
  { id: 0x10, node: 'sampler', param: 'slice' },
  // Grains and texture (everything defaults to off). 0B grain: how long each sound lasts, 1000 is one tick; with it the
  // repeats overlap instead of cutting each other. 0C edge: how much of a grain is fade. 0D accel: each repeat's interval
  // is multiplied by this, 8000 is x1. 0E step: semitones each repeat is higher, 8000 none, 0800 one semitone. 0F slide: pitch
  // bend in semitones per tick while a sound plays. 11 flip: 1 plays every repeat the other way round. 12 prob: the chance a
  // repeat sounds, FFFF always. 13 to 17 jitter (random, up to the amount): offset, pitch, pan, timing, level.
  // Volume slides, as in UnwieldyTracker (XXYY: XX the time in subticks, six to a tick, 00 at once; YY the amount). 18 linear slide to level
  // YY/40 (40 is the sound's own level); 19 the same evenly in dB; 1A down by YY dB; 1B up by YY dB; 1C down and 1D up by YY/256 dB.
  // 90 to 93 are 1A to 1D with XX in tens of milliseconds. Written while a sound plays they slide it; before a note, every sound of the
  // note. 0000 turns them off.
  { id: 0x18, node: 'sampler', param: 'volLin' },
  { id: 0x19, node: 'sampler', param: 'volLog' },
  { id: 0x1A, node: 'sampler', param: 'volDown' },
  { id: 0x1B, node: 'sampler', param: 'volUp' },
  { id: 0x1C, node: 'sampler', param: 'volFineDown' },
  { id: 0x1D, node: 'sampler', param: 'volFineUp' },
  { id: 0x1E, node: 'sampler', param: 'subdivide' },   // subticks in a tick (default 6), for the time of the slides
  // FF absolute offset: the Off column then holds the low four hex digits of a frame number and the value of FF the number of full
  // 65536-frame blocks before it (the hh of hh:hhhh): Off 0300 with FF 0002 starts at frame 2:0300. It stays until F0 (any value)
  // puts Off back to a fraction of the sample.
  { id: 0xFF, node: 'sampler', param: 'blockCount' },
  { id: 0xF0, node: 'sampler', param: 'blockCount', fixed: 65535 },
  // Pitch, retrigger limits and timed cuts (the ideas of UnwieldyTracker's portamento, retrigger limit, cut and release commands).
  // 20 to 23 slide the pitch: XXYY, XX semitones (the fine ones XX/256) over YY subticks, like the volume slides. 24 portamento to the
  // note: a note that follows one still sounding in its column bends to the new pitch over XXY.Y subticks instead of restarting.
  // 25 and 26: the shortest (XX.YY) and longest (XXYY) subticks between repeats, 0000 no limit. 27: the nth interval is also multiplied
  // by n to the power (value - 8000) / 4000. 28 cut and 29 release every sound after XXX.Y ticks (0010 is one tick, 0018 one and a
  // half); 2A: each repeat multiplies those times by this, 8000 is x1.
  { id: 0x20, node: 'sampler', param: 'portDown' },
  { id: 0x21, node: 'sampler', param: 'portUp' },
  { id: 0x22, node: 'sampler', param: 'portFineDown' },
  { id: 0x23, node: 'sampler', param: 'portFineUp' },
  { id: 0x24, node: 'sampler', param: 'portTo' },
  { id: 0x25, node: 'sampler', param: 'retrigMin' },
  { id: 0x26, node: 'sampler', param: 'retrigMax' },
  { id: 0x27, node: 'sampler', param: 'retrigPow' },
  { id: 0x28, node: 'sampler', param: 'cutAfter' },
  { id: 0x29, node: 'sampler', param: 'releaseAfter' },
  { id: 0x2A, node: 'sampler', param: 'cutScale' },
  { id: 0x90, node: 'sampler', param: 'volDownMs' },
  { id: 0x91, node: 'sampler', param: 'volUpMs' },
  { id: 0x92, node: 'sampler', param: 'volFineDownMs' },
  { id: 0x93, node: 'sampler', param: 'volFineUpMs' },
  { id: 0x0B, node: 'sampler', param: 'grain' },
  { id: 0x0C, node: 'sampler', param: 'edge' },
  { id: 0x0D, node: 'sampler', param: 'accel' },
  { id: 0x0E, node: 'sampler', param: 'step' },
  { id: 0x0F, node: 'sampler', param: 'slide' },
  { id: 0x11, node: 'sampler', param: 'flip' },
  { id: 0x12, node: 'sampler', param: 'prob' },
  { id: 0x13, node: 'sampler', param: 'jOffset' },
  { id: 0x14, node: 'sampler', param: 'jPitch' },
  { id: 0x15, node: 'sampler', param: 'jPan' },
  { id: 0x16, node: 'sampler', param: 'jTime' },
  { id: 0x17, node: 'sampler', param: 'jLevel' },
];

export const withParams = (graph, overrides) => ({
  ...graph,
  nodes: graph.nodes.map(n => (overrides[n.id] ? { ...n, params: { ...n.params, ...overrides[n.id] } } : n)),
});

// A bass drum built from nodes: a pitch envelope sweeps a sine oscillator down, and an
// amplitude envelope shapes it. The oscillator restarts its phase on every note, so every
// hit starts the same way. Played from note C-2.
export const kickGraph = {
  nodes: [
    { id: 'pitchEnv', type: 'env', params: { attack: 0.2, decay: 70, sustain: 0, release: 50, amount: 2.5 } },
    { id: 'osc', type: 'osc', params: { wave: 0, reset: 1, phase: 0.25 } },
    { id: 'ampEnv', type: 'env', params: { attack: 0.5, decay: 300, sustain: 0, release: 40 } },
    { id: 'vca', type: 'gain' },
    { id: 'out', type: 'out', params: { gain: 0.35 } },
  ],
  connections: [
    ['pitchEnv.out', 'osc.fm'],
    ['osc.out', 'vca.in'],
    ['ampEnv.out', 'vca.cv'],
    ['vca.out', 'out.in'],
  ],
};

export const instruments = {
  // Output gain is lowered so two lanes together stay under full scale.
  lead: {
    graph: withParams(samplerPreset, { out: { gain: 0.45 } }),
    layout: 2,
    exposed: samplerExposed,
    commands: samplerCommands,
    samples: { sampler: 'pluck' },   // node id -> sample id
  },
  bass: {
    graph: withParams(samplerPreset, { filter: { cutoff: 500 }, delay: { mix: 0 }, out: { gain: 0.45 } }),
    layout: 2,
    exposed: samplerExposed,
    commands: samplerCommands,
    samples: { sampler: 'pluck' },
  },
  kick: {
    graph: kickGraph,
    exposed: [
      { node: 'pitchEnv', param: 'amount', label: 'Pit' },
      { node: 'ampEnv', param: 'decay', label: 'Dec', scale: 'log' },
    ],
  },
};

// A new sampler instrument playing the given sample, with the same fixed pattern columns
// as the demo's sampler instruments.
export const newSamplerInstrument = sampleId => structuredClone({
  graph: withParams(samplerPreset, { out: { gain: 0.45 } }),
  layout: 2,
  exposed: samplerExposed,
  commands: samplerCommands,
  samples: { sampler: sampleId },
});

// A comb-resonator percussion instrument: one note column, a few pattern columns for the sound.
const combPercKind = params => ({
  graph: { nodes: [{ id: 'perc', type: 'combperc', params }, { id: 'out', type: 'out', params: { gain: 0.5 } }], connections: [['perc.out', 'out.in']] },
  noteColumns: 1,
  exposed: [
    { node: 'perc', param: 'decay', label: 'Dec', scale: 'log' },
    { node: 'perc', param: 'sweep', label: 'Swp' },
    { node: 'perc', param: 'spread', label: 'Spr' },
    { node: 'perc', param: 'damp', label: 'Dmp' },
  ],
  commands: [
    { id: 0x01, node: 'perc', param: 'decay', scale: 'log' },
    { id: 0x02, node: 'perc', param: 'damp' },
    { id: 0x03, node: 'perc', param: 'spread' },
    { id: 0x04, node: 'perc', param: 'tune' },
    { id: 0x05, node: 'perc', param: 'sweep' },
    { id: 0x06, node: 'perc', param: 'sdec', scale: 'log' },
    { id: 0x07, node: 'perc', param: 'drive' },
    { id: 0x08, node: 'perc', param: 'click', scale: 'log' },
    { id: 0x09, node: 'perc', param: 'bright' },
    { id: 0x0a, node: 'perc', param: 'hollow' },
    { id: 0x0b, node: 'out', param: 'gain' },
  ],
});

// Synth instruments: one synth node into out, with a few parameters exposed as pattern columns.
export const synthKinds = {
  kick: {
    label: 'Kick synth',
    make: () => ({
      graph: withParams(structuredClone(kickGraph), { out: { gain: 0.42 } }),
      exposed: [
        { node: 'pitchEnv', param: 'amount', label: 'Pit' },
        { node: 'pitchEnv', param: 'decay', label: 'PDc', scale: 'log' },
        { node: 'ampEnv', param: 'decay', label: 'Dec', scale: 'log' },
        { node: 'osc', param: 'tune', label: 'Tun' },
      ],
      commands: [
        { id: 0x01, node: 'pitchEnv', param: 'amount' },
        { id: 0x02, node: 'pitchEnv', param: 'decay', scale: 'log' },
        { id: 0x03, node: 'ampEnv', param: 'decay', scale: 'log' },
        { id: 0x04, node: 'osc', param: 'tune' },
        { id: 0x05, node: 'out', param: 'gain' },
      ],
    }),
  },
  empty: {
    label: 'Empty graph (out and voices only)',
    make: () => ({
      graph: { nodes: [{ id: 'poly', type: 'voices', x: 200, y: 80 }, { id: 'out', type: 'out', x: 420, y: 80, params: { gain: 0.5 } }], connections: [] },
      noteColumns: 1,
      exposed: [],
      commands: [],
    }),
  },
  subtractive: {
    label: 'Subtractive synth',
    make: () => ({
      graph: { nodes: [{ id: 'synth', type: 'subsynth' }, { id: 'poly', type: 'voices' }, { id: 'out', type: 'out', params: { gain: 0.5 } }], connections: [['synth.out', 'poly.in'], ['poly.out', 'out.in']], voices: 6 },
      noteColumns: 3,
      exposed: [
        { node: 'synth', param: 'cutoff', label: 'Cut', scale: 'log' },
        { node: 'synth', param: 'res', label: 'Res' },
        { node: 'synth', param: 'fenv', label: 'Env' },
        { node: 'synth', param: 'detune', label: 'Det' },
      ],
      commands: [
        { id: 0x01, node: 'synth', param: 'cutoff', scale: 'log' },
        { id: 0x02, node: 'synth', param: 'res' },
        { id: 0x03, node: 'synth', param: 'fenv' },
        { id: 0x04, node: 'synth', param: 'drive' },
        { id: 0x05, node: 'synth', param: 'glide' },
      ],
    }),
  },
  oberheim: {
    label: 'Oberheim-style synth',
    make: () => ({
      graph: { nodes: [{ id: 'synth', type: 'oberheim' }, { id: 'poly', type: 'voices' }, { id: 'out', type: 'out', params: { gain: 0.5 } }], connections: [['synth.out', 'poly.in'], ['poly.out', 'out.in']], voices: 8 },
      noteColumns: 4,
      exposed: [
        { node: 'synth', param: 'cutoff', label: 'Cut', scale: 'log' },
        { node: 'synth', param: 'res', label: 'Res' },
        { node: 'synth', param: 'mode', label: 'Mod' },
        { node: 'synth', param: 'pw', label: 'PW' },
      ],
      commands: [
        { id: 0x01, node: 'synth', param: 'cutoff', scale: 'log' },
        { id: 0x02, node: 'synth', param: 'res' },
        { id: 0x03, node: 'synth', param: 'mode' },
        { id: 0x04, node: 'synth', param: 'fenv' },
        { id: 0x05, node: 'synth', param: 'pwm' },
        { id: 0x06, node: 'synth', param: 'sweep' },
        { id: 0x07, node: 'synth', param: 'detune' },
        { id: 0x08, node: 'synth', param: 'glide' },
      ],
    }),
  },
  piano: {
    label: 'Piano (physical model)',
    make: () => ({
      graph: { nodes: [{ id: 'synth', type: 'piano' }, { id: 'poly', type: 'voices' }, { id: 'out', type: 'out', params: { gain: 0.5 } }], connections: [['synth.out', 'poly.in'], ['poly.out', 'out.in']], voices: 12 },
      noteColumns: 6,   // six note and velocity lanes, with the voices to let them ring
      exposed: [
        { node: 'synth', param: 'pedal', label: 'Ped' },
        { node: 'synth', param: 'hard', label: 'Hrd' },
        { node: 'synth', param: 'decay', label: 'Dec' },
        { node: 'synth', param: 'body', label: 'Bod' },
      ],
      commands: [
        { id: 0x01, node: 'synth', param: 'pedal' },
        { id: 0x02, node: 'synth', param: 'hard' },
        { id: 0x03, node: 'synth', param: 'decay' },
        { id: 0x04, node: 'synth', param: 'body' },
        { id: 0x05, node: 'synth', param: 'bright' },
        { id: 0x06, node: 'synth', param: 'pos' },
        { id: 0x07, node: 'synth', param: 'inharm' },
        { id: 0x08, node: 'synth', param: 'prompt' },
      ],
    }),
  },
  squelch: {
    label: 'Squelch (303-style bassline)',
    make: () => ({
      graph: { nodes: [{ id: 'sq', type: 'squelch' }, { id: 'out', type: 'out', params: { gain: 0.5 } }], connections: [['sq.out', 'out.in']] },
      noteColumns: 1,
      // Acc and Sld count for the note on their row only; the other columns keep their value until written again
      exposed: [
        { node: 'sq', param: 'acc', label: 'Acc', bits: 4 },
        { node: 'sq', param: 'sld', label: 'Sld', bits: 4 },
        { node: 'sq', param: 'cutoff', label: 'Cut', scale: 'log' },
        { node: 'sq', param: 'res', label: 'Res' },
        { node: 'sq', param: 'envmod', label: 'Env' },
        { node: 'sq', param: 'decay', label: 'Dec', scale: 'log' },
        { node: 'sq', param: 'accent', label: 'Acl' },
        { node: 'sq', param: 'slide', label: 'SlT', scale: 'log' },
        { node: 'sq', param: 'wave', label: 'Wav', bits: 4 },
        { node: 'sq', param: 'drive', label: 'Drv' },
      ],
      commands: [
        { id: 0x01, node: 'sq', param: 'cutoff', scale: 'log' },
        { id: 0x02, node: 'sq', param: 'res' },
        { id: 0x03, node: 'sq', param: 'envmod' },
        { id: 0x04, node: 'sq', param: 'decay', scale: 'log' },
        { id: 0x05, node: 'sq', param: 'accent' },
        { id: 0x06, node: 'sq', param: 'slide', scale: 'log' },
        { id: 0x07, node: 'sq', param: 'wave' },
        { id: 0x08, node: 'sq', param: 'drive' },
        { id: 0x09, node: 'sq', param: 'tune' },
        { id: 0x0a, node: 'sq', param: 'rel', scale: 'log' },
        { id: 0x0b, node: 'sq', param: 'vel' },
        { id: 0x0c, node: 'sq', param: 'level' },
        { id: 0x0d, node: 'out', param: 'gain' },
      ],
    }),
  },
  combperc: {
    label: 'Comb resonator perc (metal hits)',
    make: () => combPercKind({ spread: 0.7, decay: 220, sweep: 0.4, sdec: 30, click: 1.5, drive: 0.25 }),
  },
  combtom: {
    label: 'Comb resonator tom (tuned, zapping)',
    make: () => combPercKind({ spread: 0.1, decay: 380, sweep: 2, sdec: 45, damp: 0.5, click: 3, bright: 0.45, drive: 0.15 }),
  },
  hat808: {
    label: '808 hi-hat (closed + open)',
    make: () => ({
      graph: { nodes: [{ id: 'hat', type: 'hat808' }, { id: 'out', type: 'out', params: { gain: 0.4 } }], connections: [['hat.out', 'out.in']] },
      noteColumns: 0,   // no notes: the Cl and Op columns trigger the closed and open hat
      triggers: [{ label: 'Cl', note: 0 }, { label: 'Op', note: 1 }],
      exposed: [
        { node: 'hat', param: 'cdec', label: 'CDc', scale: 'log' },
        { node: 'hat', param: 'odec', label: 'ODc', scale: 'log' },
        { node: 'hat', param: 'tone', label: 'Ton' },
        { node: 'hat', param: 'tune', label: 'Tun' },
      ],
      commands: [
        { id: 0x01, node: 'hat', param: 'tune' },
        { id: 0x02, node: 'hat', param: 'tone' },
        { id: 0x03, node: 'hat', param: 'snap' },
        { id: 0x04, node: 'hat', param: 'level' },
        { id: 0x05, node: 'hat', param: 'cdec', scale: 'log' },
        { id: 0x06, node: 'hat', param: 'odec', scale: 'log' },
        { id: 0x07, node: 'hat', param: 'clvl' },
        { id: 0x08, node: 'hat', param: 'olvl' },
        { id: 0x09, node: 'hat', param: 'choke' },
      ],
    }),
  },
  modchan: {
    label: 'MOD channel (ProTracker)',
    sampleNode: 'ch',   // gets the project's samples as its slots, in order: MOD sample 1 is the first
    make: () => ({
      graph: { nodes: [{ id: 'ch', type: 'modchan' }, { id: 'out', type: 'out', params: { gain: 0.5 } }], connections: [['ch.out', 'out.in']] },
      noteColumns: 1,
      noVel: true,   // volume is the sample's own, then the C and A effects
      exposed: [{ node: 'ch', param: 'smp', label: 'Smp' }],
      commands: [   // 01 writes the effect word of a MOD cell: 010C40 is effect C40
        { id: 0x01, node: 'ch', param: 'fx' },
        { id: 0x02, node: 'ch', param: 'level' },
        { id: 0x03, node: 'ch', param: 'pan' },
      ],
    }),
  },
  fm: {
    label: 'FM synth',
    make: () => ({
      graph: { nodes: [{ id: 'synth', type: 'fmsynth' }, { id: 'poly', type: 'voices' }, { id: 'out', type: 'out', params: { gain: 0.5 } }], connections: [['synth.out', 'poly.in'], ['poly.out', 'out.in']], voices: 10 },
      noteColumns: 5,   // five note and velocity lanes
      exposed: [
        { node: 'synth', param: 'algo', label: 'Alg' },
        { node: 'synth', param: 'index', label: 'Idx' },
        { node: 'synth', param: 'fb', label: 'Fb' },
        { node: 'synth', param: 'ratio2', label: 'Rt2' },
      ],
      commands: [
        { id: 0x01, node: 'synth', param: 'index' },
        { id: 0x02, node: 'synth', param: 'fb' },
        { id: 0x03, node: 'synth', param: 'algo' },
        { id: 0x04, node: 'synth', param: 'glide' },
        { id: 0x05, node: 'synth', param: 'level2' },
        { id: 0x06, node: 'synth', param: 'level3' },
        { id: 0x07, node: 'synth', param: 'level4' },
        { id: 0x08, node: 'synth', param: 'ratio2' },
        { id: 0x09, node: 'synth', param: 'ratio3' },
        { id: 0x0A, node: 'synth', param: 'ratio4' },
      ],
    }),
  },
  dvii: {
    label: 'DVIIloader (DX7 banks)',
    make: () => ({
      graph: { nodes: [{ id: 'synth', type: 'dvii' }, { id: 'poly', type: 'voices' }, { id: 'out', type: 'out', params: { gain: 0.5 } }], connections: [['synth.out', 'poly.in'], ['poly.out', 'out.in']], voices: 12 },
      noteColumns: 4,
      exposed: [
        { node: 'synth', param: 'voice', label: 'Voi' },
        { node: 'synth', param: 'lfo', label: 'Lfo' },
        { node: 'synth', param: 'speed', label: 'Spd' },
        { node: 'synth', param: 'tune', label: 'Tun' },
      ],
      commands: [
        { id: 0x01, node: 'synth', param: 'voice' },
        { id: 0x02, node: 'synth', param: 'lfo' },
        { id: 0x03, node: 'synth', param: 'speed' },
        { id: 0x04, node: 'synth', param: 'tune' },
        { id: 0x05, node: 'synth', param: 'vel' },
        { id: 0x06, node: 'synth', param: 'level' },
      ],
    }),
  },
  wavetable: {
    label: 'Wavetable synth',
    make: () => ({
      graph: { nodes: [{ id: 'synth', type: 'wavetable' }, { id: 'poly', type: 'voices' }, { id: 'out', type: 'out', params: { gain: 0.5 } }], connections: [['synth.out', 'poly.in'], ['poly.out', 'out.in']], voices: 6 },
      noteColumns: 3,
      exposed: [
        { node: 'synth', param: 'position', label: 'Pos' },
        { node: 'synth', param: 'mix', label: 'Mix' },
        { node: 'synth', param: 'pamt', label: 'PAm' },
        { node: 'synth', param: 'source', label: 'Src' },
      ],
      commands: [
        { id: 0x01, node: 'synth', param: 'position' },
        { id: 0x02, node: 'synth', param: 'mix' },
        { id: 0x03, node: 'synth', param: 'source' },
        { id: 0x04, node: 'synth', param: 'pamt' },
        { id: 0x05, node: 'synth', param: 'pdec' },
        { id: 0x06, node: 'synth', param: 'lfoDepth' },
        { id: 0x07, node: 'synth', param: 'lfoRate' },
        { id: 0x08, node: 'synth', param: 'snap' },
        { id: 0x09, node: 'synth', param: 'glide' },
      ],
    }),
  },
  granular: {
    label: 'Granular synth',
    needsSample: true,   // plays the project's samples: the first one is listed when it is added
    make: () => ({
      graph: { nodes: [{ id: 'synth', type: 'granular' }, { id: 'poly', type: 'voices' }, { id: 'out', type: 'out', params: { gain: 0.5 } }], connections: [['synth.out', 'poly.in'], ['poly.out', 'out.in']], voices: 4 },
      noteColumns: 2,
      exposed: [
        { node: 'synth', param: 'position', label: 'Pos' },
        { node: 'synth', param: 'size', label: 'Siz' },
        { node: 'synth', param: 'density', label: 'Den' },
        { node: 'synth', param: 'spray', label: 'Spr' },
        { node: 'synth', param: 'sample', label: 'Smp' },
      ],
      commands: [
        { id: 0x01, node: 'synth', param: 'position' },
        { id: 0x02, node: 'synth', param: 'size' },
        { id: 0x03, node: 'synth', param: 'density' },
        { id: 0x04, node: 'synth', param: 'spray' },
        { id: 0x05, node: 'synth', param: 'scan' },
        { id: 0x06, node: 'synth', param: 'pitchRand' },
        { id: 0x07, node: 'synth', param: 'reverse' },
        { id: 0x08, node: 'synth', param: 'spread' },
        { id: 0x09, node: 'synth', param: 'shape' },
        { id: 0x0A, node: 'synth', param: 'tune' },
      ],
    }),
  },
  spectral: {
    label: 'Spectral synth',
    needsSample: true,   // takes its timbre from the project's samples: the first one is listed when it is added
    make: () => ({
      graph: { nodes: [{ id: 'synth', type: 'specsynth' }, { id: 'poly', type: 'voices' }, { id: 'out', type: 'out', params: { gain: 0.5 } }], connections: [['synth.out', 'poly.in'], ['poly.out', 'out.in']], voices: 6 },
      noteColumns: 3,
      exposed: [
        { node: 'synth', param: 'position', label: 'Pos' },
        { node: 'synth', param: 'contrast', label: 'Con' },
        { node: 'synth', param: 'blur', label: 'Blr' },
        { node: 'synth', param: 'sample', label: 'Smp' },
      ],
      commands: [
        { id: 0x01, node: 'synth', param: 'position' },
        { id: 0x02, node: 'synth', param: 'scan' },
        { id: 0x03, node: 'synth', param: 'blur' },
        { id: 0x04, node: 'synth', param: 'contrast' },
        { id: 0x05, node: 'synth', param: 'partials' },
        { id: 0x06, node: 'synth', param: 'tilt' },
        { id: 0x07, node: 'synth', param: 'evenodd' },
        { id: 0x08, node: 'synth', param: 'stretch' },
        { id: 0x09, node: 'synth', param: 'tune' },
      ],
    }),
  },
  string: {
    label: 'Plucked string',
    make: () => ({
      graph: { nodes: [{ id: 'synth', type: 'string' }, { id: 'poly', type: 'voices' }, { id: 'out', type: 'out', params: { gain: 0.5 } }], connections: [['synth.out', 'poly.in'], ['poly.out', 'out.in']], voices: 6 },
      noteColumns: 3,
      exposed: [
        { node: 'synth', param: 'decay', label: 'Dec', scale: 'log' },
        { node: 'synth', param: 'damp', label: 'Dmp' },
        { node: 'synth', param: 'bright', label: 'Brt' },
        { node: 'synth', param: 'pos', label: 'Pos' },
      ],
      commands: [
        { id: 0x01, node: 'synth', param: 'decay', scale: 'log' },
        { id: 0x02, node: 'synth', param: 'damp' },
        { id: 0x03, node: 'synth', param: 'bright' },
        { id: 0x04, node: 'synth', param: 'pos' },
        { id: 0x05, node: 'synth', param: 'release' },
        { id: 0x06, node: 'synth', param: 'tune' },
      ],
    }),
  },
  additive: {
    label: 'Additive synth',
    make: () => ({
      graph: { nodes: [{ id: 'synth', type: 'addsynth' }, { id: 'poly', type: 'voices' }, { id: 'out', type: 'out', params: { gain: 0.5 } }], connections: [['synth.out', 'poly.in'], ['poly.out', 'out.in']], voices: 6 },
      noteColumns: 3,
      exposed: [
        { node: 'synth', param: 'tilt', label: 'Tlt' },
        { node: 'synth', param: 'evenodd', label: 'E/O' },
        { node: 'synth', param: 'stretch', label: 'Str' },
        { node: 'synth', param: 'hdecay', label: 'HDc' },
      ],
      commands: [
        { id: 0x01, node: 'synth', param: 'tilt' },
        { id: 0x02, node: 'synth', param: 'evenodd' },
        { node: 'synth', id: 0x03, param: 'stretch' },
        { id: 0x04, node: 'synth', param: 'hdecay' },
        { id: 0x05, node: 'synth', param: 'glide' },
      ],
    }),
  },
};

// The master lane: always the first lane, with the tempo, swing, ticks per beat and volume as pattern columns. Its
// instrument holds one `tempo` node whose parameters the sequencer reads (see Sequencer.tempo).
export const MASTER = 'master';
export const masterInstrument = song => ({
  graph: {
    nodes: [
      { id: 'm', type: 'tempo', x: 40, y: 40, params: { bpm: song.bpm, swing: Math.round((song.swing ?? 0.5) * 100), tpb: song.ticksPerBeat, volume: 1 } },
      { id: 'out', type: 'out', x: 240, y: 40 },
    ],
    connections: [],
  },
  noteColumns: 0,
  exposed: [
    { node: 'm', param: 'bpm', label: 'BPM', bits: 16 },
    { node: 'm', param: 'swing', label: 'Swg' },
    { node: 'm', param: 'tpb', label: 'TPB' },
    { node: 'm', param: 'volume', label: 'Vol' },
  ],
  commands: [],
});

// Makes sure a project ({ song, instruments }) has the master instrument and its lane, first in the lists, and that the
// instrument starts at the song's tempo and swing.
export function ensureMaster({ song, instruments }) {
  const fresh = masterInstrument(song), keep = instruments[MASTER];
  const rest = Object.entries(instruments).filter(([k]) => k !== MASTER);
  const master = keep ?? fresh;
  if (keep) Object.assign(keep.graph.nodes.find(n => n.id === 'm').params, fresh.graph.nodes[0].params);
  for (const k of Object.keys(instruments)) delete instruments[k];
  Object.assign(instruments, { [MASTER]: master }, Object.fromEntries(rest));
  const at = song.lanes.findIndex(l => l.id === MASTER);
  const lane = at >= 0 ? song.lanes.splice(at, 1)[0] : { id: MASTER, instrument: MASTER, patterns: {}, placements: [] };
  song.lanes.unshift(lane);
}
