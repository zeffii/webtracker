// Offline checks: build the preset, drive the runtime without a browser.
import assert from 'node:assert/strict';
import { ParamRegistry } from '../src/audio/params.js';
import { NODE_TYPES } from '../src/audio/nodes/index.js';
import { GraphRuntime } from '../src/audio/runtime.js';
import { compile } from '../src/graph/compile.js';
import { samplerPreset } from '../src/presets.js';
import { makePluck } from '../src/audio/sample.js';

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

console.log('smoke test passed');
