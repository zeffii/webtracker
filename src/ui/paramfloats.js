// Pinned parameter panels: for any machine, a floating window with its exposed sliders that stays until it is closed. Several can be
// open at once, each remembers where it was put, and the set of pinned machines is remembered too (a machine that is gone from the
// project is dropped, one that comes back with a loaded project is opened again).
import { createFloating } from './kit/floating.js';
import { openPopout } from './kit/popout.js';

const KEY = 'webtracker.floatPins';

export function createParamFloats({ patcher, instrumentIds, say = () => {} }) {
  const open = new Map();   // machine id -> { panel, handle, popout }: popout is set while the panel is in a window of its own
  let wanted = [];          // the machine ids remembered as pinned
  try { wanted = JSON.parse(localStorage.getItem(KEY) ?? '[]').filter(id => typeof id === 'string'); } catch { /* none remembered */ }
  const remember = () => { try { localStorage.setItem(KEY, JSON.stringify(wanted)); } catch { /* private window */ } };

  function openPanel(id) {
    if (open.has(id)) return;
    const panel = createFloating({
      id: `pin.${id}`, title: `${id} · parameters`, offset: 28 * (open.size + 1), onClose: () => unpin(id),
      buttons: [{ text: '⇱', title: 'Pop this panel out into a window of its own; closing that window brings it back', onClick: () => popOut(id) }],
    });
    const handle = patcher.machinePanel(id, panel.content);
    open.set(id, { panel, handle, popout: null });
  }

  // The panel's rows are drawn again in a window of its own; when that window closes they come back into the floating panel.
  function popOut(id) {
    const entry = open.get(id);
    if (!entry || entry.popout) return;
    const popout = openPopout({ title: `${id} · parameters`, onClosed: () => popIn(id) });
    if (!popout) { say('The browser blocked the pop-out window: allow pop-ups for this page.'); return; }
    entry.handle.release();
    entry.panel.setAway(true);
    entry.popout = popout;
    entry.handle = patcher.machinePanel(id, popout.host, popout.doc);
  }

  function popIn(id) {
    const entry = open.get(id);
    if (!entry?.popout) return;
    entry.handle.release();
    entry.popout = null;
    entry.panel.setAway(false);
    entry.handle = patcher.machinePanel(id, entry.panel.content);
  }

  function closePanel(id) {
    const entry = open.get(id);
    if (!entry) return;
    entry.popout?.close();   // (its close brings the panel back in first, which is released below)
    entry.handle.release(); entry.panel.destroy(); open.delete(id);
  }

  function pin(id) { if (!wanted.includes(id)) wanted.push(id); remember(); openPanel(id); }
  function unpin(id) { wanted = wanted.filter(w => w !== id); remember(); closePanel(id); }

  return {
    has: id => open.has(id),
    toggle: id => { if (open.has(id)) unpin(id); else pin(id); },
    // After a project is loaded or machines are added or removed: open the remembered machines that exist, close those that are gone.
    reconcile() {
      const here = new Set(instrumentIds());
      for (const id of [...open.keys()]) if (!here.has(id)) closePanel(id);
      for (const id of wanted) if (here.has(id)) openPanel(id);
    },
    // Panels are for the main views: they are put away while another screen (settings, info) is showing.
    setVisible(on) { for (const { panel } of open.values()) panel.el.classList.toggle('fl-away', !on); },
    popOut,
  };
}
