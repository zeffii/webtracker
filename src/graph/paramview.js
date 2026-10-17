// The parameter panel: a compact list of rows, a name and a bar with the value written inside it, docked in the graph
// view. It knows nothing about nodes: it is given rows (see below), draws them, and handles the mouse and the keys.
//
// A row is { name, pos(), setPos(p), display(), hex(), step, big, fine, wired, exposed, bits, ported, hint(),
//            reset(), type(text), expose(on), port(on), setBits(n) }
//   pos / setPos   the slider position, 0 to 1
//   step, big, fine   how far one Left/Right, Shift+Left/Right and Ctrl+Left/Right move it, in position
//   display / hex     the value in real units, and the pattern cell's hex while the parameter is exposed ('' if not)
//   wired             a wire into its port drives it: the row is drawn dimmed
//   text()            the value as it is typed (in the parameter's own units); type(text) sets it, false if it cannot read it
//
// Keys (the owner calls key(e) from whatever has the focus): Up/Down choose a row, Left/Right change it (Shift more,
// Ctrl less), Home/End go to the ends, PageUp/PageDown jump rows, Enter opens the row's menu.
export function createParamView({ doc = document, el: host, showTip = () => {}, hideTip = () => {}, onFocusBack = () => {} }) {
  let rows = [], head = '', cursor = 0, menu = null, typing = null;
  const make = (tag, className, text) => { const e = doc.createElement(tag); if (className) e.className = className; if (text !== undefined) e.textContent = text; return e; };

  const clamp01 = x => Math.min(1, Math.max(0, x));
  const paint = (row, i) => {
    const bar = host.querySelectorAll?.('.pv-bar')[i];
    if (!bar) return;
    bar.style.setProperty('--p', `${clamp01(row.pos()) * 100}%`);
    bar.querySelector('.pv-val').textContent = row.display();
    const hex = row.hex();
    const h = bar.querySelector('.pv-hex');
    h.textContent = hex;
  };
  const paintAll = () => rows.forEach(paint);
  const mark = () => {
    host.querySelectorAll('.pv-row').forEach((r, i) => r.classList.toggle('sel', i === cursor));
    const r = host.querySelectorAll('.pv-row')[cursor];
    r?.scrollIntoView?.({ block: 'nearest' });
  };

  const closeMenu = () => { menu?.remove(); menu = null; };
  const cancelType = () => { const t = typing; typing = null; t?.remove(); };   // typing is cleared first: removing the focused input fires its blur

  const openMenu = () => {
    closeMenu(); cancelType();
    const row = rows[cursor];
    if (!row) return;
    const items = [
      ['Type a value…', () => startType()],
      ['Reset to default', () => { row.reset(); paintAll(); }],
      [row.exposed ? 'Remove pattern column' : 'Expose as pattern column', () => { row.expose(!row.exposed); }],
      ...(row.exposed ? [['1hex', 4], ['2hex', 8], ['4hex', 16]].map(([label, bits]) => [`${row.bits === bits ? '● ' : '○ '}width ${label}`, () => row.setBits(bits)]) : []),
      [row.ported ? 'Remove the port' : 'Add a port (wire a node in)', () => { row.port(!row.ported); }],
    ];
    menu = make('div', 'pv-menu');
    let at = 0;
    const draw = () => menu.querySelectorAll('.pv-mi').forEach((m, i) => m.classList.toggle('sel', i === at));
    items.forEach(([label, run], i) => {
      const item = make('div', 'pv-mi', label);
      item.addEventListener('mousedown', e => { e.preventDefault(); closeMenu(); run(); if (!typing) onFocusBack(); });
      item.addEventListener('mouseenter', () => { at = i; draw(); });
      menu.append(item);
    });
    menu.choose = d => { at = (at + d + items.length) % items.length; draw(); };
    menu.run = () => { const [, run] = items[at]; closeMenu(); run(); };
    host.append(menu);
    const rowEl = host.querySelectorAll('.pv-row')[cursor];
    menu.style.top = `${(rowEl?.offsetTop ?? 0) + 16}px`;
    draw();
  };

  const startType = () => {
    const row = rows[cursor];
    const bar = host.querySelectorAll('.pv-bar')[cursor];
    if (!row || !bar) return;
    cancelType();
    const input = make('input', 'pv-type');
    input.value = row.text();
    bar.append(input);
    typing = input;
    input.focus(); input.select?.();
    const done = ok => {
      if (typing !== input) return;
      const text = input.value;
      cancelType();
      if (ok && !row.type(text)) row.flash?.();
      paintAll();
      onFocusBack();
    };
    input.addEventListener('keydown', e => {
      e.stopPropagation();
      if (e.key === 'Enter') { done(true); e.preventDefault(); }
      else if (e.key === 'Escape') { done(false); e.preventDefault(); }
    });
    input.addEventListener('blur', () => done(false));
  };

  const set = (row, p) => { row.setPos(clamp01(p)); paintAll(); };

  const build = () => {
    host.replaceChildren();
    closeMenu(); typing = null;
    host.append(make('div', 'pv-head', head));
    rows.forEach((row, i) => {
      const line = make('div', `pv-row${row.wired ? ' wired' : ''}${row.exposed ? ' ex' : ''}${row.ported ? ' pt' : ''}`);
      const name = make('span', 'pv-name', row.name.length > 8 ? `${row.name.slice(0, 7)}…` : row.name);
      name.addEventListener('mouseenter', () => showTip(name, row.hint()));
      name.addEventListener('mouseleave', hideTip);
      const bar = make('div', 'pv-bar');
      const val = make('span', 'pv-val'), hex = make('span', 'pv-hex');
      bar.append(val, hex);
      const fromX = e => { const r = bar.getBoundingClientRect(); return (e.clientX - r.left - 1) / Math.max(1, r.width - 2); };
      bar.addEventListener('pointerdown', e => {
        if (e.target.classList?.contains('pv-type')) return;
        e.preventDefault();
        cursor = i; mark(); closeMenu();
        bar.setPointerCapture?.(e.pointerId);
        bar.dragging = true;
        set(row, fromX(e));
      });
      bar.addEventListener('pointermove', e => { if (bar.dragging) set(row, fromX(e)); });
      const end = e => { if (bar.dragging) { bar.dragging = false; bar.releasePointerCapture?.(e.pointerId); onFocusBack(); } };
      bar.addEventListener('pointerup', end); bar.addEventListener('pointercancel', end);
      bar.addEventListener('dblclick', () => { row.reset(); paintAll(); });
      line.addEventListener('contextmenu', e => { e.preventDefault(); cursor = i; mark(); openMenu(); });
      name.addEventListener('mousedown', e => { e.preventDefault(); cursor = i; mark(); closeMenu(); onFocusBack(); });
      line.append(name, bar);
      host.append(line);
    });
    paintAll(); mark();
  };

  return {
    // Shows a node's rows under a title strip. `at` is the row to select (kept between redraws).
    show(title, list, at = cursor) {
      head = title; rows = list; cursor = Math.min(Math.max(0, at), Math.max(0, rows.length - 1));
      host.style.display = rows.length ? 'block' : 'none';
      build();
    },
    hide() { rows = []; closeMenu(); cancelType(); host.style.display = 'none'; hideTip(); },
    refresh: paintAll,
    get cursor() { return cursor; },
    get open() { return rows.length > 0 && host.style.display !== 'none'; },
    key(e) {
      if (!this.open) return false;
      const k = e.key;
      if (menu) {
        if (k === 'ArrowDown') menu.choose(1);
        else if (k === 'ArrowUp') menu.choose(-1);
        else if (k === 'Enter') menu.run();
        else if (k === 'Escape') closeMenu();
        else return false;
        return true;
      }
      const row = rows[cursor];
      if (k === 'ArrowDown') cursor = Math.min(rows.length - 1, cursor + 1);
      else if (k === 'ArrowUp') cursor = Math.max(0, cursor - 1);
      else if (k === 'PageDown') cursor = Math.min(rows.length - 1, cursor + 8);
      else if (k === 'PageUp') cursor = Math.max(0, cursor - 8);
      else if (k === 'ArrowLeft' || k === 'ArrowRight' || k === '-' || k === '=' || k === '+') {
        const dir = k === 'ArrowLeft' || k === '-' ? -1 : 1;
        set(row, row.pos() + dir * (e.ctrlKey ? row.fine : e.shiftKey ? row.big : row.step));
        return true;
      } else if (k === 'Home') set(row, 0);
      else if (k === 'End') set(row, 1);
      else if (k === 'Enter') { openMenu(); return true; }
      else return false;
      mark();
      return true;
    },
  };
}
