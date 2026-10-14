import { Engine } from './audio/engine.js';
import { NODE_TYPES } from './audio/nodes/index.js';
import { pruneDef } from './graph/edit.js';
import { createPatcher } from './graph/patcher.js';
import { createInsertMenu } from './graph/menu.js';
import { createDemoProject } from './project/demo.js';
import { addLane, addSample, addSamplerInstrument, addSynthInstrument, toMono } from './project/ops.js';
import { synthKinds } from './instruments.js';
import { createSamplePanel } from './project/samplepanel.js';
import { createWaveformView } from './project/waveform.js';
import { FILE_EXT, parseProject, serializeProject } from './project/file.js';
import { createEditor } from './seq/editor.js';
import { prepareSong, rebuildInstrumentLanes } from './seq/lane.js';
import { createSequenceView } from './seq/seqview.js';
import { createTrackerView } from './seq/view.js';
import { createTabs } from './ui/tabs.js';

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

// Full-screen panes. Switching with an F-key or a click focuses the pane's main element.
const tabs = createTabs({
  tabs: [
    { id: 'patterns', key: 'F2', el: $('pane-patterns'), button: $('tab-patterns'), focus: $('view') },
    { id: 'samples', key: 'F3', el: $('pane-samples'), button: $('tab-samples') },
    { id: 'instruments', key: 'F4', el: $('pane-instruments'), button: $('tab-instruments'), focus: $('patch') },
    { id: 'arrange', key: 'F5', el: $('pane-arrange'), button: $('tab-arrange'), focus: $('seq') },
  ],
});
document.addEventListener('keydown', e => {
  if (tabs.handleKey(e)) return;
  // Space plays from anywhere except controls that use it themselves, and keys a view already handled.
  const tag = e.target.tagName;
  if (e.key === ' ' && !e.defaultPrevented && !['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON'].includes(tag) && started) {
    e.preventDefault();
    togglePlay();
  }
});

const view = createTrackerView({
  el: $('view'), statusEl: $('cursor'), transport: engine.transport, onToggle: togglePlay,
  onBack: () => tabs.show('arrange'),
  onMove: (lane, tick) => seqView.goto(lane, tick),
});
const seqView = createSequenceView({
  el: $('seq'), statusEl: $('seq-status'), transport: engine.transport, onToggle: togglePlay,
  onOpen: (lane, tick) => { view.goto(lane, tick); tabs.show('patterns'); },
  onMove: (lane, tick) => view.goto(lane, tick),
});

const patcher = createPatcher({
  canvas: $('patch'), panel: $('patch-panel'), statusEl: $('patch-status'), nodeTypes: NODE_TYPES,
  onStructure: id => reloadInstrument(id),
  onContext: ({ x, y }) => menu.open(x, y),
  onData: (id, node, msg) => engine.sendToNode(id, node, msg),
  getSampleIds: () => Object.keys(project.samples),
  onParam: (id, node, name, value) => {
    const address = `${id}.${node}.${name}`;
    if (engine.registry.slots.has(address)) engine.set(address, value);
  },
});

// The floating insert menu lives over the patcher canvas.
const menu = createInsertMenu({ parent: $('patch-wrap'), nodeTypes: NODE_TYPES, onPick: (type, at) => patcher.add(type, at) });
$('patch').addEventListener('mousedown', () => menu.close());

const sendSample = (id, node) => {
  const { data, rate, loopStart, loopEnd } = project.samples[project.instruments[id].samples[node]];
  engine.sendToNode(id, node, { type: 'sample', data: data.slice(), rate, loopStart, loopEnd });
};
const sendSamples = id => { for (const node of Object.keys(project.instruments[id].samples ?? {})) sendSample(id, node); };

// Song name, tempo and position, shown in the header on every screen.
const songInfo = () => {
  if (!project) return;
  const { name, bpm, length } = project.song;
  const tick = Atomics.load(engine.transport, 0);
  $('song-info').textContent = `${name ?? 'untitled'} · ${bpm} bpm · row ${String(tick).padStart(2, '0')}/${length}`;
};

const projStatus = text => { $('proj-status').textContent = text; };

// The lists that depend on what the project holds: instruments, samples, the sample list.
function refreshProjectUi() {
  const fill = (select, ids) => {
    const keep = select.value;
    select.replaceChildren(...ids.map(id => new Option(id, id)));
    if (ids.includes(keep)) select.value = keep;
  };
  renderInstList();
  fill($('new-inst-sample'), Object.keys(project.samples));
  samplePanel.render();
  const ids = Object.keys(project.samples);
  if (!(waveform.sampleId in project.samples)) waveform.show(ids[0] ?? null);
}

