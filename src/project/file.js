// The project file: plain JSON, version 1, extension .wax.
//
// {
//   format: 'webtracker', version: 1,
//   song: { name, bpm, ticksPerBeat, length, swing? },   (swing 0.5 to 0.75: how much of each pair of ticks the first lasts; 0.5 or none is straight)
//   instruments: { id: { graph, exposed, commands, samples: { nodeId: sampleId }, noteColumns?,
//                         presets?: [{ id, name, values: { 'node.param': number }, data?: { node: { curve?, spectrum? } } }] } },
//   (graph.voices, 1 to 16, runs that many copies of the graph for polyphony; noteColumns, 1 to 8,
//    is how many note and velocity column pairs a row has; both default to 1)
//   samples: { id: { rate, encoding: 'pcm16' | 'float32', data: base64 of little-endian samples,
//                    loopStart?, loopEnd? } },   (loop points in frames; no encoding means float32)
//   lanes: [{ id, instrument, patterns: { puid: { name, index, rows: ['C-4 .. 70', ...] } },
//             placements: [{ puid, start, length }],
//             mutes?: [tick, ...] }],   (the lane is muted from the 1st tick to the 2nd, from the 3rd to the 4th, ...)
// }
//
// Graphs are stored from the start, so a modular view needs no format change.
export const FORMAT = 'webtracker';
export const VERSION = 1;
export const FILE_EXT = '.wax';

const toBase64 = floats => {
  const bytes = new Uint8Array(floats.buffer, floats.byteOffset, floats.byteLength);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
};

const fromBase64 = text => {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
};

// 16-bit PCM: half the size of float32, with an error of at most 1/32767 of full scale.
const toPcm16 = floats => Int16Array.from(floats, v => Math.round(Math.min(1, Math.max(-1, v)) * 32767));
const fromPcm16 = ints => Float32Array.from(ints, v => v / 32767);

const encodeChannel = (data, format) => toBase64(format === 'pcm16' ? toPcm16(data) : data);
const decodeChannel = (text, encoding) => (encoding === 'pcm16' ? fromPcm16(new Int16Array(fromBase64(text))) : new Float32Array(fromBase64(text)));

export const encodeSample = (s, format) => ({
  rate: s.rate,
  encoding: format,
  data: encodeChannel(s.data, format),
  ...(s.right ? { right: encodeChannel(s.right, format) } : {}),   // stereo samples only
  loopStart: s.loopStart,
  loopEnd: s.loopEnd,
});

export const decodeSample = s => ({
  rate: s.rate,
  data: decodeChannel(s.data, s.encoding),
  ...(s.right ? { right: decodeChannel(s.right, s.encoding) } : {}),
  loopStart: s.loopStart,
  loopEnd: s.loopEnd,
});

// lanes are the prepared working lanes (with any edits), not the song's source lanes.
// Samples are stored as 16-bit PCM unless sampleFormat is 'float32'.
export function serializeProject({ song, instruments, samples, lanes }, { sampleFormat = 'pcm16' } = {}) {
  return JSON.stringify({
    format: FORMAT,
    version: VERSION,
    song: { name: song.name ?? 'untitled', bpm: song.bpm, ticksPerBeat: song.ticksPerBeat, length: song.length, ...(song.swing && song.swing !== 0.5 ? { swing: song.swing } : {}) },
    instruments,
    samples: Object.fromEntries(Object.entries(samples).map(([id, s]) => [id, encodeSample(s, sampleFormat)])),
    lanes: lanes.map(l => ({
      id: l.id,
      instrument: l.instrument,
      patterns: Object.fromEntries(Object.entries(l.patterns)
        .map(([puid, p]) => [puid, { name: p.name, index: p.index, rows: p.rows.map(row => row.join(' ')) }])),
      placements: l.placements,
      ...(l.mutes?.length ? { mutes: l.mutes } : {}),
    })),
  }, null, 1);
}

// Returns { song, instruments, samples } in the shape prepareSong and the engine use.
export function parseProject(text) {
  let data;
  try { data = JSON.parse(text); } catch { throw new Error('Not a webtracker file (invalid JSON).'); }
  if (data?.format !== FORMAT) throw new Error('Not a webtracker file.');
  if (data.version !== VERSION) {
    throw new Error(`Unsupported file version ${data.version}; this build reads version ${VERSION}.`);
  }
  const samples = Object.fromEntries(Object.entries(data.samples ?? {}).map(([id, s]) => [id, decodeSample(s)]));
  for (const [id, def] of Object.entries(data.instruments)) {
    for (const sampleId of Object.values(def.samples ?? {})) {
      if (!samples[sampleId]) throw new Error(`Instrument "${id}" uses unknown sample "${sampleId}".`);
    }
  }
  const lanes = data.lanes.map(l => {
    if (!data.instruments[l.instrument]) throw new Error(`Lane "${l.id}" uses unknown instrument "${l.instrument}".`);
    return {
      id: l.id,
      instrument: l.instrument,
      patterns: Object.fromEntries(Object.entries(l.patterns)
        .map(([puid, p]) => [puid, { name: p.name, index: p.index, text: p.rows.join('\n') }])),
      placements: l.placements,
      ...(l.mutes?.length ? { mutes: l.mutes } : {}),
    };
  });
  return { song: { ...data.song, lanes }, instruments: data.instruments, samples };
}

// A single instrument on its own, to keep as a preset library or move between projects:
//   { format: 'webtracker-instrument', version: 1, name, instrument: { graph, exposed, ... },
//     samples: { id: <as in a project> } }   (only the samples the instrument uses)
export const INSTRUMENT_FORMAT = 'webtracker-instrument';
export const INSTRUMENT_EXT = '.waxi';

export function serializeInstrument(project, id, { sampleFormat = 'pcm16' } = {}) {
  const def = project.instruments[id];
  if (!def) throw new Error(`No instrument called "${id}".`);
  const used = [...new Set(Object.values(def.samples ?? {}))];
  return JSON.stringify({
    format: INSTRUMENT_FORMAT,
    version: VERSION,
    name: id,
    instrument: def,
    samples: Object.fromEntries(used.map(s => [s, encodeSample(project.samples[s], sampleFormat)])),
  }, null, 1);
}

// Returns { name, instrument, samples }.
export function parseInstrument(text) {
  let data;
  try { data = JSON.parse(text); } catch { throw new Error('Not an instrument file (invalid JSON).'); }
  if (data?.format !== INSTRUMENT_FORMAT) throw new Error('Not an instrument file.');
  if (data.version !== VERSION) throw new Error(`Unsupported file version ${data.version}; this build reads version ${VERSION}.`);
  if (!data.instrument?.graph) throw new Error('The instrument file has no graph.');
  const samples = Object.fromEntries(Object.entries(data.samples ?? {}).map(([id, s]) => [id, decodeSample(s)]));
  for (const sampleId of Object.values(data.instrument.samples ?? {})) {
    if (!samples[sampleId]) throw new Error(`The instrument uses unknown sample "${sampleId}".`);
  }
  return { name: data.name ?? 'instrument', instrument: data.instrument, samples };
}
