import { Engine } from './audio/engine.js';
import { makePluck } from './audio/sample.js';
import { instruments } from './instruments.js';
import { prepareSong } from './seq/lane.js';
import { song } from './song.js';

const engine = new Engine();
const $ = id => document.getElementById(id);
let started = false, lanes = [];

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
  if (started) engine.set(address, value);
};
for (const b of bindings) {
  $(b[0]).addEventListener('input', () => apply(b));
  apply(b);
}

// Playback view: every lane side by side, current tick in bold.
const draw = () => {
  if (lanes.length) {
    const tick = engine.tick, len = song.length;
    const widths = lanes.map(l => l.rows[0].join(' ').length);
    const lines = [`    ${lanes.map((l, i) => l.id.padEnd(widths[i])).join('  ')}`];
    for (let k = -4; k < 12; k++) {
      const t = (tick + k + len) % len;
      const row = `${k === 0 ? '>' : ' '}${String(t).padStart(2, '0')} ${lanes.map(l => l.rows[t].join(' ')).join('  ')}`;
      lines.push(k === 0 ? `<b>${row}</b>` : row);
    }
    $('view').innerHTML = lines.join('\n');
  }
  requestAnimationFrame(draw);
};

$('play').addEventListener('click', () => {
  if (engine.transport[1]) {
    engine.stop();
    $('play').textContent = 'Play';
  } else {
    engine.play();
    $('play').textContent = 'Stop';
  }
});

$('start').addEventListener('click', async () => {
  try {
    await engine.start();
    const data = makePluck(engine.ctx.sampleRate);
    for (const [id, def] of Object.entries(instruments)) {
      engine.loadInstrument(id, def.graph);
      engine.sendToNode(id, 'sampler', { type: 'sample', data: data.slice(), rate: engine.ctx.sampleRate });
    }
    lanes = prepareSong(song, instruments, engine.registry);
    engine.setSong(song);
    for (const { id, instrument, columns, pages } of lanes) engine.setLane({ id, instrument, columns, pages });
    started = true;
    bindings.forEach(apply);
    $('start').disabled = true;
    $('play').disabled = false;
    $('status').textContent =
      `Running at ${engine.ctx.sampleRate} Hz, base latency ${(engine.ctx.baseLatency * 1000).toFixed(1)} ms`;
    draw();
  } catch (err) {
    $('status').textContent = err.message;
  }
});
