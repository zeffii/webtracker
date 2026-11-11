// A splitter: a drag handle that resizes one region by mouse. It does the pointer work only; the owner decides what a size means
// (clamping, hiding under a minimum, remembering it). Used by the mixer dock (grows upwards) and the browser (grows rightwards).
//
//   current()      the region's size in pixels now (0 when it is hidden)
//   change(px)     the size the pointer asks for; may be anything, the owner clamps or hides
//   done()         the drag ended (a good moment to remember the size)
//   reset()        the handle was double-clicked
//   grows          'up': dragging the handle up makes the region bigger; 'right': dragging it right does
export function createSplitter({ grip, grows, current, change, done = () => {}, reset = () => {} }) {
  grip.addEventListener('pointerdown', e => {
    const start = current(), from = grows === 'up' ? e.clientY : e.clientX;
    grip.setPointerCapture?.(e.pointerId);
    grip.classList.add('dragging');
    const move = ev => change(start + (grows === 'up' ? from - ev.clientY : ev.clientX - from));
    const up = () => {
      grip.classList.remove('dragging');
      grip.removeEventListener('pointermove', move); grip.removeEventListener('pointerup', up); grip.removeEventListener('pointercancel', up);
      done();
    };
    grip.addEventListener('pointermove', move); grip.addEventListener('pointerup', up); grip.addEventListener('pointercancel', up);
    e.preventDefault();   // the view underneath keeps the keyboard focus
  });
  grip.addEventListener('dblclick', reset);
}
