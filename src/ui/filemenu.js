// The File menu at the left of the top bar: Open, New, New From Existing (a submenu), then Save, Export and Backups.
// The items are the same buttons the bar used to carry (same ids), so what they do stays where it was; this file only opens
// and closes the menu, opens the submenu, and moves around with the keyboard.
export function createFileMenu({ button, menu, sub, subButton, doc = document }) {
  const items = () => [...menu.querySelectorAll(':scope > [role="menuitem"], :scope > .fm-sub > [role="menuitem"]')].filter(b => !b.disabled);
  const subItems = () => [...sub.querySelectorAll('[role="menuitem"]')].filter(b => !b.disabled);

  const openSub = (focus = false) => { sub.hidden = false; subButton.setAttribute('aria-expanded', 'true'); if (focus) subItems()[0]?.focus(); };
  const closeSub = () => { sub.hidden = true; subButton.setAttribute('aria-expanded', 'false'); };
  const close = () => { menu.hidden = true; button.setAttribute('aria-expanded', 'false'); closeSub(); };
  const open = () => { menu.hidden = false; button.setAttribute('aria-expanded', 'true'); };

  button.addEventListener('click', e => { e.stopPropagation(); if (menu.hidden) { open(); items()[0]?.focus(); } else close(); });
  doc.addEventListener('click', e => { if (!menu.hidden && !menu.contains(e.target)) close(); });

  // choosing an item closes the menu, except the one that opens the submenu
  menu.addEventListener('click', e => {
    const item = e.target.closest?.('[role="menuitem"]');
    if (!item) return;
    if (item === subButton) { e.stopPropagation(); sub.hidden ? openSub() : closeSub(); return; }
    close();
  });

  // the submenu follows the pointer, like a Windows menu
  const wrap = subButton.parentElement;
  wrap.addEventListener('mouseenter', () => { if (!subButton.disabled) openSub(); });
  wrap.addEventListener('mouseleave', closeSub);

  menu.addEventListener('keydown', e => {
    const inSub = sub.contains(e.target), list = inSub ? subItems() : items(), at = list.indexOf(e.target);
    if (e.key === 'ArrowDown') list[(at + 1) % list.length]?.focus();
    else if (e.key === 'ArrowUp') list[(at - 1 + list.length) % list.length]?.focus();
    else if (e.key === 'ArrowRight' && e.target === subButton) openSub(true);
    else if (e.key === 'ArrowLeft' && inSub) { closeSub(); subButton.focus(); }
    else if (e.key === 'Escape') { close(); button.focus(); }
    else return;
    e.preventDefault(); e.stopPropagation();
  });
  doc.addEventListener('keydown', e => { if (e.key === 'Escape' && !menu.hidden) close(); });
  return { open, close };
}
