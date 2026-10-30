// The undo trail shown in a row above the status bar: the last few things done, the newest a bright chevron, older ones fading to the right.
// The pattern editor and the arrangement share one editor (one undo stack), so both draw the same row.
import { esc } from './html.js';

export function undoTrailHtml(editor) {
  const log = editor.log().slice(0, 5).map(l => `<b>${esc(l)}</b>`).join('');
  return `<span class="ud-lbl">undo</span><span class="ud-trail${log ? '' : ' none'}">${log || '<b>nothing yet</b>'}</span>${editor.hasWaypoint() ? '<span class="ud-wp">waypoint set</span>' : ''}`;
}
