import { newSamplerInstrument, synthKinds } from '../instruments.js';
import { buildPages, createLane, flattenLane, writeMask } from '../seq/lane.js';

// Changes to the shape of a project: samples, instruments, lanes. Plain functions on the
// project object { song, instruments, samples, lanes } so the page and the tests share them.

export function uniqueId(taken, base) {
  let id = base, i = 2;
  while (taken.has(id)) id = `${base}${i++}`;
  return id;
}

// A file name made into an id: no extension, letters, digits, _ and - only.
// An all-digit id would make an object sort its keys numerically, which would break the order of
// instruments, so those get a leading underscore.
const notNumeric = id => (/^\d+$/.test(id) ? `_${id}` : id);
export const idFromName = name => notNumeric(name.replace(/\.[^.]+$/, '').replace(/[^A-Za-z0-9_-]+/g, '_').slice(0, 24) || 'sample');

// A typed name made into an id: letters, digits, _ and - only, trimmed, at most 24 characters.
export const cleanName = name => notNumeric(name.trim().replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 24));

// The channels of a decoded audio buffer (or anything shaped like one): one for mono, the
// first two otherwise.
export function channelsOf(buffer) {
  const left = Float32Array.from(buffer.getChannelData(0));
  return buffer.numberOfChannels > 1 ? { data: left, right: Float32Array.from(buffer.getChannelData(1)) } : { data: left };
}

// Averages all channels of a decoded audio buffer into one (kept for callers that want mono).
export function toMono(buffer) {
  const mono = new Float32Array(buffer.length);
  const n = buffer.numberOfChannels;
  for (let c = 0; c < n; c++) {
    const channel = buffer.getChannelData(c);
    for (let i = 0; i < mono.length; i++) mono[i] += channel[i] / n;
  }
  return mono;
}

// Sets `stereo` on each sampler node by whether its sample has two channels.
export function syncSamplerStereo(def, samples) {
  for (const node of def.graph?.nodes ?? []) {
    if (node.type !== 'sampler') continue;
    if (samples[def.samples?.[node.id]]?.right) node.stereo = true; else delete node.stereo;
  }
}

export function addSample(project, name, rate, data, right) {
  const id = uniqueId(new Set(Object.keys(project.samples)), idFromName(name));
  project.samples[id] = right ? { rate, data, right } : { rate, data };
  return id;
}

// Every { instrument, node } that plays the sample.
export function usersOfSample(project, id) {
  return Object.entries(project.instruments).flatMap(([instrument, def]) =>
    Object.entries(def.samples ?? {}).filter(([, sampleId]) => sampleId === id).map(([node]) => ({ instrument, node })));
}

export function removeSample(project, id) {
  if (usersOfSample(project, id).length) throw new Error(`"${id}" is used by an instrument.`);
  delete project.samples[id];
}

// Loop points in frames. 0 and 0 mean no loop. Returns the instruments that play the sample.
export function setLoop(project, id, loopStart, loopEnd) {
  const sample = project.samples[id];
  if (![loopStart, loopEnd].every(Number.isInteger) || loopStart < 0 || loopEnd < 0) throw new Error('Loop points are whole numbers of frames.');
  if (loopStart === 0 && loopEnd === 0) {
    delete sample.loopStart;
    delete sample.loopEnd;
  } else {
    if (loopEnd > sample.data.length) throw new Error(`The loop end is past the end of the sample (${sample.data.length} frames).`);
    if (loopEnd - loopStart < 2) throw new Error('The loop must be at least two frames long.');
    sample.loopStart = loopStart;
    sample.loopEnd = loopEnd;
  }
  return usersOfSample(project, id);
}

// Adds a sampler instrument playing a sample. Returns its id.
export function addSamplerInstrument(project, name, sampleId) {
  if (!project.samples[sampleId]) throw new Error('Pick a sample first.');
  const id = uniqueId(new Set(Object.keys(project.instruments)), idFromName(name || sampleId));
  project.instruments[id] = newSamplerInstrument(sampleId);
  return id;
}

