import { Engine } from './audio/engine.js';
import { createDemoProject } from './project/demo.js';
import { FILE_EXT, parseProject, serializeProject } from './project/file.js';
import { createEditor } from './seq/editor.js';
import { prepareSong } from './seq/lane.js';
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

// Loads a project into the running engine: { song, instruments, samples }.
function openProject({ song, instruments, samples }) {
  if (playing) setPlaying(false);
  engine.reset();
  for (const [id, def] of Object.entries(instruments)) {
    engine.loadInstrument(id, def.graph);
    for (const [node, sampleId] of Object.entries(def.samples ?? {})) {
      const { data, rate, loopStart, loopEnd } = samples[sampleId];
      engine.sendToNode(id, node, { type: 'sample', data: data.slice(), rate, loopStart, loopEnd });
    }
  }
  const lanes = prepareSong(song, instruments, engine.registry);
  engine.setSong(song);
  for (const { id, instrument, columns, pages } of lanes) engine.setLane({ id, instrument, columns, pages });
  project = { song, instruments, samples, lanes };
  const editor = createEditor(lanes, song.length);
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

$('start').addEventListener('click', async () => {
  try {
    await engine.start();
    started = true;
    openProject(createDemoProject(engine.ctx.sampleRate));
    for (const id of ['start']) $(id).disabled = true;
    for (const id of ['play', 'save', 'load']) $(id).disabled = false;
    $('status').textContent =
      `Running at ${engine.ctx.sampleRate} Hz, base latency ${(engine.ctx.baseLatency * 1000).toFixed(1)} ms`;
    const frame = () => { seqView.draw(); view.draw(); requestAnimationFrame(frame); };
    frame();
  } catch (err) {
    $('status').textContent = err.message;
  }
});
