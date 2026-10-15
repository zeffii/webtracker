// A preset library (.wxpr): presets kept apart from any project, to pull into an instrument
// when wanted. Importing copies the preset, so the instrument's own list stays its own.
//   { format: 'webtracker-presets', version: 1, presets: [{ name, machine, values, data? }] }
// `machine` is the name of the instrument the preset was taken from, for the list only.
import { addPreset, findPreset } from './presets.js';

export const LIBRARY_FORMAT = 'webtracker-presets';
export const LIBRARY_EXT = '.wxpr';

export const newLibrary = () => ({ presets: [] });

export const serializeLibrary = library => JSON.stringify({ format: LIBRARY_FORMAT, version: 1, presets: library.presets }, null, 1);

export function parseLibrary(text) {
  let data;
  try { data = JSON.parse(text); } catch { throw new Error('Not a preset library (invalid JSON).'); }
  if (data?.format !== LIBRARY_FORMAT) throw new Error('Not a preset library.');
  if (data.version !== 1) throw new Error(`Unsupported library version ${data.version}.`);
  const presets = (data.presets ?? []).filter(p => p && typeof p.name === 'string' && p.values && typeof p.values === 'object');
  return { presets };
}

// Puts copies of an instrument's presets (or just the listed ids) into the library. A preset
// with the same name from the same machine is replaced. Returns how many were stored.
export function addToLibrary(library, def, machine, ids = null) {
  let count = 0;
  for (const p of def.presets ?? []) {
    if (ids && !ids.includes(p.id)) continue;
    const entry = { name: p.name, machine, values: { ...p.values }, ...(p.data ? { data: structuredClone(p.data) } : {}) };
    const at = library.presets.findIndex(q => q.name === p.name && q.machine === machine);
    if (at >= 0) library.presets[at] = entry; else library.presets.push(entry);
    count++;
  }
  return count;
}

// Copies a library preset into the instrument. One with the same name already there is
// overwritten in place, keeping its number, so patterns that recall it keep working.
// Returns the preset's number.
export function importFromLibrary(def, entry) {
  const snapshot = { name: entry.name, values: { ...entry.values }, ...(entry.data ? { data: structuredClone(entry.data) } : {}) };
  const same = (def.presets ?? []).find(p => p.name === entry.name);
  if (same) {
    same.values = snapshot.values;
    if (snapshot.data) same.data = snapshot.data; else delete same.data;
    return same.id;
  }
  return addPreset(def, snapshot);
}
