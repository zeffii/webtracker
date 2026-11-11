// One stack for everything that pops up over the app: context menus, the machine menu, dialogs, help panels.
//
// Why: each popup used to listen for keys on its own, so who got Escape (or an arrow key) depended on which listener
// happened to be registered first. Now the topmost popup is the only one the keyboard talks to, and one rule covers all:
//
//   Escape   goes to the topmost popup. If its onEscape() used the key (clearing a search box, say) that is that;
//            otherwise the popup closes. Exactly one popup is dealt with per press, and the key goes no further.
//   Other keys   go to the topmost popup's onKey(e) first; it returns true if it took the key.
//   A mouse press outside a popup's element calls its onOutside() (default: close), unless outside is false.
//   A scroll outside it closes it, if closeOnScroll is set.
//
// Two kinds of popup: the ones that take over (menus, dialogs) hear the keyboard wherever the focus is, and the floating
// panels you work beside (help, parameters) set focusScoped: they only hear it while the focus is inside them, so Escape
// in the pattern editor never closes a panel you left open.
//
// const layer = popups.open({ name: 'context menu', element: menu, close, onKey, closeOnScroll: true });
// ...and when the popup closes by itself (an item was chosen), tell the stack: layer.release().
// (When the stack closes it, on Escape or a press outside, it takes the popup off by itself.)
//
// A popup whose element has been removed from the page or hidden is dropped from the stack by itself, so a forgotten
// release() can never leave a ghost that swallows Escape.

const PLAIN_ESCAPE = e => e.key === 'Escape' && !e.ctrlKey && !e.altKey && !e.metaKey;

export function createPopups() {
  const layers = [];   // the last one is on top
  const attached = new WeakSet();

  // A layer is alive while its element is on the page and shown (a layer with no element stays until released).
  const alive = layer => !layer.element || (layer.element.isConnected !== false && !layer.element.hidden);
  const dropDead = () => { for (let i = layers.length - 1; i >= 0; i--) if (!alive(layers[i])) layers.splice(i, 1); };
  // The layer the keyboard talks to: the topmost one that is listening (a focusScoped panel listens only while it holds the focus).
  const listening = layer => !layer.focusScoped || !!layer.element?.contains(layer.doc?.activeElement ?? null);
  const top = () => { dropDead(); return [...layers].reverse().find(listening) ?? null; };
  const remove = layer => { const i = layers.indexOf(layer); if (i >= 0) layers.splice(i, 1); };
  // Closing from the stack's side always takes the layer off too, so a popup that forgets release() cannot leave a ghost behind.
  const closeLayer = layer => { remove(layer); layer.close(); };

  // stopImmediatePropagation also keeps the key from the other listeners on the document (the shortcut table among them)
const consume = e => { e.preventDefault(); e.stopImmediatePropagation(); };

  // Returns true if a popup took the key.
  const handleKey = e => {
    const layer = top();
    if (!layer) return false;
    if (layer.onKey?.(e) === true) { consume(e); return true; }
    if (PLAIN_ESCAPE(e)) {
      if (layer.onEscape?.() !== true) closeLayer(layer);
      consume(e);
      return true;
    }
    return false;
  };

  // A mouse press: every popup the press landed outside of hears about it, the topmost first. The press itself is never consumed.
  const handlePress = e => {
    dropDead();
    for (const layer of [...layers].reverse()) {
      if (layer.outside === false || !layer.element || layer.element.contains(e.target)) continue;
      if (layer.onOutside) { remove(layer); layer.onOutside(); } else closeLayer(layer);
    }
  };

  const handleScroll = e => {
    dropDead();
    for (const layer of [...layers].reverse()) if (layer.closeOnScroll && layer.element && !layer.element.contains(e.target)) closeLayer(layer);
  };

  const attach = doc => {
    if (attached.has(doc) || typeof doc.addEventListener !== 'function') return;   // (the tests' stand-in documents take no listeners)
    attached.add(doc);
    doc.addEventListener('keydown', handleKey, true);
    doc.addEventListener('mousedown', handlePress, true);
    doc.addEventListener('scroll', handleScroll, true);
  };

  // options: { name, element, close, onKey, onEscape, outside, onOutside, closeOnScroll, focusScoped, doc }
  const open = ({ name = '', element = null, close, onKey = null, onEscape = null, outside = true, onOutside = null, closeOnScroll = false, focusScoped = false, doc = null }) => {
    if (doc) attach(doc);
    const layer = { name, element, close, onKey, onEscape, outside, onOutside, closeOnScroll, focusScoped, doc };
    layers.push(layer);
    return { release: () => remove(layer) };
  };

  const names = () => { dropDead(); return layers.map(l => l.name); };   // for tests and a debug view: who is open, bottom first

  return { open, attach, handleKey, handlePress, handleScroll, names, get isOpen() { dropDead(); return layers.length > 0; } };
}

// The app's one stack.
export const popups = createPopups();
