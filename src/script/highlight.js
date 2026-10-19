// Syntax colouring for the script editor: comments, strings, numbers, keywords and the script helpers. A string that is a
// bit pattern ("x..x ..x.") has its hits and rests coloured, so the rhythm can be read in the code. Returns HTML.
const KEYWORDS = new Set('const let var function return if else for while do of in new true false null undefined break continue switch case default throw try catch finally typeof this class'.split(' '));
const HELPERS = new Set('pat sel cursor tbin voices euclid bitsOf rot inv rev both either xor ramp sine scale note midi step seed rnd pick shuffle chance log console'.split(' '));
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const TOKEN = /(\/\/[^\n]*|\/\*[\s\S]*?(?:\*\/|$))|("(?:[^"\\\n]|\\.)*"?|'(?:[^'\\\n]|\\.)*'?|`(?:[^`\\]|\\[\s\S])*`?)|(\b0[xX][0-9a-fA-F]+\b|\b\d+(?:\.\d+)?\b)|([A-Za-z_$][\w$]*)/g;

const bitString = inner => /^[x.01?|\s-]+$/i.test(inner) && /[xX1]/.test(inner) && /[.0]/.test(inner);

export function highlight(src) {
  let out = '', last = 0;
  for (const m of src.matchAll(TOKEN)) {
    out += esc(src.slice(last, m.index));
    last = m.index + m[0].length;
    if (m[1] !== undefined) out += `<span class="tk-c">${esc(m[0])}</span>`;
    else if (m[2] !== undefined) {
      const q = m[0][0], inner = m[0].slice(1, m[0].endsWith(q) && m[0].length > 1 ? -1 : undefined);
      if (q !== '`' && bitString(inner)) {
        const body = [...inner].map(c => (/[xX1?]/.test(c) ? `<span class="tk-h">${c}</span>` : /[.0]/.test(c) ? `<span class="tk-r">${c}</span>` : esc(c))).join('');
        out += `<span class="tk-s">${q}${body}${m[0].endsWith(q) && m[0].length > 1 ? q : ''}</span>`;
      } else out += `<span class="tk-s">${esc(m[0])}</span>`;
    } else if (m[3] !== undefined) out += `<span class="tk-n">${m[0]}</span>`;
    else if (KEYWORDS.has(m[0])) out += `<span class="tk-k">${m[0]}</span>`;
    else if (HELPERS.has(m[0])) out += `<span class="tk-b">${m[0]}</span>`;
    else out += esc(m[0]);
  }
  return out + esc(src.slice(last));
}
