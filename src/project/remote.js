// Opening a project from a link. Three things are accepted, in the box under File and in the address (?gist=ID or ?src=URL):
//   - a gist id (hex digits) or a gist address (gist.github.com/name/ID): the first .wax file in the gist (or the one named with &file=),
//   - a link to a file that allows other sites to read it (raw.githubusercontent.com, gist.githubusercontent.com, ...),
// Public gists need no sign-in. Nothing here writes anything.
const GIST_ID = /^[0-9a-f]{20,40}$/i;
const MAX_BYTES = 64 * 1024 * 1024;   // a project with a lot of samples is big, but not this big

// What the person typed (or the address holds) as { gist, file } or { url }. Throws a short message when it is none of the above.
export function parseSource(input, file = '') {
  const text = String(input ?? '').trim();
  if (GIST_ID.test(text)) return { gist: text.toLowerCase(), file };
  let url;
  try { url = new URL(text); } catch { throw new Error('That is not a gist id or a link.'); }
  if (url.protocol !== 'https:') throw new Error('Only https links can be opened.');
  if (url.hostname === 'gist.github.com') {
    const id = url.pathname.split('/').filter(Boolean).find(part => GIST_ID.test(part));
    if (!id) throw new Error('No gist id in that address.');
    return { gist: id.toLowerCase(), file };
  }
  return { url: url.href };
}

async function fetchText(url) {
  const reply = await fetch(url);
  if (!reply.ok) throw new Error(`${new URL(url).hostname}: ${reply.status}${reply.status === 404 ? ' (not found, or not public)' : ''}`);
  const size = Number(reply.headers.get('content-length') ?? 0);
  if (size > MAX_BYTES) throw new Error('That file is too big to open from a link.');
  return reply.text();
}

// The text of the project the source points at.
export async function fetchProjectText(source) {
  if (source.url) return fetchText(source.url);
  const reply = await fetch(`https://api.github.com/gists/${source.gist}`);
  if (!reply.ok) throw new Error(`Gist ${source.gist}: ${reply.status}${reply.status === 404 ? ' (not found, or not public)' : reply.status === 403 ? ' (GitHub is limiting requests for now, try again later)' : ''}`);
  const files = Object.values((await reply.json()).files ?? {});
  const wanted = source.file && files.find(f => f.filename === source.file);
  const pick = wanted || files.find(f => /\.wax$/i.test(f.filename)) || files.find(f => /\.json$/i.test(f.filename)) || files[0];
  if (!pick) throw new Error('That gist has no files.');
  return pick.truncated || pick.content === undefined ? fetchText(pick.raw_url) : pick.content;
}
