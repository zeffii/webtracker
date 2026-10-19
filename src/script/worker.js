// The Worker a script runs in: it gets a request, runs it, and answers. If it never answers (an endless loop), the
// page ends it (client.js), so nothing a script does can freeze the tracker or touch the song.
import { execute } from './lib.js';

self.onmessage = e => {
  const { id, ...req } = e.data;
  let res;
  try { res = execute(req); } catch (err) { res = { ok: false, error: { message: String(err?.message ?? err) }, logs: [] }; }
  self.postMessage({ id, ...res });
};
