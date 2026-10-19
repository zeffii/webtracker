// User settings: one small object kept in this browser (localStorage 'webtracker.config'), shown on the Config
// tab, and exportable / importable as JSON. Everything that reads a setting goes through get(), and anything
// that should react to a change subscribes with onChange(), so the panel, the keyboard shortcuts and the
// toolbar buttons all stay in step.
const KEY = 'webtracker.config';
export const THEMES = ['system', 'dark', 'black', 'bright', 'neon', 'amber', 'phosphor', 'ice', 'synthwave'];

// What each group is for, shown beside its card on the Config tab.
export const GROUPS = {
  Look: 'Colours and sizes. Applied at once.',
  Playing: 'How the grids behave while the song runs.',
  Editing: 'Defaults for solo-edit, lanes and inserting silence.',
  Sample: 'Post-transient resynthesis (right click in the sample display): the attack stays a real sample and the rest is rebuilt from synth branches.',
  MIDI: 'A MIDI keyboard plays the machine under the cursor, enters notes in the pattern editor and records into patterns while the song plays (Rec, Alt+R). Chrome and Edge only.',
};

// type: bool | int | choice. `legacy` is the older single-purpose localStorage key, read once to carry settings over.
export const SCHEMA = [
  { group: 'Look', key: 'theme', label: 'Colour theme', type: 'choice', options: THEMES, def: 'system', legacy: ['webtracker.theme', v => v] },
  { key: 'patternTint', label: 'Tint patterns by colour', hint: 'a faint patchwork behind each pattern in the pattern editor (Alt+T)', type: 'bool', def: false },
  { key: 'hideKeys', label: 'Hide the shortcut panels', type: 'bool', def: false, legacy: ['webtracker.hideKeys', v => v === '1'] },
  { key: 'fontSize', label: 'Pattern editor font size', type: 'int', min: 8, max: 40, def: 13, legacy: ['patternFontSize', v => Number(v)] },
  { group: 'Playing', key: 'follow', label: 'Follow mode', hint: 'the grids scroll with the playing row', type: 'bool', def: false, legacy: ['webtracker.follow', v => v === '1'] },
  { key: 'followRoam', label: 'Allow the caret to roam while following', hint: 'moving the caret to another row pauses the following until F9 or the Follow button', type: 'bool', def: true },
  { key: 'playhead', label: 'Playhead', type: 'choice', options: ['marker', 'line', 'band'], labels: { marker: 'a > in the tick column and a bold row', line: 'a thin red line across the grid', band: 'a faint band across the row' }, def: 'band' },
  { key: 'notePreview', label: 'Note preview', hint: 'typed notes sound in the pattern editor', type: 'bool', def: false, legacy: ['patternPreview', v => v === '1'] },
  { group: 'Editing', key: 'graphPullOut', label: 'Graph: dragging a node far out of its chain takes it out', hint: 'the dashed line; off keeps every wire when you move a node (Esc during a drag does the same once)', type: 'bool', def: true },
  { group: 'Editing', key: 'arrowStyle', label: 'Left and Right move by', hint: 'Ctrl+Left/Right always move one character inside the cell', type: 'choice', options: ['cell', 'char'], labels: { cell: 'whole cells: to the start of the next column', char: 'one character at a time (a held key jumps by column)' }, def: 'cell' },
  { group: 'Editing', key: 'soloStyle', label: 'Solo-edit shows', type: 'choice', options: ['window', 'hatch'], labels: { window: 'the pattern on its own', hatch: 'the song, the rest hatched and locked' }, def: 'window', legacy: ['patternSoloStyle', v => (v === 'hatch' ? 'hatch' : 'window')] },
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
  { key: 'midiShared', label: 'Shared patterns', hint: 'a pattern placed more than once, written by MIDI', type: 'choice', options: ['ask', 'write'], labels: { ask: 'refuse: clone it first (G)', write: 'write into it, so every placement changes' }, def: 'ask' },
  { group: 'Sample', key: 'ptrMax', label: 'Resynthesis: most branches', hint: 'it uses fewer when more would not help', type: 'int', min: 1, max: 16, def: 8 },
  { key: 'ptrTolerance', label: 'Resynthesis: tolerance (%)', hint: 'a new branch must explain at least this much of the tail; lower is closer and uses more branches', type: 'int', min: 1, max: 30, def: 5 },
  { key: 'ptrTransient', label: 'Resynthesis: attack kept (ms)', hint: '0 finds it from the sound', type: 'int', min: 0, max: 80, def: 0 },
  { key: 'midiLatency', label: 'Recording: latency offset', hint: 'in ms, added to what the browser reports; raise it if recorded notes land late', type: 'int', min: -200, max: 400, def: 0 },
];
const byKey = Object.fromEntries(SCHEMA.map(s => [s.key, s]));

// Turns anything into a valid value for the setting, or its default.
const clean = (s, v) => {
  if (s.type === 'bool') return typeof v === 'boolean' ? v : s.def;
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
