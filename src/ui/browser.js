// The browser: a collapsible panel down the left of every view that holds the lists of things the song is made of (patterns,
// machines, later samples). It owns no list itself: each section is an existing element (with its own keys and drawing) that is
// moved in here once, so there is one list per thing.
//
// The panel's width and whether it is open are remembered. Dragging its right edge in past HIDE_BELOW pixels closes it.
import { createSplitter } from './kit/splitter.js';

export const HIDE_BELOW = 90;   // a browser narrower than this closes
const MIN_SHOWN = 160, MAX_SHOWN = 600, DEFAULT_WIDTH = 260, KEY_ON = 'webtracker.browser', KEY_WIDTH = 'webtracker.browserWidth', KEY_TAB = 'webtracker.browserTab';

// sections: [{ id, label, element }]; onChange(open, width) tells the owner to lay out the window again.
export function createBrowser({ el, tabsEl, bodyEl, grip, sections, onChange = () => {} }) {
  let on = true, width = DEFAULT_WIDTH, active = sections[0].id;
  try {
    on = localStorage.getItem(KEY_ON) !== '0';
    const w = Number(localStorage.getItem(KEY_WIDTH)); if (w >= MIN_SHOWN) width = w;
    const t = localStorage.getItem(KEY_TAB); if (sections.some(s => s.id === t)) active = t;
  } catch { /* nothing remembered */ }

  const remember = () => { try { localStorage.setItem(KEY_ON, on ? '1' : '0'); localStorage.setItem(KEY_WIDTH, String(Math.round(width))); localStorage.setItem(KEY_TAB, active); } catch { /* private window */ } };
  const clamp = w => Math.max(MIN_SHOWN, Math.min(MAX_SHOWN, w));

  // One button per section on the strip along the top; each section's element goes into a holder of its own.
  const holders = new Map(), buttons = new Map();
  for (const s of sections) {
    const b = document.createElement('button');
    b.type = 'button'; b.textContent = s.label; b.tabIndex = -1;   // the browser is for the mouse; the views keep the keyboard
    b.addEventListener('mousedown', e => e.preventDefault());
    b.addEventListener('click', () => show(s.id));
    tabsEl.append(b); buttons.set(s.id, b);
    const holder = document.createElement('div');
    holder.className = 'br-section'; holder.dataset.section = s.id; holder.append(s.element);
    bodyEl.append(holder); holders.set(s.id, holder);
  }

  function paint() {
    el.hidden = !on;
    el.style.width = `${Math.round(width)}px`;
    document.body.style.setProperty('--browser-w', on ? `${Math.round(width)}px` : '0px');
    document.body.classList.toggle('browser-open', on);
    for (const s of sections) { holders.get(s.id).hidden = s.id !== active; buttons.get(s.id).classList.toggle('active', s.id === active); }
    onChange(on, width);
  }

  function show(id) { active = id; remember(); paint(); }
  function setOn(value) { on = value; remember(); paint(); }

  let restoreWidth = width;
  createSplitter({
    grip, grows: 'right',
    current: () => { restoreWidth = width; return on ? width : 0; },
    change: wanted => {
      if (wanted < HIDE_BELOW) { width = restoreWidth; if (on) { on = false; paint(); } return; }
      width = clamp(wanted); on = true; paint();
    },
    done: remember,
    reset: () => { width = DEFAULT_WIDTH; remember(); paint(); },
  });

  paint();
  return { get on() { return on; }, get active() { return active; }, setOn, toggle: () => setOn(!on), show, shows: id => on && active === id };
}
