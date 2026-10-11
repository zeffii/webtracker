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
import { parseProject, serializeProject } from '../src/project/file.js';
import { song as demoSong } from '../src/song.js';

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

function songSetup(song) {
  const registry = new ParamRegistry();
  const rt = new GraphRuntime({ sampleRate: sr, params: registry.values });
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
  const view = createTrackerView({ el, statusEl, transport: new Int32Array(new SharedArrayBuffer(8)), onToggle: () => toggled++ });
  view.load({ lanes, song: demoSong });
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
  const view = createTrackerView({ el: { addEventListener: (_, f) => { onKey = f; } }, statusEl: {}, transport: new Int32Array(new SharedArrayBuffer(8)), onToggle() {} });
  view.load({ lanes, song: demoSong });
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
  const text = serializeProject({ song: demoSong, instruments, samples: { pluck: { rate: sr, data } }, lanes });
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

console.log('smoke test passed');