// Adds a synth instrument ('subtractive' or 'additive'). Returns its id.
export function addSynthInstrument(project, name, kind) {
  if (!synthKinds[kind]) throw new Error(`Unknown synth kind: ${kind}`);
  const id = uniqueId(new Set(Object.keys(project.instruments)), idFromName(name || kind));
  project.instruments[id] = structuredClone(synthKinds[kind].make());
  return id;
}

// Adds an empty lane for an instrument that is already compiled. Returns the lane.
export function addLane(project, registry, instrumentId) {
  const id = uniqueId(new Set(project.lanes.map(l => l.id)), instrumentId);
  const lane = createLane(id, instrumentId, project.instruments, registry, project.song.length);
  project.lanes.push(lane);
  return lane;
}

// ---- managing lanes and instruments ----
// These change the project's shape; the page then reloads the whole project from projectData(), so
// engine state, columns and parameter slots all follow. Each throws an Error with a message fit
// for the status line when it cannot do what was asked.

const laneOf = (project, id) => {
  const lane = project.lanes.find(l => l.id === id);
  if (!lane) throw new Error(`No lane called "${id}".`);
  return lane;
};
const defOf = (project, id) => {
  if (!project.instruments[id]) throw new Error(`No instrument called "${id}".`);
  return project.instruments[id];
};
const newName = (name, taken, what, current) => {
  const next = cleanName(name ?? '');
  if (!next) throw new Error('A name needs letters or digits.');
  if (next !== current && taken.has(next)) throw new Error(`There is already ${what} called "${next}".`);
  return next;
};

// Sets the song's length in ticks, a whole number of 16-tick rows from 16 to 4096. Shortening
// drops the placements that start past the end and trims one that runs over it; the patterns
// themselves stay in each lane's list. Returns the new length.
export function setSongLength(project, ticks) {
  const length = Math.round(Number(ticks) / 16) * 16;
  if (!Number.isFinite(length) || length < 16 || length > 4096) throw new Error('A song is 16 to 4096 ticks long.');
  for (const lane of project.lanes) {
    lane.mutes = (lane.mutes ?? []).filter(t => t < length);
    lane.placements = lane.placements
      .filter(p => p.start < length)
      .map(p => (p.start + p.length > length ? { ...p, length: length - p.start } : p));
  }
  project.song.length = length;
  return length;
}

// Renames a sample (keeping its place in the list) and every instrument node that plays it.
export function renameSample(project, id, name) {
  if (!project.samples[id]) throw new Error(`No sample called "${id}".`);
  const next = newName(name, new Set(Object.keys(project.samples)), 'a sample', id);
  if (next === id) return id;
  project.samples = Object.fromEntries(Object.entries(project.samples).map(([k, v]) => [k === id ? next : k, v]));
  for (const def of Object.values(project.instruments)) {
    for (const [node, sid] of Object.entries(def.samples ?? {})) if (sid === id) def.samples[node] = next;
  }
  return next;
}

export function renameLane(project, id, name) {
  const lane = laneOf(project, id);
  lane.id = newName(name, new Set(project.lanes.map(l => l.id)), 'a lane', id);
  return lane.id;
}

// Moves a lane earlier (delta -1) or later (+1) in the song. Returns its new place.
export function moveLane(project, id, delta) {
  const from = project.lanes.indexOf(laneOf(project, id));
  const to = Math.max(0, Math.min(project.lanes.length - 1, from + delta));
  project.lanes.splice(to, 0, ...project.lanes.splice(from, 1));
  return to;
}

export function removeLane(project, id) {
  const lane = laneOf(project, id);
  if (project.lanes.length <= 1) throw new Error('A song needs at least one lane.');
  project.lanes.splice(project.lanes.indexOf(lane), 1);
}

