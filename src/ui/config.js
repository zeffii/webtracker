// User settings: one small object kept in this browser (localStorage 'webtracker.config'), shown on the Config
// tab, and exportable / importable as JSON. Everything that reads a setting goes through get(), and anything
// that should react to a change subscribes with onChange(), so the panel, the keyboard shortcuts and the
// toolbar buttons all stay in step.
import { DEFAULT_RULES } from './console.js';
const KEY = 'webtracker.config';
export const THEMES = ['system', 'dark', 'black', 'bright', 'neon', 'amber', 'phosphor', 'ice', 'synthwave'];

// What each group is for, shown beside its card on the Config tab.
export const GROUPS = {
  Look: 'Colours and sizes. Applied at once.',
  Playing: 'How the screens behave while the song runs.',
  Graph: 'The graph view: wire colours (hover a wire to see its kind in the status line), grid and dragging.',
  Editing: 'Solo-edit, cursor keys, time sliders and inserting silence.',
  Sample: 'Auto-slice and slice markers in the sample display.',
  Resynthesis: 'Post-transient resynthesis (right click in the sample display): the attack stays a real sample and the rest is rebuilt from synth branches.',
  Console: 'Press | in the pattern editor or the arrangement for a one-line command box. Each rule says what you type and what it does; a rule that is wrong, or that could match the same typing as another, is switched off until you fix it.',
  MIDI: 'A MIDI keyboard plays the machine under the cursor, enters notes in the pattern editor and records into patterns while the song plays (Rec, Ctrl+Shift+R). Chrome and Edge only.',
  Backup: 'Automatic copies of the project kept in this browser, and optional backup files.',
  Export: 'Rendering the song to a sound file.',
  Arrangement: 'The small pictures of each pattern in the arrangement.',
  Visual: 'A small live picture driven by what the lanes play (Ctrl+Alt+V, or the button in the status bar). It is 300 x 300, the size of a video frame. The picture is a GLSL fragment shader; see the notes in the box below.',
  Meters: 'The meter band along the bottom of the window (Ctrl+Alt+M). Choose the panels here.',
  Script: 'Limits for the Script tab.',
  'De-normal diagnostics': 'Switches for tracking down clicks and crackle at very quiet levels. Both are off unless you need them.',
};

// Settings that sit in a different card from the one the list below puts them in, by key.
const MOVED = { splashStyle: 'Look', wireStraight: 'Graph', graphPullOut: 'Graph', vscopeLinger: 'Meters', vscopeGlow: 'Meters', midiLatency: 'MIDI', ptrMax: 'Resynthesis', ptrTolerance: 'Resynthesis', ptrTransient: 'Resynthesis' };


