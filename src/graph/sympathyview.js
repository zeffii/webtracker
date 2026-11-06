import { CHORDS, stringsOf, midiHz, noteName } from '../audio/spacecore.js';
import { ORANGE, BLUE, makeCanvas, drag, heartbeat, button, clamp } from './spaceui.js';

// The sympathetic strings panel: the strings as vertical lines laid out by pitch (log frequency), each one glowing with how much it rings
// right now (live while the panel is open), with its note name. Chord buttons pick the notes; - and + move the root by a semitone, an
// octave with the second pair; dragging along the plot moves the root too.
const W = 560, H = 190, PL = 16, PR = 16;

export function createSympathyView({ doc = document, getParam, setParam, watch = () => {} }) {
  const el = doc.createElement('div'); el.className = 'spacepanel';
  const { canvas, ctx, ink } = makeCanvas(doc, W, H, 'sp-pad');
  const row = doc.createElement('div'); row.className = 'sp-row';
  const chordBtns = CHORDS.map((c, i) => button(doc, c.name, `Strings tuned to a ${c.name} chord`, () => { setParam('chord', i); draw(); }));
  const shift = (label, by, title) => button(doc, label, title, () => { setParam('root', clamp(getParam('root') + by, 24, 84)); draw(); });
  const info = doc.createElement('span'); info.className = 'sp-info';
  row.append(...chordBtns, shift('−', -1, 'Root a semitone lower'), shift('+', 1, 'Root a semitone higher'), shift('−8', -12, 'Root an octave lower'), shift('+8', 12, 'Root an octave higher'), info);
  el.append(canvas, row);
  let energy = [];
  const lo = Math.log2(30), hi = Math.log2(4000);
  const X = hz => PL + (Math.log2(clamp(hz, 30, 4000)) - lo) / (hi - lo) * (W - PL - PR);

  function draw() {
    if (!ctx) return;
    const c = ink(), notes = stringsOf(getParam('root'), getParam('chord'), getParam('strings'));
    ctx.clearRect(0, 0, W, H);
    ctx.font = '10px ui-monospace, Consolas, monospace'; ctx.textBaseline = 'top';
    ctx.lineWidth = 1; ctx.strokeStyle = c;
    for (let m = 24; m <= 108; m += 12) { const x = X(midiHz(m)); ctx.globalAlpha = 0.12; ctx.beginPath(); ctx.moveTo(x + 0.5, 8); ctx.lineTo(x + 0.5, H - 28); ctx.stroke(); ctx.globalAlpha = 0.5; ctx.fillStyle = c; ctx.fillText(noteName(m), x - 8, H - 18); }
    const base = H - 30, top = 28;
    notes.forEach((m, i) => {
      const x = X(midiHz(m)), e = clamp((energy[i] ?? 0) * 3, 0, 1);
      ctx.globalAlpha = 0.35 + 0.4 * (i === 0 ? 1 : 0); ctx.strokeStyle = i === 0 ? ORANGE : c; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(x, base); ctx.lineTo(x, top); ctx.stroke();
      if (e > 0.01) { ctx.globalAlpha = 0.9; ctx.strokeStyle = BLUE; ctx.lineWidth = 4 + 6 * e; ctx.beginPath(); ctx.moveTo(x, base); ctx.lineTo(x, base - (base - top) * e); ctx.stroke(); }
      ctx.globalAlpha = 1; ctx.fillStyle = i === 0 ? ORANGE : c; ctx.fillText(noteName(m), x - 8, top - 14);
    });
    ctx.globalAlpha = 1;
    chordBtns.forEach((b, i) => b.classList.toggle('on', Math.round(getParam('chord')) === i));
    info.textContent = `root ${noteName(getParam('root'))}   ${notes.length} strings   rings ${(getParam('ringtime') / 1000).toFixed(1)} s`;
  }

  drag(canvas, W, H, {
    start: (x, y) => y < H - 22,
    move(x) { const hz = Math.pow(2, lo + (x - PL) / (W - PL - PR) * (hi - lo)); setParam('root', clamp(Math.round(69 + 12 * Math.log2(hz / 440)), 24, 84)); draw(); },
  });
  const feed = msg => { energy = msg.energy; draw(); };
  heartbeat(doc, el, watch);
  draw();
  return { el, refresh: draw, draw, feed };
}
