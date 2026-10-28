import { display } from './units.js';
import { isLogSpec } from './kinds.js';

// The Range node's picture: which port it feeds and that port's whole span, with the stretch lo..hi lit up on it.
// Unwired it says so, since the numbers are then plain.
export function createRangeView({ doc = document, getTarget, getParam }) {
  const el = doc.createElement('div');
  el.className = 'rangeview';
  const title = doc.createElement('div'), bar = doc.createElement('div'), fill = doc.createElement('div'), ends = doc.createElement('div'), note = doc.createElement('div');
  title.className = 'rangeview-title'; bar.className = 'rangeview-bar'; fill.className = 'rangeview-fill'; ends.className = 'rangeview-ends'; note.className = 'rangeview-note';
  bar.append(fill); el.append(title, bar, ends, note);
  function refresh() {
    const t = getTarget(), lo = getParam('lo'), hi = getParam('hi');
    if (!t) {
      title.textContent = 'Not wired to a port';
      bar.hidden = true; ends.textContent = '';
      note.textContent = `Outputs the plain number between ${lo} and ${hi}. Wire it to a parameter port (tick "port" beside a parameter) and lo / hi take that port's units.`;
      return;
    }
    const pos = v => { const x = t.log ? (v > 0 ? Math.log(v / t.min) / Math.log(t.max / t.min) : 0) : (v - t.min) / (t.max - t.min); return Math.min(1, Math.max(0, x)); };
    const a = pos(Math.min(lo, hi)), b = pos(Math.max(lo, hi));
    bar.hidden = false;
    fill.style.left = `${a * 100}%`; fill.style.width = `${Math.max(1, (b - a) * 100)}%`;
    const d = v => display(t.type, { ...t.spec }, v);
    title.textContent = `→ ${t.node}.${t.param}`;
    ends.textContent = `${d(t.min)}  …  ${d(t.max)}${t.log ? '  (log)' : ''}`;
    note.textContent = `${d(lo)} … ${d(hi)}${lo > hi ? '  (reversed)' : ''}${lo < t.min || hi > t.max ? '  — beyond the port, it will stop at the end' : ''}`;
  }
  refresh();
  return { el, refresh };
}