// type: bool | int | choice | colour (a #rrggbb string) | rules. `legacy` is the older single-purpose localStorage key, read once to carry settings over.
export const SCHEMA = [
  { group: 'Look', key: 'theme', label: 'Colour theme', type: 'choice', options: THEMES, def: 'system', legacy: ['webtracker.theme', v => v] },
  { key: 'splash', label: 'First screen', hint: 'only a "click to initialize" button at first, then the tracker (off: the tracker with its Start button)', type: 'bool', def: true },
  { key: 'patternTint', label: 'Tint patterns by colour', hint: 'a faint patchwork behind each pattern in the pattern editor (Alt+T)', type: 'bool', def: false },
  { key: 'fontSize', label: 'Pattern editor font size', type: 'int', min: 8, max: 40, def: 13, legacy: ['patternFontSize', v => Number(v)] },
  { group: 'Playing', key: 'follow', label: 'Follow mode', hint: 'the grids scroll with the playing row', type: 'bool', def: true, legacy: ['webtracker.follow', v => v === '1'] },
  { key: 'splashStyle', label: 'First screen look', hint: 'a drifting translucent blob (needs WebGL), or the turning wireframe logo', type: 'choice', options: ['blob', 'logo'], labels: { blob: 'a slow translucent blob', logo: 'the turning logo' }, def: 'blob' },
  { key: 'followRoam', label: 'Allow the caret to roam while following', hint: 'moving the caret to another row pauses the following until F9 or the Follow button', type: 'bool', def: true },
  { key: 'playhead', label: 'Playhead', type: 'choice', options: ['marker', 'line', 'band'], labels: { marker: 'a > in the tick column and a bold row', line: 'a thin red line across the grid', band: 'a faint band across the row' }, def: 'band' },
  { key: 'tapSlots', label: 'Show the empty tap slots in sample lists', hint: 'tap01 to tap16 in the sampler pickers even before a take is in them (a slot with a take, or one an instrument plays, always shows)', type: 'bool', def: false },
  { key: 'notePreview', label: 'Note preview', hint: 'typed notes sound in the pattern editor', type: 'bool', def: true },
  { group: 'Graph', key: 'wireAudio', label: 'Wire colour: audio', hint: 'a mono audio signal', type: 'colour', def: '#5e94c9' },
  { key: 'wireControl', label: 'Wire colour: control', hint: 'envelopes, lfos and triggers', type: 'colour', def: '#e09429' },
  { key: 'wireStereo', label: 'Wire colour: stereo', hint: 'a left and right pair on one wire', type: 'colour', def: '#b177c5' },
  { key: 'wireParam', label: 'Wire colour: parameter', hint: 'a control signal that drives a parameter port', type: 'colour', def: '#f4857b' },
  { key: 'wireDashed', label: 'Control wires are dashed', hint: 'control and parameter wires are drawn dashed, so they read apart from audio at a glance (colour alone is the other way)', type: 'bool', def: true },
  { group: 'Editing', key: 'wireStraight', label: 'Graph: wires between close nodes go straight', hint: 'below this distance (in pixels) the wire loses its S-curve and becomes a straight line, easing in up to twice that; 0 keeps every wire curved', type: 'int', min: 0, max: 400, def: 60 },
  { group: 'Graph', key: 'pvHideCc', label: 'Parameter view: hide command parameters', hint: 'leaves out the parameters that a CC command writes from a pattern (the sampler\'s repeat, filter, vibrato and so on); the cc button in the panel title does the same', type: 'bool', def: false },
  { group: 'Graph', key: 'graphGrid', label: 'Graph: faint grid of dots', hint: 'a very faint dot grid behind the nodes, a brighter dot every few', type: 'bool', def: true },
  { key: 'graphGridSize', label: 'Graph: grid spacing', hint: 'pixels between dots', type: 'int', min: 8, max: 96, def: 24 },
  { key: 'graphGridMajor', label: 'Graph: brighter dot every', hint: 'dots; 0 for none', type: 'int', min: 0, max: 64, def: 12 },
  { key: 'graphSnap', label: 'Graph: nodes snap to the grid', hint: 'moving a node lands it on a dot; hold Ctrl while dragging to move freely', type: 'bool', def: true },
  { group: 'Editing', key: 'graphPullOut', label: 'Graph: dragging a node far out of its chain takes it out', hint: 'the dashed line; off keeps every wire when you move a node (Esc during a drag does the same once)', type: 'bool', def: false },
  { group: 'Editing', key: 'laneWrap', label: 'Left and Right wrap round the ends', hint: 'off: the caret stops at the first and last column; on: Left on the first column goes to the last lane\'s last column, and Right on that one goes back to the start', type: 'bool', def: false },
  { group: 'Sample', key: 'sliceSensitivity', label: 'Auto-slice: sensitivity (%)', hint: 'Shift+E marks a slice at each hit: higher finds smaller or softer hits', type: 'int', min: 0, max: 100, def: 50 },
  { key: 'sliceReplace', label: 'Auto-slice: replace the markers in range', hint: 'on: the slice markers inside the range being sliced (the selection, or the whole sample) are replaced by the new ones; off: they stay and the new ones are added', type: 'bool', def: true },
  { key: 'waveHideLoop', label: 'Waveform: hide the loop region', hint: 'the hide switch at the end of the Loop line on the sample screen', type: 'bool', def: false },
  { key: 'waveHideSel', label: 'Waveform: hide the selection', hint: 'the hide switch at the end of the Select line on the sample screen; the edit tools still act on the selection', type: 'bool', def: false },
  { key: 'waveHideSus', label: 'Waveform: hide the sustain loop region', hint: 'the hide switch at the end of the SusLoop line on the sample screen', type: 'bool', def: false },
  { key: 'sliceMinGap', label: 'Auto-slice: shortest gap (ms)', hint: 'no two markers closer than this', type: 'int', min: 5, max: 500, def: 30 },
  { group: 'Sample', key: 'hexMode', label: 'Slice markers: hex value', hint: 'relative is where the marker sits from 0000 to FFFF across the whole sample (what an Off cell holds); absolute is the frame number, as hh:hhhh when the sample is longer than 65536 frames (hh counts the full 0000 to FFFF blocks passed)', type: 'choice', options: ['both', 'relative', 'absolute'], labels: { both: 'both, relative first', relative: 'relative', absolute: 'absolute' }, def: 'both' },
  { group: 'Editing', key: 'seqWrap', label: 'Arrangement: Left and Right wrap round the ends', hint: 'off: the cursor stops at the first and last lane; on: Right on the last lane goes to the first (the Wrap button in the arrangement view does the same)', type: 'bool', def: false },
  { group: 'Editing', key: 'seqMasterNarrow', label: 'Arrangement: the master lane is half as wide', hint: 'on: the master lane (it has no notes) takes half the width of the other lanes; off: the same width', type: 'bool', def: true },
  { group: 'Editing', key: 'seqNames', label: 'Sequence editor: show pattern names', hint: 'off: the cells show only the two-digit pattern number (H toggles); the statusbar still gives the name and how many times the pattern is placed in the lane', type: 'bool', def: true },
  { group: 'Editing', key: 'viewFit', label: 'Pattern editor fills the window height', hint: 'the rows shown follow the room that is left; off: the drag bar under the grid sets the number of rows', type: 'bool', def: true },
  { group: 'Editing', key: 'seqFit', label: 'Arrangement fills the window height', hint: 'the rows shown follow the room that is left; off: the drag bar under the arrangement sets the number of rows', type: 'bool', def: true },
  { group: 'Editing', key: 'nuggetStep', label: 'Nugget mode: rows to move', hint: 'in nugget mode (after Ctrl+Left/Right) Up and Down move this many rows and stay on the same character', type: 'int', min: 1, max: 64, def: 1 },
  { group: 'Editing', key: 'arrowStyle', label: 'Left and Right move by', hint: 'Ctrl+Left/Right always move one character inside the cell', type: 'choice', options: ['cell', 'char'], labels: { cell: 'whole cells: to the start of the next column', char: 'one character at a time (a held key jumps by column)' }, def: 'cell' },
  { group: 'Editing', key: 'soloStyle', label: 'Solo-edit shows', type: 'choice', options: ['window', 'hatch'], labels: { window: 'the pattern on its own', hatch: 'the song, the rest hatched and locked' }, def: 'window', legacy: ['patternSoloStyle', v => (v === 'hatch' ? 'hatch' : 'window')] },
  { key: 'tickLines', label: 'Time sliders: tick lines', hint: 'faint light-blue lines where song ticks fall on time and rate parameters, and the value in ticks', type: 'bool', def: true },
  { key: 'tickSnap', label: 'Time sliders: snap to tick lines', hint: 'a mouse drag lands on a line when it is close; hold Alt to drag freely', type: 'bool', def: true },
  { key: 'followLane', label: 'Instrument editor follows the cursor', hint: 'moving into another lane shows that lane\'s machine', type: 'bool', def: true },
  { key: 'insertLength', label: 'Insert silence: default length', hint: 'in ticks', type: 'int', min: 1, max: 65536, def: 128 },
  { key: 'insertCut', label: 'Insert silence: cut patterns across the cursor', hint: 'off: a pattern crossing the cursor row stays whole', type: 'bool', def: false },
  { group: 'Sample', key: 'chordSplit', label: 'Detect chords: cut the recording', hint: 'at every onset (a new chord or note), or into steps of whole beats at the recording\'s tempo', type: 'choice', options: ['onsets', '1', '2', '4'], labels: { onsets: 'at every onset', 1: 'every beat', 2: 'every 2 beats', 4: 'every bar (4 beats)' }, def: 'onsets' },
  { key: 'chordMaxNotes', label: 'Detect chords: most notes in a chord', type: 'int', min: 1, max: 8, def: 5 },
  { key: 'chordThreshold', label: 'Detect chords: weakest note kept (%)', hint: 'a note must be at least this strong next to the strongest of its chord: lower finds more notes, and more wrong ones', type: 'int', min: 5, max: 90, def: 35 },
  { key: 'chordBpm', label: 'Detect chords: tempo of the recording', hint: 'sets where the chords land in the pattern; 0 is the song\'s tempo', type: 'int', min: 0, max: 400, def: 0 },
  { group: 'OSC', key: 'oscPort', label: 'OSC relay port', hint: 'where an OSC out machine sends: run node tools/osc-relay.mjs (it passes the messages on as UDP, to Renoise for one)', type: 'int', min: 1024, max: 65535, def: 8765 },
  { group: 'MIDI', key: 'midiOn', label: 'Use MIDI input', hint: 'the browser asks for permission when this is switched on', type: 'bool', def: false },
  { key: 'midiChannel', label: 'MIDI channel', hint: '0 listens to every channel', type: 'int', min: 0, max: 16, def: 0 },
  { key: 'midiVelocity', label: 'Velocity sensitive', hint: 'on: the key velocity is played and written to the vl column (Alt+V). off: every note at the default volume, nothing written', type: 'bool', def: false },
  { key: 'midiChord', label: 'A chord is', type: 'choice', options: ['window', 'held'], labels: { window: 'notes struck within the chord window', held: 'notes struck while another is still held' }, def: 'window' },
  { key: 'midiOrder', label: 'A chord goes into the columns', type: 'choice', options: ['pitch', 'played'], labels: { pitch: 'lowest note first', played: 'in the order the keys were struck' }, def: 'pitch' },
  { key: 'midiWindow', label: 'Chord window', hint: 'in ms', type: 'int', min: 5, max: 500, def: 60 },
  { key: 'midiAdvance', label: 'After entering notes', type: 'choice', options: ['stay', 'row'], labels: { stay: 'the cursor stays', row: 'the cursor moves down one row (when the keys are let go)' }, def: 'stay' },
  { key: 'midiOffs', label: 'Recording: release writes a note off', hint: 'the key release; off for pads and drums', type: 'bool', def: true },
  { key: 'midiParamStep', label: 'Recording sliders: write every Nth row', hint: '1 writes every tick a slider moves in; 2 or 4 leave room to edit afterwards', type: 'int', min: 1, max: 16, def: 1 },
  { key: 'midiShared', label: 'Shared patterns', hint: 'a pattern placed more than once, written by MIDI or a script', type: 'choice', options: ['ask', 'write'], labels: { ask: 'refuse: clone it first (G)', write: 'write into it, so every placement changes' }, def: 'ask' },
  { group: 'Backup', key: 'backupOn', label: 'Automatic backups', hint: 'snapshots of the project kept in this browser; open them with the Backups button', type: 'bool', def: true },
  { key: 'backupMinutes', label: 'Back up every (minutes)', hint: 'only when the project has changed', type: 'int', min: 1, max: 60, def: 3 },
  { key: 'backupKeep', label: 'Snapshots kept', hint: 'the oldest are dropped', type: 'int', min: 5, max: 200, def: 30 },
  { key: 'backupDownload', label: 'Download a backup file', hint: 'every few minutes when the project has changed; point the browser\'s download folder at a git folder to keep them (for browsers that cannot write to a folder)', type: 'bool', def: false },
  { key: 'backupDownloadMinutes', label: 'Download every (minutes)', type: 'int', min: 1, max: 240, def: 15 },
  { key: 'backupFolderMode', label: 'Backup folder files', type: 'choice', options: ['latest', 'stamped'], labels: { latest: 'one file per project, overwritten (a git folder keeps the history)', stamped: 'a new file each time' }, def: 'latest' },
  { group: 'Export', key: 'exportTail', label: 'Export: tail (seconds)', hint: 'rendered after the last row, so reverbs and delays can die out', type: 'int', min: 0, max: 120, def: 15 },
  { key: 'exportFormat', label: 'Export: file type', hint: 'WAV, or an MP4 with the album art below as its picture and the song as stereo AAC (AAC comes from the browser, or from a built-in encoder when it has none; VP9 picture when the browser has no H.264)', type: 'choice', options: ['wav', 'mp4'], labels: { wav: 'WAV (sound only)', mp4: 'MP4 (album art and sound)' }, def: 'wav' },
  { key: 'exportArt', label: 'Export: album art', hint: 'any picture; it is cropped to a square and scaled to 300 x 300. With none, the card shows the project name', type: 'image', def: '' },
  { key: 'exportBits', label: 'Export: WAV format', type: 'choice', options: ['16', '24', '32'], labels: { 16: '16-bit', 24: '24-bit', 32: '32-bit float (cannot clip)' }, def: '24' },
  { group: 'Arrangement', key: 'minimapOn', label: 'Pattern minimaps', hint: 'each cell of the arrangement shows a small picture of its pattern: notes as ticks across by pitch, parameters as grey cells at the right edge', type: 'bool', def: false },
  { key: 'minimapLengths', label: 'Minimaps: note lengths', hint: 'a thin line from each note to the next note, note off or note cut', type: 'bool', def: true },
  { key: 'minimapCaps', label: 'Minimaps: note off and note cut', hint: 'cyan for ===, magenta for ^^^', type: 'bool', def: true },
  { key: 'minimapParams', label: 'Minimaps: parameters', hint: 'one narrow column each at the right edge, darker the higher the value', type: 'bool', def: true },
  { group: 'Visual', key: 'visualOn', label: 'Live picture', hint: 'a 300 x 300 picture in the corner (Ctrl+Alt+V, or the button in the status bar)', type: 'bool', def: false },
  { key: 'visualSkeleton', label: 'Picture: pattern skeleton', hint: 'draws every lane\'s pattern around the playhead as thin rows of ticks over the picture (pitch is height, velocity is strength), scrolling past a fixed line', type: 'bool', def: true },
  { key: 'shaderSliders', label: 'Shader view: number sliders', hint: 'numbers in the shader are drawn on a faint chip (orange for floats, green for ints); click one, or drag it sideways, for a slider that writes into the text', type: 'bool', def: true },
  { key: 'shaderKnobs', label: 'Shader view: knobs panel', hint: 'a list of every number in the shader, each with its own slider and tick box; unticking puts the number back as it was', type: 'bool', def: false },
  { key: 'visualSize', label: 'Picture: resolution', hint: 'pixels each way (the shader sees it as R). The picture keeps its place on the page and in the pop-out window, which is sharper with more pixels; a big one costs graphics power', type: 'choice', options: ['300', '480', '720', '1080'], labels: { 300: '300 x 300', 480: '480 x 480', 720: '720 x 720', 1080: '1080 x 1080' }, def: '300' },
  { key: 'visualDecay', label: 'Picture: hit fade (ms)', hint: 'how long a lane\'s hit takes to fade from 1 (about a third of it is left after this long)', type: 'int', min: 50, max: 1000, def: 220 },
  { key: 'visualGlsl', label: 'Picture: default shader', hint: 'used by projects that have no shader of their own. A project keeps its shader with it: edit that in the Shader view (Ctrl+Alt+G), with templates and colours for the code. GLSL ES 1.00, a whole main(). Empty uses the built-in metaballs. Ready to use: uniforms R (size), T (seconds), BEAT (beats), HITS (all hits, 0 to 1), C1 and C2 (colours), LANE[16]; and the look-ups hit("kick"), pitch("acid"), vel(2), held("pad") by lane name or number from 0, and hits(). A mistake in it shows as a line at the foot of the picture and the built-in picture keeps running.', type: 'code', def: '' },
  { group: 'Meters', key: 'meterOn', label: 'Meter band', hint: 'a strip along the bottom of the window (Ctrl+Alt+M, or the Meters button)', type: 'bool', def: false },
  { key: 'meterHeight', label: 'Meter band: height (px)', type: 'int', min: 100, max: 500, def: 190 },
  { key: 'meterSpectrum', label: 'Meters: spectrum', type: 'bool', def: true },
  { key: 'meterLayers', label: 'Meters: spectrum by instrument', hint: 'the spectrum is split into one translucent layer per instrument, with small numbered buttons to hide lanes; the colour setting is not used then', type: 'bool', def: false },
  { key: 'meterColour', label: 'Meters: spectrum colour', type: 'choice', options: ['spectrum', 'green'], labels: { spectrum: 'by frequency', green: 'plain green' }, hint: 'by frequency runs from violet at the bass to red at the top', def: 'spectrum' },
  { key: 'meterLevel', label: 'Meters: level and loudness', type: 'bool', def: true },
  { key: 'meterCorr', label: 'Meters: correlation', type: 'bool', def: true },
  { key: 'meterWidth', label: 'Meters: stereo width by band', hint: 'the ten bands of the spectral panner', type: 'bool', def: false },
  { key: 'meterScope', label: 'Meters: vectorscope', hint: 'left against right, a square at the right end of the band (Ctrl+Alt+O); a mono sound is a vertical line, a wide one spreads sideways', type: 'bool', def: false },
  { key: 'meterSgram', label: 'Meters: spectrogram', hint: 'the last 30 seconds', type: 'bool', def: false },
  { group: 'Console', key: 'consoleRules', label: 'Command rules', type: 'rules', def: DEFAULT_RULES },
  { key: 'vscopeLinger', label: 'Meters: vectorscope linger', hint: 'how long the picture takes to fade', type: 'int', min: 2, max: 30, def: 12 },
  { key: 'vscopeGlow', label: 'Meters: vectorscope glow', type: 'int', min: 0, max: 100, def: 55 },
  { group: 'Script', key: 'scriptLimit', label: 'Script time limit', hint: 'in ms; a script that runs longer is stopped and changes nothing', type: 'int', min: 100, max: 60000, def: 2000 },
  { group: 'Sample', key: 'ptrMax', label: 'Resynthesis: most branches', hint: 'it uses fewer when more would not help', type: 'int', min: 1, max: 16, def: 8 },
  { key: 'ptrTolerance', label: 'Resynthesis: tolerance (%)', hint: 'a new branch must explain at least this much of the tail; lower is closer and uses more branches', type: 'int', min: 1, max: 30, def: 5 },
  { key: 'ptrTransient', label: 'Resynthesis: attack kept (ms)', hint: '0 finds it from the sound', type: 'int', min: 0, max: 80, def: 0 },
  { key: 'midiLatency', label: 'Recording: latency offset', hint: 'in ms, added to what the browser reports; raise it if recorded notes land late', type: 'int', min: -200, max: 400, def: 0 },
  { group: 'De-normal diagnostics', key: 'dither', label: 'Output dither', hint: 'adds a whisper of noise (-96 dB) to the output: a test for clicks or crackle at very quiet levels (off: bit-exact output)', type: 'bool', def: false },
  { group: 'De-normal diagnostics', key: 'volFloor', label: 'Volume curve floor', hint: 'a Volume curve never goes below 0.003 (-50 dB): a test for clicks when a fade starts from silence (some sound devices pop when they wake from it)', type: 'bool', def: false },
];
const byKey = Object.fromEntries(SCHEMA.map(s => [s.key, s]));

