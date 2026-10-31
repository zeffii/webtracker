// The keyboard in the bar under the graph, shown while a Chord node is selected. It is drawn and hit-tested with the geometry in chordkeys.js
// (laid out in the canvas's own pixels), and the notes are changed with editNote and editVolume in chordtext.js through the callbacks the editor gives.
// Click a key to hear it and add or take away that note (drag across keys to paint), drag a bar under a lit key for that note's volume, the arrows
// or the wheel move the three octaves.
import { WIDTH, HEIGHT, startFor, hit, volumeAt, shifted, drawPanel } from './chordkeys.js';
import { chordView, describeChord, midiName } from './chordtext.js';

// `colours` gives the editor's colours; `toggle(n, note, on)` adds or removes a note; `volume(n, note, percent)` sets one; `hear(n, note)` sounds one;
// `before()` makes the undo point; `after()` runs when a press ends (the panel's other boxes follow the notes then).
export function chordKeyboard({ doc = document, colours, toggle, volume, hear, before, after }, n) {
  const canvas = doc.createElement('canvas'), dpr = (typeof devicePixelRatio === 'number' && devicePixelRatio) || 1;
  canvas.width = Math.round(WIDTH * dpr); canvas.height = Math.round(HEIGHT * dpr);
  Object.assign(canvas.style, { width: `${WIDTH}px`, height: `${HEIGHT}px`, touchAction: 'none' });
  canvas.className = 'ns-keyboard';
  const rect = { x: 0, y: 0, w: WIDTH, h: HEIGHT };
  let lo = startFor(chordView(n.data, n.params).notes), drag = null;

  const draw = () => {
    const ctx = canvas.getContext('2d'), cv = chordView(n.data, n.params), d = describeChord(n.data, n.params);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawPanel(ctx, colours(), { rect, p: 1, lo, notes: cv.notes, volumes: cv.base, stray: new Set(d.strayMidi ?? []), name: d.name, strayNames: d.stray, range: `${midiName(lo)}-${midiName(lo + 35)}` });
  };
  const at = e => { const r = canvas.getBoundingClientRect(); return [(e.clientX - r.left) * (WIDTH / r.width), (e.clientY - r.top) * (HEIGHT / r.height)]; };
  const found = e => { const [x, y] = at(e); return { x, y, h: hit(rect, lo, chordView(n.data, n.params).notes, x, y) }; };

  canvas.addEventListener('pointerdown', e => {
    const { y, h } = found(e);
    if (!h) return;
    e.preventDefault(); canvas.setPointerCapture?.(e.pointerId);
    if (h.kind === 'arrow') { lo = shifted(lo, h.dir); draw(); return; }
    before();
    if (h.kind === 'key') {
      const on = !chordView(n.data, n.params).notes.includes(h.note);
      toggle(n, h.note, on); hear(n, h.note); drag = { kind: 'key', on, last: h.note };
    } else if (h.kind === 'bar') { drag = { kind: 'bar', note: h.note, bar: h }; volume(n, h.note, volumeAt(h, y)); }
    draw();
  });
  canvas.addEventListener('pointermove', e => {
    if (!drag) return;
    const { y, h } = found(e);
    if (drag.kind === 'key' && h?.kind === 'key' && h.note !== drag.last) {   // dragging across keys paints them on or off, the way the first one went
      drag.last = h.note; hear(n, h.note);
      if (chordView(n.data, n.params).notes.includes(h.note) !== drag.on) toggle(n, h.note, drag.on);
    } else if (drag.kind === 'bar') volume(n, drag.note, volumeAt(drag.bar, y));
    draw();
  });
  const end = () => { if (!drag) return; drag = null; after(); };
  canvas.addEventListener('pointerup', end); canvas.addEventListener('pointercancel', end);
  canvas.addEventListener('wheel', e => { e.preventDefault(); lo = shifted(lo, e.deltaY < 0 ? 1 : -1); draw(); }, { passive: false });
  draw();
  return canvas;
}
