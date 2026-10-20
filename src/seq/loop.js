// The song's loop: song.loop = { start, end }, in ticks, `end` not included. Without it the whole song loops.
// Playing starts at the loop's start and returns to it when the end is reached.

// The loop as a range inside the song (always valid: at least one tick, within the length).
export function loopRange(song) {
  const start = Math.min(song.length - 1, Math.max(0, Math.floor(song.loop?.start ?? 0)));
  const end = Math.min(song.length, Math.max(start + 1, Math.floor(song.loop?.end ?? song.length)));
  return { start, end };
}

export const inLoop = (song, t) => { const { start, end } = loopRange(song); return !!song.loop && t >= start && t < end; };

// Sets the loop's start or end to a tick (for the end: the first tick after the loop). Setting a point where it already
// is takes it away again. A start past the end moves the end to the song's end; an end before the start moves the start
// to the song's start. Returns a message for the status line.
export function setLoopPoint(song, which, tick) {
  const { start, end } = loopRange(song);
  let s = start, e = end, message;
  if (which === 'start') {
    tick = Math.min(song.length - 1, Math.max(0, Math.round(tick)));
    if (song.loop && tick === start) { s = 0; message = 'Loop start cleared.'; }
    else { s = tick; if (s >= e) e = song.length; message = `Loop starts at ${s}.`; }
  } else {
    tick = Math.min(song.length, Math.max(1, Math.round(tick)));
    if (song.loop && tick === end) { e = song.length; message = 'Loop end cleared.'; }
    else { e = tick; if (e <= s) s = 0; message = `Loop ends at ${e}.`; }
  }
  if (s === 0 && e === song.length) { delete song.loop; return message; }
  song.loop = { start: s, end: e };   // setting a point switches the loop on again
  return message;
}

// Ctrl+L: the loop switched off and on again with its points kept (song.loop.off). Without a loop there is nothing to switch.
export function toggleLoop(song) {
  if (!song.loop) return 'No loop yet: Ctrl+B and Ctrl+E set its start and end.';
  if (song.loop.off) delete song.loop.off; else song.loop = { ...song.loop, off: true };
  return song.loop.off ? 'Loop off (its points are kept).' : 'Loop on.';
}
export const loopActive = song => !!song.loop && !song.loop.off;

// After the song's length changes: keep the loop inside it, or drop it.
export function clampLoop(song) {
  if (!song.loop) return;
  const { start, end } = loopRange(song);
  if (song.loop.start >= song.length) delete song.loop;
  else if (start === 0 && end === song.length) delete song.loop;
  else song.loop = { ...song.loop, start, end };
}
