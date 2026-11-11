// Builds the manual from docs/manual/*.md:
//   docs/manual/index.json    the chapter list the in-app reader loads (file, title)
//   docs/manual/booklet.html  every chapter in one page, set for print: A5, a contents page, page numbers.
//                             Print it from the browser (Save as PDF, or on paper two-up and folded into a booklet).
// Run it after editing a chapter: node scripts/manual.mjs   (npm test checks that index.json is up to date).
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { renderMarkdown } from '../src/ui/markdown.js';

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'manual');

export function readChapters() {
  return readdirSync(dir).filter(f => /^\d\d-.*\.md$/.test(f)).sort().map(file => {
    const text = readFileSync(join(dir, file), 'utf8');
    const title = /^#\s+(.*)$/m.exec(text)?.[1].trim() ?? file;
    return { file, title, text };
  });
}

const BOOKLET_STYLE = `
@page { size: A5; margin: 16mm 14mm 18mm; @bottom-center { content: counter(page); font: 9pt Georgia, serif; } }
@page :first { @bottom-center { content: none; } }
html { font: 10.5pt/1.45 Georgia, 'Times New Roman', serif; color: #111; }
body { margin: 0; }
h1 { font: 700 20pt/1.1 Georgia, serif; margin: 0 0 .5em; break-before: page; }
h2 { font: 700 12.5pt/1.2 Georgia, serif; margin: 1.2em 0 .3em; break-after: avoid; }
h3 { font: italic 700 11pt/1.2 Georgia, serif; margin: 1em 0 .2em; break-after: avoid; }
p, li { orphans: 3; widows: 3; } p { margin: .5em 0; } ul, ol { margin: .4em 0; padding-left: 1.3em; }
code { font: 9pt ui-monospace, Consolas, monospace; }
table { border-collapse: collapse; width: 100%; margin: .6em 0; font-size: 9.5pt; break-inside: avoid; }
th, td { text-align: left; vertical-align: top; padding: 2pt 5pt 2pt 0; border-bottom: .4pt solid #888; } th { border-bottom: .8pt solid #111; }
.cover h1 { break-before: auto; font-size: 44pt; margin-top: 38mm; } .cover { min-height: 150mm; }
.toc h1 { break-before: page; } .toc ol { list-style: none; padding: 0; font-size: 12pt; } .toc li { margin: .35em 0; }
`;

export function bookletHtml(chapters) {
  const [front, ...rest] = chapters;
  const [cover, ...intro] = front.text.split('\n\nThis is the manual');   // the title and the one-line subtitle stand alone on the cover
  const how = `This is the manual${intro.join('\n\nThis is the manual')}`.split('\n## What is in it')[0];
  const toc = rest.map(c => `<li>${c.title}</li>`).join('');
  const body = rest.map(c => renderMarkdown(c.text)).join('\n');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Wax: the manual</title><style>${BOOKLET_STYLE}</style></head>
<body>
<section class="cover">${renderMarkdown(cover)}</section>
<section class="toc"><h1>Contents</h1><ol>${toc}</ol>${renderMarkdown(how)}</section>
${body}
</body></html>
`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const chapters = readChapters();
  writeFileSync(join(dir, 'index.json'), `${JSON.stringify(chapters.map(({ file, title }) => ({ file, title })), null, 2)}\n`);
  writeFileSync(join(dir, 'booklet.html'), bookletHtml(chapters));
  console.log(`manual: ${chapters.length} chapters, index.json and booklet.html written`);
}
