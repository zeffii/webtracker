// Automatic backups of the project: a rolling set of snapshots in the browser's own database (IndexedDB), and, when a
// folder has been chosen, a copy written there too (a git folder works: the page only writes the files).
//
// A snapshot is the project exactly as Save would write it. One is taken every few minutes while the project has
// changed, whenever you Save, whenever the tab is hidden, and before anything that replaces the project (a load, a clear,
// a restore). A snapshot that is identical to the newest one is not stored. Only the newest `keep` are kept.

export const hashOf = text => {   // FNV-1a over the text: enough to tell "unchanged" from "changed"
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return `${text.length}:${h.toString(16)}`;
};

// The same interface, in memory (for tests and for browsers with no IndexedDB).
export function memoryStore() {
  const rows = new Map(), kv = new Map();
  let next = 1;
  return {
    async put(rec) { const id = next++; rows.set(id, { ...rec, id }); return id; },
    async list() { return [...rows.values()].sort((a, b) => b.time - a.time || b.id - a.id).map(({ text, ...meta }) => meta); },
    async get(id) { return rows.get(id) ?? null; },
    async remove(id) { rows.delete(id); },
    async getKv(key) { return kv.get(key); },
    async setKv(key, value) { kv.set(key, value); },
  };
}

export function idbStore(name = 'webtracker-backups') {
  const open = () => new Promise((resolve, reject) => {
    const req = indexedDB.open(name, 1);
    req.onupgradeneeded = () => { const db = req.result; db.createObjectStore('snapshots', { keyPath: 'id', autoIncrement: true }); db.createObjectStore('kv'); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  let db = null;
  const run = async (storeName, mode, fn) => {
    db ??= await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, mode), out = fn(tx.objectStore(storeName));
      tx.oncomplete = () => resolve(out.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  };
  return {
    put: rec => run('snapshots', 'readwrite', s => s.add(rec)),
    async list() {
      const all = await run('snapshots', 'readonly', s => s.getAll());
      return all.sort((a, b) => b.time - a.time || b.id - a.id).map(({ text, ...meta }) => meta);
    },
    get: id => run('snapshots', 'readonly', s => s.get(id)),
    remove: id => run('snapshots', 'readwrite', s => s.delete(id)),
    getKv: key => run('kv', 'readonly', s => s.get(key)),
    setKv: (key, value) => run('kv', 'readwrite', s => s.put(value, key)),
  };
}

const pad = n => String(n).padStart(2, '0');
export const stamp = t => { const d = new Date(t); return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`; };
export const safeName = name => (String(name ?? 'untitled').replace(/[^\w.\- ]+/g, '_').trim() || 'untitled').slice(0, 60);

// serialize(): the project as text, or null when there is none yet. options: () => { on, minutes, keep, folderMode }.
export function createBackups({ serialize, getName = () => 'untitled', options, store = memoryStore(), now = () => Date.now(), onChange = () => {}, ext = '.wax', fileExt = ext }) {
  let lastHash = null, timer = null, chain = Promise.resolve(), folder = null, folderState = 'none', folderName = '';
  const opts = () => ({ on: true, minutes: 3, keep: 30, folderMode: 'latest', ...(options?.() ?? {}) });

  async function loadFolder() {
    try { folder = (await store.getKv('folder')) ?? null; } catch { folder = null; }
    folderName = folder?.name ?? '';
    folderState = folder ? 'unknown' : 'none';
    onChange();
  }

  // 'granted' when the folder can be written without asking; 'prompt' when the browser has to be asked again (needs a click)
  async function permission() {
    if (!folder) return 'none';
    try { return (await folder.queryPermission({ mode: 'readwrite' })) === 'granted' ? 'granted' : 'prompt'; } catch { return 'prompt'; }
  }

  async function writeFolder(text, time) {
    if (!folder) return false;
    folderState = await permission();
    if (folderState !== 'granted') { onChange(); return false; }
    const base = safeName(getName()), mode = opts().folderMode;
    const file = mode === 'stamped' ? `${base}-${stamp(time)}${fileExt}` : `${base}${fileExt}`;
    try {
      const handle = await folder.getFileHandle(file, { create: true }), w = await handle.createWritable();
      await w.write(text); await w.close();
      folderState = 'ok';
    } catch { folderState = 'error'; }
    onChange();
    return folderState === 'ok';
  }

  async function prune() {
    const keep = Math.max(1, opts().keep), all = await store.list();
    for (const rec of all.slice(keep)) await store.remove(rec.id);
  }

  // Takes a snapshot now (unless nothing changed since the last one). The project is written out at once, so a snapshot
  // asked for just before something replaces the project holds what it was; the storing follows in order. Returns the
  // record's meta, or null.
  function snapshot(reason = 'auto') {
    let text;
    try { text = serialize(); } catch (err) { onChange(err); return Promise.resolve(null); }
    if (text == null) return Promise.resolve(null);
    const time = now();
    chain = chain.then(async () => {
      try {
        const hash = hashOf(text);
        if (lastHash === null) lastHash = (await store.list())[0]?.hash ?? '';
        if (hash === lastHash) return null;
        const meta = { time, name: getName(), reason, size: text.length, hash };
        meta.id = await store.put({ ...meta, text });
        lastHash = hash;
        await prune();
        await writeFolder(text, time);
        onChange();
        return meta;
      } catch (err) { onChange(err); return null; }
    });
    return chain;
  }

  // The download fallback: the page cannot write to a folder in every browser, so it can offer the project as a file
  // every few minutes instead. takeDownload() gives the project when it has changed since the last one (or null).
  let lastDownload = null;
  return {
    baselineDownload() { try { const t = serialize(); lastDownload = t == null ? null : hashOf(t); } catch { lastDownload = null; } },
    takeDownload() {
      const text = serialize();
      if (text == null) return null;
      const hash = hashOf(text);
      if (lastDownload === null) { lastDownload = hash; return null; }
      if (hash === lastDownload) return null;
      lastDownload = hash;
      return { text, time: now(), name: getName() };
    },
    snapshot,
    list: () => store.list(),
    async text(id) { return (await store.get(id))?.text ?? null; },
    async remove(id) { await store.remove(id); onChange(); },
    start() {
      loadFolder();
      this.stop();
      const tick = () => { if (opts().on) snapshot('auto'); };
      timer = setInterval(tick, Math.max(1, opts().minutes) * 60000);
    },
    restart() { this.start(); },
    stop() { if (timer) clearInterval(timer); timer = null; },
    // The folder: chosen once with the browser's own picker, remembered, and asked about again after a restart.
    async chooseFolder(picker) {
      const handle = await picker();
      folder = handle; folderName = handle.name; await store.setKv('folder', handle);
      folderState = await permission();
      onChange();
      await snapshot('folder');
      const text = serialize();
      if (text != null) await writeFolder(text, now());
    },
    async allowFolder() {
      if (!folder) return false;
      try { await folder.requestPermission({ mode: 'readwrite' }); } catch { /* declined */ }
      folderState = await permission();
      const text = serialize();
      if (text != null && folderState === 'granted') await writeFolder(text, now());
      onChange();
      return folderState === 'granted' || folderState === 'ok';
    },
    async forgetFolder() { folder = null; folderName = ''; folderState = 'none'; await store.setKv('folder', null); onChange(); },
    get folder() { return { name: folderName, state: folderState }; },
  };
}
