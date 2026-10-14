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
import { createTrackerView } from '../src/seq/view.js';
import { createSequenceView } from '../src/seq/seqview.js';
import { createEditor } from '../src/seq/editor.js';
import * as ops from '../src/seq/edit.js';
import * as gedit from '../src/graph/edit.js';
import { createPatcher, hitTest, portPos } from '../src/graph/patcher.js';
import { rebuildInstrumentLanes } from '../src/seq/lane.js';
import * as pops from '../src/project/ops.js';
import { createSamplePanel } from '../src/project/samplepanel.js';
import { computePeaks, createWaveformView } from '../src/project/waveform.js';
import { parseProject, serializeProject } from '../src/project/file.js';
import { song as demoSong } from '../src/song.js';
import { createTabs } from '../src/ui/tabs.js';
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
  assert.ok(rows[1].startsWith(' 00') && rows[2].startsWith(' 01'), 'one row per tick, counting down');
  assert.ok(rows.slice(2, 10).some(r => r.includes('│')), 'blocks continue down the rows');
  press('ArrowDown'); press('ArrowDown');                                // time moves down the rows
  assert.deepEqual(moves.at(-1), [0, 2]);
  press('ArrowRight');                                                   // and right changes lane
  assert.deepEqual(moves.at(-1), [1, 2]);
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
  gedit.connect(g, NODE_TYPES, 'lfo2.out', 'osc.fm');   // replaces what fed fm
  assert.equal(g.connections.filter(([, t]) => t === 'osc.fm').length, 1);
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
  const structures = [], params = [];
  const patcher = createPatcher({ canvas, panel, statusEl, doc, nodeTypes: NODE_TYPES, onStructure: id => structures.push(id), onParam: (...a) => params.push(a), getSampleIds: () => ['pluck'] });
  patcher.load({ instruments: defs });
  patcher.show('kick');
  patcher.draw();                                        // draws without throwing
  const g = defs.kick.graph;
  const node = id => g.nodes.find(n => n.id === id);
  const at = (id, side, i) => portPos(node(id), side, i);
  const fire = (type, p, extra = {}) => canvas.listeners[type]({ offsetX: p.x, offsetY: p.y, preventDefault() {}, ...extra });

  assert.deepEqual(hitTest(g, NODE_TYPES, at('osc', 'out', 0).x, at('osc', 'out', 0).y), { kind: 'port', side: 'out', node: 'osc', port: 'out' });
  assert.equal(hitTest(g, NODE_TYPES, node('vca').x + 70, node('vca').y + 14).kind, 'node');
  assert.equal(hitTest(g, NODE_TYPES, 880, 340), null);

  // select a node: the panel lists its parameters
  fire('mousedown', { x: node('osc').x + 70, y: node('osc').y + 10 }); fire('mouseup', { x: node('osc').x + 70, y: node('osc').y + 10 });
  let sliders = []; walk(panel, e => { if (e.tag === 'input' && e.type === 'range') sliders.push(e); });
  assert.equal(sliders.length, NODE_TYPES.osc.params.length);

  // drag a node
  const from = { x: node('vca').x + 70, y: node('vca').y + 10 }, x0 = node('vca').x;
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
  fire('mousedown', { x: node('osc').x + 70, y: node('osc').y + 10 }); fire('mouseup', { x: node('osc').x + 70, y: node('osc').y + 10 });
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
  fire('mousedown', { x: node('lfo1').x + 70, y: node('lfo1').y + 10 }); fire('mouseup', { x: 0, y: 0 });
  canvas.listeners.keydown({ key: 'Delete', preventDefault() {} });
  assert.ok(!g.nodes.some(n => n.id === 'lfo1'));
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
  const parts = row => { const f = { numbers: [], buttons: [] }; walk(row, e => { if (e.tag === 'input') f.numbers.push(e); if (e.tag === 'button') f.buttons.push(e); }); return f; };
  const pluck = parts(rows[0]), tick = parts(rows[1]);
  assert.equal(pluck.buttons[0].disabled, true, 'a sample in use cannot be removed');
  assert.equal(tick.buttons[0].disabled, false);

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

console.log('smoke test passed');
