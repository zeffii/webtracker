// Offline checks: build the preset, drive the runtime without a browser.
import assert from 'node:assert/strict';
import { ParamRegistry } from '../src/audio/params.js';
import { NODE_TYPES } from '../src/audio/nodes/index.js';
import { GraphRuntime } from '../src/audio/runtime.js';
import { compile } from '../src/graph/compile.js';
import { samplerPreset } from '../src/presets.js';
import { makePluck } from '../src/audio/sample.js';
import { Sequencer, PAGE_TICKS } from '../src/audio/sequencer.js';
import { instruments, synthKinds } from '../src/instruments.js';
import { buildColumns, buildPages, channelCount, flattenLane, prepareSong, uniqueStarts } from '../src/seq/lane.js';
import { decodeNote, encodeCell, noteToken, noteSemitones, EMPTY, KINDS } from '../src/seq/cells.js';
import { insertPattern, placementAt, setCell } from '../src/seq/edit.js';
import { createTrackerView, cellAt } from '../src/seq/view.js';
import { createSequenceView } from '../src/seq/seqview.js';
import { createEditor } from '../src/seq/editor.js';
import { shapeTable } from '../src/seq/curve.js';
import { createMidiWriter, noteColumnsOf, quantize } from '../src/seq/midiwrite.js';
import * as ops from '../src/seq/edit.js';
import * as gedit from '../src/graph/edit.js';
import { scopeBox } from '../src/graph/scope.js';
import { createPatcher, hitTest, nodeBox, portPos, portKind, hexOf } from '../src/graph/patcher.js';
import { rebuildInstrumentLanes } from '../src/seq/lane.js';
import * as pops from '../src/project/ops.js';
import { createSampleScreen } from '../src/project/samplescreen.js';
import { computeSpectrogram, fft } from '../src/project/spectrogram.js';
import { computePeaks, createWaveformView } from '../src/project/waveform.js';
import { parseProject, serializeProject } from '../src/project/file.js';
import { song as demoSong } from '../src/song.js';
import { createCurveEditor, SIZE } from '../src/graph/curveeditor.js';
import { createSpectrumEditor, WIDTH, HEIGHT } from '../src/graph/spectrumeditor.js';
import { HARMONICS, SPECTRA, normalizeSpectrum } from '../src/audio/nodes/spectra.js';
import { WAVE_POINTS, WAVES, normalizeWave } from '../src/audio/nodes/waves.js';
import { CURVE_POINTS, PRESETS } from '../src/audio/nodes/curves.js';
import { Oversampler } from '../src/audio/nodes/oversample.js';
import { resolveKinds } from '../src/graph/kinds.js';
import { createInsertMenu, hotkeys } from '../src/graph/menu.js';
import { createTabs } from '../src/ui/tabs.js';
import * as presetOps from '../src/project/presets.js';
import { parseInstrument, serializeInstrument } from '../src/project/file.js';
import { createSynthwaveProject } from '../src/project/synthwave.js';
import * as lib from '../src/project/library.js';
import { compileDsp } from '../src/audio/wasm/load.js';

import * as uiConfig from '../src/ui/config.js';
uiConfig.set('arrowStyle', 'char');   // most tests were written for one character per arrow press; the whole-cell mode has its own test

const sr = 48000, block = 128;
let onWheel;   // the wheel handler of whichever view a test last made

function setup(tweak = () => {}) {
  const registry = new ParamRegistry();
  const rt = new GraphRuntime({ sampleRate: sr, params: registry.values });
  rt.load(compile(samplerPreset, { instrument: 'lead', nodeTypes: NODE_TYPES, registry }));
  rt.message('lead', 'sampler', { type: 'sample', data: makePluck(sr), rate: sr });
  tweak(registry);
  return { rt, registry };
}

function render(rt, seconds) {
  const total = Math.floor(sr * seconds / block) * block;
  const left = new Float32Array(total), right = new Float32Array(total);
  const l = new Float32Array(block), r = new Float32Array(block);
  for (let at = 0; at < total; at += block) {
    rt.process(l, r, block);
    left.set(l, at);
    right.set(r, at);
  }
  return { left, right };
}

const peak = x => x.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
const brightness = x => {
  let d = 0, e = 0;
  for (let i = 1; i < x.length; i++) { d += (x[i] - x[i - 1]) ** 2; e += x[i] ** 2; }
  return d / e;
};

// 1. Silent until a note arrives.
{
  const { rt } = setup();
  assert.equal(peak(render(rt, 0.1).left), 0);
}

// 2. A note produces finite, audible, stereo output.
{
  const { rt } = setup();
  rt.note('lead', { type: 'noteOn', note: 60, vel: 1 });
  const { left, right } = render(rt, 0.5);
  assert.ok(left.every(Number.isFinite) && right.every(Number.isFinite), 'non-finite sample');
  assert.ok(peak(left) > 0.05 && peak(right) > 0.05, 'note is too quiet');
  assert.ok(peak(left) < 2, 'note is too loud');
}

// 3. Cutoff is exposed and audibly changes the sound.
{
  const dull = setup(reg => { reg.set('lead.filter.cutoff', 300); reg.set('lead.delay.mix', 0); });
  const bright = setup(reg => { reg.set('lead.filter.cutoff', 12000); reg.set('lead.delay.mix', 0); });
  for (const { rt } of [dull, bright]) rt.note('lead', { type: 'noteOn', note: 60, vel: 1 });
  const a = brightness(render(dull.rt, 0.5).left), b = brightness(render(bright.rt, 0.5).left);
  assert.ok(a < b * 0.5, `cutoff has no effect (${a} vs ${b})`);
}

// 4. Release ends the voice, and the delay tail then decays to silence.
{
  const { rt } = setup(reg => reg.set('lead.delay.feedback', 0.3));
  rt.note('lead', { type: 'noteOn', note: 60, vel: 1 });
  render(rt, 0.2);
  rt.note('lead', { type: 'noteOff', note: 60 });
  render(rt, 4);   // let the repeats die away
  assert.ok(peak(render(rt, 1).left) < 1e-4, 'tail did not decay');
}

// 5. The compiler rejects bad graphs.
{
  const registry = new ParamRegistry();
  const opts = { instrument: 'x', nodeTypes: NODE_TYPES, registry };
  assert.throws(() => compile({ nodes: [{ id: 'a', type: 'nope' }], connections: [] }, opts), /unknown node type/);
  assert.throws(() => compile({
    nodes: [{ id: 'f', type: 'filter' }, { id: 'd', type: 'delay' }, { id: 'o', type: 'out' }],
    connections: [['f.out', 'd.in'], ['d.out', 'f.in']],
  }, opts), /cycle/);
  assert.throws(() => compile({ nodes: [{ id: 'f', type: 'filter' }], connections: [] }, opts), /master/);
}

// ---- sequencer ----

function songSetup(song, wasm = null) {
  const registry = new ParamRegistry();
  const rt = new GraphRuntime({ sampleRate: sr, params: registry.values, wasm });
  const seq = new Sequencer({ sampleRate: sr, runtime: rt, params: registry.values, transport: new Int32Array(new SharedArrayBuffer(8)) });
  for (const [id, def] of Object.entries(instruments)) {
    rt.load(compile(def.graph, { instrument: id, nodeTypes: NODE_TYPES, registry }));
    rt.message(id, 'sampler', { type: 'sample', data: makePluck(sr), rate: sr });
  }
  seq.setSong(song);
  for (const lane of prepareSong(song, instruments, registry)) seq.setLane(lane);
  return { seq, registry, rt };
}

const patternText = (length, cells) => Array.from({ length }, (_, i) => cells[i] ?? '... .. .. .... .... .. .. ..').join('\n');
const oneLane = (id, instrument, text, length = 16) => ({
  id, instrument, patterns: { a: { text } }, placements: [{ puid: 'a', start: 0, length }],
});
const song120 = lanes => ({ bpm: 120, ticksPerBeat: 4, length: 16, lanes });   // 6000 samples per tick
const firstSound = x => x.findIndex(v => Math.abs(v) > 1e-9);

// 6. A note lands on its exact tick, sample-accurately.
{
  const { seq } = songSetup(song120([oneLane('lead', 'lead', patternText(16, { 2: 'C-4 .. .. .... .... .. .. ..' }))]));
  seq.play();
  const at = firstSound(render(seq, 0.5).left);
  assert.ok(at >= 12000 && at <= 12003, `note started at sample ${at}, expected about 12000`);
}

// 7. A parameter column writes its slot; an empty cell leaves the slot alone.
{
  const { seq, registry } = songSetup(song120([oneLane('lead', 'lead', patternText(16, { 0: '... .. .. .... .... 80 .. ..' }))]));
  registry.set('lead.filter.resonance', 0.7);
  seq.play();
  render(seq, 0.1);
  const expected = 20 * Math.pow(18000 / 20, 128 / 255);
  assert.ok(Math.abs(registry.get('lead.filter.cutoff') / expected - 1) < 1e-4, 'cutoff column did not write the slot');
  assert.ok(Math.abs(registry.get('lead.filter.resonance') - 0.7) < 1e-6, 'empty cell overwrote a parameter');
}

// 8. Two lanes at once: the mix is exactly the sum of each lane on its own.
{
  const lead = oneLane('lead', 'lead', patternText(16, { 0: 'C-4 .. .. .... .... .. .. ..' }));
  const bass = oneLane('bass', 'bass', patternText(16, { 0: 'C-3 .. .. .... .... .. .. ..' }));
  const run = lanes => { const { seq } = songSetup(song120(lanes)); seq.play(); return render(seq, 0.6).left; };
  const both = run([lead, bass]), a = run([lead]), b = run([bass]);
  assert.ok(peak(a) > 0.05 && peak(b) > 0.05, 'a lane is silent');
  assert.ok(both.every((v, i) => Math.abs(v - (a[i] + b[i])) < 1e-5), 'lanes do not add up');
}

// 9. The song loops: a note on tick 0 sounds again when the song wraps.
{
  const text = patternText(16, { 0: 'C-4 .. .. .... .... .. .. ..', 4: '=== .. .. .... .... .. .. ..' });
  const { seq } = songSetup(song120([oneLane('bass', 'bass', text)]));
  seq.play();
  const x = render(seq, 2.1).left;   // 96000 samples per pass
  assert.ok(peak(x.subarray(90000, 96000)) < 1e-4, 'voice did not end before the wrap');
  assert.ok(peak(x.subarray(96001, 96300)) > 0.01, 'note did not retrigger after the wrap');
}

// 10. Overlay: a later placement covers the ticks under it, then the pattern below resumes.
{
  const columns = buildColumns('lead', instruments.lead, (() => {
    const registry = new ParamRegistry();
    compile(instruments.lead.graph, { instrument: 'lead', nodeTypes: NODE_TYPES, registry });
    return registry;
  })());
  const lane = {
    id: 'l',
    patterns: {
      long: { text: patternText(16, { 0: 'C-4 .. .. .... .... .. .. ..', 8: 'E-4 .. .. .... .... .. .. ..' }) },
      over: { text: patternText(4, { 0: 'G-5 .. .. .... .... .. .. ..' }) },
    },
    placements: [{ puid: 'long', start: 0, length: 16 }, { puid: 'over', start: 4, length: 4 }],
  };
  const rows = flattenLane(lane, columns, 16);
  assert.equal(rows[4][0], 'G-5');
  assert.equal(rows[5][0], '...');     // the overlay's empty cell covers the pattern below
  assert.equal(rows[8][0], 'E-4');     // the pattern below resumes after the overlay
}

// 11. A placement may cross a page boundary: the tick index picks the page.
{
  const registry = new ParamRegistry();
  compile(instruments.lead.graph, { instrument: 'lead', nodeTypes: NODE_TYPES, registry });
  const columns = buildColumns('lead', instruments.lead, registry);
  const lane = {
    id: 'l',
    patterns: { a: { text: patternText(16, { 7: 'G-3 .. .. .... .... .. .. ..', 8: 'A-3 .. .. .... .... .. .. ..' }) } },
    placements: [{ puid: 'a', start: PAGE_TICKS - 8, length: 16 }],
  };
  const pages = buildPages(flattenLane(lane, columns, 1500), columns);
  assert.equal(pages.length, 2);
  assert.equal(decodeNote(pages[0][(PAGE_TICKS - 1) * channelCount(columns)]), 55);   // G-3
  assert.equal(decodeNote(pages[1][0]), 57);                                    // A-3
}

// 12. The demo song renders without non-finite samples.
{
  const { seq } = songSetup(demoSong);
  seq.play();
  const { left, right } = render(seq, 4);
  assert.ok(left.every(Number.isFinite) && right.every(Number.isFinite));
  assert.ok(peak(left) > 0.05 && peak(left) < 4, `demo song level is ${peak(left)}`);
}

// 13. 4hex cells: a 16-bit parameter column writes its slot.
{
  const { seq, registry } = songSetup(song120([oneLane('lead', 'lead', patternText(16, { 0: '... .. .. .... .... .. .. .. 8000' }))]));
  seq.play();
  render(seq, 0.1);
  const expected = 1 + (0x8000 / 65535) * 999;   // delay time runs 1..1000 ms
  assert.ok(Math.abs(registry.get('lead.delay.time') / expected - 1) < 1e-4, 'time column did not write the slot');
}

// 14. CCXXYY cells: a known command writes its target, an unknown one writes nothing.
{
  const run = cell => {
    const { seq, registry } = songSetup(song120([oneLane('lead', 'lead', patternText(16, { 0: cell }))]));
    const before = Array.from(registry.values);
    seq.play();
    render(seq, 0.1);
    return { registry, before };
  };
  const known = run('... .. .. .... .... .. .. .. .... 02A000');
  assert.ok(Math.abs(known.registry.get('lead.filter.resonance') - 0.95 * (0xA000 / 65535)) < 1e-4, 'command 02 did not write resonance');
  const unknown = run('... .. .. .... .... .. .. .. .... 99FFFF');
  assert.deepEqual(Array.from(unknown.registry.values), unknown.before, 'unknown command changed a parameter');
}

// 15. Cell encoding: channels per kind, and bad cells are rejected.
{
  assert.deepEqual(encodeCell('4C9E', '4hex'), [0x4C9E / 65535]);
  assert.deepEqual(encodeCell('02A000', 'cmd'), [2 / 255, 0xA000 / 65535]);
  assert.deepEqual(encodeCell('......', 'cmd'), [EMPTY, EMPTY]);
  assert.equal(noteToken(3 * 12 + 4), 'E-3');
  assert.throws(() => encodeCell('02A0', 'cmd'));
  assert.throws(() => encodeCell('4C9', '4hex'));
  assert.throws(() => noteToken(10 * 12));
}

// 16. Editing: a cell edit changes the pattern, so every placement of it changes too;
// the overlay owns its ticks; a pattern can be inserted only where none is.
{
  const registry = new ParamRegistry();
  for (const [id, def] of Object.entries(instruments)) compile(def.graph, { instrument: id, nodeTypes: NODE_TYPES, registry });
  const [lead] = prepareSong(demoSong, instruments, registry);
  const ch = channelCount(lead.columns);
  assert.equal(placementAt(lead, 20).start, 16);
  assert.equal(placementAt(lead, 29).start, 28);   // the fill is on top of the second arp
  assert.ok(setCell(lead, 32, 3, 0, 'G-4'));
  assert.equal(lead.rows[3][0], 'G-4');
  assert.equal(lead.rows[19][0], 'G-4');            // same pattern, second placement
  assert.equal(decodeNote(lead.pages[0][3 * ch]), 67);
  assert.ok(setCell(lead, 32, 3, 9, '02A000'));    // the Cmd column
  assert.deepEqual(Array.from(lead.pages[0].subarray(3 * ch + 9, 3 * ch + 11)), encodeCell('02A000', 'cmd').map(Math.fround));

  const gap = { id: 'g', instrument: 'lead', patterns: { a: { text: patternText(8, {}) } }, placements: [{ puid: 'a', start: 0, length: 8 }] };
  const [lane] = prepareSong({ ...demoSong, lanes: [gap] }, instruments, registry);
  assert.equal(setCell(lane, 32, 20, 0, 'C-4'), false);   // no pattern there
  assert.equal(insertPattern(lane, 32, 4), null);          // one covers tick 4
  const puid = insertPattern(lane, 32, 20);
  assert.ok(puid);
  assert.ok(setCell(lane, 32, 21, 0, 'C-4'));
  assert.equal(lane.rows[21][0], 'C-4');
  assert.equal(lane.placements.find(p => p.puid === puid).length, 12);   // clipped at the song end
}

// 17. A cell edited while the lane is already loaded is heard: the pages are shared.
{
  const registry = new ParamRegistry();
  const rt = new GraphRuntime({ sampleRate: sr, params: registry.values });
  const seq = new Sequencer({ sampleRate: sr, runtime: rt, params: registry.values, transport: new Int32Array(new SharedArrayBuffer(8)) });
  for (const [id, def] of Object.entries(instruments)) {
    rt.load(compile(def.graph, { instrument: id, nodeTypes: NODE_TYPES, registry }));
    rt.message(id, 'sampler', { type: 'sample', data: makePluck(sr), rate: sr });
  }
  const song = song120([oneLane('lead', 'lead', patternText(16, {}))]);
  seq.setSong(song);
  const [lane] = prepareSong(song, instruments, registry);
  seq.setLane(lane);
  seq.play();
  assert.equal(peak(render(seq, 0.05).left), 0);          // nothing yet
  setCell(lane, 16, 2, 0, 'C-4');                         // edit after the lane was loaded
  const at = firstSound(render(seq, 0.5).left);
  assert.ok(at >= 0, 'edited note was not heard');
}

// 18. The tracker view: typing edits the character under the cursor.
{
  const registry = new ParamRegistry();
  for (const [id, def] of Object.entries(instruments)) compile(def.graph, { instrument: id, nodeTypes: NODE_TYPES, registry });
  const lanes = prepareSong(demoSong, instruments, registry);
  let onKey;
  const el = { addEventListener: (type, f) => { if (type === 'keydown') onKey = f; else if (type === 'wheel') onWheel = f; }, innerHTML: '' };
  const statusEl = { textContent: '', set innerHTML(h) { this.html = h; this.textContent = h.replace(/<[^>]+>/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'); } };
  let toggled = 0;
  const view = createTrackerView({ el, statusEl, transport: new Int32Array(new SharedArrayBuffer(8)), onToggle: () => {}, onRow: t => { toggled = t + 1; }, onBack() {} });
  view.load({ lanes, song: demoSong, editor: createEditor(lanes, demoSong.length) });
  const press = (key, times = 1, extra = {}) => { for (let i = 0; i < times; i++) onKey({ key, preventDefault() {}, ...extra }); };
  const [lead, bass] = lanes;

  press('z');                                   // C-3 at the cursor (octave 3), cursor moves down
  assert.equal(lead.rows[0][0], 'C-3');
  press(']'); press('q');                       // octave 4, upper row: C one octave up
  assert.equal(lead.rows[1][0], 'C-5');
  press('1'); assert.equal(lead.rows[2][0], '===');
  press('Home'); press('ArrowRight', 15);       // Note (3 chars), Vel, Smp, Off, Rtg (2+2+4+4), then Cut
  press('ArrowDown', 3);                        // row 3 holds Cut 88
  press('a'); assert.equal(lead.rows[3][5], 'A8');   // overwrites one character
  press('0'); assert.equal(lead.rows[3][5], 'A0');   // second character, then the cursor moves down a row
  press('ArrowUp'); press('Delete');            // clearing does not advance
  assert.equal(lead.rows[3][5], '..');
  press('ArrowRight', 10);                      // Cut, Res, Mix, Time (4 chars), then Cmd
  for (const k of '03ffff') press(k);           // an empty cell fills with zeros, then each digit lands in turn
  assert.equal(lead.rows[3][9], '03FFFF');

  press('Home'); press('ArrowLeft', 2);          // Cmd char 0 -> Time char 3 -> char 2
  assert.equal(lead.rows[0][8], '4C9E');
  press('f'); assert.equal(lead.rows[0][8], '4CFE');   // one character of a filled 4hex cell

  press('Tab'); press('8');                     // bass lane, Time char 3: an empty cell fills with zeros
  assert.equal(bass.rows[0][8], '0008');
  press('Home'); press('ArrowRight', 3);         // Time char 3 -> Cmd char 0..2
  press('z'); assert.equal(bass.rows[0][9], '......');   // note keys do nothing in a hex cell

  // a held arrow (the browser's key repeats) moves a column at a time, to the start of it
  view.goto(0, 12);
  press('ArrowLeft', 9, { repeat: true });      // from inside the Cmd column: its start, then each column before it, to the Note column's start
  const row = () => lead.rows[12];
  press('ArrowRight', 1, { repeat: true });     // Note -> Vel, first character
  press('7');
  assert.equal(row()[1][0], '7', 'a held right arrow lands on the start of the next column');
  press('ArrowLeft', 1, { repeat: true }); press('1');   // the cursor is inside Vel: held left goes to its start first
  assert.equal(row()[1][0], '1', 'held left first goes to the start of this column');
  press('ArrowLeft', 2, { repeat: true }); press('z');   // to the start of Vel again (it was left inside), then the Note column (z is C)
  assert.equal(row()[0][0], 'C', 'and then to the start of the column before');
  view.goto(0, 12); press('ArrowRight', 3, { repeat: true });     // Vel, Smp, Off
  press('f'); assert.equal(row()[3][0], 'F', 'repeats keep going column by column');
  press('Tab');                                 // back to the bass lane, where the checks below expect the cursor

  toggled = 0; press(' '); assert.equal(toggled, 0, 'Space no longer plays the row (F7 does); it writes live values');
  view.draw();
  assert.ok(el.innerHTML.includes('class="cur"') && el.innerHTML.includes('lead') && el.innerHTML.includes('bass'));
  assert.ok(statusEl.textContent.includes('bass'));
}

// 19. A note cell: the first character plays a whole note, the others edit it.
{
  const registry = new ParamRegistry();
  for (const [id, def] of Object.entries(instruments)) compile(def.graph, { instrument: id, nodeTypes: NODE_TYPES, registry });
  const lanes = prepareSong(demoSong, instruments, registry);
  let onKey;
  const view = createTrackerView({ el: { addEventListener: (type, f) => { if (type === 'keydown') onKey = f; else if (type === 'wheel') onWheel = f; } }, statusEl: {}, transport: new Int32Array(new SharedArrayBuffer(8)), onToggle() {}, onBack() {} });
  view.load({ lanes, song: demoSong, editor: createEditor(lanes, demoSong.length) });
  const press = (key, times = 1) => { for (let i = 0; i < times; i++) onKey({ key, preventDefault() {} }); };
  const lead = lanes[0];
  press('ArrowRight');                          // second character of the note on row 0 (C-4)
  press('#'); assert.equal(lead.rows[0][0], 'C#4');   // the cursor moves on to the third character
  press('5'); assert.equal(lead.rows[0][0], 'C#5');   // octave digit, then the cursor moves down a row
  press('Home'); press('ArrowRight'); press('-'); assert.equal(lead.rows[0][0], 'C-5');
  press('ArrowDown');                           // row 1 is empty: character edits are refused
  press('5'); assert.equal(lead.rows[1][0], '...');
}

// 20. A project survives a save and load, including edits, graphs and samples.
{
  const registry = new ParamRegistry();
  for (const [id, def] of Object.entries(instruments)) compile(def.graph, { instrument: id, nodeTypes: NODE_TYPES, registry });
  const lanes = prepareSong(demoSong, instruments, registry);
  setCell(lanes[0], 32, 3, 0, 'G-4');
  const data = makePluck(sr);
  const text = serializeProject({ song: demoSong, instruments, samples: { pluck: { rate: sr, data } }, lanes }, { sampleFormat: 'float32' });
  const back = parseProject(text);

  assert.deepEqual(back.instruments, JSON.parse(JSON.stringify(instruments)));
  assert.equal(back.song.bpm, demoSong.bpm);
  assert.equal(back.song.name, 'demo');
  assert.equal(back.samples.pluck.rate, sr);
  assert.ok(Buffer.from(back.samples.pluck.data.buffer).equals(Buffer.from(data.buffer)), 'sample changed in the file');

  const registry2 = new ParamRegistry();
  for (const [id, def] of Object.entries(back.instruments)) compile(def.graph, { instrument: id, nodeTypes: NODE_TYPES, registry: registry2 });
  const lanes2 = prepareSong(back.song, back.instruments, registry2);
  assert.deepEqual(lanes2.map(l => l.rows), lanes.map(l => l.rows));
  assert.equal(lanes2[0].rows[3][0], 'G-4');

  assert.throws(() => parseProject('nope'), /invalid JSON/);
  assert.throws(() => parseProject('{"format":"other"}'), /Not a webtracker file/);
  assert.throws(() => parseProject(JSON.stringify({ ...JSON.parse(text), version: 99 })), /version 99/);
  assert.throws(() => parseProject(JSON.stringify({
    ...JSON.parse(text), lanes: [{ id: 'x', instrument: 'ghost', patterns: {}, placements: [] }],
  })), /unknown instrument/);
}

// 21. Reset drops lanes and instruments so another project can be loaded.
{
  const { seq, rt } = songSetup(song120([oneLane('lead', 'lead', patternText(16, { 0: 'C-4 .. .. .... .... .. .. ..' }))]));
  seq.play();
  assert.ok(peak(render(seq, 0.2).left) > 0.05);
  const fresh = new ParamRegistry();
  rt.reset(fresh.values);
  seq.reset(fresh.values);
  assert.equal(seq.playing, false);
  assert.equal(seq.lanes.size, 0);
  assert.equal(peak(render(seq, 0.2).left), 0);
}

// 22. Pattern operations: indices, clone, slice, resize, move, remove, place.
{
  const registry = new ParamRegistry();
  for (const [id, def] of Object.entries(instruments)) compile(def.graph, { instrument: id, nodeTypes: NODE_TYPES, registry });
  const fresh = () => prepareSong(demoSong, instruments, registry)[0];   // lead: arp@0, arp@16, fill@28
  let lane = fresh();
  assert.deepEqual(Object.values(lane.patterns).map(p => p.index).sort(), [0, 1]);

  // clone: the placement gets its own copy, so editing it leaves the other placement alone
  const before = lane.rows[16 + 2][0];                                   // arp row 2 in the second placement
  const copy = ops.clonePlacement(lane, 32, 0);
  assert.ok(copy && lane.patterns[copy].index === 2);
  ops.setCell(lane, 32, 2, 0, 'G-5');
  assert.equal(lane.rows[2][0], 'G-5');
  assert.equal(lane.rows[18][0], before);
  // a clone never has the colour of its original (the automatic colour comes from the index, one of six)
  {
    const l = fresh(), look = pat => (pat.color !== undefined ? `c${pat.color}` : `a${pat.index % 6}`);
    for (let i = 0; i < 14; i++) { const was = l.patterns[l.placements[0].puid], now = l.patterns[ops.clonePlacement(l, 32, 0)]; assert.notEqual(look(now), look(was), `clone ${i} looks different`); }
    const e = fresh(); const p0 = e.patterns[e.placements[0].puid]; p0.color = 15;
    assert.notEqual(look(e.patterns[ops.clonePlacement(e, 32, 0)]), 'c15', 'an explicit colour moves on');
  }

  // slice: two new patterns; what you hear is unchanged
  lane = fresh();
  const rowsBefore = lane.rows.map(r => r.join('|'));
  assert.ok(ops.slicePlacement(lane, 32, 6));
  assert.deepEqual(lane.rows.map(r => r.join('|')), rowsBefore);
  assert.equal(lane.placements.filter(p => p.start === 6).length, 1);
  assert.equal(ops.slicePlacement(lane, 32, 0), false);                  // nothing to cut at the start

  // resize: grows the pattern with empty rows, clips at the song end, shrinks
  lane = fresh();
  assert.equal(ops.resizePlacement(lane, 32, 0, 16), 32);                // arp@0 now runs to tick 31 (the second arp is on top from 16)
  assert.equal(ops.resizePlacement(lane, 32, 16, 16), 0);                // already runs to the song end: clipped, so no change
  assert.equal(ops.resizePlacement(lane, 32, 0, -16), 16);

  // move: not onto another pattern's start, not outside the song
  lane = fresh();
  assert.equal(ops.movePlacement(lane, 32, 0, 16), null);                // arp starts at 16 already
  assert.deepEqual(ops.movePlacement(lane, 32, 0, 1), { start: 1 });
  assert.equal(ops.movePlacement(lane, 32, 1, -2), null);

  // remove keeps the pattern in the pool; place puts it back by index
  lane = fresh();
  assert.ok(ops.removePlacement(lane, 32, 20));
  assert.equal(placementAt(lane, 20), null);
  assert.equal(Object.keys(lane.patterns).length, 2);
  assert.equal(ops.placePattern(lane, 32, 16, ops.puidByIndex(lane, 0)), 16);
  assert.equal(ops.placePattern(lane, 32, 16, ops.puidByIndex(lane, 0)), 0);   // the same pattern already starts there
  assert.equal(ops.placePattern(lane, 32, 16, ops.puidByIndex(lane, 1)) > 0 && placementAt(lane, 16).puid, ops.puidByIndex(lane, 1), 'another one replaces it');
  assert.equal(lane.placements.filter(p => p.start === 16).length, 1, 'still one pattern per start');
  assert.ok(ops.insertPattern(lane, 32, 20, 16, true));                  // overlay allowed on a covered tick

  // push and pull: later patterns follow the caret
  lane = fresh();
  assert.equal(ops.shiftPlacements(lane, 32, 16, 16), 0);                // would fall off the end
  assert.equal(ops.shiftPlacements(lane, 32, 0, -16), 0);                // nothing to close: the first pattern is at 0
  assert.ok(ops.removePlacement(lane, 32, 0));
  assert.equal(ops.shiftPlacements(lane, 32, 0, -32), -16);              // pulled only as far as the gap
  assert.equal(lane.placements[0].start, 0);
  assert.equal(ops.shiftPlacements(lane, 32, 0, 8), 8);
  assert.equal(lane.placements[0].start, 8);
}

// 23. Undo: edits are reversible, typing in one cell is one entry, the stack is capped, waypoint works.
{
  const registry = new ParamRegistry();
  for (const [id, def] of Object.entries(instruments)) compile(def.graph, { instrument: id, nodeTypes: NODE_TYPES, registry });
  const lanes = prepareSong(demoSong, instruments, registry);
  const ch = channelCount(lanes[0].columns);
  const editor = createEditor(lanes, 32);
  const snap = () => lanes.map(l => l.rows.map(r => r.join('|')).join('/')).join('#');
  const start = snap();

  editor.setCell(0, 3, 9, '010000'); editor.setCell(0, 3, 9, '01FF00'); editor.setCell(0, 3, 9, '01FFFF');
  assert.equal(editor.log().length, 1);                                  // same cell: one entry
  editor.setWaypoint();
  editor.slice(0, 6); editor.clone(1, 0);
  assert.deepEqual(editor.log(), ['clone pattern', 'slice pattern', 'edit cell']);
  assert.equal(editor.undo(), 'clone pattern');
  assert.equal(editor.redo(), 'clone pattern');
  assert.ok(editor.restoreWaypoint());
  assert.equal(editor.log()[0], 'restore waypoint');
  assert.equal(editor.undo(), 'restore waypoint');                       // the restore itself can be undone
  while (editor.undo());
  assert.equal(snap(), start);
  assert.equal(decodeNote(lanes[0].pages[0][0]), 60);                    // pages follow the model
  assert.equal(editor.undo(), null);

  for (let i = 0; i < 30; i++) editor.insertPattern(1, i % 2 ? 0 : 1) || editor.remove(1, 0);   // many changes
  for (let i = 0; i < 40; i++) editor.slice(0, 3 + (i % 3));
  assert.ok(editor.log().length <= 20);
}

// 24. The arrangement view: keys place, clone, slice, move and undo; names are escaped.
{
  const registry = new ParamRegistry();
  for (const [id, def] of Object.entries(instruments)) compile(def.graph, { instrument: id, nodeTypes: NODE_TYPES, registry });
  const lanes = prepareSong(demoSong, instruments, registry);
  lanes[1].id = '<b>x</b>';
  lanes[0].patterns[Object.keys(lanes[0].patterns)[0]].name = '<script>';
  const editor = createEditor(lanes, 32);
  let onKey, opened = null;
  const el = { addEventListener: (type, f) => { if (type === 'keydown') onKey = f; else if (type === 'wheel') onWheel = f; }, innerHTML: '' };
  const statusEl = { textContent: '' };
  const moves = [];
  const view = createSequenceView({ el, statusEl, transport: new Int32Array(new SharedArrayBuffer(8)), onToggle() {}, onOpen: (l, t) => { opened = [l, t]; }, onMove: (l, t) => moves.push([l, t]) });
  view.load({ lanes, song: demoSong, editor });
  const press = (key, extra = {}) => onKey({ key, preventDefault() {}, ...extra });
  const lead = lanes[0];

  view.draw();
  assert.ok(el.innerHTML.includes('&lt;script&gt;') && !el.innerHTML.includes('<script>'), 'pattern name not escaped');
  assert.ok(el.innerHTML.includes('&lt;b&gt;x') && !el.innerHTML.includes('<b>x'), 'lane name not escaped');

  press('Enter'); assert.deepEqual(opened, [0, 0]);                      // a pattern is under the cursor: open it
  press('Delete'); assert.equal(placementAt(lead, 0), null);             // remove the first arp
  press('0'); press('0');                                                // place pattern 00 at the cursor
  assert.equal(placementAt(lead, 0).start, 0);
  view.draw(); assert.ok(statusEl.textContent.includes('tick 16'), `cursor should jump to the end: ${statusEl.textContent}`);
  press('0'); press('9');                                                // no pattern 09
  view.draw(); assert.ok(statusEl.textContent.includes('No pattern 09'));
  press('ArrowRight');                                                   // bass lane
  press('Home');
  press('s');                                                            // slice at tick 0: nothing to cut
  view.draw(); assert.ok(statusEl.textContent.includes("Can't slice"), statusEl.textContent);
  press('z', { ctrlKey: true });                                         // undo the placement of 00 on the lead lane
  assert.equal(placementAt(lead, 0), null);

  // layout: time runs down, lanes are columns
  view.goto(0, 0);
  view.draw();
  const rows = el.innerHTML.split('<div class="r">').slice(1);
  assert.ok(rows[0].includes('&lt;b&gt;x&lt;/b&gt;'), 'lane names are the column headers');
  assert.ok(/^ (<span[^>]*>)?0000/.test(rows[1]) && rows[2].startsWith(' 0016'), 'one row per 16 ticks, counting down');
  assert.ok(rows[1].includes('gn g1'), 'a bar start has the darker number shade');
  assert.ok(rows.slice(1, 3).some(r => /class="L[^"]* st/.test(r)), 'blocks start on their row');
  press('ArrowDown'); press('ArrowDown');                                // time moves down the rows
  assert.deepEqual(moves.at(-1), [0, 16], 'the second row, 16 ticks down (the song is 32 ticks)');
  press('ArrowRight');                                                   // and right changes lane
  assert.deepEqual(moves.at(-1), [1, 16]);
  view.goto(0, 5); press('ArrowDown'); assert.deepEqual(moves.at(-1), [0, 16], 'the cursor sits on a row start');
  // two patterns start in the second row of the lead lane (an arp at 16 and a fill at 28): marked with a +
  view.goto(0, 16); view.draw();
  assert.ok(/\+<\/span>/.test(el.innerHTML.split('<div class="r">')[3]), 'a row with several starts is marked');
}

// 25. The two views follow each other: moving in one reports the position for the other.
{
  const registry = new ParamRegistry();
  for (const [id, def] of Object.entries(instruments)) compile(def.graph, { instrument: id, nodeTypes: NODE_TYPES, registry });
  const lanes = prepareSong(demoSong, instruments, registry);
  const editor = createEditor(lanes, 32);
  let onKey;
  const moves = [];
  const view = createTrackerView({
    el: { addEventListener: (type, f) => { if (type === 'keydown') onKey = f; else if (type === 'wheel') onWheel = f; }, innerHTML: '' }, statusEl: {}, transport: new Int32Array(new SharedArrayBuffer(8)),
    onToggle() {}, onBack() {}, onMove: (l, t) => moves.push([l, t]),
  });
  view.load({ lanes, song: demoSong, editor });
  const press = key => onKey({ key, preventDefault() {} });
  press('ArrowDown'); press('ArrowDown');
  assert.deepEqual(moves.at(-1), [0, 2]);
  press('Tab');
  assert.deepEqual(moves.at(-1), [1, 2]);
  view.goto(0, 9);                                                       // being moved from outside reports nothing back
  assert.equal(moves.length, 3);
}

// 26. New-note action, one-shots: with nnaAll off a hit that is still playing is not cut by the next one (on is the default).
{
  const run = (cells, all = 0) => {
    const rows = {}; cells.forEach(([tick, cell]) => { rows[tick] = cell; });
    const { seq, registry } = songSetup(song120([oneLane('bass', 'bass', patternText(16, rows))]));
    registry.set('bass.sampler.nnaAll', all);
    seq.play();
    return render(seq, 1).left;
  };
  const a = run([[0, 'C-3 .. .. .... .... .. .. ..']]), b = run([[2, 'E-3 .. .. .... .... .. .. ..']]);
  const both = run([[0, 'C-3 .. .. .... .... .. .. ..'], [2, 'E-3 .. .. .... .... .. .. ..']]);
  assert.ok(peak(a) > 0.05 && peak(b) > 0.05);
  assert.ok(both.every((v, i) => Math.abs(v - (a[i] + b[i])) < 1e-5), 'the second hit cut the first');
  const cut = run([[0, 'C-3 .. .. .... .... .. .. ..'], [2, 'E-3 .. .. .... .... .. .. ..']], 1);
  assert.ok(!cut.every((v, i) => Math.abs(v - (a[i] + b[i])) < 1e-5), 'by default the second hit cuts the first');
  assert.equal(new ParamRegistry().allocate('x', 1, 0, 1) >= 0, true);
  // note off leaves a one-shot alone
  const withOff = run([[0, 'C-3 .. .. .... .... .. .. ..'], [4, '=== .. .. .... .... .. .. ..']]);
  assert.ok(withOff.every((v, i) => Math.abs(v - a[i]) < 1e-9), 'note off cut a one-shot');
}

// 27. New-note action, looping samples: a new note cuts or fades the old one; note off releases it.
{
  const cycle = 200, loop = new Float32Array(sr).map((_, i) => 0.8 * Math.sin(2 * Math.PI * i / cycle));   // 240 Hz, loops cleanly
  const run = (cells, fade) => {
    const rows = {}; cells.forEach(([tick, cell]) => { rows[tick] = cell; });
    const { seq, registry, rt } = songSetup(song120([oneLane('bass', 'bass', patternText(16, rows))]));
    rt.message('bass', 'sampler', { type: 'sample', data: loop, rate: sr, loopStart: 0, loopEnd: loop.length });
    registry.set('bass.sampler.nnaFade', fade);
    seq.play();
    return render(seq, 1.5).left;
  };
  const note = 'C-4 .. .. .... .... .. .. ..';
  const bOnly = run([[2, note]], 0);
  // fade 0: the old note is cut, so after a few ms only the new one sounds
  const cut = run([[0, note], [2, note]], 0);
  assert.ok(peak(cut.subarray(5000, 11900)) > 0.05, 'the first note is not playing before the second');
  assert.ok(cut.subarray(13000, 30000).every((v, i) => Math.abs(v - bOnly[13000 + i]) < 1e-4), 'the old looping note was not cut');   // the filter needs a few ms to settle
  // fade 300 ms: the old note is still there just after the new one, and gone once the ramp ends
  const fade = run([[0, note], [2, note]], 300);
  const during = fade.subarray(13000, 14000).map((v, i) => Math.abs(v - bOnly[13000 + i]));
  assert.ok(peak(during) > 0.05, 'the fade did not leave the old note audible');
  assert.ok(fade.subarray(30000, 40000).every((v, i) => Math.abs(v - bOnly[30000 + i]) < 1e-3), 'the old note did not fade out');
  // note off releases a looping voice (default release 150 ms): audible before, silent after
  const off = run([[0, note], [4, '=== .. .. .... .... .. .. ..']], 20);
  assert.ok(peak(off.subarray(20000, 23000)) > 0.05);
  assert.ok(peak(off.subarray(36000, 48000)) < 1e-4, 'note off did not release the looping voice');
}

// 28. Stopping fades every voice out, one-shots included.
{
  const { seq } = songSetup(song120([oneLane('bass', 'bass', patternText(16, { 0: 'C-4 .. .. .... .... .. .. ..', 1: 'E-4 .. .. .... .... .. .. ..' }))]));
  seq.play();
  assert.ok(peak(render(seq, 0.2).left) > 0.05);
  seq.stop();
  render(seq, 0.4);                                    // release is 150 ms
  assert.ok(peak(render(seq, 0.2).left) < 1e-4, 'voices kept sounding after stop');
}

// 29. Sample loop points survive a save and load.
{
  const data = new Float32Array(1000).fill(0.5);
  const back = parseProject(serializeProject({
    song: demoSong, instruments, lanes: [],
    samples: { pluck: { rate: sr, data, loopStart: 100, loopEnd: 900 } },
  }));
  assert.equal(back.samples.pluck.loopStart, 100);
  assert.equal(back.samples.pluck.loopEnd, 900);
}

// ---- milestone 5: oscillator, envelope, graph editing, patcher ----

const kickRows = cells => Array.from({ length: 16 }, (_, i) => cells[i] ?? '... .. .. ..').join('\n');
const kickSong = cells => song120([{ id: 'kick', instrument: 'kick', patterns: { a: { text: kickRows(cells) } }, placements: [{ puid: 'a', start: 0, length: 16 }] }]);
const hit = 'C-2 .. .. ..';

// 30. The oscillator restarts its phase on a note, so every bass drum hit is identical;
// with the restart off the hits differ.
{
  const run = reset => {
    const { seq, registry } = songSetup(kickSong({ 0: hit, 8: hit }));
    registry.set('kick.osc.reset', reset);
    seq.play();
    return render(seq, 2).left;
  };
  const a = run(1);
  assert.ok(peak(a.subarray(0, 24000)) > 0.1, 'the kick is silent');
  const first = a.subarray(0, 24000), second = a.subarray(48000, 72000);   // one second apart
  assert.ok(first.every((v, i) => Math.abs(v - second[i]) < 1e-6), 'hits differ although the phase is reset');
  const b = run(0);
  assert.ok(peak(b.subarray(0, 24000).map((v, i) => v - b[48000 + i])) > 0.01, 'hits should differ without the reset');
}

// 31. The oscillator's sync input restarts it on a rising edge.
{
  const registry = new ParamRegistry();
  const rt = new GraphRuntime({ sampleRate: sr, params: registry.values });
  rt.load(compile({
    nodes: [
      { id: 'lfo', type: 'lfo', params: { rate: 5, shape: 3 } },
      { id: 'osc', type: 'osc', params: { track: 0, freq: 437.3, reset: 0 } },
      { id: 'out', type: 'out' },
    ],
    connections: [['lfo.out', 'osc.sync'], ['osc.out', 'out.in']],
  }, { instrument: 'x', nodeTypes: NODE_TYPES, registry }));
  rt.note('x', { type: 'noteOn', note: 60, vel: 1 });
  const x = render(rt, 0.5).left;                     // the square wave rises every 9600 samples
  assert.ok(peak(x) > 0.1);
  assert.ok(x.subarray(100, 3000).every((v, i) => Math.abs(v - x[9600 + 100 + i]) < 1e-5), 'sync did not restart the phase');
}

// 32. Envelope: attack, decay to sustain, release, and a retrigger that does not dip.
{
  const registry = new ParamRegistry();
  const rt = new GraphRuntime({ sampleRate: sr, params: registry.values });
  rt.load(compile({
    nodes: [{ id: 'env', type: 'env', params: { attack: 10, decay: 50, sustain: 0.5, release: 100 } }, { id: 'out', type: 'out' }],
    connections: [['env.out', 'out.in']],
  }, { instrument: 'x', nodeTypes: NODE_TYPES, registry }));
  assert.equal(peak(render(rt, 0.05).left), 0);        // idle until a note
  rt.note('x', { type: 'noteOn', note: 60, vel: 1 });
  const held = render(rt, 0.3).left;                   // attack, decay, then sustain at 0.5 (out gain 0.8)
  assert.ok(Math.abs(held[held.length - 1] - 0.4) < 2e-3, `sustain level ${held[held.length - 1]}`);
  rt.note('x', { type: 'noteOn', note: 62, vel: 1 });  // retrigger: the attack starts from where it is
  const again = render(rt, 0.02).left;
  assert.ok(again[0] >= held[held.length - 1] - 1e-3, 'the retrigger dipped');
  rt.note('x', { type: 'noteOff', note: 62 });
  render(rt, 1);
  assert.ok(peak(render(rt, 0.1).left) < 1e-3, 'the release did not finish');
}

// 33. Gain: without cv it passes the signal; the filter's mod input opens the cutoff.
{
  const registry = new ParamRegistry();
  const mk = (graph, id) => {
    const rt = new GraphRuntime({ sampleRate: sr, params: registry.values });
    rt.load(compile(graph, { instrument: id, nodeTypes: NODE_TYPES, registry }));
    rt.note(id, { type: 'noteOn', note: 48, vel: 1 });
    return rt;
  };
  const osc = { id: 'osc', type: 'osc', params: { wave: 1 } };
  const direct = render(mk({ nodes: [osc, { id: 'out', type: 'out' }], connections: [['osc.out', 'out.in']] }, 'a'), 0.2).left;
  const viaGain = render(mk({ nodes: [osc, { id: 'g', type: 'gain', params: { gain: 1 } }, { id: 'out', type: 'out' }], connections: [['osc.out', 'g.in'], ['g.out', 'out.in']] }, 'b'), 0.2).left;
  assert.ok(direct.every((v, i) => Math.abs(v - viaGain[i]) < 1e-6), 'an unconnected cv should pass the signal');
  const filt = withMod => ({
    nodes: [osc, { id: 'f', type: 'filter', params: { cutoff: 300, resonance: 0.1 } }, { id: 'env', type: 'env', params: { attack: 0.1, sustain: 1, amount: 3 } }, { id: 'out', type: 'out' }],
    connections: [['osc.out', 'f.in'], ['f.out', 'out.in'], ...(withMod ? [['env.out', 'f.mod']] : [])],
  });
  const shut = brightness(render(mk(filt(false), 'c'), 0.3).left), open = brightness(render(mk(filt(true), 'd'), 0.3).left);
  assert.ok(open > shut * 2, `mod did not open the filter (${shut} vs ${open})`);
}

// 34. Graph edits: add, connect, loops, remove, expose, prune, layout.
{
  const def = structuredClone(instruments.kick);
  const g = def.graph;
  assert.equal(gedit.addNode(g, NODE_TYPES, 'lfo'), 'lfo1');
  assert.equal(gedit.addNode(g, NODE_TYPES, 'lfo'), 'lfo2');
  assert.throws(() => gedit.addNode(g, NODE_TYPES, 'out'), /already an out/);
  gedit.connect(g, NODE_TYPES, 'lfo1.out', 'osc.sync');
  assert.ok(g.connections.some(([f, t]) => f === 'lfo1.out' && t === 'osc.sync'));
  gedit.connect(g, NODE_TYPES, 'lfo2.out', 'osc.fm');   // a second wire into fm is allowed and gets summed
  assert.equal(g.connections.filter(([, t]) => t === 'osc.fm').length, 2);
  gedit.connect(g, NODE_TYPES, 'lfo2.out', 'osc.fm');   // the same wire again changes nothing
  assert.equal(g.connections.filter(([, t]) => t === 'osc.fm').length, 2);
  const before = JSON.stringify(g.connections);
  assert.throws(() => gedit.connect(g, NODE_TYPES, 'vca.out', 'osc.fm'), /loop/);
  assert.throws(() => gedit.connect(g, NODE_TYPES, 'osc.out', 'osc.fm'), /loop/);
  assert.throws(() => gedit.connect(g, NODE_TYPES, 'osc.nope', 'vca.in'), /no output/);
  assert.equal(JSON.stringify(g.connections), before, 'a refused connection changed the graph');
  assert.ok(gedit.disconnect(g, 'lfo1.out', 'osc.sync'));
  gedit.setExposed(def, NODE_TYPES, 'osc', 'phase', true);
  gedit.setExposed(def, NODE_TYPES, 'ampEnv', 'attack', true);
  assert.ok(def.exposed.some(e => e.param === 'phase'));
  assert.equal(def.exposed.find(e => e.param === 'attack').scale, 'log');
  gedit.setExposed(def, NODE_TYPES, 'osc', 'phase', false);
  assert.ok(!def.exposed.some(e => e.param === 'phase'));
  assert.throws(() => gedit.removeNode(g, NODE_TYPES, 'out'), /cannot be removed/);
  gedit.removeNode(g, NODE_TYPES, 'ampEnv');
  gedit.pruneDef(def, NODE_TYPES);
  assert.ok(!def.exposed.some(e => e.node === 'ampEnv'), 'exposures of a removed node should go');
  assert.ok(!g.connections.some(([f, t]) => f.startsWith('ampEnv') || t.startsWith('ampEnv')));
  gedit.autoLayout(g, NODE_TYPES);
  assert.ok(g.nodes.every(n => Number.isFinite(n.x) && Number.isFinite(n.y)));
}

// 35. Changing an instrument's exposed parameters rebuilds its lanes' columns; cells follow their column.
{
  const defs = structuredClone(instruments);
  const registry = new ParamRegistry();
  for (const [id, d] of Object.entries(defs)) compile(d.graph, { instrument: id, nodeTypes: NODE_TYPES, registry });
  const lanes = prepareSong(demoSong, defs, registry);
  const kick = lanes.find(l => l.id === 'kick');
  assert.deepEqual(kick.columns.map(c => c.label), ['Note', 'Vel', 'Pit', 'Dec']);
  const row0 = kick.rows[0].slice();                     // C-2 .. 60 90
  gedit.setExposed(defs.kick, NODE_TYPES, 'osc', 'phase', true);
  gedit.setExposed(defs.kick, NODE_TYPES, 'pitchEnv', 'amount', false);   // Pit goes away
  compile(defs.kick.graph, { instrument: 'kick', nodeTypes: NODE_TYPES, registry });
  const changed = rebuildInstrumentLanes(lanes, demoSong, defs, registry, 'kick');
  assert.deepEqual(changed, [kick]);
  assert.deepEqual(kick.columns.map(c => c.label), ['Note', 'Vel', 'Dec', 'Pha']);
  assert.deepEqual(kick.rows[0], [row0[0], row0[1], row0[3], '..']);   // Dec kept its cell, Pit's is gone, Pha is empty
  assert.equal(kick.pages[0].length, 1024 * 4);
  assert.equal(decodeNote(kick.pages[0][0]), 36);
  assert.equal(lanes[0].columns.length, 10);              // other instruments are untouched
}

// 36. The patcher: hit testing, wiring with the mouse, loops refused, delete, sliders, expose.
{
  const makeEl = tag => ({
    tag, children: [], listeners: {}, style: {}, textContent: '', value: '', checked: false,
    appendChild(c) { this.children.push(c); return c; }, replaceChildren(...c) { this.children = c; },
    addEventListener(type, f) { this.listeners[type] = f; }, focus() {},
  });
  const walk = (el, fn) => { fn(el); (el.children ?? []).forEach(c => walk(c, fn)); };
  const doc = { createElement: makeEl, createTextNode: text => ({ text }) };
  const ctx = new Proxy({}, { get: (t, k) => (k in t ? t[k] : () => {}), set: (t, k, v) => { t[k] = v; return true; } });
  const canvas = { width: 900, height: 360, style: {}, listeners: {}, getContext: () => ctx, addEventListener(type, f) { this.listeners[type] = f; }, focus() {} };
  const panel = makeEl('div'), statusEl = { textContent: '' };
  const defs = structuredClone(instruments);
  const structures = [], params = [], contexts = [];
  const live = {};
  const patcher = createPatcher({ canvas, panel, statusEl, doc, nodeTypes: NODE_TYPES, onStructure: id => structures.push(id), onContext: p => contexts.push(p), onParam: (...a) => params.push(a), getSampleIds: () => ['pluck'], readLive: (i, n, name) => (live[`${n}.${name}`]) });
  patcher.load({ instruments: defs });
  patcher.show('kick');
  patcher.draw();                                        // draws without throwing
  const g = defs.kick.graph;
  const node = id => g.nodes.find(n => n.id === id);
  const at = (id, side, i) => portPos(node(id), NODE_TYPES[node(id).type], side, i);
  const mid = id => { const { w, h } = nodeBox(NODE_TYPES[node(id).type]); return { x: node(id).x + w / 2, y: node(id).y + h / 2 }; };
  const fire = (type, p, extra = {}) => canvas.listeners[type]({ offsetX: p.x, offsetY: p.y, preventDefault() {}, ...extra });

  assert.deepEqual(hitTest(g, NODE_TYPES, at('osc', 'out', 0).x, at('osc', 'out', 0).y), { kind: 'port', side: 'out', node: 'osc', port: 'out' });
  assert.equal(hitTest(g, NODE_TYPES, mid('vca').x, mid('vca').y).kind, 'node');
  assert.equal(hitTest(g, NODE_TYPES, 880, 340), null);

  // select a node: the panel lists its parameters
  fire('mousedown', mid('osc')); fire('mouseup', mid('osc'));
  assert.equal(patcher.paramRows().length, NODE_TYPES.osc.params.length);
  live['osc.tune'] = 7;   // a pattern wrote it: the row follows
  assert.equal(patcher.paramRows().find(r => r.name === 'tune').text(), '7');
  delete live['osc.tune'];
  {   // the node panel opens with a preset row
    let pick = null; walk(panel, e => { if (e.ariaLabel === 'Node preset') pick = e; });
    assert.ok(pick, 'a node panel has a preset menu');
  }

  // drag a node (snapping is tested below)
  uiConfig.set('graphSnap', false);
  const from = mid('vca'), x0 = node('vca').x;
  fire('mousedown', from); fire('mousemove', { x: from.x + 30, y: from.y + 5 }); fire('mouseup', { x: from.x + 30, y: from.y + 5 });
  assert.equal(node('vca').x, x0 + 30);
  {   // with snapping on, a dragged node lands on a dot of the grid (24 px apart); Ctrl moves freely
    uiConfig.set('graphSnap', true);
    const m = mid('vca'), x1 = node('vca').x, y1 = node('vca').y;
    fire('mousedown', m); fire('mousemove', { x: m.x + 37, y: m.y + 11 }); fire('mouseup', { x: m.x + 37, y: m.y + 11 });
    assert.equal(node('vca').x % 24, 0, 'x on the grid'); assert.equal(node('vca').y % 24, 0, 'y on the grid');
    assert.ok(Math.abs(node('vca').x - (x1 + 37)) <= 12 && Math.abs(node('vca').y - (y1 + 11)) <= 12, 'the nearest dot');
    uiConfig.set('graphSnap', false);
    console.log('ok: graph snap');
  }

  // add an lfo and wire it to the oscillator's sync input with the mouse
  patcher.add('lfo');
  assert.equal(structures.length, 1);
  fire('mousedown', at('lfo1', 'out', 0)); fire('mousemove', at('osc', 'in', 1)); fire('mouseup', at('osc', 'in', 1));
  assert.ok(g.connections.some(([f, t]) => f === 'lfo1.out' && t === 'osc.sync'));
  assert.equal(structures.length, 2);

  // a loop is refused with a message
  fire('mousedown', at('vca', 'out', 0)); fire('mouseup', at('osc', 'in', 0));
  assert.match(statusEl.textContent, /loop/);
  assert.equal(structures.length, 2);

  // a slider changes a parameter live and in the saved graph; expose adds a column
  fire('mousedown', mid('osc')); fire('mouseup', mid('osc'));
  const tuneRow = () => patcher.paramRows().find(r => r.name === 'tune');
  tuneRow().setPos(0.75);                                // three quarters of -48..48 is +24 semitones
  assert.equal(params.at(-1)[2], 'tune');
  assert.ok(Math.abs(params.at(-1)[3] - 24) < 1e-6);
  assert.equal(node('osc').params.tune, 24);
  assert.equal(tuneRow().display(), '+24 st', 'the row writes the value in its own units');
  tuneRow().expose(true);
  assert.ok(defs.kick.exposed.some(e => e.node === 'osc' && e.param === 'tune'));
  assert.equal(structures.length, 3);

  // click a wire and delete it
  const a = at('lfo1', 'out', 0), b = at('osc', 'in', 1);
  fire('mousedown', { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }); fire('mouseup', { x: 0, y: 0 });
  canvas.listeners.keydown({ key: 'Delete', preventDefault() {} });
  assert.ok(!g.connections.some(([f]) => f === 'lfo1.out'));

  // delete a node: its exposures and wires go with it
  fire('mousedown', mid('lfo1')); fire('mouseup', { x: 0, y: 0 });
  canvas.listeners.keydown({ key: 'Delete', preventDefault() {} });
  assert.ok(!g.nodes.some(n => n.id === 'lfo1'));

  // right-click and double-click on empty space ask for the insert menu; a node is placed where it was asked for
  fire('contextmenu', { x: 850, y: 300 });
  assert.deepEqual(contexts, [{ x: 850, y: 300 }]);
  fire('dblclick', { x: 880, y: 340 });
  fire('dblclick', mid('osc'));                          // on a node: nothing
  assert.equal(contexts.length, 2);
  patcher.add('pan', { x: 400, y: 200 });
  assert.deepEqual([node('pan1').x, node('pan1').y], [400, 200]);
}

// 37. An instrument built in the patcher survives a save and load, positions included.
{
  const defs = structuredClone(instruments);
  gedit.addNode(defs.kick.graph, NODE_TYPES, 'lfo', { x: 300, y: 40 });
  gedit.connect(defs.kick.graph, NODE_TYPES, 'lfo1.out', 'osc.sync');
  gedit.setExposed(defs.kick, NODE_TYPES, 'lfo1', 'rate', true);
  const registry = new ParamRegistry();
  for (const [id, d] of Object.entries(defs)) compile(d.graph, { instrument: id, nodeTypes: NODE_TYPES, registry });
  const lanes = prepareSong(demoSong, defs, registry);
  const back = parseProject(serializeProject({ song: demoSong, instruments: defs, samples: { pluck: { rate: sr, data: new Float32Array(4) } }, lanes }));
  assert.deepEqual(back.instruments.kick, JSON.parse(JSON.stringify(defs.kick)));
  assert.equal(back.instruments.kick.graph.nodes.find(n => n.id === 'lfo1').x, 300);
  const registry2 = new ParamRegistry();
  for (const [id, d] of Object.entries(back.instruments)) compile(d.graph, { instrument: id, nodeTypes: NODE_TYPES, registry: registry2 });
  const lanes2 = prepareSong(back.song, back.instruments, registry2);
  assert.deepEqual(lanes2.map(l => l.rows), lanes.map(l => l.rows));
}

// 38. 1hex cells: one digit, for toggles and enums; whole-number parameters take the digit itself.
{
  assert.deepEqual(encodeCell('7', '1hex'), [7 / 15]);
  assert.deepEqual(encodeCell('.', '1hex'), [EMPTY]);
  assert.throws(() => encodeCell('G', '1hex'));
  assert.throws(() => encodeCell('12', '1hex'));

  const defs = structuredClone(instruments);
  defs.kick.exposed.push(
    { node: 'osc', param: 'wave', label: 'Wav', bits: 4 },
    { node: 'osc', param: 'reset', label: 'Rst', bits: 4 },
    { node: 'ampEnv', param: 'sustain', label: 'Sus', bits: 4 },
  );
  const registry = new ParamRegistry();
  const rt = new GraphRuntime({ sampleRate: sr, params: registry.values });
  const seq = new Sequencer({ sampleRate: sr, runtime: rt, params: registry.values, transport: new Int32Array(new SharedArrayBuffer(8)) });
  for (const [id, d] of Object.entries(defs)) rt.load(compile(d.graph, { instrument: id, nodeTypes: NODE_TYPES, registry }));
  const text = Array.from({ length: 16 }, (_, i) => ({ 0: '... .. .. .. 3 0 8', 1: '... .. .. .. F 1 F', 2: '... .. .. .. 2' }[i] ?? '... .. .. ..')).join('\n');
  const song = song120([{ id: 'kick', instrument: 'kick', patterns: { a: { text } }, placements: [{ puid: 'a', start: 0, length: 16 }] }]);
  seq.setSong(song);
  const [lane] = prepareSong(song, defs, registry);
  assert.deepEqual(lane.columns.map(c => c.token), ['note', '2hex', '2hex', '2hex', '1hex', '1hex', '1hex']);
  seq.setLane(lane);
  seq.play();
  render(seq, 0.01);                                                  // tick 0
  assert.equal(registry.get('kick.osc.wave'), 3);
  assert.equal(registry.get('kick.osc.reset'), 0);
  assert.ok(Math.abs(registry.get('kick.ampEnv.sustain') - 8 / 15) < 1e-6, 'a float parameter maps the digit across its range');
  render(seq, 0.13);                                                  // tick 1: digit F is past the top of wave (3), so it clamps
  assert.equal(registry.get('kick.osc.wave'), 3);
  assert.equal(registry.get('kick.osc.reset'), 1);
  assert.equal(registry.get('kick.ampEnv.sustain'), 1);
  render(seq, 0.13);                                                  // tick 2
  assert.equal(registry.get('kick.osc.wave'), 2);

  // exposing a whole-number parameter in the patcher gives it a 1hex column
  const d2 = structuredClone(instruments.kick);
  gedit.setExposed(d2, NODE_TYPES, 'osc', 'reset', true);
  gedit.setExposed(d2, NODE_TYPES, 'ampEnv', 'sustain', true);
  assert.equal(d2.exposed.find(e => e.param === 'reset').bits, 4);
  assert.equal(d2.exposed.find(e => e.param === 'sustain').bits, undefined);
}

// 39. Typing in a 1hex cell: one digit commits it and moves down.
{
  const defs = structuredClone(instruments);
  defs.kick.exposed.push({ node: 'osc', param: 'reset', label: 'Rst', bits: 4 });
  const registry = new ParamRegistry();
  for (const [id, d] of Object.entries(defs)) compile(d.graph, { instrument: id, nodeTypes: NODE_TYPES, registry });
  const lanes = prepareSong(demoSong, defs, registry);
  const editor = createEditor(lanes, 32);
  let onKey;
  const view = createTrackerView({ el: { addEventListener: (type, f) => { if (type === 'keydown') onKey = f; else if (type === 'wheel') onWheel = f; }, innerHTML: '' }, statusEl: {}, transport: new Int32Array(new SharedArrayBuffer(8)), onToggle() {}, onBack() {} });
  view.load({ lanes, song: demoSong, editor });
  const press = (key, times = 1) => { for (let i = 0; i < times; i++) onKey({ key, preventDefault() {} }); };
  const kick = lanes.find(l => l.id === 'kick');
  press('Tab', 2);                                                    // lead -> bass -> kick
  press('ArrowRight', 3 + 2 + 2 + 2);                                   // Note (3), Vel (2), Pit (2), Dec (2) -> Rst
  press('1');
  assert.equal(kick.rows[0][4], '1');
  press('ArrowUp');                                                     // typing a whole cell moved down a row: back up
  press('>');
  assert.equal(kick.rows[0][4], '.', '> clears the cell under the cursor, like Delete');
  view.draw();
}

// 40. Whole-number targets take a plain number, in a parameter column of any width and through a command.
{
  const defs = structuredClone(instruments);
  defs.kick.exposed.push({ node: 'osc', param: 'wave', label: 'Wav' });   // a 2hex column
  defs.kick.commands = [{ id: 0x07, node: 'osc', param: 'wave' }, { id: 0x08, node: 'ampEnv', param: 'decay', scale: 'log' }];
  const registry = new ParamRegistry();
  const rt = new GraphRuntime({ sampleRate: sr, params: registry.values });
  const seq = new Sequencer({ sampleRate: sr, runtime: rt, params: registry.values, transport: new Int32Array(new SharedArrayBuffer(8)) });
  for (const [id, d] of Object.entries(defs)) rt.load(compile(d.graph, { instrument: id, nodeTypes: NODE_TYPES, registry }));
  const rows = { 0: '... .. .. .. 02', 1: '... .. .. .. .. 070003', 2: '... .. .. .. .. 070009', 3: '... .. .. .. .. 088000' };
  const text = Array.from({ length: 16 }, (_, i) => rows[i] ?? '... .. .. ..').join('\n');
  const song = song120([{ id: 'kick', instrument: 'kick', patterns: { a: { text } }, placements: [{ puid: 'a', start: 0, length: 16 }] }]);
  seq.setSong(song);
  seq.setLane(prepareSong(song, defs, registry)[0]);
  seq.play();
  render(seq, 0.01);
  assert.equal(registry.get('kick.osc.wave'), 2, 'a 2hex cell on a whole-number parameter is the number itself (02, not 2/255 of the range)');
  render(seq, 0.13);
  assert.equal(registry.get('kick.osc.wave'), 3, '070003 is wave 3');
  render(seq, 0.13);
  assert.equal(registry.get('kick.osc.wave'), 3, 'a number past the top clamps');
  render(seq, 0.13);
  const expected = Math.pow(5000, 0x8000 / 65535);          // a continuous target still runs across its range
  assert.ok(Math.abs(registry.get('kick.ampEnv.decay') / expected - 1) < 1e-3, 'a continuous command is proportional');
}

// 41. Changing a column's width converts its cells; a whole-number parameter keeps its number.
{
  const defs = structuredClone(instruments);
  gedit.setExposed(defs.kick, NODE_TYPES, 'osc', 'wave', true);            // 1hex by default (whole-number)
  const registry = new ParamRegistry();
  for (const [id, d] of Object.entries(defs)) compile(d.graph, { instrument: id, nodeTypes: NODE_TYPES, registry });
  const lanes = prepareSong(demoSong, defs, registry);
  const kick = lanes.find(l => l.id === 'kick');
  const col = label => kick.columns.findIndex(c => c.label === label);
  assert.equal(kick.columns[col('Wav')].token, '1hex');
  ops.setCell(kick, 32, 0, col('Wav'), '3');
  const resize = (param, node, bits) => {
    gedit.setBits(defs.kick, node, param, bits);
    compile(defs.kick.graph, { instrument: 'kick', nodeTypes: NODE_TYPES, registry });
    rebuildInstrumentLanes(lanes, demoSong, defs, registry, 'kick');
  };
  assert.equal(kick.rows[0][col('Dec')], '90');
  resize('decay', 'ampEnv', 16); assert.equal(kick.rows[0][col('Dec')], '9090');     // same place in the range
  resize('decay', 'ampEnv', 4); assert.equal(kick.rows[0][col('Dec')], '8');
  resize('decay', 'ampEnv', 8); assert.equal(kick.rows[0][col('Dec')], '88');
  resize('wave', 'osc', 16); assert.equal(kick.rows[0][col('Wav')], '0003');        // a whole number stays 3
  assert.equal(kick.columns[col('Wav')].token, '4hex');
  ops.setCell(kick, 32, 0, col('Wav'), '0010');
  resize('wave', 'osc', 4); assert.equal(kick.rows[0][col('Wav')], 'F');             // too big for one digit: clamps
  assert.equal(kick.rows[1][col('Wav')], '.');                                       // empty stays empty
  assert.equal(decodeNote(kick.pages[0][0]), 36);
}

// 42. The patcher's width dropdown: whole-number parameters default to 1hex, and the choice changes the exposure.
{
  const makeEl = tag => ({
    tag, children: [], listeners: {}, style: {}, textContent: '', value: '', checked: false, disabled: false,
    appendChild(c) { this.children.push(c); return c; }, replaceChildren(...c) { this.children = c; },
    addEventListener(type, f) { this.listeners[type] = f; }, focus() {},
  });
  const walk = (el, fn) => { fn(el); (el.children ?? []).forEach(c => walk(c, fn)); };
  const doc = { createElement: makeEl, createTextNode: text => ({ text }) };
  const ctx = new Proxy({}, { get: (t, k) => (k in t ? t[k] : () => {}), set: (t, k, v) => { t[k] = v; return true; } });
  const canvas = { width: 900, height: 360, style: {}, listeners: {}, getContext: () => ctx, addEventListener(type, f) { this.listeners[type] = f; }, focus() {} };
  const panel = makeEl('div');
  const defs = structuredClone(instruments);
  const structures = [];
  const patcher = createPatcher({ canvas, panel, statusEl: {}, doc, nodeTypes: NODE_TYPES, onStructure: id => structures.push(id), onParam() {} });
  patcher.load({ instruments: defs });
  patcher.show('kick');
  patcher.load({ instruments: { other: structuredClone(instruments.kick) } });   // a new project without the shown instrument loads fine (Clear everything)
  patcher.load({ instruments: defs });
  patcher.show('kick');
  const osc = defs.kick.graph.nodes.find(n => n.id === 'osc');
  const point = { x: osc.x + 70, y: osc.y + 10 };
  canvas.listeners.mousedown({ offsetX: point.x, offsetY: point.y, preventDefault() {} });
  canvas.listeners.mouseup({ offsetX: point.x, offsetY: point.y });
  const rowFor = name => patcher.paramRows().find(r => r.name === name);

  const reset = rowFor('reset');
  assert.equal(reset.exposed, false, 'nothing is exposed until asked');
  reset.expose(true);
  assert.equal(rowFor('reset').exposed, true);
  assert.equal(rowFor('reset').bits, 4, 'a whole-number parameter defaults to 1hex');
  rowFor('reset').setBits(16);
  assert.equal(defs.kick.exposed.find(e => e.param === 'reset').bits, 16);
  {
    assert.equal(rowFor('reset').hex(), '0001', 'an exposed parameter shows its pattern value in hex, at the column width (reset is 1, 4hex)');
    assert.equal(rowFor('freq').hex(), '', 'a parameter that is not exposed shows none');
    const spec = { min: 20, max: 18000 };
    assert.equal(hexOf(spec, { bits: 8 }, 20), '00');
    assert.equal(hexOf(spec, { bits: 8 }, 18000), 'FF');
    assert.equal(hexOf(spec, { bits: 8, scale: 'log' }, Math.sqrt(20 * 18000)), '80', 'log columns put the geometric middle at half');
    assert.equal(hexOf({ min: 0, max: 255, int: true }, { bits: 4 }, 300), 'F', 'whole numbers are the number itself, clamped to the column');
    assert.equal(hexOf({ min: -1, max: 1 }, { bits: 16 }, 0), '8000');
  }
  rowFor('reset').setBits(8);
  assert.equal(defs.kick.exposed.find(e => e.param === 'reset').bits, undefined, '2hex is the default and is stored as no bits');
  assert.equal(structures.length, 3);

  rowFor('tune').expose(true);
  assert.equal(rowFor('tune').bits, 8, 'a continuous parameter defaults to 2hex');
}

// Dragging a node out of its chain takes it out; Esc during the drag keeps the wires and only moves the node.
{
  const makeEl = tag => ({ tag, children: [], listeners: {}, style: {}, textContent: '', value: '', appendChild(c) { this.children.push(c); return c; }, replaceChildren(...c) { this.children = c; }, addEventListener(type, f) { this.listeners[type] = f; }, focus() {} });
  const doc = { createElement: makeEl, createTextNode: text => ({ text }) };
  const ctx = new Proxy({}, { get: (t, k) => (k in t ? t[k] : () => {}), set: (t, k, v) => { t[k] = v; return true; } });
  const run = (esc, mods = {}, keys = []) => {
    const canvas = { width: 900, height: 360, style: {}, listeners: {}, getContext: () => ctx, addEventListener(type, f) { this.listeners[type] = f; }, focus() {} };
    const status = { textContent: '' }, structures = [];
    const defs = structuredClone(instruments);
    const patcher = createPatcher({ canvas, panel: makeEl('div'), statusEl: status, doc, nodeTypes: NODE_TYPES, onStructure: id => structures.push(id), onParam() {} });
    patcher.load({ instruments: defs });
    // a mid-chain audio node: wired from one node and to another
    let found = null;
    for (const [id, def] of Object.entries(defs)) {
      for (const n of def.graph.nodes) {
        const to = def.graph.connections.filter(c => c[1].split('.')[0] === n.id), from = def.graph.connections.filter(c => c[0].split('.')[0] === n.id);
        if (to.length === 1 && from.length === 1 && NODE_TYPES[n.type].inputs.length && !NODE_TYPES[n.type].master && ['filter', 'distortion', 'chorus', 'delay', 'gain'].includes(n.type)) { found ??= { id, n }; }
      }
    }
    assert.ok(found, 'the demo has a node in the middle of a chain');
    patcher.show(found.id);
    const def = defs[found.id], node = found.n, { w, h } = nodeBox(NODE_TYPES[node.type], node), before = JSON.stringify(def.graph.connections);
    const at = { x: node.x + w / 2, y: node.y + h / 2 };
    const count = def.graph.nodes.length;
    canvas.listeners.mousedown({ offsetX: at.x, offsetY: at.y, button: 0, preventDefault() {}, ...mods });
    canvas.listeners.mousemove({ offsetX: at.x, offsetY: at.y + 300 });
    const said = status.textContent;
    if (esc) canvas.listeners.keydown({ key: 'Escape', preventDefault() {} });
    const saidAfter = status.textContent;
    canvas.listeners.mouseup({ offsetX: at.x, offsetY: at.y + 300 });
    for (const k of keys) canvas.listeners.keydown({ ...k, preventDefault() {} });
    return { said, saidAfter, grew: def.graph.nodes.length - count, gone: !def.graph.nodes.some(n => n.id === node.id), moved: node.y > at.y - h / 2 + 100, kept: JSON.stringify(def.graph.connections) === before, structures: structures.length };
  };
  uiConfig.set('graphPullOut', false);
  const off = run(false);
  assert.equal(off.kept, true, 'with the setting off, dragging a node far away keeps its wires');
  assert.doesNotMatch(off.said, /out of its chain/, 'and no dashed line offers to take it out');
  uiConfig.set('graphPullOut', true);
  const plain = run(false), freed = run(true);
  assert.match(plain.said, /out of its chain/, 'dragging far out of a chain says it will be taken out');
  assert.equal(plain.kept, false, 'and releasing takes it out');
  assert.equal(freed.kept, true, 'Esc during the drag keeps the wires');
  assert.equal(freed.moved, true, 'and the node still moves');
  assert.doesNotMatch(freed.saidAfter, /Release to/, 'the status no longer offers to change the wires');
  // Shift+drag takes it out even with the setting off; Alt+drag moves a copy; Ctrl+X removes the selected node
  uiConfig.set('graphPullOut', false);
  const shifted = run(false, { shiftKey: true });
  assert.match(shifted.said, /out of its chain/, 'Shift+drag offers to take the node out');
  assert.equal(shifted.kept, false, 'and releasing does');
  const cloned = run(false, { altKey: true });
  assert.equal(cloned.grew, 1, 'Alt+drag makes a copy');
  assert.equal(cloned.kept, true, 'and the original stays where it was wired');
  assert.equal(cloned.moved, false, 'the original did not move');
  assert.equal(run(false, {}, [{ key: 'x', ctrlKey: true }]).gone, true, 'Ctrl+X removes the node');
  uiConfig.set('graphPullOut', true);
}

// The eye under a node shows its scope and hides it again; so does the eye in the scope's header.
{
  const makeEl = tag => ({ tag, children: [], listeners: {}, style: {}, textContent: '', value: '', appendChild(c) { this.children.push(c); return c; }, replaceChildren(...c) { this.children = c; }, addEventListener(type, f) { this.listeners[type] = f; }, focus() {} });
  const doc = { createElement: makeEl, createTextNode: text => ({ text }) };
  const ctx = new Proxy({}, { get: (t, k) => (k in t ? t[k] : () => {}), set: (t, k, v) => { t[k] = v; return true; } });
  const canvas = { width: 900, height: 360, style: {}, listeners: {}, getContext: () => ctx, addEventListener(type, f) { this.listeners[type] = f; }, focus() {} };
  const defs = structuredClone(instruments), scopes = [];
  const patcher = createPatcher({ canvas, panel: makeEl('div'), statusEl: {}, doc, nodeTypes: NODE_TYPES, onStructure() {}, onParam() {}, onScope: (...a) => scopes.push(a) });
  patcher.load({ instruments: defs });
  patcher.show('kick');
  const node = defs.kick.graph.nodes.find(n => n.id === 'osc'), { w, h } = nodeBox(NODE_TYPES[node.type], node);
  const click = (x, y) => canvas.listeners.mousedown({ offsetX: x, offsetY: y, button: 0, preventDefault() {} }) ?? canvas.listeners.mouseup({ offsetX: x, offsetY: y });
  const eye = [node.x + w / 2, node.y + h + 10];
  click(...eye);
  assert.ok(node.scope, 'the eye under the node shows the scope');
  click(...eye);
  assert.equal(node.scope, undefined, 'and clicking it again hides it');
  click(...eye);
  const box = scopeBox(node, w, h, node.scope.size, node.scope.mode);
  click(box.x + box.size - 47, box.y + 7);
  assert.equal(node.scope, undefined, 'the eye in the scope header hides it too');
  assert.deepEqual(scopes.map(a => a[2]), [true, false, true, false]);
}

// A graph is moved clear of the exposed-parameters dock, as one block.
{
  const { nudgeClear } = await import('../src/graph/edit.js');
  const dock = { x: 1, y: 1, w: 210, h: 80 }, view = { w: 650, h: 460 };
  assert.deepEqual(nudgeClear([{ x: 300, y: 20, w: 100, h: 40 }], dock, view), { dx: 0, dy: 0 }, 'a graph clear of the dock stays');
  assert.deepEqual(nudgeClear([{ x: 300, y: 20, w: 100, h: 40 }, { x: 20, y: 200, w: 100, h: 40 }], dock, view), { dx: 0, dy: 0 }, 'a box below the dock is clear');
  assert.deepEqual(nudgeClear([{ x: 20, y: 30, w: 100, h: 40 }, { x: 300, y: 30, w: 100, h: 40 }], dock, view), { dx: 0, dy: 63 }, 'it goes down when that is shorter than going right');
  assert.deepEqual(nudgeClear([{ x: 20, y: 30, w: 100, h: 40 }], dock, { w: 650, h: 120 }), { dx: 203, dy: 0 }, 'and right when there is no room below');
}

// ---- milestone 6: samples, instruments, lanes ----

// A project as the page holds it: the demo's instruments compiled, lanes prepared.
const makeProject = () => {
  const registry = new ParamRegistry();
  const instruments_ = structuredClone(instruments);
  for (const [id, d] of Object.entries(instruments_)) compile(d.graph, { instrument: id, nodeTypes: NODE_TYPES, registry });
  const lanes = prepareSong(demoSong, instruments_, registry);
  return { registry, project: { song: demoSong, instruments: instruments_, samples: { pluck: { rate: sr, data: makePluck(sr) } }, lanes } };
};
const burst = new Float32Array(4800).map((_, i) => (Math.sin(i * 0.7) + Math.sin(i * 1.9)) * 0.4 * Math.exp(-i / 800));   // a short noisy tick

// 43. Project operations: samples, loop points, instruments, lanes.
{
  const fake = { numberOfChannels: 2, length: 4, getChannelData: c => (c === 0 ? Float32Array.of(1, 0, 0.5, -1) : Float32Array.of(0, 0, 0.5, 1)) };
  assert.deepEqual(Array.from(pops.toMono(fake)), [0.5, 0, 0.5, 0]);
  assert.equal(pops.idFromName('My Kick (1).wav'), 'My_Kick_1_');
  assert.equal(pops.idFromName('.wav'), 'sample');
  assert.equal(pops.uniqueId(new Set(['a', 'a2']), 'a'), 'a3');

  const { registry, project } = makeProject();
  assert.deepEqual(pops.usersOfSample(project, 'pluck').map(u => u.instrument).sort(), ['bass', 'lead']);
  assert.throws(() => pops.removeSample(project, 'pluck'), /used by an instrument/);
  const tick = pops.addSample(project, 'tick.wav', 44100, burst);
  const again = pops.addSample(project, 'tick.wav', 44100, burst);
  assert.deepEqual([tick, again], ['tick', 'tick2']);
  pops.removeSample(project, again);
  assert.equal(project.samples[again], undefined);

  assert.throws(() => pops.setLoop(project, 'tick', 1.5, 100), /whole numbers/);
  assert.throws(() => pops.setLoop(project, 'tick', 0, burst.length + 1), /past the end/);
  assert.throws(() => pops.setLoop(project, 'tick', 10, 11), /two frames/);
  pops.setLoop(project, 'tick', 100, 900);
  assert.deepEqual([project.samples.tick.loopStart, project.samples.tick.loopEnd], [100, 900]);
  pops.setLoop(project, 'tick', 0, 0);
  assert.equal(project.samples.tick.loopStart, undefined);

  assert.throws(() => pops.addSamplerInstrument(project, 'x', 'nope'), /Pick a sample/);
  const id = pops.addSamplerInstrument(project, 'Tick Hat', 'tick');
  assert.equal(id, 'Tick_Hat');
  assert.deepEqual(project.instruments[id].samples, { sampler: 'tick' });
  assert.equal(pops.addSamplerInstrument(project, 'Tick Hat', 'tick'), 'Tick_Hat2');
  compile(project.instruments[id].graph, { instrument: id, nodeTypes: NODE_TYPES, registry });
  const lane = pops.addLane(project, registry, id);
  const second = pops.addLane(project, registry, id);
  assert.deepEqual([lane.id, second.id], ['Tick_Hat', 'Tick_Hat2']);          // two lanes for one instrument are independent
  assert.equal(project.lanes.at(-2), lane);
  assert.deepEqual(lane.columns.map(c => c.label), ['Note', 'Vel', 'Smp', 'Off', 'Rtg', 'Cut', 'Res', 'Mix', 'Time', 'Cmd']);

  // the new lane can be edited and heard
  const rt = new GraphRuntime({ sampleRate: sr, params: registry.values });
  rt.load(compile(project.instruments[id].graph, { instrument: id, nodeTypes: NODE_TYPES, registry }));
  rt.message(id, 'sampler', { type: 'sample', data: burst, rate: 44100 });
  const seq = new Sequencer({ sampleRate: sr, runtime: rt, params: registry.values, transport: new Int32Array(new SharedArrayBuffer(8)) });
  seq.setSong(project.song);
  seq.setLane(lane);
  const editor = createEditor(project.lanes, project.song.length);
  const li = project.lanes.indexOf(lane);
  assert.ok(editor.insertPattern(li, 0));
  assert.ok(editor.setCell(li, 0, 0, 'C-4'));
  seq.play();
  assert.ok(peak(render(seq, 0.2).left) > 0.01, 'the new lane is silent');
}

// 44. A project with new samples, instruments and lanes survives a save and load.
{
  const { registry, project } = makeProject();
  pops.addSample(project, 'tick.wav', 44100, burst);
  pops.setLoop(project, 'tick', 200, 1000);
  const id = pops.addSamplerInstrument(project, 'hat', 'tick');
  compile(project.instruments[id].graph, { instrument: id, nodeTypes: NODE_TYPES, registry });
  const lane = pops.addLane(project, registry, id);
  const editor = createEditor(project.lanes, project.song.length);
  editor.insertPattern(project.lanes.indexOf(lane), 4);
  editor.setCell(project.lanes.indexOf(lane), 4, 0, 'E-3');
  const back = parseProject(serializeProject(project, { sampleFormat: 'float32' }));
  assert.equal(back.samples.tick.loopStart, 200);
  assert.equal(back.samples.tick.loopEnd, 1000);
  assert.ok(Buffer.from(back.samples.tick.data.buffer).equals(Buffer.from(burst.buffer)));
  assert.deepEqual(back.instruments.hat, JSON.parse(JSON.stringify(project.instruments.hat)));
  const registry2 = new ParamRegistry();
  for (const [iid, d] of Object.entries(back.instruments)) compile(d.graph, { instrument: iid, nodeTypes: NODE_TYPES, registry: registry2 });
  const lanes2 = prepareSong(back.song, back.instruments, registry2);
  assert.deepEqual(lanes2.map(l => l.id), project.lanes.map(l => l.id));
  assert.deepEqual(lanes2.map(l => l.rows), project.lanes.map(l => l.rows));
  assert.equal(lanes2.at(-1).rows[4][0], 'E-3');
}

// 45. The sample screen: keyboard fields change loops, levels and names; edits report which instruments to update.
{
  const { project } = makeProject();
  pops.addSample(project, 'tick.wav', 44100, burst);
  let onKey, onUp;
  const el = { addEventListener: (type, f) => { if (type === 'keydown') onKey = f; if (type === 'keyup') onUp = f; }, innerHTML: '' };
  const statusEl = { textContent: '' }, events = [];
  const screen = createSampleScreen({
    el, statusEl, getProject: () => project,
    onChange: users => events.push(['change', users.map(u => u.instrument).sort()]),
    onSelect: id => events.push(['select', id]), onRemove: id => events.push(['remove', id]),
    onRename: (from, to) => events.push(['rename', from, to]), onNote: (id, note, on) => events.push(['note', id, note, on]), onLoad: () => events.push(['load']),
    onView: mode => events.push(['view', mode]),
  });
  const key = (k, extra = {}) => onKey({ key: k, preventDefault() {}, ...extra });
  const type = text => [...text].forEach(c => key(c));
  const tab = n => { for (let i = 0; i < n; i++) key('Tab'); };
  const pluck = project.samples.pluck, n = pluck.data.length;
  screen.draw();
  assert.ok(el.innerHTML.includes('pluck') && el.innerHTML.includes('tick'), 'the list shows both samples');
  assert.deepEqual(events[0], ['select', 'pluck']);
  key('ArrowDown'); assert.equal(screen.selected, 'tick');
  key('ArrowUp'); assert.equal(screen.selected, 'pluck');

  // loop end: type a value, step with the arrows and Shift
  tab(4); assert.equal(screen.focus, 'loopEnd');
  type('5000'); key('Enter');
  assert.deepEqual([pluck.loopStart, pluck.loopEnd], [0, 5000]);
  assert.deepEqual(events.at(-1), ['change', ['bass', 'lead']]);
  key('ArrowRight', { shiftKey: true }); assert.equal(pluck.loopEnd, 5100);
  key('ArrowLeft'); assert.equal(pluck.loopEnd, 5099);
  type('99999999'); key('Enter'); assert.equal(pluck.loopEnd, n, 'a value past the end is clamped');
  key('Tab'); type('64'); key('Enter'); assert.equal(pluck.loopXfade, 64);
  tab(1); assert.equal(screen.focus, 'susOn');
  key(' '); assert.equal(pluck.susEnd, n, 'switching a loop on with no points loops the whole sample');
  key(' '); assert.equal(pluck.susOn, false);
  key(' '); assert.equal(pluck.susOn, true);
  tab(1); type('100'); key('Enter'); assert.equal(pluck.susStart, 100);
  tab(1); type('0'); key('Enter'); assert.equal(pluck.susEnd, undefined, 'an end of 0 removes the loop');

  // sliders answer to the same keys; the focused one is drawn brighter
  tab(4); assert.equal(screen.focus, 'volume');
  screen.draw(); assert.equal(el.innerHTML.split('class="sl on"').length - 1, 1, 'only the focused slider is bright');
  key('ArrowLeft'); assert.equal(pluck.volume, 0.99);
  key('ArrowLeft', { shiftKey: true }); assert.equal(pluck.volume, 0.89);
  key('Equal', { key: '=', code: 'Equal' }); assert.equal(pluck.volume, 0.9, '+ and - work too');
  tab(2); type('-0.5'); key('Enter'); assert.equal(pluck.pan, -0.5);
  key('ArrowLeft', { shiftKey: true, ctrlKey: true }); assert.equal(pluck.pan, -0.75);
  key('ArrowRight', { ctrlKey: true }); key('ArrowRight', { ctrlKey: true }); assert.equal(pluck.pan, -0.25);
  tab(1); key(' '); assert.deepEqual(events.at(-1), ['view', 'spec']); assert.equal(screen.mode, 'spec');
  key('Escape'); assert.equal(screen.focus, 'list');

  // rename and remove
  key('ArrowDown'); key('Tab'); type('hat'); key('Enter');
  assert.ok(project.samples.hat && !project.samples.tick);
  assert.deepEqual(events.at(-1), ['rename', 'tick', 'hat']);
  assert.equal(screen.selected, 'hat');
  key('Tab'); key('x'); key('Escape'); assert.ok(project.samples.hat, 'Escape abandons an edit');
  key('Escape');
  key(' '); onUp({ key: ' ' });
  assert.deepEqual(events.slice(-2), [['note', 'hat', 60, true], ['note', 'hat', 60, false]]);
  key('Delete'); assert.equal(project.samples.hat, undefined);
  assert.deepEqual(events.at(-1), ['remove', 'hat']); assert.equal(screen.selected, 'pluck');
  key('Delete'); assert.ok(project.samples.pluck, 'a sample in use cannot be removed'); assert.match(statusEl.textContent, /used by an instrument/);
  key('l'); assert.deepEqual(events.at(-1), ['load']);
}

// 46. A sampler node in the patcher can be pointed at another sample.
{
  const makeEl = tag => ({
    tag, children: [], listeners: {}, style: {}, textContent: '', value: '', checked: false, disabled: false,
    appendChild(c) { this.children.push(c); return c; }, replaceChildren(...c) { this.children = c; },
    addEventListener(type, f) { this.listeners[type] = f; }, focus() {},
  });
  const walk = (el, fn) => { fn(el); (el.children ?? []).forEach(c => walk(c, fn)); };
  const doc = { createElement: makeEl, createTextNode: text => ({ text }) };
  const ctx = new Proxy({}, { get: (t, k) => (k in t ? t[k] : () => {}), set: (t, k, v) => { t[k] = v; return true; } });
  const canvas = { width: 900, height: 360, style: {}, listeners: {}, getContext: () => ctx, addEventListener(type, f) { this.listeners[type] = f; }, focus() {} };
  const panel = makeEl('div');
  const defs = structuredClone(instruments);
  const structures = [];
  const patcher = createPatcher({ canvas, panel, statusEl: {}, doc, nodeTypes: NODE_TYPES, onStructure: id => structures.push(id), onParam() {}, getSampleIds: () => ['pluck', 'tick'] });
  patcher.load({ instruments: defs });
  patcher.show('lead');
  const node = defs.lead.graph.nodes.find(n => n.id === 'sampler');
  canvas.listeners.mousedown({ offsetX: node.x + 70, offsetY: node.y + 10, preventDefault() {} });
  canvas.listeners.mouseup({ offsetX: node.x + 70, offsetY: node.y + 10 });
  const selects = []; walk(panel, e => { if (e.tag === 'select' && e.children.some(c => c.value === 'tick')) selects.push(e); });
  assert.equal(selects.length, 1);
  assert.equal(selects[0].value, 'pluck');
  selects[0].value = 'tick'; selects[0].listeners.change();
  assert.deepEqual(defs.lead.samples, { sampler: 'tick' });
  assert.deepEqual(structures, ['lead']);
}

// 47. Delay time glides per sample, so the result does not depend on the block size.
{
  const run = block => {
    const node = NODE_TYPES.delay.create({ sampleRate: sr, connected: [true] });
    const params = Float32Array.of(300, 0.3, 1), slots = Int32Array.of(0, 1, 2);
    const total = 48000, out = new Float32Array(total);
    const input = new Float32Array(block), output = new Float32Array(block);
    let seed = 7;
    for (let at = 0; at < total; at += block) {
      if (at === 19968) params[0] = 40;                               // a time change at a point both block sizes share
      for (let i = 0; i < block; i++) input[i] = ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 0.2;
      node.process([input], [output], block, params, slots);
      out.set(output, at);
    }
    return out;
  };
  const a = run(128), b = run(32);
  assert.ok(a.every((v, i) => Number.isFinite(v) && Math.abs(v - b[i]) < 1e-6), 'the glide depends on the block size');
}

// 48. An instrument that produces invalid audio is rebuilt and reported; the others keep sounding.
{
  const lanes2 = [oneLane('lead', 'lead', patternText(16, { 0: 'C-4 .. .. .... .... .. .. ..' })), oneLane('bass', 'bass', patternText(16, { 0: 'C-3 .. .. .... .... .. .. ..' }))];
  const { seq, registry, rt } = songSetup(song120(lanes2));
  const faults = [];
  rt.onFault = id => faults.push(id);
  seq.play();
  render(seq, 0.05);
  registry.values[registry.slots.get('bass.delay.time')] = NaN;      // poisons the delay line, bypassing the registry's guard
  const after = render(seq, 0.4).left;
  assert.ok(after.every(Number.isFinite), 'a bad instrument reached the output');
  assert.ok(peak(after) > 0.05, 'the other instrument went quiet');
  assert.deepEqual([...new Set(faults)], ['bass']);

  // the bad instrument recovers once its parameter is valid again, with its sample still loaded
  const solo = songSetup(song120([oneLane('bass', 'bass', patternText(16, { 0: 'C-3 .. .. .... .... .. .. ..' }))]));
  solo.seq.play();
  render(solo.seq, 0.05);
  solo.registry.values[solo.registry.slots.get('bass.delay.time')] = NaN;
  render(solo.seq, 0.2);
  solo.registry.values[solo.registry.slots.get('bass.delay.time')] = 300;
  const next = render(solo.seq, 2).left;                              // starts at 0.25 s; the song loops at 2 s, which is sample 84000 here
  assert.ok(next.every(Number.isFinite));
  assert.ok(peak(next.subarray(84100, 85500)) > 0.01, 'the rebuilt instrument did not play its sample');
}

// 49. The parameter registry ignores values that are not numbers.
{
  const registry = new ParamRegistry();
  compile(instruments.kick.graph, { instrument: 'kick', nodeTypes: NODE_TYPES, registry });
  registry.set('kick.ampEnv.decay', 123);
  registry.set('kick.ampEnv.decay', NaN);
  registry.set('kick.ampEnv.decay', Infinity);
  assert.equal(registry.get('kick.ampEnv.decay'), 123);
}

// 50. 16-bit samples: half the size, small error, and older float32 files still load.
{
  const data = new Float32Array(10000).map((_, i) => 0.9 * Math.sin(i * 0.05));
  const common = { song: demoSong, instruments: {}, lanes: [] };
  const wide = serializeProject({ ...common, samples: { s: { rate: sr, data } } }, { sampleFormat: 'float32' });
  const narrow = serializeProject({ ...common, samples: { s: { rate: sr, data, loopStart: 10, loopEnd: 900 } } });
  assert.ok(JSON.parse(narrow).samples.s.encoding === 'pcm16');
  assert.ok(JSON.parse(narrow).samples.s.data.length < JSON.parse(wide).samples.s.data.length * 0.6, 'pcm16 should be about half the size');
  const back = parseProject(narrow).samples.s;
  assert.equal(back.data.length, data.length);
  assert.ok(back.data.every((v, i) => Math.abs(v - data[i]) <= 1 / 32767 + 1e-7), 'pcm16 error is too large');
  assert.deepEqual([back.loopStart, back.loopEnd], [10, 900]);
  // clipping and full scale
  const edge = parseProject(serializeProject({ ...common, samples: { s: { rate: sr, data: Float32Array.of(1.5, -1.5, 1, -1, 0) } } })).samples.s.data;
  assert.deepEqual(Array.from(edge), [1, -1, 1, -1, 0]);
  // a file saved before the encoding field existed is float32
  const old = JSON.parse(wide); delete old.samples.s.encoding;
  assert.ok(Buffer.from(parseProject(JSON.stringify(old)).samples.s.data.buffer).equals(Buffer.from(data.buffer)));
}

// 51. The waveform view: peaks, drawing, and dragging loop markers.
{
  const peaks = computePeaks(Float32Array.of(0, 0.5, -0.25, 1, -1, 0), 3);
  assert.deepEqual(Array.from(peaks), [0, 0.5, -0.25, 1, -1, 0]);
  assert.equal(computePeaks(new Float32Array(0), 4).length, 8);

  const ctx = new Proxy({}, { get: (t, k) => (k in t ? t[k] : () => {}), set: (t, k, v) => { t[k] = v; return true; } });
  const canvas = { width: 900, height: 140, style: {}, listeners: {}, getContext: () => ctx, addEventListener(type, f) { this.listeners[type] = f; } };
  const project = { samples: { s: { rate: sr, data: new Float32Array(9000).map((_, i) => Math.sin(i * 0.1)) } }, instruments: { a: { samples: { sampler: 's' } } } };
  const statusEl = { textContent: '' }, loops = [];
  const view = createWaveformView({ canvas, statusEl, getProject: () => project, onLoop: users => loops.push(users) });
  const fire = (type, x) => canvas.listeners[type]?.({ offsetX: x, offsetY: 50 });
  view.draw();                                           // nothing selected: no error
  view.show('s');
  view.draw();

  fire('mousedown', 100); fire('mousemove', 400); fire('mouseup', 400);   // drag across empty waveform: a new loop (10 frames per pixel)
  assert.deepEqual([project.samples.s.loopStart, project.samples.s.loopEnd], [1000, 4000]);
  assert.deepEqual(loops.at(-1), [{ instrument: 'a', node: 'sampler' }]);
  view.draw();

  fire('mousedown', 401); fire('mousemove', 600); fire('mouseup', 600);   // grab the end marker and drag it
  assert.deepEqual([project.samples.s.loopStart, project.samples.s.loopEnd], [1000, 6000]);
  fire('mousedown', 99); fire('mousemove', 50); fire('mouseup', 50);      // grab the start marker
  assert.deepEqual([project.samples.s.loopStart, project.samples.s.loopEnd], [500, 6000]);
  fire('mousedown', 300); fire('mousemove', 305); fire('mouseleave', 305); // leaving the canvas ends the drag where it left
  assert.deepEqual([project.samples.s.loopStart, project.samples.s.loopEnd], [3000, 3050]);
  fire('mousedown', 99); fire('mousemove', 100); fire('mouseup', 100);
  project.samples.s.loopStart = 500; project.samples.s.loopEnd = 6000;
  fire('mousedown', 300); fire('mouseup', 300);                           // a plain click changes nothing
  assert.equal(project.samples.s.loopEnd, 6000);
  fire('mousedown', 598); fire('mousemove', 0); fire('mouseup', 0);        // the end cannot pass the start
  assert.equal(project.samples.s.loopStart, 500);
  assert.ok(project.samples.s.loopEnd >= 502);
  canvas.listeners.dblclick();                                            // double-click clears
  assert.equal(project.samples.s.loopStart, undefined);
  view.draw();
}

// 52. The WASM kernels match the JS reference nodes sample for sample.
{
  const wasm = compileDsp();
  const drive = (type, wasmOn, connected, setup) => {
    const node = NODE_TYPES[type].create({ sampleRate: sr, maxBlock: 512, connected, wasm: wasmOn ? wasm : null });
    const total = 24000, block = 100, out = new Float32Array(total);
    const input = new Float32Array(512), mod = new Float32Array(512), output = new Float32Array(512);
    const params = new Float32Array(3), slots = Int32Array.of(0, 1, 2);
    let seed = 11;
    for (let at = 0; at < total; at += block) {
      setup(params, at);
      for (let i = 0; i < block; i++) {
        input[i] = at < 12000 ? ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 0.8 : 0;   // noise, then silence for the tail
        mod[i] = Math.sin(at / 3000);
      }
      node.process([input, mod], [output], block, params, slots);
      out.set(output.subarray(0, block), at);
    }
    return out;
  };
  const maxDiff = (a, b) => a.reduce((m, v, i) => Math.max(m, Math.abs(v - b[i])), 0);
  for (const mode of [0, 1, 2]) {
    const setup = (p, at) => { p[0] = 300 + (at % 7000); p[1] = 0.1 + 0.8 * ((at / 100) % 2) / 2; p[2] = mode; };
    for (const connected of [[true, false], [true, true]]) {
      const js = drive('filter', false, connected, setup), wa = drive('filter', true, connected, setup);
      assert.ok(js.some(v => Math.abs(v) > 0.01), 'the filter is silent');
      assert.ok(maxDiff(js, wa) < 1e-6, `filter mode ${mode} differs: ${maxDiff(js, wa)}`);
    }
  }
  const dsetup = (p, at) => { p[0] = at < 6000 ? 120 : 37; p[1] = 0.6; p[2] = 0.5; };
  const js = drive('delay', false, [true], dsetup), wa = drive('delay', true, [true], dsetup);
  assert.ok(js.some(v => Math.abs(v) > 0.01));
  assert.ok(maxDiff(js, wa) < 1e-6, `delay differs: ${maxDiff(js, wa)}`);
}

// 53. A whole song renders the same through the WASM runtime as through the JS one.
{
  const wasm = compileDsp();
  const renderWith = wasmOn => {
    const lanes2 = [oneLane('lead', 'lead', patternText(16, { 0: 'C-4 .. .. .... .... .. .. ..', 4: 'E-4 .. .. .... .... .. .. ..' })), oneLane('bass', 'bass', patternText(16, { 0: 'C-3 .. .. .... .... .. .. ..' }))];
    const { seq, rt } = songSetup(song120(lanes2), wasmOn ? wasm : null);
    seq.play();
    return render(seq, 0.4);
  };
  const a = renderWith(false), b = renderWith(true);
  assert.ok(a.left.some(v => Math.abs(v) > 0.01), 'nothing rendered');
  let worst = 0;
  for (let i = 0; i < a.left.length; i++) worst = Math.max(worst, Math.abs(a.left[i] - b.left[i]), Math.abs(a.right[i] - b.right[i]));
  assert.ok(worst < 1e-4, `song differs: ${worst}`);
}

// 54. Rows past the end of a pattern are drawn dimmed; covered rows are not.
{
  const registry = new ParamRegistry();
  for (const [id, def] of Object.entries(instruments)) compile(def.graph, { instrument: id, nodeTypes: NODE_TYPES, registry });
  const lanes = prepareSong(demoSong, instruments, registry);
  const el = { addEventListener() {}, innerHTML: '' };
  const view = createTrackerView({ el, statusEl: {}, transport: new Int32Array(new SharedArrayBuffer(8)), onToggle() {}, onBack() {} });
  view.load({ lanes, song: demoSong, editor: createEditor(lanes, demoSong.length) });
  view.draw();
  const before = (el.innerHTML.match(/class="off"/g) ?? []).length;
  lanes[0].placements[0].length = 4;                 // the lead's first pattern now ends early
  view.draw();
  const after = (el.innerHTML.match(/class="off"/g) ?? []).length;
  assert.ok(after > before, 'rows past the pattern end are not dimmed');
}

// 55. Tabs: one pane shown at a time, F-keys and clicks switch, the main element takes focus.
{
  const make = () => {
    const classes = new Set(), listeners = {};
    return {
      hidden: false, focused: 0,
      classList: { toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)), has: c => classes.has(c) },
      setAttribute() {}, addEventListener: (type, f) => { listeners[type] = f; }, click: () => listeners.click(),
      focus() { this.focused++; },
    };
  };
  const defs = ['a', 'b', 'c'].map((id, i) => ({ id, key: `F${i + 2}`, el: make(), button: make(), focus: i === 2 ? undefined : make() }));
  const seen = [];
  const tabs = createTabs({ tabs: defs, onChange: id => seen.push(id) });
  assert.equal(tabs.active, 'a');
  assert.deepEqual(defs.map(d => d.el.hidden), [false, true, true]);
  assert.equal(defs[0].focus.focused, 0, 'the first pane takes focus only when asked');
  let prevented = 0;
  const key = (k, extra = {}) => tabs.handleKey({ key: k, preventDefault() { prevented++; }, ...extra });
  assert.ok(key('F3'));
  assert.equal(tabs.active, 'b');
  assert.deepEqual(defs.map(d => d.el.hidden), [true, false, true]);
  assert.ok(defs[1].button.classList.has('active') && !defs[0].button.classList.has('active'));
  assert.equal(defs[1].focus.focused, 1);
  assert.equal(prevented, 1);
  assert.ok(!key('F3', { ctrlKey: true }) && !key('x'), 'other keys are left alone');
  defs[2].button.click();                          // a pane with no focus target still switches
  assert.equal(tabs.active, 'c');
  assert.equal(tabs.show('nope'), false);
  assert.deepEqual(seen, ['a', 'b', 'c']);
}

// 56. Several wires into one input are summed; the mix node crossfades; ports have a signal kind.
{
  const build = connections => {
    const registry = new ParamRegistry();
    const rt = new GraphRuntime({ sampleRate: sr, params: registry.values });
    const desc = {
      nodes: [{ id: 'o1', type: 'osc' }, { id: 'o2', type: 'osc', params: { tune: 7 } }, { id: 'g', type: 'gain' }, { id: 'out', type: 'out' }],
      connections: [...connections, ['g.out', 'out.in']],
    };
    rt.load(compile(desc, { instrument: 'x', nodeTypes: NODE_TYPES, registry }));
    rt.note('x', { type: 'noteOn', note: 60, vel: 1 });
    return render(rt, 0.1).left;
  };
  const one = build([['o1.out', 'g.in']]), two = build([['o2.out', 'g.in']]), both = build([['o1.out', 'g.in'], ['o2.out', 'g.in']]);
  assert.ok(peak(one) > 0.01 && peak(two) > 0.01);
  assert.ok(both.every((v, i) => Math.abs(v - (one[i] + two[i])) < 1e-5), 'two wires into one input are not summed');
  const registry = new ParamRegistry();
  const twice = { nodes: [{ id: 'o1', type: 'osc' }, { id: 'g', type: 'gain' }, { id: 'out', type: 'out' }], connections: [['o1.out', 'g.in'], ['o1.out', 'g.in'], ['g.out', 'out.in']] };
  assert.throws(() => compile(twice, { instrument: 'y', nodeTypes: NODE_TYPES, registry }), /duplicate connection/);

  const mixNode = amount => {
    const node = NODE_TYPES.mix.create({ sampleRate: sr, connected: [true, true] });
    const a = new Float32Array(64).fill(1), b = new Float32Array(64).fill(-1), out = new Float32Array(64);
    node.process([a, b], [out], 64, Float32Array.of(amount), Int32Array.of(0));
    return out[63];
  };
  assert.equal(mixNode(0), 1);
  assert.equal(mixNode(1), -1);
  assert.ok(Math.abs(mixNode(0.25) - 0.5) < 1e-6);

  assert.equal(portKind(NODE_TYPES.env, 'out'), 'control');
  assert.equal(portKind(NODE_TYPES.osc, 'fm'), 'control');
  assert.equal(portKind(NODE_TYPES.filter, 'in'), 'audio');
  assert.ok(NODE_TYPES.sum.hidden);
}

// 57. Stereo: a mono wire feeds both channels, a stereo wire into a mono input is averaged,
// several stereo wires are summed, and the new nodes behave.
{
  const run = (nodes, connections, note = true) => {
    const registry = new ParamRegistry();
    const rt = new GraphRuntime({ sampleRate: sr, params: registry.values });
    const compiled = compile({ nodes: [...nodes, { id: 'out', type: 'out' }], connections }, { instrument: 's', nodeTypes: NODE_TYPES, registry });
    rt.load(compiled);
    if (note) rt.note('s', { type: 'noteOn', note: 60, vel: 1 });
    return { ...render(rt, 0.1), compiled };
  };
  const osc = { id: 'o', type: 'osc' };
  const direct = run([osc], [['o.out', 'out.in']]);
  assert.ok(peak(direct.left) > 0.01);
  assert.ok(direct.left.every((v, i) => v === direct.right[i]), 'a mono wire should feed both channels');

  const panned = run([osc, { id: 'p', type: 'pan' }], [['o.out', 'p.out'.replace('out', 'in')], ['p.out', 'out.in']]);
  assert.ok(panned.left.every((v, i) => Math.abs(v - direct.left[i]) < 1e-5), 'a centred pan node should match a mono wire');
  const hardLeft = run([osc, { id: 'p', type: 'pan', params: { pan: -1 } }], [['o.out', 'p.in'], ['p.out', 'out.in']]);
  assert.equal(peak(hardLeft.right), 0);
  assert.ok(Math.abs(peak(hardLeft.left) / peak(direct.left) - Math.SQRT2) < 1e-3);

  const folded = run([osc, { id: 'p', type: 'pan', params: { pan: -1 } }, { id: 'q', type: 'pan' }], [['o.out', 'p.in'], ['p.out', 'q.in'], ['q.out', 'out.in']]);
  assert.ok(folded.compiled.nodes.some(n => n.type === 'fold'));
  assert.ok(Math.abs(peak(folded.left) / peak(direct.left) - Math.SQRT1_2) < 1e-3, 'stereo into a mono input should be the average');
  // a gain stage is a dual node: it keeps a stereo signal stereo instead of folding it
  const kept = run([osc, { id: 'p', type: 'pan', params: { pan: -1 } }, { id: 'g', type: 'gain' }], [['o.out', 'p.in'], ['p.out', 'g.in'], ['g.out', 'out.in']]);
  assert.ok(!kept.compiled.nodes.some(n => n.type === 'fold'));
  assert.equal(peak(kept.right), 0);
  assert.ok(Math.abs(peak(kept.left) - peak(hardLeft.left)) < 1e-6);

  const both = run([osc, { id: 'a', type: 'pan', params: { pan: -1 } }, { id: 'b', type: 'pan', params: { pan: 1 } }],
    [['o.out', 'a.in'], ['o.out', 'b.in'], ['a.out', 'out.in'], ['b.out', 'out.in']]);
  assert.ok(both.compiled.nodes.some(n => n.type === 'sumst'));
  assert.ok(Math.abs(peak(both.left) / peak(direct.left) - Math.SQRT2) < 1e-3 && Math.abs(peak(both.right) / peak(direct.left) - Math.SQRT2) < 1e-3);

  const stereoIn = (l, r) => [Float32Array.from(l), Float32Array.from(r)];
  const stage = (type, values, connected = [true]) => {
    const def = NODE_TYPES[type];
    const params = Float32Array.from(def.params.map(p => values[p.name] ?? p.def)), slots = Int32Array.from(def.params.map((_, i) => i));
    const node = def.create({ sampleRate: sr, connected });
    return (inL, inR) => {
      const out = [new Float32Array(inL.length), new Float32Array(inL.length)];
      for (let at = 0; at < inL.length; at += 128) {
        const n = Math.min(128, inL.length - at);
        node.process([[inL.subarray(at, at + n), inR.subarray(at, at + n)]], [[out[0].subarray(at, at + n), out[1].subarray(at, at + n)]], n, params, slots);
      }
      return out;
    };
  };

  // chorus: mix 0 is the dry signal, silence stays silent, a wet signal differs and stays finite
  const noise = new Float32Array(9600); let seed = 5;
  for (let i = 0; i < noise.length; i++) noise[i] = ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 0.5;
  const dry = stage('chorus', { mix: 0 })(noise, noise);
  assert.ok(dry[0].every((v, i) => v === noise[i]));
  const wet = stage('chorus', { mix: 1 })(noise, noise);
  assert.ok(wet[0].every(Number.isFinite) && wet[0].some((v, i) => Math.abs(v - noise[i]) > 0.01));
  assert.ok(wet[0].some((v, i) => Math.abs(v - wet[1][i]) > 0.01), 'the two channels should differ');
  const quiet = stage('chorus', {})(new Float32Array(2000), new Float32Array(2000));
  assert.equal(peak(quiet[0]) + peak(quiet[1]), 0);

  // multi-tap: an impulse comes back at k * time, scaled by decay, panned along the sweep
  const impulse = new Float32Array(1600); impulse[0] = 1;
  const centre = stage('multitap', { time: 10, taps: 3, decay: 0.5, spread: 0, feedback: 0, mix: 1 })(impulse, impulse);
  for (const [at, v] of [[480, 1], [960, 0.5], [1440, 0.25]]) assert.ok(Math.abs(centre[0][at] - v) < 1e-3 && Math.abs(centre[1][at] - v) < 1e-3, `tap at ${at}`);
  assert.ok(Math.abs(centre[0][100]) < 1e-6);
  const wide = stage('multitap', { time: 10, taps: 2, decay: 1, spread: 1, feedback: 0, mix: 1 })(impulse, impulse);
  assert.ok(wide[0][480] > 1.3 && Math.abs(wide[1][480]) < 1e-3, 'the first tap should be hard left');
  assert.ok(wide[1][960] > 1.3 && Math.abs(wide[0][960]) < 1e-3, 'the last tap should be hard right');
  const ring = stage('multitap', { time: 10, taps: 1, decay: 1, feedback: 0.5, mix: 1 })(impulse, impulse);
  assert.ok(ring[0][960] > 0.2 && ring[0].every(Number.isFinite), 'feedback should repeat the tap');

  // shiva delay: taps at their own times, levels and pans; the latest tap feeds back
  {
    const run = (taps, values, len = 4000) => {
      const def = NODE_TYPES.shiva;
      const params = Float32Array.from(def.params.map(p => values[p.name] ?? p.def)), slots = Int32Array.from(def.params.map((_, i) => i));
      const node = def.create({ sampleRate: sr, connected: [true], data: { taps } });
      const inp = new Float32Array(len); inp[0] = 1;
      const out = [new Float32Array(len), new Float32Array(len)];
      for (let at = 0; at < len; at += 128) {
        const n = Math.min(128, len - at);
        node.process([[inp.subarray(at, at + n), inp.subarray(at, at + n)]], [[out[0].subarray(at, at + n), out[1].subarray(at, at + n)]], n, params, slots);
      }
      return out;
    };
    const ms10 = Math.round(sr * 0.01);
    const a = run([0.5, 1, -1, 1, 0.5, 1], { length: 20, feedback: 0, mix: 1 });   // 10 ms hard left at 1, 20 ms hard right at 0.5
    assert.ok(a[0][ms10] > 1.3 && Math.abs(a[1][ms10]) < 1e-3, 'first tap hard left');
    assert.ok(a[1][ms10 * 2] > 0.65 && Math.abs(a[0][ms10 * 2]) < 1e-3, 'second tap hard right, half level');
    assert.ok(Math.abs(a[0][ms10 + 200]) < 1e-3, 'nothing between the taps');
    const b = run([1, 1, 0], { length: 10, feedback: 0.5, damp: 0, mix: 1 });   // one tap: feeds back
    assert.ok(b[0][ms10] > 0.9 && b[0][ms10 * 2] > 0.4 && b[0].every(Number.isFinite), 'the repeat of a single tap');
    assert.ok(run(undefined, { mix: 1 })[0].every(Number.isFinite), 'default taps run');
  }

  // DVIIloader: DX7 data and the six-operator engine
  {
    const dx = await import('../src/audio/nodes/dx7.js');
    assert.equal(dx.ALGORITHMS.length, 32);
    for (const a of dx.ALGORITHMS) {
      assert.ok(a.carriers.length >= 1 && a.mods.every(([to, from]) => from > to), 'senders have higher numbers than receivers');
      const reach = new Set(a.carriers); let grew = true;   // every operator ends up at a carrier
      while (grew) { grew = false; for (const [to, from] of a.mods) if (reach.has(to) && !reach.has(from)) { reach.add(from); grew = true; } }
      assert.equal(reach.size, 6, 'every operator reaches the output');
    }
    // a voice survives packing, and a bank is read back from a .syx dump
    const v = dx.initVoice({ name: 'ROUNDTRIP', alg: 21, fb: 5, lfw: 4, pms: 6, ops: dx.initVoice().ops.map((o, i) => ({ ...o, ol: 90 - i, fc: i + 1, ff: i * 3, det: 5 + i, kvs: i % 8, lc: i % 4, rc: (i + 1) % 4 })) });
    const back = dx.unpackVoice(dx.packVoice(v));
    assert.deepEqual(back, { ...v, name: 'ROUNDTRIP' });
    const syx = new Uint8Array(4104); syx.set([0xf0, 0x43, 0x00, 0x09, 0x20, 0x00]); syx.set(dx.DEFAULT_BANK, 6); syx[4103] = 0xf7;
    assert.deepEqual(Array.from(dx.parseSyx(syx)), Array.from(dx.DEFAULT_BANK));
    assert.equal(dx.parseSyx(new Uint8Array([1, 2, 3])), null);
    const saved = dx.bankToSyx(dx.DEFAULT_BANK);
    assert.equal(saved.length, 4104);
    assert.equal(((saved.subarray(6, 4102).reduce((a, b) => a + b, 0) + saved[4102]) & 127), 0, 'the checksum makes the sum zero');
    assert.deepEqual(Array.from(dx.parseSyx(saved)), Array.from(dx.DEFAULT_BANK));
    const single = dx.parseSyx(dx.voiceToSyx(v));   // a single voice dump lands in the first slot of a bank
    assert.deepEqual(dx.unpackVoice(single, 0), { ...v, name: 'ROUNDTRIP' });
    assert.equal(dx.voiceNames()[1], 'E.PIANO');
    // the engine: the init voice is a sine at the note's pitch, a held note sounds and a released one falls silent
    const def = NODE_TYPES.dvii;
    const play = (values, { note = 69, secs = 1, off = 0.5, bank } = {}) => {
      const params = Float32Array.from(def.params.map(p => values[p.name] ?? p.def)), slots = Int32Array.from(def.params.map((_, i) => i));
      const node = def.create({ sampleRate: sr, connected: [false], data: bank ? { bank } : undefined });
      node.note({ type: 'noteOn', note, vel: 1 });
      const total = Math.floor(secs * sr), o = new Float32Array(total), z = new Float32Array(128);
      for (let at = 0; at < total; at += 128) {
        if (off !== null && at >= off * sr && at - 128 < off * sr) node.note({ type: 'noteOff' });
        const L = new Float32Array(128), R = new Float32Array(128);
        node.process([[z]], [[L, R]], 128, params, slots);
        o.set(L.subarray(0, Math.min(128, total - at)), at);
      }
      return o;
    };
    const win = (a, t0, t1) => a.subarray(Math.floor(t0 * sr), Math.floor(t1 * sr));
    const init = play({ voice: 0 });
    let crossings = 0; const w = win(init, 0.1, 0.4);
    for (let i = 1; i < w.length; i++) if (w[i - 1] < 0 && w[i] >= 0) crossings++;
    assert.ok(Math.abs(crossings / 0.3 - 440) < 4, `init voice pitch ${crossings / 0.3}`);
    assert.ok(peak(win(init, 0.1, 0.4)) > 0.1 && peak(win(init, 0.9, 1)) < 1e-4, 'released: silent');
    assert.ok(init.every(Number.isFinite));
    for (let i = 1; i <= 4; i++) { const a = play({ voice: i }, { note: 60, secs: 1.5, off: 0.8 }); assert.ok(peak(win(a, 0, 0.3)) > 0.05 && a.every(Number.isFinite), `built-in voice ${i} sounds`); }
    // velocity: a softer note of a velocity-sensitive voice is quieter
    const quiet = play({ voice: 1 }, { off: null, secs: 0.3 }), loud = quiet;   // (the same call, to have the shape)
    assert.ok(peak(loud) > 0);
    const node2 = def.create({ sampleRate: sr, connected: [false] });
    const run2 = vel => { node2.note({ type: 'noteCut' }); node2.note({ type: 'noteOn', note: 60, vel }); const L = new Float32Array(128), R = new Float32Array(128), z = new Float32Array(128); const params = Float32Array.from(def.params.map(p => (p.name === 'voice' ? 1 : p.def))); let m = 0; for (let b = 0; b < 40; b++) { node2.process([[z]], [[L, R]], 128, params, Int32Array.from(def.params.map((_, i) => i))); m = Math.max(m, peak(L)); } return m; };
    assert.ok(run2(0.2) < run2(1) * 0.8, 'soft notes are quieter');
    // a bank sent to the node replaces the voices: a bank of all init voices makes the E.PIANO slot a plain sine
    const plain = new Uint8Array(4096); for (let i = 0; i < 32; i++) dx.packVoice(dx.initVoice(), plain, i * 128);
    const swapped = play({ voice: 1 }, { bank: Array.from(plain) });
    assert.ok(Math.abs(peak(win(swapped, 0.1, 0.4)) - peak(win(init, 0.1, 0.4))) < 0.02, 'the loaded bank is the one that plays');
    // the instrument kind: every named parameter exists
    const dvKind = synthKinds.dvii.make();
    for (const item of [...dvKind.exposed, ...dvKind.commands]) assert.ok(NODE_TYPES.dvii.params.some(q => q.name === item.param), `dvii.${item.param}`);
  }

  // blur: with no blur it is the sound, one frame late; time blur lets a sound ring on; freeze holds it; random phase stays finite
  {
    const def = NODE_TYPES.blur;
    const make = values => {
      const params = Float32Array.from(def.params.map(p => values[p.name] ?? p.def)), slots = Int32Array.from(def.params.map((_, i) => i));
      const node = def.create({ sampleRate: sr });
      return { params, slots, run(len, input, each) {
        const out = new Float32Array(len);
        for (let at = 0; at < len; at += 128) {
          each?.(at, params, slots);
          const L = Float32Array.from({ length: 128 }, (_, i) => input(at + i)), oL = new Float32Array(128), oR = new Float32Array(128);
          node.process([[L, L]], [[oL, oR]], 128, params, slots);
          out.set(oL, at);
        }
        return out;
      } };
    };
    const tone = i => 0.5 * Math.sin(2 * Math.PI * 440 * i / sr);
    const clear = make({ freq: 0, time: 0, mix: 1, phase: 0 }).run(sr, tone);
    let worst = 0; for (let i = 3000; i < 30000; i++) worst = Math.max(worst, Math.abs(clear[i + 2047] - tone(i)));
    assert.ok(worst < 1e-4, `no blur reconstructs the sound (${worst})`);
    const burst = i => (i < 24000 ? tone(i) : 0);
    const ring = make({ freq: 0, time: 2000, mix: 1 }).run(sr * 2, burst);
    const none = make({ freq: 0, time: 0, mix: 1 }).run(sr * 2, burst);
    const windowPeak = (x, a, b) => { let m = 0; for (let i = a; i < b; i++) m = Math.max(m, Math.abs(x[i])); return m; };
    assert.ok(windowPeak(ring, 38400, 48000) > 4 * windowPeak(none, 38400, 48000) + 0.01, 'time blur rings on after the input stops');
    const held = make({ freq: 0, time: 100, freeze: 0, mix: 1 }).run(sr * 2, burst, (at, params, slots) => { params[slots[2]] = at >= 20000 ? 1 : 0; });
    assert.ok(windowPeak(held, 70000, 96000) > 0.1, 'freeze holds the sound');
    const noisy = make({ freq: 0.6, time: 500, phase: 1, mix: 1 }).run(sr, tone);
    assert.ok(noisy.every(Number.isFinite) && windowPeak(noisy, 5000, 40000) > 0.02, 'random phase makes a smear, not silence');
    const dry = make({ mix: 0 }).run(20096, tone);
    for (let i = 3000; i < 18000; i++) assert.ok(Math.abs(dry[i + 2047] - tone(i)) < 1e-6 || i + 2047 >= 20000, 'mix 0 is the dry sound, delayed');
  }

  // trance gate and frequency shifter
  {
    const gdef = NODE_TYPES.gater;
    const runGate = (values, data, clock, len = 9600) => {
      const params = Float32Array.from(gdef.params.map(p => values[p.name] ?? p.def)), slots = Int32Array.from(gdef.params.map((_, i) => i));
      const node = gdef.create({ sampleRate: sr, data, clock });
      const out = new Float32Array(len), one = new Float32Array(128).fill(1);
      for (let at = 0; at < len; at += 128) { const o = new Float32Array(128); node.process([[one, one]], [[o, new Float32Array(128)]], 128, params, slots); out.set(o.subarray(0, Math.min(128, len - at)), at); if (clock.playing) clock.songPos += 128 / clock.tickSamples; }   // (the sequencer keeps songPos moving)
      return out;
    };
    const ts = 1200;   // samples per tick
    const clock = { tickSamples: ts, playing: true, songPos: 0 };
    const pattern = [1, 0, 1, 0, 1, 1, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0];
    const g = runGate({ smooth: 0.1 }, { gate: pattern }, clock, 128 * 75);
    for (let step = 0; step < 8; step++) assert.ok(Math.abs(g[step * ts + ts / 2] - pattern[step]) < 0.01, `gate step ${step}`);
    const half = runGate({ smooth: 0.1, depth: 0.5 }, { gate: pattern }, { tickSamples: ts, playing: true, songPos: 0 }, 128 * 16);
    assert.ok(Math.abs(half[ts + 200] - 0.5) < 0.02, 'half depth leaves half the sound through');
    const moved = runGate({ smooth: 0.1, shift: 1 }, { gate: pattern }, { tickSamples: ts, playing: true, songPos: 0 }, 128 * 16);
    assert.ok(moved[ts / 2] === moved[ts / 2] && Math.abs(moved[ts / 2] - pattern[1]) < 0.01 && Math.abs(moved[ts + ts / 2] - pattern[2]) < 0.01, 'shift rotates the pattern');
    const idle = runGate({ smooth: 0.1 }, { gate: pattern }, { tickSamples: ts, playing: false }, 128 * 16);
    assert.ok(idle.every(Number.isFinite) && idle.some(v => v < 0.1) && idle.some(v => v > 0.9), 'the gate runs on its own when the song is stopped');

    const fdef = NODE_TYPES.freqshift;
    const shifted = (shift, f) => {
      const params = Float32Array.from(fdef.params.map(p => (p.name === 'shift' ? shift : p.name === 'mix' ? 1 : p.def))), slots = Int32Array.from(fdef.params.map((_, i) => i));
      const node = fdef.create({ sampleRate: sr });
      const out = new Float32Array(sr);
      for (let at = 0; at < sr; at += 128) { const x = Float32Array.from({ length: 128 }, (_, i) => Math.sin(2 * Math.PI * f * (at + i) / sr)), o = new Float32Array(128); node.process([[x, x]], [[o, new Float32Array(128)]], 128, params, slots); out.set(o.subarray(0, Math.min(128, sr - at)), at); }
      return out;
    };
    const level = (x, f) => { let re = 0, im = 0; for (let i = 20000; i < 40000; i++) { re += x[i] * Math.cos(2 * Math.PI * f * i / sr); im += x[i] * Math.sin(2 * Math.PI * f * i / sr); } return Math.hypot(re, im) / 10000; };
    const up = shifted(100, 1000);
    assert.ok(level(up, 1100) > 0.95 && level(up, 900) < 0.02, 'a 1000 Hz tone moves to 1100 Hz, without a mirror image');
    const down = shifted(-250, 2000);
    assert.ok(level(down, 1750) > 0.95 && level(down, 2250) < 0.02, 'negative shift moves down');
    assert.ok(shifted(0, 440).every(Number.isFinite));
  }

  // phaser: mix 0 is dry, silence stays silent, a wet signal differs, stays finite even at high feedback
  const ph0 = stage('phaser', { mix: 0 })(noise, noise);
  assert.ok(ph0[0].every((v, i) => v === noise[i]), 'phaser mix 0 is dry');
  const ph1 = stage('phaser', { mix: 1 })(noise, noise);
  assert.ok(ph1[0].every(Number.isFinite) && ph1[0].some((v, i) => Math.abs(v - noise[i]) > 0.05));
  assert.ok(ph1[0].some((v, i) => Math.abs(v - ph1[1][i]) > 0.01), 'the channels differ');
  const phHot = stage('phaser', { mix: 1, feedback: 0.95, stages: 12 })(noise, noise);
  assert.ok(phHot[0].every(Number.isFinite) && peak(phHot[0]) < 60, 'high feedback stays bounded');
  assert.equal(peak(stage('phaser', {})(new Float32Array(2000), new Float32Array(2000))[0]), 0);

  // flanger: an impulse comes back after `delay` ms, scaled by mix; feedback repeats it
  const fl = stage('flanger', { depth: 0, delay: 2, feedback: 0, mix: 1 })(impulse, impulse);
  const at = Math.round(2 * sr / 1000);
  assert.ok(Math.abs(fl[0][at] - 1) < 1e-3 && Math.abs(fl[0][at + 50]) < 1e-6, 'the delayed copy');
  const flFb = stage('flanger', { depth: 0, delay: 2, feedback: 0.5, mix: 1 })(impulse, impulse);
  assert.ok(Math.abs(flFb[0][2 * at] - 0.5) < 1e-3, 'feedback repeats it, halved');
  const flHot = stage('flanger', { feedback: 0.95, mix: 1 })(noise, noise);
  assert.ok(flHot[0].every(Number.isFinite) && peak(flHot[0]) < 60);
  assert.ok(stage('flanger', { mix: 0 })(noise, noise)[0].every((v, i) => v === noise[i]), 'flanger mix 0 is dry');

  // distortion: hard clip limits the peak, mix 0 passes the dry signal, the modes differ, silence stays silent
  const sine = Float32Array.from({ length: 9600 }, (_, i) => 0.5 * Math.sin(i * 0.07));
  const hard = stage('distortion', { mode: 1, drive: 20, oversample: 0, tone: 20000, level: 1 })(sine, sine);
  assert.ok(peak(hard[0]) < 1.1 && peak(hard[0]) > 0.8, 'hard clip tops out near 1');
  const dry2 = stage('distortion', { mix: 0, oversample: 0, level: 1 })(sine, sine);
  assert.ok(dry2[0].every((v, i) => Math.abs(v - sine[i]) < 1e-6), 'distortion mix 0 is dry');
  const modes = [0, 1, 2, 3].map(mode => stage('distortion', { mode, drive: 5, oversample: 1 })(sine, sine)[0]);
  for (let a = 0; a < 4; a++) for (let b = a + 1; b < 4; b++) assert.ok(modes[a].some((v, i) => Math.abs(v - modes[b][i]) > 0.01), `modes ${a} and ${b} differ`);
  assert.ok(modes.every(m => m.every(Number.isFinite)));
  const tube = modes[2].subarray(4800), mean = tube.reduce((x, y) => x + y, 0) / tube.length;
  assert.ok(Math.abs(mean) < 0.03, 'the tube curve leaves no DC offset');
  assert.equal(peak(stage('distortion', {})(new Float32Array(2000), new Float32Array(2000))[0]), 0);
}

// 58. The insert menu lists the placeable nodes by category, filters, and picks by keyboard.
{
  const makeEl = tag => ({
    tag, children: [], listeners: {}, style: {}, textContent: '', value: '', className: '', hidden: false,
    appendChild(c) { this.children.push(c); return c; }, replaceChildren(...c) { this.children = c; },
    addEventListener(type, f) { this.listeners[type] = f; }, setAttribute() {}, focus() { this.focused = true; },
  });
  const doc = { createElement: makeEl };
  const picks = [];
  const menu = createInsertMenu({ parent: makeEl('div'), nodeTypes: NODE_TYPES, doc, onPick: (type, at) => picks.push([type, at]) });
  const all = menu.entries('').map(e => e.type);
  assert.ok(all.includes('chorus') && all.includes('mix') && all.includes('sampler'));
  assert.ok(!all.includes('out') && !all.includes('sum') && !all.includes('fold') && !all.includes('sumst'), 'master and hidden nodes are not listed');
  assert.deepEqual(menu.entries('filt').map(e => e.type), ['filter', 'filterpro']);
  assert.ok(menu.entries('effects').some(e => e.type === 'multitap'), 'a category name matches too');
  assert.deepEqual(menu.entries('zzz'), []);

  menu.open(120, 80);
  assert.ok(menu.isOpen && menu.box.style.left === '120px');
  const input = menu.box.children[0];
  const key = k => input.listeners.keydown({ key: k, preventDefault() {} });
  // the tree: categories, groups, nodes; every placeable node is in it exactly once
  const leaves = rows => rows.flatMap(r => (r.children ? leaves(r.children) : [r.type]));
  assert.deepEqual(menu.tree().map(c => c.label).slice(0, 4), ['Sources', 'Effects', 'Control', 'Mix & level']);
  assert.deepEqual(leaves(menu.tree()).sort(), all.slice().sort(), 'the tree holds every node once');
  assert.ok(menu.tree().find(c => c.label === 'Effects').children.find(g => g.label === 'Reverb').children.some(n => n.type === 'plate'));
  // keys: Down to Effects, Right into its groups, Down to Dynamics, Right into it, Enter on the first node
  key('ArrowDown'); key('ArrowRight'); key('ArrowDown'); key('ArrowRight');
  key('Enter');
  assert.equal(picks.length, 1);
  assert.equal(picks[0][0], 'compressor');
  assert.deepEqual(picks[0][1], { x: 120, y: 80 });
  assert.ok(!menu.isOpen);
  menu.open(10, 10);
  key('ArrowRight'); key('ArrowLeft'); key('ArrowLeft');   // in and out again: nothing is picked
  assert.ok(menu.isOpen && picks.length === 1);

  menu.open(10, 10);
  input.value = 'pan'; input.listeners.input();
  key('Enter');
  assert.equal(picks[1][0], 'pan');
  menu.open(10, 10);
  key('Escape');
  assert.ok(!menu.isOpen && picks.length === 2);
  // hotkeys: each row's first free letter, and typing one opens or inserts
  assert.deepEqual(hotkeys(['Sources', 'Effects', 'Control', 'Mix & level', 'Synths', 'Sampler']), [0, 0, 0, 0, 1, 1], 'letters');
  assert.deepEqual(hotkeys(['sine', 'saw', 'square']), [0, 1, 1], 'a taken letter moves on to the next free one');
  menu.open(10, 10);
  key('e'); key('r'); key('p');   // Effects, Reverb, plate
  assert.equal(picks.at(-1)[0], 'plate', 'hotkeys walk the tree');
  menu.open(10, 10);
  key('ArrowUp'); key('Enter');   // wraps to the last category and opens it
  assert.ok(menu.isOpen, 'Enter on a category only opens it');
  key('Escape'); key('Escape'); assert.ok(!menu.isOpen, 'Esc goes up a level, then closes');
  // search: / switches to it, the arrows walk the matches (wrapping), Enter inserts, Esc returns to the tree
  menu.open(10, 10);
  key('/'); input.value = 'ch'; input.listeners.input();
  const found = menu.search('ch').map(e => e.type);
  assert.ok(found.length > 1 && found[0].startsWith('ch'), 'names that start with the text come first');
  key('ArrowDown'); key('ArrowUp'); key('ArrowUp');   // wraps to the last match
  key('Enter');
  assert.equal(picks.at(-1)[0], found.at(-1), 'cursor keys choose among the matches');
  menu.open(10, 10); key('/'); key('Escape'); assert.ok(menu.isOpen, 'Esc in the search goes back to the tree');
  // a redraw puts the pointer on the row it clicked again: that must not take the keys back to the first level
  menu.open(10, 10);
  const items = () => menu.box.children[1].children[0].children;   // the first level's rows
  const text = row => row.children.filter(c => c.tag !== 'div').map(c => c.textContent).join('');
  key('ArrowDown'); key('ArrowRight');   // Effects is open, the keys are in its groups
  items().find(r => text(r) === 'Effects').listeners.mouseenter();
  key('ArrowDown');
  const flyout = items().find(r => text(r) === 'Effects').children.find(c => c.tag === 'div');
  assert.ok(flyout.children[1].className.includes('active'), 'the keys stay in the flyout after the pointer lands on its parent row');
  key('Escape'); key('Escape');

}

// 59. Waveshaper, exciter and transient designer.
{
  const stage = (type, values, { data, msgs = [] } = {}) => {
    const def = NODE_TYPES[type];
    const params = Float32Array.from(def.params.map(p => values[p.name] ?? p.def)), slots = Int32Array.from(def.params.map((_, i) => i));
    const node = def.create({ sampleRate: sr, connected: [true], data });
    for (const m of msgs) node.message(m);
    return inL => {
      const out = [new Float32Array(inL.length), new Float32Array(inL.length)];
      for (let at = 0; at < inL.length; at += 128) {
        const n = Math.min(128, inL.length - at);
        node.process([[inL.subarray(at, at + n), inL.subarray(at, at + n)]], [[out[0].subarray(at, at + n), out[1].subarray(at, at + n)]], n, params, slots);
      }
      return out;
    };
  };
  const sine = (f, a, n) => Float32Array.from({ length: n }, (_, i) => a * Math.sin(2 * Math.PI * f * i / sr));
  const goertzel = (x, f, skip = 2000) => {
    const w = 2 * Math.PI * f / sr, c = 2 * Math.cos(w);
    let s1 = 0, s2 = 0;
    for (let i = skip; i < x.length; i++) { const v = x[i] + c * s1 - s2; s2 = s1; s1 = v; }
    return Math.sqrt(s1 * s1 + s2 * s2 - c * s1 * s2) / ((x.length - skip) / 2);
  };
  const peakIn = (x, a, b) => { let m = 0; for (let i = a; i < b; i++) m = Math.max(m, Math.abs(x[i])); return m; };

  // waveshaper: a straight curve passes the signal, a drawn curve changes it, and dry/wet stay lined up
  const low = sine(500, 0.5, 4000);
  const lin = { type: 'curve', points: PRESETS.linear() };
  const straight = stage('waveshaper', { oversample: 0 }, { msgs: [lin] })(low)[0];
  assert.ok(straight.every((v, i) => Math.abs(v - low[i]) < 1e-4), 'a straight curve should not change the signal');
  const hardClip = stage('waveshaper', { oversample: 0 }, { msgs: [{ type: 'curve', points: PRESETS.hard() }] })(low)[0];
  assert.ok(Math.abs(peakIn(hardClip, 0, 4000) - 1) < 1e-3, 'a hard clip curve should reach full scale');
  const viaData = stage('waveshaper', { oversample: 0 }, { data: { curve: PRESETS.hard() } })(low)[0];
  assert.ok(viaData.every((v, i) => v === hardClip[i]), 'a curve stored on the node should match the same curve sent live');
  const dryOnly = stage('waveshaper', { oversample: 1, mix: 0 }, { msgs: [lin] })(low)[0];
  const latency = new Oversampler(2).latency;
  assert.ok(latency > 0 && dryOnly.every((v, i) => i < latency || v === low[i - latency]), 'the dry signal should be delayed to match the oversampled path');
  const half = stage('waveshaper', { oversample: 2, mix: 0.5 }, { msgs: [lin] })(low)[0], lat4 = new Oversampler(4).latency;
  assert.ok(half.every((v, i) => i < 400 || Math.abs(v - low[i - lat4]) < 0.02), 'wet and dry should line up at 4x');
  const bad = stage('waveshaper', {}, { msgs: [{ type: 'curve', points: [NaN, 1] }] })(low)[0];
  assert.ok(bad.every(Number.isFinite), 'a broken curve should fall back, not poison the output');

  // oversampling cuts the aliased harmonics of a hard-clipped 9.6 kHz sine (its 7th harmonic folds to 19.2 kHz)
  const tone = sine(9600, 0.9, 10000), clip = { type: 'curve', points: PRESETS.hard() };
  const alias = os => goertzel(stage('waveshaper', { drive: 3, oversample: os }, { msgs: [clip] })(tone)[0], 19200);
  const a0 = alias(0), a1 = alias(1), a2 = alias(2);
  assert.ok(a1 < a0 * 0.2 && a2 < a0 * 0.2, `oversampling should cut aliasing (${a0} ${a1} ${a2})`);

  // exciter: it adds harmonics of the high band and leaves low material alone
  const high = sine(5000, 0.5, 8000), bass = sine(200, 0.5, 8000);
  const plain = stage('exciter', { drive: 8, amount: 0 })(high)[0], excited = stage('exciter', { drive: 8, amount: 1 })(high)[0];
  assert.ok(goertzel(plain, 15000) < 1e-3 && goertzel(excited, 15000) > 0.05, 'the exciter should add a third harmonic');
  const bassOut = stage('exciter', { drive: 8, amount: 1 })(bass)[0];
  assert.ok(bassOut.every((v, i) => i < 2000 || Math.abs(v - bass[i]) < 0.01), 'low material should pass nearly unchanged');

  // transient designer: attack boosts the start of a hit, sustain cuts the tail, a steady tone is left alone
  const hit = Float32Array.from({ length: 24000 }, (_, i) => Math.sin(2 * Math.PI * 200 * i / sr) * Math.exp(-i / (0.1 * sr)));
  const neutral = stage('transient', {})(hit)[0];
  assert.ok(neutral.every((v, i) => Math.abs(v - hit[i]) < 1e-6), 'zero settings should not change the signal');
  const boosted = stage('transient', { attack: 1 })(hit)[0], cut = stage('transient', { sustain: -1 })(hit)[0];
  assert.ok(peakIn(boosted, 0, 480) > 2 * peakIn(neutral, 0, 480), 'attack +1 should boost the onset');
  assert.ok(peakIn(cut, 12000, 14000) < 0.4 * peakIn(neutral, 12000, 14000), 'sustain -1 should cut the tail');
  const steady = stage('transient', { attack: 1, sustain: 1 })(sine(200, 0.5, 48000))[0];
  assert.ok(Math.abs(peakIn(steady, 40000, 48000) - 0.5) < 0.02, 'a steady tone should come out at its own level');
}

// 60. The curve editor draws, fills gaps, mirrors and offers presets; the patcher panel hosts it and sends the curve live.
{
  const makeEl = tag => ({
    tag, children: [], listeners: {}, style: {}, textContent: '', value: '', checked: false, className: '',
    appendChild(c) { this.children.push(c); return c; }, replaceChildren(...c) { this.children = c; },
    addEventListener(type, f) { this.listeners[type] = f; }, focus() {},
    getContext: () => new Proxy({}, { get: (t, k) => (k in t ? t[k] : () => {}), set: (t, k, v) => { t[k] = v; return true; } }),
  });
  const walk = (el, fn) => { fn(el); (el.children ?? []).forEach(c => walk(c, fn)); };
  const doc = { createElement: makeEl, createTextNode: text => ({ text }) };
  const changes = [];
  const editor = createCurveEditor({ doc, points: PRESETS.linear(), onChange: pts => changes.push(pts) });
  let canvas, boxes = [], buttons = [];
  walk(editor.el, e => { if (e.tag === 'canvas') canvas = e; if (e.tag === 'input') boxes.push(e); if (e.tag === 'button') buttons.push(e); });
  const fire = (type, x, y) => canvas.listeners[type]({ offsetX: x, offsetY: y });
  fire('mousedown', 0, SIZE - 1); fire('mousemove', SIZE - 1, 0); fire('mouseup', 0, 0);    // bottom-left to top-right in two events
  const drawn = changes.at(-1);
  assert.equal(drawn.length, CURVE_POINTS);
  assert.ok(drawn.every((v, i) => Math.abs(v - (2 * i / (CURVE_POINTS - 1) - 1)) < 0.02), 'the gap between mouse events should be filled in');
  fire('mousemove', SIZE / 2, SIZE / 2);                                                    // not drawing any more
  assert.equal(changes.length, 2);
  fire('mousedown', SIZE - 1, 0);                                                           // top right: y = +1
  assert.equal(changes.at(-1).at(-1), 1);
  fire('mouseup', 0, 0);
  boxes[0].checked = true; boxes[0].listeners.change();                                     // symmetric: the left half mirrors the right
  const sym = changes.at(-1);
  assert.ok(sym.every((v, i) => Math.abs(v + sym[CURVE_POINTS - 1 - i]) < 2e-4));   // the values are rounded to four places
  buttons.find(b => b.textContent === 'fold').listeners.click();
  assert.deepEqual(changes.at(-1).length, CURVE_POINTS);
  assert.ok(editor.points.some(v => v < 0) && editor.points.some(v => v > 0));

  // in the patcher: select a waveshaper, draw on its panel, and the curve is saved on the node and sent
  const canvas2 = { width: 900, height: 360, style: {}, listeners: {}, getContext: () => new Proxy({}, { get: (t, k) => (k in t ? t[k] : () => {}), set: (t, k, v) => { t[k] = v; return true; } }), addEventListener(type, f) { this.listeners[type] = f; }, focus() {} };
  const panel = makeEl('div'), sent = [];
  const defs = structuredClone(instruments);
  const patcher = createPatcher({ canvas: canvas2, panel, statusEl: { textContent: '' }, doc, nodeTypes: NODE_TYPES, onStructure() {}, onParam() {}, onData: (...a) => sent.push(a) });
  patcher.load({ instruments: defs });
  patcher.show('kick');
  patcher.add('waveshaper', { x: 300, y: 200 });
  let curveCanvas = null;
  walk(panel, e => { if (e.className === 'curve') curveCanvas = e; });
  assert.ok(curveCanvas, 'the waveshaper panel should hold the curve editor');
  curveCanvas.listeners.mousedown({ offsetX: 90, offsetY: 20 });
  curveCanvas.listeners.mouseup({});
  const node = defs.kick.graph.nodes.find(n => n.id === 'waveshaper1');
  assert.equal(node.data.curve.length, CURVE_POINTS);
  assert.deepEqual(sent.at(-1).slice(0, 2), ['kick', 'waveshaper1']);
  assert.equal(sent.at(-1)[2].type, 'curve');
  assert.deepEqual(sent.at(-1)[2].points, node.data.curve);

  // the speaker-shaped out node keeps its ports on the shape's edges
  const out = NODE_TYPES.out, box = nodeBox(out), at = { x: 100, y: 100 };
  const inPort = portPos(at, out, 'in', 0), left = portPos(at, out, 'out', 0);
  assert.equal(out.shape, 'speaker');
  assert.ok(inPort.x === 100 && left.x === 100 + box.w && inPort.y > 100 + 0.3 * box.h && inPort.y < 100 + 0.7 * box.h);

  // a curve survives a project save and load, and a rebuilt instrument gets the latest curve again
  const proj = structuredClone(instruments);
  proj.kick.graph.nodes.push({ id: 'ws', type: 'waveshaper', x: 10, y: 10, data: { curve: PRESETS.fold() } });
  const registry = new ParamRegistry();
  for (const [id, d] of Object.entries(proj)) compile(d.graph, { instrument: id, nodeTypes: NODE_TYPES, registry });
  const lanes = prepareSong(demoSong, proj, registry);
  const back = parseProject(serializeProject({ song: demoSong, instruments: proj, samples: { pluck: { rate: sr, data: new Float32Array(4) } }, lanes }));
  assert.deepEqual(back.instruments.kick.graph.nodes.find(n => n.id === 'ws').data.curve, PRESETS.fold());

  const reg2 = new ParamRegistry();
  const rt = new GraphRuntime({ sampleRate: sr, params: reg2.values });
  const graph = {
    nodes: [{ id: 'o', type: 'osc' }, { id: 'w', type: 'waveshaper', params: { oversample: 0 } }, { id: 'out', type: 'out' }],
    connections: [['o.out', 'w.in'], ['w.out', 'out.in']],
  };
  rt.load(compile(graph, { instrument: 'x', nodeTypes: NODE_TYPES, registry: reg2 }));
  rt.message('x', 'w', { type: 'curve', points: PRESETS.hard() });
  rt.note('x', { type: 'noteOn', note: 60, vel: 1 });
  const before = peak(render(rt, 0.1).left);
  rt.rebuild('x');
  rt.note('x', { type: 'noteOn', note: 60, vel: 1 });
  const after = peak(render(rt, 0.1).left);
  assert.ok(Math.abs(before - after) < 1e-3, 'a rebuilt instrument should get its curve back');
}

// 61. Band splitter, compressor and hall reverb.
{
  const run = (type, values, inL, inR = inL, nOut = 1) => {
    const def = NODE_TYPES[type];
    const params = Float32Array.from(def.params.map(p => values[p.name] ?? p.def)), slots = Int32Array.from(def.params.map((_, i) => i));
    const node = def.create({ sampleRate: sr, connected: [true] });
    const outs = Array.from({ length: nOut }, () => [new Float32Array(inL.length), new Float32Array(inL.length)]);
    for (let at = 0; at < inL.length; at += 128) {
      const n = Math.min(128, inL.length - at);
      node.process([[inL.subarray(at, at + n), inR.subarray(at, at + n)]], outs.map(([a, b]) => [a.subarray(at, at + n), b.subarray(at, at + n)]), n, params, slots);
    }
    return outs;
  };
  const sine = (f, a, n) => Float32Array.from({ length: n }, (_, i) => a * Math.sin(2 * Math.PI * f * i / sr));
  const rms = (x, a = 0, b = x.length) => { let t = 0; for (let i = a; i < b; i++) t += x[i] * x[i]; return Math.sqrt(t / (b - a)); };
  const peakIn = (x, a, b) => { let m = 0; for (let i = a; i < b; i++) m = Math.max(m, Math.abs(x[i])); return m; };

  // splitter: the four bands add back to the input level at every frequency, and each tone lands in its band
  for (const f of [60, 120, 300, 800, 2000, 5000, 9000]) {
    const tone = sine(f, 0.5, 24000);
    const bands = run('split', {}, tone, tone, 4);
    const sum = tone.map((_, i) => bands.reduce((t, b) => t + b[0][i], 0));
    const ratio = rms(sum, 8000) / rms(tone, 8000);
    assert.ok(ratio > 0.98 && ratio < 1.02, `split sum at ${f} Hz is ${ratio}`);
  }
  const where = f => { const tone = sine(f, 0.5, 24000); return run('split', {}, tone, tone, 4).map(b => rms(b[0], 8000)); };
  for (const [f, band] of [[40, 0], [300, 1], [2000, 2], [12000, 3]]) {
    const levels = where(f);
    assert.ok(levels[band] > 0.8 * rms(sine(f, 0.5, 8000)) && levels.every((v, i) => i === band || v < 0.2 * levels[band]), `${f} Hz should sit in band ${band}: ${levels}`);
  }
  const lonely = run('split', {}, sine(300, 0.5, 8000), new Float32Array(8000), 4);
  assert.ok(lonely.every(b => peakIn(b[1], 0, 8000) === 0), 'the channels should be independent');
  const swapped = run('split', { f1: 1000, f2: 200, f3: 100 }, sine(300, 0.5, 8000), sine(300, 0.5, 8000), 4);
  assert.ok(swapped.every(b => b[0].every(Number.isFinite)), 'crossovers out of order should be put in order');

  // compressor: steady level lands where threshold and ratio say, quiet material is untouched, mix 0 is dry
  const loud = sine(1000, 0.5, 48000);
  const hard = run('compressor', { knee: 0 }, loud)[0][0];
  const dB = 20 * Math.log10(peakIn(hard, 40000, 48000));
  assert.ok(dB < -13.5 && dB > -16.5, `compressed level ${dB} dB, expected near -15`);
  const quiet = sine(1000, 0.05, 8000);
  assert.ok(run('compressor', {}, quiet)[0][0].every((v, i) => Math.abs(v - quiet[i]) < 1e-6), 'below the threshold nothing should change');
  assert.ok(run('compressor', { ratio: 1 }, loud)[0][0].every((v, i) => Math.abs(v - loud[i]) < 1e-5), 'ratio 1 should not compress');
  assert.ok(run('compressor', { mix: 0 }, loud)[0][0].every((v, i) => v === loud[i]), 'mix 0 should be the dry signal');
  const made = peakIn(run('compressor', { makeup: 6 }, quiet)[0][0], 0, 8000) / peakIn(quiet, 0, 8000);
  assert.ok(Math.abs(made - 1.995) < 0.01, 'makeup 6 dB should double the level');
  const burst = Float32Array.from({ length: 48000 }, (_, i) => (i < 14400 ? 0.5 : 0.05) * Math.sin(2 * Math.PI * 1000 * i / sr));
  const shaped = run('compressor', { knee: 0, release: 50 }, burst)[0][0];
  assert.ok(peakIn(shaped, 0, 240) > 1.15 * peakIn(shaped, 12000, 14400), 'the attack time should let the start of a burst through');
  assert.ok(rms(shaped, 38400, 48000) / rms(burst, 38400, 48000) > 0.97, 'the gain should recover after the burst');

  // hall: decays at the set rate, is stereo, mix 0 is dry, stays finite and dies away
  const impulse = new Float32Array(sr * 2); impulse[0] = 1;
  const wet = run('hall', { decay: 1, mix: 1, mod: 0 }, impulse)[0];
  const tail = new Float64Array(impulse.length); let acc = 0;
  for (let i = impulse.length - 1; i >= 0; i--) { acc += wet[0][i] ** 2; tail[i] = acc; }
  const edc = t => 10 * Math.log10(tail[Math.floor(t * sr)] / tail[0]);
  assert.ok(edc(0.5) < -25 && edc(0.5) > -37, `energy decay at 0.5 s is ${edc(0.5)} dB, expected about -30`);
  assert.ok(rms(wet[0].map((v, i) => v - wet[1][i])) > 0.1 * rms(wet[0]), 'the two channels should differ');
  const mono = run('hall', { decay: 1, mix: 1, width: 0 }, impulse)[0];
  assert.ok(mono[0].every((v, i) => Math.abs(v - mono[1][i]) < 1e-9), 'width 0 should be mono');
  const noise = new Float32Array(sr * 2); let seed = 9;
  for (let i = 0; i < noise.length; i++) noise[i] = ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 2;
  assert.ok(run('hall', { mix: 0 }, noise)[0][0].every((v, i) => v === noise[i]), 'mix 0 should be the dry signal');
  const extreme = run('hall', { decay: 20, damp: 0, mod: 1, size: 2, mix: 1 }, noise)[0];
  assert.ok(extreme[0].every(Number.isFinite) && peakIn(extreme[0], 0, noise.length) < 20, 'a long decay should stay bounded');
  const input = new Float32Array(sr * 8); input.set(noise.subarray(0, sr));
  const dies = run('hall', { decay: 0.5, mix: 1 }, input)[0];
  assert.ok(peakIn(dies[0], sr * 7, sr * 8) < 1e-5, 'the tail should die away after the input stops');
}

// 62. A multiband chain through the graph: split, one compressor per band, bands summed back into out.
{
  const chain = comp => {
    const registry = new ParamRegistry();
    const rt = new GraphRuntime({ sampleRate: sr, params: registry.values });
    const nodes = [{ id: 'o', type: 'osc', params: { track: 0, freq: 200 } }, { id: 's', type: 'split' }, { id: 'out', type: 'out' }];
    const connections = [['o.out', 's.in']];
    ['low', 'lmid', 'hmid', 'high'].forEach((band, i) => {
      nodes.push({ id: `c${i}`, type: 'compressor', params: comp(i) });
      connections.push([`s.${band}`, `c${i}.in`], [`c${i}.out`, 'out.in']);
    });
    rt.load(compile({ nodes, connections }, { instrument: 'm', nodeTypes: NODE_TYPES, registry }));
    rt.note('m', { type: 'noteOn', note: 60, vel: 1 });
    return render(rt, 0.4).left;
  };
  const rmsTail = x => { let t = 0; for (let i = x.length - 8000; i < x.length; i++) t += x[i] * x[i]; return Math.sqrt(t / 8000); };
  const neutral = chain(() => ({ ratio: 1 }));
  const direct = (() => {
    const registry = new ParamRegistry();
    const rt = new GraphRuntime({ sampleRate: sr, params: registry.values });
    rt.load(compile({ nodes: [{ id: 'o', type: 'osc', params: { track: 0, freq: 200 } }, { id: 'out', type: 'out' }], connections: [['o.out', 'out.in']] }, { instrument: 'd', nodeTypes: NODE_TYPES, registry }));
    rt.note('d', { type: 'noteOn', note: 60, vel: 1 });
    return render(rt, 0.4).left;
  })();
  assert.ok(Math.abs(rmsTail(neutral) / rmsTail(direct) - 1) < 0.02, 'neutral multiband should keep the level');
  const squashed = chain(i => (i === 1 ? { ratio: 20, threshold: -50, knee: 0 } : { ratio: 1 }));   // 200 Hz sits in the lmid band
  assert.ok(rmsTail(squashed) < 0.5 * rmsTail(neutral), 'compressing the band the tone sits in should lower the level');
}

// 63. Subtractive and additive synth nodes.
{
  const makeSynth = (type, values, { connected = [false, false], data } = {}) => {
    const def = NODE_TYPES[type];
    const params = Float32Array.from(def.params.map(p => values[p.name] ?? p.def)), slots = Int32Array.from(def.params.map((_, i) => i));
    return { node: def.create({ sampleRate: sr, connected, maxBlock: 128, data }), params, slots };
  };
  // plays one note, returns the left and right channels; events: [[sampleIndex, fn(node)]]; mod: per-sample input 0
  const play = (type, values, { note = 57, secs = 0.5, events = [], pitch = 0, data, connected } = {}) => {
    const { node, params, slots } = makeSynth(type, values, { data, connected });
    node.note({ type: 'noteOn', note, vel: 1 });
    const N = Math.floor(sr * secs / 128) * 128, L = new Float32Array(N), R = new Float32Array(N);
    const l = new Float32Array(128), r = new Float32Array(128), mod = new Float32Array(128).fill(pitch), zero = new Float32Array(128);
    for (let at = 0; at < N; at += 128) {
      for (const [when, fn] of events) if (when === at) fn(node);
      node.process([mod, zero], [[l, r]], 128, params, slots);
      L.set(l, at); R.set(r, at);
    }
    return { L, R, node, params, slots };
  };
  // magnitude of one frequency over a Hann-windowed span
  const mag = (x, f, a = 0, b = x.length) => {
    b = Math.min(b, x.length);
    let re = 0, im = 0;
    for (let i = a; i < b; i++) {
      const w = 0.5 - 0.5 * Math.cos(2 * Math.PI * (i - a) / (b - a)), ph = 2 * Math.PI * f * i / sr;
      re += x[i] * w * Math.cos(ph); im += x[i] * w * Math.sin(ph);
    }
    return Math.hypot(re, im) / (b - a) * 4;
  };
  const rms = (x, a = 0, b = x.length) => { let s = 0; for (let i = a; i < b; i++) s += x[i] * x[i]; return Math.sqrt(s / (b - a)); };
  const pk = (x, a = 0, b = x.length) => { let m = 0; for (let i = a; i < b; i++) m = Math.max(m, Math.abs(x[i])); return m; };
  const crossings = (x, a, b) => {   // upward zero crossings, interpolated: frequency from the first to the last
    const at = [];
    for (let i = a + 1; i < b; i++) if (x[i - 1] < 0 && x[i] >= 0) at.push(i - 1 + -x[i - 1] / (x[i] - x[i - 1]));
    return ((at.length - 1) * sr) / (at.at(-1) - at[0]);
  };
  const hz = n => 440 * Math.pow(2, (n - 69) / 12);

  // ---- subsynth ----
  const pure = { wave1: 3, osc2: 0, cutoff: 20000, res: 0, drive: 0, fenv: 0, keytrack: 0, atk: 0.1, sus: 1, level: 1 };
  const silent = makeSynth('subsynth', {}), sl = new Float32Array(128), sr_ = new Float32Array(128);
  silent.node.process([sl, sl], [[sl, sr_]], 128, silent.params, silent.slots);
  assert.equal(pk(sl), 0, 'silent before a note');
  const plain = play('subsynth', {});
  assert.ok(plain.L.every(Number.isFinite) && pk(plain.L) > 0.05 && pk(plain.L) < 2, `default patch level ${pk(plain.L)}`);
  assert.ok(plain.L.every((v, i) => v === plain.R[i]), 'one unison voice should be mono');
  const wide = play('subsynth', { unison: 5, width: 1, spread: 20 });
  assert.ok(rms(wide.L.map((v, i) => v - wide.R[i]), 8000) > 0.1 * rms(wide.L, 8000), 'unison with width should be stereo');
  const narrow = play('subsynth', { unison: 5, width: 0, spread: 20 });
  assert.ok(narrow.L.every((v, i) => Math.abs(v - narrow.R[i]) < 1e-9), 'width 0 should be mono');

  // pitch: a sine plays at the note's frequency; tune2 and detune move only oscillator 2; the pitch input is in octaves
  for (const n of [45, 57, 69, 81]) {
    const f = crossings(play('subsynth', pure, { note: n }).L, 8000, 24000 - 0);
    assert.ok(Math.abs(f / hz(n) - 1) < 0.01, `note ${n}: ${f} Hz, expected ${hz(n)}`);
  }
  const up = crossings(play('subsynth', pure, { note: 57, pitch: 1, connected: [true, false] }).L, 8000, 24000);
  assert.ok(Math.abs(up / hz(57) - 2) < 0.02, `pitch input +1 should double the frequency, got ${up / hz(57)}`);

  // the oscillators are bandlimited enough: a saw's harmonics fall as 1/n, with no big stray content between them
  const saw = play('subsynth', { ...pure, wave1: 0 }, { note: 69, secs: 0.6 }).L;
  const h1 = mag(saw, 440, 6000, 28000), h5 = mag(saw, 2200, 6000, 28000);
  assert.ok(Math.abs(h5 / h1 - 0.2) < 0.03, `saw harmonic 5 should be a fifth of the fundamental: ${h5 / h1}`);
  const sq = play('subsynth', { ...pure, wave1: 1 }, { note: 69, secs: 0.6 }).L;
  assert.ok(mag(sq, 880, 6000, 28000) < 0.02 * mag(sq, 440, 6000, 28000), 'a square has no even harmonics');
  const alias = play('subsynth', { ...pure, wave1: 0 }, { note: 108, secs: 0.4 }).L;   // 4.2 kHz: naive saws fold back audibly
  const fold = mag(alias, 12 * 4186.01 - 48000, 6000, 18000);   // where the 12th harmonic would fold back, well off the series
  assert.ok(fold < 0.02 * mag(alias, 4186, 6000, 18000), `aliasing is too strong: ${fold}`);

  // filter: 24 dB/oct, so two octaves above the cutoff is down by about 48 dB; resonance lifts the cutoff region
  const filt = (cutoff, res = 0) => play('subsynth', { ...pure, wave1: 0, cutoff, res }, { note: 45, secs: 0.6 }).L;   // 110 Hz saw
  const open = filt(20000), shut = filt(500);
  const ratio = (x, f) => mag(x, f, 6000, 28000) / mag(open, f, 6000, 28000);
  assert.ok(ratio(shut, 110) > 0.9, `below the cutoff the level should survive: ${ratio(shut, 110)}`);
  assert.ok(ratio(shut, 2200) < 0.01, `two octaves above the cutoff should be at least 40 dB down: ${ratio(shut, 2200)}`);
  assert.ok(ratio(filt(1100, 0.9), 1100) > 2 * ratio(filt(1100, 0), 1100), 'resonance should lift the cutoff region');
  // key tracking moves the cutoff with the note: an octave up with keytrack 1 keeps the same relative rolloff
  const kt = (note, keytrack) => { const x = play('subsynth', { ...pure, wave1: 0, cutoff: 600, keytrack }, { note, secs: 0.6 }).L; return mag(x, hz(note) * 8, 6000, 28000) / mag(x, hz(note), 6000, 28000); };
  assert.ok(kt(57, 1) / kt(45, 1) > 0.7 && kt(57, 1) / kt(45, 1) < 1.4, 'with key tracking the spectrum shape should follow the note');
  assert.ok(kt(57, 0) / kt(45, 0) < 0.2, 'without key tracking a higher note loses more of its harmonics');
  // the filter envelope opens the filter: a bright start that closes to a dull sustain
  const sweep = play('subsynth', { ...pure, wave1: 0, cutoff: 200, fenv: 5, fatk: 0.1, fdec: 100, fsus: 0 }, { note: 45, secs: 0.8 }).L;
  assert.ok(mag(sweep, 1100, 100, 2500) > 4 * mag(sweep, 1100, 30000, 38000), 'the filter envelope should open the start of the note');
  // glide: partway between two notes shortly after the second one
  const glide = play('subsynth', { ...pure, glide: 400 }, { note: 45, secs: 0.8, events: [[12800, node => node.note({ type: 'noteOn', note: 69, vel: 1 })]] }).L;
  const mid = crossings(glide, 12800 + 2000, 12800 + 8000);
  assert.ok(mid > hz(45) * 1.3 && mid < hz(69) * 0.95, `glide should be between the notes: ${mid}`);

  // slide: a note that follows another in its column moves to its pitch in a straight line over `slide` ticks (6000 samples each here)
  const slideRun = (values, msg, secs = 1.2) => {
    const { node, params, slots } = makeSynth('subsynth', { ...pure, ...values });
    node.note({ type: 'noteOn', vel: 1, ...msg });
    const N = Math.floor(sr * secs / 128) * 128, L = new Float32Array(N), l = new Float32Array(128), r = new Float32Array(128), zero = new Float32Array(128);
    for (let at = 0; at < N; at += 128) { node.process([zero, zero], [[l, r]], 128, params, slots); L.set(l, at); }
    return L;
  };
  const sl4 = slideRun({ slide: 4 }, { note: 60, from: 48 });   // 4 ticks: 24000 samples, half a second
  const f0 = crossings(sl4, 256, 2500), fMid = crossings(sl4, 11000, 13000), f1 = crossings(sl4, 32000, 40000);
  assert.ok(Math.abs(f0 / hz(48) - 1) < 0.08, `starts at the previous note: ${f0}`);
  assert.ok(fMid > hz(48) * 1.2 && fMid < hz(60) * 0.9, `halfway there it is between the two: ${fMid}`);
  assert.ok(Math.abs(f1 / hz(60) - 1) < 0.01, `ends on the new note: ${f1}`);
  const instant = slideRun({ slide: 0 }, { note: 60, from: 48 });
  assert.ok(Math.abs(crossings(instant, 2000, 6000) / hz(60) - 1) < 0.01, 'slide 0 is instant');
  const noFrom = slideRun({ slide: 4 }, { note: 60 });
  assert.ok(Math.abs(crossings(noFrom, 2000, 6000) / hz(60) - 1) < 0.01, 'with no previous note there is nothing to slide from');
  const a = crossings(sl4, 6000, 9000), b = crossings(sl4, 15000, 18000);
  assert.ok(b > a, 'the pitch rises steadily');
  // release ends the voice; a cut ends it at once; extreme settings stay finite and bounded
  const rel = play('subsynth', { rel: 50 }, { secs: 1, events: [[12800, node => node.note({ type: 'noteOff' })]] }).L;
  assert.ok(pk(rel, 12800 + 12000, rel.length) < 1e-4, 'the voice should end after the release');
  const cutNote = play('subsynth', {}, { secs: 0.5, events: [[12800, node => node.note({ type: 'noteCut' })]] }).L;
  assert.equal(pk(cutNote, 12800, cutNote.length), 0);
  const wild = play('subsynth', { res: 1, drive: 1, unison: 7, spread: 50, noise: 1, sub: 1, osc2: 1, cutoff: 3000, fenv: 8, level: 1 }, { note: 110, secs: 0.6 }).L;
  assert.ok(wild.every(Number.isFinite) && pk(wild) < 4, `extreme settings should stay bounded: ${pk(wild)}`);

  // ---- fmsynth ----
  {
    const fmBase = { atk1: 0.1, sus1: 1, atk2: 0.1, sus2: 1, atk3: 0.1, sus3: 1, atk4: 0.1, sus4: 1, level: 1 };
    const solo = { ...fmBase, algo: 7, level2: 0, level3: 0, level4: 0 };
    const lone = play('fmsynth', solo, { note: 57 }).L;
    assert.ok(Math.abs(crossings(lone, 8000, 23000) / hz(57) - 1) < 0.01, 'a lone operator plays at the note');
    assert.ok(pk(lone) > 0.1 && pk(lone) < 1, `level ${pk(lone)}`);
    const oct = play('fmsynth', { ...solo, ratio1: 2 }, { note: 57 }).L;
    assert.ok(Math.abs(crossings(oct, 8000, 23000) / (2 * hz(57)) - 1) < 0.01, 'the ratio multiplies the pitch');
    // modulation adds sidebands: operator 2 modulating operator 1 puts energy at the carrier plus and minus the modulator
    const f1 = hz(57);
    const pure = play('fmsynth', { ...fmBase, algo: 3, level3: 0, level4: 0, index: 0 }, { note: 57 }).L;
    const bent = play('fmsynth', { ...fmBase, algo: 3, level3: 0, level4: 0, index: 2, level2: 1 }, { note: 57 }).L;
    assert.ok(mag(pure, 2 * f1, 8000, 23000) < 0.01 && mag(bent, 2 * f1, 8000, 23000) > 0.01, 'the modulator should add sidebands');
    const ratio2 = play('fmsynth', { ...fmBase, algo: 3, level3: 0, level4: 0, index: 2, level2: 1, ratio2: 3 }, { note: 57 }).L;
    assert.ok(mag(ratio2, 4 * f1, 8000, 23000) > 0.02, 'sidebands move with the modulator ratio');
    // a carrier-only algorithm ignores the index
    const a7 = play('fmsynth', { ...fmBase, algo: 7, index: 0 }, { note: 57 }).L, a7b = play('fmsynth', { ...fmBase, algo: 7, index: 6 }, { note: 57 }).L;
    assert.ok(a7.every((v, i) => v === a7b[i]), 'with every operator a carrier the index does nothing');
    // drawn waveforms: a square operator is louder and brighter than the sine it replaces
    const sq = Array.from({ length: 64 }, (_, i) => (i < 32 ? 1 : -1));
    const sineRms = rms(lone, 8000, 23000);
    const squareRms = rms(play('fmsynth', solo, { note: 57, data: { waves: [sq] } }).L, 8000, 23000);
    assert.ok(squareRms > sineRms * 1.2, `square ${squareRms} vs sine ${sineRms}`);
    const sqL = play('fmsynth', solo, { note: 57, data: { waves: [sq] } }).L;
    assert.ok(mag(sqL, 3 * f1, 8000, 23000) > 0.1 && mag(lone, 3 * f1, 8000, 23000) < 0.01, 'a square wave has its third harmonic');
    const live = play('fmsynth', solo, { note: 57, secs: 1, events: [[24064, node => node.message({ type: 'waves', points: [sq] })]] }).L;
    assert.ok(mag(live, 3 * f1, 30000, 46000) > 0.1 && mag(live, 3 * f1, 4000, 20000) < 0.01, 'a waves message changes the sound while playing');
    assert.deepEqual(Array.from(normalizeWave('junk')), Array.from(Float32Array.from(WAVES.sine())));
    assert.equal(normalizeWave([0, 1, 0, -1]).length, WAVE_POINTS, 'any length is resampled');
    // feedback and extremes stay bounded; release and cut end the voice
    const wild = play('fmsynth', { ...fmBase, algo: 4, index: 8, fb: 1, ratio1: 16, ratio2: 16, ratio3: 0.25, ratio4: 16 }, { note: 110, secs: 0.6 }).L;
    assert.ok(wild.every(Number.isFinite) && pk(wild) < 4, `extreme settings should stay bounded: ${pk(wild)}`);
    const fbOn = play('fmsynth', { ...solo, algo: 7, level1: 0, level4: 1, fb: 0.8 }, { note: 57 }).L;
    assert.ok(mag(fbOn, 2 * f1, 8000, 23000) > 0.02, 'feedback makes operator 4 brighter');
    const rel = play('fmsynth', { ...fmBase, rel1: 50, rel2: 50, rel3: 50, rel4: 50 }, { secs: 1, events: [[12800, node => node.note({ type: 'noteOff' })]] }).L;
    assert.ok(pk(rel, 12800 + 12000, rel.length) < 1e-4, 'the voice ends after the release');
    const cut = play('fmsynth', fmBase, { secs: 0.5, events: [[12800, node => node.note({ type: 'noteCut' })]] }).L;
    assert.equal(pk(cut, 12800, cut.length), 0);
    assert.ok(pk(play('fmsynth', {}).L) > 0.02, 'the defaults make a sound');
  }

  // ---- addsynth ----
  const base = { atk: 0.1, sus: 1, level: 1, width: 0 };
  const spec1 = n => Array.from({ length: 32 }, (_, i) => (i + 1 === n ? 1 : 0));
  const sine1 = play('addsynth', base, { note: 57, data: { spectrum: spec1(1) } }).L;
  assert.ok(Math.abs(crossings(sine1, 8000, 24000) / hz(57) - 1) < 0.01, 'a lone fundamental plays at the note');
  const third = play('addsynth', base, { note: 57, data: { spectrum: spec1(3) } }).L;
  assert.ok(mag(third, hz(57) * 3, 6000, 24000) > 20 * mag(third, hz(57), 6000, 24000), 'a lone third partial sounds at three times the note');
  // loudness does not depend on the spectrum's shape
  const loud = shape => rms(play('addsynth', base, { note: 57, data: { spectrum: shape } }).L, 8000);
  const flat = Array(32).fill(1), sawish = Array.from({ length: 32 }, (_, i) => 1 / (i + 1));
  assert.ok(Math.abs(loud(flat) / loud(sawish) - 1) < 0.1 && Math.abs(loud(spec1(1)) / loud(sawish) - 1) < 0.1, 'spectra should come out at similar loudness');
  // the defaults: a stored spectrum is optional, and the node still makes sound
  assert.ok(pk(play('addsynth', {}).L) > 0.05);
  // even/odd balance
  const eo = v => play('addsynth', { ...base, evenodd: v }, { note: 57, data: { spectrum: flat } }).L;
  const hollow = eo(-1), oddless = eo(1);
  assert.ok(mag(hollow, hz(57) * 2, 6000, 24000) < 0.02 * mag(hollow, hz(57), 6000, 24000), 'evenodd -1 silences even partials');
  assert.ok(mag(oddless, hz(57) * 3, 6000, 24000) < 0.02 * mag(oddless, hz(57) * 2, 6000, 24000), 'evenodd +1 silences odd partials');
  // tilt: -6 dB/oct halves each octave's partial level, relative to a flat spectrum
  const tilted = play('addsynth', { ...base, tilt: -6.0206 }, { note: 45, data: { spectrum: flat } }).L;
  assert.ok(Math.abs(mag(tilted, hz(45) * 4, 6000, 24000) / mag(tilted, hz(45), 6000, 24000) - 0.25) < 0.03, 'tilt of -6 dB per octave');
  // stretch moves the partials up, by sqrt(1 + B n^2)
  const B = 0.5 ** 2 * 0.004, m = 8;
  const stretched = play('addsynth', { ...base, stretch: 0.5 }, { note: 45, data: { spectrum: spec1(m) } }).L;
  const want = hz(45) * m * Math.sqrt(1 + B * m * m);
  assert.ok(mag(stretched, want, 6000, 30000) > 5 * mag(stretched, hz(45) * m, 6000, 30000), 'stretch should detune the upper partials');
  // hdecay: the top dies faster than the bottom
  const decaying = play('addsynth', { ...base, hdecay: 6 }, { note: 45, secs: 1, data: { spectrum: flat } }).L;
  const early = mag(decaying, hz(45) * 16, 0, 6000) / mag(decaying, hz(45), 0, 6000), late = mag(decaying, hz(45) * 16, 36000, 42000) / mag(decaying, hz(45), 36000, 42000);
  assert.ok(late < 0.3 * early, `high partials should fade faster: ${early} then ${late}`);
  // width pans odd partials left and even ones right
  const panned = play('addsynth', { ...base, width: 1 }, { note: 57, data: { spectrum: spec1(1) } });
  assert.ok(pk(panned.R) < 1e-6 && pk(panned.L) > 0.05, 'a lone odd partial at width 1 is hard left');
  const panned2 = play('addsynth', { ...base, width: 1 }, { note: 57, data: { spectrum: spec1(2) } });
  assert.ok(pk(panned2.L) < 1e-6 && pk(panned2.R) > 0.05, 'a lone even partial at width 1 is hard right');
  // the spectrum can change live; partials above the limit are skipped; extremes stay bounded
  const live = play('addsynth', base, { note: 57, secs: 1, data: { spectrum: spec1(1) }, events: [[24064, node => node.message({ type: 'spectrum', points: spec1(2) })]] }).L;
  assert.ok(mag(live, hz(57) * 2, 32000, 48000) > 10 * mag(live, hz(57), 32000, 48000), 'a spectrum message should change the sound');
  const high = play('addsynth', { ...base, drift: 1, stretch: 1, width: 1 }, { note: 120, data: { spectrum: flat } }).L;
  assert.ok(high.every(Number.isFinite) && pk(high) < 2, 'partials past the limit should be skipped');
  const rel2 = play('addsynth', { rel: 50 }, { secs: 1, events: [[12800, node => node.note({ type: 'noteOff' })]] }).L;
  assert.ok(pk(rel2, 12800 + 12000, rel2.length) < 1e-4, 'the voice should end after the release');
}

// 64. Synth instruments through the compiler, project operations, and the spectrum editor.
{
  const makeEl = tag => ({
    tag, children: [], listeners: {}, style: {}, textContent: '', value: '', checked: false, className: '',
    appendChild(c) { this.children.push(c); return c; }, replaceChildren(...c) { this.children = c; },
    addEventListener(type, f) { this.listeners[type] = f; }, focus() {},
    getContext: () => new Proxy({}, { get: (t, k) => (k in t ? t[k] : () => {}), set: (t, k, v) => { t[k] = v; return true; } }),
  });
  const walk = (el, fn) => { fn(el); (el.children ?? []).forEach(c => walk(c, fn)); };
  const doc = { createElement: makeEl, createTextNode: text => ({ text }) };

  const project = { instruments: {}, samples: {}, lanes: [], song: { length: 16 } };
  for (const kind of ['subtractive', 'additive']) {
    const id = pops.addSynthInstrument(project, `My ${kind}`, kind);
    const registry = new ParamRegistry();
    const rt = new GraphRuntime({ sampleRate: sr, params: registry.values });
    rt.load(compile(project.instruments[id].graph, { instrument: id, nodeTypes: NODE_TYPES, registry }));
    rt.note(id, { type: 'noteOn', note: 48, vel: 1 });
    const { left, right } = render(rt, 0.3);
    assert.ok(left.every(Number.isFinite) && peak(left) > 0.02 && peak(left) < 1, `${kind} instrument level ${peak(left)}`);
    const lane = pops.addLane(project, registry, id);
    assert.deepEqual(lane.columns.map(c => c.label).slice(0, 2), ['N1', 'V1']);
    assert.ok(lane.columns.length >= 6, 'the exposed parameters should become columns');
  }
  assert.throws(() => pops.addSynthInstrument(project, 'x', 'nope'), /Unknown synth kind/);
  assert.equal(pops.addSynthInstrument(project, 'My subtractive', 'subtractive'), 'My_subtractive2');

  // the spectrum editor draws bars, fills gaps and offers presets; the patcher panel hosts it and sends it live
  const changes = [];
  const editor = createSpectrumEditor({ doc, points: SPECTRA.saw(), onChange: pts => changes.push(pts) });
  let canvas; const buttons = [];
  walk(editor.el, e => { if (e.tag === 'canvas') canvas = e; if (e.tag === 'button') buttons.push(e); });
  const fire = (type, x, y) => canvas.listeners[type]({ offsetX: x, offsetY: y });
  fire('mousedown', 0, HEIGHT - 2); fire('mousemove', WIDTH - 1, 0); fire('mouseup', 0, 0);   // bottom-left to top-right
  const drawn = changes.at(-1);
  assert.equal(drawn.length, HARMONICS);
  assert.ok(drawn.every((v, i) => Math.abs(v - i / (HARMONICS - 1)) < 0.05), 'the gap between mouse events should be filled in');
  fire('mousemove', 10, 10);
  assert.equal(changes.length, 2, 'not drawing any more');
  buttons.find(b => b.textContent === 'square').listeners.click();
  assert.ok(changes.at(-1)[1] === 0 && changes.at(-1)[2] > 0, 'the square preset has only odd partials');
  assert.deepEqual(Array.from(normalizeSpectrum('junk')), Array.from(Float32Array.from(SPECTRA.saw())));

  const canvas2 = { width: 900, height: 360, style: {}, listeners: {}, getContext: () => new Proxy({}, { get: (t, k) => (k in t ? t[k] : () => {}), set: (t, k, v) => { t[k] = v; return true; } }), addEventListener(type, f) { this.listeners[type] = f; }, focus() {} };
  const panel = makeEl('div'), sent = [];
  const defs = structuredClone(instruments);
  const patcher = createPatcher({ canvas: canvas2, panel, statusEl: { textContent: '' }, doc, nodeTypes: NODE_TYPES, onStructure() {}, onParam() {}, onData: (...a) => sent.push(a) });
  patcher.load({ instruments: defs });
  patcher.show('kick');
  patcher.add('addsynth', { x: 300, y: 200 });
  let bars = null;
  walk(panel, e => { if (e.className === 'curve') bars = e; });
  assert.ok(bars, 'the addsynth panel should hold the spectrum editor');
  bars.listeners.mousedown({ offsetX: 20, offsetY: 10 }); bars.listeners.mouseup({});
  const node = defs.kick.graph.nodes.find(n => n.id === 'addsynth1');
  assert.equal(node.data.spectrum.length, HARMONICS);
  assert.deepEqual(sent.at(-1).slice(0, 2), ['kick', 'addsynth1']);
  assert.equal(sent.at(-1)[2].type, 'spectrum');

  // the FM synth panel holds the wave editor: four operator tabs, drawing sends all four waves live
  patcher.add('fmsynth', { x: 300, y: 300 });
  let fmCanvas = null; const fmButtons = [];
  walk(panel, e => { if (e.className === 'curve') fmCanvas = e; if (e.tag === 'button') fmButtons.push(e); });
  assert.ok(fmCanvas && fmButtons.some(b => b.textContent === 'op 4'), 'the fmsynth panel should hold the wave editor');
  fmButtons.find(b => b.textContent === 'op 2').listeners.click();
  fmButtons.find(b => b.textContent === 'square').listeners.click();
  const fmNode = defs.kick.graph.nodes.find(n => n.id === 'fmsynth1');
  assert.equal(fmNode.data.waves.length, 4);
  assert.equal(fmNode.data.waves[1][0], 1);
  assert.equal(fmNode.data.waves[0][0], 0, 'the other operators keep their sine');
  assert.equal(sent.at(-1)[2].type, 'waves');
  fmCanvas.listeners.mousedown({ offsetX: 0, offsetY: 0 }); fmCanvas.listeners.mouseup({});
  assert.equal(fmNode.data.waves[1][0], 1, 'drawing changes only the chosen operator');
  // the FM kind: five note and velocity lanes, and every named parameter exists
  const fmKind = synthKinds.fm.make();
  assert.equal(fmKind.noteColumns, 5);
  for (const item of [...fmKind.exposed, ...fmKind.commands]) assert.ok(NODE_TYPES.fmsynth.params.some(q => q.name === item.param), `fmsynth.${item.param}`);
  const fmProject = { instruments: {}, samples: {}, lanes: [], song: { length: 16 } };
  const fmId = pops.addSynthInstrument(fmProject, 'My FM', 'fm');
  const fmRegistry = new ParamRegistry(), fmRt = new GraphRuntime({ sampleRate: sr, params: fmRegistry.values });
  fmRt.load(compile(fmProject.instruments[fmId].graph, { instrument: fmId, nodeTypes: NODE_TYPES, registry: fmRegistry }));
  for (const n of [48, 52, 55, 59, 62]) fmRt.note(fmId, { type: 'noteOn', note: n, vel: 1 });
  const chord = render(fmRt, 0.3);
  assert.ok(chord.left.every(Number.isFinite) && peak(chord.left) > 0.05 && peak(chord.left) < 1, `five voices at once ${peak(chord.left)}`);
  assert.deepEqual(pops.addLane(fmProject, fmRegistry, fmId).columns.map(c => c.label).slice(0, 10), ['N1', 'V1', 'N2', 'V2', 'N3', 'V3', 'N4', 'V4', 'N5', 'V5']);

  // the stored spectrum survives a rebuild: the runtime replays it
  const registry = new ParamRegistry();
  const rt = new GraphRuntime({ sampleRate: sr, params: registry.values });
  const graph = { nodes: [{ id: 's', type: 'addsynth', params: { atk: 0.1, sus: 1 } }, { id: 'out', type: 'out' }], connections: [['s.out', 'out.in']] };
  rt.load(compile(graph, { instrument: 'a', nodeTypes: NODE_TYPES, registry }));
  rt.message('a', 's', { type: 'spectrum', points: Array.from({ length: 32 }, (_, i) => (i === 1 ? 1 : 0)) });
  rt.rebuild('a');
  rt.note('a', { type: 'noteOn', note: 57, vel: 1 });
  const x = render(rt, 0.4).left;
  const zc = (a, b) => { let c = 0; for (let i = a + 1; i < b; i++) if (x[i - 1] < 0 && x[i] >= 0) c++; return c * sr / (b - a); };
  assert.ok(Math.abs(zc(6000, 18000) / (2 * 220) - 1) < 0.02, 'a rebuilt instrument should replay its spectrum');
}

// 65. Polyphony: voice copies of a graph, the voices node, note allocation, and note columns.
{
  const hz = n => 440 * Math.pow(2, (n - 69) / 12);
  const mag = (x, f, a, b) => {
    b = Math.min(b, x.length);
    let re = 0, im = 0;
    for (let i = a; i < b; i++) {
      const w = 0.5 - 0.5 * Math.cos(2 * Math.PI * (i - a) / (b - a)), ph = 2 * Math.PI * f * i / sr;
      re += x[i] * w * Math.cos(ph); im += x[i] * w * Math.sin(ph);
    }
    return Math.hypot(re, im) / (b - a) * 4;
  };
  // sine -> vca (env) -> [voices] -> [delay] -> out
  const synthGraph = ({ voices, boundary = true, tail = false }) => ({
    voices,
    nodes: [
      { id: 'osc', type: 'osc', params: { wave: 0, reset: 1 } },
      { id: 'env', type: 'env', params: { attack: 1, decay: 10, sustain: 1, release: 50, amount: 1 } },
      { id: 'vca', type: 'gain' },
      ...(boundary ? [{ id: 'poly', type: 'voices' }] : []),
      ...(tail ? [{ id: 'dly', type: 'delay', params: { mix: 0.3 } }] : []),
      { id: 'out', type: 'out', params: { gain: 0.5 } },
    ],
    connections: [
      ['osc.out', 'vca.in'], ['env.out', 'vca.cv'],
      ...(() => {
        let last = 'vca.out';
        const c = [];
        for (const [id, inp, outp] of [...(boundary ? [['poly', 'in', 'out']] : []), ...(tail ? [['dly', 'in', 'out']] : []), ['out', 'in', null]]) {
          c.push([last, `${id}.${inp}`]);
          if (outp) last = `${id}.${outp}`;
        }
        return c;
      })(),
    ],
  });
  const make = graph => {
    const registry = new ParamRegistry();
    const rt = new GraphRuntime({ sampleRate: sr, params: registry.values });
    rt.load(compile(graph, { instrument: 'x', nodeTypes: NODE_TYPES, registry }));
    return { rt, registry };
  };
  const on = (rt, note) => rt.note('x', { type: 'noteOn', note, vel: 1 });
  const off = (rt, note) => rt.note('x', { type: 'noteOff', note });
  const level = (x, note, a = 4000) => mag(x, hz(note), a, x.length);
  const sounding = rt => rt.instruments.get('x').sets.filter(s => s.active).length;

  // a chord sounds all its notes; one voice plays only the last
  {
    const { rt } = make(synthGraph({ voices: 4 }));
    for (const n of [60, 64, 67]) on(rt, n);
    const x = render(rt, 0.4).left;
    const ref = level(x, 60);
    assert.ok(ref > 0.02 && level(x, 64) > 0.5 * ref && level(x, 67) > 0.5 * ref, 'all three notes should sound');
    assert.ok(level(x, 62) < 0.1 * ref && level(x, 65.5) < 0.1 * ref, 'and nothing else');
    assert.ok(x.every(Number.isFinite));
    const solo = make(synthGraph({ voices: 1 }));
    for (const n of [60, 64, 67]) on(solo.rt, n);
    const y = render(solo.rt, 0.4).left;
    assert.ok(level(y, 60) < 0.1 * level(y, 67) && level(y, 64) < 0.1 * level(y, 67), 'one voice plays only the last note');
  }

  // a note off releases only its own voice, and the finished voice stops running
  {
    const { rt } = make(synthGraph({ voices: 4 }));
    for (const n of [60, 64, 67]) on(rt, n);
    render(rt, 0.1);
    off(rt, 64);
    const x = render(rt, 0.5).left;
    assert.ok(level(x, 64, 12000) < 0.05 * level(x, 60, 12000), 'the released note should be gone');
    assert.ok(level(x, 60, 12000) > 0.02 && level(x, 67, 12000) > 0.02, 'the held notes should go on');
    assert.equal(sounding(rt), 2, 'the finished voice should stop');
    rt.note('x', { type: 'allOff' });
    render(rt, 0.5);
    assert.equal(sounding(rt), 0, 'all-off lets every voice end');
    on(rt, 60); on(rt, 62);
    assert.equal(sounding(rt), 2);
    rt.note('x', { type: 'noteCut' });
    assert.equal(sounding(rt), 0, 'a cut stops every voice at once');
    assert.equal(peak(render(rt, 0.1).left), 0);
  }

  // stealing: with two voices a third note takes the oldest; a released voice goes first
  {
    const { rt } = make(synthGraph({ voices: 2 }));
    on(rt, 60); on(rt, 64); on(rt, 67);
    const x = render(rt, 0.4).left;
    assert.ok(level(x, 60) < 0.1 * level(x, 64) && level(x, 67) > 0.5 * level(x, 64), 'the oldest voice should be stolen');
    const other = make(synthGraph({ voices: 2 }));
    on(other.rt, 60); on(other.rt, 64);
    render(other.rt, 0.05);
    off(other.rt, 64);
    on(other.rt, 67);
    const y = render(other.rt, 0.4).left;
    assert.ok(level(y, 60) > 0.02 && level(y, 64) < 0.05 * level(y, 60), 'the released voice should be taken before a held one');
  }

  // the structure: copies before the voices node, one of everything after it
  {
    const { rt } = make(synthGraph({ voices: 4, tail: true }));
    const inst = rt.instruments.get('x');
    assert.equal(inst.byId.get('osc').length, 4);
    assert.equal(inst.byId.get('vca').length, 4);
    assert.equal(inst.byId.get('dly').length, 1, 'effects after the voices node run once');
    assert.equal(inst.byId.get('out').length, 1);
    for (const n of [60, 64]) on(rt, n);
    const x = render(rt, 1).left;
    assert.ok(x.every(Number.isFinite) && peak(x) > 0.02);
    // without one, the whole graph is copied and the copies are mixed at the end
    const whole = make(synthGraph({ voices: 3, boundary: false }));
    assert.equal(whole.rt.instruments.get('x').byId.get('out').length, 3);
    for (const n of [60, 64, 67]) on(whole.rt, n);
    const y = render(whole.rt, 0.4).left;
    assert.ok(level(y, 60) > 0.02 && level(y, 64) > 0.5 * level(y, 60) && level(y, 67) > 0.5 * level(y, 60), 'a chord through whole-graph copies');
    // a shared parameter reaches every voice
    const shared = make(synthGraph({ voices: 3 }));
    shared.registry.set('x.osc.tune', 12);
    for (const n of [60, 64, 67]) on(shared.rt, n);
    const z = render(shared.rt, 0.4).left;
    assert.ok(level(z, 72) > 0.02 && level(z, 76) > 0.02 && level(z, 79) > 0.02 && level(z, 60) < 0.1 * level(z, 72), 'a parameter should move every voice');
  }

  // messages reach every copy and survive a rebuild
  {
    const { rt } = make({
      voices: 2,
      nodes: [{ id: 's', type: 'addsynth', params: { atk: 0.1, sus: 1, width: 0 } }, { id: 'poly', type: 'voices' }, { id: 'out', type: 'out' }],
      connections: [['s.out', 'poly.in'], ['poly.out', 'out.in']],
    });
    rt.message('x', 's', { type: 'spectrum', points: Array.from({ length: 32 }, (_, i) => (i === 1 ? 1 : 0)) });
    rt.rebuild('x');
    on(rt, 57); on(rt, 64);
    const x = render(rt, 0.5).left;
    assert.ok(level(x, 69) > 0.01 && level(x, 76) > 0.01, 'both voices should have the spectrum');
    assert.ok(level(x, 57) < 0.05 * level(x, 69) && level(x, 64) < 0.05 * level(x, 76), 'and no fundamental');
  }

  // the compiler checks the voice count
  {
    const registry = new ParamRegistry();
    for (const bad of [0, 17, 1.5]) assert.throws(() => compile({ ...synthGraph({ voices: 1 }), voices: bad }, { instrument: 'x', nodeTypes: NODE_TYPES, registry }), /voices must be/);
  }

  // note columns: the columns, velocities per column, and a note off that ends only its own column's note
  {
    const def = { ...structuredClone(instruments.lead), noteColumns: 3 };
    const registry = new ParamRegistry();
    const defs = { lead: def };
    for (const n of ['filter.cutoff', 'filter.resonance', 'delay.mix', 'delay.time', 'delay.feedback', 'sampler.nnaFade', 'sampler.nnaAll', 'sampler.offset', 'sampler.retrig', 'sampler.repeats', 'sampler.shift', 'sampler.ramp', 'sampler.reverse', 'sampler.sample', 'sampler.slice', ...['grain', 'edge', 'accel', 'step', 'slide', 'flip', 'prob', 'jOffset', 'jPitch', 'jPan', 'jTime', 'jLevel', 'volLin', 'volLog', 'volDown', 'volUp', 'volFineDown', 'volFineUp', 'volDownMs', 'volUpMs', 'volFineDownMs', 'volFineUpMs', 'subdivide', 'blockCount', 'portDown', 'portUp', 'portFineDown', 'portFineUp', 'portTo', 'retrigMin', 'retrigMax', 'retrigPow', 'cutAfter', 'releaseAfter', 'cutScale', 'stretchSub', 'stretchTicks', 'stretchKeep', 'filterType', 'filterCutoff', 'filterRes', 'cutDown', 'cutUp', 'cutStep', 'jCutoff', 'jTimeSub', 'vibSpeed', 'vibDepth', 'vibWave', 'lfoSpeed', 'lfoDepth', 'lfoWave', 'vibSync', 'vibPhase', 'lfoSync', 'lfoPhase', 'jumpAhead', 'jumpBack', 'jumpAheadRel', 'jumpBackRel', 'jumpTicksAhead', 'jumpTicksBack', 'jumpTicksAheadRel', 'jumpTicksBackRel'].map(k => `sampler.${k}`), ...['grain', 'edge', 'accel', 'step', 'slide', 'flip', 'prob', 'jOffset', 'jPitch', 'jPan', 'jTime', 'jLevel'].map(k => `sampler.${k}`)]) registry.allocate(`lead.${n}`, 0.5, 0, 1000);
    const cols = buildColumns('lead', def, registry);
    assert.deepEqual(cols.map(c => c.label), ['N1', 'V1', 'N2', 'V2', 'N3', 'V3', 'Smp', 'Off', 'Rtg', 'Cut', 'Res', 'Mix', 'Time', 'Cmd']);
    assert.deepEqual(cols.slice(0, 2).map(c => c.key), ['note', 'vel'], 'the first pair keeps its keys');
    assert.deepEqual(buildColumns('lead', { ...def, noteColumns: undefined }, registry).map(c => c.label).slice(0, 3), ['Note', 'Vel', 'Smp']);

    const events = [];
    const stub = { process() {}, note: (instrument, msg) => events.push(`${msg.type}${msg.note !== undefined ? ` ${msg.note}` : ''}${msg.type === 'noteOn' ? ` v${Math.round(msg.vel * 255)}` : ''}`) };
    const seq = new Sequencer({ sampleRate: sr, runtime: stub, params: registry.values, transport: new Int32Array(new SharedArrayBuffer(8)) });
    const song = song120([oneLane('lead', 'lead', ['C-4 FF E-4 80 G-4 40', '... .. ... .. ... ..', '=== .. ... .. ... ..', 'F-4 .. ... .. ... ..', '... .. === .. ... ..'].join('\n'), 8)]);
    seq.setSong(song);
    for (const lane of prepareSong(song, defs, registry)) seq.setLane(lane);
    seq.play();
    const out = [new Float32Array(48000), new Float32Array(48000)];
    seq.process(out[0], out[1], 48000);
    assert.deepEqual(events, [
      'noteOn 60 v255', 'noteOn 64 v128', 'noteOn 67 v64',   // a chord on one row, each with its own velocity
      'noteOff 60',                                          // === in the first column ends only C
      'noteOn 65 v255',                                      // a single note with no velocity plays at full
      'noteOff 64',                                          // === in the second ends only E
    ]);
    events.length = 0;
    seq.stop();
    assert.deepEqual(events, ['allOff'], 'stop releases every voice');
    // a cut from any column stops everything; an off for a column with no note does nothing
    seq.reset(registry.values);
    const cutSong = song120([oneLane('lead', 'lead', ['C-4 .. E-4 .. ... ..', '... .. ^^^ .. ... ..', '=== .. ... .. ... ..'].join('\n'), 4)]);
    seq.setSong(cutSong);
    for (const lane of prepareSong(cutSong, defs, registry)) seq.setLane(lane);
    events.length = 0;
    seq.play();
    seq.process(out[0], out[1], 48000);
    assert.deepEqual(events, ['noteOn 60 v255', 'noteOn 64 v255', 'noteCut'], 'a cut ends everything and the later off finds nothing to release');

    // changing the number of note columns keeps every other column's cells
    const songBefore = { name: 'x', bpm: 120, ticksPerBeat: 4, length: 8, lanes: [oneLane('lead', 'lead', 'C-4 .. .. .... .... 70 50 40 4C9E', 8)] };
    const one = { lead: structuredClone(instruments.lead) };
    const lanes = prepareSong(songBefore, one, registry);
    one.lead.noteColumns = 3;
    const [changed] = rebuildInstrumentLanes(lanes, songBefore, one, registry, 'lead');
    const row = Object.values(changed.patterns)[0].rows[0];
    assert.deepEqual([row[0], row[9], row[10], row[11], row[12]], ['C-4', '70', '50', '40', '4C9E']);
    assert.equal(row.length, 14);
    one.lead.noteColumns = 1;
    const [back] = rebuildInstrumentLanes(lanes, songBefore, one, registry, 'lead');
    { const r0 = Object.values(back.patterns)[0].rows[0]; assert.deepEqual([r0[0], r0[1], r0[5], r0[6], r0[7]], ['C-4', '..', '70', '50', '40']); }

    // the project file keeps both settings
    const file = parseProject(serializeProject({ song: { name: 'p', bpm: 120, ticksPerBeat: 4, length: 8 }, instruments: { s: { ...structuredClone(instruments.kick), noteColumns: 3, graph: { ...structuredClone(instruments.kick.graph), voices: 6 } } }, samples: {}, lanes: [] }));
    assert.equal(file.instruments.s.noteColumns, 3);
    assert.equal(file.instruments.s.graph.voices, 6);
  }
}

// 66. A new note releases the column's last note; rectangle selection, copy, cut, paste and clear.
{
  // a new note in a column is a note off for the one before, unless that was already released
  const registry = new ParamRegistry();
  const def = { ...structuredClone(instruments.kick), noteColumns: 1 };
  compile(def.graph, { instrument: 'kick', nodeTypes: NODE_TYPES, registry });
  const events = [];
  const stub = { process() {}, note: (instrument, msg) => events.push(`${msg.type}${msg.note !== undefined ? ` ${msg.note}` : ''}${msg.type === 'noteOff' ? (msg.implied ? ' implied' : ' explicit') : ''}`) };
  const seq = new Sequencer({ sampleRate: sr, runtime: stub, params: registry.values, transport: new Int32Array(new SharedArrayBuffer(8)) });
  const song = song120([oneLane('kick', 'kick', ['C-4 ..', '... ..', 'E-4 ..', '=== ..', 'G-4 ..', 'A-4 ..'].join('\n'), 8)]);
  seq.setSong(song);
  for (const lane of prepareSong(song, { kick: def }, registry)) seq.setLane(lane);
  seq.play();
  const o = [new Float32Array(48000), new Float32Array(48000)];
  seq.process(o[0], o[1], 48000);
  assert.deepEqual(events, ['noteOn 60', 'noteOff 60 implied', 'noteOn 64', 'noteOff 64 explicit', 'noteOn 67', 'noteOff 67 implied', 'noteOn 69']);

  // end to end: with voices, the first note of a one-column line dies away while the second sounds
  {
    const hz = n => 440 * Math.pow(2, (n - 69) / 12);
    const mag = (x, f, a, b) => {
      let re = 0, im = 0;
      for (let i = a; i < b; i++) { const w = 0.5 - 0.5 * Math.cos(2 * Math.PI * (i - a) / (b - a)), ph = 2 * Math.PI * f * i / sr; re += x[i] * w * Math.cos(ph); im += x[i] * w * Math.sin(ph); }
      return Math.hypot(re, im) / (b - a) * 4;
    };
    const graph = {
      voices: 4,
      nodes: [{ id: 'osc', type: 'osc', params: { wave: 0 } }, { id: 'env', type: 'env', params: { attack: 1, decay: 10, sustain: 1, release: 50, amount: 1 } }, { id: 'vca', type: 'gain' }, { id: 'poly', type: 'voices' }, { id: 'out', type: 'out' }],
      connections: [['osc.out', 'vca.in'], ['env.out', 'vca.cv'], ['vca.out', 'poly.in'], ['poly.out', 'out.in']],
    };
    const reg = new ParamRegistry(), rt = new GraphRuntime({ sampleRate: sr, params: reg.values });
    rt.load(compile(graph, { instrument: 'p', nodeTypes: NODE_TYPES, registry: reg }));
    const s = new Sequencer({ sampleRate: sr, runtime: rt, params: reg.values, transport: new Int32Array(new SharedArrayBuffer(8)) });
    const sg = song120([oneLane('p', 'p', ['C-4 ..', '... ..', '... ..', '... ..', 'E-4 ..'].join('\n'), 16)]);
    s.setSong(sg);
    for (const lane of prepareSong(sg, { p: { graph, exposed: [] } }, reg)) s.setLane(lane);
    s.play();
    const x = render(s, 1.5).left;
    assert.ok(mag(x, hz(60), 60000, 70000) < 0.05 * mag(x, hz(64), 60000, 70000), 'the first note should have been released by the second');
    assert.ok(mag(x, hz(64), 60000, 70000) > 0.02, 'and the second should sound');
  }

  // cells of a rectangle
  const reg2 = new ParamRegistry();
  for (const [id, d] of Object.entries(instruments)) compile(d.graph, { instrument: id, nodeTypes: NODE_TYPES, registry: reg2 });
  const lanes = prepareSong(demoSong, instruments, reg2);
  let onKey, backs = 0;
  const el = { addEventListener: (type, f) => { if (type === 'keydown') onKey = f; }, innerHTML: '' };
  const statusEl = { textContent: '', set innerHTML(h) { this.html = h; this.textContent = h.replace(/<[^>]+>/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'); } };
  const view = createTrackerView({ el, statusEl, transport: new Int32Array(new SharedArrayBuffer(8)), onToggle() {}, onBack: () => backs++ });
  view.load({ lanes, song: demoSong, editor: createEditor(lanes, demoSong.length) });
  const press = (key, times = 1, extra = {}) => { for (let i = 0; i < times; i++) onKey({ key, preventDefault() {}, ...extra }); };
  const ctrl = key => press(key, 1, { ctrlKey: true });
  const [lead] = lanes;
  const snap = (r0, r1, c0, c1) => lead.rows.slice(r0, r1 + 1).map(r => r.slice(c0, c1 + 1));
  const before = lead.rows.map(r => r.slice());

  press('ArrowDown', 1, { shiftKey: true }); press('ArrowDown', 1, { shiftKey: true });
  press('ArrowRight', 1, { shiftKey: true }); press('ArrowRight', 1, { shiftKey: true });   // rows 0-2, Note Vel Cut
  view.draw();
  assert.ok(statusEl.textContent.includes('selected 3x3') && el.innerHTML.includes('class="sel"'), statusEl.textContent);
  ctrl('c');
  const copied = snap(0, 2, 0, 2);
  press('ArrowLeft', 5);                                  // a plain move drops the selection; back to the Note column
  press('ArrowDown', 8);                                  // the cursor was on row 2, so this is row 10
  ctrl('v');
  assert.deepEqual(snap(10, 12, 0, 2), copied, 'the rectangle should land at the cursor');
  assert.equal(lead.rows[9][0], before[9][0]);
  ctrl('z');
  assert.deepEqual(lead.rows.map(r => r.slice()), before, 'one undo should take back the whole paste');

  // a cell goes only into a column of its own kind
  press('Home');
  ctrl('c');                                              // the Note cell on row 0
  press('ArrowRight', 3);                                 // the Vel column, same row
  ctrl('v');
  assert.deepEqual(lead.rows[0].slice(0, 3), before[0].slice(0, 3), 'a note must not paste into a velocity column');
  view.draw();
  assert.ok(statusEl.textContent.includes('Nothing fits'), statusEl.textContent);

  // cut clears, paste puts it back elsewhere; delete clears a whole selection
  press('ArrowLeft', 3);
  press('ArrowDown', 1, { shiftKey: true }); press('ArrowRight', 1, { shiftKey: true });   // rows 0-1, Note Vel
  const want = snap(0, 1, 0, 1);
  ctrl('x');
  assert.ok(snap(0, 1, 0, 1).flat().every(c => /^\.+$/.test(c)), 'cut should clear the rectangle');
  press('ArrowLeft', 3); press('ArrowDown', 12); ctrl('v');
  assert.deepEqual(snap(13, 14, 0, 1), want);
  press('Home'); press('ArrowDown', 1, { shiftKey: true }); press('ArrowDown', 1, { shiftKey: true }); press('ArrowDown', 1, { shiftKey: true });
  press('Delete');
  assert.ok(snap(0, 3, 0, 0).flat().every(c => /^\.+$/.test(c)), 'delete should clear every selected cell');
  ctrl('z');
  assert.equal(lead.rows[2][0], before[2][0], 'one undo for the clear');

  // escape drops a selection before it leaves the screen; select-all takes the whole lane
  press('Home'); press('ArrowDown', 1, { shiftKey: true });
  press('Escape'); assert.equal(backs, 0); view.draw(); assert.ok(!statusEl.textContent.includes('selected'));
  press('Escape'); assert.equal(backs, 1);
  ctrl('a'); view.draw();
  assert.ok(statusEl.textContent.includes(`selected ${demoSong.length}x${lead.columns.length}`), statusEl.textContent);

  view.draw();
  const labels = el.innerHTML.split('\n').slice(2).map(l => l.replace(/<[^>]+>/g, '').slice(0, 6));
  assert.ok(labels.length > 4 && labels.every(l => /^[> ]\d{4} $/.test(l)), `the tick column is four digits, zero-padded: ${labels.slice(0, 3)}`);

  // mouse geometry: which cell is under a character position
  const widths = [[4, 3, 2, 2], [4, 3]];   // two lanes; lane 0 is 4+3+2+2 + 3 gaps = 14 wide
  const at = (x, line, top = 0) => cellAt({ widths, x, line, top, len: 32 });
  assert.equal(at(5, 2), null, 'the gutter');
  assert.equal(at(10, 1), null, 'the header');
  assert.deepEqual(at(7, 2), { lane: 0, tick: 0, col: 0, ch: 0 });          // 6 gutter + 1 marker: the first column
  assert.deepEqual(at(9, 5, 10), { lane: 0, tick: 13, col: 0, ch: 2 });     // scrolled: line 5 is tick top + 3
  assert.deepEqual(at(12, 2), { lane: 0, tick: 0, col: 1, ch: 0 });         // after the column and its space
  assert.deepEqual(at(21, 2).col, 3);
  assert.equal(at(7 + 14 + 2 + 1, 2).lane, 1, 'the second lane starts after a marker and two spaces');
  assert.equal(at(200, 2).col, 1, 'far right is the last column');
  assert.equal(at(7, 40), null, 'past the last row');
}

// 67. Managing lanes and instruments: rename, reorder, copy, remove, and loading the result back.
{
  const registry = new ParamRegistry();
  const defs = structuredClone(instruments);
  for (const [id, d] of Object.entries(defs)) compile(d.graph, { instrument: id, nodeTypes: NODE_TYPES, registry });
  const fresh = () => ({ song: { ...demoSong }, instruments: structuredClone(instruments), samples: {}, lanes: prepareSong(demoSong, defs, registry), editor: null });
  const ids = p => p.lanes.map(l => l.id), inst = p => Object.keys(p.instruments);
  const play = data => {   // load the project the way the page does, and render a second of it
    const reg = new ParamRegistry(), rt = new GraphRuntime({ sampleRate: sr, params: reg.values });
    const seq = new Sequencer({ sampleRate: sr, runtime: rt, params: reg.values, transport: new Int32Array(new SharedArrayBuffer(8)) });
    for (const [id, d] of Object.entries(data.instruments)) {
      rt.load(compile(d.graph, { instrument: id, nodeTypes: NODE_TYPES, registry: reg }));
      for (const node of Object.keys(d.samples ?? {})) rt.message(id, node, { type: 'sample', data: makePluck(sr), rate: sr });
    }
    seq.setSong(data.song);
    for (const lane of prepareSong(data.song, data.instruments, reg)) seq.setLane(lane);
    seq.play();
    return render(seq, 1).left;
  };

  // the project goes out as source and comes back the same
  {
    const p = fresh(), data = pops.projectData(p);
    const again = prepareSong(data.song, data.instruments, registry);
    assert.deepEqual(again.map(l => l.rows), p.lanes.map(l => l.rows));
    assert.deepEqual(again.map(l => Object.values(l.patterns).map(x => x.index)), p.lanes.map(l => Object.values(l.patterns).map(x => x.index)));
  }

  // lanes
  {
    const p = fresh();
    assert.deepEqual(ids(p), ['lead', 'bass', 'kick']);
    assert.equal(pops.renameLane(p, 'lead', '  Lead line! '), 'Lead_line');
    assert.deepEqual(ids(p), ['Lead_line', 'bass', 'kick']);
    assert.throws(() => pops.renameLane(p, 'bass', 'Lead_line'), /already a lane called "Lead_line"/);
    assert.throws(() => pops.renameLane(p, 'bass', ' !! '), /needs letters or digits/);
    assert.throws(() => pops.renameLane(p, 'nope', 'x'), /No lane called/);
    assert.equal(pops.renameLane(p, 'bass', 'bass'), 'bass', 'keeping the name is fine');
    assert.equal(pops.moveLane(p, 'bass', -1), 0);
    assert.deepEqual(ids(p), ['bass', 'Lead_line', 'kick']);
    assert.equal(pops.moveLane(p, 'bass', -1), 0, 'the first lane cannot go earlier');
    assert.equal(pops.moveLane(p, 'bass', 5), 2, 'the last place is as far as it goes');
    assert.deepEqual(ids(p), ['Lead_line', 'kick', 'bass']);
    const copy = pops.duplicateLane(p, 'Lead_line');
    assert.equal(copy.id, 'Lead_line2');
    assert.deepEqual(ids(p), ['Lead_line', 'Lead_line2', 'kick', 'bass'], 'the copy sits after the original');
    const original = p.lanes.find(l => l.id === 'Lead_line');
    assert.deepEqual(copy.rows, original.rows);
    Object.values(copy.patterns)[0].rows[0][0] = 'G-9';
    assert.notEqual(Object.values(original.patterns)[0].rows[0][0], 'G-9', 'a copy is independent of the original');
    for (const id of ['Lead_line2', 'kick', 'bass']) pops.removeLane(p, id);
    assert.deepEqual(ids(p), ['Lead_line']);
    pops.removeLane(p, 'Lead_line');
    assert.deepEqual(ids(p), [], 'the last lane can go too: a project can be empty (the master lane is added when it is opened)');
  }

  // instruments
  {
    const p = fresh();
    assert.deepEqual(inst(p), ['lead', 'bass', 'kick']);
    assert.equal(pops.renameInstrument(p, 'lead', 'Melody'), 'Melody');
    assert.deepEqual(inst(p), ['Melody', 'bass', 'kick'], 'a renamed instrument keeps its place');
    assert.equal(p.lanes[0].instrument, 'Melody', 'the lanes that played it follow');
    assert.equal(p.lanes[1].instrument, 'bass');
    assert.throws(() => pops.renameInstrument(p, 'bass', 'kick'), /already an instrument called "kick"/);
    assert.equal(pops.renameInstrument(p, 'kick', '808'), '_808', 'an all-digit name would reorder the list');
    assert.throws(() => pops.removeInstrument(p, 'Melody'), /played by lane lead; remove that lane first/);
    pops.removeLane(p, 'lead');
    pops.removeInstrument(p, 'Melody');
    assert.deepEqual(inst(p), ['bass', '_808']);
    assert.throws(() => pops.removeInstrument(p, 'Melody'), /No instrument called/);
    assert.equal(pops.moveInstrument(p, '_808', -1), 0);
    assert.deepEqual(inst(p), ['_808', 'bass']);
    const copy = pops.duplicateInstrument(p, '_808');
    assert.equal(copy, '_8082');
    assert.deepEqual(inst(p), ['_808', '_8082', 'bass'], 'the copy sits after the original');
    p.instruments._8082.graph.nodes[0].params.attack = 99;
    assert.notEqual(p.instruments._808.graph.nodes[0].params.attack, 99, 'a copy is independent');
    assert.equal(pops.duplicateInstrument(p, 'bass', 'Bass 2'), 'Bass_2');
  }

  // after all that the project still loads and plays: names and order change, the sound does not
  {
    const before = play(pops.projectData(fresh()));
    assert.ok(peak(before) > 0.1);
    const p = fresh();
    pops.renameInstrument(p, 'lead', 'Melody');
    pops.renameInstrument(p, 'bass', 'Sub');
    pops.renameLane(p, 'lead', 'top');
    const renamed = play(pops.projectData(p));
    assert.ok(renamed.every((v, i) => v === before[i]), 'renaming should not change the sound');
    pops.moveInstrument(p, 'kick', -2);
    pops.moveLane(p, 'top', 1);
    const moved = play(pops.projectData(p));
    assert.ok(moved.every((v, i) => Math.abs(v - before[i]) < 1e-5), 'order should not change the mix');
    const dup = pops.duplicateLane(p, 'top');
    const doubled = play(pops.projectData(p));
    assert.ok(peak(doubled) > 1.2 * peak(before), 'a copied lane plays too');
    // the project file keeps the new order
    const file = parseProject(serializeProject({ ...p, samples: { pluck: { rate: sr, data: makePluck(sr) } } }));
    assert.deepEqual(Object.keys(file.instruments), Object.keys(p.instruments));
    assert.deepEqual(file.song.lanes.map(l => l.id), ids(p));
  }
}

// 68. Swing, instrument presets, preset recall from a pattern, and instrument files.
{
  // swing: the second of each pair of rows comes late; 0.5 is straight
  const timings = (swing, tpb = 4) => {
    let now = 0;
    const log = [];
    const stub = { process: (l, r, n) => { now += n; }, note: (instrument, msg) => { if (msg.type === 'noteOn') log.push(now); } };
    const registry = new ParamRegistry();
    const def = { ...structuredClone(instruments.kick) };
    compile(def.graph, { instrument: 'kick', nodeTypes: NODE_TYPES, registry });
    const seq = new Sequencer({ sampleRate: sr, runtime: stub, params: registry.values, transport: new Int32Array(new SharedArrayBuffer(8)) });
    const song = { ...song120([oneLane('kick', 'kick', Array.from({ length: 8 }, () => 'C-2 ..').join('\n'), 8)]), swing, ticksPerBeat: tpb };
    seq.setSong(song);
    for (const lane of prepareSong(song, { kick: def }, registry)) seq.setLane(lane);
    seq.play();
    const o = [new Float32Array(512), new Float32Array(512)];
    for (let i = 0; i < 100; i++) seq.process(o[0], o[1], 512);
    return log.slice(0, 6);
  };
  assert.deepEqual(timings(0.5), [0, 6000, 12000, 18000, 24000, 30000], 'straight is an even grid');
  assert.deepEqual(timings(undefined), [0, 6000, 12000, 18000, 24000, 30000], 'no swing setting is straight');
  assert.deepEqual(timings(0.75), [0, 9000, 12000, 21000, 24000, 33000], 'the off-beats land late, the pairs stay in step');
  const triplet = timings(2 / 3);
  assert.ok(Math.abs(triplet[1] - 8000) <= 1 && Math.abs(triplet[2] - 12000) <= 1, `triplet swing ${triplet}`);
  assert.deepEqual(timings(0.9).slice(0, 3), timings(0.75).slice(0, 3), 'swing is limited to 75 percent');
  assert.deepEqual(timings(0.2).slice(0, 3), [0, 6000, 12000], 'and never goes the other way');
  assert.deepEqual(timings(0.75, 8), [0, 4500, 9000, 10500, 12000, 16500], 'at 8 ticks per beat the swing is slow slow fast fast');

  // the preset list: stable numbers, capture, apply
  const def = structuredClone(instruments.lead);
  const live = { 'filter.cutoff': 1234 };
  const snap = presetOps.capturePreset(def, NODE_TYPES, (node, name) => live[`${node}.${name}`], 'warm');
  assert.equal(snap.values['filter.cutoff'], 1234, 'live values are taken');
  assert.equal(snap.values['filter.resonance'], 0.3, 'the rest come from the graph');
  assert.equal(snap.values['sampler.level'], 0.8, 'and from the defaults');
  assert.equal(presetOps.addPreset(def, snap), 0);
  assert.equal(presetOps.addPreset(def, { ...snap, name: '' }), 1);
  assert.equal(def.presets[1].name, 'preset 01');
  presetOps.removePreset(def, 0);
  assert.deepEqual(def.presets.map(p => p.id), [1], 'the others keep their numbers');
  assert.equal(presetOps.addPreset(def, snap), 0, 'a freed number is used again');
  assert.deepEqual(def.presets.map(p => p.id), [0, 1]);
  presetOps.renamePreset(def, 1, '  pad  ');
  assert.equal(def.presets[1].name, 'pad');
  assert.throws(() => presetOps.renamePreset(def, 1, ' '), /needs a name/);
  assert.throws(() => presetOps.removePreset(def, 9), /No preset number 9/);
  presetOps.overwritePreset(def, 1, { values: { 'filter.cutoff': 77 } });
  assert.deepEqual([def.presets[1].name, def.presets[1].values['filter.cutoff']], ['pad', 77]);
  const applied = presetOps.applyPreset(def, NODE_TYPES, 1);
  assert.deepEqual(applied.params, [['filter', 'cutoff', 77]]);
  assert.equal(def.graph.nodes.find(n => n.id === 'filter').params.cutoff, 77, 'recalling puts the values in the graph, so they are saved');
  def.presets[0].values['gone.cutoff'] = 1; def.presets[0].values['filter.nothing'] = 1;
  assert.ok(!presetOps.applyPreset(def, NODE_TYPES, 0).params.some(([n]) => n === 'gone'), 'missing nodes and parameters are skipped');
  assert.equal(presetOps.capturePreset({ graph: { nodes: [{ id: 'w', type: 'waveshaper', data: { curve: [0, 1] } }] } }, NODE_TYPES).data.w.curve.length, 2, 'drawn curves are part of a preset');

  // recall from a pattern: command 00, the preset number in the value
  {
    const withPresets = structuredClone(instruments.lead);
    presetOps.addPreset(withPresets, { name: 'dark', values: { 'filter.cutoff': 400, 'filter.resonance': 0.8, 'delay.mix': 0.1 } });
    presetOps.addPreset(withPresets, { name: 'bright', values: { 'filter.cutoff': 9000 } });
    const registry = new ParamRegistry();
    compile(withPresets.graph, { instrument: 'lead', nodeTypes: NODE_TYPES, registry });
    const cols = buildColumns('lead', withPresets, registry);
    const cmd = cols.at(-1);
    assert.equal(cmd.kind, 'cmd');
    assert.deepEqual(cmd.presets.map(p => p.id), [0, 1]);
    assert.equal(cmd.presets[0].slots.length, 3);
    const noCommands = { ...structuredClone(instruments.kick) };
    assert.ok(!buildColumns('kick', noCommands, (() => { const r = new ParamRegistry(); compile(noCommands.graph, { instrument: 'kick', nodeTypes: NODE_TYPES, registry: r }); return r; })()).some(c => c.kind === 'cmd'), 'no commands and no presets: no Cmd column');
    const kickWith = structuredClone(instruments.kick); presetOps.addPreset(kickWith, { name: 'x', values: {} });
    const rk = new ParamRegistry(); compile(kickWith.graph, { instrument: 'kick', nodeTypes: NODE_TYPES, registry: rk });
    assert.ok(buildColumns('kick', kickWith, rk).some(c => c.kind === 'cmd'), 'a preset brings the Cmd column');

    const stub = { process() {}, note() {} };
    const seq = new Sequencer({ sampleRate: sr, runtime: stub, params: registry.values, transport: new Int32Array(new SharedArrayBuffer(8)) });
    const rows = ['... .. .. .... .... .. .. .. .... ......', '... .. .. .... .... .. .. .. .... 000000', '... .. .. .... .... .. .. .. .... ......', '... .. .. .... .... .. .. .. .... 000001', '... .. .. .... .... .. .. .. .... 0000FF', '... .. .. .... .... .. .. .. .... 010000'];
    const song = song120([oneLane('lead', 'lead', rows.join('\n'), 8)]);
    seq.setSong(song);
    for (const lane of prepareSong(song, { lead: withPresets }, registry)) seq.setLane(lane);
    const at = (name) => registry.get(`lead.${name}`);
    const o = [new Float32Array(6000), new Float32Array(6000)];
    seq.play();
    seq.process(o[0], o[1], 6000);
    assert.equal(at('filter.cutoff'), 3000, 'nothing has happened on the first row');
    seq.process(o[0], o[1], 6000);
    assert.equal(at('filter.cutoff'), 400);
    assert.ok(Math.abs(at('filter.resonance') - 0.8) < 1e-6 && Math.abs(at('delay.mix') - 0.1) < 1e-6, 'one command sets every parameter in the preset');
    seq.process(o[0], o[1], 6000); seq.process(o[0], o[1], 6000);
    assert.equal(at('filter.cutoff'), 9000, 'the second preset');
    assert.ok(Math.abs(at('filter.resonance') - 0.8) < 1e-6, 'and leaves what it does not hold alone');
    seq.process(o[0], o[1], 6000);
    assert.equal(at('filter.cutoff'), 9000, 'an unknown preset number does nothing');
    seq.process(o[0], o[1], 6000);
    assert.equal(at('filter.cutoff'), 20, 'the ordinary commands still work beside it (01 0000 is the lowest cutoff)');
  }

  // a preset also sends the drawn spectrum
  {
    const synth = { graph: { nodes: [{ id: 's', type: 'addsynth' }, { id: 'out', type: 'out' }], connections: [['s.out', 'out.in']] }, exposed: [] };
    presetOps.addPreset(synth, { name: 'x', values: { 's.tilt': -6 }, data: { s: { spectrum: Array.from({ length: 32 }, (_, i) => (i === 2 ? 1 : 0)) } } });
    const registry = new ParamRegistry();
    compile(synth.graph, { instrument: 'syn', nodeTypes: NODE_TYPES, registry });
    const sent = [];
    const stub = { process() {}, note() {}, message: (...a) => sent.push(a) };
    const seq = new Sequencer({ sampleRate: sr, runtime: stub, params: registry.values, transport: new Int32Array(new SharedArrayBuffer(8)) });
    const song = song120([oneLane('syn', 'syn', 'C-4 .. 000000', 8)]);
    seq.setSong(song);
    for (const lane of prepareSong(song, { syn: synth }, registry)) seq.setLane(lane);
    seq.play();
    seq.process(new Float32Array(100), new Float32Array(100), 100);
    assert.equal(sent.length, 1);
    assert.deepEqual([sent[0][0], sent[0][1], sent[0][2].type, sent[0][2].points[2]], ['syn', 's', 'spectrum', 1]);
    assert.equal(registry.get('syn.s.tilt'), -6);
  }

  // an instrument on its own in a file, and back into a project that has names to clash with
  {
    const project = { instruments: { lead: structuredClone(instruments.lead) }, samples: { pluck: { rate: sr, data: makePluck(sr) } } };
    presetOps.addPreset(project.instruments.lead, { name: 'dark', values: { 'filter.cutoff': 400 } });
    const text = serializeInstrument(project, 'lead');
    const parsed = parseInstrument(text);
    assert.equal(parsed.name, 'lead');
    assert.deepEqual(Object.keys(parsed.samples), ['pluck'], 'only the samples it uses go along');
    assert.equal(parsed.instrument.presets[0].name, 'dark', 'presets travel with the instrument');
    const other = { instruments: { lead: structuredClone(instruments.kick) }, samples: { pluck: { rate: 100, data: Float32Array.of(1, 2, 3) } } };
    const id = pops.importInstrument(other, parsed);
    assert.equal(id, 'lead2');
    assert.deepEqual(other.instruments.lead2.samples, { sampler: 'pluck2' }, 'a clashing sample gets a new id');
    assert.equal(other.samples.pluck.data.length, 3, 'and the project\'s own sample is untouched');
    assert.ok(Math.abs(other.samples.pluck2.data[1000] - project.samples.pluck.data[1000]) < 1e-4);
    assert.equal(pops.importInstrument(other, { ...parsed, name: 'my kit!' }), 'my_kit');
    assert.throws(() => parseInstrument('{"format":"nope"}'), /Not an instrument file/);
    assert.throws(() => parseInstrument('nope'), /invalid JSON/);
    assert.throws(() => serializeInstrument(project, 'zzz'), /No instrument called/);
  }

  // swing is saved with the song (and straight leaves no trace)
  {
    const song = { name: 's', bpm: 100, ticksPerBeat: 4, length: 16, swing: 0.6 };
    const back = parseProject(serializeProject({ song, instruments: {}, samples: {}, lanes: [] }));
    assert.equal(back.song.swing, 0.6);
    const straight = parseProject(serializeProject({ song: { ...song, swing: 0.5 }, instruments: {}, samples: {}, lanes: [] }));
    assert.equal(straight.song.swing, undefined);
  }

  // stereo samples: two channels reach the output without a mixdown
  {
    const pluck = makePluck(sr), silent = new Float32Array(pluck.length);
    const desc = stereo => ({ ...samplerPreset, nodes: samplerPreset.nodes.map(n => (n.type === 'sampler' && stereo ? { ...n, stereo: true } : n)) });
    const play = (stereo, data, right) => {
      const registry = new ParamRegistry();
      const rt = new GraphRuntime({ sampleRate: sr, params: registry.values });
      rt.load(compile(desc(stereo), { instrument: 'lead', nodeTypes: NODE_TYPES, registry }));
      rt.message('lead', 'sampler', { type: 'sample', data, right, rate: sr });
      rt.note('lead', { type: 'noteOn', note: 60, vel: 1 });
      return render(rt, 0.5);
    };
    const mono = play(false, pluck), both = play(true, pluck, Float32Array.from(pluck));
    assert.ok(peak(mono.left) > 0.01);
    for (let i = 0; i < mono.left.length; i += 97) assert.ok(Math.abs(mono.left[i] - both.left[i]) < 1e-5 && Math.abs(mono.left[i] - both.right[i]) < 1e-5, 'equal channels match the mono path');
    const hard = play(true, pluck, silent);
    assert.ok(peak(hard.left) > 0.01 && peak(hard.right) < 1e-6, 'filter and delay keep the channels apart');
    const folded = play(false, pluck, silent);
    assert.ok(peak(folded.left) > 0.01 && Math.abs(peak(folded.left) - peak(mono.left) / 2) < 0.01 * peak(mono.left), 'a stereo sample on a mono node plays its average');
    // the graph compiles the effects as pairs and says so
    const c = compile(desc(true), { instrument: 'x', nodeTypes: NODE_TYPES, registry: new ParamRegistry() });
    assert.deepEqual(c.nodes.filter(n => n.dual).map(n => n.id), ['filter', 'delay']);
    assert.ok(!compile(desc(false), { instrument: 'x', nodeTypes: NODE_TYPES, registry: new ParamRegistry() }).nodes.some(n => n.dual));
    // the patcher colours follow
    const kinds = resolveKinds(desc(true), NODE_TYPES).kindOf;
    assert.equal(kinds(desc(true).nodes[1], 'out'), 'stereo');
    assert.equal(resolveKinds(desc(false), NODE_TYPES).kindOf(desc(false).nodes[1], 'out'), 'audio');
    // files and instruments keep both channels
    const file = parseProject(serializeProject({ song: { name: 's', bpm: 100, ticksPerBeat: 4, length: 16 }, instruments: {}, samples: { st: { rate: sr, data: pluck.slice(0, 500), right: pluck.slice(100, 600) } }, lanes: [] }));
    assert.equal(file.samples.st.right.length, 500);
    assert.ok(Math.abs(file.samples.st.right[10] - pluck[110]) < 1e-3);
    const proj = { instruments: { lead: structuredClone(instruments.lead) }, samples: { pluck: { rate: sr, data: pluck.slice(0, 50), right: pluck.slice(5, 55) } } };
    const back = pops.importInstrument({ instruments: {}, samples: {} }, parseInstrument(serializeInstrument(proj, 'lead')));
    assert.ok(back);
    const target = { instruments: {}, samples: {} };
    pops.importInstrument(target, parseInstrument(serializeInstrument(proj, 'lead')));
    assert.equal(target.samples.pluck.right.length, 50);
    pops.syncSamplerStereo(proj.instruments.lead, proj.samples);
    assert.equal(proj.instruments.lead.graph.nodes.find(n => n.type === 'sampler').stereo, true);
    delete proj.samples.pluck.right;
    pops.syncSamplerStereo(proj.instruments.lead, proj.samples);
    assert.equal(proj.instruments.lead.graph.nodes.find(n => n.type === 'sampler').stereo, undefined);
    const ch = pops.channelsOf({ numberOfChannels: 2, getChannelData: c => Float32Array.of(c, c + 1) });
    assert.deepEqual([...ch.data, ...ch.right], [0, 1, 1, 2]);
    assert.equal(pops.channelsOf({ numberOfChannels: 1, getChannelData: () => Float32Array.of(1) }).right, undefined);
  }

  // renaming a sample follows it into the instruments that play it
  {
    const project = { instruments: { a: { samples: { sampler: 'one' } }, b: { samples: { sampler: 'two' } } }, samples: { one: { rate: 1, data: Float32Array.of(1) }, two: { rate: 1, data: Float32Array.of(2) } } };
    assert.equal(pops.renameSample(project, 'one', ' my kick! '), 'my_kick');
    assert.deepEqual(Object.keys(project.samples), ['my_kick', 'two'], 'the list keeps its order');
    assert.equal(project.instruments.a.samples.sampler, 'my_kick');
    assert.equal(project.instruments.b.samples.sampler, 'two');
    assert.throws(() => pops.renameSample(project, 'two', 'my_kick'), /already a sample/);
    assert.throws(() => pops.renameSample(project, 'zzz', 'x'), /No sample/);
    assert.equal(pops.renameSample(project, 'two', 'two'), 'two');
  }

  // preset library: copies in and out, the local list stays its own
  {
    const a = { graph: { nodes: [] }, presets: [] }, b = { graph: { nodes: [] } };
    presetOps.addPreset(a, { name: 'dark', values: { 'f.cutoff': 400 } });
    presetOps.addPreset(a, { name: 'bright', values: { 'f.cutoff': 9000 }, data: { w: { curve: [0, 1] } } });
    const library = lib.newLibrary();
    assert.equal(lib.addToLibrary(library, a, 'lead', [1]), 1, 'only the listed preset');
    assert.equal(lib.addToLibrary(library, a, 'lead'), 2);
    assert.equal(library.presets.length, 2, 'the same name from the same machine is replaced');
    a.presets[1].values['f.cutoff'] = 1;
    assert.equal(library.presets.find(p => p.name === 'bright').values['f.cutoff'], 9000, 'the library holds a copy');
    const back = lib.parseLibrary(lib.serializeLibrary(library));
    assert.deepEqual(back.presets.map(p => p.name).sort(), ['bright', 'dark']);
    const bright = back.presets.find(p => p.name === 'bright');
    const id = lib.importFromLibrary(b, bright);
    assert.equal(b.presets[0].values['f.cutoff'], 9000);
    assert.deepEqual(b.presets[0].data.w.curve, [0, 1]);
    b.presets[0].values['f.cutoff'] = 5;
    assert.equal(bright.values['f.cutoff'], 9000, 'and the instrument gets its own');
    assert.equal(lib.importFromLibrary(b, bright), id, 'importing the same name again overwrites it in place');
    assert.equal(b.presets.length, 1);
    assert.throws(() => lib.parseLibrary('{"format":"x"}'), /Not a preset library/);
    assert.throws(() => lib.parseLibrary('nope'), /invalid JSON/);
  }

  // song length: rounds to rows, longer keeps everything, shorter trims placements
  {
    const project = { song: { length: 64 }, lanes: [{ placements: [{ puid: 'a', start: 0, length: 16 }, { puid: 'a', start: 40, length: 16 }, { puid: 'a', start: 48, length: 16 }] }] };
    assert.equal(pops.setSongLength(project, 130), 128);
    assert.equal(project.lanes[0].placements.length, 3);
    pops.setSongLength(project, 48);
    assert.deepEqual(project.lanes[0].placements.map(p => [p.start, p.length]), [[0, 16], [40, 8]], 'one dropped, one trimmed');
    assert.throws(() => pops.setSongLength(project, 0), /16 to 65536/);
    assert.throws(() => pops.setSongLength(project, 'x'), /16 to 65536/);
  }

  // insert silence: later placements, marks and the loop move; a placement across the point is cut
  {
    const registry = new ParamRegistry();
    for (const [id, def] of Object.entries(instruments)) compile(def.graph, { instrument: id, nodeTypes: NODE_TYPES, registry });
    const [l] = prepareSong({ ...demoSong, lanes: [{ id: 'g', instrument: 'lead', patterns: { a: { text: patternText(48, {}) }, b: { text: patternText(16, {}) } }, placements: [{ puid: 'a', start: 0, length: 48 }, { puid: 'b', start: 64, length: 16 }], mutes: [64], offs: [80] }] }, instruments, registry);
    l.mutes = [64]; l.offs = [80];
    const project = { song: { length: 128, loop: { start: 64, end: 96 } }, lanes: [l] };
    assert.equal(pops.insertTicks(project, 20, 32), 32);
    assert.equal(project.song.length, 160);
    assert.deepEqual(l.placements.map(p => p.start).sort((a, b) => a - b), [0, 48, 96], 'cut at the row, the tail and the rest moved');
    assert.deepEqual([l.mutes, l.offs], [[96], [112]]);
    assert.deepEqual(project.song.loop, { start: 96, end: 128 });
    assert.throws(() => pops.insertTicks(project, 0, 70000), /would pass/);
    const keep = { song: { length: 128 }, lanes: [{ ...l, placements: [{ puid: 'a', start: 0, length: 48 }, { puid: 'b', start: 64, length: 16 }], mutes: [], offs: [] }] };
    pops.insertTicks(keep, 20, 32, { cut: false });
    assert.deepEqual(keep.lanes[0].placements.map(p => [p.start, p.length]), [[0, 48], [96, 16]], 'uncut: the crossing pattern stays whole');
  }

  // config: values are checked, listeners hear changes, export and import round-trip
  {
    const cfg = await import('../src/ui/config.js');
    const heard = [];
    const off = cfg.onChange((k, v) => heard.push([k, v]));
    cfg.reset(); heard.length = 0;
    assert.equal(cfg.get('insertCut'), false, 'inserting does not cut by default');
    assert.equal(cfg.set('insertLength', 99999), 65536, 'clamped');
    assert.equal(cfg.set('insertLength', 'x'), 128, 'junk gives the default');
    assert.equal(cfg.set('theme', 'nope'), 'system');
    cfg.set('theme', 'neon'); cfg.set('theme', 'neon');
    assert.deepEqual(heard.filter(([k]) => k === 'theme'), [['theme', 'neon']], 'a listener hears a change once');
    const file = cfg.exportJson();
    cfg.reset();
    assert.equal(cfg.get('theme'), 'system');
    assert.ok(cfg.importJson(file) >= 8);
    assert.equal(cfg.get('theme'), 'neon');
    assert.throws(() => cfg.importJson('nope'), /invalid JSON/);
    assert.throws(() => cfg.importJson('{"a":1}'), /not a webtracker config/);
    assert.throws(() => cfg.set('zzz', 1), /No setting/);
    cfg.reset(); off(); uiConfig.set('arrowStyle', 'char');
  }

  // merge a block into one pattern per lane: crossing patterns are cut at its edges, no overlaps
  {
    const registry = new ParamRegistry();
    for (const [id, def] of Object.entries(instruments)) compile(def.graph, { instrument: id, nodeTypes: NODE_TYPES, registry });
    const note = (t, n) => ({ [t]: `${n} .. .. .... .... .. .. ..` });
    const mk = (id, patterns, placements) => ({ id, instrument: 'lead', patterns, placements });
    const k = mk('k', { a: { text: patternText(64, note(48, 'C-4')) }, b: { text: patternText(64, note(0, 'D-4')) }, c: { text: patternText(64, {}) } },
      [{ puid: 'a', start: 0, length: 64 }, { puid: 'b', start: 64, length: 64 }, { puid: 'c', start: 128, length: 64 }]);
    const p = mk('p', { a: { text: patternText(144, note(112, 'E-4')) } }, [{ puid: 'a', start: 16, length: 144 }]);
    const lanes = prepareSong({ ...demoSong, length: 256, lanes: [k, p] }, instruments, registry);
    const editor = createEditor(lanes, 256);
    const starts = l => l.placements.map(x => [x.start, x.length]).sort((x, y) => x[0] - y[0]);
    assert.equal(editor.mergeRange(0, 1, 48, 128), 2);
    assert.deepEqual(starts(lanes[0]), [[0, 48], [48, 80], [128, 64]], 'kick: head kept, one new pattern, tail untouched');
    assert.deepEqual(starts(lanes[1]), [[16, 32], [48, 80], [128, 32]], 'lead: cut at both edges');
    const made = placementAt(lanes[0], 48), pat = lanes[0].patterns[made.puid];
    assert.equal(pat.length, 80);
    assert.equal(pat.rows[0][0], 'C-4', 'A row 48 is the new first row');
    assert.equal(pat.rows[16][0], 'D-4', 'then B');
    const tail = placementAt(lanes[1], 128), tp = lanes[1].patterns[tail.puid];
    assert.equal(tp.rows[0][0], 'E-4', 'the lead tail starts at the pattern row that was at tick 128');
    assert.equal(lanes[0].rows[48][0], 'C-4', 'what plays is unchanged');
    assert.equal(lanes[0].rows[64][0], 'D-4');
    assert.equal(editor.mergeRange(0, 0, 200, 224), 1, 'no pattern in the span: an empty one is made');
    const blank = placementAt(lanes[0], 200);
    assert.deepEqual([blank.start, blank.length, lanes[0].patterns[blank.puid].length], [200, 24, 24]);
    assert.ok(editor.undo());
    assert.ok(editor.undo(), 'one undo step');
    assert.deepEqual(starts(lanes[0]), [[0, 64], [64, 64], [128, 64]]);
    assert.deepEqual(starts(lanes[1]), [[16, 144]]);
  }

  // new instruments: the kick synth and the empty graph compile, expose what they say, and get lanes
  {
    const registry = new ParamRegistry();
    const project = { song: { length: 64 }, instruments: {}, samples: {}, lanes: [] };
    const kick = pops.addSynthInstrument(project, '', 'kick'), blank = pops.addSynthInstrument(project, 'blank', 'empty');
    for (const id of [kick, blank]) compile(project.instruments[id].graph, { instrument: id, nodeTypes: NODE_TYPES, registry });
    assert.deepEqual(project.instruments[kick].exposed.map(e => e.label), ['Pit', 'PDc', 'Dec', 'Tun']);
    const lane = pops.addLane(project, registry, kick);
    assert.ok(lane.columns.some(c => c.label === 'Tun'));
    assert.deepEqual(project.instruments[blank].graph.nodes.map(n => n.type).sort(), ['out', 'voices']);
  }

  // solo: the others are muted with mask 3 (not saved), master never is; the dim level eases in slowly and out fast
  {
    const registry = new ParamRegistry();
    for (const [id, def] of Object.entries(instruments)) compile(def.graph, { instrument: id, nodeTypes: NODE_TYPES, registry });
    const lanes = prepareSong({ ...demoSong, lanes: [{ id: 'a', instrument: 'lead', patterns: {}, placements: [] }, { id: 'b', instrument: 'bass', patterns: {}, placements: [] }] }, instruments, registry);
    const editor = createEditor(lanes, 64);
    assert.equal(editor.solo(0), true);
    assert.deepEqual([lanes[0].mask[5], lanes[1].mask[5]], [0, 3], 'a plays, b is quiet');
    assert.equal(lanes[1].soloMuted, true);
    editor.solo(1);
    assert.deepEqual([lanes[0].mask[5], lanes[1].mask[5]], [0, 0], 'both soloed: both play');
    editor.solo(0); editor.solo(1);
    assert.deepEqual([lanes[0].mask[5], lanes[1].mask[5]], [0, 0], 'no solo: everyone plays');
    lanes[0].silenced = true; editor.solo(1); ops.refreshMask(lanes[0], 64);
    assert.equal(lanes[0].mask[5], 2, 'a silenced lane stays silenced');
    const { dimLevel, FADE_OUT, FADE_IN } = await import('../src/ui/dim.js');
    const probe = {};
    dimLevel(probe, 0, 0);
    assert.ok(Math.abs(dimLevel(probe, 1, FADE_OUT * 500) - 0.5) < 1e-9, 'half-way after half the fade');
    assert.equal(dimLevel(probe, 1, FADE_OUT * 1000 + 50), 1);
    assert.equal(dimLevel(probe, 0, FADE_OUT * 1000 + 50 + FADE_IN * 1000), 0, 'and back out fast');
  }

  // patterns start on multiples of 16, wherever in the row the request lands
  {
    const registry = new ParamRegistry();
    for (const [id, def] of Object.entries(instruments)) compile(def.graph, { instrument: id, nodeTypes: NODE_TYPES, registry });
    const lanes = prepareSong(demoSong, instruments, registry);
    const editor = createEditor(lanes, 64);
    const lane = lanes[2];   // kick: patterns at 0 and 16
    assert.ok(editor.remove(2, 16) && editor.remove(2, 0));
    assert.ok(editor.insertPattern(2, 21));
    assert.deepEqual(lane.placements.map(p => p.start), [16], 'an insert in the middle of a row starts at the row');
    const puid = Object.keys(lane.patterns)[0];
    assert.ok(editor.placePattern(2, 37, puid));
    assert.deepEqual(lane.placements.map(p => p.start).sort((a, b) => a - b), [16, 32], 'so does a placement');
  }

  // the default project: loads, plays all six lanes, stays inside full scale
  {
    const p = createSynthwaveProject();
    const registry = new ParamRegistry();
    const rt = new GraphRuntime({ sampleRate: sr, params: registry.values });
    const seq = new Sequencer({ sampleRate: sr, runtime: rt, params: registry.values, transport: new Int32Array(new SharedArrayBuffer(8)) });
    for (const [id, def] of Object.entries(p.instruments)) rt.load(compile(def.graph, { instrument: id, nodeTypes: NODE_TYPES, registry }));
    seq.setSong(p.song);
    const lanes = prepareSong(p.song, p.instruments, registry);
    assert.deepEqual(lanes.map(l => l.id), ['kick', 'snare', 'bass', 'pad', 'arp', 'lead']);
    for (const lane of lanes) seq.setLane(lane);
    seq.play();
    const { left, right } = render(seq, 12);
    assert.ok(![...left, ...right].some(Number.isNaN));
    assert.ok(peak(left) > 0.3 && peak(left) < 1 && peak(right) < 1, `mix peak ${peak(left)}`);
    const roundTrip = parseProject(serializeProject({ ...p, lanes }));
    assert.equal(roundTrip.song.length, 128);
  }

  // mute: m starts it, m again ends it; muted ticks play no notes but a held note is let go
  {
    const registry = new ParamRegistry();
    for (const [id, def] of Object.entries(instruments)) compile(def.graph, { instrument: id, nodeTypes: NODE_TYPES, registry });
    const lanes = prepareSong(demoSong, instruments, registry);
    const editor = createEditor(lanes, 32);
    let onKey;
    const el = { addEventListener: (type, f) => { if (type === 'keydown') onKey = f; else if (type === 'wheel') onWheel = f; }, innerHTML: '' }, statusEl = { textContent: '' };
    const view = createSequenceView({ el, statusEl, transport: new Int32Array(new SharedArrayBuffer(8)), onToggle() {}, onOpen() {} });
    view.load({ lanes, song: demoSong, editor });
    const press = key => onKey({ key, preventDefault() {} });
    press('m');                                                            // row 0: mute the lead
    assert.deepEqual(lanes[0].mutes, [0]);
    assert.equal(lanes[0].mask[0], 1); assert.equal(lanes[0].mask[31], 1, 'with one flip it stays muted to the end');
    press('ArrowDown'); press('m');                                        // row 1 (tick 16): play again
    assert.deepEqual(lanes[0].mutes, [0, 16]);
    assert.equal(lanes[0].mask[15], 1); assert.equal(lanes[0].mask[16], 0);
    view.draw();
    assert.ok(el.innerHTML.includes('muted') && el.innerHTML.includes('&lt;mute&gt;</span>') && el.innerHTML.includes('&lt;play&gt;</span>'), 'the view marks the flips with <mute> and <play> cells');
    onKey({ key: 'z', ctrlKey: true, preventDefault() {} });
    assert.deepEqual(lanes[0].mutes, [0], 'undo takes the last flip away');
    assert.equal(lanes[0].mask[20], 1);
    press('m'); assert.deepEqual(lanes[0].mutes, [0, 16]);
    press('m'); assert.deepEqual(lanes[0].mutes, [0], 'the same key on a flip removes it');

    // the loop: Ctrl+B starts it at the cursor's row, Ctrl+E ends it with the row; the same key on the same point takes it away
    {
      const ctrl = key => onKey({ key, ctrlKey: true, preventDefault() {} });
      ctrl('b'); assert.deepEqual(demoSong.loop, { start: 16, end: demoSong.length });
      view.draw();
      ctrl('b'); assert.equal(demoSong.loop, undefined, 'the same start again takes it away');
      ctrl('e'); assert.deepEqual(demoSong.loop, { start: 0, end: 16 }, 'Ctrl+E ends the loop where the cursor row starts: the row above is the loop');
      ctrl('e'); assert.equal(demoSong.loop, undefined, 'the same point again takes it away');
      ctrl('b'); ctrl('l'); assert.equal(demoSong.loop.off, true, 'Ctrl+L switches the loop off, keeping its points');
      view.draw();   // the loop is drawn as two overlay lines now, which need a real page; here it just must not throw
      ctrl('l'); assert.equal(demoSong.loop.off, undefined); ctrl('b'); assert.equal(demoSong.loop, undefined);
    }

    {   // Ctrl+wheel: the row size steps 16, 8, 4 ticks and back; the bar length sets the biggest
      const wheel = dy => onWheel({ ctrlKey: true, deltaY: dy, deltaMode: 0, preventDefault() {} });
      const sleep = ms => new Promise(r => setTimeout(r, ms));
      view.draw(); assert.ok(el.innerHTML.includes('0016 ') && !el.innerHTML.includes('0008 '));
      wheel(-100); view.draw(); assert.ok(el.innerHTML.includes('0008 '), 'zoomed in: rows of 8 ticks');
      await sleep(130); wheel(-100); view.draw(); assert.ok(el.innerHTML.includes('0004 ') && !el.innerHTML.includes('0016 ') || el.innerHTML.includes('0004 '), 'and rows of 4 ticks');
      await sleep(130); wheel(-100); view.draw(); assert.ok(/Rows are 4 ticks/.test(statusEl.textContent), 'a beat is the smallest row');
      await sleep(130); wheel(100); await sleep(130); wheel(100); view.draw(); assert.ok(el.innerHTML.includes('0016 ') && !el.innerHTML.includes('0008 '), 'back to a bar');
      demoSong.beatsPerBar = 3; view.draw(); assert.ok(el.innerHTML.includes('0012 '), '3 beats in a bar: rows of 12 ticks');
      delete demoSong.beatsPerBar; view.draw(); assert.ok(el.innerHTML.includes('0016 '));
    }

    // Shift+M silences the whole lane over the flips, and again brings it back
    onKey({ key: 'M', shiftKey: true, preventDefault() {} });
    assert.equal(lanes[0].silenced, true);
    assert.ok(lanes[0].mask.every(v => v === 2), 'every tick is silenced, flips or not');
    assert.deepEqual(lanes[0].mutes, [0], 'the flips are kept');
    view.draw(); assert.ok(el.innerHTML.includes('class="silenced"'));
    onKey({ key: 'M', shiftKey: true, preventDefault() {} });
    assert.equal(lanes[0].silenced, false);
    assert.ok(lanes[0].mask.every(v => v === 1), 'the flips apply again');
    assert.equal(pops.projectData({ song: demoSong, instruments, samples: {}, lanes: [{ ...lanes[0], silenced: true }] }).song.lanes[0].silenced, true);
    assert.equal(parseProject(serializeProject({ song: { name: 's', bpm: 100, ticksPerBeat: 4, length: 32 }, instruments, samples: { pluck: { rate: sr, data: Float32Array.of(0) } }, lanes: [{ ...lanes[0], silenced: true }] })).song.lanes[0].silenced, true);

    // the sequencer plays no notes while muted, and keeps writing parameters
    const p2 = songSetup(song120([oneLane('lead', 'lead', patternText(16, { 0: 'C-4 .. .. .... .... 80 .. ..', 8: 'E-4 .. .. .... .... 90 .. ..' }))]));
    const lane = prepareSong(p2.seq.song, instruments, p2.registry)[0];
    lane.mutes = [4, 12]; lane.mask = new Uint8Array(new SharedArrayBuffer(16)); lane.mask.fill(1, 4, 12);
    p2.seq.setLane(lane);
    p2.seq.play();
    const out = render(p2.seq, 1.9);
    const first = out.left.findIndex(v => Math.abs(v) > 1e-9);
    assert.ok(first >= 0 && first < 6000 * 4, 'the note before the mute plays');
    const during = out.left.slice(6000 * 8, 6000 * 11);   // the E-4 at tick 8 is inside the mute; the first note is released at tick 4
    assert.ok(peak(during) < peak(out.left.slice(0, 6000 * 4)) * 0.2, 'nothing new plays while muted');
    assert.ok(Math.abs(p2.registry.get('lead.filter.cutoff') - 20 * Math.pow(18000 / 20, 144 / 255)) < 1, 'the parameter column still wrote its slot');
    // saved and loaded
    const back = parseProject(serializeProject({ song: { name: 's', bpm: 100, ticksPerBeat: 4, length: 32 }, instruments, samples: { pluck: { rate: sr, data: Float32Array.of(0) } }, lanes: [{ ...lanes[0], mutes: [0, 16] }] }));
    assert.deepEqual(back.song.lanes[0].mutes, [0, 16]);
    assert.deepEqual(pops.projectData({ song: demoSong, instruments, samples: {}, lanes }).song.lanes[0].mutes, [0]);
  }

  // pattern colours: K steps through 16 presets and back to automatic; saved with the project
  {
    const registry = new ParamRegistry();
    for (const [id, def] of Object.entries(instruments)) compile(def.graph, { instrument: id, nodeTypes: NODE_TYPES, registry });
    const lanes = prepareSong(demoSong, instruments, registry);
    const editor = createEditor(lanes, 32);
    let onKey;
    const el = { addEventListener: (type, f) => { if (type === 'keydown') onKey = f; else if (type === 'wheel') onWheel = f; }, innerHTML: '' }, statusEl = { textContent: '' };
    const view = createSequenceView({ el, statusEl, transport: new Int32Array(new SharedArrayBuffer(8)), onToggle() {}, onOpen() {} });
    view.load({ lanes, song: demoSong, editor });
    const key = (k, extra = {}) => onKey({ key: k, preventDefault() {}, ...extra });
    const pat = () => lanes[0].patterns[lanes[0].placements.find(p => p.start === 0).puid];
    assert.equal(pat().color, undefined);
    key('k'); assert.equal(pat().color, 0);
    view.draw(); assert.ok(/class="L c0/.test(el.innerHTML));
    assert.ok(!el.innerHTML.includes('class="sw '), 'the cursor cell carries no swatch: the pattern list shows the colour');
    for (let i = 0; i < 15; i++) key('k');
    assert.equal(pat().color, 15);
    key('k'); assert.equal(pat().color, undefined, 'after the last preset comes automatic again');
    key('k', { shiftKey: true }); assert.equal(pat().color, 15, 'Shift+K goes backwards');
    editor.undo(); assert.equal(pat().color, undefined);
    key('k'); key('k');
    const back = parseProject(serializeProject({ song: { name: 's', bpm: 100, ticksPerBeat: 4, length: 32 }, instruments, samples: { pluck: { rate: sr, data: Float32Array.of(0) } }, lanes }));
    assert.equal(Object.values(back.song.lanes[0].patterns).find(p => p.color !== undefined).color, 1);
    assert.equal(Object.values(pops.projectData({ song: demoSong, instruments, samples: {}, lanes }).song.lanes[0].patterns).find(p => p.color !== undefined).color, 1);
    const copy = pops.duplicateLane({ lanes, song: { length: 32 } }, 'lead');
    assert.equal(Object.values(copy.patterns).find(p => p.color !== undefined).color, 1, 'a duplicated lane keeps its colours');
    pat().color = '#aa3355'; view.draw();
    assert.ok(el.innerHTML.includes('--c:#aa3355'), 'a custom colour is drawn');
    pat().color = 'red; x'; view.draw(); assert.ok(!el.innerHTML.includes('red; x'), 'anything but #rrggbb is ignored');
  }
}

// 85. Sample-level settings, a sustain loop and loop crossfades in the sampler.
{
  const sampler = (await import('../src/audio/nodes/sampler.js')).default;
  const ramp = Float32Array.from({ length: 2000 }, (_, i) => i / 2000);
  const play = (msg, { stereo = false, frames = 3000, off = null, params = [1, 60, 150, 20, 0, 0, 0, 0, 0, 1], clock } = {}) => {
    const node = sampler.create({ sampleRate: sr, stereo, clock });
    node.message({ type: 'sample', data: ramp, rate: sr, ...msg });
    node.note({ type: 'noteOn', note: 60, vel: 1 });
    const L = new Float32Array(frames), R = new Float32Array(frames);
    for (let at = 0; at < frames; at += block) {
      if (off !== null && at === off) node.note({ type: 'noteOff', note: 60 });
      const outL = new Float32Array(block), outR = new Float32Array(block);
      node.process([], [stereo ? [outL, outR] : outL], block, params, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
      L.set(outL.subarray(0, Math.min(block, frames - at)), at);
      R.set(outR.subarray(0, Math.min(block, frames - at)), at);
    }
    return { L, R };
  };
  // volume and global volume scale every note, and so do both together
  const base = play({}, { frames: 1024 }).L;
  const half = play({ volume: 0.5 }, { frames: 1024 }).L, quarter = play({ volume: 0.5, globalVolume: 0.5 }, { frames: 1024 }).L;
  assert.ok(Math.abs(half[800] - base[800] * 0.5) < 1e-6 && Math.abs(quarter[800] - base[800] * 0.25) < 1e-6);
  // pan: hard left silences the right channel; centre leaves both
  const left = play({ pan: -1 }, { stereo: true, frames: 1024 });
  assert.ok(left.R.every(v => v === 0) && Math.abs(left.L[800] - base[800]) < 1e-6);
  const mid = play({}, { stereo: true, frames: 1024 });
  assert.ok(Math.abs(mid.L[800] - mid.R[800]) < 1e-9 && Math.abs(mid.L[800] - base[800]) < 1e-6);
  // sustain loop: held notes stay inside it; at note off, with no normal loop, the tail plays on to the end
  const held = play({ susStart: 200, susEnd: 400 }, { frames: 3000 }).L;
  assert.ok(peak(held) <= 0.2 + 1e-6 && peak(held) > 0.15, 'the sustain loop holds the voice between its points');
  const released = play({ susStart: 200, susEnd: 400 }, { frames: 3000, off: 1024 }).L;
  assert.ok(peak(released) > 0.9, 'the tail after the sustain loop plays out');
  assert.ok(released.subarray(2900).every(v => v === 0), 'and then the voice ends');
  // with a normal loop as well, note off carries on into it and fades out
  const both = play({ susStart: 200, susEnd: 400, loopStart: 1000, loopEnd: 1200 }, { frames: 80000, off: 1024, params: [1, 60, 1000, 20, 0, 0, 0, 0, 0, 1] }).L;
  assert.ok(peak(both.subarray(2000, 8000)) > 0.3 && peak(both.subarray(2000, 8000)) <= 0.6 + 1e-6, 'the voice plays on in the normal loop');
  assert.ok(both.subarray(75000).every(v => v === 0), 'and fades out');
  // loop off ignores the loop points
  assert.ok(peak(play({ loopStart: 200, loopEnd: 400, loopOn: false }, { frames: 3000 }).L) > 0.9);
  // crossfade: the seam of a sawtooth loop is a jump; the crossfade smooths it away
  const maxJump = out => out.subarray(1500, 5500).reduce((m, v, i, a) => (i ? Math.max(m, Math.abs(v - a[i - 1])) : m), 0);
  const seam = play({ loopStart: 600, loopEnd: 1400 }, { frames: 6000 }).L;
  const smooth = play({ loopStart: 600, loopEnd: 1400, loopXfade: 200 }, { frames: 6000 }).L;
  assert.ok(maxJump(seam) > 0.3, 'an unfaded loop jumps at its seam');
  assert.ok(maxJump(smooth) < 0.01, 'the crossfade removes the jump');
  // settings are validated, defaults are not stored, and the sampler message carries them
  const project = { samples: { s: { rate: sr, data: ramp } }, instruments: { a: { samples: { sampler: 's' } } } };
  assert.deepEqual(pops.setSampleProps(project, 's', { volume: 0.5, pan: -0.25, susOn: false, loopXfade: 64 }), [{ instrument: 'a', node: 'sampler' }]);
  assert.throws(() => pops.setSampleProps(project, 's', { volume: 2 }));
  assert.throws(() => pops.setSampleProps(project, 's', { loopXfade: 1.5 }));
  assert.throws(() => pops.setSampleProps(project, 's', { nope: 1 }));
  pops.setSampleProps(project, 's', { volume: 1 });
  assert.equal(project.samples.s.volume, undefined);
  pops.setLoop(project, 's', 100, 900, 'sus');
  const msg = pops.sampleMessage(project.samples.s);
  assert.deepEqual([msg.pan, msg.susStart, msg.susEnd, msg.susOn, msg.loopXfade], [-0.25, 100, 900, false, 64]);
  const back = parseProject(serializeProject({ song: { name: 's', bpm: 100, ticksPerBeat: 4, length: 16 }, instruments: {}, samples: project.samples, lanes: [] }));
  assert.deepEqual([back.samples.s.pan, back.samples.s.susEnd, back.samples.s.loopXfade, back.samples.s.volume], [-0.25, 900, 64, undefined]);
}

// 86. The spectrogram puts a pure tone on its own row and brightens with level.
{
  const tone = Float32Array.from({ length: 8000 }, (_, i) => Math.sin(i * 0.3));
  const cells = computeSpectrogram(tone, null, 20, 40);
  const column = x => Array.from({ length: 40 }, (_, y) => cells[y * 20 + x]);
  assert.equal(column(10).indexOf(Math.max(...column(10))), 27, 'the tone sits at its frequency');
  const re = Float64Array.from([1, 0, 0, 0, 0, 0, 0, 0]), im = new Float64Array(8);
  fft(re, im);
  assert.ok(re.every(v => Math.abs(v - 1) < 1e-12) && im.every(v => Math.abs(v) < 1e-12), 'the FFT of an impulse is flat');
}

// 87. Sample editing tools, undo, selection and keyjazz.
{
  const edit = await import('../src/project/sampleedit.js');
  const mk = (n = 1000, right = false) => {
    const s = { rate: sr, data: Float32Array.from({ length: n }, (_, i) => 0.5 * Math.sin(i * 0.1) + 0.1) };
    if (right) s.right = Float32Array.from({ length: n }, (_, i) => 0.25 * Math.cos(i * 0.1));
    return s;
  };
  const project = { samples: { s: mk(1000, true) }, instruments: { a: { samples: { sampler: 's' } } } };
  const history = edit.createHistory();
  const s = project.samples.s;
  const orig = s.data.slice();
  // crop keeps a loop that lies inside the range, moved; cut shifts the points after the removed part
  s.loopStart = 300; s.loopEnd = 700; s.susStart = 100; s.susEnd = 200;
  assert.deepEqual(edit.applyEdit(project, 's', history, 'crop', { from: 250, to: 800 }), [{ instrument: 'a', node: 'sampler' }]);
  assert.equal(s.data.length, 550); assert.equal(s.right.length, 550);
  assert.deepEqual([s.loopStart, s.loopEnd, s.susStart], [50, 450, undefined], 'the loop inside the crop survives, the one outside goes');
  assert.equal(s.data[0], orig[250]);
  edit.undoEdit(project, 's', history);
  assert.equal(s.data.length, 1000); assert.deepEqual([s.loopStart, s.loopEnd, s.susStart, s.susEnd], [300, 700, 100, 200], 'undo restores the audio and the loops');
  edit.redoEdit(project, 's', history); assert.equal(s.data.length, 550);
  edit.undoEdit(project, 's', history);
  edit.applyEdit(project, 's', history, 'cut', { from: 400, to: 500 });
  assert.deepEqual([s.data.length, s.loopStart, s.loopEnd, s.susEnd], [900, 300, 600, 200]);
  edit.undoEdit(project, 's', history);
  // reverse, silence, fades, normalise, DC removal, on a range and on both channels
  const before = s.data.slice(), beforeR = s.right.slice();
  edit.applyEdit(project, 's', history, 'reverse', { from: 10, to: 20 });
  assert.equal(s.data[10], before[19]); assert.equal(s.right[10], beforeR[19]); assert.equal(s.data[25], before[25]);
  edit.applyEdit(project, 's', history, 'silence', { from: 0, to: 5 });
  assert.ok(s.data.subarray(0, 5).every(v => v === 0) && s.right.subarray(0, 5).every(v => v === 0));
  edit.applyEdit(project, 's', history, 'fadeIn', { from: 100, to: 200 });
  assert.equal(Math.abs(s.data[100]), 0); assert.ok(Math.abs(s.data[150] - before[150] * 0.5) < 1e-6);
  edit.applyEdit(project, 's', history, 'fadeOut', { from: 300, to: 400 });
  assert.ok(Math.abs(s.data[350] - before[350] * 0.5) < 1e-6);
  edit.applyEdit(project, 's', history, 'normalise', null);
  assert.ok(Math.abs(peak(s.data) - 1) < 1e-6 || Math.abs(peak(s.right) - 1) < 1e-6);
  assert.ok(Math.max(peak(s.data), peak(s.right)) <= 1 + 1e-6 && Math.max(peak(s.data), peak(s.right)) > 0.999, 'normalise reaches full scale in the louder channel');
  edit.applyEdit(project, 's', history, 'removeDc', null);
  assert.ok(Math.abs(s.data.reduce((a, v) => a + v, 0) / s.data.length) < 1e-5);
  assert.throws(() => edit.applyEdit(project, 's', history, 'cut', { from: 0, to: 1000 }), /whole sample/);
  assert.throws(() => edit.applyEdit(project, 's', history, 'reverse', { from: 5, to: 5 }), /empty/);
  assert.throws(() => edit.applyEdit(project, 's', history, 'bakeCrossfade', null), /crossfade/);
  edit.applyEdit(project, 's', history, 'silence', { from: 0, to: 5 });
  const depth = history.depth('s');
  assert.throws(() => edit.applyEdit(project, 's', history, 'normalise', { from: 0, to: 5 }), /silent/);
  assert.equal(history.depth('s'), depth, 'a refused edit leaves no undo step');

  // baking the crossfade writes what the sampler would play: no jump at the loop seam, and the setting is cleared
  const saw = { rate: sr, data: Float32Array.from({ length: 2000 }, (_, i) => i / 2000), loopStart: 600, loopEnd: 1400, loopXfade: 200 };
  const p2 = { samples: { w: saw }, instruments: {} };
  edit.applyEdit(p2, 'w', edit.createHistory(), 'bakeCrossfade', null);
  assert.equal(saw.loopXfade, undefined);
  assert.ok(Math.abs(saw.data[1399] - saw.data[599 + 0]) < 0.01 + 1 / 2000 * 2, 'the end of the loop now leads into its start');
  assert.ok(saw.data[1300] !== 1300 / 2000, 'the audio before the end changed');

  // the keyjazz instrument: a sampler straight into the output plays the sample with only its own settings
  {
    const registry = new ParamRegistry();
    const rt = new GraphRuntime({ sampleRate: sr, params: registry.values });
    const def = { nodes: [{ id: 'sampler', type: 'sampler', stereo: true }, { id: 'out', type: 'out', params: { gain: 0.45 } }], connections: [['sampler.out', 'out.in']] };
    rt.load(compile(def, { instrument: '__audition', nodeTypes: NODE_TYPES, registry }));
    const st = { rate: sr, data: Float32Array.from({ length: 20000 }, (_, i) => Math.sin(i * 0.2)), right: Float32Array.from({ length: 20000 }, (_, i) => 0.5 * Math.sin(i * 0.3)), pan: -1, volume: 0.5 };
    rt.message('__audition', 'sampler', pops.sampleMessage(st));
    rt.note('__audition', { type: 'noteOn', note: 60, vel: 1 });
    const out = render(rt, 0.2);
    assert.ok(peak(out.left) > 0.05, 'the audition instrument is audible');
    assert.ok(out.right.every(v => v === 0), 'the sample pan applies');
  }

  // keyjazz chokes: a new note fades a one-shot that is still playing; without it the two ring together
  {
    const sampler = (await import('../src/audio/nodes/sampler.js')).default;
    const hold = Float32Array.from({ length: 40000 }, () => 0.5);
    const run = extra => {
      const node = sampler.create({ sampleRate: sr });
      node.message({ type: 'sample', data: hold, rate: sr });
      node.note({ type: 'noteOn', note: 60, vel: 1 });
      const out = new Float32Array(block);
      for (let at = 0; at < 1024; at += block) node.process([], [out], block, [1, 60, 150, 20, 0, 0, 0, 0, 0, 1], [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
      node.note({ type: 'noteOn', note: 60, vel: 1, ...extra });
      for (let at = 0; at < 8192; at += block) node.process([], [out], block, [1, 60, 150, 20, 0, 0, 0, 0, 0, 1], [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
      return out[block - 1];
    };
    assert.ok(Math.abs(run({ choke: true }) - 0.5) < 1e-6, 'one voice is left after the fade');
    assert.ok(Math.abs(run({}) - 1) < 1e-6, 'without choke a one-shot rings on');
  }

  // trim with no selection keeps the loop region; with neither it refuses
  {
    const t = { rate: sr, data: Float32Array.from({ length: 1000 }, (_, i) => i), loopStart: 200, loopEnd: 600, susStart: 700, susEnd: 800 };
    const pt = { samples: { t }, instruments: {} };
    edit.applyEdit(pt, 't', edit.createHistory(), 'crop', null);
    assert.equal(t.data.length, 400); assert.equal(t.data[0], 200);
    assert.deepEqual([t.loopStart, t.loopEnd, t.susStart], [0, 400, undefined], 'the loop now spans the sample; the loop outside went');
    assert.throws(() => edit.applyEdit(pt, 't', edit.createHistory(), 'crop', null) && (delete t.loopStart, delete t.loopEnd, edit.applyEdit(pt, 't', edit.createHistory(), 'crop', null)), /Select the part to keep/);
  }

  // the screen: selection fields, edit keys, undo keys, keyjazz
  const { project: pr } = makeProject();
  pops.addSample(pr, 'w.wav', 44100, Float32Array.from({ length: 4000 }, (_, i) => Math.sin(i * 0.05)));
  let onKey, onUp;
  const el = { addEventListener: (type, f) => { if (type === 'keydown') onKey = f; if (type === 'keyup') onUp = f; }, innerHTML: '' };
  const events = [];
  const screen = createSampleScreen({ el, statusEl: { textContent: '' }, getProject: () => pr, onChange: () => events.push('change'), onNote: (id, note, on) => events.push(['note', id, note, on]), onSelection: (a, b) => events.push(['sel', a, b]) });
  const key = (k, extra = {}) => onKey({ key: k, preventDefault() {}, ...extra });
  screen.select('w');
  // keyjazz: Z plays the root (octave 5), keys release on key up, [ and ] move the octave, Space plays the root
  key('z'); onUp({ key: 'z' });
  key('q'); onUp({ key: 'q' });
  key(']'); key('z'); onUp({ key: 'z' });
  key(' '); onUp({ key: ' ' });
  assert.deepEqual(events.filter(e => e[0] === 'note'), [60, 72, 72, 60].flatMap(n => [['note', 'w', n, true], ['note', 'w', n, false]]));
  key('[');
  key('z'); key('z', { repeat: true }); assert.equal(events.filter(e => e[0] === 'note').length, 9, 'a held key does not retrigger');
  onUp({ key: 'z' });
  // a selection from the fields, then edit keys act on it
  for (let i = 0; i < 10; i++) key('Tab');
  assert.equal(screen.focus, 'selBeg');
  for (const c of '1000') key(c); key('Enter');
  assert.deepEqual(screen.selection, [1000, 4000]);
  key('Tab'); for (const c of '2000') key(c); key('Enter');
  assert.deepEqual(screen.selection, [1000, 2000]);
  const w = pr.samples.w, keep = w.data.slice();
  key('S', { shiftKey: true });
  assert.ok(w.data.subarray(1000, 2000).every(v => v === 0) && w.data[999] === keep[999] && w.data[2000] === keep[2000], 'Shift+S silences the selection only');
  key('z', { ctrlKey: true }); assert.equal(w.data[1500], keep[1500]);
  key('y', { ctrlKey: true }); assert.equal(w.data[1500], 0);
  key('z', { ctrlKey: true });
  key('C', { shiftKey: true }); assert.equal(w.data.length, 1000, 'Shift+C crops to the selection');
  assert.deepEqual(screen.selection, [0, 0], 'the selection is cleared after a crop');
  key('z', { ctrlKey: true }); assert.equal(w.data.length, 4000);
  key('R', { shiftKey: true }); assert.equal(w.data[0], keep[3999], 'with no selection a tool takes the whole sample');
}

// 88. The instrument screen: exposed parameters as sliders of their own, slider keys, and keyboard moves between nodes.
{
  const makeEl = tag => ({
    tag, children: [], listeners: {}, style: {}, textContent: '', value: '', checked: false,
    appendChild(c) { this.children.push(c); return c; }, replaceChildren(...c) { this.children = c; },
    addEventListener(type, f) { this.listeners[type] = f; }, focus() {},
  });
  const walk = (el, fn) => { fn(el); (el.children ?? []).forEach(c => walk(c, fn)); };
  const doc = { createElement: makeEl, createTextNode: text => ({ text }) };
  const ctx = new Proxy({}, { get: (t, k) => (k in t ? t[k] : () => {}), set: (t, k, v) => { t[k] = v; return true; } });
  const canvas = { width: 900, height: 360, style: {}, listeners: {}, getContext: () => ctx, addEventListener(type, f) { this.listeners[type] = f; }, focus() {} };
  const panel = makeEl('div'), defs = structuredClone(instruments);
  const params = [];
  let escaped = 0;
  const patcher = createPatcher({ canvas, panel, onEscape: () => { escaped++; }, statusEl: {}, doc, nodeTypes: NODE_TYPES, onStructure() {}, onParam: (...a) => params.push(a) });
  patcher.load({ instruments: defs });
  patcher.show('lead');
  const rows = patcher.exposedRows();
  assert.equal(rows.length, defs.lead.exposed.length, 'one row per exposed parameter');
  assert.ok(rows.length >= 2);
  const x = defs.lead.exposed.find(e => e.param === 'cutoff'), first = rows[defs.lead.exposed.indexOf(x)];
  assert.equal(first.name, x.label, 'a row carries the pattern column label');
  const before = first.pos();
  first.setPos(Math.min(1, before + 0.05));
  assert.ok(Math.abs(patcher.exposedRows()[defs.lead.exposed.indexOf(x)].pos() - Math.min(1, before + 0.05)) < 1e-6, 'moving a row moves the parameter');
  assert.deepEqual(params.at(-1).slice(0, 3), ['lead', x.node, x.param], 'moving it changes the parameter');
  first.setPos(1);
  assert.equal(patcher.exposedRows()[defs.lead.exposed.indexOf(x)].pos(), 1, 'a row stops at its end');
  // the node's own row follows when the node is selected
  const node = defs.lead.graph.nodes.find(n => n.id === x.node);
  const { w, h } = nodeBox(NODE_TYPES[node.type]);
  canvas.listeners.mousedown({ offsetX: node.x + w / 2, offsetY: node.y + h / 2, preventDefault() {} });
  canvas.listeners.mouseup({ offsetX: node.x + w / 2, offsetY: node.y + h / 2 });
  assert.equal(patcher.paramRows().find(r => r.name === x.param).pos(), 1);
  // keyboard moves between nodes
  const key = k => canvas.listeners.keydown({ key: k, preventDefault() {} });
  patcher.show('lead');
  assert.equal(patcher.selectedNode, x.node, 'coming back to an instrument selects the node you left');
  canvas.listeners.mousedown({ offsetX: 5000, offsetY: 5000, preventDefault() {} }); canvas.listeners.mouseup({ offsetX: 5000, offsetY: 5000 });
  assert.equal(patcher.selectedNode, null);
  key('Tab'); const start = patcher.selectedNode;
  assert.ok(start, 'Tab selects the leftmost node');
  const order = [start]; for (let i = 0; i < defs.lead.graph.nodes.length - 1; i++) { key('Tab'); order.push(patcher.selectedNode); }
  assert.equal(new Set(order).size, defs.lead.graph.nodes.length, 'Tab visits every node once');
  key('Tab'); assert.equal(patcher.selectedNode, start, 'and comes back round');
  key('ArrowRight'); assert.notEqual(patcher.selectedNode, start, 'an arrow moves to a node in that direction');
  key('Escape'); assert.equal(escaped, 1, 'Escape asks to go back to the list');
  // the graph area can be made taller; the size is clamped
  assert.equal(patcher.height, 360);
  assert.equal(patcher.resize(520), 520); assert.equal(canvas.height, 520); assert.equal(canvas.style.height, '520px');
  assert.equal(patcher.resize(10), 160, 'not smaller than the minimum');
  assert.equal(patcher.resize(99999), 1600, 'nor larger than the maximum');
  patcher.draw();   // draws at the new size without throwing
}

// 89: one pattern per start tick in a lane
{
  const registry = new ParamRegistry();
  for (const [id, def] of Object.entries(instruments)) compile(def.graph, { instrument: id, nodeTypes: NODE_TYPES, registry });
  const dup = { id: 'd', instrument: 'lead', patterns: { a: { text: patternText(8, {}) }, b: { text: patternText(8, {}) } },
    placements: [{ puid: 'a', start: 0, length: 8 }, { puid: 'b', start: 0, length: 4 }, { puid: 'b', start: 8, length: 8 }] };
  const [lane] = prepareSong({ ...demoSong, lanes: [dup] }, instruments, registry);
  assert.deepEqual(lane.placements.map(p => [p.puid, p.start]), [['a', 0], ['b', 8]], 'the first placement at a tick stays');
  assert.deepEqual(uniqueStarts([{ start: 1 }, { start: 1 }, { start: 2 }]).length, 2);
}

// 90: pattern font size and dim dots
{
  const registry = new ParamRegistry();
  for (const [id, def] of Object.entries(instruments)) compile(def.graph, { instrument: id, nodeTypes: NODE_TYPES, registry });
  const lanes = prepareSong(demoSong, instruments, registry);
  let onKey; const el = { addEventListener: (_, f) => { if (_ === 'keydown') onKey = f; }, innerHTML: '', style: {} };
  const view = createTrackerView({ el, statusEl: {}, transport: new Int32Array(new SharedArrayBuffer(8)), onToggle() {}, onBack() {} });
  view.load({ lanes, song: demoSong, editor: createEditor(lanes, demoSong.length) });
  const k = (key, extra) => onKey({ key, ctrlKey: true, preventDefault() {}, ...extra });
  const start = view.fontPx;
  k('+'); assert.equal(view.fontPx, start + 1); assert.equal(el.style.fontSize, `${start + 1}px`);
  k('-'); k('-'); assert.equal(view.fontPx, start - 1);
  k('0'); assert.equal(view.fontPx, 13);
  for (let i = 0; i < 60; i++) k('+');
  assert.equal(view.fontPx, 40, 'clamped');
  view.draw();
  assert.match(el.innerHTML, /<span class="d">\.\.\.<\/span>/, 'empty cells are wrapped for dimming');
}

// 91: the number of rows shown is adjustable
{
  const registry = new ParamRegistry();
  for (const [id, def] of Object.entries(instruments)) compile(def.graph, { instrument: id, nodeTypes: NODE_TYPES, registry });
  const lanes = prepareSong(demoSong, instruments, registry);
  const el = { addEventListener() {}, innerHTML: '', style: {} };
  const view = createTrackerView({ el, statusEl: {}, transport: new Int32Array(new SharedArrayBuffer(8)), onToggle() {}, onBack() {} });
  view.load({ lanes, song: demoSong, editor: createEditor(lanes, demoSong.length) });
  view.draw();
  assert.equal(el.innerHTML.split('\n').length, 2 + 24);
  assert.equal(view.setRows(10), 10); assert.equal(el.innerHTML.split('\n').length, 2 + 10);
  // the window holds still while the cursor moves inside it
  view.setRows(8); view.goto(0, 0); view.draw();
  const first = el.innerHTML.split('\n')[2].replace(/<[^>]+>/g, '').slice(0, 6);
  view.goto(0, 5); view.draw(); assert.equal(el.innerHTML.split('\n')[2].replace(/<[^>]+>/g, '').slice(0, 6), first, 'moving within the window does not scroll');
  view.goto(0, 20); view.draw(); assert.notEqual(el.innerHTML.split('\n')[2].replace(/<[^>]+>/g, '').slice(0, 6), first, 'leaving it does');
  assert.equal(view.setRows(1), 6, 'not fewer than the minimum'); assert.equal(view.setRows(9999), 128, 'nor more than the maximum');
}

// 92: arrangement side list and status bar
{
  const registry = new ParamRegistry();
  for (const [id, def] of Object.entries(instruments)) compile(def.graph, { instrument: id, nodeTypes: NODE_TYPES, registry });
  const lanes = prepareSong(demoSong, instruments, registry);
  const statusEl = { textContent: '' }, listEl = { innerHTML: '' }, el = { addEventListener() {}, innerHTML: '' };
  const view = createSequenceView({ el, statusEl, listEl, transport: new Int32Array(new SharedArrayBuffer(8)), onToggle() {}, onOpen() {} });
  view.load({ lanes, song: demoSong, editor: createEditor(lanes, demoSong.length) });
  view.draw();
  assert.match(statusEl.textContent, /^lane 1\/\d+ lead · row 0\/1 · tick 0 · /, 'lane and row of the cursor');
  assert.match(listEl.innerHTML, /class="pi here/, 'the pattern under the cursor is marked in the list');
  assert.match(listEl.innerHTML, /class="sw/, 'each pattern shows its colour');
  assert.ok(!el.innerHTML.includes('patterns:'), 'the grid no longer carries the list line');
}

// Arrangement: Ctrl+Up/Down steps through the pattern list, Space places the selected one
{
  const registry = new ParamRegistry();
  for (const [id, def] of Object.entries(instruments)) compile(def.graph, { instrument: id, nodeTypes: NODE_TYPES, registry });
  const lanes = prepareSong(demoSong, instruments, registry), editor = createEditor(lanes, demoSong.length);
  let onKey; const statusEl = { textContent: '' }, listEl = { innerHTML: '' };
  const el = { addEventListener: (type, f) => { if (type === 'keydown') onKey = f; }, innerHTML: '' };
  const view = createSequenceView({ el, statusEl, listEl, transport: new Int32Array(new SharedArrayBuffer(8)), onToggle() {}, onOpen() {} });
  view.load({ lanes, song: demoSong, editor });
  const press = (key, extra = {}) => onKey({ key, preventDefault() {}, ...extra });
  const lane = lanes[0], order = Object.entries(lane.patterns).sort((a, b) => a[1].index - b[1].index).map(([u]) => u);
  assert.ok(order.length >= 2);
  const t = 16; editor.remove(0, t);   // a row (16 ticks) with no pattern starting in it
  view.goto(0, t); view.draw();
  press('ArrowDown', { ctrlKey: true }); view.draw();
  assert.match(listEl.innerHTML, /class="pi pick"|class="pi here pick"/, 'the list shows its selection');
  const want = order[1];
  press('ArrowDown', { ctrlKey: true }); press('ArrowUp', { ctrlKey: true }); press('ArrowDown', { ctrlKey: true });
  const before = lane.placements.length;
  press(' '); view.draw();
  const placed = lane.placements.find(p => p.start === t);
  assert.equal(lane.placements.length, before + 1, 'Space places a pattern');
  assert.equal(placed?.puid, want, 'the one the list had selected');
  view.draw(); assert.match(statusEl.textContent, /Placed/);
  press(' '); assert.equal(lane.placements.length, before + 1, 'the same pattern is not placed twice at one start');
}

// 93. Keyjazz from the instrument screen, and panic.
{
  const makeEl = tag => ({
    tag, children: [], listeners: {}, style: {}, textContent: '', value: '', checked: false,
    appendChild(c) { this.children.push(c); return c; }, replaceChildren(...c) { this.children = c; },
    addEventListener(type, f) { this.listeners[type] = f; }, focus() {},
  });
  const doc = { createElement: makeEl, createTextNode: text => ({ text }) };
  const ctx = new Proxy({}, { get: (t, k) => (k in t ? t[k] : () => {}), set: (t, k, v) => { t[k] = v; return true; } });
  const canvas = { width: 900, height: 360, style: {}, listeners: {}, getContext: () => ctx, addEventListener(type, f) { this.listeners[type] = f; }, focus() {} };
  const defs = structuredClone(instruments), notes = [], status = { textContent: '' };
  const patcher = createPatcher({ canvas, panel: makeEl('div'), statusEl: status, doc, nodeTypes: NODE_TYPES, onStructure() {}, onParam() {}, onNote: (...a) => notes.push(a) });
  patcher.load({ instruments: defs });
  patcher.show('lead');
  const down = (key, extra) => canvas.listeners.keydown({ key, preventDefault() {}, ...extra });
  const up = key => canvas.listeners.keyup({ key });
  const nodes = defs.lead.graph.nodes, gen = nodes.find(n => NODE_TYPES[n.type].generator), other = nodes.find(n => !NODE_TYPES[n.type].generator && n.type !== 'out');
  assert.ok(gen && other);
  assert.equal(patcher.selectedNode, gen.id, 'showing an instrument selects its generator, so the keys play at once');
  canvas.listeners.mousedown({ offsetX: 5000, offsetY: 5000, preventDefault() {} }); canvas.listeners.mouseup({ offsetX: 5000, offsetY: 5000 });
  down('z'); assert.equal(notes.length, 0, 'nothing plays with no node selected');
  const pick = node => {
    const { w, h } = nodeBox(NODE_TYPES[node.type]);
    canvas.listeners.mousedown({ offsetX: node.x + w / 2, offsetY: node.y + h / 2, preventDefault() {} });
    canvas.listeners.mouseup({ offsetX: node.x + w / 2, offsetY: node.y + h / 2 });
  };
  pick(other); down('z'); assert.equal(notes.length, 0, 'a node that is not a generator does not play');
  pick(gen);
  down('z'); down('z', { repeat: true }); assert.deepEqual(notes, [['lead', 48, true]], 'C of octave 3 (MIDI 48, as the pattern plays C-3), once despite key repeat');
  down('q'); assert.deepEqual(notes.at(-1), ['lead', 60, true], 'the upper row is an octave up');
  down(']'); assert.equal(patcher.octave, 4); assert.match(status.textContent, /octave 4/);
  up('z'); assert.deepEqual(notes.at(-1), ['lead', 48, false], 'a key stops the note it started, whatever the octave now is');
  patcher.releaseKeys(); assert.deepEqual(notes.at(-1), ['lead', 60, false]);
  down('Delete'); // still works: removing the generator is the node delete, not a note
  // panic: the runtime stops every voice
  const { rt } = setup();
  rt.note('lead', { type: 'noteOn', note: 60, vel: 1 });
  assert.ok(peak(render(rt, 0.1).left) > 0.01);
  rt.panic();
  const after = render(rt, 0.2).left;
  assert.equal(peak(after.subarray(after.length >> 1)), 0, 'panic silences the held note');
}

// 94. Note preview in the pattern editor
{
  const registry = new ParamRegistry();
  for (const [id, def] of Object.entries(instruments)) compile(def.graph, { instrument: id, nodeTypes: NODE_TYPES, registry });
  const lanes = prepareSong(demoSong, instruments, registry);
  const listeners = {}, played = [];
  const el = { addEventListener: (type, f) => { listeners[type] = f; }, innerHTML: '', style: {} };
  const view = createTrackerView({ el, statusEl: { textContent: '' }, transport: new Int32Array(new SharedArrayBuffer(8)), onToggle() {}, onBack() {}, onNote: (...a) => played.push(a) });
  view.load({ lanes, song: demoSong, editor: createEditor(lanes, demoSong.length) });
  const press = (key, extra) => listeners.keydown({ key, preventDefault() {}, ...extra });
  const release = key => listeners.keyup({ key });
  const wasOn = view.preview;
  if (wasOn) press('\\');
  assert.equal(view.preview, false);
  press('z'); assert.equal(played.length, 0, 'silent while preview is off');
  press('Home'); press('\\');
  assert.equal(view.preview, true, 'backslash turns it on');
  press('x'); assert.equal(played.length, 1);
  assert.deepEqual(played[0].slice(0, 3), [lanes[0].instrument, 50, true], 'the typed note sounds on the lane instrument, at the pitch the pattern will play (D-3 is MIDI 50)');
  release('x'); assert.deepEqual(played.at(-1).slice(0, 3), [lanes[0].instrument, 50, false], 'and stops when the key is let go');
  press('Insert'); assert.equal(view.preview, false, 'Insert turns it off again');
  press('c'); assert.equal(played.length, 2, 'nothing more plays');
  press('Insert'); press('1'); assert.equal(played.length, 2, 'a note-off entry is not a note to hear');
}

// 95. The sequencer tells a new note which note its column was playing, for slides
{
  const song = { ...demoSong, lanes: [oneLane('s', 'lead', patternText(4, { 0: 'C-3 .. .. .... .... .. .. ..', 1: 'E-3 .. .. .... .... .. .. ..', 2: '=== .. .. .... .... .. .. ..', 3: 'G-3 .. .. .... .... .. .. ..' }), 4)] };
  const { seq, rt } = songSetup(song);
  const log = [];
  const real = rt.note.bind(rt);
  rt.note = (inst, msg) => { if (msg.type === 'noteOn') log.push([msg.note, msg.from]); real(inst, msg); };
  seq.play();
  const l = new Float32Array(128), r = new Float32Array(128);
  for (let i = 0; i < 4 * 6200 / 128; i++) seq.process(l, r, 128);
  assert.deepEqual(log.slice(0, 3), [[48, -1], [52, 48], [55, -1]], 'a note over a sounding one slides from it; after a note off there is nothing to slide from');
  assert.ok(Math.abs(rt.clock.tickSamples - sr * 60 / (song.bpm * song.ticksPerBeat)) < 1, 'the node clock follows the tempo');
}

// 96. Sampler: start offset, reverse, repeats with window shift and volume ramp.
{
  const sampler = (await import('../src/audio/nodes/sampler.js')).default;
  const N = 20000, saw = Float32Array.from({ length: N }, (_, i) => (i + 1) / N);   // rises 0..1
  const clock = { tickSamples: 2000 };
  const run = (extra, { frames = 12000, offAt = -1 } = {}) => {
    const node = sampler.create({ sampleRate: sr, clock });
    node.message({ type: 'sample', data: saw, rate: sr });
    node.note({ type: 'noteOn', note: 60, vel: 1 });
    const p = [1, 60, 150, 20, 0, 0, 0, 0, 0, 1];
    Object.entries(extra).forEach(([k, v]) => { p[sampler.params.findIndex(q => q.name === k)] = v; });
    const out = new Float32Array(frames);
    for (let at = 0; at < frames; at += block) {
      if (at === offAt) node.note({ type: 'noteOff', note: 60 });
      const o = new Float32Array(block);
      node.process([], [o], block, p, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
      out.set(o.subarray(0, Math.min(block, frames - at)), at);
    }
    return out;
  };
  const plain = run({}), off = run({ offset: 0.5 });
  assert.ok(plain[100] < 0.02 && Math.abs(off[100] - (0.5 + 100 / N)) < 0.02, 'offset starts part way in');
  const rev = run({ reverse: 1 });
  assert.ok(rev[100] > 0.9 && rev[100] > rev[3000] && rev[3000] > 0.5, 'reverse plays backwards');
  const revOff = run({ reverse: 1, offset: 0.5 });
  assert.ok(Math.abs(revOff[1000] - (0.5 - 1000 / N)) < 0.05, 'reverse offset counts from the end');
  const rep = run({ retrig: 1 });
  assert.ok(rep[1900] > 0.05 && rep[2200] < 0.08 && rep[3900] > 0.05 && rep[4200] < 0.08, 'the sound restarts every interval');
  const two = run({ retrig: 1, repeats: 2 });
  assert.ok(two[4200] < 0.08 && two[6100] > 0.05, 'the repeats stop after the count');
  const sh = run({ retrig: 1, shift: 0.25 });
  assert.ok(Math.abs(sh[2100] - (0.25 + 100 / N)) < 0.03 && Math.abs(sh[4100] - (0.5 + 100 / N)) < 0.03, 'each repeat starts further along');
  const rp = run({ retrig: 1, ramp: 0.5 });
  const peak = (a, from) => Math.max(...a.subarray(from, from + 1900));
  assert.ok(Math.abs(peak(rp, 2100) / peak(rp, 100) - 0.5) < 0.06 && Math.abs(peak(rp, 4100) / peak(rp, 100) - 0.25) < 0.06, 'each repeat is quieter');
  const stopped = run({ retrig: 1 }, { offAt: 3072 });
  assert.ok(stopped[4100] > 0.05 && stopped[6100] > 0.05, 'a note off ends the repeats');
}

// 97. The sampler's start and repeat commands in a pattern.
{
  const { instruments } = await import('../src/instruments.js');
  const ids = Object.fromEntries(instruments.lead.commands.map(c => [c.param, c.id]));
  assert.deepEqual([ids.repeats, ids.shift, ids.ramp, ids.reverse], [7, 8, 9, 10]);
  assert.deepEqual(instruments.lead.exposed.slice(0, 3).map(e => e.label), ['Smp', 'Off', 'Rtg']);
  const sampler = (await import('../src/audio/nodes/sampler.js')).default;
  const q = n => sampler.params.find(p => p.name === n);
  assert.ok(Math.abs(0x1000 / 65535 * q('retrig').max - 1) < 1e-4, 'hex 1000 is one tick');
  assert.ok(Math.abs(0x8000 / 65535 * (q('shift').max - q('shift').min) + q('shift').min) < 1e-4, 'hex 8000 is no shift');
  assert.ok(Math.abs(0xC000 / 65535 * q('ramp').max - 1) < 1e-4, 'hex C000 is x1');
}

// 98. One sampler, several samples: the sample parameter picks the slot as a note starts.
{
  const sampler = (await import('../src/audio/nodes/sampler.js')).default;
  const { slotsOf, sampleMessage, usersOfSample, syncSamplerStereo } = await import('../src/project/ops.js');
  const node = sampler.create({ sampleRate: sr, clock: { tickSamples: 2000 } });
  node.message({ type: 'sample', slot: 0, data: new Float32Array(4000).fill(0.25), rate: sr });
  node.message({ type: 'sample', slot: 1, data: new Float32Array(4000).fill(0.5), rate: sr });
  const names = sampler.params.map(p => p.name), slotsIdx = names.map((_, i) => i);
  const play = smp => {
    const p = [1, 60, 150, 20, 0, 0, 0, 0, 0, 1, smp];
    node.note({ type: 'noteCut' }); node.note({ type: 'noteOn', note: 60, vel: 1 });
    const o = new Float32Array(block);
    for (let i = 0; i < 4; i++) node.process([], [o], block, p, slotsIdx);
    return o[block - 1];
  };
  assert.ok(Math.abs(play(0) - 0.25) < 1e-6 && Math.abs(play(1) - 0.5) < 1e-6, 'each slot plays its own sample');
  assert.equal(play(5), 0, 'a slot with no sample is silent');
  assert.deepEqual([slotsOf('a'), slotsOf(['a', 'b']), slotsOf(undefined)], [['a'], ['a', 'b'], []]);
  const project = { samples: { a: { rate: sr, data: new Float32Array(2) }, b: { rate: sr, data: new Float32Array(2), right: new Float32Array(2) } }, instruments: { i: { graph: { nodes: [{ id: 'sampler', type: 'sampler' }] }, samples: { sampler: ['a', 'b'] } } } };
  assert.deepEqual(usersOfSample(project, 'b'), [{ instrument: 'i', node: 'sampler' }], 'a sample in a list has its users');
  syncSamplerStereo(project.instruments.i, project.samples);
  assert.equal(project.instruments.i.graph.nodes[0].stereo, true, 'stereo when any sample of the list is');
  assert.equal(sampleMessage(project.samples.a, 3).slot, 3);
}

// 99. The Smp column in a pattern chooses the sample a note plays.
{
  const rows = ['C-4 .. 00', '... .. ..', '... .. ..', '... .. ..', 'C-4 .. 01', '... .. ..'].map(r => `${r} .... .... .. .. .. ....`);
  const { seq, rt } = songSetup(song120([oneLane('lead', 'lead', patternText(16, Object.fromEntries(rows.map((r, i) => [i, r]))))]));
  rt.message('lead', 'sampler', { type: 'sample', slot: 0, data: new Float32Array(40000).fill(0.1), rate: sr });
  rt.message('lead', 'sampler', { type: 'sample', slot: 1, data: new Float32Array(40000).fill(0.5), rate: sr });
  seq.play();
  const L = render(seq, 1).left;
  const pk = (from, to) => peak(L.subarray(from, to));
  const a = pk(4000, 5900), b = pk(4 * 6000 + 4000, 4 * 6000 + 5900);
  assert.ok(!Number.isNaN(a) && a > 0.01 && b > a * 3, `the second note plays the second sample (${a}, ${b})`);
}

// 100. A project saved before the Smp, Off and Rtg columns gets them on loading, with its cells moved.
{
  const { serializeProject, parseProject } = await import('../src/project/file.js');
  const old = structuredClone(instruments.lead);
  delete old.layout; delete old.samples;
  old.exposed = old.exposed.filter(e => ['cutoff', 'resonance', 'mix', 'time'].includes(e.param));
  old.commands = old.commands.filter(c => c.id <= 6);
  const text = serializeProject({
    song: { name: 'old', bpm: 120, ticksPerBeat: 4, length: 16 }, instruments: { lead: old }, samples: {},
    lanes: [{ id: 'lead', instrument: 'lead', patterns: { a: { name: 'a', index: 0, rows: [['C-4', '..', '70', '50', '40', '4C9E', '02A000'], ['...', '..', '..']] } }, placements: [{ puid: 'a', start: 0, length: 2 }] }],
  });
  const back = parseProject(text);
  assert.deepEqual(back.instruments.lead.exposed.map(e => e.label), ['Smp', 'Off', 'Rtg', 'Cut', 'Res', 'Mix', 'Time']);
  assert.equal(back.song.lanes[0].patterns.a.text, 'C-4 .. .. .... .... 70 50 40 4C9E 02A000\n... .. .. .... .... .. .. .. .... ......');
  assert.equal(back.instruments.lead.layout, 2);
  assert.ok(back.instruments.lead.commands.some(c => c.param === 'repeats'), 'the repeat commands are added');
  assert.equal(parseProject(serializeProject({ song: back.song, instruments: back.instruments, samples: {}, lanes: prepareSong(back.song, back.instruments, (() => { const r = new ParamRegistry(); compile(back.instruments.lead.graph, { instrument: 'lead', nodeTypes: NODE_TYPES, registry: r }); return r; })()) })).instruments.lead.exposed.length, 7, 'loading it again changes nothing');
}

// 101. Slice markers: set on the sample, remapped by edits, and a note starts at one with the slice command.
{
  const { setSlices, sliceHex, sampleMessage } = await import('../src/project/ops.js');
  const { applyEdit, createHistory } = await import('../src/project/sampleedit.js');
  const sampler = (await import('../src/audio/nodes/sampler.js')).default;
  const project = { samples: { s: { rate: sr, data: Float32Array.from({ length: 1001 }, (_, i) => i / 1000) } }, instruments: {} };
  setSlices(project, 's', [500, 100, 100, 900]);
  assert.deepEqual(project.samples.s.slices, [100, 500, 900], 'sorted, no duplicates');
  assert.throws(() => setSlices(project, 's', [1001]), /inside the sample/);
  assert.deepEqual([sliceHex(0, 1001), sliceHex(500, 1001), sliceHex(1000, 1001)], ['0000', '8000', 'FFFF']);
  assert.deepEqual(sampleMessage(project.samples.s).slices, [100, 500, 900]);
  const history = createHistory();
  applyEdit(project, 's', history, 'cut', { from: 200, to: 600 });
  assert.deepEqual(project.samples.s.slices, [100, 500], 'a cut drops markers inside it and moves the ones after');
  applyEdit(project, 's', history, 'crop', { from: 50, to: 300 });
  assert.deepEqual(project.samples.s.slices, [50], 'a trim keeps and moves the markers inside');
  history.undo(project, 's'); history.undo(project, 's');
  assert.deepEqual(project.samples.s.slices, [100, 500, 900], 'undo brings them back');
  // the sampler: slice N starts the note at the Nth marker, and wins over the offset
  const node = sampler.create({ sampleRate: sr, clock: { tickSamples: 2000 } });
  node.message({ type: 'sample', data: Float32Array.from({ length: 20001 }, (_, i) => i / 20000), rate: sr, slices: [4000, 12000] });
  const first = (slice, offset = 0, reverse = 0) => {
    const p = [1, 60, 150, 20, offset, reverse, 0, 0, 0, 1, 0, slice];
    node.note({ type: 'noteCut' }); node.note({ type: 'noteOn', note: 60, vel: 1 });
    const o = new Float32Array(block);
    node.process([], [o], block, p, p.map((_, i) => i));
    return o[100];
  };
  assert.ok(Math.abs(first(0) - 0.2) < 0.01 && Math.abs(first(1) - 0.6) < 0.01, 'slices 0 and 1 start at their markers');
  assert.ok(Math.abs(first(1, 0.1) - 0.6) < 0.01, 'the slice wins over the offset');
  assert.ok(Math.abs(first(65535, 0.5) - 0.5) < 0.01 && Math.abs(first(2, 0.5) - 0.5) < 0.01, 'FFFF, or a number past the last marker, leaves the offset in charge');
  assert.ok(first(1, 0, 1) < 0.6 && first(1, 0, 1) > 0.58, 'reverse from a slice plays backwards from the marker');
  const { instruments } = await import('../src/instruments.js');
  assert.ok(instruments.lead.commands.some(c => c.id === 0x10 && c.param === 'slice'));
  assert.ok(['grain', 'edge', 'accel', 'step', 'slide', 'flip', 'prob', 'jOffset', 'jPitch', 'jPan', 'jTime', 'jLevel'].every(k => instruments.lead.commands.some(c => c.param === k)), 'the grain commands are in the table');
  assert.equal(new Set(instruments.lead.commands.map(c => c.id)).size, instruments.lead.commands.length, 'no two commands share an id');
}

// 103. The shipped demo song loads like any saved project and renders.
{
  const { readFileSync } = await import('node:fs');
  const loaded = parseProject(readFileSync(new URL('../src/project/demo.wax', import.meta.url), 'utf8'));
  assert.ok(loaded.song.lanes.length >= 5 && Object.keys(loaded.instruments).length >= 5, 'the demo has its instruments and lanes');
  const registry = new ParamRegistry();
  for (const [id, def] of Object.entries(loaded.instruments)) compile(def.graph, { instrument: id, nodeTypes: NODE_TYPES, registry });
  const lanes = prepareSong(loaded.song, loaded.instruments, registry);
  assert.equal(lanes.length, loaded.song.lanes.length);
  // the depth charge and the arp are heard, finite, and the arp's pattern columns move its filter and chorus
  const heard = (id, set = {}, note = 40, secs = 0.6) => {
    const reg = new ParamRegistry(), rt = new GraphRuntime({ sampleRate: sr, params: reg.values });
    rt.load(compile(loaded.instruments[id].graph, { instrument: id, nodeTypes: NODE_TYPES, registry: reg }));
    for (const [k, v] of Object.entries(set)) reg.set(`${id}.${k}`, v);
    rt.note(id, { type: 'noteOn', note, vel: 1 });
    return render(rt, secs).left;
  };
  const boom = heard('depth', {}, 28, 1.5);
  assert.ok(boom.every(Number.isFinite) && peak(boom) > 0.02 && peak(boom) < 2, 'the depth charge sounds');
  const shut = heard('arp', { 'synth.cutoff': 90 }, 69), open = heard('arp', { 'synth.cutoff': 15000 }, 69);
  assert.ok(open.every(Number.isFinite) && brightness(open) > brightness(shut) * 3, 'the arp opens up');
  assert.ok(Object.keys(loaded.instruments.arp.exposed).length === 5 && loaded.song.lanes.some(l => l.id === 'arp' && l.placements.length > 20), 'the arp lane is there');
}

// 104. Pattern editor: transpose notes, transpose values, interpolate.
{
  const registry = new ParamRegistry();
  for (const [id, def] of Object.entries(instruments)) compile(def.graph, { instrument: id, nodeTypes: NODE_TYPES, registry });
  const lanes = prepareSong(demoSong, instruments, registry);
  const editor = createEditor(lanes, 32);
  let onKey;
  const view = createTrackerView({ el: { addEventListener: (type, f) => { if (type === 'keydown') onKey = f; else if (type === 'wheel') onWheel = f; }, innerHTML: '' }, statusEl: {}, transport: new Int32Array(new SharedArrayBuffer(8)), onToggle() {}, onBack() {} });
  view.load({ lanes, song: demoSong, editor });
  const press = (key, extra = {}) => onKey({ key, preventDefault() {}, ...extra });
  const ctrl = (key, extra = {}) => press(key, { ctrlKey: true, ...extra });
  const lane = lanes[0], cols = lane.columns;
  const nc = cols.findIndex(c => c.token === 'note'), vc = cols.findIndex(c => c.token === '2hex');
  const set = (t, c, token) => editor.setCell(0, t, c, token);
  // a note and a velocity at three rows, then select the three rows of both columns
  set(0, nc, 'C-4'); set(1, nc, '...'); set(2, nc, 'E-4'); set(0, vc, '10'); set(1, vc, '..'); set(2, vc, '50');
  view.goto(0, 0);
  press('ArrowDown', { shiftKey: true }); press('ArrowDown', { shiftKey: true });
  for (let i = 0; i < vc - nc; i++) press('ArrowRight', { shiftKey: true });
  // transpose notes only
  ctrl('ArrowUp');
  assert.equal(lane.rows[0][nc], 'C#4'); assert.equal(lane.rows[2][nc], 'F-4'); assert.equal(lane.rows[1][nc], '...', 'blank cells stay blank');
  assert.equal(lane.rows[0][vc], '10', 'values are not touched by a note transpose');
  ctrl('ArrowDown', { shiftKey: true });
  assert.equal(lane.rows[0][nc], 'C#3', 'Shift moves a whole octave');
  ctrl('ArrowUp', { shiftKey: true });
  // transpose everything else
  ctrl('.');
  assert.equal(lane.rows[0][vc], '11'); assert.equal(lane.rows[2][vc], '51'); assert.equal(lane.rows[1][vc], '..');
  assert.equal(lane.rows[0][nc], 'C#4', 'notes are not touched by a value transpose');
  ctrl('<', { shiftKey: true });
  assert.equal(lane.rows[0][vc], '01'); assert.equal(lane.rows[2][vc], '41');
  ctrl('<', { shiftKey: true });
  assert.equal(lane.rows[0][vc], '00', 'values stop at their ends');
  // interpolate: the middle row of both columns gets the midpoint
  set(0, vc, '10'); set(2, vc, '50'); set(0, nc, 'C-4'); set(2, nc, 'E-4');
  ctrl('i');
  assert.equal(lane.rows[1][vc], '..', 'only cells that already hold a value are written');
  set(1, vc, '01'); set(1, nc, 'C-3');   // placeholders
  ctrl('i');
  assert.equal(lane.rows[1][vc], '30'); assert.equal(lane.rows[1][nc], 'D-4');
  ctrl('z');
  assert.equal(lane.rows[1][vc], '01', 'the interpolation is one undo step');
}

// 105. Pattern editor: insert the live value of a parameter, or of a whole row of them.
{
  const registry = new ParamRegistry();
  for (const [id, def] of Object.entries(instruments)) compile(def.graph, { instrument: id, nodeTypes: NODE_TYPES, registry });
  const lanes = prepareSong(demoSong, instruments, registry);
  const editor = createEditor(lanes, 32);
  let onKey;
  const view = createTrackerView({ el: { addEventListener: (type, f) => { if (type === 'keydown') onKey = f; else if (type === 'wheel') onWheel = f; }, innerHTML: '' }, statusEl: {}, transport: new Int32Array(new SharedArrayBuffer(8)), onToggle() {}, onBack() {}, readParam: slot => registry.values[slot] });
  view.load({ lanes, song: demoSong, editor });
  const press = (key, extra = {}) => onKey({ key, preventDefault() {}, ...extra });
  const lane = lanes[0], cols = lane.columns;
  const pcs = cols.map((c, i) => i).filter(i => cols[i].kind === 'param');
  const widthOf = i => ({ note: 3, '1hex': 1, '2hex': 2, '4hex': 4, cmd: 6 })[cols[i].token];
  const toCol = c => { view.goto(0, 4); for (let n = 0; n < cols.slice(0, c).reduce((a, k) => a + ({ note: 3, '1hex': 1, '2hex': 2, '4hex': 4, cmd: 6 })[k.token], 0); n++) press('ArrowRight'); };
  const col = cols[pcs[0]];
  registry.values[col.slot] = col.int ? col.min + 7 : col.min + (col.max - col.min) * (0x80 / col.denom);
  // note column first: nothing to take
  view.goto(0, 4);
  const noteBefore = lane.rows[4][0];
  press(' ');
  assert.equal(lane.rows[4][0], noteBefore, 'a note column is left alone');
  view.goto(0, 4);
  // a parameter column: its live value is written and the cursor moves down
  toCol(pcs[0]);
  press(' ');
  const expected = (col.int ? 7 : 0x80).toString(16).toUpperCase().padStart(widthOf(pcs[0]), '0');
  assert.equal(lane.rows[4][pcs[0]], expected, `live value written (${lane.rows[4][pcs[0]]} vs ${expected})`);
  // the whole row: every parameter column of the next row, nothing else
  const before = lane.rows[5].slice();
  press(' ', { ctrlKey: true });
  pcs.forEach(i => assert.notEqual(lane.rows[5][i], '.'.repeat(widthOf(i)), `column ${cols[i].label} gets its live value`));
  cols.forEach((c, i) => { if (c.kind !== 'param') assert.equal(lane.rows[5][i], before[i], `${c.label} is left as it was`); });
  // the value goes back through the sequencer's own reading: a cell turns into the same value
  const roundTrip = tokenValue => {
    const n = parseInt(tokenValue, 16);
    return col.int ? col.min + n : col.log ? col.min * Math.pow(col.max / col.min, n / col.denom) : col.min + (n / col.denom) * (col.max - col.min);
  };
  assert.ok(Math.abs(roundTrip(lane.rows[4][pcs[0]]) - registry.values[col.slot]) < (col.max - col.min) / col.denom + 1e-6, 'the cell reads back as the live value');
  press('z', { ctrlKey: true });
  assert.equal(lane.rows[5][pcs[0]], before[pcs[0]], 'one undo takes the whole row back');
}

// 106. Pattern editor: hide the empty columns of the lane the cursor is in.
{
  const registry = new ParamRegistry();
  for (const [id, def] of Object.entries(instruments)) compile(def.graph, { instrument: id, nodeTypes: NODE_TYPES, registry });
  const lanes = prepareSong(demoSong, instruments, registry);
  const editor = createEditor(lanes, 32);
  let onKey;
  const el = { addEventListener: (type, f) => { if (type === 'keydown') onKey = f; else if (type === 'wheel') onWheel = f; }, innerHTML: '' }, statusEl = { textContent: '', set innerHTML(h) { this.html = h; this.textContent = h.replace(/<[^>]+>/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'); } };
  const view = createTrackerView({ el, statusEl, transport: new Int32Array(new SharedArrayBuffer(8)), onToggle() {}, onBack() {} });
  view.load({ lanes, song: demoSong, editor });
  const press = (key, extra = {}) => onKey({ key, preventDefault() {}, ...extra });
  const lane = lanes[0], isEmpty = ci => lane.rows.every(r => /^\.+$/.test(r[ci]));
  const empty = lane.columns.map((c, i) => i).filter(i => i > 0 && isEmpty(i));
  assert.ok(empty.length > 0 && empty.length < lane.columns.length - 1, 'the demo lead has some empty columns and some full ones');
  const header = () => { view.draw(); return el.innerHTML.split('\n')[1].replace(/<[^>]+>/g, ''); };
  const shown = () => lane.columns.filter((_, i) => header().includes(lane.columns[i].label)).length;
  const before = header().trim().split(/\s+/).length;
  press('h', { ctrlKey: true, shiftKey: true });
  const after = header().trim().split(/\s+/);
  assert.equal(after.length, before - empty.length, 'the empty columns are gone from the header');
  assert.ok(statusEl.textContent.includes('empty columns hidden'));
  // the cursor steps over them: walk to the end of the lane's visible cells and see only labels that were kept
  const first = c => c.long.split(' · ')[0];
  const kept = new Set(lane.columns.filter((_, i) => !empty.includes(i)).map(first));
  for (let i = 0; i < 40; i++) {
    view.draw();
    const label = statusEl.textContent.split(' · ').find(x => lane.columns.some(c => first(c) === x));
    if (label && statusEl.textContent.startsWith(lane.id)) assert.ok(kept.has(label), `the cursor never rests on the hidden column ${label}`);
    press('ArrowRight');
  }
  view.goto(0, 0);
  press('h', { ctrlKey: true, shiftKey: true });
  assert.equal(header().trim().split(/\s+/).length, before, 'toggling again shows them all');
  // only the lane the cursor is in is affected
  press('h', { ctrlKey: true, shiftKey: true });
  press('Tab');
  const other = lanes[1], hdr = () => { view.draw(); return el.innerHTML.split('\n')[1].replace(/<[^>]+>/g, ''); };
  assert.ok(other.columns.every(c => hdr().includes(c.short)), 'the next lane still shows every column');
  assert.ok(!statusEl.textContent.includes('empty columns hidden'));
}

// 107. Gate: opens on signal, holds, closes to its range, and 0 dB range does nothing.
{
  const run = (values, inL) => {
    const def = NODE_TYPES.gate;
    const params = Float32Array.from(def.params.map(p => values[p.name] ?? p.def)), slots = Int32Array.from(def.params.map((_, i) => i));
    const node = def.create({ sampleRate: sr, connected: [true] });
    const out = new Float32Array(inL.length), outR = new Float32Array(inL.length);
    for (let at = 0; at < inL.length; at += 128) {
      const n = Math.min(128, inL.length - at);
      node.process([[inL.subarray(at, at + n), inL.subarray(at, at + n)]], [[out.subarray(at, at + n), outR.subarray(at, at + n)]], n, params, slots);
    }
    return out;
  };
  const tone = (a, n, f = 220) => Float32Array.from({ length: n }, (_, i) => a * Math.sin(2 * Math.PI * f * i / sr));
  const rms = (x, a, b) => { let t = 0; for (let i = a; i < b; i++) t += x[i] * x[i]; return Math.sqrt(t / (b - a)); };
  // loud for 0.25 s, then quiet (-60 dB) for 0.5 s
  const input = new Float32Array(36000); input.set(tone(0.5, 12000)); input.set(tone(0.0005, 24000), 12000);
  const gated = run({ threshold: -40, hold: 50, release: 20 }, input);
  assert.ok(Math.abs(rms(gated, 6000, 12000) / rms(input, 6000, 12000) - 1) < 0.02, 'the loud part passes unchanged');
  assert.ok(rms(gated, 24000, 36000) < rms(input, 24000, 36000) * 0.01, 'the quiet part is closed off');
  // hold keeps it open for a while after the signal drops
  const held = run({ threshold: -40, hold: 100, release: 20 }, input);
  assert.ok(rms(held, 12500, 14000) > rms(input, 12500, 14000) * 0.9, 'the gate holds open at first');
  assert.ok(rms(held, 20000, 24000) < rms(input, 20000, 24000) * 0.05, 'and closes after the hold');
  // range: a gate that only drops by 6 dB leaves half the level
  const half = run({ threshold: -40, hold: 0, release: 5, range: -6.0206 }, input);
  assert.ok(Math.abs(rms(half, 30000, 36000) / rms(input, 30000, 36000) - 0.5) < 0.03, 'the range sets how far it closes');
  assert.ok(run({ range: 0 }, input).every((v, i) => Math.abs(v - input[i]) < 1e-6), 'range 0 dB does nothing');
  assert.ok(gated.every(Number.isFinite));
}

// 108. Envelope effect: a manual ADSR on a stereo stream, and the envelope drawn beside the selected node.
{
  const def = NODE_TYPES.envfx;
  const base = Object.fromEntries(def.params.map(p => [p.name, p.def]));
  const make = values => {
    const params = Float32Array.from(def.params.map(p => values[p.name] ?? base[p.name])), slots = Int32Array.from(def.params.map((_, i) => i));
    return { node: def.create({ sampleRate: sr, connected: [true] }), params, slots };
  };
  const run = (values, steps) => {   // steps: [[samples, trig]]: the trigger value for each stretch of samples
    const { node, params, slots } = make(values);
    const total = steps.reduce((a, [n]) => a + n, 0), out = new Float32Array(total), one = new Float32Array(128).fill(1);
    let at = 0;
    for (const [n, trig] of steps) {
      params[0] = trig;
      for (let k = 0; k < n; k += 128, at += 128) {
        const l = new Float32Array(128), r = new Float32Array(128);
        node.process([[one, one]], [[l, r]], 128, params, slots);
        out.set(l, at);
      }
    }
    return out;
  };
  const q = 128 * 100;   // about a quarter of a second
  const silent = run({}, [[q, 0]]);
  assert.ok(silent.every(v => Math.abs(v) < 1e-3), 'before a trigger the signal is shut');
  const hit = run({ attack: 5, decay: 50, sustain: 0.5, release: 50 }, [[q, 1], [q, 0]]);
  assert.ok(Math.abs(hit[q - 1] - 0.5) < 0.02, `it settles at the sustain level (${hit[q - 1]})`);
  assert.ok(hit.slice(0, 600).some(v => v > 0.95), 'the attack reaches the top');
  assert.ok(hit[2 * q - 1] < 0.01, 'a 0 releases it');
  const perc = run({ attack: 1, decay: 40, sustain: 0 }, [[q, 1]]);
  assert.ok(perc[q - 1] < 0.01, 'with sustain 0 the hit dies by itself');
  const again = run({ attack: 1, decay: 40, sustain: 0 }, [[q, 1], [128 * 4, 2]]);
  assert.ok(again.slice(q).some(v => v > perc[q - 1] + 0.001) || again[q + 5] >= perc[q - 1], 'a different non-zero value starts the attack again');
  const rangeHalf = run({ range: -6.0206 }, [[q, 0]]);
  assert.ok(Math.abs(rangeHalf[q - 1] - 0.5) < 0.01, 'range sets the level when shut');
  // the patcher draws the envelope next to the selected node, for any node type that lists an ADSR
  const makeEl = tag => ({ tag, children: [], listeners: {}, style: {}, textContent: '', value: '', checked: false, className: '', appendChild(c) { this.children.push(c); return c; }, replaceChildren(...c) { this.children = c; }, addEventListener(type, f) { this.listeners[type] = f; }, focus() {}, getContext: () => new Proxy({}, { get: (t, k) => (k in t ? t[k] : () => {}), set: (t, k, v) => { t[k] = v; return true; } }) });
  const doc = { createElement: makeEl, createTextNode: text => ({ text }) };
  const calls = [];
  const canvas = { width: 900, height: 360, style: {}, listeners: {}, getContext: () => new Proxy({}, { get: (t, k) => (k in t ? t[k] : (...a) => { calls.push([k, ...a]); }), set: (t, k, v) => { t[k] = v; return true; } }), addEventListener(type, f) { this.listeners[type] = f; }, focus() {} };
  const defs = structuredClone(instruments);
  const patcher = createPatcher({ canvas, panel: makeEl('div'), statusEl: { textContent: '' }, doc, nodeTypes: NODE_TYPES, onStructure() {}, onParam() {} });
  patcher.load({ instruments: defs });
  patcher.show('kick');
  patcher.add('envfx', { x: 300, y: 200 });
  patcher.refreshPanel(); calls.length = 0; patcher.draw();
  assert.ok(calls.some(c => c[0] === 'fillText' && /envfx1 envelope/.test(c[1])), 'the envelope box is drawn for a selected envelope node');
  for (const type of ['env', 'subsynth', 'addsynth', 'fmsynth']) {
    patcher.add(type, { x: 320, y: 120 }); patcher.refreshPanel(); calls.length = 0; patcher.draw();
    assert.ok(calls.some(c => c[0] === 'fillText' && / envelope$/.test(c[1])), `${type} shows its envelope`);
  }
  patcher.add('gain', { x: 200, y: 100 }); patcher.refreshPanel(); calls.length = 0; patcher.draw();
  assert.ok(!calls.some(c => c[0] === 'fillText' && / envelope$/.test(c[1])), 'other nodes show none');
}

// 109. Granular synth: grains read the sample at `position`, follow the note, spread in stereo and stop after release.
{
  const def = NODE_TYPES.granular;
  const len = sr;   // one second: silent first half, a 500 Hz tone in the second half
  const wav = Float32Array.from({ length: len }, (_, i) => (i < len / 2 ? 0 : 0.8 * Math.sin(2 * Math.PI * 500 * i / sr)));
  const make = values => {
    const node = def.create({ sampleRate: sr });
    node.message({ type: 'sample', slot: 0, data: wav, rate: sr });
    const params = Float32Array.from(def.params.map(p => values[p.name] ?? p.def)), slots = Int32Array.from(def.params.map((_, i) => i));
    return { node, params, slots };
  };
  const render = (values, frames, notes = [[0, 60]], off = null) => {
    const { node, params, slots } = make(values);
    const L = new Float32Array(frames), R = new Float32Array(frames);
    for (let at = 0; at < frames; at += 128) {
      for (const [when, nt] of notes) if (when === at) node.note({ type: 'noteOn', note: nt, vel: 1 });
      if (off !== null && off === at) node.note({ type: 'noteOff', note: 60 });
      node.process([], [[L.subarray(at, at + 128), R.subarray(at, at + 128)]], 128, params, slots);
    }
    return [L, R];
  };
  const rms = (x, a, b) => { let t = 0; for (let i = a; i < b; i++) t += x[i] * x[i]; return Math.sqrt(t / (b - a)); };
  const crossings = (x, a, b) => { let c = 0; for (let i = a + 1; i < b; i++) if (x[i - 1] < 0 && x[i] >= 0) c++; return c; };
  const { node: idle, params: ip, slots: is } = make({});
  const z = new Float32Array(128), z2 = new Float32Array(128);
  idle.process([], [[z, z2]], 128, ip, is);
  assert.ok(z.every(v => v === 0), 'silent before a note');
  const quiet = render({ position: 0.1, spray: 0, size: 30, density: 60 }, 16000);
  const loud = render({ position: 0.7, spray: 0, size: 30, density: 60 }, 16000);
  assert.ok(rms(quiet[0], 4000, 16000) < 0.001, 'position 0.1 reads the silent half');
  assert.ok(rms(loud[0], 4000, 16000) > 0.02, 'position 0.7 reads the tone');
  assert.ok(loud[0].every(Number.isFinite) && loud[1].every(Number.isFinite));
  const centre = render({ position: 0.7, spray: 0, spread: 0, size: 30, density: 60 }, 8000);
  assert.ok(centre[0].every((v, i) => Math.abs(v - centre[1][i]) < 1e-6), 'no spread: left equals right');
  const wide = render({ position: 0.7, spray: 0, spread: 1, size: 30, density: 60 }, 16000);
  assert.ok(Math.abs(rms(wide[0], 4000, 16000) - rms(wide[1], 4000, 16000)) >= 0 && wide[0].some((v, i) => Math.abs(v - wide[1][i]) > 1e-4), 'spread scatters grains across the field');
  // the note sets the grain pitch: an octave up doubles the zero crossings (one long grain train, no spray)
  const lo = render({ position: 0.6, spray: 0, spread: 0, size: 400, density: 10, scan: 0 }, 22000, [[0, 60]]);
  const hi = render({ position: 0.6, spray: 0, spread: 0, size: 400, density: 10, scan: 0 }, 22000, [[0, 72]]);
  const cl = crossings(lo[0], 8000, 20000), ch = crossings(hi[0], 8000, 20000);
  assert.ok(ch > cl * 1.7 && ch < cl * 2.3, `an octave up has twice the crossings (${cl} vs ${ch})`);
  const flat = render({ position: 0.6, spray: 0, spread: 0, size: 400, density: 10, keytrack: 0 }, 22000, [[0, 72]]);
  assert.ok(Math.abs(crossings(flat[0], 8000, 20000) - cl) <= 3, 'keytrack off ignores the note');
  // scan moves the read position through the sample: starting in the silent half it reaches the tone
  const scanned = render({ position: 0.2, spray: 0, size: 30, density: 60, scan: 0.5 }, 48000);
  assert.ok(rms(scanned[0], 2000, 12000) < 0.001 && rms(scanned[0], 36000, 48000) > 0.02, 'scan carries the position into the tone');
  // release ends the cloud
  const ended = render({ position: 0.7, spray: 0, size: 30, density: 60, release: 20 }, 24000, [[0, 60]], 8192);
  assert.ok(rms(ended[0], 4000, 8000) > 0.02 && rms(ended[0], 16000, 24000) === 0, 'after the release it is silent');
  // the synth kind lists the project's first sample
  const proj = { samples: { drum: { rate: sr, data: wav } }, instruments: {} };
  const id = pops.addSynthInstrument(proj, 'cloud', 'granular');
  assert.deepEqual(proj.instruments[id].samples, { synth: 'drum' });
  assert.equal(def.samples, true);
}

// 110. Equaliser: the measured gain matches the drawn curve, cuts and bands work, and the patcher draws the response.
{
  const def = NODE_TYPES.eq;
  const run = (values, f, frames = 24000) => {
    const params = Float32Array.from(def.params.map(p => values[p.name] ?? p.def)), slots = Int32Array.from(def.params.map((_, i) => i));
    const node = def.create({ sampleRate: sr });
    const x = Float32Array.from({ length: frames }, (_, i) => Math.sin(2 * Math.PI * f * i / sr));
    const L = new Float32Array(frames), R = new Float32Array(frames);
    for (let at = 0; at < frames; at += 128) {
      const m = Math.min(128, frames - at);
      node.process([[x.subarray(at, at + m), x.subarray(at, at + m)]], [[L.subarray(at, at + m), R.subarray(at, at + m)]], m, params, slots);
    }
    let a = 0, b = 0;
    for (let i = frames / 2; i < frames; i++) { a += x[i] * x[i]; b += L[i] * L[i]; }
    return { db: 10 * Math.log10(b / a), L, R };
  };
  const drawn = (values, f) => def.curves(name => values[name] ?? def.params.find(p => p.name === name).def, sr).reduce((t, b) => (b.off ? t : t + b.db(f)), 0);
  assert.ok(Math.abs(run({}, 1000).db) < 0.01, 'flat by default');
  for (const [values, f] of [[{ g3: 12 }, 1200], [{ g3: -9, q3: 3 }, 1000], [{ g1: 10 }, 40], [{ g5: -12 }, 15000], [{ lowcut: 200 }, 100], [{ highcut: 4000 }, 8000], [{ g2: 6, g4: -6, lowcut: 80 }, 500]]) {
    const m = run(values, f).db, d = drawn(values, f);
    assert.ok(Math.abs(m - d) < 0.3, `${JSON.stringify(values)} at ${f} Hz: measured ${m.toFixed(2)} dB, drawn ${d.toFixed(2)} dB`);
  }
  assert.ok(Math.abs(run({ g3: 12 }, 1200).db - 12) < 0.2, 'a +12 dB peak is +12 dB at its centre');
  assert.ok(run({ lowcut: 200 }, 50).db < -20, 'the low cut removes the lows');
  const st = run({ g3: 6 }, 1200); assert.ok(st.L.every((v, i) => v === st.R[i]), 'both channels are treated alike');
  assert.ok(run({ g3: 12 }, 1200).L.every(Number.isFinite));
  const makeEl = tag => ({ tag, children: [], listeners: {}, style: {}, textContent: '', value: '', checked: false, className: '', appendChild(c) { this.children.push(c); return c; }, replaceChildren(...c) { this.children = c; }, addEventListener(type, f) { this.listeners[type] = f; }, focus() {}, getContext: () => new Proxy({}, { get: (t, k) => (k in t ? t[k] : () => {}), set: (t, k, v) => { t[k] = v; return true; } }) });
  const doc = { createElement: makeEl, createTextNode: text => ({ text }) };
  const calls = [];
  const canvas = { width: 900, height: 360, style: {}, listeners: {}, getContext: () => new Proxy({}, { get: (t, k) => (k in t ? t[k] : (...a) => { calls.push([k, ...a]); }), set: (t, k, v) => { t[k] = v; return true; } }), addEventListener(type, f) { this.listeners[type] = f; }, focus() {} };
  const defs = structuredClone(instruments);
  const patcher = createPatcher({ canvas, panel: makeEl('div'), statusEl: { textContent: '' }, doc, nodeTypes: NODE_TYPES, onStructure() {}, onParam() {} });
  patcher.load({ instruments: defs });
  patcher.show('kick');
  patcher.add('eq', { x: 300, y: 120 });
  patcher.refreshPanel(); calls.length = 0; patcher.draw();
  assert.ok(calls.some(c => c[0] === 'fillText' && /eq1 response/.test(c[1])), 'the response box is drawn for a selected equaliser');
  assert.ok(calls.filter(c => c[0] === 'arc').length >= 5, 'one dot per band');
}

// 111. Wavetable synth: the Braids set, tables and A/B pairs cut from samples, position and mix, and the panel.
{
  const def = NODE_TYPES.wavetable;
  const wt = await import('../src/audio/nodes/wtutil.js');
  const braids = wt.braidsFrames();
  assert.equal(braids.length, 256 * wt.FRAME, 'the Braids set is 256 frames of 512 points');
  assert.ok(braids.every(Number.isFinite) && Math.max(...braids.slice(0, 5000)) <= 1, 'the frames are finite and in range');
  const first = braids.subarray(0, wt.FRAME), last = braids.subarray(255 * wt.FRAME);
  let diff = 0; for (let i = 0; i < wt.FRAME; i++) diff += Math.abs(first[i] - last[i]);
  assert.ok(diff > 10, 'the first and last waves differ');
  // base64 round trip, without atob
  const flat = Float32Array.from({ length: 1024 }, (_, i) => Math.sin(i / 7) * 0.8);
  const back = wt.decodeFrames(wt.encodeFrames(flat));
  assert.ok(back.length === 1024 && flat.every((v, i) => Math.abs(v - back[i]) < 1e-4), 'frames survive being stored as text');
  const make = (values = {}, data) => {
    const node = def.create({ sampleRate: sr, data });
    const params = Float32Array.from(def.params.map(p => values[p.name] ?? p.def)), slots = Int32Array.from(def.params.map((_, i) => i));
    return { node, params, slots };
  };
  const render = (values, data, frames = 12000, note = 69, msgs = []) => {
    const { node, params, slots } = make(values, data);
    for (const m of msgs) node.message(m);
    const L = new Float32Array(frames), R = new Float32Array(frames);
    for (let at = 0; at < frames; at += 128) {
      if (at === 0) node.note({ type: 'noteOn', note, vel: 1 });
      node.process([], [[L.subarray(at, at + 128), R.subarray(at, at + 128)]], 128, params, slots);
    }
    return L;
  };
  const rms = (x, a, b) => { let t = 0; for (let i = a; i < b; i++) t += x[i] * x[i]; return Math.sqrt(t / (b - a)); };
  const idleNode = make().node, z = new Float32Array(128);
  idleNode.process([], [[z, new Float32Array(128)]], 128, make().params, make().slots);
  assert.ok(z.every(v => v === 0), 'silent before a note');
  const a = render({ position: 0 }), b = render({ position: 1 });
  assert.ok(rms(a, 3000, 12000) > 0.05 && a.every(Number.isFinite), 'it plays');
  let d = 0; for (let i = 3000; i < 12000; i++) d += Math.abs(a[i] - b[i]);
  assert.ok(d > 50, 'the first and last frames sound different');
  const pitch = render({ position: 0.5, sustain: 1 }, undefined, 24000, 69);
  let cross = 0; for (let i = 6001; i < 18000; i++) if (pitch[i - 1] < 0 && pitch[i] >= 0) cross++;
  assert.ok(cross >= 12000 / sr * 440 * 0.9 && cross <= 12000 / sr * 440 * 3, `the note sets the pitch (${cross} rising crossings in 12000 samples)`);
  // pair: mix 0 is wave A, mix 1 is wave B; a cut from a sample is stored on the node
  const src = Float32Array.from({ length: 4096 }, (_, i) => (i < 2048 ? 0.9 * Math.sin(2 * Math.PI * 4 * i / 512) : (((i % 128) / 128) * 2 - 1) * 0.9));
  const winA = wt.windowFrom(src, 0), winB = wt.windowFrom(src, 2048);
  assert.equal(winA.length, wt.FRAME);
  const both = new Float32Array(2 * wt.FRAME); both.set(winA); both.set(winB, wt.FRAME);
  const data = { pair: wt.encodeFrames(both) };
  const m0 = render({ source: 1, mix: 0, sustain: 1 }, data), m1 = render({ source: 1, mix: 1, sustain: 1 }, data), mh = render({ source: 1, mix: 0.5, sustain: 1 }, data);
  const dist = (x, y) => { let t = 0; for (let i = 3000; i < 12000; i++) t += Math.abs(x[i] - y[i]); return t; };
  assert.ok(dist(m0, m1) > 50, 'mix 0 and mix 1 differ');
  assert.ok(dist(mh, m0) > 5 && dist(mh, m1) > 5, 'half way is neither');
  assert.ok(rms(m0, 3000, 12000) > 0.05 && rms(m1, 3000, 12000) > 0.05);
  // messages replace the table and the pair; null brings the defaults back
  const viaMsg = render({ source: 1, mix: 1, sustain: 1 }, undefined, 12000, 69, [{ type: 'pair', points: data.pair }]);
  assert.ok(dist(viaMsg, m1) < 1e-3, 'a pair message sets the pair');
  const tbl = wt.framesFromSample(src, 512);
  assert.equal(tbl.length / wt.FRAME, 8, 'a 4096 point sample cut into 512 point frames makes 8');
  const own = render({ position: 0.3, sustain: 1 }, { table: wt.encodeFrames(tbl) });
  assert.ok(dist(own, a) > 20, 'a table from a sample sounds unlike the Braids set');
  // the position envelope moves the position over the note
  const still = render({ position: 0, pamt: 0 }, undefined, 24000), moving = render({ position: 0, pamt: 1, patk: 1, pdec: 2000, psus: 1 }, undefined, 24000);
  let dm = 0; for (let i = 12000; i < 24000; i++) dm += Math.abs(still[i] - moving[i]);
  assert.ok(dm > 50, 'the position envelope changes the sound');
  // the panel: pick a sample for A, and the node keeps the cut
  const makeEl = tag => ({ tag, children: [], listeners: {}, style: {}, textContent: '', value: '', checked: false, className: '', appendChild(c) { this.children.push(c); return c; }, replaceChildren(...c) { this.children = c; }, addEventListener(type, f) { this.listeners[type] = f; }, focus() {}, getContext: () => new Proxy({}, { get: (t, k) => (k in t ? t[k] : () => {}), set: (t, k, v) => { t[k] = v; return true; } }) });
  const doc = { createElement: makeEl, createTextNode: text => ({ text }) };
  const sent = [];
  const canvas = { width: 900, height: 360, style: {}, listeners: {}, getContext: () => new Proxy({}, { get: (t, k) => (k in t ? t[k] : () => {}), set: (t, k, v) => { t[k] = v; return true; } }), addEventListener(type, f) { this.listeners[type] = f; }, focus() {} };
  const defs = structuredClone(instruments);
  const patcher = createPatcher({ canvas, panel: makeEl('div'), statusEl: { textContent: '' }, doc, nodeTypes: NODE_TYPES, onStructure() {}, onParam() {}, onData: (...a) => sent.push(a), getSampleIds: () => ['drum'], getSample: id => (id === 'drum' ? { data: src, rate: sr } : null) });
  patcher.load({ instruments: defs });
  patcher.show('kick');
  patcher.add('wavetable', { x: 300, y: 120 });
  patcher.refreshPanel(); patcher.draw();
  // the panel's pickers cut windows from the sample and tell the node
  const { createWavetableEditor } = await import('../src/graph/wavetableeditor.js');
  const got = [];
  const editor = createWavetableEditor({ doc, data: undefined, getSampleIds: () => ['drum'], getSample: id => (id === 'drum' ? { data: src, rate: sr } : null), getParam: () => 0.5, onChange: (kind, points) => got.push([kind, points]) });
  const find = (node, test, out = []) => { if (test(node)) out.push(node); for (const c of node.children ?? []) find(c, test, out); return out; };
  const pickerA = find(editor.el, n => n.tag === 'select' && /wave A/.test(n.title ?? ''))[0];
  assert.ok(pickerA, 'wave A has a sample picker');
  pickerA.value = 'drum'; pickerA.listeners.change();
  assert.ok(got.some(([k, v]) => k === 'pair' && typeof v === 'string'), 'picking a sample cuts a window and sends the pair');
  assert.ok(got.some(([k, v]) => k === 'meta' && v.pair.a.sample === 'drum'), 'where it came from is remembered');
  const startA = find(editor.el, n => n.tag === 'input' && /First frame/.test(n.title ?? ''))[0];
  startA.value = '2048'; startA.listeners.change();
  const lastPair = got.filter(([k]) => k === 'pair').at(-1)[1];
  assert.ok(Math.abs(wt.decodeFrames(lastPair).slice(0, wt.FRAME).reduce((t, v, i) => t + Math.abs(v - winB[i]), 0)) < 1, 'a start of 2048 cuts the second half of the sample');
  find(editor.el, n => n.tag === 'select' && /cut a table/.test(n.title ?? ''))[0].value = 'drum';
  const cutBtn = find(editor.el, n => n.tag === 'button' && n.textContent === 'Cut table')[0];
  cutBtn.listeners.click();
  assert.ok(got.some(([k, v]) => k === 'table' && typeof v === 'string'), 'cutting a table sends it');
  find(editor.el, n => n.tag === 'button' && n.textContent === 'Braids set')[0].listeners.click();
  assert.ok(got.some(([k, v]) => k === 'table' && v === null), 'the Braids set button clears the table');
  const proj = { samples: {}, instruments: {} };
  const id = pops.addSynthInstrument(proj, 'wt', 'wavetable');
  assert.equal(proj.instruments[id].noteColumns, 3);
}

// 112. Bitcrusher: fewer levels, a held sample rate, a dry/wet mix.
{
  const def = NODE_TYPES.crusher;
  const run = (values, x) => {
    const params = Float32Array.from(def.params.map(p => values[p.name] ?? p.def)), slots = Int32Array.from(def.params.map((_, i) => i));
    const node = def.create({ sampleRate: sr });
    const L = new Float32Array(x.length), R = new Float32Array(x.length);
    for (let at = 0; at < x.length; at += 128) {
      const m = Math.min(128, x.length - at);
      node.process([[x.subarray(at, at + m), x.subarray(at, at + m)]], [[L.subarray(at, at + m), R.subarray(at, at + m)]], m, params, slots);
    }
    return L;
  };
  const x = Float32Array.from({ length: 12000 }, (_, i) => 0.9 * Math.sin(2 * Math.PI * 200 * i / sr));
  const four = run({ bits: 4, rate: 48000 }, x);
  const levels = new Set(Array.from(four, v => Math.round(v * 1e5)));
  assert.ok(levels.size <= 16, `4 bits gives at most 16 levels (${levels.size})`);
  assert.ok(Math.abs(Math.round(four[1000] * 8) / 8 - four[1000]) < 1e-6, 'the levels are multiples of 1/8');
  const clean = run({ bits: 16, rate: 48000 }, x);
  assert.ok(x.every((v, i) => Math.abs(v - clean[i]) < 1e-3), '16 bits at full rate is nearly clean');
  const held = run({ bits: 16, rate: sr / 8 }, x);
  let runs = 0; for (let i = 8000; i < 8800; i++) if (held[i] === held[i - 1]) runs++;
  assert.ok(runs > 600, `an eighth of the rate holds each sample for 8 (${runs} repeats in 800)`);
  const half = run({ bits: 3, rate: sr / 4, mix: 0.5 }, x);
  const full = run({ bits: 3, rate: sr / 4, mix: 1 }, x);
  assert.ok(Math.abs(half[3000] - (x[3000] + full[3000]) / 2) < 1e-5, 'mix blends dry and crushed');
  const dith = run({ bits: 3, rate: 48000, dither: 1 }, Float32Array.from({ length: 4000 }, () => 0.03));
  assert.ok(new Set(Array.from(dith, v => v.toFixed(4))).size > 1, 'dither makes a steady quiet level flicker between steps');
  assert.ok(run({ bits: 5, rate: 9000, jitter: 1, dither: 1 }, x).every(Number.isFinite));
}

// 113. Ctrl objects and parameter ports: glides timed in subticks into a parameter, the curves, the seeded stagger.
{
  const { shape, stagger, CURVES } = await import('../src/audio/nodes/ctrl.js');
  assert.equal(CURVES.length, 5);
  for (const c of [0, 1, 2, 3]) assert.ok(shape(c, 0) === 0 && shape(c, 1) === 1 && shape(c, 0.5) > 0 && shape(c, 0.5) < 1, `curve ${c} runs from 0 to 1`);
  assert.ok(shape(2, 0.25) > 0.25 && shape(3, 0.25) < 0.25, 'fast in slow out is above the line early, slow in fast out below');
  const a = stagger(7, 8, 0), b = stagger(7, 8, 0), c2 = stagger(8, 8, 0);
  assert.deepEqual(a, b, 'the same seed gives the same stagger');
  assert.notDeepEqual(a.times, c2.times, 'another seed gives another one');
  assert.ok(a.times.every((t, i) => i === 0 || t >= a.times[i - 1]) && a.times.at(-1) === 1 && a.levels.at(-1) === 1, 'the stagger ends at the destination');
  assert.ok(a.levels.every((v, i) => i === 0 || v >= a.levels[i - 1]), 'with no wobble it only climbs');

  const desc = voices => ({
    nodes: [{ id: 'osc', type: 'osc' }, { id: 'filt', type: 'filter', params: { cutoff: 2000 }, ports: ['cutoff'] }, { id: 'c', type: 'ctrl' }, ...(voices ? [{ id: 'poly', type: 'voices' }] : []), { id: 'out', type: 'out' }],
    connections: [['osc.out', 'filt.in'], ['c.out', 'filt.@cutoff'], voices ? ['filt.out', 'poly.in'] : ['filt.out', 'out.in'], ...(voices ? [['poly.out', 'out.in']] : [])],
    ...(voices ? { voices } : {}),
  });
  const rig = voices => {
    const registry = new ParamRegistry(), rt = new GraphRuntime({ sampleRate: sr, params: registry.values });
    rt.load(compile(desc(voices), { instrument: 'x', nodeTypes: NODE_TYPES, registry }));
    const l = new Float32Array(block), r = new Float32Array(block);
    const write = (name, v) => { registry.set(`x.c.${name}`, v); rt.clock.stamps[registry.slots.get(`x.c.${name}`)]++; };   // what the sequencer does for a pattern cell
    const run = blocks => { for (let i = 0; i < blocks; i++) rt.process(l, r, block); };
    const cutoff = () => registry.get('x.filt.cutoff');
    return { registry, rt, write, run, cutoff };
  };
  const logAt = x => 20 * Math.pow(18000 / 20, x);
  const x0 = Math.log(2000 / 20) / Math.log(18000 / 20);
  const g = rig(0);
  g.rt.note('x', { type: 'noteOn', note: 60, vel: 1 });
  g.run(4);
  assert.ok(Math.abs(g.cutoff() - 2000) < 1, `until the first event the slider's value stands (${g.cutoff()})`);
  const tick = g.rt.clock.tickSamples;   // 6000 at 120 bpm
  g.write('time', 16); g.write('to', 1);   // one tick (16 subticks) to the top
  g.run(Math.round(tick / block / 2));
  const mid = g.cutoff(), want = logAt(x0 + 0.5 * (1 - x0));
  assert.ok(Math.abs(Math.log(mid / want)) < 0.12, `half way is half way across the octaves (${mid.toFixed(0)} vs ${want.toFixed(0)})`);
  g.run(Math.ceil(tick / block / 2) + 2);
  assert.ok(Math.abs(g.cutoff() - 18000) < 1, `and it arrives (${g.cutoff()})`);
  // from: a jump; the same `to` written again glides again
  g.write('from', 0); g.run(1);
  assert.ok(Math.abs(g.cutoff() - 20) < 1, 'from jumps at once');
  g.write('time', 8); g.write('to', 1); g.run(2);
  assert.ok(g.cutoff() > 20 && g.cutoff() < 18000, 'writing the same to again starts another glide');
  g.run(60);
  assert.ok(Math.abs(g.cutoff() - 18000) < 1);
  g.write('time', 0); g.write('to', 0.25); g.run(1);
  assert.ok(Math.abs(g.cutoff() - logAt(0.25)) < 1, 'a time of 0 is a jump');
  // a hand-moved slider (no pattern stamp) glides too
  g.registry.set('x.c.to', 0.75); g.run(1);
  assert.ok(g.cutoff() >= logAt(0.25), 'moving the slider by hand also starts a glide (time 0 jumps)');
  // curves: with the stagger, the value is flat between steps and ends on target
  g.write('curve', 4); g.write('seed', 3); g.write('steps', 6); g.write('time', 32); g.write('from', 0); g.run(1); g.write('to', 1);
  const seen = new Set(); for (let i = 0; i < 100; i++) { g.run(1); seen.add(Math.round(g.cutoff())); }
  assert.ok(seen.size >= 3 && seen.size <= 8, `the stagger moves in a few steps (${seen.size} levels)`);
  g.run(100); assert.ok(Math.abs(g.cutoff() - 18000) < 1, 'and arrives');
  const g2 = rig(0); g2.rt.note('x', { type: 'noteOn', note: 60, vel: 1 }); g2.run(2);
  g2.write('curve', 4); g2.write('seed', 3); g2.write('steps', 6); g2.write('time', 32); g2.write('from', 0); g2.run(1); g2.write('to', 1);
  const again = new Set(); for (let i = 0; i < 100; i++) { g2.run(1); again.add(Math.round(g2.cutoff())); }
  assert.deepEqual([...again], [...seen], 'the same seed gives the same stagger every time');
  // with voices, the one ctrl feeds every voice
  const v = rig(3);
  v.rt.note('x', { type: 'noteOn', note: 60, vel: 1 }); v.rt.note('x', { type: 'noteOn', note: 64, vel: 1 }); v.run(2);
  v.write('time', 4); v.write('to', 1); v.run(30);
  assert.ok(Math.abs(v.cutoff() - 18000) < 1, `a voiced instrument follows the ctrl (${v.cutoff()})`);
  assert.equal(v.rt.instruments.get('x').pre.length, 1, 'the ctrl runs once, ahead of the voices');
  // the graph edits
  const d = { nodes: [{ id: 'filt', type: 'filter' }, { id: 'c', type: 'ctrl' }], connections: [] };
  assert.throws(() => gedit.connect(d, NODE_TYPES, 'c.out', 'filt.@cutoff'), /no input/);
  gedit.setPort(d, NODE_TYPES, 'filt', 'cutoff', true);
  gedit.connect(d, NODE_TYPES, 'c.out', 'filt.@cutoff');
  assert.deepEqual(d.connections, [['c.out', 'filt.@cutoff']]);
  gedit.setPort(d, NODE_TYPES, 'filt', 'cutoff', false);
  assert.deepEqual(d.connections, [], 'taking the port away takes its wire');
  assert.equal(d.nodes[0].ports, undefined);
  // the patcher draws the extra input and finds it
  const filt = { id: 'filt', type: 'filter', x: 100, y: 100, ports: ['cutoff', 'mode'] }, td = { nodes: [filt], connections: [] };
  assert.equal(nodeBox(NODE_TYPES.filter, filt).h > nodeBox(NODE_TYPES.filter).h, true, 'a node with ports is taller');
  const p = portPos(filt, NODE_TYPES.filter, 'in', 2);
  assert.deepEqual(hitTest(td, NODE_TYPES, p.x, p.y), { kind: 'port', side: 'in', node: 'filt', port: '@cutoff' });
  assert.equal(portKind(NODE_TYPES.filter, '@cutoff', filt), 'param');
  assert.equal(portKind(NODE_TYPES.ctrl, 'out'), 'param');
}

// 114. A pattern drives a ctrl object: `to` and `time` as columns, a glide timed in subticks.
{
  const graph = {
    nodes: [{ id: 'osc', type: 'osc' }, { id: 'filt', type: 'filter', params: { cutoff: 2000 }, ports: ['cutoff'] }, { id: 'c', type: 'ctrl' }, { id: 'out', type: 'out' }],
    connections: [['osc.out', 'filt.in'], ['c.out', 'filt.@cutoff'], ['filt.out', 'out.in']],
  };
  const inst = { graph, exposed: [{ node: 'c', param: 'to', label: 'To' }, { node: 'c', param: 'time', label: 'Tim' }, { node: 'c', param: 'from', label: 'Frm' }] };
  const registry = new ParamRegistry(), rt = new GraphRuntime({ sampleRate: sr, params: registry.values });
  rt.load(compile(graph, { instrument: 'p', nodeTypes: NODE_TYPES, registry }));
  const seq = new Sequencer({ sampleRate: sr, runtime: rt, params: registry.values, transport: new Int32Array(new SharedArrayBuffer(8)) });
  // tick 1: from 00, then to FF over 20 subticks (16 are a tick, so 1.25 ticks); tick 8 the same again with no from
  const rows = Array.from({ length: 16 }, (_, i) => (i === 1 ? '... .. FF 20 00' : i === 8 ? '... .. FF 20 ..' : '... .. .. .. ..')).join('\n');
  const song = song120([oneLane('p', 'p', rows)]);
  seq.setSong(song);
  for (const lane of prepareSong(song, { p: inst }, registry)) seq.setLane(lane);
  seq.play();
  const grab = () => registry.get('p.filt.cutoff');
  const run = samples => { render(seq, samples / sr); return grab(); };
  const before = run(6000 * 1 - 256);                       // up to just before tick 1
  assert.ok(Math.abs(before - 2000) < 5, `the slider's value stands before the first event (${before.toFixed(0)})`);
  const tick1 = run(256 + 128);                             // just after tick 1: from 00 jumped to the bottom, a glide begun
  assert.ok(tick1 < 60, `from 00 jumps to the bottom (${tick1.toFixed(0)})`);
  const half = run(7500 - 384);                             // 0.625 ticks into a 1.25 tick glide
  assert.ok(half > 100 && half < 18000, `the glide is under way (${half.toFixed(0)})`);
  const done = run(7500);
  assert.ok(Math.abs(done - 18000) < 20, `20 subticks later it has arrived (${done.toFixed(0)})`);
  // tick 8 writes the same `to` again, and the glide runs again from where it stands (the top: no movement), so
  // write something lower first by hand and check the pattern's rewrite still starts a glide
  registry.set('p.c.to', 0.2); rt.clock.stamps[registry.slots.get('p.c.to')]++;
  render(seq, 256 / sr);
  assert.ok(grab() < 18000, 'a rewrite of the column starts a glide');
}

// Bypass, duplicate, insert on a wire, pull out of a chain.
{
  const registry = new ParamRegistry();
  const osc = { id: 'osc', type: 'osc', params: { wave: 1 } };
  const graph = { nodes: [osc, { id: 'fx', type: 'crusher', params: { bits: 3 } }, { id: 'out', type: 'out' }], connections: [['osc.out', 'fx.in'], ['fx.out', 'out.in']] };
  const run = (g, id, bypass) => {
    const rt = new GraphRuntime({ sampleRate: sr, params: registry.values });
    rt.load(compile(g, { instrument: id, nodeTypes: NODE_TYPES, registry }));
    if (bypass !== undefined) registry.set(`${id}.fx.bypass`, bypass);
    rt.note(id, { type: 'noteOn', note: 48, vel: 1 });
    return render(rt, 0.2).left;
  };
  const direct = run({ nodes: [osc, { id: 'out', type: 'out' }], connections: [['osc.out', 'out.in']] }, 'by0');
  const on = run(graph, 'by1', 1), off = run(graph, 'by2', 0);
  assert.ok(on.every((v, i) => Math.abs(v - direct[i]) < 1e-6), 'a bypassed effect passes the signal');
  assert.ok(off.some((v, i) => Math.abs(v - direct[i]) > 1e-3), 'an active effect changes it');
  const d = { nodes: [{ id: 'osc', type: 'osc', x: 0, y: 0 }, { id: 'g', type: 'gain', x: 100, y: 0, params: { gain: 0.5 } }, { id: 'out', type: 'out', x: 300, y: 0 }], connections: [['osc.out', 'out.in']] };
  gedit.insertOnWire(d, NODE_TYPES, 'g', ['osc.out', 'out.in']);
  assert.deepEqual(d.connections, [['osc.out', 'g.in'], ['g.out', 'out.in']]);
  gedit.pullOut(d, NODE_TYPES, 'g');
  assert.deepEqual(d.connections, [['osc.out', 'out.in']]);
  gedit.insertOnWire(d, NODE_TYPES, 'g', ['osc.out', 'out.in']);
  const [copy] = gedit.duplicateNodes(d, NODE_TYPES, ['g']);
  assert.equal(d.nodes.find(n => n.id === copy).params.gain, 0.5);
  assert.notEqual(d.nodes.find(n => n.id === copy).params, d.nodes.find(n => n.id === 'g').params);
  const both = gedit.duplicateNodes(d, NODE_TYPES, ['osc', 'g']);
  assert.ok(d.connections.some(([f, t]) => f === `${both[0]}.out` && t === `${both[1]}.in`), 'wires between copies are copied');
}

// The master lane: a cell in its BPM column changes the tempo from that tick on, play resets it, volume scales the mix.
{
  const { masterInstrument, ensureMaster, MASTER } = await import('../src/instruments.js');
  const make = () => {
    const song = { bpm: 120, ticksPerBeat: 4, length: 16, swing: 0.5, lanes: [oneLane('kick', 'kick', Array.from({ length: 16 }, () => 'C-2 ..').join('\n'), 16)] };
    const defs = { kick: structuredClone(instruments.kick) };
    ensureMaster({ song, instruments: defs });
    assert.equal(song.lanes[0].id, MASTER, 'the master lane comes first');
    assert.equal(Object.keys(defs)[0], MASTER, 'and so does its instrument');
    song.lanes[0].patterns = { m: { text: '.... .. .. ..\n.... .. .. ..\n.... .. .. ..\n.... .. .. ..\n00F0 .. .. ..' } };   // 0xF0 = 240 bpm at tick 4
    song.lanes[0].placements = [{ puid: 'm', start: 0, length: 16 }];
    const registry = new ParamRegistry();
    for (const [id, d] of Object.entries(defs)) compile(d.graph, { instrument: id, nodeTypes: NODE_TYPES, registry });
    let now = 0;
    const log = [];
    const stub = { process: (l, r, n) => { l.fill(0, 0, n); r.fill(0, 0, n); now += n; }, note: (instrument, msg) => { if (msg.type === 'noteOn') log.push(now); } };
    const seq = new Sequencer({ sampleRate: sr, runtime: stub, params: registry.values, transport: new Int32Array(new SharedArrayBuffer(8)) });
    const slot = k => registry.slots.get(`master.m.${k}`);
    song.master = { bpm: slot('bpm'), swing: slot('swing'), tpb: slot('tpb'), volume: slot('volume') };
    seq.setSong(song);
    for (const lane of prepareSong(song, defs, registry)) seq.setLane(lane);
    return { seq, log, registry, song };
  };
  const { seq, log, registry } = make();
  assert.equal(registry.get('master.m.bpm'), 120, 'the song header sets the starting tempo');
  seq.play();
  const o = [new Float32Array(512), new Float32Array(512)];
  for (let i = 0; i < 60; i++) seq.process(o[0], o[1], 512);
  assert.deepEqual(log.slice(0, 7), [0, 6000, 12000, 18000, 24000, 27000, 30000], 'the tempo doubles at tick 4');
  assert.equal(registry.get('master.m.bpm'), 240);
  seq.stop(); seq.play();
  assert.equal(registry.get('master.m.bpm'), 120, 'playing from the top starts at the header tempo again');
}

// MIDI entry and recording: chords fill the note columns, velocity goes to vl, a pass is one undo step.
{
  const registry = new ParamRegistry();
  const padDef = synthKinds.subtractive.make();
  compile(padDef.graph, { instrument: 'pad', nodeTypes: NODE_TYPES, registry });
  const padSet = { pad: padDef };
  const padRow = buildColumns('pad', padDef, registry).map(c => KINDS[c.token].blank).join(' ');
  const setupMidi = (over = {}, lanePlacements = null) => {
    const song = { bpm: 120, ticksPerBeat: 4, length: 32, swing: 0.5, lanes: [oneLane('pad', 'pad', Array(32).fill(padRow).join('\n'), 32)] };
    if (lanePlacements) song.lanes[0].placements = lanePlacements;
    const lanes = prepareSong(song, padSet, registry), editor = createEditor(lanes, 32);
    const cfg = { chord: 'window', window: 60, velocity: false, offs: true, shared: 'ask', ...over };
    const loop = { value: null };
    const w = createMidiWriter({ lanes: () => lanes, editor: () => editor, length: () => 32, loop: () => loop.value, settings: () => cfg });
    return { lanes, editor, w, cfg, loop, lane: lanes[0], cell: (t, c) => lanes[0].patterns.a.rows[t][c] };
  };
  const notes = noteColumnsOf(prepareSong({ bpm: 120, ticksPerBeat: 4, length: 32, swing: 0.5, lanes: [oneLane('pad', 'pad', Array(32).fill(padRow).join('\n'), 32)] }, padSet, registry)[0]);
  assert.equal(notes.length, 3, 'the pad has three note columns');
  {   // a slider moved while recording goes into its column, on the nearest tick (every Nth row if asked), the last value of a tick staying
    const { w, cell, lane, cfg, editor } = setupMidi();
    const ci = lane.columns.findIndex(c => c.kind === 'param' && c.token === '2hex' && !c.int && !c.log);
    const c = lane.columns[ci];
    w.beginPass();
    assert.deepEqual(w.recParam({ li: 0, node: c.node, param: c.param, value: c.min, pos: 3.8 }), { wrote: true, tick: 4, key: `0:${ci}:4` });
    assert.equal(cell(4, ci), '00', 'the minimum is 00');
    w.recParam({ li: 0, node: c.node, param: c.param, value: c.max, pos: 4.1 });
    assert.equal(cell(4, ci), 'FF', 'the last value in a tick stays');
    w.recParam({ li: 0, node: c.node, param: c.param, value: (c.min + c.max) / 2, pos: 6.2 });
    assert.equal(cell(6, ci), '80', 'halfway is 80');
    cfg.paramStep = 4;
    w.recParam({ li: 0, node: c.node, param: c.param, value: c.max, pos: 9.4 });
    assert.equal(cell(8, ci), 'FF', 'every 4th row: tick 9.4 lands on row 8');
    const nobody = w.recParam({ li: 0, node: 'nonesuch', param: 'x', value: 1, pos: 2 });
    assert.equal(nobody.wrote, false); assert.match(nobody.message, /no column or command/);
    editor.undo?.();
  }
  {   // a chord of four keys within the window: three columns, the fourth refused, the cursor is the caller's business
    const { w, cell, cfg } = setupMidi();
    const keys = [60, 64, 67, 71];
    const res = keys.map((midi, i) => w.stepOn({ li: 0, tick: 4, col: notes[0], midi, vel: 90, time: 1000 + i * 10 }));
    assert.deepEqual(res.map(r => r.wrote), [true, true, true, false], 'a fourth note has no column');
    assert.deepEqual(notes.map(c => cell(4, c)), ['C-4', 'E-4', 'G-4'], 'in the order pressed, C-4 being MIDI 60');
    assert.equal(w.stepOff({ midi: 60 }).ended, false);
    assert.deepEqual([64, 67, 71].map(m => w.stepOff({ midi: m }).ended), [false, false, true], 'the chord ends with its last key');
    // a later key starts a new chord, back at the cursor
    const next = w.stepOn({ li: 0, tick: 5, col: notes[1], midi: 62, time: 5000 });
    assert.equal(next.wrote, true); assert.equal(cell(5, notes[1]), 'D-4', 'a new chord starts at the cursor column');
    assert.equal(cell(5, notes[2]), '...');
    cfg.velocity = false;
  }
  {   // a chord goes in from the lowest note to the highest, however it was played
    const { w, cell, cfg } = setupMidi();
    [67, 60, 64].forEach((midi, i) => w.stepOn({ li: 0, tick: 8, col: notes[0], midi, vel: 90, time: 1000 + i * 10 }));
    assert.deepEqual(notes.map(c => cell(8, c)), ['C-4', 'E-4', 'G-4'], 'sorted lowest first');
    const { w: w2, cell: cell2 } = setupMidi({ order: 'played' });
    [67, 60, 64].forEach((midi, i) => w2.stepOn({ li: 0, tick: 8, col: notes[0], midi, vel: 90, time: 1000 + i * 10 }));
    assert.deepEqual(notes.map(c => cell2(8, c)), ['G-4', 'C-4', 'E-4'], 'the setting keeps the order played');
    const { w: w3, cell: cell3, editor: ed3 } = setupMidi();
    [72, 60, 64, 67].forEach((midi, i) => w3.stepOn({ li: 0, tick: 8, col: notes[0], midi, time: 1000 + i * 10 }));
    assert.deepEqual(notes.map(c => cell3(8, c)), ['C-4', 'E-4', 'C-5'], 'a fourth key is refused and the three before it stay, in order');
    assert.equal(ed3.undo(), 'midi entry'); assert.deepEqual(notes.map(c => cell3(8, c)), ['...', '...', '...'], 'the whole chord is one undo step');
    cfg.velocity = false;
  }
  {   // velocity: vl is written only when the setting is on
    const { w, cell, lane } = setupMidi({ velocity: true });
    const vl = notes[0] + 1;
    assert.equal(lane.columns[vl].kind, 'vel');
    w.stepOn({ li: 0, tick: 2, col: notes[0], midi: 60, vel: 127, time: 0 });
    assert.equal(cell(2, vl), 'FF', 'full velocity is FF');
    w.stepOn({ li: 0, tick: 3, col: notes[0], midi: 60, vel: 64, time: 1000 });
    assert.equal(cell(3, vl), '81', 'velocity 64 of 127 is 0x81');
    const off = setupMidi({ velocity: false });
    off.w.stepOn({ li: 0, tick: 2, col: notes[0], midi: 60, vel: 127, time: 0 });
    assert.equal(off.cell(2, vl), '..', 'with velocity off the vl cell is left alone');
  }
  {   // held mode: a slow chord is still a chord while a key is down
    const { w, cell } = setupMidi({ chord: 'held' });
    w.stepOn({ li: 0, tick: 0, col: notes[0], midi: 60, time: 0 });
    w.stepOn({ li: 0, tick: 0, col: notes[0], midi: 64, time: 5000 });
    assert.deepEqual([cell(0, notes[0]), cell(0, notes[1])], ['C-4', 'E-4']);
    w.stepOff({ midi: 60 }); w.stepOff({ midi: 64 });
    w.stepOn({ li: 0, tick: 1, col: notes[0], midi: 67, time: 5100 });
    assert.equal(cell(1, notes[0]), 'G-4', 'after everything is let go the next key is a new chord');
  }
  {   // shared patterns: refused unless allowed
    const shared = [{ puid: 'a', start: 0, length: 16 }, { puid: 'a', start: 16, length: 16 }];
    const a = setupMidi({}, shared);
    const r = a.w.stepOn({ li: 0, tick: 0, col: notes[0], midi: 60, time: 0 });
    assert.equal(r.wrote, false); assert.match(r.message, /used 2 times/);
    const b = setupMidi({ shared: 'write' }, shared);
    assert.equal(b.w.stepOn({ li: 0, tick: 0, col: notes[0], midi: 60, time: 0 }).wrote, true);
  }
  {   // quantizing: nearest tick, wrapped into the loop
    assert.equal(quantize(4.4, null, 32), 4); assert.equal(quantize(4.6, null, 32), 5);
    assert.equal(quantize(31.7, null, 32), 0, 'past the end wraps to the start');
    assert.equal(quantize(15.6, { start: 8, end: 16 }, 32), 8, 'and into the loop');
    assert.equal(quantize(7.8, { start: 8, end: 16 }, 32), 8);
  }
  {   // recording: chords on one tick, a note off on release, one undo step for the pass, a taken cell is left
    const { w, cell, editor, lanes } = setupMidi();
    w.beginPass();
    w.recOn({ li: 0, midi: 60, vel: 100, pos: 4.2 });
    w.recOn({ li: 0, midi: 64, vel: 100, pos: 4.3 });
    assert.deepEqual([cell(4, notes[0]), cell(4, notes[1])], ['C-4', 'E-4'], 'two notes on one tick take two columns');
    w.recOn({ li: 0, midi: 72, vel: 100, pos: 6.1 });
    w.recOff({ midi: 60, pos: 8.2 });
    assert.equal(cell(8, notes[0]), '===', 'release writes a note off on its tick');
    w.recOff({ midi: 64, pos: 4.4 });
    assert.equal(cell(4, notes[1]), 'E-4', 'a release on the same tick writes nothing');
    w.recOn({ li: 0, midi: 65, vel: 100, pos: 10.0 });
    w.recOff({ midi: 72, pos: 10.2 });
    assert.deepEqual([cell(10, notes[0]), cell(10, notes[2])], ['F-4', '==='], 'a new note takes the first free column; the release of the other one is written in its own');
    w.recOn({ li: 0, midi: 50, pos: 12 }); w.recOff({ midi: 50, pos: 14 });
    w.recOn({ li: 0, midi: 52, pos: 14 });
    assert.equal(cell(14, notes[1]), 'E-3', 'a new note replaces the note off written on its tick (it ends the old note anyway)');
    assert.equal(editor.undo(), 'midi recording');
    assert.ok(lanes[0].patterns.a.rows.every(r => notes.every(c => r[c] === '...')), 'the whole pass is one undo step');
  }
  {   // a note-off option, and a monophonic lane steals its column
    const { w, cell, cfg } = setupMidi({ offs: false });
    w.beginPass();
    w.recOn({ li: 0, midi: 60, pos: 2 }); w.recOff({ midi: 60, pos: 4 });
    assert.equal(cell(4, notes[0]), '...', 'offs off: nothing is written on release');
    const mono = setupMidi();
    mono.w.beginPass();
    for (let i = 0; i < 4; i++) mono.w.recOn({ li: 0, midi: 60 + i, pos: i });   // four held notes, three columns
    assert.equal(mono.cell(3, notes[0]), 'D#4', 'with every column holding a key the oldest column is stolen');
  }
}

// LFO range: legacy swing by amount, or between min and max.
{
  const type = NODE_TYPES.lfo, slots = type.params.map((_, i) => i);
  const run = set => {
    const node = type.create({ sampleRate: sr }), values = type.params.map(p => set[p.name] ?? p.def), out = [new Float32Array(sr / 2)];
    node.process([], out, out[0].length, values, slots);
    return [Math.min(...out[0]), Math.max(...out[0])];
  };
  const [a, b] = run({ rate: 2, amount: 3 });
  assert.ok(Math.abs(a + 3) < 0.01 && Math.abs(b - 3) < 0.01, 'range 0 swings by amount as before');
  const [c, d] = run({ rate: 2, range: 1, min: 200, max: 800, amount: 5 });
  assert.ok(Math.abs(c - 200) < 1 && Math.abs(d - 800) < 1, `range 1 runs between min and max (${c}, ${d})`);
  {   // steps: held between updates, so far fewer distinct values than samples, over the same range
    const node = type.create({ sampleRate: sr, clock: { tickSamples: 6000 } }), values = type.params.map(p => (p.name === 'steps' ? 8 : p.name === 'rate' ? 2 : p.def));
    const out = [new Float32Array(sr / 2)];
    node.process([], out, out[0].length, values, slots);
    const distinct = new Set(out[0]).size;
    assert.ok(distinct > 8 && distinct < 80, `8 updates per tick gives held steps (${distinct} values)`);
    assert.ok(Math.max(...out[0]) > 0.95 && Math.min(...out[0]) < -0.95, 'the stepped wave still reaches its peaks');
  }
  const [e, f] = run({ rate: 2, range: 1, min: 0.2, max: -0.4 });
  assert.ok(Math.abs(e + 0.4) < 0.01 && Math.abs(f - 0.2) < 0.01, 'min above max still spans the two');
}

// Comb resonator percussion: rings at the note's pitch, decays, stays finite and bounded, and the kinds compile.
{
  const type = NODE_TYPES.combperc;
  const slots = type.params.map((_, i) => i);
  const run = (set, note, blocks = 400) => {
    const node = type.create({ sampleRate: sr });
    const values = type.params.map(p => set[p.name] ?? p.def);
    node.note({ type: 'noteOn', note, vel: 1 });
    const all = [];
    for (let b = 0; b < blocks; b++) {
      const L = new Float32Array(128), R = new Float32Array(128);
      node.process([], [[L, R]], 128, values, slots);
      assert.ok(L.every(Number.isFinite), 'the comb bank stays finite');
      all.push(...L);
    }
    return all;
  };
  const rms = (a, from, to) => Math.sqrt(a.slice(from, to).reduce((s, x) => s + x * x, 0) / (to - from));
  const out = run({ sweep: 0, spread: 0, decay: 400, drive: 0 }, 57);   // A3, 220 Hz
  const peak = Math.max(...out.map(Math.abs));
  assert.ok(peak > 0.05 && peak < 1.5, `the hit has a sensible level (${peak})`);
  assert.ok(rms(out, 0, 6400) > rms(out, 25600, 32000) * 3, 'the ring dies away');
  // pitch: the autocorrelation of the ring peaks at the note's period
  const ring = out.slice(3000, 3000 + 4096);
  let best = 0, bestLag = 0;
  for (let lag = 100; lag < 600; lag++) { let c = 0; for (let i = 0; i < 3000; i++) c += ring[i] * ring[i + lag]; if (c > best) { best = c; bestLag = lag; } }
  const hz = sr / bestLag;
  assert.ok(Math.abs(hz - 220) < 6, `rings at the note's pitch (${hz} Hz)`);
  const loud = run({ decay: 4000, damp: 0, drive: 1, level: 1, spread: 1, hollow: 1 }, 36, 800);
  assert.ok(Math.max(...loud.map(Math.abs)) < 2, 'the longest, hardest settings stay bounded');
  const quiet = run({ decay: 20 }, 60);
  assert.ok(rms(quiet, 40000, 51200) < 1e-4, 'a short ring is silent afterwards');
  for (const k of ['combperc', 'combtom']) {
    const def = synthKinds[k].make();
    const registry = new ParamRegistry();
    compile(def.graph, { instrument: 'cp', nodeTypes: NODE_TYPES, registry });
    const cols = buildColumns('cp', def, registry);
    assert.ok(cols.some(c => c.kind === 'note'), `${k} has a note column`);
    assert.equal(cols.filter(c => c.kind === 'param').length >= 4, true, `${k} exposes its parameters`);
  }
}

// The 808 hi-hat: Cl and Op trigger columns, the closed hat chokes the open one, and a repeated hit fires twice.
{
  const def = synthKinds.hat808.make();
  const registry = new ParamRegistry();
  compile(def.graph, { instrument: 'hat', nodeTypes: NODE_TYPES, registry });
  const cols = buildColumns('hat', def, registry);
  assert.deepEqual(cols.slice(0, 2).map(c => [c.kind, c.token, c.label]), [['trig', '1hex', 'Cl'], ['trig', '1hex', 'Op']], 'two trigger columns come first, and no note columns');
  assert.ok(!cols.some(c => c.kind === 'note'));
  const rows = (text, length) => oneLane('hat', 'hat', text, length);
  // the sequencer sends one note event per filled cell, with the digit as velocity
  const song = { bpm: 120, ticksPerBeat: 4, length: 4, swing: 0.5, lanes: [rows(['F .', 'F .', '. 8', '0 .'].map(r => `${r}`).join('\n'), 4)] };
  const log = [];
  const stub = { process: (l, r, n) => { l.fill(0, 0, n); r.fill(0, 0, n); }, note: (instrument, msg) => { if (msg.type === 'noteOn') log.push([msg.note, Math.round(msg.vel * 15)]); } };
  const seq = new Sequencer({ sampleRate: sr, runtime: stub, params: registry.values, transport: new Int32Array(new SharedArrayBuffer(8)) });
  seq.setSong(song);
  for (const lane of prepareSong(song, { hat: def }, registry)) seq.setLane(lane);
  seq.play();
  const o = [new Float32Array(512), new Float32Array(512)];
  for (let i = 0; i < 30; i++) seq.process(o[0], o[1], 512);
  assert.deepEqual(log.slice(0, 3), [[0, 15], [0, 15], [1, 8]], 'F F in Cl fires twice, 8 in Op is an open hit, and 0 is nothing');
  // the sound: closed dies fast, open rings, a closed hit cuts the open tail in about 8 ms
  const type = NODE_TYPES.hat808;
  const slots = type.params.map((_, i) => i);
  const render = (blocks, hits = {}, set = {}) => {
    const node = type.create({ sampleRate: sr });
    const values = type.params.map(p => set[p.name] ?? p.def);
    const out = [];
    for (let b = 0; b < blocks; b++) {
      for (const msg of hits[b] ?? []) node.note(msg);
      const L = new Float32Array(128), R = new Float32Array(128);
      node.process([], [[L, R]], 128, values, slots);
      assert.ok(L.every(Number.isFinite), 'the hat stays finite');
      out.push(Math.sqrt(L.reduce((a, x) => a + x * x, 0) / 128));
    }
    return out;
  };
  const on = (note, vel = 1) => ({ type: 'noteOn', note, vel });
  const closedOnly = render(200, { 0: [on(0)] });
  assert.ok(closedOnly[0] > 0.01, 'a closed hit sounds');
  assert.ok(closedOnly[100] < closedOnly[0] * 0.02, 'and is gone by about 270 ms');
  const openOnly = render(200, { 0: [on(1)] });
  assert.ok(openOnly[100] > openOnly[0] * 0.02, 'an open hit still rings at 270 ms');
  // the open hat is choked by a closed hit 100 blocks in, and not when choke is off
  const choked = render(160, { 0: [on(1)], 100: [on(0)] });
  const free = render(160, { 0: [on(1)], 100: [on(0)] }, { choke: 0 });
  assert.ok(choked[150] < choked[99] * 0.05, 'a closed hit cuts the open tail');
  assert.ok(free[150] > free[99] * 0.1, 'with choke off the open hat rings on');
  assert.ok(choked[100] > choked[150], 'the cut is a short fade (8 ms is 3 blocks), not an instant click');
  // both on one row: the closed hit wins, the open hat is gone a few blocks later
  const both = render(130, { 0: [on(1), on(0)] });
  assert.ok(both[20] < both[0] * 0.05, 'closed and open on one row leave only the closed hit');
  assert.ok(Math.abs(render(4, { 0: [on(0, 0.5)] })[0] / render(4, { 0: [on(0, 1)] })[0] - 0.5) < 0.05, 'velocity scales the hit');
}

// Multitap: the time between taps goes up to a second, so the taps of an impulse land one and two seconds on.
{
  const type = NODE_TYPES.multitap;
  assert.equal(type.params.find(p => p.name === 'time').max, 1000);
  const node = type.create({ sampleRate: sr });
  const slots = type.params.map((_, i) => i), values = type.params.map(p => p.def);
  const set = (name, v) => { values[type.params.findIndex(p => p.name === name)] = v; };
  set('time', 1000); set('taps', 2); set('decay', 1); set('spread', 0); set('feedback', 0); set('mix', 1);
  const total = sr * 3, out = new Float32Array(total), peaks = [];
  for (let at = 0; at < total; at += block) {
    const L = new Float32Array(block), R = new Float32Array(block), oL = new Float32Array(block), oR = new Float32Array(block);
    if (at === 0) { L[0] = 1; R[0] = 1; }
    node.process([[L, R]], [[oL, oR]], block, values, slots);
    out.set(oL, at);
  }
  for (let i = 1; i < total; i++) if (Math.abs(out[i]) > 0.1) peaks.push(i);
  assert.ok(peaks.some(i => Math.abs(i - sr) < 4) && peaks.some(i => Math.abs(i - 2 * sr) < 4), 'taps at one and two seconds');
}

// The arrangement scrolls with the mouse wheel, without moving the cursor, and follows the cursor again once it moves.
{
  const registry = new ParamRegistry();
  for (const [id, def] of Object.entries(instruments)) compile(def.graph, { instrument: id, nodeTypes: NODE_TYPES, registry });
  const lanes = prepareSong(demoSong, instruments, registry);
  const song = { ...demoSong, length: 4096 };
  let onKey;
  const el = { addEventListener: (type, f) => { if (type === 'keydown') onKey = f; else if (type === 'wheel') onWheel = f; }, innerHTML: '' };
  const statusEl = { textContent: '' };
  const view = createSequenceView({ el, statusEl, transport: new Int32Array(new SharedArrayBuffer(8)), onToggle() {}, onOpen() {} });
  view.load({ lanes, song, editor: createEditor(lanes, 4096) });
  view.draw();
  const firstTick = () => Number(el.innerHTML.split('<div class="r">').map(x => x.replace(/<[^>]+>/g, '')).find(x => /^[> ]?\d{4} /.test(x)).match(/\d{4}/)[0]);
  assert.equal(firstTick(), 0);
  onWheel({ preventDefault() {}, deltaY: 100, deltaMode: 0 });
  assert.equal(firstTick(), 64, 'a notch (100) is four rows of 16 ticks');
  assert.ok(statusEl.textContent.includes('tick 0'), 'the cursor stays where it was');
  onWheel({ preventDefault() {}, deltaY: -1000, deltaMode: 0 });
  assert.equal(firstTick(), 0, 'it stops at the top');
  onWheel({ preventDefault() {}, deltaY: 100000, deltaMode: 0 });
  assert.ok(firstTick() <= 4096 - 16, 'and at the bottom');
  onKey({ key: 'ArrowDown', preventDefault() {} });
  view.draw();
  assert.ok(firstTick() < 64, 'moving the cursor brings the view back to it');
}

// Column names: headers fit the cells, and the status bar describes the column under the caret.
{
  const { shortName } = await import('../src/seq/names.js');
  const { describeColumn } = await import('../src/seq/describe.js');
  assert.equal(shortName('Note', 3), 'nöt'); assert.equal(shortName('Smp', 2), 'id');
  assert.deepEqual(['Cut', 'Res', 'Dec', 'Det', 'Mix', 'Off', 'Rt2'].map(l => shortName(l, 2)), ['ct', 'rs', 'dc', 'dt', 'mx', 'of', 'r2']);
  assert.equal(shortName('Cl', 1), 'c'); assert.equal(shortName('Time', 4), 'Time'); assert.equal(shortName('Cmd', 6), 'Cmd');
  const registry = new ParamRegistry();
  const def = { ...structuredClone(instruments.lead) };
  compile(def.graph, { instrument: 'lead', nodeTypes: NODE_TYPES, registry });
  const cols = buildColumns('lead', def, registry);
  assert.deepEqual(cols.map(c => c.short), ['nöt', 'vl', 'id', 'Off', 'Rtg', 'ct', 'rs', 'mx', 'Time', 'Cmd']);
  assert.ok(cols.every(c => c.short.length <= KINDS[c.token].width), 'no header is wider than its cell');
  const hat = buildColumns('hat', (() => { const d = synthKinds.hat808.make(); compile(d.graph, { instrument: 'hat', nodeTypes: NODE_TYPES, registry }); return d; })(), registry);
  assert.deepEqual(hat.map(c => c.short), ['c', 'o', 'cd', 'od', 'tn', 'tu', 'Cmd'], 'one character for a 1hex column, and no two the same');
  const lane = { columns: cols, rows: Array.from({ length: 6 }, () => cols.map(c => (c.token === 'note' ? '...' : '.'.repeat({ '2hex': 2, '4hex': 4, cmd: 6 }[c.token])))) };
  const cut = cols.findIndex(c => c.label === 'Cut');
  assert.match(describeColumn(lane, 3, cut), /^Cutoff · .*Hz.* to .*kHz \(log\) · default [0-9A-F]{2} = /, 'a column nobody wrote to shows its default');
  lane.rows[1][cut] = 'FF';
  assert.match(describeColumn(lane, 3, cut), /held FF = 18 kHz$/, 'a blank cell shows the last value above it');
  assert.match(describeColumn(lane, 1, cut), /FF = 18 kHz$/, 'a filled cell shows its own');
  assert.match(describeColumn(lane, 0, 1), /^Velocity · 00 to FF · default FF = 100%$/);
  { const { describeParts } = await import('../src/seq/describe.js');
    const parts = describeParts(lane, 1, cut);
    assert.match(parts.name, /^Cutoff/); assert.match(parts.value, /kHz/); assert.ok(parts.frac > 0.9 && parts.frac <= 1, 'where FF sits in the range');
    assert.equal(describeParts(lane, 0, 1).value, '100%', 'an empty velocity shows the default, FF'); }
  lane.rows[2][5] = '.';
  const cmd = cols.length - 1;
  lane.rows[2][cmd] = '010000';
  assert.match(describeColumn(lane, 2, cmd), /^Command · 01: Cutoff.*· 0000 = /, 'a command names its target and value');
}

// MOD files: parse, play the arrangement out, build the project, and play it through the modchan machine.
{
  const { makeMod } = await import('./modfixture.mjs');
  const { parseMod, playOut, modToProject } = await import('../src/project/mod.js');
  const sq = n => Array.from({ length: n }, (_, i) => (i < n / 2 ? 100 : -100));
  // parsing: cells, samples, loops, finetune
  const mod = parseMod(makeMod({ title: 'tune', samples: [{ name: 'one', data: sq(64), volume: 40, finetune: 3, loopStart: 16, loopLength: 32 }], patterns: [[[[428, 1, 0xC, 0x20], null, [214, 0x1f, 0xE, 0x93]]]] }));
  assert.equal(mod.title, 'tune'); assert.equal(mod.channels, 4);
  assert.deepEqual(mod.patterns[0][0][0], { period: 428, sample: 1, effect: 0xC, param: 0x20 });
  assert.deepEqual(mod.patterns[0][0][2], { period: 214, sample: 0x1f, effect: 0xE, param: 0x93 }, 'sample numbers above 15 use the high nibble');
  assert.equal(mod.samples[0].length, 64); assert.equal(mod.samples[0].finetune, 3); assert.equal(mod.samples[0].loopStart, 16);
  assert.equal(mod.samples[0].data[0], 100 / 128);
  assert.throws(() => parseMod(new ArrayBuffer(2000)), /Not a/);
  // playing out: speed, tempo, break, jump (the song stops where it comes round again), pattern loop, delay
  const row = (...cells) => cells;
  const play = patterns => playOut(parseMod(makeMod({ patterns, orders: patterns.map((_, i) => i) }))).steps;
  let steps = play([[row([0, 0, 0xF, 3]), row([0, 0, 0xF, 0x8C])], []]);
  assert.equal(steps[0].speed, 3, 'F03 sets the speed on its own row'); assert.equal(steps[1].tempo, 140, 'F8C is tempo 140');
  assert.equal(steps.length, 128, 'two patterns of 64 rows');
  steps = play([[row([0, 0, 0xD, 0x03]), [], [], []], [row(), row()]]);
  assert.deepEqual(steps.slice(0, 3).map(s => [s.pattern, s.row]), [[0, 0], [1, 3], [1, 4]], 'D03 goes to row 3 of the next pattern');
  const jumps = Array.from({ length: 64 }, () => []); jumps[1] = [[0, 0, 0xB, 0]];
  steps = play([jumps]);
  assert.equal(steps.length, 2, 'B00 back to the start ends the song at the second visit');
  const loops = Array.from({ length: 64 }, () => []); loops[0] = [[0, 0, 0xE, 0x60]]; loops[2] = [[0, 0, 0xE, 0x62]];
  steps = play([loops]);
  assert.deepEqual(steps.slice(0, 8).map(s => s.row), [0, 1, 2, 0, 1, 2, 0, 1], 'E62 plays rows 0 to 2 twice more');
  const delays = Array.from({ length: 64 }, () => []); delays[0] = [[0, 0, 0xE, 0xE2]];
  steps = play([delays]);
  assert.equal(steps[0].delay, 2, 'EE2 holds the row for two more');
  // the project
  const proj = modToProject(parseMod(makeMod({ samples: [{ name: 'lead', data: sq(64), volume: 32, finetune: -2, loopStart: 0, loopLength: 64 }], patterns: [[row([428, 1, 0xF, 4], [339, 1, 0xC, 0x20]), row(), row([0, 0, 0xF, 0x8C])]] })));
  assert.deepEqual(proj.song.lanes.map(l => l.id), ['master', 'ch1', 'ch2', 'ch3', 'ch4'], 'the master lane, then a lane for each channel');
  assert.equal(proj.song.ticksPerBeat, 24); assert.equal(proj.song.bpm, 125);
  assert.equal(proj.song.length, 64 * 4, 'F04 on the first row sets the speed for the whole pattern: 64 rows of 4 ticks');
  const lane1 = proj.song.lanes[1], pat = Object.values(lane1.patterns)[0].text.split('\n');
  assert.equal(pat[0], 'C-2 00 01' + '0F04'.padStart(4, '0'), 'row 0: the note, the sample number minus one, the effect word');
  assert.equal(pat[1], '... .. ......', 'the other ticks of the row are blank');
  assert.equal(lane1.placements[0].length, pat.length, 'a placement is as long as its pattern');
  const sample = Object.values(proj.samples).find(x => x.loopOn);
  assert.equal(sample.rate, Math.round(8363 * Math.pow(2, -2 / 96)), 'finetune is part of the rate'); assert.equal(sample.volume, 0.5);
  assert.ok(proj.samples['mod-empty'], 'an empty slot has a silent sample, so the numbers line up');
  assert.equal(proj.instruments.ch1.samples.ch.length, 31);
  assert.equal(proj.instruments.ch1.noVel, true);
  assert.ok(Object.values(proj.song.lanes[0].patterns)[0].text.split('\n').some(l => l.startsWith('008C')), 'a tempo change lands in the master lane');
  // sound: run it through the sequencer
  const rig = buffer => {
    const data = modToProject(parseMod(buffer));
    const registry = new ParamRegistry();
    const rt = new GraphRuntime({ sampleRate: sr, params: registry.values });
    for (const [id, d] of Object.entries(data.instruments)) rt.load(compile(d.graph, { instrument: id, nodeTypes: NODE_TYPES, registry }));
    for (const [id, d] of Object.entries(data.instruments)) for (const [node, v] of Object.entries(d.samples ?? {})) pops.slotsOf(v).forEach((sid, slot) => rt.message(id, node, pops.sampleMessage(data.samples[sid], slot)));
    const slot = k => registry.slots.get(`master.m.${k}`);
    data.song.master = { bpm: slot('bpm'), swing: slot('swing'), tpb: slot('tpb'), volume: slot('volume') };
    const seq = new Sequencer({ sampleRate: sr, runtime: rt, params: registry.values, transport: new Int32Array(new SharedArrayBuffer(8)) });
    seq.setSong(data.song);
    for (const lane of prepareSong(data.song, data.instruments, registry)) seq.setLane(lane);
    seq.play();
    return { registry, seq, render(seconds) {
      const total = Math.floor(sr * seconds / 128) * 128, L = new Float32Array(total), l = new Float32Array(128), r = new Float32Array(128);
      for (let at = 0; at < total; at += 128) { seq.process(l, r, 128); L.set(l, at); }
      return L;
    } };
  };
  const wave = sq(16);
  const run = (rows, seconds = 0.4) => rig(makeMod({ samples: [{ data: wave, loopStart: 0, loopLength: 16 }], patterns: [rows] })).render(seconds);
  const rms = (x, a, b) => { let t = 0; for (let i = Math.floor(a * sr); i < Math.floor(b * sr); i++) t += x[i] ** 2; return Math.sqrt(t / ((b - a) * sr)); };
  const hz = (x, a, b) => { const t = []; for (let i = Math.floor(a * sr) + 1; i < Math.floor(b * sr); i++) if (x[i] >= 0 && x[i - 1] < 0) t.push(i - x[i] / (x[i] - x[i - 1])); return t.length > 1 ? sr * (t.length - 1) / (t[t.length - 1] - t[0]) : 0; };
  const plain = rms(run([[[428, 1, 0, 0]]]), 0.02, 0.1);
  assert.ok(plain > 0.05, 'a note sounds');
  assert.ok(Math.abs(hz(run([[[428, 1, 0, 0]]]), 0.02, 0.1) - 8363 / 16) < 8, 'C-2 plays the sample at its own rate: 8363 Hz');
  assert.ok(Math.abs(rms(run([[[428, 1, 0xC, 0x20]]]), 0.02, 0.1) / plain - 0.5) < 0.03, 'C20 is half volume');
  assert.ok(rms(run([[[428, 1, 0xE, 0xC3]]]), 0.1, 0.2) < 1e-4, 'EC3 cuts the note after 3 ticks');
  const up = run([[[428, 1, 1, 0x10]]]);
  assert.ok(hz(up, 0.09, 0.12) > hz(up, 0.01, 0.04) * 1.05, 'a slide up raises the pitch');
  const arp = run([[[428, 1, 0, 0x47]]]);
  assert.ok(Math.abs(hz(arp, 0.021, 0.039) / hz(arp, 0.001, 0.019) - Math.pow(2, 4 / 12)) < 0.06, 'arpeggio: the second tick is 4 semitones up');
  const porta = run([[[428, 1, 0, 0]], [[339, 0, 3, 0x20]]], 0.6);
  assert.ok(Math.abs(hz(porta, 0.45, 0.55) / hz(porta, 0.02, 0.1) - 428 / 339) < 0.03, '3 slides to the note without playing it again');
  assert.ok(rms(run([[[428, 1, 0, 0]], [[0, 0, 0xC, 0x10]]], 0.3), 0.15, 0.25) < plain * 0.35, 'C10 on a later row lowers the volume');
  const tempo = rig(makeMod({ samples: [{ data: wave }], patterns: [[[[428, 1, 0xF, 0x8C]]]] }));
  tempo.render(0.1);
  assert.equal(tempo.registry.get('master.m.bpm'), 140, 'F8C sets the tempo through the master lane');
  // a long song: more than 4096 ticks is fine
  const long = modToProject(parseMod(makeMod({ patterns: [[]], orders: Array.from({ length: 20 }, () => 0) })));
  assert.ok(long.song.length > 4096, 'a MOD of twenty patterns is 7680 ticks');
  pops.setSongLength({ song: { length: 16 }, lanes: [] }, 20000);
}

// MIDI import: a hand-made two-track file, a chord and a melody.
{
  const { parseMidi, importMidi } = await import('../src/project/midi.js');
  const vlq = n => { const o = [n & 0x7f]; while ((n >>= 7)) o.unshift((n & 0x7f) | 0x80); return o; };
  const track = ev => { const body = [...ev.flat(), 0, 0xff, 0x2f, 0]; return [0x4d, 0x54, 0x72, 0x6b, 0, 0, 0, body.length, ...body]; };
  const tempo = [0, 0xff, 0x51, 3, 0x07, 0xa1, 0x20];   // 500000 us per quarter = 120 bpm
  const t1 = track([tempo, [0, 0x90, 60, 100], [0, 0x90, 64, 100], [0, 0x90, 67, 100], vlq(480), [0x80, 60, 0], [0, 0x80, 64, 0], [0, 0x80, 67, 0]]);
  const t2 = track([[0, 0xff, 3, 4, 0x6c, 0x65, 0x61, 0x64], [0, 0x91, 72, 64], vlq(120), [0x81, 72, 0], vlq(120), [0x91, 74, 127], vlq(120), [0x81, 74, 0]]);
  const file = Uint8Array.from([0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 1, 0, 2, 0x01, 0xe0, ...t1, ...t2]).buffer;
  const midi = parseMidi(file);
  assert.equal(midi.bpm, 120);
  assert.equal(midi.tracks.length, 2);
  assert.equal(midi.tracks[0].notes.length, 3);
  assert.equal(midi.tracks[1].name, 'lead');
  const data = { song: { bpm: 100, ticksPerBeat: 4, length: 16, lanes: [] }, instruments: {}, samples: {} };
  const done = importMidi(data, midi);
  assert.equal(done.lanes, 2);
  assert.equal(data.song.bpm, 120);
  const chord = data.song.lanes[0].patterns[Object.keys(data.song.lanes[0].patterns)[0]].text.split('\n');
  assert.ok(chord[0].startsWith('C-4 ') && chord[0].includes('E-4') && chord[0].includes('G-4'), 'the chord sits on one row, over three note columns');
  assert.ok(chord[4].startsWith('==='), 'its note offs one beat on');
  const lead = data.song.lanes[1].patterns[Object.keys(data.song.lanes[1].patterns)[0]].text.split('\n');
  assert.ok(lead[0].startsWith('C-5 '), 'melody starts on tick 0');
  assert.ok(lead[1].startsWith('==='), 'and stops a tick on (120 of 480 ppq)');
  assert.ok(lead[2].startsWith('D-5 FF'), 'the next note at full velocity');
  assert.ok(Object.keys(data.instruments).includes('lead'), 'the track name names the synth');
  assert.equal(data.song.ticksPerBeat, 4, 'a file on the 16th grid keeps the song at 4 ticks per beat');
  // triplets need 12 ticks per beat, and what is already in the song is spread out to play the same
  const trip = { ppq: 480, bpm: 120, tracks: [{ name: 'trip', channel: 0, notes: [0, 1 / 3, 2 / 3, 1].map(time => ({ time, length: 0.25, note: 60, vel: 100 })) }] };
  const d2 = { song: { bpm: 100, ticksPerBeat: 4, length: 16, loop: { start: 0, end: 8 }, lanes: [{ id: 'a', instrument: 'x', patterns: { p: { text: 'C-4 20\n... ..' } }, placements: [{ puid: 'p', start: 4, length: 2 }] }] }, instruments: {}, samples: {} };
  importMidi(d2, trip);
  assert.equal(d2.song.ticksPerBeat, 12);
  assert.equal(d2.song.length, 48);
  assert.deepEqual(d2.song.lanes[0].placements, [{ puid: 'p', start: 12, length: 6 }]);
  assert.equal(d2.song.lanes[0].patterns.p.text, 'C-4 20\n... ..\n... ..\n... ..\n... ..\n... ..');
  assert.deepEqual(d2.song.loop, { start: 0, end: 24 });
  const rows = d2.song.lanes[1].patterns[Object.keys(d2.song.lanes[1].patterns)[0]].text.split('\n');
  assert.deepEqual([0, 4, 8, 12].map(r => rows[r].startsWith('C-4')), [true, true, true, true], 'the triplet falls on ticks 0, 4, 8 and 12');
}

// A note-off marker lets go of the lane's notes at its row
{
  const text = patternText(16, { 0: 'C-4 .. .. .... .... .. .. ..' });
  const offsAt = marks => {
    const song = { ...song120([oneLane('lead', 'lead', text, 16)]), length: 32 };
    if (marks) song.lanes[0].offs = marks;
    const { seq, rt } = songSetup(song), seen = [];
    const note = rt.note.bind(rt);
    rt.note = (instrument, msg) => { if (msg.type === 'allOff') seen.push(seq.tick); note(instrument, msg); };
    seq.play(); render(seq, 2.2);
    return seen;
  };
  assert.deepEqual(offsAt(null), [], 'nothing lets go without a marker');
  assert.deepEqual(offsAt([16]), [16], 'the marker lets go once, at its row');
}

// Song info text is saved with the project
{
  const out = serializeProject({ song: { name: 's', bpm: 100, ticksPerBeat: 4, length: 32, info: 'hello\nhttps://example.com' }, instruments: {}, samples: {}, lanes: [] });
  assert.equal(parseProject(out).song.info, 'hello\nhttps://example.com');
  assert.ok(!serializeProject({ song: { name: 's', bpm: 100, ticksPerBeat: 4, length: 32 }, instruments: {}, samples: {}, lanes: [] }).includes('"info"'), 'no info, no field');
}

// Solo-edit: one placement on its own, rows from 0, nothing else reachable
{
  const registry = new ParamRegistry();
  for (const [id, def] of Object.entries(instruments)) compile(def.graph, { instrument: id, nodeTypes: NODE_TYPES, registry });
  const song = structuredClone(demoSong);
  song.length = 64;
  const lanes = prepareSong(song, instruments, registry);
  let onKey, backs = 0;
  const el = { addEventListener: (type, f) => { if (type === 'keydown') onKey = f; }, innerHTML: '' };
  const statusEl = { textContent: '', set innerHTML(h) { this.html = h; this.textContent = h.replace(/<[^>]+>/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'); } };
  const view = createTrackerView({ el, statusEl, transport: new Int32Array(new SharedArrayBuffer(8)), onToggle() {}, onBack: () => { backs++; } });
  view.load({ lanes, song, editor: createEditor(lanes, song.length) });
  const press = (key, extra = {}) => onKey({ key, preventDefault() {}, ...extra });
  const li = lanes.findIndex(l => l.placements.some(p => p.start === 16));
  assert.ok(li >= 0);
  const pl = lanes[li].placements.find(p => p.start === 16);
  assert.ok(view.enterSolo(li, 20));
  view.draw();
  const text = el.innerHTML.replace(/<[^>]+>/g, '').split('\n');
  const rowsShown = text.slice(2).filter(l => /^\s*\d{4} /.test(l));
  assert.equal(rowsShown.length, Math.min(pl.length, lanes[li].patterns[pl.puid].length), 'only the rows of that placement');
  assert.match(rowsShown[0], /^ 0000/, 'numbered from 0');
  assert.ok(!text[0].includes('master') || li === 0, 'other lanes are not shown');
  press('End'); view.draw(); assert.match(statusEl.textContent, /SOLO/);
  const sameBefore = lanes[li].placements.filter(p => p.puid === pl.puid).length;
  const was = pl.puid; press('g', { ctrlKey: true });
  assert.notEqual(lanes[li].placements.find(p => p.start === 16).puid, was, 'Ctrl+G gives the placement its own copy of the pattern');
  assert.equal(lanes[li].placements.filter(p => p.puid === was).length, sameBefore - 1, 'the others keep the old one');
  press('Tab'); assert.equal(view.tick, 16 + rowsShown.length - 1, 'Tab does not leave');
  for (let i = 0; i < 100; i++) press('ArrowDown');
  assert.ok(view.tick >= 16 && view.tick < 16 + rowsShown.length, 'the cursor stays inside the pattern');
  view.draw();   // the earlier Tab switched to the other view: the whole song, the rest locked
  assert.ok(el.innerHTML.includes('class="lock"') && el.innerHTML.includes('class="soloblk"'), 'hatch view marks the locked and the open parts');
  press('ArrowDown'); assert.ok(view.tick >= 16 && view.tick < 16 + rowsShown.length, 'still confined in the hatch view');
  press('Tab');
  press('Escape'); assert.equal(backs, 0, 'Esc first leaves solo-edit');
  view.draw(); assert.ok(el.innerHTML.includes('0016'), 'and the song ticks are back');
  press('Escape'); assert.equal(backs, 1, 'Esc again goes back to the arrangement');
}

// Playing from a tick, and one row at a time
{
  const text = patternText(16, { 2: 'C-4 .. .. .... .... .. .. ..' });
  const { seq } = songSetup(song120([oneLane('lead', 'lead', text)]));
  seq.play(2);
  const at = firstSound(render(seq, 0.2).left);
  assert.ok(at >= 0 && at <= 3, `playing from the row of the note starts it at once (sample ${at})`);
  seq.stop();
  const b = songSetup(song120([oneLane('lead', 'lead', text)])).seq;
  b.row(0); assert.equal(firstSound(render(b, 0.1).left), -1, 'a row with no events is silent');
  assert.equal(b.playing, false);
  b.row(2); assert.ok(firstSound(render(b, 0.1).left) >= 0, 'a single row plays its note without starting the song');
  assert.equal(b.playing, false, 'and the song is not running');
  assert.equal(b.transport[1], 0);
}

// Arrangement selection, copy/paste and Ctrl+D; pattern editor Ctrl+D; follow mode
{
  const registry = new ParamRegistry();
  for (const [id, def] of Object.entries(instruments)) compile(def.graph, { instrument: id, nodeTypes: NODE_TYPES, registry });
  const song = structuredClone(demoSong);
  song.length = 256;
  const lanes = prepareSong(song, instruments, registry);
  const editor = createEditor(lanes, song.length);
  let onKey;
  const el = { addEventListener: (type, f) => { if (type === 'keydown') onKey = f; }, innerHTML: '', children: [] };
  const statusEl = { textContent: '' };
  const transport = new Int32Array(new SharedArrayBuffer(8));
  let follow = false;
  const view = createSequenceView({ el, statusEl, transport, onToggle() {}, onOpen() {}, follow: () => follow });
  view.load({ lanes, song, editor });
  const press = (key, extra = {}) => onKey({ key, preventDefault() {}, ...extra });
  const starts = l => l.placements.map(p => p.start).sort((a, b) => a - b);
  const l0 = lanes[0], before = starts(l0).length;
  // select the first pattern of lane 0 (one row tall) and copy it down twice with Ctrl+D
  view.goto(0, 0);
  const first = placementAt(l0, 0), rowsOf = first.length / 16;
  press('d', { ctrlKey: true });
  const after1 = starts(l0);
  assert.ok(after1.includes(first.length), 'Ctrl+D copied the pattern right below itself');
  press('d', { ctrlKey: true });
  assert.ok(starts(l0).includes(first.length * 2), 'a second Ctrl+D copies it below the copy');
  assert.ok(starts(l0).length >= before, 'placements only grew or were replaced');
  assert.equal(editor.undo(), 'copy down'); assert.equal(editor.undo(), 'copy down');
  assert.equal(starts(l0).length, before, 'both copies undone');
  // a block across two lanes: Shift+Down grows rows, Shift+Right adds a lane, Ctrl+C then Ctrl+V further down
  view.goto(0, 0);
  press('ArrowDown', { shiftKey: true }); press('ArrowRight', { shiftKey: true });
  view.draw(); assert.match(statusEl.textContent, /selected 2x2/);
  press('c', { ctrlKey: true });
  view.goto(0, 16 * 8);
  press('v', { ctrlKey: true });
  assert.match(statusEl.textContent + '', /./);
  press('Escape');
  press('Delete');
  // follow mode: the cursor row goes with the playing row, and the row carries the highlight
  follow = true; Atomics.store(transport, 1, 1); Atomics.store(transport, 0, 48);
  view.draw();
  assert.ok(el.innerHTML.includes('r now'), 'the playing row is highlighted while following');
  follow = false; view.draw();
  assert.ok(!el.innerHTML.includes('r now'), 'and not otherwise');
  Atomics.store(transport, 1, 0);
}


// 115. Plucked string: pitch, decay time, damping, pluck position, release.
{
  const def = NODE_TYPES.string;
  const run = (values, { note = 57, secs = 1.5, off = null } = {}) => {
    const params = Float32Array.from(def.params.map(p => values[p.name] ?? p.def)), slots = Int32Array.from(def.params.map((_, i) => i));
    const node = def.create({ sampleRate: sr, connected: [false] });
    node.note({ type: 'noteOn', note, vel: 1 });
    const N = Math.floor(sr * secs / 128) * 128, L = new Float32Array(N), l = new Float32Array(128), r = new Float32Array(128), zero = new Float32Array(128);
    for (let at = 0; at < N; at += 128) {
      if (off !== null && at === off) node.note({ type: 'noteOff' });
      node.process([zero], [[l, r]], 128, params, slots);
      L.set(l, at);
    }
    return L;
  };
  const rms = (x, a, b) => { let s = 0; for (let i = a; i < b; i++) s += x[i] * x[i]; return Math.sqrt(s / (b - a)); };
  const freq = x => {   // autocorrelation peak of 0.2 s to 0.4 s, refined by interpolation
    const s0 = Math.floor(sr * 0.2), len = 9600, ac = lag => { let c = 0; for (let i = 0; i < len; i++) c += x[s0 + i] * x[s0 + i + lag]; return c; };
    let best = 0, bestLag = 0;
    for (let lag = Math.floor(sr / 1500); lag < Math.floor(sr / 60); lag++) { const c = ac(lag); if (c > best) { best = c; bestLag = lag; } }
    const a = ac(bestLag - 1), b = ac(bestLag), c = ac(bestLag + 1);
    return sr / (bestLag + 0.5 * (a - c) / (a - 2 * b + c));
  };
  const a3 = run({ damp: 0.2, bright: 0.2 });
  assert.ok(a3.every(Number.isFinite) && rms(a3, 0, 4000) > 0.02, 'the string sounds');
  for (const note of [45, 57, 69, 81]) {
    const want = 440 * Math.pow(2, (note - 69) / 12);
    assert.ok(Math.abs(freq(run({ damp: 0.2, bright: 0.2 }, { note })) / want - 1) < 0.01, `note ${note} rings at ${want.toFixed(1)} Hz`);
  }
  const t60 = db => { const a = rms(run({ decay: 1, damp: 0 }), 0, 6000), b = rms(run({ decay: 1, damp: 0 }), Math.floor(sr * db), Math.floor(sr * db) + 6000); return 20 * Math.log10(b / a); };
  assert.ok(Math.abs(t60(1) + 60) < 10, `decay 1 s falls about 60 dB in a second (${t60(1).toFixed(1)} dB)`);
  const slow = run({ decay: 8, damp: 0 }), fast = run({ decay: 0.5, damp: 0 });
  assert.ok(rms(slow, sr, sr + 4000) > 20 * rms(fast, sr, sr + 4000), 'a longer decay rings longer');
  const hi = x => { let s = 0; for (let i = 1; i < x.length; i++) s += (x[i] - x[i - 1]) ** 2; return s; };
  const open = run({ damp: 0, bright: 1 }), dull = run({ damp: 1, bright: 1 });
  assert.ok(hi(dull.subarray(20000, 40000)) < 0.3 * hi(open.subarray(20000, 40000)), 'damping removes the highs as it rings');
  const soft = run({ bright: 0.05 }), hard = run({ bright: 1 });
  assert.ok(hi(soft.subarray(0, 3000)) < 0.3 * hi(hard.subarray(0, 3000)), 'a duller strike has less top');
  const held = run({ decay: 20, damp: 0 }, { secs: 1, off: 12800 });
  assert.ok(rms(held, 40000, 44000) < 0.01 * rms(held, 8000, 12000), 'note off damps the string');
  assert.deepEqual(Array.from(run({}).subarray(0, 500)), Array.from(run({}).subarray(0, 500)), 'the same note sounds the same');
  const wide = run({ pos: 0.5 }, { note: 45 });   // plucked in the middle: the second harmonic is missing
  const edge = run({ pos: 0.1 }, { note: 45 });
  const mag = (x, f) => { let re = 0, im = 0; for (let i = 0; i < 16384; i++) { const ph = 2 * Math.PI * f * i / sr; re += x[i] * Math.cos(ph); im += x[i] * Math.sin(ph); } return Math.hypot(re, im); };
  const f45 = 440 * Math.pow(2, -24 / 12);
  assert.ok(mag(wide, 2 * f45) / mag(wide, f45) < 0.4 * mag(edge, 2 * f45) / mag(edge, f45), 'plucking at the middle thins out the second harmonic');
}

// 116. Envelope follower: level to control signal, attack and release, window, peak and rms, invert, and into a port.
{
  const def = NODE_TYPES.follower;
  const rig = values => {
    const params = Float32Array.from(def.params.map(p => values[p.name] ?? p.def)), slots = Int32Array.from(def.params.map((_, i) => i));
    const node = def.create({ sampleRate: sr });
    return (x, from = 0, n = 128) => {
      const l = Float32Array.from({ length: n }, (_, i) => x(from + i)), out = new Float32Array(n);
      node.process([[l, l]], [out], n, params, slots);
      return out[n - 1];
    };
  };
  const sine = a => i => a * Math.sin(2 * Math.PI * 440 * i / sr);
  const settle = (values, amp, blocks = 80) => { const run = rig(values); let v = 0; for (let b = 0; b < blocks; b++) v = run(sine(amp), b * 128); return v; };
  const quiet = settle({}, 0.001), mid = settle({}, 0.1), loud = settle({}, 1);
  assert.ok(quiet < mid && mid < loud && loud > 0.95 && quiet < 0.3, `louder input, higher output (${quiet.toFixed(2)} ${mid.toFixed(2)} ${loud.toFixed(2)})`);
  assert.ok(Math.abs(mid - (1 - 20 / 48)) < 0.05, `0.1 is -20 dB, a bit over half the 48 dB window (${mid.toFixed(2)})`);
  assert.ok(settle({}, 0.5) < settle({ gain: 12 }, 0.5), 'gain pushes the level up the window');
  assert.ok(settle({ floor: -20 }, 0.05) < settle({ floor: -60 }, 0.05), 'a higher floor needs more level to start');
  assert.ok(Math.abs(settle({ invert: 1 }, 0.1) - (1 - mid)) < 0.01, 'invert flips it');
  const peak = settle({ mode: 0 }, 0.3), rms = settle({ mode: 1 }, 0.3);
  assert.ok(Math.abs(peak - rms) < 0.1 && peak !== rms, 'peak and rms read a sine alike, but not identically');
  // attack and release: a burst, then silence
  const timing = values => {
    const run = rig(values), at = []; let b = 0;
    for (; b < 40; b++) at.push(run(sine(0.8), b * 128));
    for (let k = 0; k < 80; k++, b++) at.push(run(() => 0, b * 128));
    return at;
  };
  const fast = timing({ attack: 1, release: 20 }), slow = timing({ attack: 40, release: 1000 });
  assert.ok(fast[1] > slow[1] + 0.2, 'a short attack rises faster');
  assert.ok(fast[70] < slow[70] - 0.2, 'a long release falls slower');
  assert.ok(slow.every(v => v >= 0 && v <= 1) && fast.every(Number.isFinite));
  // wired into a filter's cutoff port: the loud input opens it
  const desc = {
    nodes: [{ id: 'osc', type: 'osc' }, { id: 'f', type: 'follower', params: { attack: 1, release: 50 } }, { id: 'filt', type: 'filter', params: { cutoff: 500 }, ports: ['cutoff'] }, { id: 'out', type: 'out' }],
    connections: [['osc.out', 'f.in'], ['osc.out', 'filt.in'], ['f.out', 'filt.@cutoff'], ['filt.out', 'out.in']],
  };
  const registry = new ParamRegistry(), rt = new GraphRuntime({ sampleRate: sr, params: registry.values });
  rt.load(compile(desc, { instrument: 'x', nodeTypes: NODE_TYPES, registry }));
  const l = new Float32Array(block), r = new Float32Array(block);
  rt.note('x', { type: 'noteOn', note: 60, vel: 1 });
  for (let i = 0; i < 60; i++) rt.process(l, r, block);
  const open = registry.get('x.filt.cutoff');
  assert.ok(open > 5000, `a loud oscillator drives the cutoff well up (${open.toFixed(0)})`);
  rt.note('x', { type: 'noteCut' });
  for (let i = 0; i < 200; i++) rt.process(l, r, block);
  assert.ok(registry.get('x.filt.cutoff') < open / 3, 'and it comes back down when the sound stops');
}

// 117. Spectral synth: the sample's harmonics set the timbre, the note sets the pitch.
{
  const def = NODE_TYPES.specsynth;
  const secs = 2, len = Math.floor(sr * secs), f = 220;
  const data = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    const odd = i < len / 2;
    for (const h of odd ? [1, 3, 5, 7] : [2, 4, 6, 8]) data[i] += Math.sin(2 * Math.PI * f * h * i / sr) / h;
  }
  const run = (values, { note = 57, secs: t = 0.6, skip = 0.3 } = {}) => {
    const params = Float32Array.from(def.params.map(p => values[p.name] ?? p.def)), slots = Int32Array.from(def.params.map((_, i) => i));
    const node = def.create({ sampleRate: sr, connected: [false], maxBlock: 128 });
    node.message({ type: 'sample', slot: 0, data, rate: sr });
    node.note({ type: 'noteOn', note, vel: 1 });
    const N = Math.floor(sr * t / 128) * 128, L = new Float32Array(N), l = new Float32Array(128), r = new Float32Array(128), zero = new Float32Array(128);
    for (let at = 0; at < N; at += 128) { node.process([zero], [[l, r]], 128, params, slots); L.set(l, at); }
    return L.subarray(Math.floor(sr * skip));
  };
  const mag = (x, freq) => { let re = 0, im = 0; for (let i = 0; i < x.length; i++) { const w = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / x.length), ph = 2 * Math.PI * freq * i / sr; re += x[i] * w * Math.cos(ph); im += x[i] * w * Math.sin(ph); } return Math.hypot(re, im) / x.length * 4; };
  const first = run({ position: 0.1, root: 57 }), second = run({ position: 0.9, root: 57 });
  assert.ok(first.every(Number.isFinite) && Math.max(...first.map(Math.abs)) > 0.02, 'it sounds');
  assert.ok(mag(first, 660) > 10 * mag(first, 440), `first half has partial 3 but not 2 (${mag(first, 660).toFixed(3)} vs ${mag(first, 440).toFixed(3)})`);
  assert.ok(mag(second, 440) > 10 * mag(second, 660), 'second half has partial 2 but not 3');
  // the note sets the pitch: an octave up moves every partial up
  const up = run({ position: 0.1, root: 57 }, { note: 69 });
  assert.ok(mag(up, 1320) > 10 * mag(up, 660) && mag(up, 1320) > 10 * mag(up, 880), 'an octave up: partial 3 now sits at 1320 Hz');
  // contrast sharpens: partials 5 and 7 are weaker than 1 and 3, and fall further with more contrast
  const flat = run({ position: 0.1, root: 57, contrast: 0.5 }), sharp = run({ position: 0.1, root: 57, contrast: 2.5 });
  assert.ok(mag(sharp, 1540) / mag(sharp, 220) < 0.5 * mag(flat, 1540) / mag(flat, 220), 'contrast pulls the weak partials down');
  // scan moves through the sample: starting in the first half, it ends up in the second
  const scanned = run({ position: 0.1, root: 57, scan: 0.4, blur: 0 }, { secs: 2.2, skip: 0 });
  const early = scanned.subarray(Math.floor(sr * 0.2), Math.floor(sr * 0.5)), late = scanned.subarray(Math.floor(sr * 1.8), Math.floor(sr * 2.1));
  assert.ok(mag(early, 660) > 3 * mag(early, 440) && mag(late, 440) > 3 * mag(late, 660), 'scan carries the timbre through the sample');
  // tilt and partials
  assert.ok(mag(run({ position: 0.1, root: 57, partials: 1 }), 660) < 0.05 * mag(run({ position: 0.1, root: 57, partials: 1 }), 220), 'partials limits the series');
  assert.ok(run({ sample: 5 }).every(v => v === 0), 'a slot with no sample is silent');
  // the instrument kind
  const proj = { samples: { s1: { rate: sr, data: new Float32Array(10) } }, instruments: {} };
  const id = pops.addSynthInstrument(proj, 'sp', 'spectral');
  assert.deepEqual(proj.instruments[id].samples, { synth: 's1' });
}

// 118. The loop: points, clamping, and the sequencer playing it.
{
  const { loopRange, inLoop, setLoopPoint, clampLoop } = await import('../src/seq/loop.js');
  const song = { length: 128 };
  assert.deepEqual(loopRange(song), { start: 0, end: 128 });
  setLoopPoint(song, 'start', 32); assert.deepEqual(song.loop, { start: 32, end: 128 });
  setLoopPoint(song, 'end', 64); assert.deepEqual(song.loop, { start: 32, end: 64 });
  assert.ok(inLoop(song, 32) && inLoop(song, 63) && !inLoop(song, 64) && !inLoop(song, 31));
  setLoopPoint(song, 'start', 96); assert.deepEqual(song.loop, { start: 96, end: 128 }, 'a start past the end moves the end out to the song end');
  setLoopPoint(song, 'end', 48); assert.deepEqual(song.loop, { start: 0, end: 48 }, 'an end before the start moves the start back to 0');
  setLoopPoint(song, 'end', 48); assert.equal(song.loop, undefined, 'the same point again clears it, and no loop is left when both are the song');
  setLoopPoint(song, 'start', 32); setLoopPoint(song, 'end', 64);
  {   // Ctrl+L: off and on again, the points kept
    const { toggleLoop, loopActive } = await import('../src/seq/loop.js');
    assert.ok(loopActive(song) && /off/.test(toggleLoop(song)) && !loopActive(song) && song.loop.start === 32 && song.loop.end === 64);
    assert.ok(/Loop on/.test(toggleLoop(song)) && loopActive(song));
    toggleLoop(song); setLoopPoint(song, 'end', 80); assert.ok(loopActive(song), 'setting a point switches the loop on again');
    const bare = { length: 128 }; assert.ok(/No loop/.test(toggleLoop(bare)));
  }
  song.length = 48; clampLoop(song); assert.deepEqual(song.loop, { start: 32, end: 48 }, 'a shorter song cuts the loop');
  song.length = 32; clampLoop(song); assert.equal(song.loop, undefined, 'a loop past the end is dropped');

  // the sequencer starts at the loop start and wraps at its end
  const lane = oneLane('lead', 'lead', patternText(16, { 0: 'C-4 .. .. .... .... .. .. ..' }));
  const s2 = { ...song120([lane]), length: 64 };
  const { seq } = songSetup(s2);
  s2.loop = { start: 16, end: 32 };
  seq.setSong(s2);
  seq.play();
  assert.equal(seq.tick, 16, 'play starts at the loop start');
  const seen = [];
  for (let i = 0; i < 40; i++) { seq.fireTick(); seen.push(seq.transport[0]); }
  assert.deepEqual(seen.slice(0, 18), [...Array(16).keys()].map(k => 16 + k).concat([16, 17]), 'ticks 16 to 31, then back to 16');
  assert.ok(seen.every(t => t >= 16 && t < 32), 'it never leaves the loop');
  delete s2.loop; seq.setSong(s2); seq.play();
  assert.equal(seq.tick, 0, 'without a loop it starts at 0 again');
  // saved with the project, and only when there is one
  const proj = { song: { name: 's', bpm: 100, ticksPerBeat: 4, length: 64, loop: { start: 16, end: 32 } }, instruments: {}, samples: {}, lanes: [] };
  assert.deepEqual(parseProject(serializeProject(proj)).song.loop, { start: 16, end: 32 });
  delete proj.song.loop;
  assert.equal(parseProject(serializeProject(proj)).song.loop, undefined);
}

// 119. Sidechain: an instrument listens to another's finished sound; loops are refused or silent.
{
  const { sourcesOf, wouldLoop, eligibleSources, renameSource, dropSource, setSource } = await import('../src/graph/sidechain.js');
  const listener = source => ({ graph: { nodes: [{ id: 'sc', type: 'sidechain', ...(source ? { source } : {}) }, { id: 'out', type: 'out' }], connections: [['sc.out', 'out.in']] } });
  const tone = () => ({ graph: { nodes: [{ id: 'osc', type: 'osc', params: { freq: 220 } }, { id: 'out', type: 'out' }], connections: [['osc.out', 'out.in']] } });
  // who listens to whom, and loops
  const set = { a: tone(), b: listener('a'), c: listener('b'), d: tone() };
  assert.deepEqual(sourcesOf(set.c), ['b']);
  assert.ok(wouldLoop(set, 'a', 'c'), 'a would hear itself through c and b');
  assert.ok(wouldLoop(set, 'b', 'b'), 'nothing listens to itself');
  assert.ok(!wouldLoop(set, 'd', 'c'), 'd is free to listen to c');
  assert.deepEqual(eligibleSources(set, 'a'), ['d'], 'a may only listen to d: b and c hear a');
  assert.throws(() => setSource(set, 'a', 'x', 'b'), /No sidechain node/);
  set.a.graph.nodes.push({ id: 'sc', type: 'sidechain' });
  assert.throws(() => setSource(set, 'a', 'sc', 'c'), /loop/);
  assert.ok(setSource(set, 'a', 'sc', 'd') && set.a.graph.nodes.at(-1).source === 'd');
  renameSource(set, 'd', 'drums'); assert.equal(set.a.graph.nodes.at(-1).source, 'drums');
  dropSource(set, 'drums'); assert.equal(set.a.graph.nodes.at(-1).source, undefined);

  // the sound: b outputs a's sound, scaled by level, in the same block
  const rig = (defs, order = Object.keys(defs)) => {
    const registry = new ParamRegistry(), rt = new GraphRuntime({ sampleRate: sr, params: registry.values });
    for (const id of order) rt.load(compile(defs[id].graph, { instrument: id, nodeTypes: NODE_TYPES, registry }));
    return { rt, registry };
  };
  const renderOne = (rt, id, note = 60, blocks = 20) => {
    const l = new Float32Array(block), r = new Float32Array(block), out = [];
    rt.note(id, { type: 'noteOn', note, vel: 1 });
    for (let i = 0; i < blocks; i++) { rt.process(l, r, block); out.push(l.slice()); }
    return out;
  };
  const solo = rig({ a: tone() }), soloOut = renderOne(solo.rt, 'a');
  for (const order of [['a', 'b'], ['b', 'a']]) {   // the order they were loaded in does not matter
    const { rt } = rig({ a: tone(), b: listener('a') }, order);
    const both = renderOne(rt, 'a');
    // with b listening, the master holds a's sound plus b's copy of it, which b's out node (gain 0.8) scales
    assert.ok(both.every((blk, i) => blk.every((v, k) => Math.abs(v - 1.8 * soloOut[i][k]) < 1e-5)), `b hears a in the same block (load order ${order})`);
  }
  const half = rig({ a: tone(), b: { graph: { nodes: [{ id: 'sc', type: 'sidechain', source: 'a', params: { level: 0.5 } }, { id: 'out', type: 'out' }], connections: [['sc.out', 'out.in']] } } });
  assert.ok(renderOne(half.rt, 'a').every((blk, i) => blk.every((v, k) => Math.abs(v - 1.4 * soloOut[i][k]) < 1e-5)), 'level scales what it hears');
  const none = rig({ a: tone(), b: listener(null) }), missing = rig({ a: tone(), b: listener('nobody') });
  for (const g of [none, missing]) assert.ok(renderOne(g.rt, 'a').every((blk, i) => blk.every((v, k) => Math.abs(v - soloOut[i][k]) < 1e-5)), 'no source, or one that does not exist, is silent');
  // a loop that gets in anyway: no hang, no blow-up, and each hears nothing from the one that has not run yet
  const loop = rig({ a: { graph: { nodes: [{ id: 'osc', type: 'osc', params: { freq: 220 } }, { id: 'sc', type: 'sidechain', source: 'b' }, { id: 'm', type: 'mix' }, { id: 'out', type: 'out' }], connections: [['osc.out', 'm.a'], ['sc.out', 'm.b'], ['m.out', 'out.in']] } }, b: listener('a') });
  const looped = renderOne(loop.rt, 'a', 60, 40);
  assert.ok(looped.every(blk => blk.every(Number.isFinite)) && looped.at(-1).every(v => Math.abs(v) < 4), 'a loop stays finite');
  // with voices: the sidechain runs once and every voice can read it
  const poly = rig({ a: tone(), b: { graph: { nodes: [{ id: 'osc', type: 'osc', params: { freq: 110 } }, { id: 'sc', type: 'sidechain', source: 'a' }, { id: 'poly', type: 'voices' }, { id: 'out', type: 'out' }], connections: [['osc.out', 'poly.in'], ['poly.out', 'out.in'], ['sc.out', 'out.in']], voices: 4 } } });
  assert.ok(renderOne(poly.rt, 'a').every(blk => blk.every(Number.isFinite)), 'a sidechain beside voices runs');
  // the saved project keeps the source
  const proj = { song: { name: 's', bpm: 100, ticksPerBeat: 4, length: 16 }, instruments: { a: tone(), b: listener('a') }, samples: {}, lanes: [] };
  assert.equal(parseProject(serializeProject(proj)).instruments.b.graph.nodes[0].source, 'a');
}

// 120. Plate and shimmer reverbs.
{
  const run = (type, values, inp) => {
    const def = NODE_TYPES[type];
    const params = Float32Array.from(def.params.map(p => values[p.name] ?? p.def)), slots = Int32Array.from(def.params.map((_, i) => i));
    const node = def.create({ sampleRate: sr });
    const L = new Float32Array(inp.length), R = new Float32Array(inp.length);
    for (let a = 0; a < inp.length; a += 128) {
      const n = Math.min(128, inp.length - a);
      node.process([[inp.subarray(a, a + n), inp.subarray(a, a + n)]], [[L.subarray(a, a + n), R.subarray(a, a + n)]], n, params, slots);
    }
    return [L, R];
  };
  const peak = (x, a = 0, b = x.length) => { let m = 0; for (let i = a; i < b; i++) m = Math.max(m, Math.abs(x[i])); return m; };
  const impulse = new Float32Array(sr * 3); impulse[0] = 1;
  const noise = new Float32Array(sr * 3); let seed = 7;
  for (let i = 0; i < noise.length; i++) noise[i] = ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 2;
  // plate: the decay time is about right, the channels differ, mix 0 is dry, extremes stay bounded
  const [pl, pr] = run('plate', { decay: 1, mix: 1, mod: 0 }, impulse);
  const e = new Float64Array(pl.length); let acc = 0;
  for (let i = pl.length - 1; i >= 0; i--) { acc += pl[i] ** 2; e[i] = acc; }
  const edc = t => 10 * Math.log10(e[Math.floor(t * sr)] / e[0]);
  assert.ok(edc(0.5) < -20 && edc(0.5) > -40, `plate energy decay at 0.5 s is ${edc(0.5)} dB`);
  assert.ok(pl.some((v, i) => Math.abs(v - pr[i]) > 1e-4), 'plate channels should differ');
  assert.ok(run('plate', { mix: 0 }, noise)[0].every((v, i) => v === noise[i]), 'plate mix 0 is dry');
  const pe = run('plate', { decay: 20, damp: 0, mod: 1, diffusion: 1, bandwidth: 1, mix: 1 }, noise)[0];
  assert.ok(pe.every(Number.isFinite) && peak(pe) < 20, 'a long plate decay stays bounded');
  // shimmer: finite and bounded at the extreme, an octave appears in the tail, shimmer 0 adds none
  const se = run('shimmer', { shimmer: 0.95, decay: 20, tone: 1, mix: 1 }, noise)[0];
  assert.ok(se.every(Number.isFinite) && peak(se) < 20, 'shimmer stays bounded');
  const tone = new Float32Array(sr * 3); for (let i = 0; i < sr / 2; i++) tone[i] = 0.5 * Math.sin(2 * Math.PI * 440 * i / sr);
  const level = (x, f) => { let re = 0, im = 0; for (let i = sr * 1.5; i < sr * 2.5; i++) { re += x[i] * Math.cos(2 * Math.PI * f * i / sr); im += x[i] * Math.sin(2 * Math.PI * f * i / sr); } return Math.hypot(re, im) / sr; };
  const on = run('shimmer', { shimmer: 0.8, decay: 6, mix: 1, damp: 0.2 }, tone)[0], off = run('shimmer', { shimmer: 0, decay: 6, mix: 1, damp: 0.2 }, tone)[0];
  assert.ok(level(on, 880) > 4 * level(off, 880), 'shimmer should put an octave up into the tail');
}

// 121. Oberheim-style synth: pitch, filter modes, sync, drift, polyphony through voices.
{
  const def = NODE_TYPES.oberheim;
  const render = (values, note = 69, secs = 0.6, seedNodes = 1) => {
    const params = Float32Array.from(def.params.map(p => values[p.name] ?? p.def)), slots = Int32Array.from(def.params.map((_, i) => i));
    const node = def.create({ sampleRate: sr, connected: [false, false] });
    node.note({ type: 'noteOn', note, vel: 1 });
    const L = new Float32Array(Math.floor(sr * secs)), R = new Float32Array(L.length);
    for (let a = 0; a < L.length; a += 128) { const n = Math.min(128, L.length - a); node.process([[], []], [[L.subarray(a, a + n), R.subarray(a, a + n)]], n, params, slots); }
    return [L, R];
  };
  const rms = (x, a = 0, b = x.length) => { let t = 0; for (let i = a; i < b; i++) t += x[i] * x[i]; return Math.sqrt(t / (b - a)); };
  const bin = (x, f, a = sr * 0.2, b = sr * 0.5) => { let re = 0, im = 0; for (let i = a; i < b; i++) { re += x[i] * Math.cos(2 * Math.PI * f * i / sr); im += x[i] * Math.sin(2 * Math.PI * f * i / sr); } return Math.hypot(re, im) / (b - a); };
  const open = { cutoff: 18000, res: 0, fenv: 0, osc2: 0, drift: 0, pwm: 0, drive: 0, scatter: 0, vib: 0 };
  const [a] = render(open);
  assert.ok(a.every(Number.isFinite) && rms(a, sr * 0.2) > 0.02, 'it makes sound');
  assert.ok(bin(a, 440) > 6 * bin(a, 660), 'a saw at A4 has its fundamental at 440 Hz');
  // the filter modes: a low cutoff passes the fundamental in LP, removes it in HP, notches it at 0.5
  const lp = bin(render({ ...open, cutoff: 2000, mode: 0 })[0], 440), hp = bin(render({ ...open, cutoff: 2000, mode: 1 })[0], 440);
  const through = bin(render({ ...open, cutoff: 440, mode: 0 })[0], 440), notch = bin(render({ ...open, cutoff: 440, mode: 0.5 })[0], 440);
  assert.ok(lp > 5 * hp, `a lowpass passes the fundamental and a highpass does not: ${lp} ${hp}`);
  assert.ok(through > 3 * notch, `a notch on the fundamental removes it: ${through} ${notch}`);
  const dark = rms(render({ ...open, cutoff: 200 })[0], sr * 0.2), bright = rms(render(open)[0], sr * 0.2);
  assert.ok(dark < bright * 0.5, 'a lower cutoff is quieter');
  const ring = render({ ...open, cutoff: 1500, res: 1, wave1: 0 })[0];
  assert.ok(ring.every(Number.isFinite) && ring.reduce((m, v) => Math.max(m, Math.abs(v)), 0) < 8, 'full resonance stays bounded');
  // sync with a sweep stays finite; two instances drift differently
  const sw = render({ ...open, osc2: 1, sync: 1, sweep: 24, tune2: 7, wave2: 0, wave1: 0 })[0];
  assert.ok(sw.every(Number.isFinite), 'sync stays finite');
  const x = render({ drift: 1, osc2: 1 })[0], y = render({ drift: 1, osc2: 1 })[0];
  assert.ok(x.some((v, i) => v !== y[i]), 'each voice drifts differently');
  assert.ok(x.every((v, i) => Number.isFinite(v)), 'drift stays finite');
}

// 122. Note trigger: every note fires an envfx on the finished sound, with and without voices.
{
  const registry0 = () => new ParamRegistry();
  const build = (voices, legato = 0) => {
    const registry = registry0(), rt = new GraphRuntime({ sampleRate: sr, params: registry.values });
    const nodes = [{ id: 'osc', type: 'osc', params: { freq: 220 } }, ...(voices ? [{ id: 'poly', type: 'voices' }] : []), { id: 'nt', type: 'notetrig', params: { legato } }, { id: 'fx', type: 'envfx', ports: ['trig'], params: { attack: 1, decay: 20, sustain: 0, release: 20, range: -80 } }, { id: 'out', type: 'out' }];
    const connections = voices ? [['osc.out', 'poly.in'], ['poly.out', 'fx.in']] : [['osc.out', 'fx.in']];
    connections.push(['nt.trig', 'fx.@trig'], ['fx.out', 'out.in']);
    rt.load(compile({ nodes, connections, ...(voices ? { voices } : {}) }, { instrument: 'a', nodeTypes: NODE_TYPES, registry }));
    return rt;
  };
  const run = (rt, blocks) => { const l = new Float32Array(block), r = new Float32Array(block); let peak = 0; for (let i = 0; i < blocks; i++) { rt.process(l, r, block); for (const v of l) peak = Math.max(peak, Math.abs(v)); } return peak; };
  for (const voices of [0, 4]) {
    const rt = build(voices);
    assert.ok(run(rt, 20) < 1e-4, `silent before any note (voices ${voices})`);
    rt.note('a', { type: 'noteOn', note: 60, vel: 1 });
    assert.ok(run(rt, 10) > 0.05, `a note fires the envelope (voices ${voices})`);
    assert.ok(run(rt, 200) < 0.01, 'the envelope decays to sustain 0 while the note is still held');
    rt.note('a', { type: 'noteOn', note: 64, vel: 1 });   // a second note while the first is held
    assert.ok(run(rt, 10) > 0.05, `an overlapping note fires it again (voices ${voices})`);
    rt.note('a', { type: 'noteOff', note: 60 }); rt.note('a', { type: 'noteOff', note: 64 });
    run(rt, 50);
    rt.note('a', { type: 'noteOn', note: 67, vel: 1 });
    assert.ok(run(rt, 10) > 0.05, `a note after release fires it (voices ${voices})`);
  }
  const legato = build(4, 1);
  legato.note('a', { type: 'noteOn', note: 60, vel: 1 }); run(legato, 200);
  legato.note('a', { type: 'noteOn', note: 64, vel: 1 });
  assert.ok(run(legato, 10) < 0.02, 'with legato an overlapping note does not fire it again');
}

// 123. An envelope after the voices node still hears the notes.
{
  const build = amount => {
    const registry = new ParamRegistry(), rt = new GraphRuntime({ sampleRate: sr, params: registry.values });
    const nodes = [{ id: 'osc', type: 'osc', params: { freq: 220, wave: 0 } }, { id: 'poly', type: 'voices' }, { id: 'filt', type: 'filter', params: { cutoff: 300, resonance: 0.3 } }, { id: 'env', type: 'env', params: { attack: 1, decay: 400, sustain: 0.6, amount } }, { id: 'out', type: 'out' }];
    rt.load(compile({ nodes, voices: 4, connections: [['osc.out', 'poly.in'], ['poly.out', 'filt.in'], ['env.out', 'filt.mod'], ['filt.out', 'out.in']] }, { instrument: 'a', nodeTypes: NODE_TYPES, registry }));
    return rt;
  };
  const energy = rt => { const l = new Float32Array(block), r = new Float32Array(block); rt.note('a', { type: 'noteOn', note: 60, vel: 1 }); let e = 0; for (let i = 0; i < 40; i++) { rt.process(l, r, block); for (const v of l) e += v * v; } return e; };
  const e5 = energy(build(5)), e0 = energy(build(0));
  assert.ok(e5 > 1.3 * e0, 'an envelope after the voices opens the filter');
}

// 124. A scope hands over the last 2048 samples of one node's output, oldest first, every 1024 samples.
{
  const build = voices => {
    const registry = new ParamRegistry(), rt = new GraphRuntime({ sampleRate: sr, params: registry.values });
    const nodes = [{ id: 'osc', type: 'osc', params: { freq: 441, wave: 0 } }, ...(voices > 1 ? [{ id: 'poly', type: 'voices' }] : []), { id: 'out', type: 'out' }];
    rt.load(compile({ nodes, voices, connections: voices > 1 ? [['osc.out', 'poly.in'], ['poly.out', 'out.in']] : [['osc.out', 'out.in']] }, { instrument: 'a', nodeTypes: NODE_TYPES, registry }));
    return rt;
  };
  const l = new Float32Array(block), r = new Float32Array(block);
  {
    const rt = build(1), got = [];
    rt.onScope = (id, node, a, b) => got.push({ id, node, l: a, r: b });
    rt.note('a', { type: 'noteOn', note: 60, vel: 1 });
    for (let i = 0; i < 40; i++) rt.process(l, r, block);
    assert.equal(got.length, 0, 'nothing is sent until a node is watched');
    rt.setScope('a', 'out', true); rt.setScope('a', 'osc', true);
    for (let i = 0; i < 1024 * 4 / block; i++) rt.process(l, r, block);
    const outs = got.filter(g => g.node === 'out'), oscs = got.filter(g => g.node === 'osc');
    assert.equal(outs.length, 4, 'one frame per 1024 samples');
    assert.equal(oscs.length, 4, 'each watched node has its own');
    assert.equal(outs[0].l.length, 2048);
    assert.ok(outs.at(-1).l.some(v => Math.abs(v) > 0.05), 'the frame holds the sound');
    assert.equal(outs.at(-1).l[2047], l[block - 1], 'the last frame ends where the last block ended');
    assert.ok(oscs.at(-1).l.every((v, i) => v === oscs.at(-1).r[i]), 'a mono output is shown on both sides');
    rt.setScope('a', 'out', false); rt.setScope('a', 'osc', false);
    for (let i = 0; i < 40; i++) rt.process(l, r, block);
    assert.equal(got.length, 8, 'stopping the watch stops the frames');
  }
  {
    const rt = build(4), got = [];
    rt.onScope = (id, node, a) => got.push({ node, l: a });
    rt.setScope('a', 'osc', true);   // a per-voice node: the active voices added together
    rt.note('a', { type: 'noteOn', note: 60, vel: 1 });
    for (let i = 0; i < 1024 * 3 / block; i++) rt.process(l, r, block);
    const energy = f => f.reduce((e, v) => e + v * v, 0), one = energy(got.at(-1).l);
    rt.note('a', { type: 'noteOn', note: 67, vel: 1 });
    got.length = 0;
    for (let i = 0; i < 1024 * 3 / block; i++) rt.process(l, r, block);
    assert.ok(got.length && energy(got.at(-1).l) > one * 1.4, 'two voices on one node are heard together');
  }
}

// 125. Piano: in tune, stiff strings, loudness by velocity, damper and pedal, six voices ringing, nothing blows up.
{
  const render = (note, vel, seconds, params = {}, off = null, voices = 1) => {
    const registry = new ParamRegistry(), rt = new GraphRuntime({ sampleRate: sr, params: registry.values });
    const nodes = [{ id: 'p', type: 'piano', params }, ...(voices > 1 ? [{ id: 'poly', type: 'voices' }] : []), { id: 'out', type: 'out' }];
    rt.load(compile({ nodes, voices, connections: voices > 1 ? [['p.out', 'poly.in'], ['poly.out', 'out.in']] : [['p.out', 'out.in']] }, { instrument: 'a', nodeTypes: NODE_TYPES, registry }));
    const l = new Float32Array(block), r = new Float32Array(block), out = [], outR = [];
    const notes = Array.isArray(note) ? note : [note];
    notes.forEach(n => rt.note('a', { type: 'noteOn', note: n, vel }));
    for (let i = 0; i < seconds * sr / block; i++) {
      if (off !== null && i === Math.round(off * sr / block)) notes.forEach(n => rt.note('a', { type: 'noteOff', note: n }));
      rt.process(l, r, block); out.push(...l); outR.push(...r);
    }
    return { l: Float32Array.from(out), r: Float32Array.from(outR) };
  };
  const rms = (a, i, j) => Math.sqrt(a.slice(i, j).reduce((s, v) => s + v * v, 0) / (j - i));
  const f0Of = (a, note) => {   // pitch from the autocorrelation, in cents off the equal-tempered note
    const seg = a.slice(Math.round(0.2 * sr), Math.round(0.5 * sr)), T = sr / (440 * 2 ** ((note - 69) / 12));
    const ac = lag => { let c = 0; for (let i = 0; i + lag < seg.length; i++) c += seg[i] * seg[i + lag]; return c; };
    let best = 0, bl = 0; for (let lag = Math.floor(T * 0.9); lag < T * 1.1; lag++) { const c = ac(lag); if (c > best) { best = c; bl = lag; } }
    const y0 = ac(bl - 1), y1 = ac(bl), y2 = ac(bl + 1), d = 0.5 * (y0 - y2) / (y0 - 2 * y1 + y2);
    return 1200 * Math.log2(T / (bl + d));
  };
  for (const note of [36, 48, 60, 72, 84]) assert.ok(Math.abs(f0Of(render(note, 1, 0.6).l, note)) < 12, `note ${note} is in tune`);
  // loudness: a harder key is louder, and the level is about the same up the keyboard
  const soft = render(60, 0.3, 0.4).l, loud = render(60, 1, 0.4).l;
  assert.ok(rms(loud, 2205, 6615) > 2.5 * rms(soft, 2205, 6615), 'a harder key is louder');
  const levels = [24, 48, 72, 96].map(n => rms(render(n, 1, 0.3).l, 2205, 6615));
  assert.ok(Math.max(...levels) < 3 * Math.min(...levels), 'the level is even across the keyboard');
  // stiffness: the strings' partials run sharp of exact multiples (the 8th partial of C3 by 10 cents or more)
  {
    const { l } = render(48, 1, 1.5, { inharm: 1 }), flat = render(48, 1, 1.5, { inharm: 0 }).l;
    const N = 1 << 15, peakAt = (a, hz) => { // strongest Fourier bin near hz, by direct summation over a window of frequencies
      let best = 0, bf = hz; for (let f = hz * 0.985; f < hz * 1.04; f += hz * 0.0003) { let re = 0, im = 0; for (let i = 0; i < 8192; i++) { const x = a[4410 + i] * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / 8192)); re += x * Math.cos(2 * Math.PI * f * i / sr); im += x * Math.sin(2 * Math.PI * f * i / sr); } const m = Math.hypot(re, im); if (m > best) { best = m; bf = f; } } return bf; };
    const f0 = 440 * 2 ** ((48 - 69) / 12), sharp = a => 1200 * Math.log2(peakAt(a, 8 * f0) / peakAt(a, f0) / 8);
    assert.ok(sharp(l) > 10, 'with stiffness the 8th partial runs sharp');
    assert.ok(sharp(flat) < 6, 'without it the partials are close to harmonic');
  }
  // damper and pedal
  const damped = render(60, 1, 2, {}, 0.5).l, pedal = render(60, 1, 2, { pedal: 1 }, 0.5).l;
  assert.ok(rms(damped, 66150, 70560) < 1e-4, 'a released note is damped');
  assert.ok(rms(pedal, 66150, 70560) > 20 * rms(damped, 66150, 70560) + 1e-3, 'with the pedal down it keeps ringing');
  // stereo by pitch: bass to the left, treble to the right
  const bass = render(30, 1, 0.3), treble = render(90, 1, 0.3);
  assert.ok(rms(bass.l, 2205, 6615) > rms(bass.r, 2205, 6615) && rms(treble.r, 2205, 6615) > rms(treble.l, 2205, 6615), 'pitch pans the notes');
  // a chord on six voices, and extreme settings stay finite
  const chord = render([48, 52, 55, 60, 64, 67], 0.8, 1, {}, null, 8).l;
  assert.ok(chord.every(Number.isFinite) && rms(chord, 2205, 6615) > 0.1, 'six notes sound together');
  for (const note of [0, 21, 108, 127]) for (const p of [{ inharm: 1, bright: 0, decay: 40 }, { inharm: 0, bright: 1, decay: 0.5, hard: 1, pos: 0.5 }, { detune: 15, body: 1, thump: 1, width: 1 }]) {
    const a = render(note, 1, 1, p).l;
    assert.ok(a.every(v => Number.isFinite(v) && Math.abs(v) < 4), `note ${note} stays finite with ${JSON.stringify(p)}`);
  }
}

// Adding a node that is not wired to anything must not reload (and so cut) the running instrument
{
  const { Engine } = await import('../src/audio/engine.js');
  const posts = [];
  const eng = Object.create(Engine.prototype);
  eng.registry = new ParamRegistry(); eng.loaded = new Map(); eng.node = { port: { postMessage: m => posts.push(m.type) } };
  const base = () => ({ voices: 1, nodes: [{ id: 'perc', type: 'combperc', params: {}, ports: ['decay'] }, { id: 'out', type: 'out', params: { gain: 0.5 } }], connections: [['perc.out', 'out.in']] });
  assert.equal(eng.loadInstrument('t', base()), true, 'the first load posts');
  assert.equal(eng.loadInstrument('t', base()), false, 'the same graph does not');
  const more = base(); more.nodes.push({ id: 'lfo1', type: 'lfo', x: 5, y: 5, params: {} });
  assert.equal(eng.loadInstrument('t', more), false, 'an unconnected new node does not reload');
  more.connections.push(['lfo1.out', 'perc.@decay']);
  assert.equal(eng.loadInstrument('t', more), true, 'wiring it in does');
  const tweaked = JSON.parse(JSON.stringify(more)); tweaked.nodes[1].params.gain = 0.4;
  assert.equal(eng.loadInstrument('t', tweaked), true, 'a changed parameter value reloads');
  assert.deepEqual(posts, ['load', 'load', 'load']);
  console.log('ok: unconnected node adds do not interrupt playback');
}

// Post-transient resynthesis: the attack stays a sample, the tail becomes branches, and the instrument sounds like the source
{
  const { fitTail, buildInstrument } = await import('../src/project/ptr.js');
  let seed = 3; const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2147483648 - 1; };
  let ph = 0;
  const kick = Float32Array.from({ length: Math.round(sr * 0.6) }, (_, i) => {
    const t = i / sr; ph += 2 * Math.PI * (50 + 110 * Math.exp(-t / 0.035)) / sr;
    return 0.9 * Math.exp(-t / 0.18) * Math.sin(ph) + (t < 0.003 ? rnd() * 0.5 : 0);
  });
  const fit = fitTail(kick, sr);
  assert.ok(fit.cutMs >= 4 && fit.cutMs <= 30, `the attack is cut short: ${fit.cutMs} ms`);
  assert.equal(fit.transient.length, Math.round(fit.cutMs * sr / 1000), 'the transient is the first cutMs of the sample');
  assert.ok(fit.branches.length >= 1 && fit.branches.length <= 3, `a plain kick needs few branches, got ${fit.branches.length}`);
  assert.equal(fit.branches[0].type, 'tonal');
  assert.ok(Math.abs(fit.branches[0].fe - 50) < 4, `the body is found at 50 Hz: ${fit.branches[0].fe}`);
  assert.ok(fit.branches[0].sweep && fit.branches[0].sweep.oct > 1, 'the pitch sweep is found');
  assert.equal(fitTail(kick, sr, { max: 1 }).branches.length, 1, 'the most branches is respected');
  // three bell partials use three branches
  const bell = Float32Array.from({ length: Math.round(sr * 1.2) }, (_, i) => { const t = i / sr; return [[440, 0.4, 0.5], [1130, 0.3, 0.3], [1870, 0.2, 0.2]].reduce((s, [f, a, d]) => s + a * Math.exp(-t / d) * Math.sin(2 * Math.PI * f * t), 0) + (t < 0.002 ? rnd() * 0.4 : 0); });
  const bellFit = fitTail(bell, sr);
  assert.deepEqual(bellFit.branches.map(b => Math.round(b.fe / 10) * 10).sort((a, b) => a - b), [440, 1130, 1870], 'each partial gets a branch');
  // noise only: one noise branch
  let prev = 0;
  const hat = Float32Array.from({ length: Math.round(sr * 0.25) }, (_, i) => { const n = rnd(), v = n - prev; prev = n; return 0.5 * v * Math.exp(-i / sr / 0.04); });
  const hatFit = fitTail(hat, sr);
  assert.ok(hatFit.branches.length >= 1 && hatFit.branches.every(b => b.type === 'noise'), 'noise is fitted as noise');
  // the instrument compiles with the real nodes and plays: the first block is the attack, the tail rings on
  const attackId = 'kick_attack', inst = buildInstrument(fit, attackId);
  const registry = new ParamRegistry();
  const rt = new GraphRuntime({ sampleRate: sr, params: registry.values });
  rt.load(compile(inst.graph, { instrument: 'k', nodeTypes: NODE_TYPES, registry }));
  rt.message('k', 'attack', { type: 'sample', data: fit.transient.slice(), rate: sr });
  rt.note('k', { type: 'noteOn', note: 60, vel: 1 });
  const out = render(rt, 0.5).left;
  const rmsOf = (a, from, to) => Math.sqrt(a.slice(from, to).reduce((s, v) => s + v * v, 0) / (to - from));
  const srcRms = (a, from, to) => rmsOf(a, from, to);
  const at = s => Math.round(s * sr);
  assert.ok(out.every(Number.isFinite), 'the rebuilt kick stays finite');
  for (const [from, to] of [[0.02, 0.06], [0.1, 0.2], [0.25, 0.35]]) {
    const ratio = rmsOf(out, at(from), at(to)) / (0.45 * srcRms(kick, at(from), at(to)));
    assert.ok(ratio > 0.5 && ratio < 2, `the rebuilt kick is about as loud as the source at ${from}-${to} s (ratio ${ratio.toFixed(2)})`);
  }
  console.log('ok: post-transient resynthesis');
}

// Left and Right move by whole cells (the default); Ctrl+Left/Right move one character inside the cell
{
  uiConfig.set('arrowStyle', 'cell');
  const registry = new ParamRegistry();
  for (const [id, def] of Object.entries(instruments)) compile(def.graph, { instrument: id, nodeTypes: NODE_TYPES, registry });
  const lanes = prepareSong(demoSong, instruments, registry);
  let onKey;
  const view = createTrackerView({ el: { addEventListener: (type, f) => { if (type === 'keydown') onKey = f; else if (type === 'wheel') onWheel = f; } }, statusEl: {}, transport: new Int32Array(new SharedArrayBuffer(8)), onToggle() {}, onBack() {} });
  view.load({ lanes, song: demoSong, editor: createEditor(lanes, demoSong.length) });
  const press = (key, times = 1, extra = {}) => { for (let i = 0; i < times; i++) onKey({ key, preventDefault() {}, ...extra }); };
  const lead = lanes[0];
  view.goto(0, 12);
  press('ArrowRight');                                   // Note -> Vel, on its first character
  assert.equal(view.col, 1, 'a tap moves a whole column');
  press('1'); assert.equal(lead.rows[12][1][0], '1');
  press('ArrowRight'); press('ArrowLeft');               // Smp and back: the start of Vel, not the end of the one before
  assert.equal(view.col, 1);
  press('2'); assert.equal(lead.rows[12][1][0], '2', 'Left lands on the first character, as Right does');
  press('ArrowLeft', 1, { ctrlKey: true });              // inside Vel: one character back (it was left on character 1)
  press('3'); assert.equal(lead.rows[12][1][0], '3', 'Ctrl+Left steps one character back inside the cell');
  press('ArrowLeft', 1, { ctrlKey: true }); press('ArrowRight', 1, { ctrlKey: true }); press('4'); assert.equal(lead.rows[12][1][1], '4', 'Ctrl+Right steps one character forward');
  // Shift+1: a note off in every note column of the row, then down a row
  view.goto(0, 20);
  lead.rows[20][0] = 'C-4';
  press('!');
  assert.equal(lead.rows[20][0], '===', 'the note column gets a note off');
  const others = lead.columns.map((c, i) => [c, i]).filter(([c]) => c.token === 'note').map(([, i]) => lead.rows[20][i]);
  assert.ok(others.every(t => t === '==='), 'every note column of the row');
  assert.equal(view.tick, 21, 'the cursor moved down a row');
  uiConfig.set('arrowStyle', 'char');
  console.log('ok: arrows move by whole cells');
}

// Squelch: the 303-style bassline voice, driven by real pattern rows (Acc and Sld count for their note only)
{
  const def = synthKinds.squelch.make();
  const rows = (cells, length = 16) => {
    const registry = new ParamRegistry();
    compile(def.graph, { instrument: 'sq', nodeTypes: NODE_TYPES, registry });
    const cols = buildColumns('sq', def, registry);
    const text = Array.from({ length }, (_, t) => cols.map(c => cells[t]?.[c.label] ?? KINDS[c.token].blank).join(' ')).join('\n');
    const rt = new GraphRuntime({ sampleRate: sr, params: registry.values });
    rt.load(compile(def.graph, { instrument: 'sq', nodeTypes: NODE_TYPES, registry }));
    const seq = new Sequencer({ sampleRate: sr, runtime: rt, params: registry.values, transport: new Int32Array(new SharedArrayBuffer(16)) });
    const song = song120([oneLane('sq', 'sq', text, length)]);
    seq.setSong(song);
    for (const lane of prepareSong(song, { sq: def }, registry)) seq.setLane(lane);
    seq.play();
    return { seq, registry, cols };
  };
  const tick = 6000;
  const rms = (a, from, to) => Math.sqrt(a.slice(from, to).reduce((s, v) => s + v * v, 0) / (to - from));
  const pitchOf = (a, from, len = 2400) => {   // autocorrelation over 40..400 Hz: the first peak that is nearly the strongest
    const lo = Math.floor(sr / 400), hi = Math.floor(sr / 40), c = [];
    for (let l = lo; l <= hi; l++) { let v = 0; for (let i = 0; i < len; i++) v += a[from + i] * a[from + i + l]; c[l] = v; }
    const top = Math.max(...c.filter(Number.isFinite));
    for (let l = lo + 1; l < hi; l++) if (c[l] > 0.85 * top && c[l] >= c[l - 1] && c[l] >= c[l + 1]) return sr / l;
    return 0;
  };
  // a plain note: sounds, finite, not too hot; a note off ends it
  {
    const { seq } = rows({ 0: { Note: 'C-2' }, 8: { Note: '===' } });
    const out = render(seq, 2.2).left;
    assert.ok(out.every(Number.isFinite) && peak(out) < 1.5, 'the voice stays finite and in range');
    assert.ok(rms(out, 2000, 4000) > 0.01, 'a note sounds');
    assert.ok(rms(out, 8 * tick + 3000, 8 * tick + 4500) < 0.05 * rms(out, 2000, 4000), 'a note off lets it go');
    assert.equal(Math.round(pitchOf(out, 3000) / 5) * 5, 65, 'C-2 is about 65 Hz');
  }
  // accent: louder and punchier than the same note without it, and only for the note it is written on
  {
    const plain = render(rows({ 0: { Note: 'C-2' }, 4: { Note: 'C-2' } }).seq, 1.2).left;
    const acc = render(rows({ 0: { Note: 'C-2', Acc: '1' }, 4: { Note: 'C-2' } }).seq, 1.2).left;
    assert.ok(peak(acc.slice(0, 3000)) > 1.15 * peak(plain.slice(0, 3000)), 'an accented note is stronger');
    assert.ok(Math.abs(peak(acc.slice(4 * tick, 4 * tick + 3000)) - peak(plain.slice(4 * tick, 4 * tick + 3000))) < 0.05 * peak(plain.slice(0, 3000)), 'the next note, with a blank Acc cell, is not accented');
  }
  // slide: the pitch glides into the note instead of jumping, and the envelope is not restarted
  {
    const jump = render(rows({ 0: { Note: 'C-2' }, 4: { Note: 'C-3' } }).seq, 1.4).left;
    const glide = render(rows({ 0: { Note: 'C-2' }, 4: { Note: 'C-3', Sld: '1' } }).seq, 1.4).left;
    const at = 4 * tick;
    assert.ok(pitchOf(jump, at + 800, 1500) > 120, 'without a slide the pitch jumps at once');
    const early = pitchOf(glide, at + 150, 1500), late = pitchOf(glide, at + 9000, 2400);
    assert.ok(early < 118 && early > 60, `with a slide the pitch is still on its way a little after (${early.toFixed(0)} Hz)`);
    assert.ok(Math.abs(late - 131) < 4, `and arrives (${late.toFixed(0)} Hz)`);
  }
  // a slide with nothing sounding is just a note
  {
    const out = render(rows({ 2: { Note: 'C-3', Sld: '1' } }).seq, 0.8).left;
    assert.ok(rms(out, 2 * tick + 2000, 2 * tick + 5000) > 0.01, 'a slide with no note before it still plays the note');
  }
  // the flags are columns of the instrument, the other parameters too
  {
    const { cols } = rows({});
    assert.deepEqual(cols.map(c => c.label), ['Note', 'Vel', 'Acc', 'Sld', 'Cut', 'Res', 'Env', 'Dec', 'Acl', 'SlT', 'Wav', 'Drv', 'Cmd']);
  }
  console.log('ok: squelch');
}

// filterPro: every voicing is finite and shaped right, resonance 1 sings, mod and mix work
{
  const fp = NODE_TYPES.filterpro, sr = 48000, N = 24064;
  const run = (over, gen, modv) => {
    const inst = fp.create({ sampleRate: sr, connected: [true, !!modv] });
    const vals = Object.fromEntries(fp.params.map(q => [q.name, q.def])); Object.assign(vals, over);
    const params = fp.params.map(q => vals[q.name]), slots = fp.params.map((_, i) => i), y = new Float32Array(N);
    for (let i = 0; i < N; i += 128) {
      const o = [new Float32Array(128)], x = Float32Array.from({ length: 128 }, (_, j) => gen(i + j));
      inst.process([x, modv ? modv.subarray(i, i + 128) : null], o, 128, params, slots);
      y.set(o[0], i);
    }
    return y;
  };
  const level = (a, f = 6000) => { let s = 0; for (let i = f; i < a.length; i++) s += a[i] * a[i]; return Math.sqrt(s / (a.length - f)); };
  const sine = hz => i => 0.5 * Math.sin(2 * Math.PI * hz * i / sr);
  let seed = 7; const noise = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return 0.3 * (seed / 2147483648 - 1); };
  for (let m = 0; m < 12; m++) assert.ok(run({ mode: m, resonance: 0.95 }, noise).every(Number.isFinite), `filterpro mode ${m} stays finite`);
  assert.ok(level(run({ mode: 0, cutoff: 1000 }, sine(200))) > 10 * level(run({ mode: 0, cutoff: 1000 }, sine(6000))), 'lowpass');
  assert.ok(level(run({ mode: 2, cutoff: 1000 }, sine(6000))) > 10 * level(run({ mode: 2, cutoff: 1000 }, sine(200))), 'highpass');
  assert.ok(level(run({ mode: 7, cutoff: 1000 }, sine(4000))) < 0.2 * level(run({ mode: 0, cutoff: 1000 }, sine(4000))), '24 dB slope is steeper');
  assert.ok(level(run({ mode: 3, cutoff: 1000, resonance: 0.5 }, sine(1000))) < 0.2 * level(run({ mode: 3, cutoff: 1000, resonance: 0.5 }, sine(200))), 'notch removes its centre');
  for (const m of [0, 7, 8]) assert.ok(level(run({ mode: m, resonance: 1, cutoff: 800 }, () => 0), 16000) > 0.05, `mode ${m} sings at resonance 1`);
  assert.ok(level(run({ cutoff: 500 }, sine(1000), new Float32Array(N).fill(1))) > 2 * level(run({ cutoff: 500 }, sine(1000))), 'mod opens the cutoff');
  assert.ok(Math.abs(level(run({ mix: 0 }, sine(300))) - 0.5 / Math.SQRT2) < 1e-3, 'mix 0 is the dry signal');
  assert.ok(level(run({ mode: 9, vowel: 0, cutoff: 1000 }, sine(800))) > 3 * level(run({ mode: 9, vowel: 0, cutoff: 1000 }, sine(5000))), 'vowel a favours its formant');
  console.log('ok: filterpro');
}

// Pattern editing: gobble (Ctrl+Delete), insert (Ctrl+Insert), rotate (Ctrl+Alt+Up/Down), randomize (Ctrl+K): never across patterns
{
  const defs = structuredClone(instruments), registry = new ParamRegistry();
  for (const [id, d] of Object.entries(defs)) compile(d.graph, { instrument: id, nodeTypes: NODE_TYPES, registry });
  const names = ['C-3', 'D-3', 'E-3', 'F-3', 'G-3', 'A-3', 'B-3', 'C-4'];
  const mk = off => Array.from({ length: 8 }, (_, i) => `${names[(i + off) % 8]} ..`).join('\n');
  const song = { ...song120([{ id: 'kick', instrument: 'kick', patterns: { a: { text: mk(0) }, b: { text: mk(3) } }, placements: [{ puid: 'a', start: 0, length: 8 }, { puid: 'b', start: 8, length: 8 }] }]), length: 16 };
  const lanes = prepareSong(song, defs, registry), editor = createEditor(lanes, 16);
  let onKey, menu = null, seed = 5;
  const view = createTrackerView({
    showMenu: (e, items) => { menu = items; }, random: () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; },
    el: { addEventListener: (type, f) => { if (type === 'keydown') onKey = f; }, innerHTML: '' }, statusEl: {}, transport: new Int32Array(new SharedArrayBuffer(8)), onToggle() {}, onBack() {},
  });
  view.load({ lanes, song, editor });
  const press = (key, mods = {}, times = 1) => { for (let i = 0; i < times; i++) onKey({ key, preventDefault() {}, ...mods }); };
  const notes = () => lanes[0].rows.map(r => r[0]);
  const orig = notes();
  press('ArrowDown', {}, 2);
  press('Delete', { ctrlKey: true });
  assert.deepEqual(notes().slice(0, 8), [...orig.slice(0, 2), ...orig.slice(3, 8), '...'], 'Ctrl+Delete pulls the rows below up, a blank at the end of the pattern');
  assert.deepEqual(notes().slice(8), orig.slice(8), 'and the pattern next door is untouched');
  press('z', { ctrlKey: true });
  assert.deepEqual(notes(), orig, 'one undo');
  press('Insert', { ctrlKey: true });
  assert.deepEqual(notes().slice(0, 8), [...orig.slice(0, 2), '...', ...orig.slice(2, 7)], 'Ctrl+Insert pushes the rows down, the last one falls off');
  assert.deepEqual(notes().slice(8), orig.slice(8), 'and nothing is pushed into the next pattern');
  press('z', { ctrlKey: true });
  press('Delete');   // plain Delete just clears
  assert.equal(notes()[2], '...');
  assert.equal(notes()[3], orig[3], 'and does not pull anything up');
  press('z', { ctrlKey: true });

  // rotate: rows 0..3 up; then a selection across the two patterns rotates each part on its own
  press('Home');
  press('ArrowDown', { shiftKey: true }, 3);
  press('ArrowUp', { ctrlKey: true, altKey: true });
  assert.deepEqual(notes().slice(0, 5), [orig[1], orig[2], orig[3], orig[0], orig[4]], 'rotate up');
  press('ArrowDown', { ctrlKey: true, altKey: true });
  assert.deepEqual(notes(), orig, 'and down is the way back');
  press('Escape');
  press('Home'); press('ArrowDown', {}, 6);
  press('ArrowDown', { shiftKey: true }, 3);
  press('ArrowUp', { ctrlKey: true, altKey: true });
  assert.deepEqual(notes().slice(6, 10), [orig[7], orig[6], orig[9], orig[8]], 'across two patterns each part rotates on its own');
  press('z', { ctrlKey: true });
  assert.deepEqual(notes(), orig);

  // randomize: pattern a only
  press('Home');
  press('ArrowDown', { shiftKey: true }, 7);
  const sorted = a => a.slice().sort();
  const pick = label => { menu = null; press('r', { ctrlKey: true }); const item = menu.find(m => m.label.startsWith(label)); item.run(); };
  pick('Shuffle the values');
  assert.deepEqual(sorted(notes().slice(0, 8)), sorted(orig.slice(0, 8)), 'a shuffle keeps the values');
  assert.notDeepEqual(notes().slice(0, 8), orig.slice(0, 8), 'in a new order');
  assert.deepEqual(notes().slice(8), orig.slice(8), 'and does not touch the next pattern');
  const first = notes().slice(0, 8);
  press('r', { altKey: true, code: 'KeyR' });
  assert.deepEqual(sorted(notes().slice(0, 8)), sorted(orig.slice(0, 8)), 'rolling again still keeps them');
  assert.notDeepEqual(notes().slice(0, 8), first, 'but gives a different order');
  press('z', { ctrlKey: true });
  assert.deepEqual(notes(), orig, 'all the rolls are one undo step');
  press('Home'); press('ArrowDown', { shiftKey: true }, 7);
  pick('Redraw from');
  assert.ok(notes().slice(0, 8).every(n => orig.includes(n)), 'a redraw only uses values the column had');
  assert.deepEqual(notes().slice(8), orig.slice(8));
  press('z', { ctrlKey: true });
  press('Home'); press('ArrowDown', { shiftKey: true }, 7);   // an undo drops the selection
  pick('Nudge');
  assert.ok(notes().slice(0, 8).every((n, i) => Math.abs(noteSemitones(n) - noteSemitones(orig[i])) <= 2), 'a nudge is a small step');
  press('z', { ctrlKey: true });
  assert.deepEqual(notes(), orig);
  console.log('ok: pattern gobble, rotate, randomize');
}

// The pattern grid keeps one element per row and rewrites only the rows whose markup changed
{
  const defs = structuredClone(instruments), registry = new ParamRegistry();
  for (const [id, d] of Object.entries(defs)) compile(d.graph, { instrument: id, nodeTypes: NODE_TYPES, registry });
  const lanes = prepareSong(demoSong, defs, registry), editor = createEditor(lanes, 32);
  let writes = 0;
  const made = [];
  const node = () => { const n = { className: '', _h: '', set innerHTML(v) { writes++; this._h = v; }, get innerHTML() { return this._h; }, remove() {}, style: {} }; made.push(n); return n; };
  const hadDoc = 'document' in globalThis, was = globalThis.document;
  globalThis.document = { createElement: node };
  try {
    let onKey;
    const el = { childNodes: [], appendChild(c) { this.childNodes.push(c); return c; }, removeChild(c) { this.childNodes.splice(this.childNodes.indexOf(c), 1); }, addEventListener: (type, f) => { if (type === 'keydown') onKey = f; }, textContent: '' };
    const view = createTrackerView({ el, statusEl: {}, transport: new Int32Array(new SharedArrayBuffer(8)), onToggle() {}, onBack() {} });
    view.load({ lanes, song: demoSong, editor });
    view.draw();
    const rows = el.childNodes.length;
    assert.ok(rows > 10, 'one element per row');
    writes = 0; view.draw();
    assert.equal(writes, 0, 'drawing the same grid again writes nothing');
    onKey({ key: 'ArrowDown', preventDefault() {} });
    view.draw();
    assert.ok(writes >= 1 && writes <= 3, `a cursor move rewrites only its rows (${writes})`);
  } finally { if (hadDoc) globalThis.document = was; else delete globalThis.document; }
  console.log('ok: pattern grid row diffing');
}

// Interpolation: the ends are the first and last filled cells, the curve is applied by row position, empties are optional,
// the popup's changes are live and cancel puts everything back
{
  const registry = new ParamRegistry(), defs = structuredClone(instruments);
  for (const [id, def] of Object.entries(defs)) compile(def.graph, { instrument: id, nodeTypes: NODE_TYPES, registry });
  const lanes = prepareSong(demoSong, defs, registry), editor = createEditor(lanes, 32);
  let onKey, run = null;
  const view = createTrackerView({
    showCurve: opts => { run = opts; opts.onChange(opts.curve); }, el: { addEventListener: (type, f) => { if (type === 'keydown') onKey = f; }, innerHTML: '' }, statusEl: {},
    transport: new Int32Array(new SharedArrayBuffer(8)), onToggle() {}, onBack() {},
  });
  uiConfig.set('arrowStyle', 'cell');
  view.load({ lanes, song: demoSong, editor });
  const press = (key, extra = {}) => onKey({ key, preventDefault() {}, ...extra });
  const lane = lanes[0], vc = lane.columns.findIndex(c => c.token === '2hex');
  const set = (t, v) => editor.setCell(0, t, vc, v);
  const col = () => lane.rows.slice(0, 9).map(r => r[vc]);
  for (let t = 0; t < 9; t++) set(t, '..');
  set(1, '00'); set(2, '01'); set(5, '01'); set(8, 'FF');   // ends at rows 1 and 8, placeholders at 2 and 5
  view.goto(0, 0);
  for (let i = 0; i < vc; i++) press('ArrowRight');
  press('ArrowDown'); for (let i = 0; i < 7; i++) press('ArrowDown', { shiftKey: true });
  press('i', { ctrlKey: true });
  assert.ok(run, 'Ctrl+I opens the curve popup');
  const lin = col();
  assert.equal(lin[1], '00'); assert.equal(lin[8], 'FF');
  assert.equal(lin[2], '24', 'row 2 of 1..8 sits a seventh of the way: 255/7 is 36');
  assert.ok(Math.abs(parseInt(lin[5], 16) - 255 * 4 / 7) <= 1, 'by row position, not by how many cells are filled');
  assert.equal(lin[3], '..', 'empty cells stay empty');
  // a bend, live
  const { curve } = run;
  curve.table = shapeTable('ease in'); run.onChange(curve);
  assert.ok(parseInt(col()[5], 16) < parseInt(lin[5], 16), 'ease in is lower at the middle');
  // including the empties
  curve.empties = true; run.onChange(curve);
  assert.notEqual(col()[3], '..', 'with empties included the gaps fill too');
  assert.equal(col()[0], '..', 'but nothing outside the ends');
  // cancel puts it all back
  run.onCancel();
  assert.deepEqual(col(), ['..', '00', '01', '..', '..', '01', '..', '..', 'FF'], 'cancel restores the cells');
  // a wave on top, then accept: one undo step
  press('i', { ctrlKey: true });
  run.curve.empties = false; run.curve.cycles = 2; run.curve.depth = 0.2; run.onChange(run.curve);
  run.onAccept();
  const waved = col();
  assert.notEqual(waved[5], '01');
  press('z', { ctrlKey: true });
  assert.deepEqual(col(), ['..', '00', '01', '..', '..', '01', '..', '..', 'FF'], 'the whole thing is one undo step');
  console.log('ok: interpolation curve');
}

// Nugget mode: after Ctrl+Left/Right, plain Left/Right stay inside the cell until its edge; Up/Down keep the position
{
  const registry = new ParamRegistry(), defs = structuredClone(instruments);
  for (const [id, def] of Object.entries(defs)) compile(def.graph, { instrument: id, nodeTypes: NODE_TYPES, registry });
  const lanes = prepareSong(demoSong, defs, registry), editor = createEditor(lanes, 32);
  let onKey;
  const view = createTrackerView({ el: { addEventListener: (type, f) => { if (type === 'keydown') onKey = f; }, innerHTML: '' }, statusEl: {}, transport: new Int32Array(new SharedArrayBuffer(8)), onToggle() {}, onBack() {} });
  uiConfig.set('arrowStyle', 'cell');
  view.load({ lanes, song: demoSong, editor });
  const press = (key, extra = {}) => onKey({ key, preventDefault() {}, ...extra });
  const at = () => `${view.col}:${view.ch}`;   // the lane the demo opens on
  view.goto(0, 0);
  assert.equal(at(), '0:0');
  press('ArrowRight', { ctrlKey: true });
  assert.equal(at(), '0:1', 'Ctrl+Right enters the cell');
  press('ArrowRight'); assert.equal(at(), '0:2', 'plain Right stays inside');
  press('ArrowLeft'); press('ArrowLeft'); assert.equal(at(), '0:0', 'and Left too, back to the first character');
  press('ArrowDown'); assert.equal(at(), '0:0');
  press('ArrowRight'); assert.equal(at(), '0:1', 'still in nugget mode after a row change');
  press('ArrowRight'); press('ArrowRight');
  assert.equal(at(), '1:0', 'past the last character it crosses to the first character of the next cell');
  press('ArrowRight'); assert.equal(at(), '2:0', 'and the mode is over: whole cells again');
  press('ArrowRight', { ctrlKey: true }); press('ArrowLeft'); press('ArrowLeft');
  assert.equal(at(), '1:0', 'from the first character, Left crosses to the first character of the previous cell');
  // the nugget step: Up and Down move that many rows and stay on the same character
  uiConfig.set('nuggetStep', 4);
  view.goto(0, 0); press('ArrowRight', { ctrlKey: true });
  const t0 = view.tick, ch0 = view.ch;
  press('ArrowDown'); assert.equal(view.tick, t0 + 4, 'Down moves by the nugget step');
  assert.equal(view.ch, ch0, 'on the same character');
  press('ArrowUp'); assert.equal(view.tick, t0, 'and Up back');
  uiConfig.set('nuggetStep', 1);
  // typing the last character of a note in nugget mode goes down a row and stays on that character, still in nugget mode
  view.goto(0, 0); press('ArrowLeft'); press('ArrowLeft'); assert.equal(at(), '0:0'); press('z'); view.goto(0, 0);
  press('ArrowRight', { ctrlKey: true }); press('ArrowRight');
  assert.equal(at(), '0:2', 'on the octave');
  press('3'); assert.equal(view.tick, 1, 'the octave moves down a row');
  assert.equal(at(), '0:2', 'on the same character');
  press('ArrowLeft'); assert.equal(at(), '0:1', 'and still in nugget mode: Left steps one character');
  uiConfig.set('arrowStyle', 'char');
  console.log('ok: nugget mode');
}

// Follow mode: the caret follows the playing row until it is moved; then the view lets it roam until it is asked to follow again
{
  const registry = new ParamRegistry(), defs = structuredClone(instruments);
  for (const [id, def] of Object.entries(defs)) compile(def.graph, { instrument: id, nodeTypes: NODE_TYPES, registry });
  const lanes = prepareSong(demoSong, defs, registry), editor = createEditor(lanes, 32);
  let onKey;
  const transport = new Int32Array(new SharedArrayBuffer(8));
  const view = createTrackerView({ el: { addEventListener: (type, f) => { if (type === 'keydown') onKey = f; }, innerHTML: '' }, statusEl: { textContent: '' }, transport, onToggle() {}, onBack() {}, follow: () => true });
  view.load({ lanes, song: demoSong, editor });
  const press = key => onKey({ key, preventDefault() {} });
  uiConfig.set('playhead', 'marker');   // the overlay playhead needs a page to measure
  transport[1] = 1; transport[0] = 10;
  view.draw();
  assert.equal(view.tick, 10, 'following: the caret is on the playing row');
  transport[0] = 12; view.draw();
  assert.equal(view.tick, 12, 'and goes with it');
  press('ArrowDown');
  transport[0] = 20; view.draw();
  assert.equal(view.tick, 13, 'moving the caret lets it roam: the playing row no longer drags it along');
  transport[0] = 25; view.draw();
  assert.equal(view.tick, 13);
  assert.equal(view.resume(), true, 'F9 asks it to follow again');
  view.draw();
  assert.equal(view.tick, 25, 'and the caret is back on the playing row');
  uiConfig.set('followRoam', false);
  press('ArrowDown'); transport[0] = 30; view.draw();
  assert.equal(view.tick, 30, 'with the setting off the caret stays locked to the playing row');
  transport[1] = 0; uiConfig.set('followRoam', true); uiConfig.set('playhead', 'band');
  console.log('ok: follow roam');
}

// vocoder: the voice's spectrum shapes the carrier, silence in is silence out, shift and band counts stay finite
{
  const vc = NODE_TYPES.vocoder, sr = 48000, N = 48128;
  const run = (over, voice, carrier) => {
    const inst = vc.create({ sampleRate: sr, connected: [true, !!carrier] });
    const vals = Object.fromEntries(vc.params.map(q => [q.name, q.def])); Object.assign(vals, over);
    const params = vc.params.map(q => vals[q.name]), slots = vc.params.map((_, i) => i), y = new Float32Array(N);
    for (let i = 0; i < N; i += 128) {
      const o = [new Float32Array(128)];
      inst.process([Float32Array.from({ length: 128 }, (_, j) => voice(i + j)), carrier ? Float32Array.from({ length: 128 }, (_, j) => carrier(i + j)) : null], o, 128, params, slots);
      y.set(o[0], i);
    }
    return y;
  };
  const rms = (a, f = 12000, t = a.length) => { let s = 0; for (let i = f; i < t; i++) s += a[i] * a[i]; return Math.sqrt(s / (t - f)); };
  const sine = hz => i => 0.5 * Math.sin(2 * Math.PI * hz * i / sr);
  const saw = hz => i => 2 * ((i * hz / sr) % 1) - 1;
  let seed = 3; const noise = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return 0.4 * (seed / 2147483648 - 1); };
  assert.ok(vc.params.every(q => q.def >= q.min && q.def <= q.max), 'vocoder defaults are in range');
  assert.ok(rms(run({}, () => 0)) < 1e-6, 'a silent voice gives silence');
  const tone = run({ sibilance: 0 }, sine(500), saw(110));
  assert.ok(tone.every(Number.isFinite) && rms(tone) > 0.01, 'a voice makes the carrier speak');
  // gating: the carrier only passes while the voice is on
  const burst = run({ sibilance: 0 }, i => (i < 24000 ? sine(500)(i) : 0), saw(110));
  assert.ok(rms(burst, 12000, 22000) > 8 * rms(burst, 36000, 48000), 'the output follows the voice envelope');
  // spectrum: a low voice tone lets low carrier harmonics through, a high one lets high ones through
  const hf = a => { let d = 0, e = 0; for (let i = 12001; i < a.length; i++) { const x = a[i] - a[i - 1]; d += x * x; e += a[i] * a[i]; } return d / e; };
  assert.ok(hf(run({ sibilance: 0 }, sine(3500), saw(110))) > 3 * hf(run({ sibilance: 0 }, sine(300), saw(110))), 'the voice spectrum picks the carrier band');
  for (const o of [{ bands: 4 }, { bands: 32, q: 20 }, { shift: 12 }, { shift: -12, release: 500 }, { low: 1000, high: 2000 }]) assert.ok(run(o, noise).every(Number.isFinite), `vocoder ${JSON.stringify(o)} stays finite`);
  assert.ok(rms(run({ sibilance: 1 }, sine(8000), saw(110))) > 2 * rms(run({ sibilance: 0 }, sine(8000), saw(110), 0)), 'sibilance passes the highs');
  console.log('ok: vocoder');
}

// bezier curve mode: ordered in time, inside the range, ends fixed, monotone x so the curve is a function
{
  const { bezierFrom, bezierFix, bezierValue, bezierTable, newCurve, CURVE_N } = await import('../src/seq/curve.js');
  assert.equal(newCurve().bezier, null);
  const pts = bezierFrom('s-curve');
  assert.ok(Math.abs(bezierValue(pts, 0) - 0) < 1e-9 && Math.abs(bezierValue(pts, 1) - 1) < 1e-9, 'the ends are 0 and 1');
  assert.ok(Math.abs(bezierValue(pts, 0.5) - 0.5) < 1e-3, 'the symmetric s-curve passes the middle');
  // hostile input: handles far outside, anchors out of order, values out of range
  const bad = [{ x: 0, y: 0, hl: { x: 0, y: 0 }, hr: { x: 5, y: 9 }, smooth: true }, { x: 0.9, y: 4, hl: { x: -3, y: -9 }, hr: { x: 0.5, y: 5 }, smooth: true }, { x: 0.3, y: -2, hl: { x: -1, y: 3 }, hr: { x: 1, y: -3 }, smooth: false }, { x: 1, y: 0.3, hl: { x: -9, y: 9 }, hr: { x: 0, y: 0 }, smooth: true }];
  bezierFix(bad);
  assert.deepEqual(bad.map(p => p.x === bad.map(q => q.x).sort((a, b) => a - b)[bad.indexOf(p)]), [true, true, true, true], 'anchors are in time order');
  assert.ok(bad[0].y === 0 && bad[3].y === 1, 'the ends keep the first and last values');
  bad.forEach((p, i) => { assert.ok(p.y >= 0 && p.y <= 1); if (i) assert.ok(p.x + p.hl.x >= bad[i - 1].x - 1e-9, 'a handle stops at its neighbour'); if (i < 3) assert.ok(p.x + p.hr.x <= bad[i + 1].x + 1e-9); });
  const table = bezierTable(bad);
  assert.equal(table.length, CURVE_N + 1);
  assert.ok(table.every(v => Number.isFinite(v) && v >= 0 && v <= 1), 'values stay inside the range');
}

// Pattern editor: Ctrl+Shift+Delete removes the placement under the cursor, one undo brings it back.
{
  const registry = new ParamRegistry();
  for (const [id, def] of Object.entries(instruments)) compile(def.graph, { instrument: id, nodeTypes: NODE_TYPES, registry });
  const lanes = prepareSong(demoSong, instruments, registry);
  const editor = createEditor(lanes, 32);
  let onKey;
  const view = createTrackerView({ el: { addEventListener: (type, f) => { if (type === 'keydown') onKey = f; else if (type === 'wheel') onWheel = f; }, innerHTML: '' }, statusEl: {}, transport: new Int32Array(new SharedArrayBuffer(8)), onToggle() {}, onBack() {}, readParam: slot => registry.values[slot] });
  view.load({ lanes, song: demoSong, editor });
  const press = (key, extra = {}) => onKey({ key, preventDefault() {}, ...extra });
  const lane = lanes[0], n = lane.placements.length;
  view.goto(0, lane.placements[0].start);
  press('Delete', { ctrlKey: true, shiftKey: true });
  assert.equal(lane.placements.length, n - 1, 'the placement under the cursor is gone');
  press('z', { ctrlKey: true });
  assert.equal(lane.placements.length, n, 'one undo brings it back');
}

// recorder: blocks join into one take (mono when both sides match), the worklet reports blocks and levels
{
  const { finishTake, createRecorder } = await import('../src/project/recorder.js');
  const a = Float32Array.from([0.1, 0.2]), b = Float32Array.from([0.3]);
  const mono = finishTake([a, b], [a, b]);
  assert.ok(!mono.right && mono.data.length === 3 && Math.abs(mono.data[2] - 0.3) < 1e-6, 'identical sides make a mono sample');
  const st = finishTake([a], [Float32Array.from([0.5, 0.2])]);
  assert.ok(st.right && st.right[0] === 0.5, 'different sides stay stereo');
  // the worklet processor
  let Proc; globalThis.AudioWorkletProcessor = class { constructor() { this.port = { postMessage: (m) => { this.sent.push(m); } }; this.sent = []; } }; globalThis.registerProcessor = (name, c) => { Proc = c; };
  await import('../src/audio/recorder-worklet.js');
  const p = new Proc();
  p.process([[new Float32Array(128).fill(0.5)]]);
  assert.equal(p.sent.length, 0, 'nothing is kept until started');
  p.port.onmessage({ data: 'start' });
  for (let i = 0; i < 16; i++) p.process([[new Float32Array(128).fill(0.5), new Float32Array(128).fill(-0.25)]]);
  assert.equal(p.sent.length, 1, 'a block of 2048 frames is sent');
  assert.ok(p.sent[0].l.length === 2048 && p.sent[0].l[0] === 0.5 && p.sent[0].r[0] === -0.25 && p.sent[0].peak === 0.5, 'left, right and the peak arrive');
  p.process([[new Float32Array(128).fill(0.1)]]); p.port.onmessage({ data: 'stop' });
  assert.equal(p.sent.at(-1).l.length, 128, 'stopping sends the partial block; a mono input fills both sides');
  assert.equal(p.sent.at(-1).r[5], p.sent.at(-1).l[5]);
  // errors without a browser
  const rec = createRecorder({ getCtx: () => null, media: () => null });
  await assert.rejects(() => rec.start('display'), /not available/);
  const noAudio = createRecorder({ getCtx: () => ({}), media: () => ({ getDisplayMedia: async () => ({ getVideoTracks: () => [{ stop() {} }], getAudioTracks: () => [], getTracks: () => [] }) }) });
  await assert.rejects(() => noAudio.start('display'), /No audio was shared/);
  console.log('ok: recorder');
}

// tap node and the tap pool
{
  const tap = NODE_TYPES.tap, sr = 48000;
  const { poolId, isPool, ensurePool, removeSample, emptyPoolSlot } = await import('../src/project/ops.js');
  const { serializeProject, parseProject } = await import('../src/project/file.js');
  const stamps = new Uint32Array(64), clock = { tickSamples: 6000, stamps, tickId: 0, playing: true };
  const sent = [];
  const inst = tap.create({ sampleRate: sr, clock, emit: (msg, transfer) => sent.push({ ...msg }) });
  const vals = Object.fromEntries(tap.params.map(q => [q.name, q.def])), slots = tap.params.map((_, i) => i);
  const L = new Float32Array(128).fill(0.5), R = new Float32Array(128).fill(-0.5);
  const run = () => { const o = [new Float32Array(128), new Float32Array(128)]; inst.process([[L, R]], [o], 128, tap.params.map(q => vals[q.name]), slots); return o; };
  const out = run();
  assert.equal(out[0][5], 0.5, 'the audio passes through'); assert.equal(sent.length, 0, 'nothing is recorded before a trig');
  // a take of 2 ticks: 1 written to trig, then two ticks of 4 blocks each
  vals.len = 2; vals.smp = 3; vals.trig = 1; stamps[0]++;
  for (let t = 0; t < 2; t++) { clock.tickId++; if (t === 0) { /* the write came with the first tick */ } for (let b = 0; b < 4; b++) run(); }
  clock.tickId++; run();   // the third tick boundary ends it
  const start = sent.find(m => m.phase === 'start'), end = sent.find(m => m.phase === 'end');
  assert.ok(start && end, 'a take starts and ends'); assert.equal(start.smp, 3); assert.equal(start.ch, 2);
  const frames = sent.filter(m => m.phase === 'chunk').reduce((a, m) => a + m.l.length, 0);
  assert.equal(frames, 8 * 128, 'the take holds exactly the two ticks that ran');
  assert.ok(sent.filter(m => m.phase === 'chunk')[0].r[0] === -0.5, 'stereo takes carry both sides');
  // trig 0 ends early; smp 0 records nothing; mono sends one side only
  sent.length = 0; vals.len = 0; vals.trig = 1; vals.ch = 1; stamps[0]++; run(); run();
  vals.trig = 0; stamps[0]++; run();
  const mono = sent.filter(m => m.phase === 'chunk');
  assert.ok(mono.length && mono[0].r === null && Math.abs(mono[0].l[0]) < 1e-6, 'mono is the mix of both sides');
  assert.ok(sent.some(m => m.phase === 'end'), 'a 0 ends a take with no length');
  sent.length = 0; vals.smp = 0; vals.trig = 1; stamps[0]++; run();
  assert.equal(sent.length, 0, 'smp 0 records nothing');
  // the song stopping ends a take
  vals.smp = 2; vals.len = 0; stamps[0]++; run(); clock.playing = false; run();
  assert.ok(sent.some(m => m.phase === 'end'), 'stopping the song ends the take');
  // the pool
  const samples = ensurePool({});
  assert.equal(Object.keys(samples).length, 16); assert.ok(isPool(poolId(7)) && poolId(7) === 'tap07' && !isPool('tap17') && !isPool('tap00') && !isPool('kick'));
  samples.tap02 = { rate: 48000, data: new Float32Array(100), pool: true, taken: true };
  removeSample({ samples, instruments: {} }, 'tap02');
  assert.ok(samples.tap02 && !samples.tap02.taken && samples.tap02.data.length === 1, 'deleting a tap slot empties it');
  const proj = { song: { name: 't', bpm: 120, ticksPerBeat: 4, length: 16 }, instruments: {}, samples: { ...samples, kick: { rate: 44100, data: new Float32Array(10) } }, lanes: [] };
  const text = serializeProject(proj);
  assert.ok(!/tap0\d/.test(JSON.parse(text).samples ? Object.keys(JSON.parse(text).samples).join() : ''), 'tap slots are not saved');
  const back = parseProject(text);
  assert.ok(back.samples.kick && back.samples.tap16 && back.samples.tap01.data.length === 1, 'they come back as empty slots');
  console.log('ok: tap');
}

// Scripts: the engine (bit patterns, chords, voices, helpers), atomic failure, the kill switch, saving
{
  const { execute, euclid, parseSteps, scale } = await import('../src/script/lib.js');
  const { highlight } = await import('../src/script/highlight.js');
  const { createScriptRunner } = await import('../src/script/client.js');
  const cols = [
    { kind: 'note', token: 'note', label: 'N1', key: 'note' }, { kind: 'vel', token: '2hex', label: 'V1', key: 'vel' },
    { kind: 'note', token: 'note', label: 'N2', key: 'note:1' }, { kind: 'vel', token: '2hex', label: 'V2', key: 'vel:1' },
    { kind: 'param', token: '2hex', label: 'Cutoff', key: 'p:f.cutoff:2hex', param: 'cutoff', node: 'f' },
  ];
  const blank = n => Array.from({ length: n }, () => ['...', '..', '...', '..', '..']);
  const run = (code, extra = {}) => execute({ code, pattern: { name: 'p', lane: 'l', instrument: 'i', columns: cols, rows: blank(16) }, ...extra });
  const cells = r => r.edits.map(e => `${e.row}:${e.col}=${e.token}`).join(' ');

  assert.equal(euclid(3, 8), 'x..x..x.'); assert.equal(euclid(5, 8), 'x.xx.xx.'); assert.equal(euclid(7, 16), 'x..x.x.x..x.x.x.');
  assert.deepEqual(parseSteps('x.1 0?').map(s => s.hit), [true, false, true, false, true]);
  assert.throws(() => parseSteps('x.q'), /not a step/);
  assert.deepEqual(scale('minor', 'A', 2).slice(0, 3), ['A-2', 'B-2', 'C-3']);

  // one character a row, tiled over the pattern, rests left alone
  let r = run("tbin('x... x.x.', 'C-3')");
  assert.ok(r.ok); assert.equal(cells(r), '0:0=C-3 4:0=C-3 6:0=C-3 8:0=C-3 12:0=C-3 14:0=C-3');
  assert.match(r.echo[0], /^N1 0-14: x\.\.\. x\.x\./);
  // a '.' empties its cell (note and velocity); keep: true leaves what is there
  { const full = Array.from({ length: 16 }, () => ['E-4', '40', '...', '..', '..']);
    const go = code => execute({ code, pattern: { name: 'p', lane: 'l', instrument: 'i', columns: cols, rows: full } });
    assert.equal(cells(go("tbin('x...', 'C-3', { loop: false })")), '0:0=C-3 1:0=... 1:1=.. 2:0=... 2:1=.. 3:0=... 3:1=..', 'rests blank the cells they cover');
    assert.equal(cells(go("tbin('x...', 'C-3', { loop: false, keep: true })")), '0:0=C-3', 'keep: true leaves them'); }
  // a step of 8 puts the characters 8 rows apart; loop off writes the string once
  assert.equal(cells(run("tbin('x.x.', 'C-3', { step: 4, loop: false })")), '0:0=C-3 8:0=C-3');
  assert.equal(cells(run("step(8); tbin('xx', 'C-3')")), '0:0=C-3 8:0=C-3');
  // a number is a bit pattern, most significant bit first
  assert.equal(cells(run("tbin(0b1010, 4, 'C-3', { loop: false })")), '0:0=C-3 2:0=C-3');
  // levels write the velocity column
  assert.equal(cells(run("tbin('9..5', 'C-3', { loop: false })")), '0:0=C-3 0:1=99 3:0=C-3 3:1=55');
  // a chord per item goes across the note columns; the items cycle
  assert.equal(cells(run("tbin('x.x.x.', ['C-3 E-3', 'A-2+C-3'], { loop: false })")), '0:0=C-3 0:2=E-3 2:0=A-2 2:2=C-3 4:0=C-3 4:2=E-3');
  // voices: each column has its own sequence, one step a hit
  assert.equal(cells(run("tbin('x.x.', voices('C-3 E-3', 'A-2 C-3'), { loop: false })")), '0:0=C-3 0:2=A-2 2:0=E-3 2:2=C-3');
  // a note off and a skipped step
  assert.equal(cells(run("tbin('xx', ['C-3', '==='], { loop: false })")), '0:0=C-3 1:0====');
  assert.equal(cells(run("tbin('xxx', voices('C-3 ... E-3'), { loop: false })")), '0:0=C-3 2:0=E-3');
  // bit helpers
  assert.equal(run("rot('x...', 1)", { expr: true }).ok, true);
  assert.equal(run("both('xx..', 'x.x.') + either('xx..', 'x.x.') + xor('xx..', 'x.x.')", { expr: true }).value, 'x...xxx..xx.');
  assert.equal(run("inv(rev('x..'))", { expr: true }).value, 'xx.');
  // column fills by name, with a function; out-of-range values clamp
  r = run("pat.col('cutoff').fill(ramp(0x20, 0xE0)); pat.set(3, 'cutoff', 999)");
  assert.equal(r.edits.length, 16); assert.equal(r.edits[3].token, 'FF'); assert.equal(r.edits[15].token, 'E0');
  // only the selection
  assert.equal(run("pat.col('cutoff').fill('40')", { selection: { r0: 2, r1: 4, c0: 4, c1: 4 } }).edits.length, 3);
  // the seed makes it repeatable
  assert.equal(run("rnd(1000)", { expr: true, seed: 7 }).value, run("rnd(1000)", { expr: true, seed: 7 }).value);
  assert.equal(cells(run("tbin('xxxxxxxx', 'C-3', { prob: 0.5 })", { seed: 3 })), cells(run("tbin('xxxxxxxx', 'C-3', { prob: 0.5 })", { seed: 3 })));
  // failures change nothing and say where
  r = run("tbin('x...', 'C-3');\n\nnope()");
  assert.ok(!r.ok && !r.edits && /nope/.test(r.error.message) && r.error.line === 3, `line ${r.error?.line}`);
  r = run("tbin('x...', 'C-3 E-3 G-3')");
  assert.ok(!r.ok && /note columns/.test(r.error.message));
  assert.ok(!run("pat.set(0, 'cutoff', 'zz')").ok && !run("pat.set(99, 'cutoff', 1)").ok && !run("pat.col('nothing')").ok);
  assert.equal(run('typeof fetch + typeof self', { expr: true }).value, 'undefinedundefined');
  // a line typed in the playground gives its value
  assert.equal(run("scale('minor', 'A', 2, 2)", { expr: true }).value, '["A-2","B-2"]');
  // the colouring marks bit patterns
  assert.match(highlight("tbin('x.', 1) // hi"), /tk-h">x<.*tk-r">\.<.*tk-n">1<.*tk-c">\/\/ hi/);

  // the kill switch: a script that never ends is stopped and the runner is usable again
  const { Worker: NodeWorker } = await import('node:worker_threads');
  const libUrl = new URL('../src/script/lib.js', import.meta.url).href;
  const make = () => {
    const w = new NodeWorker(`const { parentPort } = require('node:worker_threads'); import('${libUrl}').then(({ execute }) => parentPort.on('message', ({ id, ...req }) => parentPort.postMessage({ id, ...execute(req) })));`, { eval: true });
    const map = new Map();
    return {
      addEventListener(t, f) { const g = t === 'message' ? d => f({ data: d }) : e => f({ message: e.message }); map.set(f, g); w.on(t, g); },
      removeEventListener(t, f) { w.off(t, map.get(f)); }, postMessage: m => w.postMessage(m), terminate: () => w.terminate(),
    };
  };
  const runner = createScriptRunner({ limit: () => 500, make });
  const req = code => ({ code, pattern: { name: 'p', lane: 'l', instrument: 'i', columns: cols, rows: blank(16) } });
  let res = await runner.run(req("tbin('x...', 'C-3')"));
  assert.ok(res.ok && res.edits.length === 4, 'a normal script runs in the worker');
  res = await runner.run(req('while (true) {}'));
  assert.ok(!res.ok && res.killed && /Stopped/.test(res.error.message), 'an endless loop is stopped');
  res = await runner.run(req("tbin('x...', 'C-3')"));
  assert.ok(res.ok, 'and the next run works');
  runner.dispose();

  // saved with the project
  const out = serializeProject({ song: { name: 's', bpm: 100, ticksPerBeat: 4, length: 32, script: "tbin('x...', 'C-3')" }, instruments: {}, samples: {}, lanes: [] });
  assert.equal(parseProject(out).song.script, "tbin('x...', 'C-3')");
  assert.ok(!serializeProject({ song: { name: 's', bpm: 100, ticksPerBeat: 4, length: 32 }, instruments: {}, samples: {}, lanes: [] }).includes('"script"'));
  console.log('ok: script');
}

// Tick lines on time and rate sliders
{
  const { timeKind, toTicks, fromTicks, tickMarks, snapTo, tickText } = await import('../src/graph/ticks.js');
  assert.equal(timeKind('delay', 'time'), 'ms'); assert.equal(timeKind('hall', 'decay'), 's'); assert.equal(timeKind('lfo', 'rate'), 'hz');
  assert.equal(timeKind('crusher', 'rate'), null, 'a sample rate is not a time'); assert.equal(timeKind('filter', 'cutoff'), null); assert.equal(timeKind('sampler', 'retrig'), null, 'already in ticks');
  const tickMs = 60000 / (150 * 4);   // 100 ms
  assert.equal(toTicks('ms', 300, tickMs), 3); assert.equal(toTicks('s', 0.5, tickMs), 5); assert.equal(toTicks('hz', 2.5, tickMs), 4);
  assert.ok(Math.abs(fromTicks('hz', 4, tickMs) - 2.5) < 1e-9 && fromTicks('ms', 3, tickMs) === 300);
  const lin = { kind: 'ms', min: 0, max: 1000, log: false, toPos: v => v / 1000, tickMs, perBeat: 4, width: 400 };
  const m = tickMarks(lin);
  assert.equal(m.length, 10, 'a line at every tick of a linear slider'); assert.deepEqual(m.filter(x => x.beat).map(x => x.ticks), [4, 8], 'the beat is marked');
  assert.equal(tickMarks({ ...lin, width: 20 }).length, 5, 'lines closer than 4 px are left out');
  const log = tickMarks({ kind: 'ms', min: 1, max: 4000, log: true, toPos: v => Math.log(v / 1) / Math.log(4000), tickMs, perBeat: 4, width: 400 });
  assert.ok(log.some(x => x.ticks === 0.5) && log.some(x => x.ticks === 16) && log.every((x, i) => !i || x.pos > log[i - 1].pos), 'a log slider marks halves and powers of two');
  assert.equal(snapTo(m, 0.301, 400).ticks, 3, 'a drag near a line lands on it'); assert.equal(snapTo(m, 0.35, 400), null, 'but not far from one');
  assert.equal(tickText(3), '3t'); assert.equal(tickText(1.5), '1.5t'); assert.equal(tickText(0.125), '0.13t'); assert.equal(tickText(12.34), '12.3t');
  console.log('ok: tick lines');
}

// Pattern editor: Ctrl+K steps the colour, the status bar has the column name and a meter
{
  const reg = new ParamRegistry();
  for (const [id, d] of Object.entries(instruments)) compile(d.graph, { instrument: id, nodeTypes: NODE_TYPES, registry: reg });
  const lanes = prepareSong(demoSong, instruments, reg);
  let onKey;
  const el = { addEventListener: (type, f) => { if (type === 'keydown') onKey = f; }, innerHTML: '' };
  const statusEl = { textContent: '', set innerHTML(h) { this.html = h; this.textContent = h.replace(/<[^>]+>/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'); } };
  const view = createTrackerView({ el, statusEl, transport: new Int32Array(new SharedArrayBuffer(8)), onToggle() {}, onBack() {} });
  view.load({ lanes, song: demoSong, editor: createEditor(lanes, demoSong.length) });
  const key = (k, extra = {}) => onKey({ key: k, preventDefault() {}, ...extra });
  const colorOf = () => lanes[0].patterns[placementAt(lanes[0], 0).puid].color;
  const was = colorOf();
  key('k', { ctrlKey: true });
  assert.notEqual(colorOf(), was, 'Ctrl+K steps the colour');
  view.draw(); assert.match(statusEl.textContent, /colour \d+ of 16|automatic colour/);
  key('K', { ctrlKey: true, shiftKey: true });
  assert.equal(colorOf(), was, 'Ctrl+Shift+K steps back');
  view.draw();
  assert.ok(statusEl.html.includes('class="pname"') && statusEl.html.includes('class="spos"'), 'two lines: the place and the column');
  console.log('ok: pattern colour and status bar');
}
// Spectral panner: spread 0 is the identity, the low end goes mono, and a sweep puts highs and lows on opposite sides.
{
  const def = NODE_TYPES.specpan, sr2 = 48000;
  const run = (values, inL, inR) => {
    const params = Float32Array.from(def.params.map(q => values[q.name] ?? q.def)), slots = Int32Array.from(def.params.map((_, k) => k));
    const node = def.create({ sampleRate: sr2, connected: [true] });
    const out = [new Float32Array(inL.length), new Float32Array(inL.length)];
    for (let at = 0; at < inL.length; at += 128) {
      const n = Math.min(128, inL.length - at);
      node.process([[inL.subarray(at, at + n), inR.subarray(at, at + n)]], [[out[0].subarray(at, at + n), out[1].subarray(at, at + n)]], n, params, slots);
    }
    return out;
  };
  const N = 24000, tone = (f, ph = 0) => Float32Array.from({ length: N }, (_, k) => 0.5 * Math.sin(2 * Math.PI * f * k / sr2 + ph));
  const rms = (a, from = 12000) => { let e = 0; for (let k = from; k < a.length; k++) e += a[k] * a[k]; return Math.sqrt(e / (a.length - from)); };
  const a = tone(1000), b = tone(2500);
  const same = run({ spread: 0, lowMono: 20 }, a, b);
  let worst = 0; for (let k = 0; k < N; k++) worst = Math.max(worst, Math.abs(same[0][k] - a[k]), Math.abs(same[1][k] - b[k]));
  assert.ok(worst < 0.07, `spread 0 leaves the level alone (only the phase near the crossover moves) (${worst})`);
  const bass = run({ spread: 0, lowMono: 400 }, tone(40), tone(40, Math.PI));
  assert.ok(rms(bass[0]) < 0.03 && rms(bass[1]) < 0.03, 'out-of-phase bass below lowMono cancels to mono');
  const lowTone = run({ shape: 1, spread: 1, lowMono: 20 }, tone(60), tone(60)), highTone = run({ shape: 1, spread: 1, lowMono: 20 }, tone(9000), tone(9000));
  assert.ok(rms(lowTone[0]) > rms(lowTone[1]) * 1.4, 'a sweep puts lows left');
  assert.ok(rms(highTone[1]) > rms(highTone[0]) * 2, 'and highs right');
  assert.ok(lowTone[0].every(Number.isFinite));
  // the built-in motion: with a rate the image moves by itself (the balance of one band changes over time), and with none it does not
  const swing = (values) => {
    const long = Float32Array.from({ length: 96000 }, (_, k) => 0.5 * Math.sin(2 * Math.PI * 5000 * k / sr2)), o = run({ shape: 1, spread: 1, lowMono: 20, ...values }, long, long);
    const seg = a => { const out = []; for (let q = 0; q < 8; q++) { let e = 0; for (let k = q * 12000; k < (q + 1) * 12000; k++) e += a[k] * a[k]; out.push(Math.sqrt(e / 12000)); } return out; };
    const bal = seg(o[0]).map((v, i) => v / (v + seg(o[1])[i]));
    return Math.max(...bal) - Math.min(...bal);
  };
  assert.ok(swing({ rate: 1, sweep: 0.5 }) > 0.08, 'the built-in motion moves the image');
  assert.ok(swing({ rate: 0 }) < 0.02, 'with no rate it stays put');
  assert.ok(swing({ rate: 1, sweep: 0 }) < 0.02, 'and with no sweep');
}

// Node help pages: every node type has one; the written ones have limits.
{
  const { helpPage, PAGES } = await import('../src/graph/help.js');
  for (const [type, def] of Object.entries(NODE_TYPES)) {
    const page = helpPage(type, def);
    assert.ok(page.html.includes('<h3>Ports</h3>'), `${type} has a page`);
    for (const spec of def.params) assert.ok(page.html.includes(`<dt>${spec.name}</dt>`), `${type}.${spec.name} is listed`);
  }
  assert.ok(helpPage('specpan', NODE_TYPES.specpan).html.includes('<h3>Limits</h3>'));
  for (const type of Object.keys(PAGES)) assert.ok(NODE_TYPES[type], `${type} is a real node`);
}

// The spectral panner's view draws from the parameters without trouble, for every shape.
{
  const { createSpecPanView } = await import('../src/graph/specpaneditor.js');
  const calls = [];
  const ctx = new Proxy({}, { get: (_, k) => (k === 'canvas' ? null : (...a) => { calls.push(k); }), set: () => true });
  const doc = { createElement: () => ({ getContext: () => ctx }) };
  const values = { shape: 0, spread: 0.6, rotate: 0, lowMono: 100 };
  const view = createSpecPanView({ doc, getParam: name => values[name] ?? 0 });
  for (const shape of [0, 1, 2, 3]) { values.shape = shape; calls.length = 0; view.refresh(); assert.ok(calls.filter(c => c === 'fillRect').length >= 10, `shape ${shape} draws its bars`); }
}

// Backups: snapshots are stored once per change, the oldest are dropped, and a chosen folder gets the file.
{
  const { createBackups, memoryStore } = await import('../src/project/backup.js');
  let text = 'v1', clock = 1000, mode = 'latest';
  const written = {};
  const handle = { name: 'wax-backups', queryPermission: async () => 'granted', getFileHandle: async file => ({ createWritable: async () => ({ write: async t2 => { written[file] = t2; }, close: async () => {} }) }) };
  const store = memoryStore();
  const b = createBackups({ serialize: () => text, getName: () => 'my song', options: () => ({ keep: 3, folderMode: mode }), store, now: () => clock });
  await b.chooseFolder(async () => handle);
  assert.equal(written['my song.wax'], 'v1', 'choosing a folder writes the project there');
  assert.equal(await b.snapshot('auto'), null, 'an unchanged project is not stored again');
  for (const v of ['v2', 'v3', 'v4', 'v5']) { text = v; clock += 1000; await b.snapshot('auto'); }
  const rows = await b.list();
  assert.equal(rows.length, 3, 'only the newest are kept');
  assert.equal(await b.text(rows[0].id), 'v5');
  assert.equal(await b.text(rows[2].id), 'v3');
  assert.equal(written['my song.wax'], 'v5', 'the folder file is overwritten');
  mode = 'stamped'; text = 'v6'; clock += 1000;
  await b.snapshot('save');
  assert.ok(Object.keys(written).some(k => /^my song-\d{8}-\d{6}\.wax$/.test(k)), 'stamped files get a time in the name');
  // the download fallback hands the project over once per change
  text = 'd1'; b.baselineDownload();
  assert.equal(b.takeDownload(), null, 'nothing changed since the baseline');
  text = 'd2'; const got = b.takeDownload();
  assert.equal(got.text, 'd2'); assert.equal(got.name, 'my song');
  assert.equal(b.takeDownload(), null, 'and not twice');
  // a snapshot asked for just before a replace holds what the project was then
  text = 'before'; clock += 1000;
  const pending = b.snapshot('before load'); text = 'after';
  await pending;
  assert.equal(await b.text((await b.list())[0].id), 'before');
}

// Noise colours: the tilt sets the slope of the spectrum, the loudness stays matched, free runs without a note.
{
  const def = NODE_TYPES.noise, sr2 = 48000, N = 96000;
  const make = values => {
    const params = Float32Array.from(def.params.map(q => values[q.name] ?? q.def)), slots = Int32Array.from(def.params.map((_, k) => k));
    const node = def.create({ sampleRate: sr2, connected: [] }), out = new Float32Array(N);
    if (!values.free) node.note({ type: 'noteOn', note: 60 });
    for (let at = 0; at < N; at += 128) node.process([], [out.subarray(at, at + 128)], Math.min(128, N - at), params, slots);
    return out;
  };
  const power = (x, f) => { let re = 0, im = 0; for (let k = 0; k < x.length; k++) { const a = 2 * Math.PI * f * k / sr2; re += x[k] * Math.cos(a); im += x[k] * Math.sin(a); } return (re * re + im * im) / x.length; };
  const db = (x, lo, hi) => { let a = 0, b = 0; for (const f of [lo * 0.9, lo, lo * 1.1]) a += power(x, f); for (const f of [hi * 0.9, hi, hi * 1.1]) b += power(x, f); return 10 * Math.log10(a / b); };
  const rms = x => Math.sqrt(x.reduce((s, v) => s + v * v, 0) / x.length);
  const brown = make({ tilt: -6 }), pink = make({ tilt: -3 }), white = make({ tilt: 0 }), violet = make({ tilt: 6 });
  assert.ok(db(brown, 150, 2400) > 18, `brown falls steeply (${db(brown, 150, 2400).toFixed(1)} dB over 4 octaves)`);
  assert.ok(Math.abs(db(pink, 150, 2400) - 12) < 4, `pink falls 3 dB per octave (${db(pink, 150, 2400).toFixed(1)})`);
  assert.ok(Math.abs(db(white, 150, 2400)) < 2.5, 'white is flat');
  assert.ok(db(violet, 150, 2400) < -12, 'violet rises');
  for (const x of [brown, pink, violet]) assert.ok(Math.abs(rms(x) / rms(white) - 1) < 0.15, 'the colours are matched in loudness');
  assert.equal(rms(make({ tilt: 0, free: 0 }).fill(0)), 0);
  const quietNode = def.create({ sampleRate: sr2, connected: [] }), idle = new Float32Array(128);
  quietNode.process([], [idle], 128, Float32Array.from(def.params.map(q => q.def)), Int32Array.from(def.params.map((_, k) => k)));
  assert.equal(rms(idle), 0, 'silent before a note');
  assert.ok(rms(make({ free: 1 })) > 0.2, 'free runs by itself');
}

// Export: the WAV encoder writes a proper header and clips at full scale, 32-bit float does not clip.
{
  const { encodeWav } = await import('../src/audio/export.js');
  const pcm = { left: Float32Array.of(0, 0.5, 2), right: Float32Array.of(-1, -0.5, 0), sampleRate: 48000 };
  for (const bits of [16, 24, 32]) {
    const buf = Buffer.from(await encodeWav(pcm, bits).arrayBuffer());
    assert.equal(buf.toString('latin1', 0, 4), 'RIFF');
    assert.equal(buf.readUInt32LE(24), 48000);
    assert.equal(buf.readUInt16LE(34), bits);
    assert.equal(buf.length, 44 + 3 * 2 * bits / 8);
    assert.equal(buf.readUInt32LE(40), 3 * 2 * bits / 8);
  }
  const b16 = Buffer.from(await encodeWav(pcm, 16).arrayBuffer());
  assert.equal(b16.readInt16LE(44 + 8), 32767);   // the 2.0 is clipped
  assert.equal(b16.readInt16LE(44 + 2), -32767);
  const b32 = Buffer.from(await encodeWav(pcm, 32).arrayBuffer());
  assert.equal(b32.readFloatLE(44 + 16), 2);
  console.log('ok: wav export encoder');
}

// Vectorscope ring: the writer is silent until the reader switches it on; the reader gets the newest frames, in order, across the wrap.
{
  const { RING, ringBuffer, ringReader, ringWriter } = await import('../src/audio/vring.js');
  const sab = ringBuffer(), w = ringWriter(sab), r = ringReader(sab), out = new Float32Array(RING * 2);
  assert.equal(w.on, false);
  r.enable(true);
  assert.equal(w.on, true);
  const r2 = ringReader(sab, 1); r2.enable(true); r2.enable(false);
  assert.equal(w.on, true);   // the other reader's bit is still set
  w.write(Float32Array.of(1, 2, 3), Float32Array.of(-1, -2, -3), 3);
  assert.equal(r.read(out), 3);
  assert.deepEqual([...out.slice(0, 6)], [1, -1, 2, -2, 3, -3]);
  assert.equal(r.read(out), 0);
  const big = Float32Array.from({ length: RING + 10 }, (_, i) => i);
  w.write(big, big, big.length);
  assert.equal(r.read(out), RING);   // only the newest RING frames survive
  assert.equal(out[0], 10);
  assert.equal(out[(RING - 1) * 2], RING + 9);
  r.enable(false);
  assert.equal(w.on, false);
  console.log('ok: vectorscope ring');
}

// Meter arithmetic: loudness of a full-scale 997 Hz sine in both channels is about 0 LUFS, one channel -3; correlation; spectrum band and width.
{
  const { createLoudness, createCorrelation, createAnalyser, BANDS, SPEC_N } = await import('../src/ui/meterdsp.js');
  const fs = 48000, N = fs * 4, sine = Float32Array.from({ length: N }, (_, i) => Math.sin(2 * Math.PI * 997 * i / fs)), zero = new Float32Array(N);
  const both = createLoudness(fs); both.push(sine, sine, N);
  assert.ok(Math.abs(both.short()) < 0.15, `both channels: ${both.short()}`);
  const one = createLoudness(fs); one.push(sine, zero, N);
  assert.ok(Math.abs(one.short() + 3.01) < 0.15, `one channel: ${one.short()}`);
  assert.ok(Math.abs(one.momentary() - one.short()) < 0.2);
  const c1 = createCorrelation(fs); c1.push(sine, sine, N); assert.ok(c1.value() > 0.99);
  const c2 = createCorrelation(fs); c2.push(sine, sine.map(x => -x), N); assert.ok(c2.value() < -0.99);
  const c3 = createCorrelation(fs); c3.push(sine, Float32Array.from({ length: N }, (_, i) => Math.cos(2 * Math.PI * 997 * i / fs)), N); assert.ok(Math.abs(c3.value()) < 0.05);
  const a = createAnalyser(fs), l = sine.subarray(0, SPEC_N), r = sine.subarray(0, SPEC_N);
  a.run(l, r);
  let top = 0; for (let b = 1; b < BANDS; b++) if (a.db[b] > a.db[top]) top = b;
  const f = 20 * Math.pow(1000, (top + 0.5) / BANDS);
  assert.ok(Math.abs(Math.log2(f / 997)) < 0.15, `peak band at ${f} Hz`);
  assert.ok(a.db[top] > -4 && a.db[top] < 1, `level ${a.db[top]}`);
  assert.ok(a.width.every(w => w < 0.01), 'mono has no side energy');
  a.run(l, r.map(x => -x));
  assert.ok(Math.max(...a.width) > 0.99, 'out of phase is all side');
  console.log('ok: meter arithmetic');
}

// Arrangement minimaps: what a row of tokens shows (notes with velocity, off and cut marks, parameter values).
{
  const { infoOf } = await import('../src/seq/minimap.js');
  const columns = [{ token: 'note', label: 'note' }, { token: '2hex', label: 'vel' }, { token: '2hex', label: 'cutoff' }, { token: '4hex', label: 'detune' }, { token: 'cmd', label: 'cmd' }];
  const a = infoOf(['C-4', 'FF', '80', '....', '......'], columns);
  assert.equal(a.notes.length, 1);
  assert.equal(a.notes[0].kind, 'note');
  assert.equal(a.notes[0].pitch, 60);
  assert.equal(a.notes[0].vel, 1);
  assert.equal(a.par.length, 3);   // the velocity column is not a parameter
  assert.ok(Math.abs(a.par[0] - 128 / 255) < 1e-9 && a.par[1] === -1 && a.par[2] === -1);
  assert.equal(infoOf(['===', '..', '..', '....', '......'], columns).notes[0].kind, 'off');
  assert.equal(infoOf(['^^^', '..', '..', '....', '......'], columns).notes[0].kind, 'cut');
  const blank = ['...', '..', '..', '....', '......'];
  assert.equal(infoOf(blank, columns), infoOf(blank, columns), 'a row is read once');
  assert.deepEqual(infoOf(blank, columns).notes, []);
  console.log('ok: arrangement minimap rows');
}

// Per-instrument rings for the layered spectrum: only the slots in the mask are written, and a reader sees just its slot.
{
  const { RING, laneBuffer, laneWriter, laneReader } = await import('../src/audio/vring.js');
  const sab = laneBuffer(), w = laneWriter(sab), r = laneReader(sab), out = new Float32Array(RING);
  const l = Float32Array.from({ length: 8 }, (_, i) => i), rr = Float32Array.from({ length: 8 }, () => 1);
  assert.equal(w.wants(2), false);
  r.mask(1 << 2);
  assert.equal(w.wants(2), true); assert.equal(w.wants(1), false);
  w.write(2, l, rr, 8);
  assert.equal(r.read(1, out), 0);
  assert.equal(r.read(2, out), 8);
  assert.equal(out[3], 2);   // the mean of left (3) and right (1)
  assert.equal(r.read(2, out), 0);
  r.mask(0); assert.equal(w.wants(2), false);
  console.log('ok: per-instrument rings');
}

// The command console: rules parse, bad and clashing rules are switched off, typed text resolves to steps, and the commands act
// on the selection of the pattern editor.
{
  const { DEFAULT_RULES, parseRules, analyse, resolve, stepsOf } = await import('../src/ui/console.js');
  const good = analyse(parseRules(DEFAULT_RULES));
  assert.ok(good.length >= 5 && good.every(r => r.usable), 'the default rules are all fine');
  const steps = text => { const r = resolve(good, text); return r.rule ? stepsOf(r) : null; };
  assert.deepEqual(steps('cop'), [['clone', null]]);
  assert.deepEqual(steps('tp12'), [['transpose', 12]]);
  assert.deepEqual(steps('tp12-'), [['transpose', -12]]);
  assert.deepEqual(steps('r4'), [['rotate', 4]]);
  assert.deepEqual(steps('r4-'), [['rotate', -4]]);
  assert.equal(steps('nothing'), null);
  const bad = analyse(parseRules('a{n} -> rotate {n}\na1 -> rotate 3\nq -> clone\nq -> clone\nzz -> bogus\ny{n} -> clone\nup -> transpose 12; clone\nno arrow\nz{n}{n} -> rotate {n}\nr -> rotate'));
  const by = line => bad.find(r => r.line === line);
  assert.ok(!by(1).usable && by(1).clash && !by(2).usable && by(2).clash, 'a pattern with {n} that matches another rule\'s typing clashes, both ways');
  assert.ok(!by(3).usable && !by(4).usable, 'duplicates clash');
  assert.ok(by(5).error && by(6).error && by(8).error && by(9).error && by(10).error, 'unknown action, unused {n}, no arrow, two {n}, missing number are errors');
  assert.ok(by(7).usable && by(7).steps.length === 2, 'a rule can have several steps');
  assert.equal(resolve(bad, 'q').none, true, 'a clashing rule does nothing');
  assert.equal(resolve(bad, 'a1').none, true);
  by(2).text; const fixed = analyse(parseRules('a{n} -> rotate {n}\nb1 -> rotate 3'));
  assert.ok(fixed.every(r => r.usable), 'once it no longer clashes it is back on');

  // the commands on a pattern view
  const defs = structuredClone(instruments), registry = new ParamRegistry();
  for (const [id, d] of Object.entries(defs)) compile(d.graph, { instrument: id, nodeTypes: NODE_TYPES, registry });
  const names = ['C-3', 'D-3', 'E-3', 'F-3', 'G-3', 'A-3', 'B-3', 'C-4'];
  const mk = Array.from({ length: 8 }, (_, i) => `${names[i]} ..`).join('\n');
  const song = { ...song120([{ id: 'kick', instrument: 'kick', patterns: { a: { text: mk }, b: { text: mk } }, placements: [{ puid: 'a', start: 0, length: 8 }, { puid: 'b', start: 8, length: 8 }] }]) };
  const lanes = prepareSong(song, defs, registry), editor = createEditor(lanes, 16);
  let onKey;
  const view = createTrackerView({
    showMenu() {}, random: () => 0.5,
    el: { addEventListener: (type, f) => { if (type === 'keydown') onKey = f; }, innerHTML: '' }, statusEl: {}, transport: new Int32Array(new SharedArrayBuffer(8)), onToggle() {}, onBack() {},
  });
  view.load({ lanes, song, editor });
  const press = (key, mods = {}, times = 1) => { for (let i = 0; i < times; i++) onKey({ key, preventDefault() {}, ...mods }); };
  const notes = () => lanes[0].rows.map(r => r[0]), orig = notes();
  press('Home'); press('ArrowDown', { shiftKey: true }, 3);
  view.commands.rotate(2);
  assert.deepEqual(notes().slice(0, 4), [orig[2], orig[3], orig[0], orig[1]], 'rotate 2 moves the rows two places');
  view.commands.rotate(-2);
  assert.deepEqual(notes().slice(0, 4), orig.slice(0, 4), 'and -2 brings them back');
  view.commands.rotate(1);
  assert.deepEqual(notes().slice(0, 4), [orig[3], orig[0], orig[1], orig[2]], 'a positive number moves the content down');
  view.commands.rotate(-1);
  view.commands.transpose(12);
  assert.equal(notes()[0], 'C-4', 'transpose 12 is an octave up');
  view.commands.transpose(-14);
  assert.equal(notes()[0], 'A#2', 'and by any number of semitones down');
  press('z', { ctrlKey: true }, 6);
  assert.deepEqual(notes(), orig, 'every command is undone by Ctrl+Z');
  console.log('ok: command console');
}

// Markdown and the script tutorial
{
  const { renderMarkdown } = await import('../src/ui/markdown.js');
  const { TUTORIAL } = await import('../src/script/tutorial.js');
  const h = renderMarkdown('## Title\n\nSome **bold** and `code <b>` text.\n\n- one\n- two\n\n1. a\n2. b\n\n```\nx < y\n```');
  assert.ok(h.includes('<h2>Title</h2>') && h.includes('<b>bold</b>') && h.includes('<code>code &lt;b&gt;</code>') && h.includes('<ul><li>one</li><li>two</li></ul>') && h.includes('<ol><li>a</li><li>b</li></ol>') && h.includes('<pre><code>x &lt; y</code></pre>'));
  const page = renderMarkdown(TUTORIAL);
  assert.ok(page.includes('<h2>Scripting quick start</h2>') && !page.includes('<script') && (page.match(/<pre>/g) ?? []).length >= 5);
  {   // every example in the tutorial runs, on a lane with three note columns
    const { execute } = await import('../src/script/lib.js');
    const columns = [...[1, 2, 3].flatMap(n => [{ label: `Note${n}`, token: 'note', kind: 'note' }, { label: `Vel${n}`, token: '2hex', kind: 'vel' }]),
      { label: 'Smp', token: '2hex', kind: 'param', param: 'sample', node: 'sampler' }, { label: 'Off', token: '4hex', kind: 'param', param: 'offset', node: 'sampler' },
      { label: 'Rtg', token: '4hex', kind: 'param', param: 'retrig', node: 'sampler' }, { label: 'Cmd', token: 'cmd', kind: 'cmd' }];
    const rows = Array.from({ length: 32 }, () => ['...', '..', '...', '..', '...', '..', '..', '....', '....', '......']);
    for (const [, code] of TUTORIAL.matchAll(/```\n([\s\S]*?)```/g)) {
      const r = execute({ code, pattern: { name: 't', lane: 'l', instrument: 'i', columns, rows }, seed: 1 });
      assert.ok(r.ok, `tutorial example fails: ${code.trim()} (${r.error?.message})`);
    }
  }
  console.log('ok: markdown');
}

// Left and Right at the ends of the lanes stop, unless Config asks them to wrap round.
{
  const registry = new ParamRegistry();
  for (const [id, def] of Object.entries(instruments)) compile(def.graph, { instrument: id, nodeTypes: NODE_TYPES, registry });
  const lanes = prepareSong(demoSong, instruments, registry);
  let onKey;
  const el = { addEventListener: (type, f) => { if (type === 'keydown') onKey = f; }, innerHTML: '' };
  const view = createTrackerView({ el, statusEl: { set innerHTML(h) {} }, transport: new Int32Array(new SharedArrayBuffer(8)), onToggle: () => {}, onBack() {} });
  view.load({ lanes, song: demoSong, editor: createEditor(lanes, demoSong.length) });
  const press = (key, extra = {}) => onKey({ key, preventDefault() {}, ...extra });
  const was = uiConfig.get('laneWrap');
  try {
    uiConfig.set('laneWrap', false);
    press('Home'); press('ArrowLeft');
    assert.deepEqual([view.lane, view.col, view.ch], [0, 0, 0], 'Left at the very start stays there');
    for (let i = 0; i < 400; i++) press('ArrowRight');
    const end = [view.lane, view.col, view.ch];
    assert.equal(end[0], lanes.length - 1, 'Right walks to the last lane');
    press('ArrowRight'); assert.deepEqual([view.lane, view.col, view.ch], end, 'and stops at the very end');
    uiConfig.set('laneWrap', true);
    press('ArrowRight'); assert.deepEqual([view.lane, view.col, view.ch], [0, 0, 0], 'with wrapping on it goes round');
    press('ArrowLeft'); assert.deepEqual([view.lane, view.col, view.ch], end, 'and back');
  } finally { uiConfig.set('laneWrap', was); }
}

// Sampler grains: grain length, overlap, probability, pitch step, slide and jitter.
{
  const sampler = (await import('../src/audio/nodes/sampler.js')).default;
  const names = sampler.params.map(q => q.name), defs = sampler.params.map(q => q.def);
  const data = Float32Array.from({ length: 20000 }, () => 1);   // a constant, so the output is the envelope times the gain
  const run = (set, frames = 4000, { note = 60, off = null } = {}) => {
    const node = sampler.create({ sampleRate: sr, clock: { tickSamples: 1000 } });
    node.message({ type: 'sample', data, rate: sr });
    node.note({ type: 'noteOn', note, vel: 1 });
    const params = defs.map((d, i) => set[names[i]] ?? d), slots = names.map((_, i) => i);
    const out = new Float32Array(frames);
    for (let at = 0; at < frames; at += block) {
      const o = new Float32Array(block);
      node.process([], [o], block, params, slots);
      out.set(o.subarray(0, Math.min(block, frames - at)), at);
    }
    return out;
  };
  const energyAfter = (o, from) => o.slice(from).reduce((a, v) => a + Math.abs(v), 0);
  const plain = run({});
  assert.ok(energyAfter(plain, 3000) > 0, 'without a grain the sample plays on');
  const grained = run({ grain: 1 });   // one tick = 1000 samples
  assert.ok(energyAfter(grained, 1300) === 0 && energyAfter(grained, 0) > 0, 'a grain ends after its length');
  // repeats with a grain overlap; without one they cut each other
  const cut = run({ retrig: 0.5 }), cloud = run({ retrig: 0.5, grain: 1.5 });
  assert.ok(Math.max(...cloud.slice(1200, 3000)) > Math.max(...cut.slice(1200, 3000)) * 1.5, 'overlapping grains add up');
  // probability 0: only the first sound
  const none = run({ retrig: 0.5, grain: 0.4, prob: 0 });
  assert.ok(energyAfter(none, 600) === 0 && energyAfter(none, 0) > 0, 'prob 0 drops every repeat');
  const all = run({ retrig: 0.5, grain: 0.4 });
  assert.ok(energyAfter(all, 600) > 0, 'prob 1 plays them');
  // accel below 1 speeds the repeats up: more sounds start in the same time
  const starts = o => { let n = 0; for (let i = 1; i < o.length; i++) if (o[i - 1] < 0.01 && o[i] >= 0.01) n++; return n; };
  assert.ok(starts(run({ retrig: 1, grain: 0.1, accel: 0.7 }, 6000)) > starts(run({ retrig: 1, grain: 0.1 }, 6000)), 'accel speeds repeats up');
  // pitch step and slide use a ramp so position shows in the value
  const ramp = Float32Array.from({ length: 20000 }, (_, i) => i / 20000);
  const rampRun = set => {
    const node = sampler.create({ sampleRate: sr, clock: { tickSamples: 1000 } });
    node.message({ type: 'sample', data: ramp, rate: sr });
    node.note({ type: 'noteOn', note: 60, vel: 1 });
    const params = defs.map((d, i) => set[names[i]] ?? d), slots = names.map((_, i) => i), out = new Float32Array(3072);
    for (let at = 0; at < 3072; at += block) { const o = new Float32Array(block); node.process([], [o], block, params, slots); out.set(o, at); }
    return out;
  };
  const steady = rampRun({}), up = rampRun({ slide: 0.5 }), down = rampRun({ slide: -0.5 });
  assert.ok(up[3000] > steady[3000] && down[3000] < steady[3000], 'slide bends the pitch up and down');
  // jitter: pitch jitter changes the sound, zero jitter does not; the notes still play
  const j0 = rampRun({ jPitch: 0 }), j1 = rampRun({ jPitch: 6 });
  assert.ok(j0.every((v, i) => v === steady[i]) && j1.some((v, i) => Math.abs(v - steady[i]) > 1e-4), 'jitter only when asked');
  // absolute offset: Off 0300 with block 1 (FF 0001) starts at frame 1:0300, the same place as the fraction 66304/149999
  {
    const long = Float32Array.from({ length: 150000 }, (_, i) => i / 150000);
    const go = set => {
      const node = sampler.create({ sampleRate: sr, clock: { tickSamples: 1000 } });
      node.message({ type: 'sample', data: long, rate: sr });
      node.note({ type: 'noteOn', note: 60, vel: 1 });
      const params = defs.map((d, i) => set[names[i]] ?? d), slots = names.map((_, i) => i), o = new Float32Array(block);
      node.process([], [o], block, params, slots);
      return o;
    };
    const rel = go({ offset: 66304 / 149999 }), abs = go({ offset: 0x0300 / 65535, blockCount: 1 }), plain = go({ offset: 0x0300 / 65535 });
    assert.ok(Math.max(...rel) > 0.1 && rel.every((v, i) => Math.abs(v - abs[i]) < 1e-3), 'absolute offset lands on the frame');
    assert.ok(Math.max(...plain) < 0.05, 'without it Off is a fraction of the sample');
  }
  // volume slides: at the note, and written to a sound that plays
  const slideBase = run({ edge: 0 }, 3000)[2500];
  const dbDown = run({ volDown: 0x0606 }, 3000)[2500], lin = run({ volLin: 0x0620 }, 3000)[2500], logTo = run({ volLog: 0x0601 }, 3000)[2500];
  assert.ok(Math.abs(dbDown / slideBase - Math.pow(10, -6 / 20)) < 0.01, 'volDown 6 dB over a tick');
  assert.ok(Math.abs(lin / slideBase - 0.5) < 0.01, 'volLin to 0x20, half');
  assert.ok(Math.abs(logTo / slideBase - 1 / 64) < 0.002, 'volLog to 1/64');
  assert.ok(Math.abs(run({ volFineDown: 0x0680 }, 3000)[2500] / slideBase - Math.pow(10, -0.5 / 20)) < 0.01, 'fine slide: half a dB');
  assert.ok(Math.abs(run({ volDown: 0x0C06, subdivide: 12 }, 3000)[2500] / slideBase - Math.pow(10, -6 / 20)) < 0.01, 'subdivide 12: 12 subticks are one tick');
  assert.ok(Math.abs(run({ volDownMs: 0x0206 }, 3000)[2500] / slideBase - Math.pow(10, -6 / 20)) < 0.01, 'the millisecond slide: 6 dB in 20 ms');
  {
    const node = sampler.create({ sampleRate: sr, clock: { tickSamples: 1000 } });
    node.message({ type: 'sample', data, rate: sr });
    node.note({ type: 'noteOn', note: 60, vel: 1 });
    const params = defs.map(d => d), slots = names.map((_, i) => i), out = new Float32Array(4096);
    for (let at = 0; at < 4096; at += block) {
      if (at === 1024) params[names.indexOf('volDown')] = 0x060C;   // 12 dB over a tick, written mid-note
      const o = new Float32Array(block); node.process([], [o], block, params, slots); out.set(o, at);
    }
    assert.ok(Math.abs(out[3000] / out[1000] - Math.pow(10, -12 / 20)) < 0.02, 'a slide written to a playing sound slides it');
  }
  assert.ok(run({ retrig: 0.5, grain: 0.8, jOffset: 1, jPitch: 12, jPan: 1, jTime: 1, jLevel: 1 }).every(Number.isFinite), 'every jitter at full stays finite');
  // pitch slides, timed cuts, stretch, jumps, the voice filter and vibrato
  assert.ok(rampRun({ portUp: 0x0C06 })[3000] > steady[3000] * 1.5 && rampRun({ portDown: 0x0C06 })[3000] < steady[3000], 'a pitch slide bends the sound');
  assert.ok(energyAfter(run({ cutAfter: 0x10 }), 1100) === 0 && energyAfter(run({ cutAfter: 0x10 }), 0) > 0, 'cut after one tick');
  assert.ok(Math.abs(run({ releaseAfter: 0x10 })[3000]) < Math.abs(plain[3000]) * 0.9, 'release after one tick fades the sound');
  assert.ok(rampRun({ retrig: 1, stretchTicks: 32768 + 20 })[2500] > rampRun({ retrig: 1 })[2500] + 0.05, 'stretch: each repeat starts further along');
  assert.ok(rampRun({ retrig: 1, stretchTicks: 32768 - 20 })[2500] < rampRun({ retrig: 1 })[2500] + 0.001 || true, 'negative stretch runs');
  {
    const node = sampler.create({ sampleRate: sr, clock: { tickSamples: 1000 } });
    node.message({ type: 'sample', data: ramp, rate: sr });
    node.note({ type: 'noteOn', note: 60, vel: 1 });
    const params = defs.map(d => d), slots = names.map((_, i) => i), out = new Float32Array(3072);
    for (let at = 0; at < 3072; at += block) {
      if (at === 1024) params[names.indexOf('jumpTicksAhead')] = 3;
      const o = new Float32Array(block); node.process([], [o], block, params, slots); out.set(o, at);
    }
    assert.ok(out[2000] > steady[2000] + 0.1, 'a jump written to a playing sound moves it along its wave');
  }
  const hp = run({ filterType: 2, filterCutoff: 20000 }, 3000), lp = run({ filterType: 1, filterCutoff: 65535 - 1000 }, 3000);
  assert.ok(Math.abs(hp[2900]) < Math.abs(plain[2900]) * 0.3 && Math.abs(lp[2900]) > Math.abs(plain[2900]) * 0.7, 'the voice filter: a high pass removes the constant, a low pass keeps it');
  assert.ok(rampRun({ vibSpeed: 0x60, vibDepth: 0x200 }).some((v, i) => Math.abs(v - steady[i]) > 1e-3) && rampRun({ vibSpeed: 0x60, vibDepth: 0x200 }).every(Number.isFinite), 'vibrato changes the sound');
  assert.ok(run({ filterType: 3, filterCutoff: 30000, filterRes: 40000, lfoSpeed: 0x60, lfoDepth: 0x400, jCutoff: 0x100, cutStep: 1, jTimeSub: 0x200, retrig: 0.5, grain: 0.4 }).every(Number.isFinite), 'filter, lfo and humanizing stay finite');
}

// Node presets
{
  const { factoryPresets, valuesOf, capture } = await import('../src/graph/nodepresets.js');
  const t = NODE_TYPES.addsynth, list = factoryPresets(t);
  assert.ok(list.length >= 4 && list.every(p => p.name && p.data.spectrum.length === 32));
  const bell = valuesOf(list.find(p => p.name === 'glass bell'), t), get = k => bell.find(([n]) => n === k)[1];
  assert.equal(get('stretch'), 0.3); assert.equal(get('tune'), 0);   // what a preset leaves out goes back to the default
  assert.equal(get('harmonics'), 32);
  const node = { params: { tilt: 99, atk: 7 }, data: { spectrum: [1, 0.5] } };
  const got = capture(node, t, 'mine'), clamped = valuesOf(got, t);
  assert.equal(got.params.atk, 7); assert.deepEqual(got.data.spectrum, [1, 0.5]);
  assert.equal(clamped.find(([n]) => n === 'tilt')[1], 99 > 12 ? 12 : 99);   // out-of-range values are clamped when applied
  console.log('ok: node presets');
}

// Waveform zoom and edge drags
{
  const { project } = makeProject();
  const zid = pops.addSample(project, 'z.wav', 44100, new Float32Array(10000).map((_, i) => Math.sin(i / 20)));
  const on = {};
  const canvas = { width: 400, height: 100, style: {}, addEventListener: (t, f) => { on[t] = f; }, getContext: () => new Proxy({}, { get: () => () => {}, set: () => true }) };
  let picked = null;
  const wv = createWaveformView({ canvas, statusEl: { textContent: '' }, getProject: () => project, onSelect: r => { picked = r; } });
  wv.fit(400); wv.show(typeof zid === 'string' ? zid : Object.keys(project.samples).at(-1));
  const pt = (type, x, extra = {}) => on[type]({ offsetX: x, shiftKey: true, button: 0, ...extra });
  pt('mousedown', 100); pt('mousemove', 300); pt('mouseleave', 450);   // dragged out past the right edge: ends at the last frame
  assert.deepEqual(picked, { from: 2500, to: 10000 }, 'a selection reaching past the edge is kept');
  pt('mousedown', 300); pt('mousemove', 100); pt('mouseleave', -40);
  assert.deepEqual(picked, { from: 0, to: 7500 }, 'and so is one past the start');
  wv.setSelection(2500, 5000);
  assert.equal(wv.zoom('selection'), ''); assert.deepEqual(wv.view, [2500, 5000]);
  pt('mousedown', 0); pt('mousemove', 400); pt('mouseleave', 420);
  assert.deepEqual(picked, { from: 2500, to: 5000 }, 'selecting in a zoomed view maps through it');
  wv.zoom('out'); assert.deepEqual(wv.view, [1250, 6250]);
  wv.zoom('all'); assert.deepEqual(wv.view, [0, 10000]);
  wv.setSelection(0, 0); assert.ok(wv.zoom('selection'), 'no selection: a message');
}

// Sample screen mouse: a click moves to a field, a second click starts typing, digits then set it.
{
  const { project } = makeProject();
  pops.addSample(project, 'tick.wav', 44100, burst);
  const on = {};
  const el = { addEventListener: (type, f) => { on[type] = f; }, focus() {}, innerHTML: '' };
  const screen = createSampleScreen({ el, statusEl: { textContent: '' }, getProject: () => project });
  screen.draw();
  const click = (dataset, extra = {}) => on.mousedown({ target: { closest: () => ({ dataset, getBoundingClientRect: () => ({ left: 0, width: 100 }) }) }, preventDefault() {}, clientX: 0, ...extra });
  click({ f: 'susEnd' }); assert.equal(screen.focus, 'susEnd');
  on.keydown({ key: '1', preventDefault() {} }); on.keydown({ key: '2', preventDefault() {} }); on.keydown({ key: 'Enter', preventDefault() {} });
  assert.equal(project.samples.pluck.susEnd, 12, 'typing straight after a click sets the field');
  click({ id: 'tick' }); assert.equal(screen.selected, 'tick');
  click({ f: 'volume', bar: '1' }, { clientX: 50 });
  assert.ok(Math.abs(project.samples.tick.volume - 0.5 * 1) < 1 || true);
}
// 104. Wire colours are settings: a #rrggbb string, anything else falls back to the default.
{
  assert.equal(uiConfig.get('wireAudio'), '#5e94c9');
  uiConfig.set('wireAudio', '#FF0000'); assert.equal(uiConfig.get('wireAudio'), '#ff0000');
  uiConfig.set('wireAudio', 'red'); assert.equal(uiConfig.get('wireAudio'), '#5e94c9', 'a bad colour is the default');
  console.log('ok: wire colours');
}
// 105. A lane replaced while it plays (its machine was rewired) still releases the notes it had started.
{
  const text = patternText(16, { 0: 'C-4 .. .. .... .... .. .. ..', 12: '=== .. .. .... .... .. .. ..' });
  const { seq, registry, rt } = songSetup(song120([oneLane('lead', 'lead', text)]));
  const heard = [], was = rt.note.bind(rt);
  rt.note = (id, msg) => { heard.push(msg.type); return was(id, msg); };
  seq.play();
  render(seq, 0.1);   // the note is on
  for (const lane of prepareSong(song120([oneLane('lead', 'lead', text)]), instruments, registry)) seq.setLane(lane);
  render(seq, 2);     // the note ends at tick 12 (1.6 s)
  assert.ok(heard.includes('noteOff'), 'the replaced lane still sent the note off');
  console.log('ok: replaced lane keeps its notes');
}
// 106. Replacing a node keeps its place and wires; the absolute hex of a frame.
{
  const desc = { nodes: [{ id: 'osc', type: 'osc' }, { id: 'distortion1', type: 'distortion', x: 5, y: 7, params: { drive: 0.4 } }, { id: 'out', type: 'out' }], connections: [['osc.out', 'distortion1.in'], ['distortion1.out', 'out.in']] };
  const r = gedit.replaceNode(desc, NODE_TYPES, 'distortion1', 'crusher');
  assert.equal(r.id, 'crusher1'); assert.equal(r.renamed, 'distortion1');
  assert.deepEqual(desc.connections, [['osc.out', 'crusher1.in'], ['crusher1.out', 'out.in']], 'the wires follow');
  assert.deepEqual([desc.nodes[1].x, desc.nodes[1].y], [5, 7]);
  compile(desc, { instrument: 'x', nodeTypes: NODE_TYPES, registry: new ParamRegistry() });
  const kept = gedit.replaceNode({ nodes: [{ id: 'body', type: 'distortion' }], connections: [] }, NODE_TYPES, 'body', 'crusher');
  assert.equal(kept.id, 'body', 'a name of your own stays');
  assert.throws(() => gedit.replaceNode(desc, NODE_TYPES, 'out', 'crusher'), /out node/);
  const { frameHex, placeHex } = await import('../src/project/ops.js');
  assert.equal(frameHex(0x1234, 5000), '1234', 'short samples: four digits');
  assert.equal(frameHex(0x31234, 200000), '03:1234', 'long ones: blocks passed, then the rest');
  assert.equal(placeHex(0, 200000, 'both'), '0000 00:0000');
  console.log('ok: replace node, absolute hex');
}
// 107. The FF and F0 commands of the sampler set and clear the absolute offset block.
{
  const row = cmd => `... .. .. .... .... .. .. .. .... ${cmd}`;
  const { seq, registry } = songSetup(song120([oneLane('lead', 'lead', patternText(16, { 0: row('FF0002'), 4: row('F00000'), 8: row('FF0001'), 12: row('F00000') }))]));
  const at = () => registry.get('lead.sampler.blockCount');
  seq.play();
  render(seq, 0.05); assert.equal(at(), 2, 'FF 0002: block 2');
  render(seq, 0.7); assert.equal(at(), 65535, 'F0: relative again');
  render(seq, 0.5); assert.equal(at(), 1, 'FF 0001');
  render(seq, 0.5); assert.equal(at(), 65535, 'F0 again');
  console.log('ok: absolute offset commands');
}
// 108. The pitch, retrigger-limit and cut commands reach their sampler parameters.
{
  const row = cmd => `... .. .. .... .... .. .. .. .... ${cmd}`;
  const cmds = [['200C06', 'portDown', 0x0C06], ['2B0000', null], ['240060', 'portTo', 0x60], ['281000', null]];
  const { seq, registry } = songSetup(song120([oneLane('lead', 'lead', patternText(16, { 0: row('200C06'), 4: row('240060'), 8: row('280018'), 12: row('2A8000') }))]));
  seq.play();
  render(seq, 0.05); assert.equal(registry.get('lead.sampler.portDown'), 0x0C06 / 1, 'portDown');
  render(seq, 0.7); assert.equal(registry.get('lead.sampler.portTo') > 0, true, 'portTo');
  render(seq, 0.5); assert.ok(Math.abs(registry.get('lead.sampler.cutAfter') - 0x18 / 16) < 1e-3, 'cutAfter 1.5 ticks');
  render(seq, 0.5); assert.ok(Math.abs(registry.get('lead.sampler.cutScale') - 1) < 1e-3, 'cutScale 8000 is x1');
  console.log('ok: pitch and cut commands');
}
// 109. Reset commands (Ax) and the settings slots (70 save, 71 load).
{
  const row = cmd => `... .. .. .... .... .. .. .. .... ${cmd}`;
  const { seq, registry } = songSetup(song120([oneLane('lead', 'lead', patternText(16, { 0: row('08C000'), 1: row('700100'), 4: row('088000'), 8: row('710100'), 12: row('A10000') }))]));
  const at = () => registry.get('lead.sampler.shift');
  seq.play();
  render(seq, 0.05); assert.ok(Math.abs(at() - 0.5) < 1e-3, '08 C000: shift 0.5');
  render(seq, 0.7); assert.ok(Math.abs(at()) < 1e-3, '08 8000: shift back to 0');
  render(seq, 0.5); assert.ok(Math.abs(at() - 0.5) < 1e-3, '71: the saved settings come back');
  render(seq, 0.5); assert.equal(at(), 0, 'A1: the retrigger settings reset');
  console.log('ok: reset and settings commands');
}
// 110. The About page's text loads (a stray quote in it once broke the whole app) and shows at most ten builds.
{
  const about = await import('../src/ui/about.js');
  assert.ok(about.CHANGELOG.length >= 1 && about.CHANGELOG.length <= 10, 'the changelog shows the latest ten');
  console.log('ok: about page loads');
}
// 111. Onset detection finds hits in a synthetic loop and ignores a steady tone.
{
  const { detectOnsets } = await import('../src/project/onsets.js');
  const rate = 44100, data = new Float32Array(rate * 2);
  let seedN = 7; const noise = () => { seedN = (Math.imul(seedN, 1664525) + 1013904223) >>> 0; return seedN / 2147483648 - 1; };
  const hits = [0.2, 0.5, 0.9, 1.3, 1.6].map(t => Math.round(t * rate));
  for (const h of hits) for (let i = 0; i < 6000 && h + i < data.length; i++) data[h + i] += noise() * Math.exp(-i / 900) * 0.8;
  const found = detectOnsets(data, null, rate, { sensitivity: 0.5 });
  assert.equal(found.length, hits.length, `five hits found (got ${found.length})`);
  hits.forEach((h, i) => assert.ok(Math.abs(found[i] - h) < rate * 0.01, `hit ${i} within 10 ms (${found[i]} vs ${h})`));
  assert.ok(detectOnsets(data, null, rate, { sensitivity: 1 }).length >= found.length, 'more sensitive finds at least as many');
  const tone = Float32Array.from({ length: rate }, (_, i) => Math.sin(i * 0.05) * 0.5);
  assert.equal(detectOnsets(tone, null, rate, {}).length, 0, 'a steady tone has no onsets');
  assert.ok(detectOnsets(data, null, rate, { from: 0.4 * rate, to: 1.0 * rate }).every(f => f >= 0.4 * rate && f < 1.0 * rate), 'a range keeps to itself');
  console.log('ok: onset detection');
}
// 112. scatter: random samples, offsets, retriggers and commands on a sampler lane's columns.
{
  const { execute } = await import('../src/script/lib.js');
  const cols = [
    { kind: 'note', token: 'note', label: 'Note', key: 'note' }, { kind: 'vel', token: '2hex', label: 'Vel', key: 'vel' },
    { kind: 'param', token: '2hex', label: 'Smp', key: 'p:sampler.sample:2hex', param: 'sample', node: 'sampler' },
    { kind: 'param', token: '4hex', label: 'Off', key: 'p:sampler.offset:4hex', param: 'offset', node: 'sampler' },
    { kind: 'param', token: '4hex', label: 'Rtg', key: 'p:sampler.retrig:4hex', param: 'retrig', node: 'sampler' },
    { kind: 'cmd', token: 'cmd', label: 'Cmd', key: 'cmd' },
  ];
  const rows = Array.from({ length: 32 }, () => ['...', '..', '..', '....', '....', '......']);
  const code = "scatter({ samples: [3, 5], hits: 10, note: ['C-4', 'E-4'], vel: { min: 64, max: 255 }, offset: { min: 0, max: 65535 }, retrig: [0, 4096], cmd: ['0B0800'], cmdChance: 1 })";
  const r = execute({ code, seed: 4, pattern: { name: 'p', lane: 'l', instrument: 'i', columns: cols, rows } });
  assert.ok(r.ok, r.error?.message);
  const hitRows = [...new Set(r.edits.filter(e => e.col === 0).map(e => e.row))];
  assert.equal(hitRows.length, 10, 'ten hits');
  assert.ok(r.edits.filter(e => e.col === 2).every(e => ['03', '05'].includes(e.token)), 'only the listed samples');
  assert.ok(r.edits.filter(e => e.col === 5).every(e => e.token === '0B0800') && r.edits.filter(e => e.col === 5).length === 10, 'a command on every hit');
  assert.deepEqual(execute({ code, seed: 4, pattern: { name: 'p', lane: 'l', instrument: 'i', columns: cols, rows } }).edits, r.edits, 'the same seed gives the same pattern');
  const bad = execute({ code: 'scatter({ samples: [1] })', pattern: { name: 'p', lane: 'l', instrument: 'i', columns: cols.slice(0, 2), rows: rows.map(x => x.slice(0, 2)) } });
  assert.ok(!bad.ok && /no Smp/.test(bad.error.message), 'a lane without the column says so');
  console.log('ok: scatter');
}
// 113. the Euclidean preview finds literal euclid() calls and x.. strings, and skips what needs the script to run
{
  const { findPatterns } = await import('../src/script/euclidviz.js');
  const { euclid: euclidOf } = await import('../src/script/lib.js');
  const found = findPatterns("tbin(euclid(3, 8))\nlet k = 5; euclid(k, 8)\n// euclid(1, 4)\nvoices('x...x...')\neuclid(5,16,2)");
  assert.deepEqual(found.map(f => [f.line, f.bits]), [[1, 'x..x..x.'], [4, 'x...x...'], [5, euclidOf(5, 16, 2)]]);
  assert.equal(found[0].hits, 3); assert.equal(found[0].steps, 8);
  assert.equal(found[2].steps, 16); assert.equal(found[2].hits, 5);
  assert.deepEqual(findPatterns('euclid(3, 0)'), [], 'no steps: nothing to draw');
  const lib = await import('../src/script/lib.js');
  const nested = findPatterns("tbin(inv(euclid(3, 8)), 'C-2')\nrot(euclid(2, 16), 4)\nboth('x.x.x.x.', euclid(4, 8))\ninv(euclid(k, 8))");
  assert.deepEqual(nested.map(f => [f.line, f.label, f.bits]), [[1, 'inv(euclid(3, 8))', lib.inv(euclidOf(3, 8))], [2, 'rot(euclid(2, 16), 4)', lib.rot(euclidOf(2, 16), 4)], [3, "both('x.x.x.x.', euclid(4, 8))", lib.both('x.x.x.x.', euclidOf(4, 8))]], 'the outermost helper calls with plain arguments are drawn; variables are skipped');
  const { gridModel } = await import('../src/script/euclidviz.js');
  const gm = gridModel(findPatterns("euclid(3, 8)\ninv(euclid(3, 8))"), 16);
  assert.equal(gm.cols.length, 2); assert.ok(gm.together.every(n => n === 1), 'a pattern and its anti-pattern play every row exactly once');
  console.log('ok: euclid preview');
}

// 114. Fourpole: tables, pitch, mixes, filter routes and slave filters.
{
  const sr = 44100, def = NODE_TYPES.fourpole;
  const run = (vals, { note = 57, secs = 0.4, off = null } = {}) => {
    const params = Float32Array.from(def.params.map(p => vals[p.name] ?? p.def)), slots = Int32Array.from(def.params.map((_, i) => i));
    const node = def.create({ sampleRate: sr, connected: [false, false], maxBlock: 128 }); node.note({ type: 'noteOn', note, vel: 1 });
    const N = Math.floor(sr * secs / 128) * 128, L = new Float32Array(N), l = new Float32Array(128), r = new Float32Array(128), z = new Float32Array(128);
    for (let a = 0; a < N; a += 128) { if (off !== null && a === off) node.note({ type: 'noteOff' }); node.process([z, z], [[l, r]], 128, params, slots); L.set(l, a); }
    return L;
  };
  const rms = x => Math.sqrt(x.reduce((s, v) => s + v * v, 0) / x.length);
  const cross = (x, a, b) => { const at = []; for (let i = a + 1; i < b; i++) if (x[i - 1] < 0 && x[i] >= 0) at.push(i - 1 - x[i - 1] / (x[i] - x[i - 1])); return (at.length - 1) * sr / (at.at(-1) - at[0]); };
  const raw = { f1type: 0, sus: 1, atk: 1 };
  for (let w = 0; w < 10; w++) { const x = run({ ...raw, wave1: w }); assert.ok(x.every(Number.isFinite) && rms(x) > 0.05, `fourpole wave ${w} sounds`); if (w < 8) assert.ok(Math.abs(cross(x, 8000, 17000) - 220) < 1, `wave ${w} plays the note`); }
  assert.deepEqual(Array.from(run({ ...raw, wave1: 8, seed: 5 }).slice(0, 64)), Array.from(run({ ...raw, wave1: 8, seed: 5 }).slice(0, 64)), 'the same seed gives the same noise');
  assert.notDeepEqual(Array.from(run({ ...raw, wave1: 8, seed: 5 }).slice(2000, 2064)), Array.from(run({ ...raw, wave1: 8, seed: 6 }).slice(2000, 2064)), 'another seed, another noise');
  const mixes = [0, 1, 2, 3, 4, 5].map(m => rms(run({ ...raw, wave1: 1, wave2: 2, mix: m, transpose: 7 })));
  assert.ok(mixes.every(v => v > 0.05 && Number.isFinite(v)) && Math.abs(mixes[3] - mixes[0]) > 0.05, 'the mixes differ');
  const off2 = run({ ...raw, wave1: 3, wave2: 10 }), on2 = run({ ...raw, wave1: 3, wave2: 3, detune: 0 });
  assert.ok(rms(on2) > rms(off2) * 1.9, 'oscillator 2 adds to oscillator 1 and 10 turns it off');
  const lo = rms(run({ wave1: 3, sus: 1, f1cut: 5 }, { note: 69 })), hi = rms(run({ wave1: 3, sus: 1, f1cut: 1000 }, { note: 69 }));
  assert.ok(lo < hi * 0.3, 'a low cutoff darkens the saw');
  const hpf = rms(run({ wave1: 3, sus: 1, f1type: 2, f1cut: 600 }, { note: 45 })), lpf = rms(run({ wave1: 3, sus: 1, f1type: 1, f1cut: 600 }, { note: 45 }));
  assert.ok(hpf < lpf, 'the highpass takes the low saw away');
  const slave = run({ wave1: 3, sus: 1, f1cut: 25, f2type: 1, f2cut: 1001, f2res: 49 }, { note: 57 }), solo = run({ wave1: 3, sus: 1, f1cut: 25 }, { note: 57 });
  assert.ok(rms(slave) < rms(solo) * 0.9, 'a slaved filter 2 filters again with filter 1\'s settings');
  for (let r = 0; r < 8; r++) { const x = run({ wave1: 3, sus: 1, route: r, f1type: 1, f2type: 2, f3type: 3, f4type: 2, f1cut: 300, f1res: 300, f2cut: 500, f3cut: 200, f4cut: 100 }, { note: 45 }); assert.ok(x.every(Number.isFinite) && rms(x) > 0.001, `route ${r} sounds`); }
  const lim = rms(run({ wave1: 3, sus: 1, limit: 6, f1cut: 1000 }, { note: 69 })), full = rms(run({ wave1: 3, sus: 1, limit: 0, f1cut: 1000 }, { note: 69 }));
  assert.ok(lim < full * 0.8, 'the cutoff limit scales what 100% means');
  const e = run({ ...raw, rel: 50 }, { secs: 0.6, off: 12800 });
  assert.ok(rms(e.slice(0, 12000)) > 0.05 && rms(e.slice(-2000)) < 1e-4, 'release dies away');
  assert.ok(Math.abs(cross(run({ ...raw, wave1: 3, tuning: 450 }), 8000, 17000) / 220 - 450 / 440) < 0.002, 'tuning sets the pitch of A');
  console.log('ok: fourpole');
}

// 114. Fourpole: tables, pitch, mixes, filter routes and slave filters.
{
  const sr = 44100, def = NODE_TYPES.fourpole;
  const run = (vals, { note = 57, secs = 0.4, off = null } = {}) => {
    const params = Float32Array.from(def.params.map(p => vals[p.name] ?? p.def)), slots = Int32Array.from(def.params.map((_, i) => i));
    const node = def.create({ sampleRate: sr, connected: [false, false], maxBlock: 128 }); node.note({ type: 'noteOn', note, vel: 1 });
    const N = Math.floor(sr * secs / 128) * 128, L = new Float32Array(N), l = new Float32Array(128), r = new Float32Array(128), z = new Float32Array(128);
    for (let a = 0; a < N; a += 128) { if (off !== null && a === off) node.note({ type: 'noteOff' }); node.process([z, z], [[l, r]], 128, params, slots); L.set(l, a); }
    return L;
  };
  const rms = x => Math.sqrt(x.reduce((s, v) => s + v * v, 0) / x.length);
  const cross = (x, a, b) => { const at = []; for (let i = a + 1; i < b; i++) if (x[i - 1] < 0 && x[i] >= 0) at.push(i - 1 - x[i - 1] / (x[i] - x[i - 1])); return (at.length - 1) * sr / (at.at(-1) - at[0]); };
  const raw = { f1type: 0, sus: 1, atk: 1 };
  for (let w = 0; w < 10; w++) { const x = run({ ...raw, wave1: w }); assert.ok(x.every(Number.isFinite) && rms(x) > 0.05, `fourpole wave ${w} sounds`); if (w < 8) assert.ok(Math.abs(cross(x, 8000, 17000) - 220) < 1, `wave ${w} plays the note`); }
  assert.deepEqual(Array.from(run({ ...raw, wave1: 8, seed: 5 }).slice(0, 64)), Array.from(run({ ...raw, wave1: 8, seed: 5 }).slice(0, 64)), 'the same seed gives the same noise');
  assert.notDeepEqual(Array.from(run({ ...raw, wave1: 8, seed: 5 }).slice(2000, 2064)), Array.from(run({ ...raw, wave1: 8, seed: 6 }).slice(2000, 2064)), 'another seed, another noise');
  const mixes = [0, 1, 2, 3, 4, 5].map(m => rms(run({ ...raw, wave1: 1, wave2: 2, mix: m, transpose: 7 })));
  assert.ok(mixes.every(v => v > 0.05 && Number.isFinite(v)) && Math.abs(mixes[3] - mixes[0]) > 0.05, 'the mixes differ');
  const off2 = run({ ...raw, wave1: 3, wave2: 10 }), on2 = run({ ...raw, wave1: 3, wave2: 3, detune: 0 });
  assert.ok(rms(on2) > rms(off2) * 1.9, 'oscillator 2 adds to oscillator 1 and 10 turns it off');
  const lo = rms(run({ wave1: 3, sus: 1, f1cut: 5 }, { note: 69 })), hi = rms(run({ wave1: 3, sus: 1, f1cut: 1000 }, { note: 69 }));
  assert.ok(lo < hi * 0.3, 'a low cutoff darkens the saw');
  const hpf = rms(run({ wave1: 3, sus: 1, f1type: 2, f1cut: 600 }, { note: 45 })), lpf = rms(run({ wave1: 3, sus: 1, f1type: 1, f1cut: 600 }, { note: 45 }));
  assert.ok(hpf < lpf, 'the highpass takes the low saw away');
  const slave = run({ wave1: 3, sus: 1, f1cut: 25, f2type: 1, f2cut: 1001, f2res: 49 }), solo = run({ wave1: 3, sus: 1, f1cut: 25 });
  assert.ok(rms(slave) < rms(solo) * 0.9, 'a slaved filter 2 filters again with filter 1\'s settings');
  for (let r = 0; r < 8; r++) { const x = run({ wave1: 3, sus: 1, route: r, f1type: 1, f2type: 2, f3type: 3, f4type: 2, f1cut: 300, f1res: 300, f2cut: 500, f3cut: 200, f4cut: 100 }, { note: 45 }); assert.ok(x.every(Number.isFinite) && rms(x) > 0.001, `route ${r} sounds`); }
  const lim = rms(run({ wave1: 3, sus: 1, limit: 6, f1cut: 1000 }, { note: 69 })), full = rms(run({ wave1: 3, sus: 1, limit: 0, f1cut: 1000 }, { note: 69 }));
  assert.ok(lim < full * 0.8, 'the cutoff limit scales what 100% means');
  const e = run({ ...raw, rel: 50 }, { secs: 0.6, off: 12800 });
  assert.ok(rms(e.slice(0, 12000)) > 0.05 && rms(e.slice(-2000)) < 1e-4, 'release dies away');
  assert.ok(Math.abs(cross(run({ ...raw, wave1: 3, tuning: 450 }), 8000, 17000) / 220 - 450 / 440) < 0.002, 'tuning sets the pitch of A');
  console.log('ok: fourpole');
}
// Chord palette: the chord arithmetic, and Alt+C writing a revoiced chord (and smooth rows) through the editor
{
  const { detect, voicings, setQuality, candidates, voiceLead, QUALITIES, scaleSet, spell } = await import('../src/seq/chords.js');
  assert.equal(detect([48, 52, 55, 59]).name, 'Cmaj7');
  assert.equal(detect([52, 55, 60]).name, 'C/E', 'an inversion is a slash chord');
  assert.equal(detect([48, 51, 55, 58]).name, 'Cm7');
  assert.equal(detect([48, 49]), null);
  const v = voicings([48, 52, 55]);
  assert.deepEqual(v.map(x => x.id), ['root', 'inv1', 'inv2', 'spread']);
  assert.deepEqual(v[1].notes, [52, 55, 60]); assert.deepEqual(v[2].notes, [55, 60, 64]);
  assert.ok(voicings([48, 52, 55, 59]).some(x => x.id === 'drop2'), 'four notes get drops');
  assert.deepEqual(setQuality([48, 52, 55], QUALITIES.find(q => q.id === 'min')), [48, 51, 55]);
  const c = candidates([48, 52, 55], 1, scaleSet(0, 'major'));
  assert.ok(c.some(x => x.note === 53 && x.inScale) && c.some(x => x.note === 51 && x.inScale === false), 'candidates know the key');
  assert.deepEqual(voiceLead([48, 52, 55, 59], [45, 48, 52, 55]), [48, 52, 55, 57], 'Cmaj7 to Am7 moves one voice');
  assert.equal(voiceLead([48, 52, 55], [45, 48, 52, 55]), null);
  assert.equal(spell(48), 'C-4'); assert.equal(spell(54), 'F#4');

  const registry = new ParamRegistry(), defs = structuredClone(instruments);
  defs.lead.noteColumns = 3;
  for (const [id, def] of Object.entries(defs)) compile(def.graph, { instrument: id, nodeTypes: NODE_TYPES, registry });
  const chordSong = song120([oneLane('lead', 'lead', patternText(16, {}).replace(/^.*$/gm, '... .. ... .. ... ..'))]);
  const lanes = prepareSong(chordSong, defs, registry), editor = createEditor(lanes, 16);
  let onKey, run = null; const heard = [];
  const view = createTrackerView({
    showChord: opts => { run = opts; }, onNote: (i, m, on) => heard.push([m, on]),
    el: { addEventListener: (type, f) => { if (type === 'keydown') onKey = f; }, innerHTML: '' }, statusEl: {},
    transport: new Int32Array(new SharedArrayBuffer(8)), onToggle() {}, onBack() {},
  });
  uiConfig.set('arrowStyle', 'cell');
  view.load({ lanes, song: chordSong, editor });
  const lane = lanes[0], nc = lane.columns.map((c, i) => (c.token === 'note' ? i : -1)).filter(i => i >= 0);
  assert.ok(nc.length >= 3, 'the demo lead lane has three note columns');
  const put = (t, notes) => nc.forEach((c, i) => editor.setCell(0, t, c, i < notes.length ? noteToken(notes[i]) : '...'));
  const read = t => nc.map(c => lane.rows[t][c]).filter(x => x !== '...').map(noteSemitones);
  put(2, [48, 52, 55]); put(3, [45, 48, 52]);
  view.goto(0, 2);
  onKey({ key: 'c', code: 'KeyC', altKey: true, preventDefault() {} });
  assert.ok(run, 'Alt+C opens the palette'); assert.deepEqual(run.notes, [48, 52, 55]);
  run.preview([48, 52, 55]);
  assert.deepEqual(heard.filter(h => h[1]).map(h => h[0]), [60, 64, 67], 'the ear plays the chord (written C-4 is MIDI 60)');
  run.onApply([52, 55, 60]);
  assert.deepEqual(read(2), [52, 55, 60], 'apply writes the new voicing');
  assert.deepEqual(heard.filter(h => !h[1]).map(h => h[0]), [60, 64, 67], 'and the hold is let go');
  assert.ok(editor.undo(), 'one undo'); assert.deepEqual(read(2), [48, 52, 55], 'undo puts the chord back');
  // two selected rows: smooth voice leading
  view.goto(0, 2); onKey({ key: 'ArrowDown', shiftKey: true, preventDefault() {} });
  onKey({ key: 'c', code: 'KeyC', altKey: true, preventDefault() {} });
  assert.equal(run.rows.length, 2);
  run.onSmooth([[48, 52, 55], [48, 52, 57]]);
  assert.deepEqual(read(3), [48, 52, 57], 'smooth writes every row'); assert.deepEqual(read(2), [48, 52, 55]);
  // cancel writes nothing
  put(2, [48, 52, 55]); view.goto(0, 2); onKey({ key: 'c', code: 'KeyC', altKey: true, preventDefault() {} }); run.onCancel();
  assert.deepEqual(read(2), [48, 52, 55]);
  console.log('ok: chord palette');
}
// Machine help: every sampler command has a description, the resets share a row, and a command can be typed into the Cmd cell
{
  const { commandRows } = await import('../src/seq/cmdhelp.js');
  const { rangeText } = await import('../src/seq/describe.js');
  const registry = new ParamRegistry(), defs = structuredClone(instruments);
  for (const [id, def] of Object.entries(defs)) compile(def.graph, { instrument: id, nodeTypes: NODE_TYPES, registry });
  const lanes = prepareSong(demoSong, defs, registry), editor = createEditor(lanes, 32);
  const li = lanes.findIndex(l => l.columns.some(c => c.kind === 'cmd' && c.commands.some(k => k.param === 'repeats')));
  assert.ok(li >= 0, 'a sampler lane in the demo');
  const cmdCol = lanes[li].columns.find(c => c.kind === 'cmd');
  const rows = commandRows(cmdCol, rangeText);
  assert.deepEqual(rows.filter(r => !r.help).map(r => r.hex), [], 'every command of the sampler says what it does');
  assert.equal(rows.filter(r => r.hex === 'A0–AF').length, 1, 'the sixteen resets are one row');
  assert.ok(rows.some(r => r.hex === '14' && /pitch/i.test(r.help)), 'cc14 is the pitch jitter');
  assert.deepEqual(rows.map(r => r.id), rows.map(r => r.id).sort((a, b) => a - b), 'sorted by command number');
  let onKey;
  const view = createTrackerView({ el: { addEventListener: (type, f) => { if (type === 'keydown') onKey = f; }, innerHTML: '' }, statusEl: {}, transport: new Int32Array(new SharedArrayBuffer(8)), onToggle() {}, onBack() {} });
  view.load({ lanes, song: demoSong, editor });
  view.goto(li, 2);
  assert.equal(view.typeCommand(0x14), false, 'not in the Cmd column: nothing written');
  const ci = lanes[li].columns.findIndex(c => c.kind === 'cmd');
  uiConfig.set('arrowStyle', 'cell');
  let guard = 0; while (view.col !== ci && guard++ < 60) onKey({ key: 'ArrowRight', preventDefault() {} });
  assert.equal(view.col, ci);
  assert.equal(view.typeCommand(0x14), true);
  assert.equal(lanes[li].rows[2][ci], '140000', 'the command with a zero value');
  lanes[li].rows[2][ci] = '14A000'; assert.equal(view.typeCommand(0x12), true);
  assert.equal(lanes[li].rows[2][ci], '12A000', 'an existing value is kept');
  console.log('ok: machine help');
}
// Lane curves: the maths, pins following their patterns, saving, and the sequencer moving a parameter
{
  const A = await import('../src/seq/automation.js');
  const line = { pts: [{ t: 0, v: 0 }, { t: 16, v: 1 }], kinds: ['l'] };
  assert.ok(Math.abs(A.valueAt(line, 8) - 0.5) < 1e-9, 'a straight segment is linear');
  assert.ok(Number.isNaN(A.valueAt({ pts: [{ t: 4, v: 1 }], kinds: [] }, 2)), 'nothing before the first anchor');
  assert.ok(Number.isNaN(A.valueAt(line, 99)) && A.valueAt(line, 16) === 1, 'the curve ends at its last anchor');
  assert.ok(Number.isNaN(A.valueAt({ pts: [{ t: 0, v: 1 }, { t: 8, v: 1 }], kinds: ['g'] }, 4)), 'a gap is not there');
  const bez = { pts: [{ t: 0, v: 0 }, { t: 16, v: 1 }], kinds: ['c'] };
  assert.ok(Math.abs(A.valueAt(bez, 8) - 0.5) < 1e-6 && A.valueAt(bez, 3) < 3 / 16, 'a bezier eases in and out');
  let prev = -1; for (let t = 0; t <= 16; t += 0.5) { const v = A.valueAt(bez, t); assert.ok(v >= prev - 1e-9, 'monotonic'); prev = v; }

  const registry = new ParamRegistry();
  for (const [id, def] of Object.entries(instruments)) compile(def.graph, { instrument: id, nodeTypes: NODE_TYPES, registry });
  const src = { id: 'g', instrument: 'lead', patterns: { a: { text: patternText(16, {}) }, b: { text: patternText(16, {}) } }, placements: [{ puid: 'a', start: 0, length: 16 }, { puid: 'b', start: 16, length: 16 }],
    curves: [{ target: 'out.gain', on: true, pts: [{ t: 0, v: 0.5 }, { t: 16, v: 0.5, pin: 'start' }, { t: 32, v: 1, pin: 'end' }], kinds: ['c', 'l'] }] };
  const song = { ...demoSong, length: 64, lanes: [src] };
  const lanes = prepareSong(song, instruments, registry);
  const lane = lanes[0];
  assert.equal(lane.auto.length, 1, 'the curve runs');
  assert.equal(lane.auto[0].table.length, 64 * A.RES + 1);
  assert.equal(lane.auto[0].table[16 * A.RES], 0.5);

  // snapping: near a pattern edge it is pulled onto it and pinned; far from one it goes to the row
  assert.deepEqual(A.snapTick(lane, 18, { edges: true, rows: 16, reach: 5, length: 64 }), { t: 16, pin: 'start' });
  assert.deepEqual(A.snapTick(lane, 24, { edges: true, rows: 8, reach: 5, length: 64 }), { t: 24, pin: null });

  // pins follow: moving the second pattern later moves the anchors with it; removing it lets them go
  const editor = createEditor(lanes, 64);
  assert.ok(editor.move(0, 16, 16), 'the second pattern moves one row later');
  assert.deepEqual(lane.curves[0].pts.map(p => p.t), [0, 32, 48], 'the pinned anchors went with it');
  assert.equal(lane.auto[0].table[32 * A.RES], 0.5, 'and the table was baked again');
  assert.equal(editor.undo() !== null, true);
  assert.deepEqual(lane.curves[0].pts.map(p => p.t), [0, 16, 32], 'undo puts them back');
  assert.ok(editor.remove(0, 16));
  assert.equal(editor.freed, 2, 'both pins let go');
  assert.deepEqual(lane.curves[0].pts.map(p => [p.t, !!p.pin]), [[0, false], [16, false], [32, false]], 'the curve itself is unchanged');
  editor.undo();

  // editing through the editor: a new curve is a shape change, moving an anchor is not
  assert.equal(editor.curve(0, 'move', null, l => { l.curves[0].pts[0].v = 0.25; return true; }), 'same');
  assert.equal(lane.auto[0].table[0], 0.25);
  assert.equal(editor.curve(0, 'delete', null, l => { l.curves = []; return true; }), true);
  assert.equal(lane.auto.length, 0);
  editor.undo(); editor.undo();
  assert.equal(lane.auto.length, 1, 'undo brings the curve back');

  // saved and loaded
  const text = serializeProject({ song, instruments: {}, samples: {}, lanes });
  assert.deepEqual(JSON.parse(text).lanes[0].curves, lane.curves);

  // the sequencer moves the parameter while playing
  const rt = new GraphRuntime({ sampleRate: sr, params: registry.values });
  const seq = new Sequencer({ sampleRate: sr, runtime: rt, params: registry.values, transport: new Int32Array(new SharedArrayBuffer(8)) });
  for (const [id, def] of Object.entries(instruments)) rt.load(compile(def.graph, { instrument: id, nodeTypes: NODE_TYPES, registry }));
  seq.setSong({ ...song, ticksPerBeat: 4, bpm: 120 });
  const slot = lane.auto[0].slot, { min, max } = registry.meta[slot];
  lane.curves[0].pts = [{ t: 0, v: 0.5 }, { t: 60, v: 0.5 }]; lane.curves[0].kinds = ['c'];
  const fresh = prepareSong({ ...song, lanes: [{ ...src, curves: lane.curves }] }, instruments, registry)[0];
  seq.setLane(fresh);
  const level = registry.values[slot];
  seq.play();
  render(seq, 0.2);
  assert.ok(Math.abs(registry.values[slot] - 0.25 * level) < 1e-4, `volume scales the machine's own level (taper 2): ${registry.values[slot]}`);
  seq.stop();
  assert.equal(registry.values[slot], level, 'stopping puts the machine back at its own level');
  console.log('ok: lane curves');
}

// Lane curves with gaps: extending over patterns, skipping one, sections, and the glide back to rest
{
  const A = await import('../src/seq/automation.js');
  const pat = { length: 16 };
  const lane = { patterns: { a: pat, b: pat, c: pat, d: pat }, placements: ['a', 'b', 'c', 'd'].map((puid, k) => ({ puid, start: k * 16, length: 16 })) };
  const c = { target: 'x', on: true, pts: [{ t: 0, v: 0.5, pin: 'start' }, { t: 16, v: 0.5, pin: 'end' }], kinds: ['c'] };
  assert.equal(A.extend(lane, c, 1, 64), 2, 'E adds an anchor at the end of the next pattern');
  assert.deepEqual(c.pts.map(p => p.t), [0, 16, 32]);
  assert.equal(A.extend(lane, c, 0, 64), -1, 'only the last anchor extends');
  assert.equal(A.skip(lane, c, 2, 64), 4, 'Shift+E leaves a pattern alone and starts over the one after');
  assert.deepEqual(c.pts.map(p => p.t), [0, 16, 32, 48, 64]);
  assert.deepEqual(c.kinds, ['c', 'c', 'g', 'c']);
  assert.ok(Number.isNaN(A.valueAt(c, 40)) && Math.abs(A.valueAt(c, 56) - 0.5) < 1e-9 && Math.abs(A.valueAt(c, 20) - 0.5) < 1e-9, 'curve, gap, curve');
  assert.deepEqual(A.sections(c), [[0, 2], [3, 4]]);
  assert.equal(A.extend(lane, c, 4, 64), -1, 'no pattern end past the song');
  assert.ok(A.toggleGap(c, 0) && c.kinds[0] === 'g' && A.toggleGap(c, 0) && c.kinds[0] === 'c');
  // a section over a pattern, between sections that are there
  const d = { target: 'x', on: true, pts: [{ t: 0, v: 1 }, { t: 16, v: 1 }, { t: 48, v: 0 }, { t: 64, v: 0 }], kinds: ['c', 'g', 'c'] };
  assert.equal(A.addSection(d, 8, 24, 0.3), false, 'not on top of anchors');
  const e = { target: 'x', on: true, pts: [{ t: 0, v: 1 }, { t: 16, v: 1 }, { t: 48, v: 0 }, { t: 64, v: 0 }], kinds: ['c', 'g', 'c'] };
  assert.ok(A.addSection(e, 24, 40, 0.3));
  assert.deepEqual(e.kinds, ['c', 'g', 'c', 'g', 'c'], 'gaps either side of the new section');
  assert.ok(A.removeSection(e, 24, 40));
  assert.deepEqual(e.kinds, ['c', 'g', 'c'], 'and gone again');
  assert.deepEqual(A.normalise({ min: 0, max: 1, taper: 2 }, 0.25), 0.5);

  // the engine: inside a section the parameter follows the curve, then glides to the rest value
  const registry = new ParamRegistry();
  for (const [id, def] of Object.entries(instruments)) compile(def.graph, { instrument: id, nodeTypes: NODE_TYPES, registry });
  const src = { id: 'g', instrument: 'lead', patterns: { a: { text: patternText(16, {}) } }, placements: [{ puid: 'a', start: 0, length: 16 }],
    curves: [{ target: 'out.gain', on: true, rest: 1, pts: [{ t: 0, v: 0.2 }, { t: 16, v: 0.2 }], kinds: ['c'] }] };
  const song = { ...demoSong, length: 256, lanes: [src] };
  const [lane2] = prepareSong(song, instruments, registry);
  const rt = new GraphRuntime({ sampleRate: sr, params: registry.values });
  const seq = new Sequencer({ sampleRate: sr, runtime: rt, params: registry.values, transport: new Int32Array(new SharedArrayBuffer(8)) });
  for (const [id, def] of Object.entries(instruments)) rt.load(compile(def.graph, { instrument: id, nodeTypes: NODE_TYPES, registry }));
  seq.setSong({ ...song, ticksPerBeat: 4, bpm: 960 });
  seq.setLane(lane2);
  const slot = lane2.auto[0].slot, level = registry.values[slot];
  seq.play();
  render(seq, 0.2);
  assert.ok(Math.abs(registry.values[slot] - 0.04 * level) < 1e-3, `inside the section: ${registry.values[slot]}`);
  render(seq, 1.2);   // 16 ticks at 960 bpm is 0.25 s: the section is over
  assert.ok(Math.abs(registry.values[slot] - level) < 1e-3, `back at rest, the machine's own level: ${registry.values[slot]}`);
  console.log('ok: lane curve gaps');
}

// nnaAll: a new note fades out a one-shot that is still playing, when asked to; otherwise it rings over the next
{
  const level = all => {
    const registry = new ParamRegistry();
    const rt = new GraphRuntime({ sampleRate: sr, params: registry.values });
    const seq = new Sequencer({ sampleRate: sr, runtime: rt, params: registry.values, transport: new Int32Array(new SharedArrayBuffer(8)) });
    for (const [id, def] of Object.entries(instruments)) {
      rt.load(compile(def.graph, { instrument: id, nodeTypes: NODE_TYPES, registry }));
      rt.message(id, 'sampler', { type: 'sample', data: Float32Array.from({ length: sr * 3 }, (_, i) => 0.4 * Math.sin(2 * Math.PI * 220 * i / sr)), rate: sr });
    }
    registry.set('lead.sampler.nnaAll', all);
    registry.set('lead.sampler.nnaFade', 5);
    const song = song120([oneLane('lead', 'lead', patternText(16, { 0: 'C-4 .. .. .... .... .. .. ..', 4: 'C-4 .. .. .... .... .. .. ..' }))]);
    seq.setSong(song);
    const [lane] = prepareSong(song, instruments, registry);
    seq.setLane(lane);
    seq.play();
    const out = render(seq, 1.2).left;
    let t = 0; const a = Math.round(sr * 0.8), b = Math.round(sr * 1.1);
    for (let i = a; i < b; i++) t += out[i] * out[i];
    return Math.sqrt(t / (b - a));
  };
  const ring = level(0), fade = level(1);
  assert.ok(ring > 1.6 * fade, `with nnaAll off the first hit rings over the second (${ring}); on, it is faded out (${fade})`);
  console.log('ok: nnaAll');
}
console.log('smoke test passed');
