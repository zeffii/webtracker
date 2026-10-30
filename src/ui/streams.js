// The Stream Manager: a drawer that slides up from the bottom bar and lists every lane with what its machine is doing (live voices, level,
// share of the audio block it costs) and two switches. Wax runs one AudioWorklet for everything, so the lanes are parts of it. Cut stops a
// machine and skips it (it costs nothing) until Play is pressed; Reset rebuilds it (voices, delay tails, filter state), then it carries on.
// Nothing is timed or sent while the drawer is closed.
export function createStreams({ root, button, footer, engine, lanes, instruments, nodeTypes, sampleRate = () => 44100, skip = [], silent = [], doc = document }) {
  const el = (tag, props = {}, ...kids) => { const e = doc.createElement(tag); Object.assign(e, props); for (const k of kids) e.append(k); return e; };
  let open = false, rows = null, sig = '', cells = new Map(), smooth = new Map();
  const head = el('div', { className: 'st-head' });
  const title = el('b', { textContent: 'Stream Manager' }), info = el('span', { className: 'st-dim' }), tot = el('span'), spacer = el('span', { className: 'st-grow' });
  const btn = (text, title2, run) => { const b = el('button', { type: 'button', textContent: text, title: title2 }); b.addEventListener('click', run); return b; };
  const collapse = el('button', { type: 'button', className: 'st-collapse', title: 'Collapse', ariaLabel: 'Collapse the Stream Manager', innerHTML: '<svg class="ico" viewBox="0 0 12 12"><path d="M2 4l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>' });
  const real = () => lanes().filter(l => !skip.includes(l.instrument));
  const ids = () => [...new Set(real().filter(l => !silent.includes(l.instrument)).map(l => l.instrument))];
  head.append(title, info, tot, spacer,
    btn('Reset all', 'Rebuild every machine: voices, delay tails and filter state are cleared', () => engine.resetStreams(ids())),
    btn('Cut all', 'Stop every machine and skip it until Play is pressed', () => engine.cutStreams(ids(), true)),
    btn('Resume all', 'Bring back the machines that are cut', () => engine.cutStreams(ids(), false)), collapse);
  const table = el('table'), body = el('tbody');
  // fixed columns, so a longer name or a number gaining a digit never moves the columns beside it
  const widths = ['11rem', '13rem', '12rem', '8rem', '10rem', ''];
  table.append(el('colgroup', {}, ...widths.map(w => { const c = el('col'); if (w) c.style.width = w; return c; })), el('thead', {}, el('tr', {}, ...['lane', 'machine', 'voices', 'level', 'load', ''].map(t => el('th', { textContent: t })))), body);
  const scroll = el('div', { className: 'st-scroll' }, table), foot = el('div', { className: 'st-foot', textContent: 'Cut: the machine stops and is skipped (no CPU) until Play is pressed. Reset: clears its voices, delay tails and filter state, then carries on. Load is the time spent in it per audio block.' });
  root.append(head, scroll, foot);

  const hue = s => { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };
  const kind = id => {
    const def = instruments()[id], nodes = def?.graph?.nodes ?? [];
    const src = (nodes.find(n => nodeTypes[n.type]?.category === 'Sources' && n.type !== 'env') ?? nodes.find(n => nodeTypes[n.type]?.category === 'Sources'))?.type ?? 'machine';
    return `${src}${def?.graph?.voices > 1 ? ` · ${def.graph.voices} voices` : ''}`;
  };

  function build() {
    body.replaceChildren(); cells = new Map();
    for (const l of real()) {
      const dead = silent.includes(l.instrument);
      const tr = el('tr'), name = el('td', {}, el('i', { className: 'st-sw' }), el('span', { textContent: l.id }), el('em', { className: 'st-badge', textContent: 'CUT', hidden: true }));
      name.firstChild.style.background = `hsl(${hue(l.instrument)} 45% 50%)`;
      const v = el('td'), vbar = el('span', { className: 'st-v' }), vn = el('span'), level = el('span', { className: 'st-meter' }, el('i')), load = el('span', { className: 'st-meter st-load' }, el('i')), pct = el('span');
      const reset = btn('Reset', 'Rebuild this machine: voices, delay tails and filter state are cleared', () => engine.resetStreams([l.instrument])), cut = btn('Cut', 'Stop this machine and skip it until Play is pressed', () => engine.cutStreams([l.instrument], !rows?.[l.instrument]?.cut));
      v.append(vbar, vn); vn.className = 'st-num'; pct.className = 'st-num';
      tr.append(name, el('td', { textContent: kind(l.instrument) }), v, el('td', {}, level), el('td', {}, load, pct), el('td', { className: 'st-act' }, dead ? el('span', { className: 'st-dim', textContent: 'nothing to cut' }) : reset, ...(dead ? [] : [cut])));
      if (dead) { vn.textContent = '—'; pct.textContent = ' '; level.style.visibility = load.style.visibility = 'hidden'; }
      body.append(tr);
      cells.set(l.id, { tr, badge: name.lastChild, vbar, vn, level: level.firstChild, load: load.firstChild, pct, cut, id: l.instrument, dead });
    }
  }

  function update(r) {
    rows = r;
    const s = real().map(l => l.id).join(',');
    if (s !== sig) { sig = s; build(); }
    let voices = 0, cap = 0, cpu = 0;
    for (const c of cells.values()) {
      if (c.dead) continue;
      const row = r[c.id]; if (!row) continue;
      voices += row.v; cap += row.vt; 
      const m = smooth.get(c.id) ?? { ms: 0, peak: 0 };
      m.ms += (row.ms - m.ms) * 0.3; m.peak = Math.max(row.peak, m.peak * 0.8); smooth.set(c.id, m);
      cpu += m.ms;
      c.tr.classList.toggle('cut', !!row.cut); c.badge.hidden = !row.cut; c.cut.classList.toggle('on', !!row.cut);
      const n = row.vt || 1;
      if (c.vbar.childElementCount !== Math.min(n, 16)) { c.vbar.replaceChildren(...Array.from({ length: Math.min(n, 16) }, () => el('u'))); }
      [...c.vbar.children].forEach((u, i) => u.classList.toggle('a', i < row.v));
      c.vn.textContent = ` ${row.v}`;
      c.level.style.width = `${Math.max(0, Math.min(1, (20 * Math.log10(m.peak || 1e-6) + 60) / 60)) * 100}%`;
      c.load.style.width = `${Math.min(100, m.ms * 100)}%`; c.load.parentElement.classList.toggle('hot', m.ms > 0.2);
      c.pct.textContent = ` ${Math.round(m.ms * 100)}%`;
    }
    info.textContent = `1 AudioWorklet tracker-engine · ${sampleRate()} Hz`;
    tot.textContent = `${cells.size} lanes · voices ${voices}/${cap} · load ${Math.round(cpu * 100)}%`;
  }

  const place = () => { root.style.bottom = `${footer.offsetHeight}px`; };
  function set(on) {
    open = on; root.hidden = !on; button.setAttribute('aria-pressed', String(on)); button.classList.toggle('on', on);
    engine.watchStreams(on);
    if (on) { sig = ''; place(); } else { smooth.clear(); }
  }
  button.addEventListener('click', e => { set(!open); e.currentTarget.blur(); });
  collapse.addEventListener('click', () => set(false));
  root.addEventListener('keydown', e => { if (e.key === 'Escape') set(false); });
  root.addEventListener('click', e => e.target.closest?.('button')?.blur());   // keys stay with the song: F5 and F8 still play and stop
  return { update, set, place, get open() { return open; }, toggle: () => set(!open) };
}
