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
import { buildColumns, buildPages, flattenLane, prepareSong } from '../src/seq/lane.js';
import { decodeNote } from '../src/seq/cells.js';
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
  return { seq, registry };
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
  assert.equal(decodeNote(pages[0][(PAGE_TICKS - 1) * columns.length]), 55);   // G-3
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

console.log('smoke test passed');
