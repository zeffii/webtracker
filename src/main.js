import { Engine } from './audio/engine.js';
import { NODE_TYPES } from './audio/nodes/index.js';
import { pruneDef } from './graph/edit.js';
import { createPatcher } from './graph/patcher.js';
import { createDemoProject } from './project/demo.js';
import { FILE_EXT, parseProject, serializeProject } from './project/file.js';
import { createEditor } from './seq/editor.js';
import { prepareSong, rebuildInstrumentLanes } from './seq/lane.js';
import { createSequenceView } from './seq/seqview.js';
import { createTrackerView } from './seq/view.js';

const engine = new Engine();
const $ = id => document.getElementById(id);
let started = false, playing = false, project = null;

// Live sliders write the lead's exposed parameters. Where the pattern has a value
// on a tick it wins; empty pattern cells leave the slider's value alone.
const bindings = [
  ['cutoff', 'cutoff-out', 'lead.filter.cutoff', v => 80 * 2 ** (v * 7.8), x => `${Math.round(x)} Hz`],
  ['res', 'res-out', 'lead.filter.resonance', v => v, x => x.toFixed(2)],
  ['mix', 'mix-out', 'lead.delay.mix', v => v, x => x.toFixed(2)],
];

const apply = ([input, output, address, map, format]) => {
  const value = map($(input).valueAsNumber);
  $(output).textContent = format(value);
  if (started && engine.registry.slots.has(address)) engine.set(address, value);   // a loaded project may not have it
};
for (const b of bindings) {
  $(b[0]).addEventListener('input', () => apply(b));
  apply(b);
}

const setPlaying = value => {
  playing = value;
  if (playing) engine.play(); else engine.stop();
  $('play').textContent = playing ? 'Stop' : 'Play';
};
const togglePlay = () => setPlaying(!playing);
$('play').addEventListener('click', e => { togglePlay(); e.currentTarget.blur(); });

const view = createTrackerView({
  el: $('view'), statusEl: $('cursor'), transport: engine.transport, onToggle: togglePlay,
  onBack: () => $('seq').focus(),
  onMove: (lane, tick) => seqView.goto(lane, tick),
});
const seqView = createSequenceView({
  el: $('seq'), statusEl: $('seq-status'), transport: engine.transport, onToggle: togglePlay,
  onOpen: (lane, tick) => { view.goto(lane, tick); $('view').focus(); },
  onMove: (lane, tick) => view.goto(lane, tick),
});

const patcher = createPatcher({
  canvas: $('patch'), panel: $('patch-panel'), statusEl: $('patch-status'), nodeTypes: NODE_TYPES,
  onStructure: id => reloadInstrument(id),
  onParam: (id, node, name, value) => {
    const address = `${id}.${node}.${name}`;
    if (engine.registry.slots.has(address)) engine.set(address, value);
  },
});

const sendSamples = id => {
  const def = project.instruments[id];
  for (const [node, sampleId] of Object.entries(def.samples ?? {})) {
    const { data, rate, loopStart, loopEnd } = project.samples[sampleId];
    engine.sendToNode(id, node, { type: 'sample', data: data.slice(), rate, loopStart, loopEnd });
  }
};

// The wiring or the exposed parameters of an instrument changed: recompile it, swap it in,
// and rebuild the columns of its lanes. Cells follow their column; undo history is cleared.
function reloadInstrument(id) {
  try {
    const def = project.instruments[id];
    pruneDef(def, NODE_TYPES);
    engine.loadInstrument(id, def.graph);
    sendSamples(id);
    for (const { id: laneId, instrument, columns, pages } of rebuildInstrumentLanes(project.lanes, project.song, project.instruments, engine.registry, id)) {
      engine.setLane({ id: laneId, instrument, columns, pages });
    }
    project.editor.clear();
    view.relayout();
    bindings.forEach(apply);
  } catch (err) {
    $('patch-status').textContent = err.message;
  }
}

// Loads a project into the running engine: { song, instruments, samples }.
function openProject({ song, instruments, samples }) {
  if (playing) setPlaying(false);
  engine.reset();
  project = { song, instruments, samples, lanes: [], editor: null };
  for (const id of Object.keys(instruments)) {
    engine.loadInstrument(id, instruments[id].graph);
    sendSamples(id);
  }
  const lanes = prepareSong(song, instruments, engine.registry);
  engine.setSong(song);
  for (const { id, instrument, columns, pages } of lanes) engine.setLane({ id, instrument, columns, pages });
  const editor = createEditor(lanes, song.length);
  project = { song, instruments, samples, lanes, editor };
  patcher.load({ instruments, samples: Object.keys(samples) });
  const pick = $('patch-inst');
  pick.replaceChildren(...Object.keys(instruments).map(id => new Option(id, id)));
  pick.value = patcher.instrument;
  seqView.load({ lanes, song, editor });
  view.load({ lanes, song, editor });
  bindings.forEach(apply);
  $('seq').focus();
}

const download = (name, text) => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
};

$('save').addEventListener('click', () => {
  download(`${project.song.name ?? 'untitled'}${FILE_EXT}`, serializeProject(project));
  $('status').textContent = 'Saved.';
});
$('load').addEventListener('click', () => $('file').click());
$('file').addEventListener('change', async e => {
  const [file] = e.target.files;
  e.target.value = '';
  if (!file) return;
  try {
    openProject(parseProject(await file.text()));
    $('status').textContent = `Loaded ${file.name}.`;
  } catch (err) {
    $('status').textContent = err.message;
  }
});

$('patch-inst').addEventListener('change', e => patcher.show(e.target.value));
$('patch-type').replaceChildren(...Object.keys(NODE_TYPES).filter(t => !NODE_TYPES[t].master).map(t => new Option(t, t)));
$('patch-add').addEventListener('click', () => patcher.add($('patch-type').value));

$('start').addEventListener('click', async () => {
  try {
    await engine.start();
    started = true;
    openProject(createDemoProject(engine.ctx.sampleRate));
    for (const id of ['start']) $(id).disabled = true;
    for (const id of ['play', 'save', 'load', 'patch-add']) $(id).disabled = false;
    $('status').textContent =
      `Running at ${engine.ctx.sampleRate} Hz, base latency ${(engine.ctx.baseLatency * 1000).toFixed(1)} ms`;
    const frame = () => { seqView.draw(); view.draw(); patcher.draw(); requestAnimationFrame(frame); };
    frame();
  } catch (err) {
    $('status').textContent = err.message;
  }
});
