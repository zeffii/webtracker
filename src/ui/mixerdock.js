// The mixer's dock: a band along the bottom of every view (above the meters and the status bar) that holds the mixer strips,
// with a drag handle on its top edge. Mouse only: nothing here takes the keyboard focus from the view underneath.
//
// The height is remembered. Dragging the handle down below HIDE_BELOW pixels hides the dock (the height it had is kept for when it
// is shown again); the Mixer button on the status bar shows and hides it too.
import { createSplitter } from './kit/splitter.js';

export const HIDE_BELOW = 20;   // a dock lower than this disappears
const MIN_SHOWN = 60, DEFAULT_HEIGHT = 146, KEY_ON = 'webtracker.mixer', KEY_HEIGHT = 'webtracker.mixerHeight';

export function createMixerDock({ dock, grip, onChange = () => {}, maxHeight = () => innerHeight * 0.6 }) {
  let on = false, height = DEFAULT_HEIGHT;
  try { on = localStorage.getItem(KEY_ON) === '1'; const h = Number(localStorage.getItem(KEY_HEIGHT)); if (h >= MIN_SHOWN) height = h; } catch { /* nothing remembered */ }

  const remember = () => { try { localStorage.setItem(KEY_ON, on ? '1' : '0'); localStorage.setItem(KEY_HEIGHT, String(Math.round(height))); } catch { /* private window */ } };
  const clamp = h => Math.max(MIN_SHOWN, Math.min(maxHeight(), h));

  // Put the state on the page, and tell the owner (which lays out the bottom of the window again).
  function apply() {
    dock.hidden = !on;
    dock.style.height = `${Math.round(height)}px`;
    onChange(on);
  }

  function setOn(value) { on = value; remember(); apply(); }

  // The dock grows as the pointer goes up. Pulled under HIDE_BELOW it hides, but the remembered height stays at what it was.
  let restoreHeight = height;
  createSplitter({
    grip, grows: 'up',
    current: () => { restoreHeight = height; return on ? height : 0; },
    change: wanted => {
      if (wanted < HIDE_BELOW) { height = restoreHeight; if (on) { on = false; apply(); } return; }
      height = clamp(wanted); on = true; apply();
    },
    done: remember,
    reset: () => { height = DEFAULT_HEIGHT; remember(); apply(); },
  });

  apply();
  return { get on() { return on; }, setOn, toggle: () => setOn(!on), shownHeight: () => (on ? Math.round(height) : 0), refit: apply };
}
