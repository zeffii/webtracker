// The pattern window: one pattern of one instrument, read-only, in a window of its own (a second screen, say). The rows are drawn
// with the same markup as the main grid, so the page's #view styles (copied into the window) colour them the same way.
//
// patternMenu(lanes) the tree for the Instruments -> Patterns menu: every lane that has patterns, with its patterns in order.
//   leaf value = { li, puid }
// patternLines(lane, puid, playRow) the window's lines as HTML: a title, the column header, then one line per row of the pattern.
//   Columns that hold nothing in this pattern are left out (the first note column always stays). playRow marks the playing row.
import { KINDS } from './cells.js';
import { esc } from './html.js';

const GUTTER = 6;

export function patternMenu(lanes) {
  const tree = [];
  lanes.forEach((lane, li) => {
    const pats = Object.entries(lane.patterns ?? {}).sort((a, b) => (a[1].index ?? 0) - (b[1].index ?? 0));
    if (!pats.length) return;
    tree.push({
      name: lane.id,
      children: pats.map(([puid, pt]) => ({
        name: `${pt.name ?? `pat${String(pt.index ?? 0).padStart(2, '0')}`} · ${pt.rows.length} rows`,
        value: { li, puid },
      })),
    });
  });
  return tree;
}

export function visiblePatternColumns(lane, pat) {
  const keep = [];
  let firstNote = true;
  lane.columns.forEach((c, ci) => {
    const blank = KINDS[c.token]?.blank;
    const used = c.kind !== 'spacer' && pat.rows.some(r => r[ci] !== undefined && r[ci] !== blank && !/^[.\s]*$/.test(String(r[ci])));
    if (used || (c.kind === 'note' && firstNote)) keep.push(ci);
    if (c.kind === 'note') firstNote = false;
  });
  return keep;
}

export function patternLines(lane, puid, playRow = -1) {
  const pat = lane?.patterns?.[puid];
  if (!pat) return [esc('This pattern is gone.')];
  const cols = visiblePatternColumns(lane, pat);
  const width = ci => Math.max((lane.columns[ci].short ?? lane.columns[ci].label ?? '').length, KINDS[lane.columns[ci].token]?.width ?? 1);
  const gutter = `<span class="g">${' '.repeat(GUTTER)}</span>`;
  const lines = [
    `${gutter} ${esc(lane.id)} · ${esc(pat.name ?? '')} · ${pat.rows.length} rows`,
    `${gutter} ${cols.map(ci => esc((lane.columns[ci].short ?? lane.columns[ci].label ?? '').padEnd(width(ci)))).join(' ')}`,
  ];
  pat.rows.forEach((row, t) => {
    const cells = cols.map(ci => {
      const c = lane.columns[ci];
      const text = String(row[ci] ?? KINDS[c.token]?.blank ?? '').padEnd(width(ci));
      return Array.from(text, (ch, i) => {
        const cls = [c.token === 'cmd' && i < 2 ? 'cc' : '', c.rel && text.trimEnd() === '00' ? 'noff' : ''].filter(Boolean).join(' ');
        return cls ? `<span class="${cls}">${esc(ch)}</span>` : esc(ch);
      }).join('').replace(/\.+/g, dots => `<span class="d">${dots}</span>`);
    }).join(' ');
    const here = t === playRow;
    const head = `<span class="g">${here ? '>' : ' '}${String(t).padStart(4, '0')} </span> ${cells}`;
    const line = here ? `<b><span class="now">${head}</span></b>` : head;
    const shade = t % 16 === 0 ? 'r16' : t % 4 === 0 ? 'r4' : '';
    lines.push(shade ? `<span class="${shade}">${line}</span>` : line);
  });
  return lines;
}

// Which row of the pattern the transport is on, or -1 (not playing, or the playing tick is under another pattern).
export function playingRow(lane, puid, tick) {
  if (tick < 0) return -1;
  const pl = lane.placements.find(p => p.puid === puid && tick >= p.start && tick < p.start + p.length);
  return pl ? tick - pl.start : -1;
}
