import { createBezierEditor } from './bezieredit.js';
import { createVectorPad } from './vectorpad.js';
import { createWaveSeqView } from './waveseqview.js';
import { ORANGE, BLUE } from './spaceui.js';
import { DEFAULT_AMP, DEFAULT_FILTER } from '../audio/nodes/compass.js';

// The panels of the vector nodes, each made of the same parts laid side by side in one row:
//   compass   the diamond with its path, the four wave sequences, the amplitude drawing and the filter drawing
//   waveseq   one wave sequence
//   vecmix    the diamond with the + only
//   vecpath   the diamond with its path
//
//   data       what the node keeps: { lanes, path, env: { amp, filter } }
//   getParam   (name) -> the value now          setParam   (name, value): a setting changed from the panel
//   onData     (kind, value): kind is 'lanes', 'path', 'env.amp' or 'env.filter'
const PAD_NAMES = {
  compass: { x: 'x', y: 'y', time: 'pathms', mode: 'pmode' },
  vecpath: { x: 'x', y: 'y', time: 'pathms', mode: 'pmode' },
  vecmix: { x: 'x', y: 'y' },
};

export function createCompassView({ doc = document, kind = 'compass', data = {}, getParam, setParam, onData }) {
  const el = doc.createElement('div');
  el.className = 'curve-editor drum2 compass-panel';
  const parts = [];   // everything that is redrawn when a setting moves
  const textButton = (label, title, onClick) => { const b = doc.createElement('button'); b.type = 'button'; b.textContent = label; b.title = title; b.addEventListener('click', onClick); return b; };

  if (PAD_NAMES[kind]) {
    const withPath = kind !== 'vecmix';
    const pad = createVectorPad({ doc, path: data.path, withPath, getParam, setParam, names: PAD_NAMES[kind], onPath: points => onData('path', points) });
    const block = doc.createElement('div'); block.className = 'vector-block';
    block.append(pad.el);
    if (withPath) {
      const row = doc.createElement('div'); row.className = 'osc-wave-row';
      row.append(
        textButton('tour', 'A trip round the four points: A, B, C, D', pad.tour),
        textButton('reverse', 'The same trip the other way round', pad.reverse),
        textButton('still', 'One point in the middle: the mix does not move', pad.still));
      const tip = doc.createElement('div'); tip.className = 'bezier-tip'; tip.textContent = 'click adds a point · drag moves it · right-click removes it · drag a mark on the time bar to share out the time · drag the + to shift the whole path';
      block.append(row, tip);
    }
    el.append(block); parts.push(pad);
  }

  if (kind === 'compass' || kind === 'waveseq') {
    const seq = createWaveSeqView({ doc, lanes: data.lanes, count: kind === 'compass' ? 4 : 1, getParam, onChange: lanes => onData('lanes', lanes) });
    el.append(seq.el); parts.push(seq);
  }

  if (kind === 'compass') {
    const amp = createBezierEditor({
      doc, title: 'AMPLITUDE', color: ORANGE, points: data.env?.amp, fallback: DEFAULT_AMP, knot: true,
      getMs: () => getParam('atime'), onChange: points => onData('env.amp', points),
    });
    const filter = createBezierEditor({
      doc, title: 'FILTER', color: BLUE, points: data.env?.filter, fallback: DEFAULT_FILTER, knot: true,
      getMs: () => getParam('ftime'), labels: () => [`${getParam('fenv') >= 0 ? '+' : ''}${getParam('fenv').toFixed(1)} oct`, '0'], onChange: points => onData('env.filter', points),
    });
    el.append(amp.el, filter.el); parts.push(amp, filter);
  }

  const draw = () => { for (const part of parts) part.draw(); };
  // the colours come from the page, which the panel is not part of until it has been put there: draw once more then
  doc.defaultView?.requestAnimationFrame?.(draw);
  return { el, draw, refresh: draw };
}
