// Key chords and one table of the app's global shortcuts.
//
// A chord is written the way you would say it: 'Ctrl+Alt+KeyD', 'Alt+ArrowUp', 'F5', 'Mod+KeyS'.
//   - Ctrl, Alt, Shift and Meta must match exactly: 'Alt+KeyS' does not fire when Shift is also held.
//   - Mod means Ctrl or Meta (Cmd), so one chord covers Windows and macOS.
//   - The last part is compared with event.code (the physical key: 'KeyD', 'Digit1', 'Space') and with
//     event.key ('F5', 'ArrowUp', 'Pause', '|').
//
// const keys = createKeymap();
// keys.bind('Ctrl+Alt+KeyM', () => toggleMeters(), { name: 'Meters on and off' });
// keys.attach(document);
//
// A binding's run() may return false to say "not mine after all": the key is then left alone (not prevented) and the
// next matching binding gets its turn. Anything else counts as handled: the browser's own action is prevented.

const MODIFIERS = new Set(['Ctrl', 'Alt', 'Shift', 'Meta', 'Mod']);

export function parseChord(text) {
  const parts = text.split('+');
  const key = parts.pop();
  const chord = { ctrl: false, alt: false, shift: false, meta: false, mod: false, key, text };
  for (const part of parts) {
    if (!MODIFIERS.has(part)) throw new Error(`Unknown modifier "${part}" in chord "${text}"`);
    chord[part.toLowerCase()] = true;
  }
  if (!key) throw new Error(`Chord "${text}" names no key`);
  return chord;
}

export function matches(e, chord) {
  const c = typeof chord === 'string' ? parseChord(chord) : chord;
  if (e.altKey !== c.alt || e.shiftKey !== c.shift) return false;
  if (c.mod) { if (!(e.ctrlKey || e.metaKey) || c.ctrl || c.meta) return false; }
  else if (e.ctrlKey !== c.ctrl || e.metaKey !== c.meta) return false;
  return e.code === c.key || e.key === c.key;
}

export function createKeymap() {
  const bindings = [];
  let fallback = null;

  // options: { when(e), capture: false, stop: false, name }
  //   when     only active while this returns true (the key is left alone otherwise)
  //   capture  listen in the capture phase, before the focused element sees the key
  //   stop     also stop the key reaching any other listener
  //   name     what the shortcut does, in words (for a shortcut list)
  const bind = (chordText, run, { when = null, capture = false, stop = false, name = '' } = {}) => {
    const entry = { chord: parseChord(chordText), run, when, capture, stop, name };
    bindings.push(entry);
    return () => { const i = bindings.indexOf(entry); if (i >= 0) bindings.splice(i, 1); };
  };

  // Returns true if a binding took the key. `phase` is 'bubble' or 'capture'.
  const handle = (e, phase = 'bubble') => {
    for (const b of bindings) {
      if (b.capture !== (phase === 'capture')) continue;
      if (!matches(e, b.chord) || (b.when && !b.when(e))) continue;
      if (b.run(e) === false) continue;
      e.preventDefault();
      if (b.stop) e.stopPropagation();
      return true;
    }
    return phase === 'bubble' && fallback ? fallback(e) === true : false;
  };

  // What happens to a key no binding wanted (bubble phase). It returns true if it took the key; the app uses it for the tab keys.
  const otherwise = fn => { fallback = fn; };

  const attach = target => {
    const bubble = e => handle(e, 'bubble'), capture = e => handle(e, 'capture');
    target.addEventListener('keydown', bubble);
    target.addEventListener('keydown', capture, true);
    return () => { target.removeEventListener('keydown', bubble); target.removeEventListener('keydown', capture, true); };
  };

  const list = () => bindings.map(b => ({ chord: b.chord.text, name: b.name }));

  return { bind, otherwise, handle, attach, list };
}
