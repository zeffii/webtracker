import { newSamplerInstrument, synthKinds } from '../instruments.js';
import { createLane } from '../seq/lane.js';

// Changes to the shape of a project: samples, instruments, lanes. Plain functions on the
// project object { song, instruments, samples, lanes } so the page and the tests share them.

export function uniqueId(taken, base) {
  let id = base, i = 2;
  while (taken.has(id)) id = `${base}${i++}`;
  return id;
}

// A file name made into an id: no extension, letters, digits, _ and - only.
export const idFromName = name => name.replace(/\.[^.]+$/, '').replace(/[^A-Za-z0-9_-]+/g, '_').slice(0, 24) || 'sample';

// Averages all channels of a decoded audio buffer (or anything shaped like one) into one.
export function toMono(buffer) {
  const mono = new Float32Array(buffer.length);
  const n = buffer.numberOfChannels;
  for (let c = 0; c < n; c++) {
    const channel = buffer.getChannelData(c);
    for (let i = 0; i < mono.length; i++) mono[i] += channel[i] / n;
  }
  return mono;
}

export function addSample(project, name, rate, data) {
  const id = uniqueId(new Set(Object.keys(project.samples)), idFromName(name));
  project.samples[id] = { rate, data };
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
