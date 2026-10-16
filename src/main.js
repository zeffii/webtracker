import { Engine } from './audio/engine.js';
import { NODE_TYPES } from './audio/nodes/index.js';
import { pruneDef } from './graph/edit.js';
import { createPatcher } from './graph/patcher.js';
import { createInsertMenu } from './graph/menu.js';
import { createSynthwaveProject } from './project/synthwave.js';
import * as ops from './project/ops.js';
import * as presets from './project/presets.js';
import { LIBRARY_EXT, addToLibrary, importFromLibrary, newLibrary, parseLibrary, serializeLibrary } from './project/library.js';
import { addLane, addSample, addSamplerInstrument, addSynthInstrument, channelsOf, sampleMessage, slotsOf, syncSamplerStereo } from './project/ops.js';
import { synthKinds } from './instruments.js';
import { createSampleScreen } from './project/samplescreen.js';
import { createWaveformView } from './project/waveform.js';
import { createMarkerRegionView } from './project/markerregion.js';
import { FILE_EXT, INSTRUMENT_EXT, parseInstrument, parseProject, serializeInstrument, serializeProject } from './project/file.js';
import { createEditor } from './seq/editor.js';
import { prepareSong, rebuildInstrumentLanes } from './seq/lane.js';
import { createSequenceView } from './seq/seqview.js';
import { attachGrip } from './ui/grip.js';
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
// Panic: every sounding note stops, and held keyjazz keys are let go.
$('panic').addEventListener('click', e => { engine.panic(); patcher.releaseKeys(); e.currentTarget.blur(); });
$('play').addEventListener('click', e => { togglePlay(); e.currentTarget.blur(); });

