// Instrument presets: a snapshot of every parameter of an instrument's nodes (and the curves and
// spectra drawn on them), kept on the instrument as
//   presets: [{ id, name, values: { 'node.param': number }, data?: { node: { curve?, spectrum?, waves? } } }]
// The id (0 to 65535, in practice small) is what a pattern's command 00 refers to, so it is stable:
// it is given once, the lowest free one, and removing a preset leaves the others where they are.

// Drawn data is an array of numbers, a text (a wavetable) or a small object (what a wavetable was cut from).
const copyData = v => (Array.isArray(v) ? [...v] : typeof v === 'object' && v !== null ? structuredClone(v) : v);

// The current sound: `read(nodeId, param)` gives the live value (or undefined for the stored one).
export function capturePreset(def, nodeTypes, read, name = '') {
  const values = {}, data = {};
  for (const node of def.graph.nodes) {
    const type = nodeTypes[node.type];
    if (!type) continue;
    for (const spec of type.params) {
      const live = read?.(node.id, spec.name);
      values[`${node.id}.${spec.name}`] = Number.isFinite(live) ? live : node.params?.[spec.name] ?? spec.def;
    }
    for (const key of ['curve', 'spectrum', 'waves', 'table', 'pair', 'taps', 'gate', 'chords', 'code', 'meta']) if (node.data?.[key]) data[node.id] = { ...data[node.id], [key]: copyData(node.data[key]) };
  }
  return { name, values, ...(Object.keys(data).length ? { data } : {}) };
}

export const findPreset = (def, id) => (def.presets ?? []).find(p => p.id === id);

// Adds a preset, giving it the lowest free id. Returns the id.
export function addPreset(def, preset) {
  def.presets ??= [];
  const used = new Set(def.presets.map(p => p.id));
  let id = 0;
  while (used.has(id)) id++;
  def.presets.push({ ...preset, id, name: preset.name || `preset ${id.toString(16).toUpperCase().padStart(2, '0')}` });
  def.presets.sort((a, b) => a.id - b.id);
  return id;
}

// Replaces what a preset holds with a new snapshot; its id and name stay.
export function overwritePreset(def, id, snapshot) {
  const old = findPreset(def, id);
  if (!old) throw new Error(`No preset number ${id}.`);
  Object.assign(old, { values: snapshot.values });
  if (snapshot.data) old.data = snapshot.data; else delete old.data;
}

export function renamePreset(def, id, name) {
  const preset = findPreset(def, id);
  if (!preset) throw new Error(`No preset number ${id}.`);
  if (!name.trim()) throw new Error('A preset needs a name.');
  preset.name = name.trim().slice(0, 32);
}

export function removePreset(def, id) {
  if (!findPreset(def, id)) throw new Error(`No preset number ${id}.`);
  def.presets = def.presets.filter(p => p.id !== id);
  if (!def.presets.length) delete def.presets;
}

// Recalls a preset into the instrument's graph (so it is what gets saved) and says what to send to
// the running engine: parameters as [node, param, value], drawn data as [node, type, points].
// Parameters and nodes that are gone since the preset was taken are skipped.
export function applyPreset(def, nodeTypes, id) {
  const preset = findPreset(def, id);
  if (!preset) throw new Error(`No preset number ${id}.`);
  const params = [], data = [];
  for (const [key, value] of Object.entries(preset.values)) {
    const dot = key.indexOf('.'), nodeId = key.slice(0, dot), name = key.slice(dot + 1);
    const node = def.graph.nodes.find(n => n.id === nodeId);
    if (!node || !nodeTypes[node.type]?.params.some(p => p.name === name)) continue;
    node.params = { ...node.params, [name]: value };
    params.push([nodeId, name, value]);
  }
  for (const [nodeId, d] of Object.entries(preset.data ?? {})) {
    const node = def.graph.nodes.find(n => n.id === nodeId);
    if (!node) continue;
    for (const [type, points] of Object.entries(d)) {
      node.data = { ...node.data, [type]: copyData(points) };
      data.push([nodeId, type, copyData(points)]);
    }
  }
  return { params, data };
}
