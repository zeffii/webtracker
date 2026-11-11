// Pop a panel out into a window of its own (a second screen, say). The window gets the page's styles and theme, and one element to
// fill; the owner draws into it (the rows are built in the window's own document) and is told when the window closes, so the panel
// can come back to the page. Returns null when the browser refuses the window (a pop-up blocker); call it from a click.
//
//   title      the window's title
//   size       { width, height } of the new window
//   onClosed   the window was closed (by its own close button, or because the page is closing)
export function openPopout({ title, size = { width: 300, height: 420 }, onClosed = () => {} }) {
  const win = window.open('', `wax-popout-${title}`, `popup,width=${size.width},height=${size.height}`);
  if (!win) return null;
  const doc = win.document;
  doc.title = title;
  for (const sheet of document.head.querySelectorAll('link[rel="stylesheet"], style')) doc.head.append(doc.importNode(sheet, true));
  doc.documentElement.className = document.documentElement.className;
  for (const [k, v] of Object.entries(document.documentElement.dataset)) doc.documentElement.dataset[k] = v;   // the colour theme
  doc.body.className = document.body.className;
  doc.body.style.cssText = 'margin: 0; padding: 0';   // (the page's body is padded for its rail and browser: the window has neither)
  const host = doc.createElement('div');
  host.className = 'fl-body fl-popout';
  doc.body.append(host);

  let closed = false;
  const finish = () => { if (closed) return; closed = true; window.removeEventListener('pagehide', closeWithPage); onClosed(); };
  const closeWithPage = () => win.close();   // the page going away takes its windows with it
  win.addEventListener('pagehide', finish);
  window.addEventListener('pagehide', closeWithPage);
  return { win, doc, host, close: () => win.close() };
}