// The settings in cards: one card per group, in the order the groups first appear (a setting without a group goes with the one
// before it), with the group's name taken off the front of a label that starts with it ("Meters: spectrum" under Meters).
export function grouped() {
  const order = [], map = new Map();
  let group = '';
  for (const s of SCHEMA) {
    if (s.group) group = s.group;
    const g = MOVED[s.key] ?? group;
    if (!map.has(g)) { map.set(g, []); order.push(g); }
    const prefix = `${g}: `;
    map.get(g).push(s.label && s.label.startsWith(prefix) ? { ...s, label: s.label[prefix.length].toUpperCase() + s.label.slice(prefix.length + 1) } : s);
  }
  return order.map(g => ({ group: g, items: map.get(g) }));
}

// Turns anything into a valid value for the setting, or its default.
const clean = (s, v) => {
  if (s.type === 'bool') return typeof v === 'boolean' ? v : s.def;
  if (s.type === 'colour') return typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : s.def;
  if (s.type === 'rules') return typeof v === 'string' && v.length <= 8000 ? v : s.def;
  if (s.type === 'image') return typeof v === 'string' && v.length <= 400000 && (v === '' || /^data:image\/(jpeg|png|webp);base64,/.test(v)) ? v : s.def;
  if (s.type === 'code') return typeof v === 'string' && v.length <= 20000 ? v : s.def;
  if (s.type === 'int') { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.max(s.min, Math.min(s.max, n)) : s.def; }
  return s.options.includes(v) ? v : s.def;
};