// A copy of the lane with its patterns, placed right after it. Returns the copy.
export function duplicateLane(project, id, length = project.song.length) {
  const lane = laneOf(project, id);
  const copy = {
    id: uniqueId(new Set(project.lanes.map(l => l.id)), id),
    instrument: lane.instrument,
    columns: structuredClone(lane.columns),
    patterns: structuredClone(lane.patterns),
    placements: structuredClone(lane.placements),
    mutes: [...(lane.mutes ?? [])],
    silenced: lane.silenced === true,
  };
  copy.rows = flattenLane(copy, copy.columns, length);
  copy.pages = buildPages(copy.rows, copy.columns);
  writeMask(copy, length);
  project.lanes.splice(project.lanes.indexOf(lane) + 1, 0, copy);
  return copy;
}

// Lanes keep playing the instrument under its new name.
export function renameInstrument(project, id, name) {
  defOf(project, id);
  const next = newName(name, new Set(Object.keys(project.instruments)), 'an instrument', id);
  if (next === id) return id;
  project.instruments = Object.fromEntries(Object.entries(project.instruments).map(([k, v]) => [k === id ? next : k, v]));
  for (const lane of project.lanes) if (lane.instrument === id) lane.instrument = next;
  return next;
}

// An instrument that a lane still plays cannot go: that would leave the lane with no sound to make.
export function removeInstrument(project, id) {
  defOf(project, id);
  const users = project.lanes.filter(l => l.instrument === id).map(l => l.id);
  if (users.length) throw new Error(`"${id}" is played by ${users.length > 1 ? 'lanes' : 'lane'} ${users.join(', ')}; remove ${users.length > 1 ? 'those lanes' : 'that lane'} first.`);
  delete project.instruments[id];
}

// A copy of the instrument (graph, exposed parameters, samples), listed right after it.
export function duplicateInstrument(project, id, name) {
  const def = defOf(project, id);
  const taken = new Set(Object.keys(project.instruments));
  const next = name ? newName(name, taken, 'an instrument', null) : uniqueId(taken, id);
  project.instruments = Object.fromEntries(Object.entries(project.instruments).flatMap(([k, v]) => (k === id ? [[k, v], [next, structuredClone(def)]] : [[k, v]])));
  return next;
}

// Moves an instrument earlier (-1) or later (+1) in the list. Returns its new place.
export function moveInstrument(project, id, delta) {
  defOf(project, id);
  const entries = Object.entries(project.instruments), from = entries.findIndex(([k]) => k === id);
  const to = Math.max(0, Math.min(entries.length - 1, from + delta));
  entries.splice(to, 0, ...entries.splice(from, 1));
  project.instruments = Object.fromEntries(entries);
  return to;
}

// The project in the shape the page loads (and the engine rebuilds from): lanes back to source text.
export function projectData(project) {
  const lanes = project.lanes.map(l => ({
    id: l.id,
    instrument: l.instrument,
    patterns: Object.fromEntries(Object.entries(l.patterns).map(([puid, p]) => [puid, { name: p.name, index: p.index, text: p.rows.map(r => r.join(' ')).join('\n') }])),
    placements: l.placements.map(p => ({ ...p })),
    ...(l.mutes?.length ? { mutes: [...l.mutes] } : {}),
    ...(l.silenced ? { silenced: true } : {}),
  }));
  return { song: { ...project.song, lanes }, instruments: project.instruments, samples: project.samples };
}

// Adds an instrument read from an instrument file ({ name, instrument, samples }): a new id if the
// name is taken, and new sample ids where the file's would clash. Returns the instrument's id.
export function importInstrument(project, { name, instrument, samples }) {
  const def = structuredClone(instrument);
  const renamed = {};
  for (const [sid, s] of Object.entries(samples)) {
    renamed[sid] = uniqueId(new Set(Object.keys(project.samples)), sid);
    project.samples[renamed[sid]] = { ...s, data: s.data.slice(), ...(s.right ? { right: s.right.slice() } : {}) };
  }
  if (def.samples) def.samples = Object.fromEntries(Object.entries(def.samples).map(([node, sid]) => [node, renamed[sid]]));
  const id = uniqueId(new Set(Object.keys(project.instruments)), cleanName(name) || 'instrument');
  project.instruments[id] = def;
  return id;
}
