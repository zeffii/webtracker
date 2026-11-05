import { createBezierEditor } from './bezieredit.js';
import { REFERENCE_MS, DEFAULT_SHAPES } from '../audio/nodes/hat2.js';

// The Hi-hat 2 panel: one volume drawing for the closed hat and one for the open hat.
const COL = { closed: 'hsl(190 70% 55%)', open: 'hsl(35 85% 55%)' };

export function createHat2View({ doc = document, getParam, env = {}, onChange }) {
  const make = (key, title, rate) => createBezierEditor({
    doc, title, color: COL[key], points: env[key], fallback: DEFAULT_SHAPES[key],
    getMs: () => REFERENCE_MS[key] / getParam(rate), onChange: points => onChange(key, points),
  });
  const editors = [make('closed', 'CLOSED HAT', 'crate'), make('open', 'OPEN HAT', 'orate')];
  const root = doc.createElement('div');
  root.className = 'curve-editor drum2';
  for (const e of editors) root.appendChild(e.el);
  const refresh = () => { for (const e of editors) e.draw(); };
  return { el: root, refresh, draw: refresh };
}
