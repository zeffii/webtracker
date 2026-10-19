// The Backups panel: the snapshots, newest first, each with Restore and Save as file; Back up now; the backup folder.
// `backups` is the object from project/backup.js. onRestore(text, meta) opens a snapshot; onSave(text, meta) offers it as a file.
const ago = ms => {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 90) return `${s} s ago`;
  const m = Math.round(s / 60);
  if (m < 90) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 36 ? `${h} h ago` : `${Math.round(h / 24)} days ago`;
};
const kb = n => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const clock = t => new Date(t).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' });
const REASON = { auto: 'automatic', save: 'save', folder: 'folder chosen', manual: 'backed up by hand', 'before load': 'before a load', 'before clear': 'before a clear', 'before restore': 'before a restore' };

export function createBackupPanel({ doc = document, el, backups, onRestore, onSave, canPickFolder = false, isBrave = false, pickFolder = null, say = () => {}, now = () => Date.now() }) {
  const make = (tag, className, text) => { const e = doc.createElement(tag); if (className) e.className = className; if (text !== undefined) e.textContent = text; return e; };
  const button = (label, fn, title) => { const b = make('button', '', label); b.type = 'button'; if (title) b.title = title; b.addEventListener('click', fn); return b; };

  async function render() {
    const rows = await backups.list(), f = backups.folder;
    el.replaceChildren();
    const head = make('div', 'bk-head');
    head.append(make('b', '', 'Backups'), make('span', 'bk-hint', 'Esc closes'), button('Back up now', async () => { const m = await backups.snapshot('manual'); say(m ? 'Backed up.' : 'Nothing has changed since the last backup.'); }), button('Close', () => api.hide()));
    el.append(head);
    const foot = make('div', 'bk-folder');
    if (!canPickFolder) {
      foot.append(make('span', 'bk-hint', 'This browser cannot write to a folder; the snapshots here are the backups.'));
      if (isBrave) foot.append(make('span', 'bk-hint', 'Brave keeps this switched off. To use a backup folder, open brave://flags/#file-system-access-api, set it to Enabled, and relaunch Brave.'));
    }
    else {
      const state = { none: 'No backup folder.', unknown: 'Checking the folder…', granted: 'Writing to', ok: 'Writing to', prompt: 'Needs permission again:', error: 'Could not write to' }[f.state] ?? '';
      foot.append(make('span', '', f.name ? `${state} ${f.name}` : state));
      if (f.state === 'prompt') foot.append(button('Allow', async () => { await backups.allowFolder(); render(); }));
      foot.append(button(f.name ? 'Change folder…' : 'Choose a backup folder…', async () => { try { await backups.chooseFolder(pickFolder); } catch { /* cancelled */ } render(); }, 'A folder the page may write the project into: a git, Dropbox or Syncthing folder'));
      if (f.name) foot.append(button('Stop', async () => { await backups.forgetFolder(); render(); }));
    }
    el.append(foot);
    const list = make('div', 'bk-list');
    if (!rows.length) list.append(make('p', 'bk-hint', 'No snapshots yet. The first is taken a few minutes after you start working, and whenever you Save.'));
    for (const r of rows) {
      const line = make('div', 'bk-row');
      line.append(make('span', 'bk-when', `${clock(r.time)} · ${ago(now() - r.time)}`), make('span', 'bk-what', `${r.name ?? ''} · ${REASON[r.reason] ?? r.reason} · ${kb(r.size)}`),
        button('Restore', async () => { const text = await backups.text(r.id); if (text) onRestore(text, r); }, 'Open this snapshot. The current project is backed up first.'),
        button('Save as file', async () => { const text = await backups.text(r.id); if (text) onSave(text, r); }));
      list.append(line);
    }
    el.append(list);
  }
  const api = {
    async show() { el.hidden = false; await render(); el.focus(); },
    hide() { el.hidden = true; },
    get open() { return !el.hidden; },
    refresh() { if (!el.hidden) render(); },
  };
  el.addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); api.hide(); } });
  return api;
}
