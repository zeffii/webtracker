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
  Playing: 'How the grids behave while the song runs.',
  Editing: 'Defaults for solo-edit, lanes and inserting silence.',
  Sample: 'Post-transient resynthesis (right click in the sample display): the attack stays a real sample and the rest is rebuilt from synth branches.',
  Console: 'Press | in the pattern editor or the arrangement for a one-line command box. Each rule says what you type and what it does; a rule that is wrong, or that could match the same typing as another, is switched off until you fix it.',
  MIDI: 'A MIDI keyboard plays the machine under the cursor, enters notes in the pattern editor and records into patterns while the song plays (Rec, Ctrl+Shift+R). Chrome and Edge only.',
};

// type: bool | int | choice. `legacy` is the older single-purpose localStorage key, read once to carry settings over.
export const SCHEMA = [
  { group: 'Look', key: 'theme', label: 'Colour theme', type: 'choice', options: THEMES, def: 'system', legacy: ['webtracker.theme', v => v] },
  { key: 'splash', label: 'First screen', hint: 'only a "click to initialize" button at first, then the tracker (off: the tracker with its Start button)', type: 'bool', def: true },
  { key: 'patternTint', label: 'Tint patterns by colour', hint: 'a faint patchwork behind each pattern in the pattern editor (Alt+T)', type: 'bool', def: false },
  { key: 'hideKeys', label: 'Hide the shortcut panels', type: 'bool', def: false, legacy: ['webtracker.hideKeys', v => v === '1'] },
  { key: 'fontSize', label: 'Pattern editor font size', type: 'int', min: 8, max: 40, def: 13, legacy: ['patternFontSize', v => Number(v)] },
  { group: 'Playing', key: 'follow', label: 'Follow mode', hint: 'the grids scroll with the playing row', type: 'bool', def: false, legacy: ['webtracker.follow', v => v === '1'] },
  { key: 'followRoam', label: 'Allow the caret to roam while following', hint: 'moving the caret to another row pauses the following until F9 or the Follow button', type: 'bool', def: true },
  { key: 'playhead', label: 'Playhead', type: 'choice', options: ['marker', 'line', 'band'], labels: { marker: 'a > in the tick column and a bold row', line: 'a thin red line across the grid', band: 'a faint band across the row' }, def: 'band' },
  { key: 'notePreview', label: 'Note preview', hint: 'typed notes sound in the pattern editor', type: 'bool', def: false, legacy: ['patternPreview', v => v === '1'] },
  { group: 'Editing', key: 'wireStraight', label: 'Graph: wires between close nodes go straight', hint: 'below this distance (in pixels) the wire loses its S-curve and becomes a straight line, easing in up to twice that; 0 keeps every wire curved', type: 'int', min: 0, max: 400, def: 60 },
  { group: 'Editing', key: 'graphPullOut', label: 'Graph: dragging a node far out of its chain takes it out', hint: 'the dashed line; off keeps every wire when you move a node (Esc during a drag does the same once)', type: 'bool', def: true },
  { group: 'Editing', key: 'arrowStyle', label: 'Left and Right move by', hint: 'Ctrl+Left/Right always move one character inside the cell', type: 'choice', options: ['cell', 'char'], labels: { cell: 'whole cells: to the start of the next column', char: 'one character at a time (a held key jumps by column)' }, def: 'cell' },
  { group: 'Editing', key: 'soloStyle', label: 'Solo-edit shows', type: 'choice', options: ['window', 'hatch'], labels: { window: 'the pattern on its own', hatch: 'the song, the rest hatched and locked' }, def: 'window', legacy: ['patternSoloStyle', v => (v === 'hatch' ? 'hatch' : 'window')] },
  { key: 'tickLines', label: 'Time sliders: tick lines', hint: 'faint red lines where song ticks fall on time and rate parameters, and the value in ticks', type: 'bool', def: true },
  { key: 'tickSnap', label: 'Time sliders: snap to tick lines', hint: 'a mouse drag lands on a line when it is close; hold Alt to drag freely', type: 'bool', def: true },
  { key: 'followLane', label: 'Instrument editor follows the cursor', hint: 'moving into another lane shows that lane\'s machine', type: 'bool', def: true },
  { key: 'insertLength', label: 'Insert silence: default length', hint: 'in ticks', type: 'int', min: 1, max: 65536, def: 128 },
  { key: 'insertCut', label: 'Insert silence: cut patterns across the cursor', hint: 'off: a pattern crossing the cursor row stays whole', type: 'bool', def: false },
  { group: 'MIDI', key: 'midiOn', label: 'Use MIDI input', hint: 'the browser asks for permission when this is switched on', type: 'bool', def: false },
  { key: 'midiChannel', label: 'MIDI channel', hint: '0 listens to every channel', type: 'int', min: 0, max: 16, def: 0 },
  { key: 'midiVelocity', label: 'Velocity sensitive', hint: 'on: the key velocity is played and written to the vl column (Alt+V). off: every note at the default volume, nothing written', type: 'bool', def: false },
  { key: 'midiChord', label: 'A chord is', type: 'choice', options: ['window', 'held'], labels: { window: 'notes struck within the chord window', held: 'notes struck while another is still held' }, def: 'window' },
  { key: 'midiOrder', label: 'A chord goes into the columns', type: 'choice', options: ['pitch', 'played'], labels: { pitch: 'lowest note first', played: 'in the order the keys were struck' }, def: 'pitch' },
  { key: 'midiWindow', label: 'Chord window', hint: 'in ms', type: 'int', min: 5, max: 500, def: 60 },
  { key: 'midiAdvance', label: 'After entering notes', type: 'choice', options: ['stay', 'row'], labels: { stay: 'the cursor stays', row: 'the cursor moves down one row (when the keys are let go)' }, def: 'stay' },
  { key: 'midiOffs', label: 'Recording: release writes a note off', hint: 'the key release; off for pads and drums', type: 'bool', def: true },
  { key: 'midiShared', label: 'Shared patterns', hint: 'a pattern placed more than once, written by MIDI or a script', type: 'choice', options: ['ask', 'write'], labels: { ask: 'refuse: clone it first (G)', write: 'write into it, so every placement changes' }, def: 'ask' },
  { group: 'Backup', key: 'backupOn', label: 'Automatic backups', hint: 'snapshots of the project kept in this browser; open them with the Backups button', type: 'bool', def: true },
  { key: 'backupMinutes', label: 'Back up every (minutes)', hint: 'only when the project has changed', type: 'int', min: 1, max: 60, def: 3 },
  { key: 'backupKeep', label: 'Snapshots kept', hint: 'the oldest are dropped', type: 'int', min: 5, max: 200, def: 30 },
  { key: 'backupDownload', label: 'Download a backup file', hint: 'every few minutes when the project has changed; point the browser\'s download folder at a git folder to keep them (for browsers that cannot write to a folder)', type: 'bool', def: false },
  { key: 'backupDownloadMinutes', label: 'Download every (minutes)', type: 'int', min: 1, max: 240, def: 15 },
  { key: 'backupFolderMode', label: 'Backup folder files', type: 'choice', options: ['latest', 'stamped'], labels: { latest: 'one file per project, overwritten (a git folder keeps the history)', stamped: 'a new file each time' }, def: 'latest' },
  { group: 'Export', key: 'exportTail', label: 'Export: tail (seconds)', hint: 'rendered after the last row, so reverbs and delays can die out', type: 'int', min: 0, max: 120, def: 15 },
  { key: 'exportBits', label: 'Export: WAV format', type: 'choice', options: ['16', '24', '32'], labels: { 16: '16-bit', 24: '24-bit', 32: '32-bit float (cannot clip)' }, def: '24' },
  { group: 'Arrangement', key: 'minimapOn', label: 'Pattern minimaps', hint: 'each cell of the arrangement shows a small picture of its pattern: notes as ticks across by pitch, parameters as grey cells at the right edge', type: 'bool', def: false },
  { key: 'minimapLengths', label: 'Minimaps: note lengths', hint: 'a thin line from each note to the next note, note off or note cut', type: 'bool', def: true },
  { key: 'minimapCaps', label: 'Minimaps: note off and note cut', hint: 'cyan for ===, magenta for ^^^', type: 'bool', def: true },
  { key: 'minimapParams', label: 'Minimaps: parameters', hint: 'one narrow column each at the right edge, darker the higher the value', type: 'bool', def: true },
  { group: 'Meters', key: 'meterOn', label: 'Meter band', hint: 'a strip along the bottom of the window (Ctrl+Alt+M, or the Meters button)', type: 'bool', def: false },
  { key: 'meterHeight', label: 'Meter band: height (px)', type: 'int', min: 100, max: 500, def: 190 },
  { key: 'meterSpectrum', label: 'Meters: spectrum', type: 'bool', def: true },
  { key: 'meterLayers', label: 'Meters: spectrum by instrument', hint: 'the spectrum is split into one translucent layer per instrument, with small numbered buttons to hide lanes; the colour setting is not used then', type: 'bool', def: false },
  { key: 'meterColour', label: 'Meters: spectrum colour', type: 'choice', options: ['spectrum', 'green'], labels: { spectrum: 'by frequency, like a light spectrum (violet at the bass to red at the top)', green: 'plain green' }, def: 'spectrum' },
  { key: 'meterLevel', label: 'Meters: level and loudness', type: 'bool', def: true },
  { key: 'meterCorr', label: 'Meters: correlation', type: 'bool', def: true },
  { key: 'meterWidth', label: 'Meters: stereo width by band', hint: 'the ten bands of the spectral panner', type: 'bool', def: false },
  { key: 'meterSgram', label: 'Meters: spectrogram', hint: 'the last 30 seconds', type: 'bool', def: false },
  { group: 'Console', key: 'consoleRules', label: 'Command rules', type: 'rules', def: DEFAULT_RULES },
  { group: 'Scope', key: 'vscopeOn', label: 'Vectorscope overlay', hint: 'left against right in a corner of the window (Ctrl+Alt+O, or the Scope button); a mono sound is a vertical line, a wide one spreads sideways', type: 'bool', def: false },
  { key: 'vscopeSize', label: 'Vectorscope: size (% of the window\'s shorter side)', type: 'int', min: 15, max: 80, def: 45 },
  { key: 'vscopeCorner', label: 'Vectorscope: corner', hint: 'where it starts, and where double-clicking it sends it back (you can drag it anywhere, and drag its corner to resize)', type: 'choice', options: ['br', 'tr', 'bl', 'tl'], labels: { br: 'bottom right', tr: 'top right', bl: 'bottom left', tl: 'top left' }, def: 'br' },
  { key: 'vscopeLinger', label: 'Vectorscope: linger', hint: 'how long the picture takes to fade', type: 'int', min: 2, max: 30, def: 12 },
  { key: 'vscopeGlow', label: 'Vectorscope: glow', type: 'int', min: 0, max: 100, def: 55 },
  { group: 'Script', key: 'scriptLimit', label: 'Script time limit', hint: 'in ms; a script that runs longer is stopped and changes nothing', type: 'int', min: 100, max: 60000, def: 2000 },
  { group: 'Sample', key: 'ptrMax', label: 'Resynthesis: most branches', hint: 'it uses fewer when more would not help', type: 'int', min: 1, max: 16, def: 8 },
  { key: 'ptrTolerance', label: 'Resynthesis: tolerance (%)', hint: 'a new branch must explain at least this much of the tail; lower is closer and uses more branches', type: 'int', min: 1, max: 30, def: 5 },
  { key: 'ptrTransient', label: 'Resynthesis: attack kept (ms)', hint: '0 finds it from the sound', type: 'int', min: 0, max: 80, def: 0 },
  { key: 'midiLatency', label: 'Recording: latency offset', hint: 'in ms, added to what the browser reports; raise it if recorded notes land late', type: 'int', min: -200, max: 400, def: 0 },
];
const byKey = Object.fromEntries(SCHEMA.map(s => [s.key, s]));

// Turns anything into a valid value for the setting, or its default.
const clean = (s, v) => {
  if (s.type === 'bool') return typeof v === 'boolean' ? v : s.def;
  if (s.type === 'rules') return typeof v === 'string' && v.length <= 8000 ? v : s.def;
  if (s.type === 'int') { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.max(s.min, Math.min(s.max, n)) : s.def; }
  return s.options.includes(v) ? v : s.def;
};

const read = k => { try { return localStorage.getItem(k); } catch { return null; } };
const values = {};
const listeners = new Set();
{
  let saved = null;
  try { saved = JSON.parse(read(KEY)); } catch { /* none, or damaged */ }
  for (const s of SCHEMA) {
    let v = saved && typeof saved === 'object' ? saved[s.key] : undefined;
    if (v === undefined && s.legacy) { const old = read(s.legacy[0]); if (old !== null) v = s.legacy[1](old); }
    values[s.key] = clean(s, v);
  }
}
const persist = () => { try { localStorage.setItem(KEY, JSON.stringify(values)); } catch { /* not remembered */ } };

export const get = key => values[key];
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
