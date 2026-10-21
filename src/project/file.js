import { SAMPLE_KEYS, isPool, ensurePool } from './ops.js';
// The project file: plain JSON, version 1, extension .wax.
//
// {
//   format: 'webtracker', version: 1,
//   patterns carry an optional `color`: 0..15 for one of the pastel presets, or '#rrggbb'
//   song: { name, bpm, ticksPerBeat, length, swing?, beatsPerBar?, loop?, info? },   (info: free text for notes and greetings)   (script: the song's script text)   (loop: { start, end } in ticks, end not included; playing loops it, else the whole song)   (swing 0.5 to 0.75: how much of each pair of ticks the first lasts; 0.5 or none is straight)
//   instruments: { id: { graph, exposed, commands, samples: { nodeId: sampleId | [sampleId, ...] }, noteColumns?,
//                         presets?: [{ id, name, values: { 'node.param': number }, data?: { node: { curve?, spectrum? } } }] } },
//   (graph.voices, 1 to 16, runs that many copies of the graph for polyphony; noteColumns, 1 to 8,
//    is how many note and velocity column pairs a row has; both default to 1)
//   samples: { id: { rate, encoding: 'pcm16' | 'float32', data: base64 of little-endian samples,
//                    loopStart?, loopEnd?, loopOn?, loopXfade?, susStart?, susEnd?, susOn?, susXfade?,
//                    volume?, globalVolume?, pan? } },   (loops in frames, crossfades in frames, volume 0..1, pan -1..1; no encoding means float32)
//   lanes: [{ id, instrument, patterns: { puid: { name, index, rows: ['C-4 .. 70', ...] } },
//             placements: [{ puid, start, length }],
//             mutes?: [tick, ...],
//             offs?: [tick, ...],   // ticks where the lane lets go of its notes
//             silenced?: true }],   (the whole lane is muted, whatever the flips say)   (the lane is muted from the 1st tick to the 2nd, from the 3rd to the 4th, ...)
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

// The loop points, loop switches and crossfades, volume, global volume and pan, where set.
const pickKeys = s => Object.fromEntries(SAMPLE_KEYS.filter(k => s[k] !== undefined).map(k => [k, s[k]]));

export const encodeSample = (s, format) => ({
  rate: s.rate,
  encoding: format,
  data: encodeChannel(s.data, format),
  ...(s.right ? { right: encodeChannel(s.right, format) } : {}),   // stereo samples only
  ...pickKeys(s),
});

export const decodeSample = s => ({
  rate: s.rate,
  data: decodeChannel(s.data, s.encoding),
  ...(s.right ? { right: decodeChannel(s.right, s.encoding) } : {}),
  ...pickKeys(s),
});

// lanes are the prepared working lanes (with any edits), not the song's source lanes.
// Samples are stored as 16-bit PCM unless sampleFormat is 'float32'.
export function serializeProject({ song, instruments, samples, lanes }, { sampleFormat = 'pcm16' } = {}) {
  return JSON.stringify({
    format: FORMAT,
    version: VERSION,
    song: { name: song.name ?? 'untitled', bpm: song.bpm, ticksPerBeat: song.ticksPerBeat, length: song.length, ...(song.swing && song.swing !== 0.5 ? { swing: song.swing } : {}), ...(song.beatsPerBar && song.beatsPerBar !== 4 ? { beatsPerBar: song.beatsPerBar } : {}), ...(song.loop ? { loop: { start: song.loop.start, end: song.loop.end, ...(song.loop.off ? { off: true } : {}) } } : {}), ...(song.info ? { info: song.info } : {}), ...(song.script ? { script: song.script } : {}) },
    instruments,
    samples: Object.fromEntries(Object.entries(samples).filter(([id]) => !isPool(id)).map(([id, s]) => [id, encodeSample(s, sampleFormat)])),
    lanes: lanes.map(l => ({
      id: l.id,
      instrument: l.instrument,
      patterns: Object.fromEntries(Object.entries(l.patterns)
        .map(([puid, p]) => [puid, { name: p.name, index: p.index, ...(p.color !== undefined ? { color: p.color } : {}), rows: p.rows.map(row => row.join(' ')) }])),
      placements: l.placements,
      ...(l.mutes?.length ? { mutes: l.mutes } : {}),
      ...(l.offs?.length ? { offs: l.offs } : {}),
      ...(l.silenced ? { silenced: true } : {}),
    })),
  }, null, 1);
}

