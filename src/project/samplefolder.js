// Where the sample browser's files come from. Everything the browser shows is an entry:
//   { kind: 'dir',  name, list() }           list() gives the entries inside it (folders first, then audio files, each sorted by name)
//   { kind: 'file', name, file() }           file() gives the File (its size is known; nothing has been read from the disk yet)
// Two sources make entries: a folder the person picked once (a FileSystemDirectoryHandle, kept in IndexedDB so it survives a restart,
// Chromium only) and a plain list of files from an <input> (every other browser, for as long as the page is open).
export const AUDIO_NAME = /\.(wav|wave|aif|aiff|aifc|flac|mp3|ogg|oga|opus)$/i;
export const isAudioName = name => AUDIO_NAME.test(name);
export const MB = 1024 * 1024;
// A file over the limit is not read until the person says so.
export const needsAsk = (bytes, limitMB) => bytes > limitMB * MB;

export const sizeText = bytes => (bytes < 1024 ? `${bytes} B` : bytes < MB ? `${(bytes / 1024).toFixed(bytes < 10240 ? 1 : 0)} KB` : `${(bytes / MB).toFixed(bytes < 10 * MB ? 2 : 1)} MB`);

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });   // "kick 2" before "kick 10", case ignored
const byName = (a, b) => collator.compare(a.name, b.name);
const sorted = (folders, files) => [...folders.sort(byName), ...files.sort(byName)];

export function fileEntry(name, getFile) {
  let pending = null;
  return { kind: 'file', name, file: () => (pending ??= Promise.resolve(getFile())) };
}

export function dirEntryFromHandle(handle) {
  return {
    kind: 'dir', name: handle.name,
    async list() {
      const folders = [], files = [];
      for await (const [name, child] of handle.entries()) {
        if (name.startsWith('.')) continue;   // hidden files and folders
        if (child.kind === 'directory') folders.push(dirEntryFromHandle(child));
        else if (isAudioName(name)) files.push(fileEntry(name, () => child.getFile()));
      }
      return sorted(folders, files);
    },
  };
}

// A flat list of Files (from an <input multiple>): one folder that holds them all.
export function dirEntryFromFiles(files, name = 'Chosen files') {
  const list = [...files].filter(f => isAudioName(f.name)).map(f => fileEntry(f.name, () => f));
  return { kind: 'dir', name, list: async () => sorted([], list) };
}

// The picked folder is kept in IndexedDB. `open` is indexedDB.open, passed in so a test can use its own.
const DB = 'webtracker-samplefolder', STORE = 'handles', KEY = 'root';
const request = r => new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
export function createHandleStore({ factory = globalThis.indexedDB } = {}) {
  const db = () => new Promise((resolve, reject) => {
    const open = factory.open(DB, 1);
    open.onupgradeneeded = () => open.result.createObjectStore(STORE);
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error);
  });
  const run = async (mode, make) => { const d = await db(); try { return await request(make(d.transaction(STORE, mode).objectStore(STORE))); } finally { d.close(); } };
  return {
    save: handle => run('readwrite', s => s.put(handle, KEY)),
    load: async () => { try { return (await run('readonly', s => s.get(KEY))) ?? null; } catch { return null; } },
    clear: () => run('readwrite', s => s.delete(KEY)),
  };
}
