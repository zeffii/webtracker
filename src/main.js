import { Engine } from './audio/engine.js';
import { NODE_TYPES } from './audio/nodes/index.js';
import { pruneDef } from './graph/edit.js';
import { createPatcher } from './graph/patcher.js';
import { createInsertMenu } from './graph/menu.js';
import { createDemoProject } from './project/demo.js';
import * as ops from './project/ops.js';
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
  $('inst-name').value = patcher.instrument ?? '';
  renderLaneList();
  syncPoly();
}

// The lanes of the song, beside the instruments; one is selected for the buttons under it.
let selectedLane = null;
function renderLaneList() {
  if (!project.lanes.some(l => l.id === selectedLane)) selectedLane = project.lanes[0]?.id ?? null;
  const buttons = project.lanes.map((lane, i) => {
    const b = document.createElement('button');
    b.textContent = `${lane.id} · ${lane.instrument}`;
    b.classList.toggle('active', lane.id === selectedLane);
    b.addEventListener('click', () => { selectedLane = lane.id; renderLaneList(); view.goto(i, 0); seqView.goto(i, 0); });
    return b;
  });
  $('lane-list').replaceChildren(...buttons);
  $('lane-name').value = selectedLane ?? '';
}

// Changing the shape of the project (names, order, copies, removals): stop, change it, and load the
// whole project again so the engine, the columns and the lists agree. Pattern undo history is lost.
function reshape(change, { instrument = patcher.instrument, lane = selectedLane } = {}) {
  try {
    if (playing) setPlaying(false);
    const result = change();
    const select = typeof result === 'object' && result !== null ? result : {};
    openProject(ops.projectData(project), { stay: true, instrument: select.instrument ?? instrument, lane: select.lane ?? lane });
    $('patch-status').textContent = select.message ?? '';
  } catch (err) {
    $('patch-status').textContent = err.message;
  }
}

// A button that asks twice: the first click arms it, a second within three seconds does it.
function confirmed(button, label, action) {
  let timer = null;
  button.addEventListener('click', () => {
    if (timer === null) {
      button.textContent = 'Really?';
      timer = setTimeout(() => { button.textContent = label; timer = null; }, 3000);
      return;
    }
    clearTimeout(timer); timer = null;
    button.textContent = label;
    action();
  });
}

$('inst-rename').addEventListener('click', () => {
  const id = patcher.instrument;
  if (id) reshape(() => { const next = ops.renameInstrument(project, id, $('inst-name').value); return { instrument: next, message: `Renamed to ${next}.` }; });
});
$('inst-name').addEventListener('keydown', e => { if (e.key === 'Enter') $('inst-rename').click(); e.stopPropagation(); });
$('inst-up').addEventListener('click', () => { const id = patcher.instrument; if (id) reshape(() => { ops.moveInstrument(project, id, -1); }); });
$('inst-down').addEventListener('click', () => { const id = patcher.instrument; if (id) reshape(() => { ops.moveInstrument(project, id, 1); }); });
$('inst-dup').addEventListener('click', () => {
  const id = patcher.instrument;
  if (id) reshape(() => { const next = ops.duplicateInstrument(project, id); return { instrument: next, message: `Copied to ${next}.` }; });
});
confirmed($('inst-remove'), 'Remove', () => { const id = patcher.instrument; if (id) reshape(() => { ops.removeInstrument(project, id); return { message: `Removed ${id}.` }; }); });

$('lane-rename').addEventListener('click', () => {
  const id = selectedLane;
  if (id) reshape(() => { const next = ops.renameLane(project, id, $('lane-name').value); return { lane: next, message: `Renamed to ${next}.` }; });
});
$('lane-name').addEventListener('keydown', e => { if (e.key === 'Enter') $('lane-rename').click(); e.stopPropagation(); });
$('lane-left').addEventListener('click', () => { const id = selectedLane; if (id) reshape(() => { ops.moveLane(project, id, -1); }); });
$('lane-right').addEventListener('click', () => { const id = selectedLane; if (id) reshape(() => { ops.moveLane(project, id, 1); }); });
$('lane-dup').addEventListener('click', () => {
  const id = selectedLane;
  if (id) reshape(() => { const copy = ops.duplicateLane(project, id); return { lane: copy.id, message: `Copied to ${copy.id}.` }; });
});
confirmed($('lane-remove'), 'Remove', () => { const id = selectedLane; if (id) reshape(() => { ops.removeLane(project, id); return { message: `Removed ${id}.` }; }); });

// The polyphony fields show the selected instrument's settings.
function syncPoly() {
  const def = project.instruments[patcher.instrument];
  $('inst-voices').value = def?.graph.voices ?? 1;
  $('inst-notecols').value = def?.noteColumns ?? 1;
}

// Polyphony: how many copies of the instrument play at once, and how many notes a row can hold.
for (const [id, field, max] of [['inst-voices', 'voices', 16], ['inst-notecols', 'noteColumns', 8]]) {
  $(id).addEventListener('change', () => {
    const def = project.instruments[patcher.instrument];
    if (!def) return;
    const n = Math.max(1, Math.min(max, Math.round(Number($(id).value)) || 1));
    if (field === 'voices') def.graph.voices = n; else def.noteColumns = n;
    reloadInstrument(patcher.instrument);
    syncPoly();   // not renderInstList: the list must stay put, or a click that blurs this field is lost
  });
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
function openProject({ song, instruments, samples }, { stay = false, instrument = null, lane = null } = {}) {
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
  if (instrument in instruments) patcher.show(instrument);
  selectedLane = lane;
  refreshProjectUi();
  seqView.load({ lanes, song, editor });
  view.load({ lanes, song, editor });
  const at = Math.max(0, lanes.findIndex(l => l.id === lane));
  view.goto(at, 0); seqView.goto(at, 0);
  bindings.forEach(apply);
  if (!stay) tabs.show('patterns');
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
    patcher.show(id);
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
    patcher.show(id);
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
    for (const id of ['play', 'save', 'load', 'patch-add', 'load-samples', 'add-sampler', 'add-synth', 'add-lane', 'inst-voices', 'inst-notecols', 'inst-name', 'inst-rename', 'inst-up', 'inst-down', 'inst-dup', 'inst-remove', 'lane-name', 'lane-rename', 'lane-left', 'lane-right', 'lane-dup', 'lane-remove']) $(id).disabled = false;
    $('status').textContent =
      `Running at ${engine.ctx.sampleRate} Hz, base latency ${(engine.ctx.baseLatency * 1000).toFixed(1)} ms`;
    const frame = () => { songInfo(); seqView.draw(); view.draw(); patcher.draw(); waveform.draw(); requestAnimationFrame(frame); };
    frame();
  } catch (err) {
    $('status').textContent = err.message;
  }
});