// Full-screen panes. Switching with an F-key or a click focuses the pane's main element.
const tabs = createTabs({
  tabs: [
    { id: 'patterns', key: 'F2', el: $('pane-patterns'), button: $('tab-patterns'), focus: $('view') },
    { id: 'samples', key: 'F3', el: $('pane-samples'), button: $('tab-samples'), focus: $('smp') },
    { id: 'instruments', key: 'F4', el: $('pane-instruments'), button: $('tab-instruments'), focus: $('inst-list') },
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
  onNote: (instrument, note, on, vel = 1) => { if (!started) return; if (on) engine.noteOn(instrument, note, vel); else engine.noteOff(instrument, note); },
});
const seqView = createSequenceView({
  el: $('seq'), statusEl: $('seq-status'), listEl: $('seq-list'), transport: engine.transport, onToggle: togglePlay,
  onOpen: (lane, tick) => { view.goto(lane, tick); tabs.show('patterns'); },
  onMove: (lane, tick) => view.goto(lane, tick),
});

const patcher = createPatcher({
  onNote: (id, note, on) => { if (!started) return; if (on) engine.noteOn(id, note, 1); else engine.noteOff(id, note); },
  canvas: $('patch'), panel: $('patch-panel'), exposedPanel: $('exposed-panel'), onEscape: () => $('inst-list').focus(), statusEl: $('patch-status'), nodeTypes: NODE_TYPES,
  onStructure: id => reloadInstrument(id),
  onContext: ({ x, y }) => menu.open(x, y),
  onData: (id, node, msg) => engine.sendToNode(id, node, msg),
  getSampleIds: () => Object.keys(project.samples),
  onParam: (id, node, name, value) => {
    const address = `${id}.${node}.${name}`;
    if (engine.registry.slots.has(address)) engine.set(address, value);
  },
});

// The height of the graph area, the pattern editor and the arrangement: drag the bar under each (or Up/Down on it);
// the rest of the screen follows. The choices are remembered in this browser.
// The graph fills the space between the list and the shortcut panel.
if (globalThis.ResizeObserver) new ResizeObserver(() => { const w = $('patch-wrap').clientWidth; if (w > 0) patcher.fit(w - 2); }).observe($('patch-wrap'));
attachGrip({ grip: $('patch-grip'), key: 'webtracker.graphHeight', get: () => patcher.height, set: h => patcher.resize(h), step: 20, bigStep: 100, normal: 300 });
attachGrip({ grip: $('view-grip'), key: 'webtracker.patternRows', get: () => view.rows, set: n => view.setRows(n), unit: () => view.lineHeight(), step: 1, bigStep: 8, normal: 24 });
attachGrip({ grip: $('seq-grip'), key: 'webtracker.arrangementRows', get: () => seqView.rows, set: n => seqView.setRows(n), unit: () => 18, step: 1, bigStep: 8, normal: 24 });

// The floating insert menu lives over the patcher canvas.
const menu = createInsertMenu({ parent: $('patch-wrap'), nodeTypes: NODE_TYPES, onPick: (type, at) => patcher.add(type, at) });
$('patch').addEventListener('mousedown', () => menu.close());

const sendSample = (id, node) => {
  slotsOf(project.instruments[id].samples[node]).forEach((sampleId, slot) => {
    if (project.samples[sampleId]) engine.sendToNode(id, node, sampleMessage(project.samples[sampleId], slot));
  });
};
const loadInst = id => {
  syncSamplerStereo(project.instruments[id], project.samples);
  engine.loadInstrument(id, project.instruments[id].graph);
};
const sendSamples = id => { for (const node of Object.keys(project.instruments[id].samples ?? {})) sendSample(id, node); };

// Song name, tempo and position, shown in the header on every screen.
const songInfo = () => {
  if (!project) return;
  const { name, length } = project.song;
  const tick = Atomics.load(engine.transport, 0);
  $('song-info').textContent = `${name ?? 'untitled'} · row ${String(tick).padStart(2, '0')}/${length}`;
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
}

// Keys in the instrument list: Up/Down choose, Home/End jump, Enter goes to the graph.
$('inst-list').addEventListener('keydown', e => {
  if (!project || e.ctrlKey || e.altKey || e.metaKey) return;
  const ids = Object.keys(project.instruments), at = ids.indexOf(patcher.instrument);
  const go = to => { patcher.show(ids[Math.min(ids.length - 1, Math.max(0, to))]); renderInstList(); e.preventDefault(); };
  if (e.key === 'ArrowUp') go(at - 1);
  else if (e.key === 'ArrowDown') go(at + 1);
  else if (e.key === 'Home') go(0);
  else if (e.key === 'End') go(ids.length - 1);
  else if (e.key === 'Enter' || e.key === 'ArrowRight' || e.key === 'Tab' && !e.shiftKey) { $('patch').focus(); e.preventDefault(); }
});

// The narrow instrument list beside the patcher.
function renderInstList() {
  const buttons = Object.keys(project.instruments).map((id, i) => {
    const b = document.createElement('button');
    b.textContent = `${id === patcher.instrument ? '>' : ' '} ${String(i + 1).padStart(2, '0')} ${id}`;
    b.tabIndex = -1;
    b.classList.toggle('active', id === patcher.instrument);
    b.addEventListener('click', () => { patcher.show(id); renderInstList(); $('patch').focus(); });
    return b;
  });
  $('inst-list').replaceChildren(...buttons);
  $('inst-name').value = patcher.instrument ?? '';
  renderLaneList();
  renderPresetList();
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

// ---- presets ----
let selectedPreset = null;
function renderPresetList() {
  const def = project.instruments[patcher.instrument];
  const list = def?.presets ?? [];
  if (!list.some(p => p.id === selectedPreset)) selectedPreset = null;
  $('preset-list').replaceChildren(...list.map(p => {
    const b = document.createElement('button');
    b.textContent = `${p.id.toString(16).toUpperCase().padStart(2, '0')}  ${p.name}`;
    b.title = 'Click to recall it';
    b.classList.toggle('active', p.id === selectedPreset);
    b.addEventListener('click', () => recallPreset(p.id));
    return b;
  }));
  $('preset-name').value = list.find(p => p.id === selectedPreset)?.name ?? '';
}

// What the instrument sounds like now: the live value of every parameter.
const snapshotNow = (id, name) => presets.capturePreset(project.instruments[id], NODE_TYPES, (node, param) => {
  const address = `${id}.${node}.${param}`;
  return engine.registry.slots.has(address) ? engine.registry.get(address) : undefined;
}, name);

function recallPreset(presetId) {
  const id = patcher.instrument, def = project.instruments[id];
  if (!def) return;
  try {
    const { params, data } = presets.applyPreset(def, NODE_TYPES, presetId);
    for (const [node, name, value] of params) {
      const address = `${id}.${node}.${name}`;
      if (engine.registry.slots.has(address)) engine.set(address, value);
    }
    for (const [node, type, points] of data) engine.sendToNode(id, node, { type, points });
    selectedPreset = presetId;
    patcher.refreshPanel();
    renderPresetList();
    $('patch-status').textContent = `Recalled preset ${presetId.toString(16).toUpperCase().padStart(2, '0')}.`;
  } catch (err) {
    $('patch-status').textContent = err.message;
  }
}

// Changing the list of presets changes the Cmd column's table, so the lanes are rebuilt.
function presetsChanged(message) {
  refreshLanes(patcher.instrument);
  renderPresetList();
  $('patch-status').textContent = message;
}
$('preset-save').addEventListener('click', () => {
  const id = patcher.instrument;
  if (!id) return;
  selectedPreset = presets.addPreset(project.instruments[id], snapshotNow(id, $('preset-name').value.trim()));
  presetsChanged(`Saved preset ${selectedPreset.toString(16).toUpperCase().padStart(2, '0')}.`);
});
$('preset-over').addEventListener('click', () => {
  const id = patcher.instrument;
  if (!id || selectedPreset === null) { $('patch-status').textContent = 'Click a preset to select it first.'; return; }
  presets.overwritePreset(project.instruments[id], selectedPreset, snapshotNow(id, ''));
  presetsChanged('Replaced the preset with the current sound.');
});
$('preset-rename').addEventListener('click', () => {
  const id = patcher.instrument;
  if (!id || selectedPreset === null) { $('patch-status').textContent = 'Click a preset to select it first.'; return; }
  try { presets.renamePreset(project.instruments[id], selectedPreset, $('preset-name').value); presetsChanged('Renamed.'); } catch (err) { $('patch-status').textContent = err.message; }
});
$('preset-name').addEventListener('keydown', e => { if (e.key === 'Enter') $('preset-save').click(); e.stopPropagation(); });
confirmed($('preset-remove'), 'Remove', () => {
  const id = patcher.instrument;
  if (!id || selectedPreset === null) { $('patch-status').textContent = 'Click a preset to select it first.'; return; }
  presets.removePreset(project.instruments[id], selectedPreset);
  selectedPreset = null;
  presetsChanged('Removed the preset; the others keep their numbers.');
});

// ---- preset library (.wxpr) ----
let library = newLibrary(), libSelected = null;
function renderLibrary() {
  if (libSelected >= library.presets.length) libSelected = null;
  $('lib-list').replaceChildren(...library.presets.map((p, i) => {
    const b = document.createElement('button');
    b.textContent = p.machine ? `${p.name}  (${p.machine})` : p.name;
    b.classList.toggle('active', i === libSelected);
    b.addEventListener('click', () => { libSelected = i; renderLibrary(); });
    return b;
  }));
}
$('lib-load').addEventListener('click', () => $('lib-file').click());
$('lib-file').addEventListener('change', async e => {
  const [file] = e.target.files;
  e.target.value = '';
  if (!file) return;
  try {
    library = parseLibrary(await file.text());
    libSelected = null;
    renderLibrary();
    $('patch-status').textContent = `Opened ${file.name}: ${library.presets.length} presets.`;
  } catch (err) {
    $('patch-status').textContent = err.message;
  }
});
$('lib-add').addEventListener('click', () => {
  const id = patcher.instrument;
  if (!id || libSelected === null) { $('patch-status').textContent = 'Click a library preset first.'; return; }
  selectedPreset = importFromLibrary(project.instruments[id], library.presets[libSelected]);
  presetsChanged(`Added "${library.presets[libSelected].name}" to ${id}.`);
});
$('lib-save').addEventListener('click', () => {
  const id = patcher.instrument;
  if (!id) return;
  const count = addToLibrary(library, project.instruments[id], id, selectedPreset === null ? null : [selectedPreset]);
  if (!count) { $('patch-status').textContent = 'This instrument has no presets to save.'; return; }
  renderLibrary();
  download(`presets${LIBRARY_EXT}`, serializeLibrary(library));
  $('patch-status').textContent = `Saved ${count} to presets${LIBRARY_EXT} (${library.presets.length} in the library).`;
});

// ---- instrument files ----
$('inst-export').addEventListener('click', () => {
  const id = patcher.instrument;
  if (!id) return;
  download(`${id}${INSTRUMENT_EXT}`, serializeInstrument(project, id));
  $('patch-status').textContent = `Saved ${id}${INSTRUMENT_EXT}.`;
});
$('inst-import').addEventListener('click', () => $('inst-file').click());
$('inst-file').addEventListener('change', async e => {
  const [file] = e.target.files;
  e.target.value = '';
  if (!file) return;
  try {
    const parsed = parseInstrument(await file.text());
    reshape(() => { const id = ops.importInstrument(project, parsed); return { instrument: id, message: `Imported ${id}.` }; });
  } catch (err) {
    $('patch-status').textContent = err.message;
  }
});

// ---- tempo and swing ----
const songChanged = () => { engine.setSong(project.song); songInfo(); };
$('bpm').addEventListener('change', () => {
  project.song.bpm = Math.max(20, Math.min(400, Math.round(Number($('bpm').value)) || project.song.bpm));
  $('bpm').value = project.song.bpm;
  songChanged();
});
$('swing').addEventListener('change', () => {
  const pct = Math.max(50, Math.min(75, Math.round(Number($('swing').value)) || 50));
  project.song.swing = pct / 100;
  $('swing').value = pct;
  songChanged();
});
$('length').addEventListener('change', () => {
  const before = project.song.length;
  reshape(() => {
    try { const n = ops.setSongLength(project, $('length').value); return { message: `Song length ${n} ticks.` }; } catch (err) { $('length').value = before; throw err; }
  });
});
for (const id of ['length', 'bpm', 'swing']) $(id).addEventListener('keydown', e => e.stopPropagation());

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

// The waveform fills the width of the sample screen.
// The marker region view sits to its right, a sixteenth of its width.
if (globalThis.ResizeObserver) new ResizeObserver(() => {
  const total = $('wave-row').clientWidth - 8;
  if (total <= 0) return;
  const r = Math.max(24, Math.floor(total / 17));
  region.fit(r - 2);
  waveform.fit(total - r - 2);
}).observe($('wave-row'));
const sendLoop = users => users.forEach(({ instrument, node }) => sendSample(instrument, node));
const region = createMarkerRegionView({ canvas: $('region'), getSample: () => waveform.sample(), getActive: () => waveform.activeFrame() });
const waveform = createWaveformView({
  canvas: $('wave'), statusEl: $('proj-status'), getProject: () => project,
  onLoop: users => { sendLoop(users); auditionDirty = true; },
  onSlices: users => { sendLoop(users); auditionDirty = true; },
  onActiveSlice: i => sampleScreen.setActiveSlice(i),   // the screen redraws itself, so its numbers follow the markers
  onSelect: ({ from, to }) => sampleScreen.setSelection(from, to),
});

// Keyjazz in the sample screen: the sample on its own, through a hidden instrument that is just a sampler
// into the output, so only the sample's own volume, global volume and pan apply. The instrument lives in the
// engine only, never in the project, and is rebuilt when the project is loaded or the sample changes shape.
const AUDITION = '__audition';
let audition = null, auditionDirty = true;   // { id, stereo } of what is loaded; whether the engine needs the sample again
const prepareAudition = id => {
  const s = project.samples[id];
  if (!audition || audition.id !== id || audition.stereo !== !!s.right) {
    const def = { graph: { nodes: [{ id: 'sampler', type: 'sampler' }, { id: 'out', type: 'out', params: { gain: 0.45 } }], connections: [['sampler.out', 'out.in']] }, samples: { sampler: id } };
    syncSamplerStereo(def, project.samples);
    engine.loadInstrument(AUDITION, def.graph);
    audition = { id, stereo: !!s.right };
    auditionDirty = true;
  }
  if (auditionDirty) { engine.sendToNode(AUDITION, 'sampler', sampleMessage(s)); auditionDirty = false; }
};
const playSample = (id, note, on) => {
  if (!started || !(id in project.samples)) return;
  if (on) { prepareAudition(id); engine.noteOn(AUDITION, note, 1, { choke: true }); }   // a new note fades the old one, loop or not else if (audition) engine.noteOff(AUDITION, note);
};
const sampleScreen = createSampleScreen({
  el: $('smp'), statusEl: $('proj-status'), getProject: () => project,
  onChange: users => { sendLoop(users); auditionDirty = true; },   // loops, levels and edits change what the sample plays
  onSelect: id => { waveform.show(id); auditionDirty = true; },
  onRemove: refreshProjectUi,
  onRename: () => { refreshProjectUi(); patcher.show(patcher.instrument); },
  onNote: playSample,
  onSelection: (from, to) => waveform.setSelection(from, to),
  onSlice: i => waveform.setActiveSlice(i),
  onLoad: () => $('sample-file').click(),
  onView: mode => waveform.setMode(mode),
});

// A new empty lane for an instrument that is already loaded in the engine.
function addLaneFor(instrumentId) {
  const lane = addLane(project, engine.registry, instrumentId);
  engine.setLane({ id: lane.id, instrument: lane.instrument, columns: lane.columns, pages: lane.pages, mask: lane.mask });
  project.editor.clear();
  view.relayout();
  return lane;
}

// The columns of an instrument's lanes need rebuilding (its exposed parameters or presets changed).
// Cells follow their column; undo history is cleared.
function refreshLanes(id) {
  for (const { id: laneId, instrument, columns, pages, mask } of rebuildInstrumentLanes(project.lanes, project.song, project.instruments, engine.registry, id)) {
    engine.setLane({ id: laneId, instrument, columns, pages, mask });
  }
  project.editor.clear();
  view.relayout();
}

// The wiring or the exposed parameters of an instrument changed: recompile it, swap it in,
// and rebuild the columns of its lanes. Cells follow their column; undo history is cleared.
function reloadInstrument(id) {
  try {
    const def = project.instruments[id];
    pruneDef(def, NODE_TYPES);
    loadInst(id);
    sendSamples(id);
    refreshLanes(id);
    bindings.forEach(apply);
  } catch (err) {
    $('patch-status').textContent = err.message;
  }
}

// Loads a project into the running engine: { song, instruments, samples }.
function openProject({ song, instruments, samples }, { stay = false, instrument = null, lane = null } = {}) {
  if (playing) setPlaying(false);
  engine.reset();
  audition = null;
  sampleScreen.history.clear();
  project = { song, instruments, samples, lanes: [], editor: null };
  for (const id of Object.keys(instruments)) {
    loadInst(id);
    sendSamples(id);
  }
  const lanes = prepareSong(song, instruments, engine.registry);
  engine.setSong(song);
  for (const { id, instrument, columns, pages, mask } of lanes) engine.setLane({ id, instrument, columns, pages, mask });
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
  $('length').value = song.length;
  $('bpm').value = song.bpm;
  $('swing').value = Math.round((song.swing ?? 0.5) * 100);
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
      const sampleId = (({ data, right }) => addSample(project, file.name, buffer.sampleRate, data, right))(channelsOf(buffer));
      sampleScreen.select(sampleId);
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
    loadInst(id);
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
    loadInst(id);
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
    openProject(createSynthwaveProject());
    for (const id of ['start']) $(id).disabled = true;
    for (const id of ['play', 'panic', 'save', 'load', 'patch-add', 'load-samples', 'add-sampler', 'add-synth', 'add-lane', 'inst-voices', 'inst-notecols', 'inst-name', 'inst-rename', 'inst-up', 'inst-down', 'inst-dup', 'inst-remove', 'lane-name', 'lane-rename', 'lane-left', 'lane-right', 'lane-dup', 'lane-remove', 'length', 'bpm', 'swing', 'preset-name', 'preset-save', 'preset-over', 'preset-rename', 'preset-remove', 'inst-export', 'inst-import', 'lib-load', 'lib-add', 'lib-save']) $(id).disabled = false;
    $('status').textContent =
      `Running at ${engine.ctx.sampleRate} Hz, base latency ${(engine.ctx.baseLatency * 1000).toFixed(1)} ms`;
    const frame = () => { songInfo(); seqView.draw(); view.draw(); patcher.draw(); sampleScreen.draw(); waveform.draw(); region.draw(); requestAnimationFrame(frame); };
    frame();
  } catch (err) {
    $('status').textContent = err.message;
  }
});
