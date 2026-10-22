// Plain-words descriptions of the pattern commands (the Cmd column: two hex digits for the command, four for its value),
// for the machine help panel. Keyed by the parameter a command writes; a command that holds a fixed value has a * after it.
// What a command is called and its range come from the instrument itself, so only the explanation lives here.
export const HELP = {
  // the instrument's own filter and delay (node.param, since other machines have those names too)
  'filter.cutoff': 'Cutoff of the instrument\'s filter, which every sound goes through.',
  'filter.resonance': 'Resonance of that filter: how much it rings around the cutoff.',
  'delay.time': 'Time between the echoes of the instrument\'s delay.',
  'delay.feedback': 'How much of the echo is fed back in: more means more echoes.',
  'delay.mix': 'How much of the delay is mixed in. 0 is dry.',
  // repeats
  repeats: 'How many times the note repeats (a count). 0 keeps repeating until the note ends.',
  shift: 'How far each repeat starts along the sample. 8000 stays put, above goes forward, below goes back.',
  ramp: 'Volume of each repeat compared with the one before. C000 keeps it, 8000 halves it every time.',
  reverse: '1 plays the sound backwards; the Off column then counts from the end of the sample.',
  slice: 'Start at a slice marker (set on the Samples screen): 0000 the first, 0001 the second, and so on. FFFF hands control back to the Off column.',
  grain: 'How long each sound lasts, 1000 is one tick. With a grain set, repeats overlap instead of cutting each other.',
  edge: 'How much of each grain is fade in and fade out.',
  accel: 'Each repeat\'s interval is multiplied by this: 8000 keeps the pace, less speeds up, more slows down.',
  step: 'Semitones each repeat sounds higher. 8000 none, 0800 one semitone.',
  slide: 'Pitch bend while a sound plays, in semitones per tick.',
  flip: '1 plays every repeat the other way round.',
  prob: 'Chance that a repeat sounds at all. FFFF always.',
  jOffset: 'Random jitter, up to this amount, on where each repeat starts in the sample.',
  jPitch: 'Random jitter, up to this amount, on the pitch of each repeat.',
  jPan: 'Random jitter, up to this amount, on the pan of each repeat.',
  jTime: 'Random jitter, up to this amount, on the timing of each repeat.',
  jLevel: 'Random jitter, up to this amount, on the level of each repeat.',
  jCutoff: 'Random jitter on the filter cutoff, up to XX.YY semitones either way.',
  jTimeSub: 'Each repeat comes late by up to XX.YY subticks.',
  // volume slides: XXYY, XX the time, YY the amount; 0000 turns them off
  volLin: 'Slide the volume in a straight line to YY/40 of the sound\'s own level (40 is full). XX is the time in subticks (six to a tick), 00 at once.',
  volLog: 'Slide the volume to level YY/40, evenly in dB. XX is the time in subticks.',
  volDown: 'Slide the volume down by YY dB over XX subticks.',
  volUp: 'Slide the volume up by YY dB over XX subticks.',
  volFineDown: 'Slide the volume down by YY/256 dB over XX subticks.',
  volFineUp: 'Slide the volume up by YY/256 dB over XX subticks.',
  volDownMs: 'Like 1A, with XX counted in tens of milliseconds.',
  volUpMs: 'Like 1B, with XX counted in tens of milliseconds.',
  volFineDownMs: 'Like 1C, with XX counted in tens of milliseconds.',
  volFineUpMs: 'Like 1D, with XX counted in tens of milliseconds.',
  subdivide: 'Subticks in a tick (6 unless you change it): the unit the slides count their time in.',
  blockCount: 'Absolute offset: the Off column holds the low four hex digits of a frame number, this the number of 65536-frame blocks before it. Off 0300 with this at 0002 starts at frame 2:0300.',
  'blockCount*': 'Back to Off meaning a fraction of the sample.',
  // pitch and timing
  portDown: 'Slide the pitch down: XX semitones over YY subticks.',
  portUp: 'Slide the pitch up: XX semitones over YY subticks.',
  portFineDown: 'Slide the pitch down: XX/256 semitones over YY subticks.',
  portFineUp: 'Slide the pitch up: XX/256 semitones over YY subticks.',
  portTo: 'Portamento: a note that follows one still sounding in its column bends to the new pitch over XXY.Y subticks instead of restarting.',
  retrigMin: 'The shortest time between repeats, XX.YY subticks. 0000 no limit.',
  retrigMax: 'The longest time between repeats, XXYY subticks. 0000 no limit.',
  retrigPow: 'The nth interval is also multiplied by n to the power (value minus 8000) / 4000.',
  cutAfter: 'Cut every sound after XXX.Y ticks (0010 is one tick, 0018 one and a half).',
  releaseAfter: 'Let every sound go (start its release) after XXX.Y ticks.',
  cutScale: 'Each repeat multiplies the cut and release times by this. 8000 keeps them.',
  stretchSub: 'Stretch the whole sample over (value minus 8000) subticks.',
  stretchTicks: 'Stretch the whole sample over (value minus 8000) ticks.',
  stretchKeep: 'Ticks the stretched length holds when the repeat time changes.',
  // a filter on each sound
  filterType: 'A filter on each sound: 0 off, 1 low pass, 2 high pass, 3 and 4 band pass, 5 notch.',
  filterCutoff: 'Cutoff of that filter.',
  filterRes: 'Resonance of that filter.',
  cutDown: 'Slide the cutoff down: XX semitones over YY subticks.',
  cutUp: 'Slide the cutoff up: XX semitones over YY subticks.',
  cutStep: 'Semitones each repeat moves the cutoff. 8000 none.',
  // vibrato and the cutoff LFO
  vibSpeed: 'Vibrato speed.', vibDepth: 'Vibrato depth.', vibWave: 'Vibrato wave: 0 sine, 1 triangle, 2 square, 3 saw.',
  lfoSpeed: 'Cutoff LFO speed.', lfoDepth: 'Cutoff LFO depth.', lfoWave: 'Cutoff LFO wave: 0 sine, 1 triangle, 2 square, 3 saw.',
  vibSync: 'Set the vibrato\'s phase right now.',
  vibPhase: 'Every note starts the vibrato at this phase (XXYY of a turn). FFFF lets it run free.',
  lfoSync: 'Set the cutoff LFO\'s phase right now.',
  lfoPhase: 'Every note starts the cutoff LFO at this phase (XXYY of a turn). FFFF lets it run free.',
  // jumps in the sounds already playing
  jumpAhead: 'Jump forward in the sounds that are playing, by XXYY subticks of the sample\'s own time.',
  jumpBack: 'Jump back in the sounds that are playing, by XXYY subticks of the sample\'s own time.',
  jumpAheadRel: 'Jump forward by XXYY subticks at the speed the sound is playing.',
  jumpBackRel: 'Jump back by XXYY subticks at the speed the sound is playing.',
  jumpTicksAhead: 'Jump forward by XXYY ticks of the sample\'s own time.',
  jumpTicksBack: 'Jump back by XXYY ticks of the sample\'s own time.',
  jumpTicksAheadRel: 'Jump forward by XXYY ticks at the speed the sound is playing.',
  jumpTicksBackRel: 'Jump back by XXYY ticks at the speed the sound is playing.',
  nnaFade: 'How long an old note takes to fade out when a new one starts in its column. 0 cuts it at once.',
};

