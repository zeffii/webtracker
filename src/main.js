import { Engine } from './audio/engine.js';

const engine = new Engine();
const $ = id => document.getElementById(id);

const applyPitch = () => {
  const hz = 55 * 2 ** ($('pitch').valueAsNumber * 5);   // 55 Hz to 1760 Hz
  engine.set('tone.freq', hz);
  $('pitch-out').textContent = `${hz.toFixed(1)} Hz`;
};
const applyLevel = () => {
  const level = $('level').valueAsNumber;
  engine.set('tone.level', level);
  $('level-out').textContent = level.toFixed(3);
};

$('pitch').addEventListener('input', applyPitch);
$('level').addEventListener('input', applyLevel);
applyPitch();
applyLevel();

$('start').addEventListener('click', async () => {
  try {
    await engine.start();
    applyPitch();
    applyLevel();
    $('start').disabled = true;
    $('status').textContent =
      `Running at ${engine.ctx.sampleRate} Hz, base latency ${(engine.ctx.baseLatency * 1000).toFixed(1)} ms`;
  } catch (err) {
    $('status').textContent = err.message;
  }
});