// Sampler instruments saved before the sample, offset and retrig columns existed keep their own exposed list, so
// they would never get them. On loading, those columns are put first (Smp Off Rtg, then the old ones as they were),
// the pattern cells are moved to match, and the missing repeat commands are added. `layout: 2` marks an instrument
// that has been through this, or was made with the columns, so a layout chosen later is left alone.
export function upgradeSamplerLayout(data) {
  for (const [id, def] of Object.entries(data.instruments ?? {})) {
    if (def.layout !== undefined) continue;
    const node = def.graph?.nodes?.find(n => n.type === 'sampler');
    if (!node) continue;
    def.layout = 2;
    const old = def.exposed ?? [];
    if (old.some(e => e.node === node.id && e.param === 'sample')) continue;
    const front = [{ node: node.id, param: 'sample', label: 'Smp' }, { node: node.id, param: 'offset', label: 'Off', bits: 16 }, { node: node.id, param: 'retrig', label: 'Rtg', bits: 16 }]
      .map(w => old.find(e => e.node === w.node && e.param === w.param) ?? w);
    const next = [...front, ...old.filter(e => !front.includes(e))];
    const blank = e => (e.bits === 16 ? '....' : e.bits === 4 ? '.' : '..');
    const pairs = Math.max(1, Math.min(8, def.noteColumns ?? 1));
    const hasCmd = Boolean(def.commands?.length || def.presets?.length);
    const total = pairs * 2 + old.length + (hasCmd ? 1 : 0);
    const blanks = [...Array.from({ length: pairs }, () => ['...', '..']).flat(), ...old.map(blank), ...(hasCmd ? ['......'] : [])];
    for (const lane of data.lanes ?? []) {
      if (lane.instrument !== id) continue;
      for (const pat of Object.values(lane.patterns ?? {})) {
        pat.rows = (pat.rows ?? []).map(line => {
          const cells = line.trim().split(/\s+/);
          while (cells.length < total) cells.push(blanks[cells.length]);
          return [
            ...cells.slice(0, pairs * 2),
            ...next.map(e => { const k = old.indexOf(e); return k >= 0 ? cells[pairs * 2 + k] : blank(e); }),
            ...(hasCmd ? [cells[total - 1]] : []),
          ].join(' ');
        });
      }
    }
    def.exposed = next;
    if (def.commands) {
      for (const [cid, param] of [[0x07, 'repeats'], [0x08, 'shift'], [0x09, 'ramp'], [0x0A, 'reverse']]) {
        if (def.commands.some(c => c.node === node.id && c.param === param) || def.commands.some(c => c.id === cid)) continue;
        def.commands.push({ id: cid, node: node.id, param });
      }
    }
  }
}

