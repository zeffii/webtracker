import { CHORDS, stringsOf, midiHz, noteName } from '../audio/spacecore.js';
import { ORANGE, BLUE, makeCanvas, drag, heartbeat, button, clamp } from './spaceui.js';

// The sympathetic strings panel: the strings as vertical lines laid out by pitch (log frequency), each one glowing with how much it rings
// right now (live while the panel is open), with its note name. Chord buttons pick the notes; - and + move the root by a semitone, an
// octave with the second pair; dragging along the plot moves the root too. 'follow notes' hands the choice to the notes being played: the
// strings drawn are then the ones the node reports.
const W = 560, PL = 16, PR = 16;
const BARS = 38, PH = 190, H = PH + BARS;   // PH: height of the strings' plot; under it, the left and right sums as stacked bars

export function createSympathyView({ doc = document, getParam, setParam, watch = () => {} }) {
  const el = doc.createElement('div'); el.className = 'spacepanel';
  const { canvas, ctx, ink } = makeCanvas(doc, W, H, 'sp-pad');
  const row = doc.createElement('div'); row.className = 'sp-row';
  const chordBtns = CHORDS.map((c, i) => button(doc, c.name, `Strings tuned to a ${c.name} chord`, () => { setParam('chord', i); draw(); }));
  const shift = (label, by, title) => button(doc, label, title, () => { setParam('root', clamp(getParam('root') + by, 24, 84)); draw(); });
  const followBtn = button(doc, 'follow notes', 'Tune the strings to the notes being played (and their octaves and twelfths) instead of a chord', () => { setParam('follow', getParam('follow') >= 0.5 ? 0 : 1); draw(); });
  const info = doc.createElement('span'); info.className = 'sp-info';
  row.append(followBtn, ...chordBtns, shift('−', -1, 'Root a semitone lower'), shift('+', 1, 'Root a semitone higher'), shift('−8', -12, 'Root an octave lower'), shift('+8', 12, 'Root an octave higher'), info);
  el.append(canvas, row);
  let energy = [], liveNotes = [], pans = [];
  const lo = Math.log2(30), hi = Math.log2(4000);
  const X = hz => PL + (Math.log2(clamp(hz, 30, 4000)) - lo) / (hi - lo) * (W - PL - PR);

  // The sum, drawn: two bars, left above right, each built from one segment per string (as long as that string rings, times how much of it
  // goes to that side), coloured by pitch like the strings' glow. A bar longer than the other is where the sound leans.
  function drawSums(notes, ink) {
    const SCALE = 26, x0 = PL + 12;
    ctx.globalAlpha = 1; ctx.font = '10px ui-monospace, Consolas, monospace'; ctx.textBaseline = 'middle'; ctx.fillStyle = ink;
    [0, 1].forEach(side => {
      const y = PH + 4 + side * 15;
      ctx.globalAlpha = 0.6; ctx.fillText(side ? 'R' : 'L', PL, y + 5);
      let x = x0;
      notes.forEach((m, i) => {
        const w = clamp((energy[i] ?? 0) * 3, 0, 1) * (pans[i]?.[side] ?? Math.SQRT1_2) * SCALE;
        if (w < 0.5) return;
        ctx.globalAlpha = 0.9; ctx.fillStyle = `hsl(${200 + (m - 30) * 2.2} 65% 52%)`; ctx.fillRect(x, y, w, 10); x += w;
      });
      ctx.fillStyle = ink;
    });
  }

  function draw() {
    if (!ctx) return;
    const c = ink(), follow = getParam('follow') >= 0.5, notes = follow ? liveNotes : stringsOf(getParam('root'), getParam('chord'), getParam('strings'));
    ctx.clearRect(0, 0, W, H);
    ctx.font = '10px ui-monospace, Consolas, monospace'; ctx.textBaseline = 'top';
    ctx.lineWidth = 1; ctx.strokeStyle = c;
    for (let m = 24; m <= 108; m += 12) { const x = X(midiHz(m)); ctx.globalAlpha = 0.12; ctx.beginPath(); ctx.moveTo(x + 0.5, 8); ctx.lineTo(x + 0.5, PH - 28); ctx.stroke(); ctx.globalAlpha = 0.5; ctx.fillStyle = c; ctx.fillText(noteName(m), x - 8, PH - 18); }
    const base = PH - 30, top = 28;
    notes.forEach((m, i) => {
      const x = X(midiHz(m)), e = clamp((energy[i] ?? 0) * 3, 0, 1);
      ctx.globalAlpha = 0.35 + 0.4 * (i === 0 ? 1 : 0); ctx.strokeStyle = i === 0 ? ORANGE : c; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(x, base); ctx.lineTo(x, top); ctx.stroke();
      if (e > 0.01) { ctx.globalAlpha = 0.9; ctx.strokeStyle = BLUE; ctx.lineWidth = 4 + 6 * e; ctx.beginPath(); ctx.moveTo(x, base); ctx.lineTo(x, base - (base - top) * e); ctx.stroke(); }
      ctx.globalAlpha = 1; ctx.fillStyle = i === 0 ? ORANGE : c; ctx.fillText(noteName(m), x - 8, top - 14);
    });
    drawSums(notes, c);
    ctx.globalAlpha = 1;
    followBtn.classList.toggle('on', follow);
    chordBtns.forEach((b, i) => { b.classList.toggle('on', !follow && Math.round(getParam('chord')) === i); b.style.opacity = follow ? 0.3 : ''; });
    info.textContent = follow ? `${notes.length} strings, on the notes played   rings ${(getParam('ringtime') / 1000).toFixed(1)} s${notes.length ? '' : '   (play a note)'}` : `root ${noteName(getParam('root'))}   ${notes.length} strings   rings ${(getParam('ringtime') / 1000).toFixed(1)} s`;
  }

  drag(canvas, W, H, {
    start: (x, y) => y < PH - 22 && getParam('follow') < 0.5,
    move(x) { const hz = Math.pow(2, lo + (x - PL) / (W - PL - PR) * (hi - lo)); setParam('root', clamp(Math.round(69 + 12 * Math.log2(hz / 440)), 24, 84)); draw(); },
  });
  const feed = msg => { energy = msg.energy; liveNotes = msg.notes ?? []; pans = msg.pans ?? []; draw(); };
  heartbeat(doc, el, watch);
  draw();
  return { el, refresh: draw, draw, feed };
}
