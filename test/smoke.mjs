// Offline checks: build the preset, drive the runtime without a browser.
import assert from 'node:assert/strict';
import { ParamRegistry } from '../src/audio/params.js';
import { NODE_TYPES } from '../src/audio/nodes/index.js';
import { GraphRuntime } from '../src/audio/runtime.js';
import { compile } from '../src/graph/compile.js';
import { samplerPreset } from '../src/presets.js';
import { makePluck } from '../src/audio/sample.js';
import { Sequencer, PAGE_TICKS } from '../src/audio/sequencer.js';
import { instruments } from '../src/instruments.js';
import { buildColumns, buildPages, channelCount, flattenLane, prepareSong } from '../src/seq/lane.js';
import { decodeNote, encodeCell, noteToken, EMPTY } from '../src/seq/cells.js';
import { insertPattern, placementAt, setCell } from '../src/seq/edit.js';
import { createTrackerView, cellAt } from '../src/seq/view.js';
import { createSequenceView } from '../src/seq/seqview.js';
import { createEditor } from '../src/seq/editor.js';
import * as ops from '../src/seq/edit.js';
import * as gedit from '../src/graph/edit.js';
import { createPatcher, hitTest, nodeBox, portPos, portKind } from '../src/graph/patcher.js';
import { rebuildInstrumentLanes } from '../src/seq/lane.js';
import * as pops from '../src/project/ops.js';
import { createSamplePanel } from '../src/project/samplepanel.js';
import { computePeaks, createWaveformView } from '../src/project/waveform.js';
import { parseProject, serializeProject } from '../src/project/file.js';
import { song as demoSong } from '../src/song.js';
import { createCurveEditor, SIZE } from '../src/graph/curveeditor.js';
import { createSpectrumEditor, WIDTH, HEIGHT } from '../src/graph/spectrumeditor.js';
import { HARMONICS, SPECTRA, normalizeSpectrum } from '../src/audio/nodes/spectra.js';
import { CURVE_POINTS, PRESETS } from '../src/audio/nodes/curves.js';
import { Oversampler } from '../src/audio/nodes/oversample.js';
import { resolveKinds } from '../src/graph/kinds.js';
import { createInsertMenu } from '../src/graph/menu.js';
import { createTabs } from '../src/ui/tabs.js';
import * as presetOps from '../src/project/presets.js';
import { parseInstrument, serializeInstrument } from '../src/project/file.js';
import { createSynthwaveProject } from '../src/project/synthwave.js';
import * as lib from '../src/project/library.js';
import { compileDsp } from '../src/audio/wasm/load.js';

const sr = 48000, block = 128;

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

const patternText = (length, cells) => Array.from({ length }, (_, i) => cells[i] ?? '... .. .. .. ..').join('\n');
const oneLane = (id, instrument, text, length = 16) => ({
  id, instrument, patterns: { a: { text } }, placements: [{ puid: 'a', start: 0, length }],
});
const song120 = lanes => ({ bpm: 120, ticksPerBeat: 4, length: 16, lanes });   // 6000 samples per tick
const firstSound = x => x.findIndex(v => Math.abs(v) > 1e-9);

// 6. A note lands on its exact tick, sample-accurately.
{
  const { seq } = songSetup(song120([oneLane('lead', 'lead', patternText(16, { 2: 'C-4 .. .. .. ..' }))]));
  seq.play();
  const at = firstSound(render(seq, 0.5).left);
  assert.ok(at >= 12000 && at <= 12003, `note started at sample ${at}, expected about 12000`);
}

// 7. A parameter column writes its slot; an empty cell leaves the slot alone.
{
  const { seq, registry } = songSetup(song120([oneLane('lead', 'lead', patternText(16, { 0: '... .. 80 .. ..' }))]));
  registry.set('lead.filter.resonance', 0.7);
  seq.play();
  render(seq, 0.1);
  const expected = 20 * Math.pow(18000 / 20, 128 / 255);
  assert.ok(Math.abs(registry.get('lead.filter.cutoff') / expected - 1) < 1e-4, 'cutoff column did not write the slot');
  assert.ok(Math.abs(registry.get('lead.filter.resonance') - 0.7) < 1e-6, 'empty cell overwrote a parameter');
}