// Returns { song, instruments, samples } in the shape prepareSong and the engine use.
// Sampler instruments saved before the slice command got it: it is added on loading.
// The same for the grain and texture commands (0B to 17), added where their id and parameter are both free.
const LATER_SAMPLER_COMMANDS = [[0x10, 'slice'], [0x0B, 'grain'], [0x0C, 'edge'], [0x0D, 'accel'], [0x0E, 'step'], [0x0F, 'slide'], [0x11, 'flip'], [0x12, 'prob'], [0x13, 'jOffset'], [0x14, 'jPitch'], [0x15, 'jPan'], [0x16, 'jTime'], [0x17, 'jLevel'], [0x18, 'volLin'], [0x19, 'volLog'], [0x1A, 'volDown'], [0x1B, 'volUp'], [0x1C, 'volFineDown'], [0x1D, 'volFineUp'], [0x90, 'volDownMs'], [0x91, 'volUpMs'], [0x92, 'volFineDownMs'], [0x93, 'volFineUpMs'], [0x1E, 'subdivide'], [0x20, 'portDown'], [0x21, 'portUp'], [0x22, 'portFineDown'], [0x23, 'portFineUp'], [0x24, 'portTo'], [0x25, 'retrigMin'], [0x26, 'retrigMax'], [0x27, 'retrigPow'], [0x28, 'cutAfter'], [0x29, 'releaseAfter'], [0x2A, 'cutScale'], [0x2B, 'stretchSub'], [0x2C, 'stretchTicks'], [0x2D, 'stretchKeep'], [0x30, 'filterType'], [0x31, 'filterCutoff'], [0x32, 'filterRes'], [0x33, 'cutDown'], [0x34, 'cutUp'], [0x35, 'cutStep'], [0x38, 'jCutoff'], [0x39, 'jTimeSub'], [0x40, 'vibSpeed'], [0x41, 'vibDepth'], [0x42, 'vibWave'], [0x43, 'lfoSpeed'], [0x44, 'lfoDepth'], [0x45, 'lfoWave'], [0x50, 'vibSync'], [0x51, 'vibPhase'], [0x52, 'lfoSync'], [0x53, 'lfoPhase'], [0x60, 'jumpAhead'], [0x61, 'jumpBack'], [0x62, 'jumpAheadRel'], [0x63, 'jumpBackRel'], [0x64, 'jumpTicksAhead'], [0x65, 'jumpTicksBack'], [0x66, 'jumpTicksAheadRel'], [0x67, 'jumpTicksBackRel'], [0xFF, 'blockCount'], [0xF0, 'blockCount', 65535]];
function ensureSliceCommand(data) {
  for (const def of Object.values(data.instruments ?? {})) {
    for (const n of def.graph?.nodes ?? []) if (n.params && 'absBlock' in n.params) { n.params.blockCount = n.params.absBlock; delete n.params.absBlock; }   // its name in m278
    for (const c of def.commands ?? []) if (c.param === 'absBlock') c.param = 'blockCount';
    const node = def.graph?.nodes?.find(n => n.type === 'sampler');
    if (!node || !def.commands) continue;
    for (const [id, param, fixed] of LATER_SAMPLER_COMMANDS) {
      if (def.commands.some(c => c.id === id || (c.node === node.id && c.param === param && c.fixed === fixed))) continue;
      def.commands.push({ id, node: node.id, param, ...(fixed === undefined ? {} : { fixed }) });
    }
  }
}

export function parseProject(text) {
  let data;
  try { data = JSON.parse(text); } catch { throw new Error('Not a webtracker file (invalid JSON).'); }
  if (data?.format !== FORMAT) throw new Error('Not a webtracker file.');
  if (data.version !== VERSION) {
    throw new Error(`Unsupported file version ${data.version}; this build reads version ${VERSION}.`);
  }
  upgradeSamplerLayout(data);
  ensureSliceCommand(data);
  const samples = ensurePool(Object.fromEntries(Object.entries(data.samples ?? {}).filter(([id]) => !isPool(id)).map(([id, s]) => [id, decodeSample(s)])));
  for (const [id, def] of Object.entries(data.instruments)) {
    for (const sampleId of Object.values(def.samples ?? {}).flat()) {
      if (!samples[sampleId]) throw new Error(`Instrument "${id}" uses unknown sample "${sampleId}".`);
    }
  }
  const lanes = data.lanes.map(l => {
    if (!data.instruments[l.instrument]) throw new Error(`Lane "${l.id}" uses unknown instrument "${l.instrument}".`);
    return {
      id: l.id,
      instrument: l.instrument,
      patterns: Object.fromEntries(Object.entries(l.patterns)
        .map(([puid, p]) => [puid, { name: p.name, index: p.index, ...(p.color !== undefined ? { color: p.color } : {}), text: p.rows.join('\n') }])),
      placements: l.placements,
      ...(l.mutes?.length ? { mutes: l.mutes } : {}),
      ...(l.offs?.length ? { offs: l.offs } : {}),
      ...(l.silenced ? { silenced: true } : {}),
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
  const used = [...new Set(Object.values(def.samples ?? {}).flat())].filter(id => !isPool(id));
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
  const samples = Object.fromEntries(Object.entries(data.samples ?? {}).filter(([id]) => !isPool(id)).map(([id, s]) => [id, decodeSample(s)]));
  for (const sampleId of Object.values(data.instrument.samples ?? {}).flat()) {
    if (!samples[sampleId] && !isPool(sampleId)) throw new Error(`The instrument uses unknown sample "${sampleId}".`);
  }
  return { name: data.name ?? 'instrument', instrument: data.instrument, samples };
}