// The narrow instrument list beside the patcher.
function renderInstList() {
  const buttons = Object.keys(project.instruments).map(id => {
    const b = document.createElement('button');
    b.textContent = id;
    b.classList.toggle('active', id === patcher.instrument);
    b.addEventListener('click', () => { patcher.show(id); renderInstList(); $('patch').focus(); });
    return b;
  });
  $('inst-list').replaceChildren(...buttons);
}

const sendLoop = users => users.forEach(({ instrument, node }) => sendSample(instrument, node));
const samplePanel = createSamplePanel({
  container: $('sample-panel'), statusEl: $('proj-status'), getProject: () => project,
  onLoop: sendLoop, onRemove: refreshProjectUi, onSelect: id => waveform.show(id),
});
const waveform = createWaveformView({
  canvas: $('wave'), statusEl: $('proj-status'), getProject: () => project,
  onLoop: users => { sendLoop(users); samplePanel.render(); },   // render again so the numbers follow the markers
});

// A new empty lane for an instrument that is already loaded in the engine.
function addLaneFor(instrumentId) {
  const lane = addLane(project, engine.registry, instrumentId);
  engine.setLane({ id: lane.id, instrument: lane.instrument, columns: lane.columns, pages: lane.pages });
  project.editor.clear();
  view.relayout();
  return lane;
}

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
  patcher.load({ instruments });
  refreshProjectUi();
  seqView.load({ lanes, song, editor });
  view.load({ lanes, song, editor });
  bindings.forEach(apply);
  tabs.show('patterns');
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

$('load-samples').addEventListener('click', () => $('sample-file').click());
$('sample-file').addEventListener('change', async e => {
  const files = [...e.target.files];
  e.target.value = '';
  for (const file of files) {
    try {
      // The browser decodes the file and resamples it to the audio context's rate.
      const buffer = await engine.ctx.decodeAudioData(await file.arrayBuffer());
      const sampleId = addSample(project, file.name, buffer.sampleRate, toMono(buffer));
      waveform.show(sampleId);
      projStatus(`Loaded ${file.name}.`);
    } catch (err) {
      projStatus(`${file.name}: ${err.message}`);
    }
  }
  refreshProjectUi();
});

$('add-sampler').addEventListener('click', () => {
  try {
    const id = addSamplerInstrument(project, $('new-inst-name').value.trim(), $('new-inst-sample').value);
    engine.loadInstrument(id, project.instruments[id].graph);
    sendSamples(id);
    addLaneFor(id);
    patcher.load({ instruments: project.instruments });
    refreshProjectUi();
    $('new-inst-name').value = '';
    projStatus(`Added ${id} with its own lane.`);
  } catch (err) {
    projStatus(err.message);
  }
});

for (const [kind, { label }] of Object.entries(synthKinds)) $('new-synth-kind').append(Object.assign(document.createElement('option'), { value: kind, textContent: label }));
$('add-synth').addEventListener('click', () => {
  try {
    const id = addSynthInstrument(project, $('new-synth-name').value.trim(), $('new-synth-kind').value);
    engine.loadInstrument(id, project.instruments[id].graph);
    addLaneFor(id);
    patcher.load({ instruments: project.instruments });
    refreshProjectUi();
    $('new-synth-name').value = '';
    projStatus(`Added ${id} with its own lane.`);
  } catch (err) {
    projStatus(err.message);
  }
});

$('add-lane').addEventListener('click', () => {
  try {
    const lane = addLaneFor(patcher.instrument);
    projStatus(`Added lane ${lane.id}.`);
  } catch (err) {
    projStatus(err.message);
  }
});
$('patch-add').addEventListener('click', () => menu.open(12, 24));

$('start').addEventListener('click', async () => {
  try {
    await engine.start();
    engine.onFault = id => projStatus(`Instrument "${id}" produced invalid audio and was reset. If you can repeat it, note what you changed.`);
    started = true;
    openProject(createDemoProject(engine.ctx.sampleRate));
    for (const id of ['start']) $(id).disabled = true;
    for (const id of ['play', 'save', 'load', 'patch-add', 'load-samples', 'add-sampler', 'add-synth', 'add-lane']) $(id).disabled = false;
    $('status').textContent =
      `Running at ${engine.ctx.sampleRate} Hz, base latency ${(engine.ctx.baseLatency * 1000).toFixed(1)} ms`;
    const frame = () => { songInfo(); seqView.draw(); view.draw(); patcher.draw(); waveform.draw(); requestAnimationFrame(frame); };
    frame();
  } catch (err) {
    $('status').textContent = err.message;
  }
});
