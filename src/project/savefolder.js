// Where files are saved. Two things keep the browser from dropping everything in whichever folder you used last:
//  - every kind of file (project, bounce, sample, instrument) has its own picker id, so the browser remembers a folder per kind;
//  - an optional default folder (File, Save folder...) that every save dialog opens in. Its handle is kept in IndexedDB.
// Chromium browsers only (showSaveFilePicker); elsewhere a save is a plain download.
import { createHandleStore } from './samplefolder.js';

export const SAVE_KINDS = {
  project: { id: 'wax-project', description: 'Wax project', accept: { 'application/json': ['.wax'] } },
  instrument: { id: 'wax-instrument', description: 'Wax instrument', accept: { 'application/json': ['.waxi'] } },
  wav: { id: 'wax-audio', description: 'WAV audio', accept: { 'audio/wav': ['.wav'] } },
  other: { id: 'wax-other' },
};

export function createSaveFolder({ store = createHandleStore({ key: 'save' }), savePicker = globalThis.showSaveFilePicker, dirPicker = globalThis.showDirectoryPicker } = {}) {
  let folder = null;
  const ready = store.load().then(h => { folder = h; }).catch(() => {});
  const usable = async () => {   // the folder, if the browser still lets us use it
    await ready;
    if (!folder) return null;
    try { if ((await folder.queryPermission({ mode: 'readwrite' })) === 'denied') return null; } catch { return null; }
    return folder;
  };
  return {
    canPick: typeof dirPicker === 'function',
    name: async () => { await ready; return folder?.name ?? null; },
    pick: async () => { folder = await dirPicker({ id: 'wax-save-folder', mode: 'readwrite' }); await store.save(folder); return folder.name; },
    forget: async () => { await ready; folder = null; await store.clear(); },
    // Opens the save dialog and writes `data` (text or bytes; or a function of the chosen file name that returns them). Returns the file name, or null when there is no dialog (the caller downloads instead).
    // Throws AbortError when the dialog is closed.
    save: async (name, data, kind = 'other') => {
      if (typeof savePicker !== 'function') return null;
      const k = SAVE_KINDS[kind] ?? SAVE_KINDS.other;
      const opts = { suggestedName: name, id: k.id };
      if (k.accept) opts.types = [{ description: k.description, accept: k.accept }];
      const start = await usable();
      if (start) opts.startIn = start;
      const handle = await savePicker.call(globalThis, opts);
      const w = await handle.createWritable();
      await w.write(typeof data === 'function' ? data(handle.name) : data);
      await w.close();
      return handle.name;
    },
  };
}
