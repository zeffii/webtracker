import { Engine } from './audio/engine.js';
import { makePluck } from './audio/sample.js';
import { samplerPreset } from './presets.js';

const INSTRUMENT = 'lead';
const PATTERN = [60, 63, 67, 72, 67, 63, 60, null, 58, 62, 65, 70, 65, 62, 58, null];
const STEP_MS = 140;

const engine = new Engine();
const $ = id => document.getElementById(id);
let started = false;

// Each slider writes one exposed parameter address.
const bindings = [
  ['cutoff', 'cutoff-out', `${INSTRUMENT}.filter.cutoff`, v => 80 * 2 ** (v * 7.8), x => `${Math.round(x)} Hz`],
  ['res', 'res-out', `${INSTRUMENT}.filter.resonance`, v => v, x => x.toFixed(2)],
  ['mix', 'mix-out', `${INSTRUMENT}.delay.mix`, v => v, x => x.toFixed(2)],
];

const apply = ([input, output, address, map, format]) => {
  const value = map($(input).valueAsNumber);
  $(output).textContent = format(value);
  if (started) engine.set(address, value);
};
for (const b of bindings) {
  $(b[0]).addEventListener('input', () => apply(b));
  apply(b);
}

// Placeholder pattern player: a plain timer, replaced by the sequencer in milestone 3.
let step = 0, timer = null, held = null;
const tick = () => {
  if (held !== null) engine.noteOff(INSTRUMENT, held);
  held = PATTERN[step++ % PATTERN.length];
  if (held !== null) engine.noteOn(INSTRUMENT, held);
};

$('play').addEventListener('click', () => {
  if (timer) {
    clearInterval(timer);
    timer = null;
    if (held !== null) engine.noteOff(INSTRUMENT, held);
    held = null;
    $('play').textContent = 'Play pattern';
  } else {
    timer = setInterval(tick, STEP_MS);
    $('play').textContent = 'Stop';
  }
});

$('start').addEventListener('click', async () => {
  try {
    await engine.start();
    engine.loadInstrument(INSTRUMENT, samplerPreset);
    const data = makePluck(engine.ctx.sampleRate);
    engine.sendToNode(INSTRUMENT, 'sampler', { type: 'sample', data, rate: engine.ctx.sampleRate }, [data.buffer]);
    started = true;
    bindings.forEach(apply);
    $('start').disabled = true;
    $('play').disabled = false;
    $('status').textContent =
      `Running at ${engine.ctx.sampleRate} Hz, base latency ${(engine.ctx.baseLatency * 1000).toFixed(1)} ms`;
  } catch (err) {
    $('status').textContent = err.message;
  }
});