const read = k => { try { return localStorage.getItem(k); } catch { return null; } };
const values = {};
const listeners = new Set();
{
  let saved = null;
  try { saved = JSON.parse(read(KEY)); } catch { /* none, or damaged */ }
  // Note preview is on by default: a stored "off" from the older single-purpose setting is lifted once.
  if (saved && typeof saved === 'object' && saved.notePreview === false && read('webtracker.previewOn') === null) { saved.notePreview = true; try { localStorage.setItem('webtracker.previewOn', '1'); } catch { /* no matter */ } }
  for (const s of SCHEMA) {
    let v = saved && typeof saved === 'object' ? saved[s.key] : undefined;
    if (v === undefined && s.legacy) { const old = read(s.legacy[0]); if (old !== null) v = s.legacy[1](old); }
    values[s.key] = clean(s, v);
  }
}
const persist = () => { try { localStorage.setItem(KEY, JSON.stringify(values)); } catch { /* not remembered */ } };

export const get = key => values[key];
export const schemaOf = key => byKey[key];
// Sets one setting (the value is checked); listeners hear about it only if it changed.
export function set(key, value) {
  const s = byKey[key];
  if (!s) throw new Error(`No setting called "${key}".`);
  const v = clean(s, value);
  if (v === values[key]) return v;
  values[key] = v;
  persist();
  for (const f of listeners) f(key, v);
  return v;
}
export const onChange = f => { listeners.add(f); return () => listeners.delete(f); };
export const reset = () => { for (const s of SCHEMA) set(s.key, s.def); };
export const exportJson = () => JSON.stringify({ format: 'webtracker-config', version: 1, settings: { ...values } }, null, 2);
// Takes a config file's text; unknown or invalid entries are ignored. Returns how many settings were read.
export function importJson(text) {
  let data;
  try { data = JSON.parse(text); } catch { throw new Error('That is not a config file (invalid JSON).'); }
  if (data?.format !== 'webtracker-config' || typeof data.settings !== 'object' || data.settings === null) throw new Error('That is not a webtracker config file.');
  let n = 0;
  for (const s of SCHEMA) if (s.key in data.settings) { set(s.key, data.settings[s.key]); n++; }
  return n;
}