// 8. Two lanes at once: the mix is exactly the sum of each lane on its own.
{
  const lead = oneLane('lead', 'lead', patternText(16, { 0: 'C-4 .. .. .. ..' }));
  const bass = oneLane('bass', 'bass', patternText(16, { 0: 'C-3 .. .. .. ..' }));
  const run = lanes => { const { seq } = songSetup(song120(lanes)); seq.play(); return render(seq, 0.6).left; };
  const both = run([lead, bass]), a = run([lead]), b = run([bass]);
  assert.ok(peak(a) > 0.05 && peak(b) > 0.05, 'a lane is silent');
  assert.ok(both.every((v, i) => Math.abs(v - (a[i] + b[i])) < 1e-5), 'lanes do not add up');
}

// 9. The song loops: a note on tick 0 sounds again when the song wraps.
{
  const text = patternText(16, { 0: 'C-4 .. .. .. ..', 4: '=== .. .. .. ..' });
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
      long: { text: patternText(16, { 0: 'C-4 .. .. .. ..', 8: 'E-4 .. .. .. ..' }) },
      over: { text: patternText(4, { 0: 'G-5 .. .. .. ..' }) },
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
    patterns: { a: { text: patternText(16, { 7: 'G-3 .. .. .. ..', 8: 'A-3 .. .. .. ..' }) } },
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
  const { seq, registry } = songSetup(song120([oneLane('lead', 'lead', patternText(16, { 0: '... .. .. .. .. 8000' }))]));
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
  const known = run('... .. .. .. .. .... 02A000');
  assert.ok(Math.abs(known.registry.get('lead.filter.resonance') - 0.95 * (0xA000 / 65535)) < 1e-4, 'command 02 did not write resonance');
  const unknown = run('... .. .. .. .. .... 99FFFF');
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
  assert.ok(setCell(lead, 32, 3, 6, '02A000'));    // the Cmd column
  assert.deepEqual(Array.from(lead.pages[0].subarray(3 * ch + 6, 3 * ch + 8)), encodeCell('02A000', 'cmd').map(Math.fround));

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
  const el = { addEventListener: (_, f) => { onKey = f; }, innerHTML: '' };
  const statusEl = { textContent: '' };
  let toggled = 0;
  const view = createTrackerView({ el, statusEl, transport: new Int32Array(new SharedArrayBuffer(8)), onToggle: () => toggled++, onBack() {} });
  view.load({ lanes, song: demoSong, editor: createEditor(lanes, demoSong.length) });
  const press = (key, times = 1, extra = {}) => { for (let i = 0; i < times; i++) onKey({ key, preventDefault() {}, ...extra }); };
  const [lead, bass] = lanes;

  press('z');                                   // C-3 at the cursor (octave 3), cursor moves down
  assert.equal(lead.rows[0][0], 'C-3');
  press(']'); press('q');                       // octave 4, upper row: C one octave up
  assert.equal(lead.rows[1][0], 'C-5');
  press('1'); assert.equal(lead.rows[2][0], '===');
  press('Home'); press('ArrowRight', 5);        // Note (3 chars), Vel (2 chars), then Cut
  press('ArrowDown', 3);                        // row 3 holds Cut 88
  press('a'); assert.equal(lead.rows[3][2], 'A8');   // overwrites one character
  press('0'); assert.equal(lead.rows[3][2], 'A0');   // second character, then the cursor moves down a row
  press('ArrowUp'); press('Delete');            // clearing does not advance
  assert.equal(lead.rows[3][2], '..');
  press('ArrowRight', 10);                      // Cut, Res, Mix, Time (4 chars), then Cmd
  for (const k of '03ffff') press(k);           // an empty cell fills with zeros, then each digit lands in turn
  assert.equal(lead.rows[3][6], '03FFFF');

  press('Home'); press('ArrowLeft', 2);         // Cmd char 0 -> Time char 3 -> char 2
  assert.equal(lead.rows[0][5], '4C9E');
  press('f'); assert.equal(lead.rows[0][5], '4CFE');   // one character of a filled 4hex cell

  press('Tab'); press('8');                     // bass lane, Time char 3: an empty cell fills with zeros
  assert.equal(bass.rows[0][5], '0008');
  press('Home'); press('ArrowRight', 3);        // Time char 3 -> Cmd char 0..2
  press('z'); assert.equal(bass.rows[0][6], '......');   // note keys do nothing in a hex cell

  press(' '); assert.equal(toggled, 1);
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
  const view = createTrackerView({ el: { addEventListener: (_, f) => { onKey = f; } }, statusEl: {}, transport: new Int32Array(new SharedArrayBuffer(8)), onToggle() {}, onBack() {} });
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
  const { seq, rt } = songSetup(song120([oneLane('lead', 'lead', patternText(16, { 0: 'C-4 .. .. .. ..' }))]));
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
  assert.equal(ops.placePattern(lane, 32, 16, ops.puidByIndex(lane, 0)), 0);   // a pattern already starts there
  assert.ok(ops.insertPattern(lane, 32, 20, 16, true));                  // overlay allowed on a covered tick
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

  editor.setCell(0, 3, 6, '010000'); editor.setCell(0, 3, 6, '01FF00'); editor.setCell(0, 3, 6, '01FFFF');
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
  const el = { addEventListener: (_, f) => { onKey = f; }, innerHTML: '' };
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
  const rows = el.innerHTML.split('\n');
  assert.ok(rows[0].includes('&lt;b&gt;x&lt;/b&gt;'), 'lane names are the column headers');
  assert.ok(rows[1].startsWith(' 0000') && rows[2].startsWith(' 0016'), 'one row per 16 ticks, counting down');
  assert.ok(rows.slice(1, 3).some(r => r.includes('▌')), 'blocks start on their row');
  press('ArrowDown'); press('ArrowDown');                                // time moves down the rows
  assert.deepEqual(moves.at(-1), [0, 16], 'the second row, 16 ticks down (the song is 32 ticks)');
  press('ArrowRight');                                                   // and right changes lane
  assert.deepEqual(moves.at(-1), [1, 16]);
  view.goto(0, 5); press('ArrowDown'); assert.deepEqual(moves.at(-1), [0, 16], 'the cursor sits on a row start');
  // two patterns start in the second row of the lead lane (an arp at 16 and a fill at 28): marked with a +
  view.goto(0, 16); view.draw();
  assert.ok(/\+<\/span>|\+ /.test(el.innerHTML.split('\n')[2]), 'a row with several starts is marked');
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
    el: { addEventListener: (_, f) => { onKey = f; }, innerHTML: '' }, statusEl: {}, transport: new Int32Array(new SharedArrayBuffer(8)),
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

// 26. New-note action, one-shots: a hit that is still playing is not cut by the next one.
{
  const run = cells => {
    const rows = {}; cells.forEach(([tick, cell]) => { rows[tick] = cell; });
    const { seq } = songSetup(song120([oneLane('bass', 'bass', patternText(16, rows))]));
    seq.play();
    return render(seq, 1).left;
  };
  const a = run([[0, 'C-3 .. .. .. ..']]), b = run([[2, 'E-3 .. .. .. ..']]);
  const both = run([[0, 'C-3 .. .. .. ..'], [2, 'E-3 .. .. .. ..']]);
  assert.ok(peak(a) > 0.05 && peak(b) > 0.05);
  assert.ok(both.every((v, i) => Math.abs(v - (a[i] + b[i])) < 1e-5), 'the second hit cut the first');
  // note off leaves a one-shot alone
  const withOff = run([[0, 'C-3 .. .. .. ..'], [4, '=== .. .. .. ..']]);
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
  const note = 'C-4 .. .. .. ..';
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
  const off = run([[0, note], [4, '=== .. .. .. ..']], 20);
  assert.ok(peak(off.subarray(20000, 23000)) > 0.05);
  assert.ok(peak(off.subarray(36000, 48000)) < 1e-4, 'note off did not release the looping voice');
}

// 28. Stopping fades every voice out, one-shots included.
{
  const { seq } = songSetup(song120([oneLane('bass', 'bass', patternText(16, { 0: 'C-4 .. .. .. ..', 1: 'E-4 .. .. .. ..' }))]));
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
  assert.equal(lanes[0].columns.length, 7);              // other instruments are untouched
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
  const patcher = createPatcher({ canvas, panel, statusEl, doc, nodeTypes: NODE_TYPES, onStructure: id => structures.push(id), onContext: p => contexts.push(p), onParam: (...a) => params.push(a), getSampleIds: () => ['pluck'] });
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
  let sliders = []; walk(panel, e => { if (e.tag === 'input' && e.type === 'range') sliders.push(e); });
  assert.equal(sliders.length, NODE_TYPES.osc.params.length);

  // drag a node
  const from = mid('vca'), x0 = node('vca').x;
  fire('mousedown', from); fire('mousemove', { x: from.x + 30, y: from.y + 5 }); fire('mouseup', { x: from.x + 30, y: from.y + 5 });
  assert.equal(node('vca').x, x0 + 30);

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
  sliders = []; const boxes = [];
  walk(panel, e => { if (e.tag === 'input' && e.type === 'range') sliders.push(e); if (e.tag === 'input' && e.type === 'checkbox') boxes.push(e); });
  const tune = NODE_TYPES.osc.params.findIndex(p => p.name === 'tune');
  sliders[tune].value = 750;                             // three quarters of -48..48 is +24 semitones
  sliders[tune].listeners.input();
  assert.equal(params.at(-1)[2], 'tune');
  assert.ok(Math.abs(params.at(-1)[3] - 24) < 1e-6);
  assert.equal(node('osc').params.tune, 24);
  boxes[tune].checked = true; boxes[tune].listeners.change();
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
  const view = createTrackerView({ el: { addEventListener: (_, f) => { onKey = f; }, innerHTML: '' }, statusEl: {}, transport: new Int32Array(new SharedArrayBuffer(8)), onToggle() {}, onBack() {} });
  view.load({ lanes, song: demoSong, editor });
  const press = (key, times = 1) => { for (let i = 0; i < times; i++) onKey({ key, preventDefault() {} }); };
  const kick = lanes.find(l => l.id === 'kick');
  press('Tab', 2);                                                    // lead -> bass -> kick
  press('ArrowRight', 3 + 2 + 2 + 2);                                   // Note (3), Vel (2), Pit (2), Dec (2) -> Rst
  press('1');
  assert.equal(kick.rows[0][4], '1');
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
  const osc = defs.kick.graph.nodes.find(n => n.id === 'osc');
  const point = { x: osc.x + 70, y: osc.y + 10 };
  canvas.listeners.mousedown({ offsetX: point.x, offsetY: point.y, preventDefault() {} });
  canvas.listeners.mouseup({ offsetX: point.x, offsetY: point.y });
  const rows = [];
  walk(panel, e => { if (e.className === 'prow') rows.push(e); });
  const rowFor = name => rows[NODE_TYPES.osc.params.findIndex(p => p.name === name)];
  const parts = row => { const f = { boxes: [], selects: [] }; walk(row, e => { if (e.tag === 'input' && e.type === 'checkbox') f.boxes.push(e); if (e.tag === 'select') f.selects.push(e); }); return f; };

  const reset = parts(rowFor('reset'));
  assert.equal(reset.selects[0].disabled, true, 'the dropdown is off until the parameter is exposed');
  reset.boxes[0].checked = true; reset.boxes[0].listeners.change();
  assert.equal(reset.selects[0].disabled, false);
  assert.equal(reset.selects[0].value, '4', 'a whole-number parameter defaults to 1hex');
  reset.selects[0].value = '16'; reset.selects[0].listeners.change();
  assert.equal(defs.kick.exposed.find(e => e.param === 'reset').bits, 16);
  reset.selects[0].value = '8'; reset.selects[0].listeners.change();
  assert.equal(defs.kick.exposed.find(e => e.param === 'reset').bits, undefined, '2hex is the default and is stored as no bits');
  assert.equal(structures.length, 3);

  const tune = parts(rowFor('tune'));
  tune.boxes[0].checked = true; tune.boxes[0].listeners.change();
  assert.equal(tune.selects[0].value, '8', 'a continuous parameter defaults to 2hex');
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
  assert.deepEqual(lane.columns.map(c => c.label), ['Note', 'Vel', 'Cut', 'Res', 'Mix', 'Time', 'Cmd']);

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

// 45. The sample list: sizes, loop edits report which instruments to update, remove is for unused samples.
{
  const makeEl = tag => ({
    tag, children: [], listeners: {}, style: {}, textContent: '', value: '', disabled: false,
    appendChild(c) { this.children.push(c); return c; }, replaceChildren(...c) { this.children = c; },
    addEventListener(type, f) { this.listeners[type] = f; },
  });
  const walk = (el, fn) => { fn(el); (el.children ?? []).forEach(c => walk(c, fn)); };
  const doc = { createElement: makeEl, createTextNode: text => ({ text }) };
  const { project } = makeProject();
  pops.addSample(project, 'tick.wav', 44100, burst);
  const container = makeEl('div'), statusEl = { textContent: '' };
  const looped = [], removed = [];
  const panel = createSamplePanel({ container, statusEl, doc, getProject: () => project, onLoop: u => looped.push(u), onRemove: id => removed.push(id) });
  panel.render();
  const rows = container.children;
  assert.equal(rows.length, 2);
  const parts = row => { const f = { numbers: [], buttons: [], name: null }; walk(row, e => { if (e.tag === 'input' && e.type === 'text') f.name = e; else if (e.tag === 'input') f.numbers.push(e); if (e.tag === 'button') f.buttons.push(e); }); return f; };
  const pluck = parts(rows[0]), tick = parts(rows[1]);
  assert.equal(pluck.buttons[0].disabled, true, 'a sample in use cannot be removed');
  assert.equal(tick.buttons[0].disabled, false);

  // the name box renames the sample everywhere
  const renamed = [];
  const panel2 = createSamplePanel({ container, statusEl, doc, getProject: () => project, onLoop: () => {}, onRemove: () => {}, onRename: (a, b) => renamed.push([a, b]) });
  panel2.render();
  const tickName = parts(container.children[1]).name;
  tickName.value = 'hat'; tickName.listeners.change();
  assert.deepEqual(renamed, [['tick', 'hat']]);
  assert.ok(project.samples.hat && !project.samples.tick);
  project.samples.tick = project.samples.hat; delete project.samples.hat;   // put it back for the checks below
  for (const d of Object.values(project.instruments)) for (const k of Object.keys(d.samples ?? {})) if (d.samples[k] === 'hat') d.samples[k] = 'tick';
  panel.render();

  pluck.numbers[0].value = '100'; pluck.numbers[1].value = '5000'; pluck.numbers[1].listeners.change();
  assert.deepEqual(looped.at(-1).map(u => u.instrument).sort(), ['bass', 'lead']);
  assert.equal(project.samples.pluck.loopEnd, 5000);
  pluck.numbers[1].value = '99999999'; pluck.numbers[1].listeners.change();
  assert.match(statusEl.textContent, /past the end/);
  assert.equal(project.samples.pluck.loopEnd, 5000, 'a refused loop point changed the sample');

  tick.buttons[0].listeners.click();
  assert.deepEqual(removed, ['tick']);
  assert.equal(project.samples.tick, undefined);
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
  const lanes2 = [oneLane('lead', 'lead', patternText(16, { 0: 'C-4 .. .. .. ..' })), oneLane('bass', 'bass', patternText(16, { 0: 'C-3 .. .. .. ..' }))];
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
  const solo = songSetup(song120([oneLane('bass', 'bass', patternText(16, { 0: 'C-3 .. .. .. ..' }))]));
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
  fire('mousedown', 300); fire('mousemove', 305); fire('mouseleave', 305); // leaving the canvas cancels
  assert.equal(project.samples.s.loopEnd, 6000);
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
    const lanes2 = [oneLane('lead', 'lead', patternText(16, { 0: 'C-4 .. .. .. ..', 4: 'E-4 .. .. .. ..' })), oneLane('bass', 'bass', patternText(16, { 0: 'C-3 .. .. .. ..' }))];
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
  assert.deepEqual(menu.entries('filt').map(e => e.type), ['filter']);
  assert.ok(menu.entries('effects').some(e => e.type === 'multitap'), 'a category name matches too');
  assert.deepEqual(menu.entries('zzz'), []);

  menu.open(120, 80);
  assert.ok(menu.isOpen && menu.box.style.left === '120px');
  const input = menu.box.children[0];
  const key = k => input.listeners.keydown({ key: k, preventDefault() {} });
  key('ArrowDown');
  key('Enter');                                   // the second entry, at the opening point
  assert.equal(picks.length, 1);
  assert.equal(picks[0][0], menu.entries('')[1].type);
  assert.deepEqual(picks[0][1], { x: 120, y: 80 });
  assert.ok(!menu.isOpen);

  menu.open(10, 10);
  input.value = 'pan'; input.listeners.input();
  key('Enter');
  assert.equal(picks[1][0], 'pan');
  menu.open(10, 10);
  key('Escape');
  assert.ok(!menu.isOpen && picks.length === 2);
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
  // release ends the voice; a cut ends it at once; extreme settings stay finite and bounded
  const rel = play('subsynth', { rel: 50 }, { secs: 1, events: [[12800, node => node.note({ type: 'noteOff' })]] }).L;
  assert.ok(pk(rel, 12800 + 12000, rel.length) < 1e-4, 'the voice should end after the release');
  const cutNote = play('subsynth', {}, { secs: 0.5, events: [[12800, node => node.note({ type: 'noteCut' })]] }).L;
  assert.equal(pk(cutNote, 12800, cutNote.length), 0);
  const wild = play('subsynth', { res: 1, drive: 1, unison: 7, spread: 50, noise: 1, sub: 1, osc2: 1, cutoff: 3000, fenv: 8, level: 1 }, { note: 110, secs: 0.6 }).L;
  assert.ok(wild.every(Number.isFinite) && pk(wild) < 4, `extreme settings should stay bounded: ${pk(wild)}`);

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
    for (const n of ['filter.cutoff', 'filter.resonance', 'delay.mix', 'delay.time', 'delay.feedback', 'sampler.nnaFade']) registry.allocate(`lead.${n}`, 0.5, 0, 1000);
    const cols = buildColumns('lead', def, registry);
    assert.deepEqual(cols.map(c => c.label), ['N1', 'V1', 'N2', 'V2', 'N3', 'V3', 'Cut', 'Res', 'Mix', 'Time', 'Cmd']);
    assert.deepEqual(cols.slice(0, 2).map(c => c.key), ['note', 'vel'], 'the first pair keeps its keys');
    assert.deepEqual(buildColumns('lead', { ...def, noteColumns: undefined }, registry).map(c => c.label).slice(0, 3), ['Note', 'Vel', 'Cut']);

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
    const songBefore = { name: 'x', bpm: 120, ticksPerBeat: 4, length: 8, lanes: [oneLane('lead', 'lead', 'C-4 .. 70 50 40 4C9E', 8)] };
    const one = { lead: structuredClone(instruments.lead) };
    const lanes = prepareSong(songBefore, one, registry);
    one.lead.noteColumns = 3;
    const [changed] = rebuildInstrumentLanes(lanes, songBefore, one, registry, 'lead');
    const row = Object.values(changed.patterns)[0].rows[0];
    assert.deepEqual([row[0], row[6], row[7], row[8], row[9]], ['C-4', '70', '50', '40', '4C9E']);
    assert.equal(row.length, 11);
    one.lead.noteColumns = 1;
    const [back] = rebuildInstrumentLanes(lanes, songBefore, one, registry, 'lead');
    assert.deepEqual(Object.values(back.patterns)[0].rows[0].slice(0, 5), ['C-4', '..', '70', '50', '40']);

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
  const statusEl = { textContent: '' };
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

  // mouse geometry: which cell is under a character position
  const widths = [[4, 3, 2, 2], [4, 3]];   // two lanes; lane 0 is 4+3+2+2 + 3 gaps = 14 wide
  const at = (x, line, top = 0) => cellAt({ widths, x, line, top, len: 32 });
  assert.equal(at(3, 2), null, 'the gutter');
  assert.equal(at(10, 1), null, 'the header');
  assert.deepEqual(at(5, 2), { lane: 0, tick: 0, col: 0, ch: 0 });          // 4 gutter + 1 marker: the first column
  assert.deepEqual(at(7, 5, 10), { lane: 0, tick: 13, col: 0, ch: 2 });     // scrolled: line 5 is tick top + 3
  assert.deepEqual(at(10, 2), { lane: 0, tick: 0, col: 1, ch: 0 });         // after the column and its space
  assert.deepEqual(at(19, 2).col, 3);
  assert.equal(at(5 + 14 + 2 + 1, 2).lane, 1, 'the second lane starts after a marker and two spaces');
  assert.equal(at(200, 2).col, 1, 'far right is the last column');
  assert.equal(at(5, 40), null, 'past the last row');
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
    assert.throws(() => pops.removeLane(p, 'Lead_line'), /at least one lane/);
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
  const timings = swing => {
    let now = 0;
    const log = [];
    const stub = { process: (l, r, n) => { now += n; }, note: (instrument, msg) => { if (msg.type === 'noteOn') log.push(now); } };
    const registry = new ParamRegistry();
    const def = { ...structuredClone(instruments.kick) };
    compile(def.graph, { instrument: 'kick', nodeTypes: NODE_TYPES, registry });
    const seq = new Sequencer({ sampleRate: sr, runtime: stub, params: registry.values, transport: new Int32Array(new SharedArrayBuffer(8)) });
    const song = { ...song120([oneLane('kick', 'kick', Array.from({ length: 8 }, () => 'C-2 ..').join('\n'), 8)]), swing };
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
    const rows = ['... .. .. .. .. .... ......', '... .. .. .. .. .... 000000', '... .. .. .. .. .... ......', '... .. .. .. .. .... 000001', '... .. .. .. .. .... 0000FF', '... .. .. .. .. .... 010000'];
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
    assert.throws(() => pops.setSongLength(project, 0), /16 to 4096/);
    assert.throws(() => pops.setSongLength(project, 'x'), /16 to 4096/);
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
    const el = { addEventListener: (_, f) => { onKey = f; }, innerHTML: '' }, statusEl = { textContent: '' };
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
    assert.ok(el.innerHTML.includes('muted') && /m<\/span>/.test(el.innerHTML) && /u<\/span>/.test(el.innerHTML), 'the view marks the flips');
    onKey({ key: 'z', ctrlKey: true, preventDefault() {} });
    assert.deepEqual(lanes[0].mutes, [0], 'undo takes the last flip away');
    assert.equal(lanes[0].mask[20], 1);
    press('m'); assert.deepEqual(lanes[0].mutes, [0, 16]);
    press('m'); assert.deepEqual(lanes[0].mutes, [0], 'the same key on a flip removes it');

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
    const p2 = songSetup(song120([oneLane('lead', 'lead', patternText(16, { 0: 'C-4 .. 80 .. ..', 8: 'E-4 .. 90 .. ..' }))]));
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
    const el = { addEventListener: (_, f) => { onKey = f; }, innerHTML: '' }, statusEl = { textContent: '' };
    const view = createSequenceView({ el, statusEl, transport: new Int32Array(new SharedArrayBuffer(8)), onToggle() {}, onOpen() {} });
    view.load({ lanes, song: demoSong, editor });
    const key = (k, extra = {}) => onKey({ key: k, preventDefault() {}, ...extra });
    const pat = () => lanes[0].patterns[lanes[0].placements.find(p => p.start === 0).puid];
    assert.equal(pat().color, undefined);
    key('k'); assert.equal(pat().color, 0);
    view.draw(); assert.ok(el.innerHTML.includes('class="c0"'));
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
    assert.ok(el.innerHTML.includes('style="background:#aa3355"'), 'a custom colour is drawn');
    pat().color = 'red; x'; view.draw(); assert.ok(!el.innerHTML.includes('red; x'), 'anything but #rrggbb is ignored');
  }
}

console.log('smoke test passed');
