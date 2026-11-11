// The manual reader: a dialog with the chapter list on the left and the chapter on the right. The chapters are the markdown
// files in docs/manual/ (the same ones that make the printed booklet, see scripts/manual.mjs); the list comes from
// docs/manual/index.json. Nothing is loaded until the reader is first opened.
import { renderMarkdown } from './markdown.js';

const BASE = 'docs/manual/';
const LAST = 'webtracker.manualChapter';

export function createManual({ dialog, openButton, doc = document, fetchText = url => fetch(url).then(r => { if (!r.ok) throw new Error(`${r.status}`); return r.text(); }) }) {
  const nav = dialog.querySelector('.mn-list'), page = dialog.querySelector('.mn-page');
  let chapters = null, current = null;

  const remember = file => { try { localStorage.setItem(LAST, file); } catch {} };
  const remembered = () => { try { return localStorage.getItem(LAST); } catch { return null; } };

  const show = async file => {
    current = file; remember(file);
    for (const b of nav.children) b.setAttribute('aria-current', String(b.dataset.file === file));
    page.textContent = 'Loading…';
    try { page.innerHTML = renderMarkdown(await fetchText(`${BASE}${file}`)); }
    catch { page.textContent = 'This chapter could not be loaded.'; }
    page.scrollTop = 0;
  };

  const load = async () => {
    if (chapters) return;
    try { chapters = JSON.parse(await fetchText(`${BASE}index.json`)); } catch { chapters = []; page.textContent = 'The manual could not be loaded.'; return; }
    nav.replaceChildren(...chapters.map(c => {
      const b = doc.createElement('button');
      b.type = 'button'; b.textContent = c.title === 'Wax' ? 'Start here' : c.title; b.dataset.file = c.file;
      b.addEventListener('click', () => show(c.file));
      return b;
    }));
  };

  const open = async () => {
    if (!dialog.open) dialog.showModal();
    await load();
    if (chapters.length) await show(chapters.some(c => c.file === current) ? current : chapters.find(c => c.file === remembered())?.file ?? chapters[0].file);
  };

  openButton?.addEventListener('click', e => { open(); e.currentTarget.blur(); });
  return { open, close: () => dialog.close(), toggle: () => (dialog.open ? dialog.close() : open()) };
}
