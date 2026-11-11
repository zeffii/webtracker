// The browser: a collapsible panel down the left of every view that holds the lists of things the song is made of (patterns,
// machines, later samples). It owns no list itself: each section is an existing element (with its own keys and drawing) that is
// moved in here once, so there is one list per thing.
//
// Under the lists, split off by a drag bar, are the options of the view being shown (an instrument's voices and presets, the lane
// controls of the song): existing blocks moved in the same way, one per view. A view without options gives the lists the whole panel.
//
// The panel's width and whether it is open are remembered. Dragging its right edge in past HIDE_BELOW pixels closes it.
import { createSplitter } from './kit/splitter.js';

export const HIDE_BELOW = 90;   // a browser narrower than this closes
const MIN_SHOWN = 160, MAX_SHOWN = 600, DEFAULT_WIDTH = 300, KEY_ON = 'webtracker.browser', KEY_WIDTH = 'webtracker.browserWidth', KEY_TAB = 'webtracker.browserTab', KEY_OPTIONS = 'webtracker.browserOptionsHeight';
const MIN_OPTIONS = 60, DEFAULT_OPTIONS = 280;

// sections: [{ id, label, element }]; onChange(open, width) tells the owner to lay out the window again.
// options: [{ views: ['instruments'], element }] (the view ids are the tab ids); splitGrip and optionsEl are the bar and the area under the lists.
export function createBrowser({ el, tabsEl, bodyEl, grip, sections, options = [], splitGrip, optionsEl, onChange = () => {} }) {
  let on = true, width = DEFAULT_WIDTH, active = sections[0].id, optionsHeight = DEFAULT_OPTIONS, view = null;
  try {
    on = localStorage.getItem(KEY_ON) !== '0';
    const w = Number(localStorage.getItem(KEY_WIDTH)); if (w >= MIN_SHOWN) width = w;
    const t = localStorage.getItem(KEY_TAB); if (sections.some(s => s.id === t)) active = t;
    const oh = Number(localStorage.getItem(KEY_OPTIONS)); if (oh >= MIN_OPTIONS) optionsHeight = oh;
  } catch { /* nothing remembered */ }

  const remember = () => { try { localStorage.setItem(KEY_ON, on ? '1' : '0'); localStorage.setItem(KEY_WIDTH, String(Math.round(width))); localStorage.setItem(KEY_TAB, active); localStorage.setItem(KEY_OPTIONS, String(Math.round(optionsHeight))); } catch { /* private window */ } };
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

  // One holder per block of options; the one for the current view is shown.
  const optionHolders = options.map(o => {
    const holder = document.createElement('div');
    holder.className = 'br-options'; holder.append(o.element); optionsEl.append(holder);
    return { views: o.views, holder };
  });
  const currentOptions = () => optionHolders.find(o => view && o.views.includes(view));

  function paintOptions() {
    const mine = currentOptions();
    for (const o of optionHolders) o.holder.hidden = o !== mine;
    splitGrip.hidden = optionsEl.hidden = !mine;
    optionsEl.style.height = `${Math.round(Math.min(optionsHeight, Math.max(MIN_OPTIONS, el.clientHeight - 120)))}px`;
  }

  function paint() {
    el.hidden = !on;
    el.style.width = `${Math.round(width)}px`;
    document.body.style.setProperty('--browser-w', on ? `${Math.round(width)}px` : '0px');
    document.body.classList.toggle('browser-open', on);
    for (const s of sections) { holders.get(s.id).hidden = s.id !== active; buttons.get(s.id).classList.toggle('active', s.id === active); }
    paintOptions();
    onChange(on, width);
  }

  // The view being shown (a tab id), so the options that belong to it appear under the lists.
  function showView(id) { view = id; paintOptions(); }
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

  // The bar between the lists and the options: dragging it up gives the options more room.
  createSplitter({
    grip: splitGrip, grows: 'up',
    current: () => optionsEl.offsetHeight,
    change: wanted => { optionsHeight = Math.max(MIN_OPTIONS, Math.min(el.clientHeight - 80, wanted)); paintOptions(); },
    done: remember,
    reset: () => { optionsHeight = DEFAULT_OPTIONS; remember(); paintOptions(); },
  });

  paint();
  return { showView, get on() { return on; }, get active() { return active; }, setOn, toggle: () => setOn(!on), show, shows: id => on && active === id };
}
