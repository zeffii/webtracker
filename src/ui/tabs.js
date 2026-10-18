// Full-screen panes switched by F-keys or by clicking the tab buttons. Only one pane is
// shown at a time. Panes are plain containers, so a later split layout can host the same ones.
// tabs: [{ id, key: 'F1', el, button, focus }]; `focus` is the element that takes the keyboard.
export function createTabs({ tabs, onChange = () => {}, initial = tabs[0].id }) {
  let active = null;

  const show = (id, { focus = true } = {}) => {
    const tab = tabs.find(t => t.id === id);
    if (!tab) return false;
    active = id;
    for (const t of tabs) {
      t.el.hidden = t !== tab;
      t.button.classList.toggle('active', t === tab);
      t.button.setAttribute('aria-selected', String(t === tab));
    }
    if (focus) tab.focus?.focus();
    onChange(id);
    return true;
  };

  for (const t of tabs) t.button.addEventListener('click', () => show(t.id));

  // Returns true if the key switched tabs.
  const handleKey = e => {
    if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return false;
    const tab = tabs.find(t => t.key === e.key);
    if (!tab) return false;
    e.preventDefault();
    show(tab.id);
    return true;
  };

  show(initial, { focus: false });
  return { show, handleKey, get active() { return active; } };
}
