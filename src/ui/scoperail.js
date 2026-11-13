// The scope overlay's strip: icon switches and two small sliders along the left edge of the sequence view, like the graph's strip
// (graphrail.js). The controls are all in view: the on/off switch, the three looks (trace, phosphor, XY) and the two sliders,
// strength and window. Everything is a setting in Config, so the strip owns no state and follows Config when it is changed there.
// The strip is for the mouse: its buttons never take the keyboard focus from the pattern editor.
import { dragSlider } from './kit/slider.js';

const ICONS = {
  scope: '<svg viewBox="0 0 16 16"><rect x="1.5" y="3" width="13" height="10" rx="1"/><path d="M3 8c1.2-3 2.3-3 3.5 0s2.3 3 3.5 0 2.3-3 3-1"/></svg>',
  trace: '<svg viewBox="0 0 16 16"><path d="M1.5 8c1.5-5 3-5 4.5 0s3 5 4.5 0 2.2-3.5 4-2"/></svg>',
  phosphor: '<svg viewBox="0 0 16 16"><path opacity=".35" stroke-width="3.4" d="M1.5 8c1.5-5 3-5 4.5 0s3 5 4.5 0 2.2-3.5 4-2"/><path d="M1.5 8c1.5-5 3-5 4.5 0s3 5 4.5 0 2.2-3.5 4-2"/></svg>',
  xy: '<svg viewBox="0 0 16 16"><ellipse cx="8" cy="8" rx="2.6" ry="6" transform="rotate(40 8 8)"/></svg>',
};
const LOOKS = [
  { id: 'trace', name: 'Trace', what: 'left (orange) and right (blue) as two thin beams, steady notes stand still' },
  { id: 'phosphor', name: 'Phosphor', what: 'the same with a slow glow: old frames fade away, repeated hits build up' },
  { id: 'xy', name: 'XY', what: 'left against right: a mono sound is a diagonal line, a wide one fills out' },
];
// the two sliders: Config key, name, the range, how the value reads
const SLIDERS = [
  { key: 'scopeAmt', name: 'Strength', what: 'how bright the beams are over the notes', min: 10, max: 100, text: v => `${v}%` },
  { key: 'scopeWin', name: 'Window', what: 'how many milliseconds fit across the view', min: 8, max: 58, text: v => `${v} ms` },
];

export function createScopeRail({ host, config, doc = document }) {
  const rail = doc.createElement('div');
  rail.className = 'sc-rail'; rail.setAttribute('role', 'toolbar'); rail.setAttribute('aria-label', 'Scope overlay');
  const button = (id, icon) => {
    const b = doc.createElement('button');
    b.type = 'button'; b.className = 'gr-btn'; b.tabIndex = -1; b.dataset.id = id;
    b.innerHTML = `${icon}<span class="gr-tip"></span>`;
    b.addEventListener('mousedown', e => e.preventDefault());   // a click does not take the focus from the pattern editor
    return b;
  };
  const rule = () => { const r = doc.createElement('i'); r.className = 'sc-rule'; return r; };

  const power = button('scopeOn', ICONS.scope);
  power.addEventListener('click', () => config.set('scopeOn', !config.get('scopeOn')));
  rail.append(power, rule());
  const looks = LOOKS.map(look => {
    const b = button(look.id, ICONS[look.id]);
    b.addEventListener('click', () => { config.set('scopeLook', look.id); if (!config.get('scopeOn')) config.set('scopeOn', true); });   // choosing a look turns the scope on
    rail.append(b);
    return { look, b };
  });
  rail.append(rule());
  const row = doc.createElement('div'); row.className = 'sc-sliders'; rail.append(row);
  const sliders = SLIDERS.map(s => {
    const track = doc.createElement('div'), tip = doc.createElement('span');
    track.className = 'sc-track'; track.dataset.id = s.key; tip.className = 'gr-tip'; track.append(tip);
    track.addEventListener('mousedown', e => e.preventDefault());
    dragSlider(track, { axis: 'y', onChange: p => config.set(s.key, Math.round(s.min + p * (s.max - s.min))) });
    row.append(track);
    return { s, track, tip };
  });

  function sync() {
    const on = !!config.get('scopeOn'), look = config.get('scopeLook');
    power.setAttribute('aria-pressed', String(on));
    power.setAttribute('aria-label', `Scope overlay: ${on ? 'on' : 'off'}`);
    power.querySelector('.gr-tip').textContent = `Scope overlay · ${on ? 'on' : 'off'} · one big oscilloscope of the master output over the pattern view (Ctrl+Alt+L)`;
    for (const { look: l, b } of looks) {
      b.setAttribute('aria-pressed', String(look === l.id));
      b.setAttribute('aria-label', `${l.name}${look === l.id ? ' (selected)' : ''}`);
      b.querySelector('.gr-tip').textContent = `${l.name} · ${l.what}`;
    }
    for (const { s, track, tip } of sliders) {
      const v = config.get(s.key);
      track.style.setProperty('--p', `${(v - s.min) / (s.max - s.min) * 100}%`);
      track.setAttribute('aria-label', `${s.name}: ${s.text(v)}`);
      tip.textContent = `${s.name} · ${s.text(v)} · ${s.what}`;
    }
    rail.classList.toggle('sc-off', !on);   // the looks and sliders are dimmed while the scope is off
  }
  const mine = new Set(['scopeOn', 'scopeLook', 'scopeAmt', 'scopeWin']);
  config.onChange(key => { if (mine.has(key)) sync(); });
  sync();
  host.append(rail);
  // follows the sideways scroll of the host, so it stays at the left edge of what can be seen
  const follow = () => { rail.style.left = `${host.scrollLeft + 1}px`; };
  host.addEventListener('scroll', follow, { passive: true }); follow();
  return { el: rail, sync };
}
