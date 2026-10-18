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
};

// type: bool | int | choice. `legacy` is the older single-purpose localStorage key, read once to carry settings over.
export const SCHEMA = [
  { group: 'Look', key: 'theme', label: 'Colour theme', type: 'choice', options: THEMES, def: 'system', legacy: ['webtracker.theme', v => v] },
  { key: 'patternTint', label: 'Tint patterns by colour', hint: 'a faint patchwork behind each pattern in the pattern editor (Alt+T)', type: 'bool', def: false },
  { key: 'hideKeys', label: 'Hide the shortcut panels', type: 'bool', def: false, legacy: ['webtracker.hideKeys', v => v === '1'] },
  { key: 'fontSize', label: 'Pattern editor font size', type: 'int', min: 8, max: 40, def: 13, legacy: ['patternFontSize', v => Number(v)] },
  { group: 'Playing', key: 'follow', label: 'Follow mode', hint: 'the grids scroll with the playing row', type: 'bool', def: false, legacy: ['webtracker.follow', v => v === '1'] },
  { key: 'playhead', label: 'Playhead', type: 'choice', options: ['marker', 'line'], labels: { marker: 'a > in the tick column', line: 'a thin red line across the grid' }, def: 'marker' },
  { key: 'notePreview', label: 'Note preview', hint: 'typed notes sound in the pattern editor', type: 'bool', def: false, legacy: ['patternPreview', v => v === '1'] },
  { group: 'Editing', key: 'soloStyle', label: 'Solo-edit shows', type: 'choice', options: ['window', 'hatch'], labels: { window: 'the pattern on its own', hatch: 'the song, the rest hatched and locked' }, def: 'window', legacy: ['patternSoloStyle', v => (v === 'hatch' ? 'hatch' : 'window')] },
  { key: 'followLane', label: 'Instrument editor follows the cursor', hint: 'moving into another lane shows that lane\'s machine', type: 'bool', def: true },
  { key: 'insertLength', label: 'Insert silence: default length', hint: 'in ticks', type: 'int', min: 1, max: 65536, def: 128 },
  { key: 'insertCut', label: 'Insert silence: cut patterns across the cursor', hint: 'off: a pattern crossing the cursor row stays whole', type: 'bool', def: false },
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
