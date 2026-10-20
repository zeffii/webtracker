// Node presets: named sets of a node's parameters (and, for nodes with a drawn shape, that shape). A node type can ship
// factory presets (`presets` in its module); the ones you save for a type are kept in this browser, for every project.
const KEY = 'webtracker.nodepresets';
// The drawn shapes a preset can carry, and how the running node is told about each.
export const DATA_KEYS = ['spectrum', 'waves', 'curve'];

const readAll = () => { try { return JSON.parse(localStorage.getItem(KEY)) ?? {}; } catch { return {}; } };
const writeAll = all => { try { localStorage.setItem(KEY, JSON.stringify(all)); return true; } catch { return false; } };

export const factoryPresets = type => type.presets ?? [];
export const userPresets = typeName => readAll()[typeName] ?? [];

export function saveUserPreset(typeName, preset) {
  const all = readAll(), list = (all[typeName] ?? []).filter(p => p.name !== preset.name);
  all[typeName] = [...list, preset].sort((a, b) => a.name.localeCompare(b.name));
  return writeAll(all);
}

export function deleteUserPreset(typeName, name) {
  const all = readAll();
  all[typeName] = (all[typeName] ?? []).filter(p => p.name !== name);
  return writeAll(all);
}

// What a node holds now, as a preset: every parameter (the live value when `live` knows one) and its drawn shapes.
export function capture(node, type, name, live = () => undefined) {
  const params = {};
  for (const s of type.params) {
    if (s.name === 'bypass') continue;
    const v = live(s.name) ?? node.params?.[s.name] ?? s.def;
    params[s.name] = Math.round(v * 10000) / 10000;
  }
  const data = {};
  for (const k of DATA_KEYS) if (node.data?.[k]) data[k] = Array.from(node.data[k]);
  return { name, params, ...(Object.keys(data).length ? { data } : {}) };
}

// The values a preset sets: every parameter the type has (the ones it does not mention go back to their defaults, so a
// preset always gives the same sound), clamped to range.
export function valuesOf(preset, type) {
  const out = [];
  for (const s of type.params) {
    if (s.name === 'bypass') continue;
    const v = preset.params?.[s.name] ?? s.def;
    out.push([s.name, Math.min(s.max, Math.max(s.min, s.int ? Math.round(v) : v))]);
  }
  return out;
}