// The commands that are not parameters: the reset family, saving and loading the settings.
export const SPECIAL = {
  reset: 'Reset settings back to what the instrument starts with. Add up what to reset: 1 the retrigger settings, 2 humanization, 4 the filter, 8 vibrato and LFO. A0 and AF reset all of them; the digit after A is the sum.',
  save: 'Save settings into a slot of this lane. XX: which settings, added up as for the resets, YY: slot 00 to 0F.',
  load: 'Load the settings saved in a slot (XX: which settings, YY: slot 00 to 0F).',
};

// The rows of the command list for a lane's Cmd column: { id, hex, name, range?, help }, sorted by command number. The A0 to AF
// resets share one row.
export function commandRows(cmdCol, rangeOf) {
  if (!cmdCol) return [];
  const rows = [];
  let resets = 0;
  for (const c of cmdCol.commands) {
    if (c.reset) {
      if (!resets++) rows.push({ id: c.id, hex: 'A0–AF', name: 'Reset settings', help: SPECIAL.reset, covers: id => id >= 0xA0 && id <= 0xAF });
      continue;
    }
    const hex = c.id.toString(16).toUpperCase().padStart(2, '0');
    if (c.setting) { rows.push({ id: c.id, hex, name: `${c.setting === 'save' ? 'Save' : 'Load'} settings`, help: SPECIAL[c.setting] }); continue; }
    rows.push({ id: c.id, hex, name: c.name, range: rangeOf(c), help: HELP[`${c.node}.${c.param}`] ?? HELP[`${c.param}${Number.isFinite(c.fixed) ? '*' : ''}`] ?? '' });
  }
  if (cmdCol.presets?.length) rows.push({ id: 0, hex: '00', name: 'Recall preset', help: `The value is the preset number (${cmdCol.presets.length} saved for this instrument).` });
  return rows.sort((a, b) => a.id - b.id);
}
