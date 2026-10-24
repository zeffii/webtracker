// The small piece of YAML the track list needs: `key: value` lines, and a list of mappings under a key
//   title: Wax
//   tracks:
//     - title: Interstellar
//       wax: songs/interstellar.wax
//       art: art/interstellar.png
// Values are plain or in "quotes"; a line that starts with # is a comment; nothing else (no nesting beyond that) is understood.
const scalar = s => {
  s = s.trim();
  if ((s.startsWith('"') && s.endsWith('"') && s.length > 1) || (s.startsWith("'") && s.endsWith("'") && s.length > 1)) return s.slice(1, -1);
  if (/^(true|yes)$/i.test(s)) return true;
  if (/^(false|no)$/i.test(s)) return false;
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  return s.replace(/\s+#.*$/, '');
};

export function parseTrackList(text) {
  const out = {};
  let list = null, item = null;
  for (const raw of text.replace(/\r/g, '').split('\n')) {
    if (!raw.trim() || raw.trim().startsWith('#')) continue;
    const indent = raw.length - raw.trimStart().length, line = raw.trim();
    if (line.startsWith('- ')) {
      if (!list) throw new Error(`a list item with no list above it: "${line}"`);
      item = {}; list.push(item);
      const rest = line.slice(2).trim();
      if (rest) { const m = rest.match(/^([\w-]+)\s*:\s*(.*)$/); if (!m) throw new Error(`cannot read "${line}"`); item[m[1]] = scalar(m[2]); }
      continue;
    }
    const m = line.match(/^([\w-]+)\s*:\s*(.*)$/);
    if (!m) throw new Error(`cannot read "${line}"`);
    if (indent === 0) { item = null; if (m[2] === '') { list = out[m[1]] = []; } else { list = null; out[m[1]] = scalar(m[2]); } }
    else if (item) item[m[1]] = scalar(m[2]);
    else throw new Error(`"${line}" is indented but belongs to no list item`);
  }
  return out;
}
