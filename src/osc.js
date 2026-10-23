// Open Sound Control 1.0 messages: an address string, a type-tag string and the arguments, every part padded with zeros to a
// multiple of four bytes. Only what Wax sends is here: int32 ('i'), float32 ('f') and string ('s').
const pad = n => (n + 4) & ~3;   // a string's bytes plus at least one 0, rounded up to four
const text = s => { const b = new TextEncoder().encode(s); const out = new Uint8Array(pad(b.length)); out.set(b); return out; };

// args: numbers (a whole number is an int32, anything else a float32) or strings, or { i }, { f }, { s } to be explicit.
export function encodeMessage(address, args = []) {
  const typed = args.map(a => (typeof a === 'string' ? { s: a } : typeof a === 'number' ? (Number.isInteger(a) ? { i: a } : { f: a }) : a));
  const parts = [text(address), text(`,${typed.map(a => ('i' in a ? 'i' : 'f' in a ? 'f' : 's')).join('')}`)];
  for (const a of typed) {
    if ('s' in a) { parts.push(text(String(a.s))); continue; }
    const b = new Uint8Array(4), dv = new DataView(b.buffer);
    if ('i' in a) dv.setInt32(0, a.i | 0); else dv.setFloat32(0, a.f);
    parts.push(b);
  }
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

// Reads a message back (for the tests and the relay's log).
export function decodeMessage(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const str = at => { let e = at; while (bytes[e] !== 0) e++; return [new TextDecoder().decode(bytes.subarray(at, e)), pad(e - at) + at]; };
  let [address, at] = str(0);
  let tags;
  [tags, at] = str(at);
  const args = [];
  for (const t of tags.slice(1)) {
    if (t === 'i') { args.push(dv.getInt32(at)); at += 4; } else if (t === 'f') { args.push(dv.getFloat32(at)); at += 4; } else if (t === 's') { let s; [s, at] = str(at); args.push(s); }
  }
  return { address, args };
}

// What Wax sends for a note from an OSC out node: Renoise's own server understands the first form, Wax's the second.
//   p: [mode, instrument, track, transpose] as the node's parameters were when the note came
export function noteMessage({ on, note, vel }, p, name) {
  const [mode, instrument, track, transpose] = p;
  const n = note + transpose;
  if (mode === 0) {
    const renoise = Math.max(0, Math.min(119, n - 12));   // Renoise counts C-0 as 0; MIDI's C-4 is 60 and Renoise's is 48
    return on ? ['/renoise/trigger/note_on', [instrument, track, renoise, Math.max(1, Math.round(vel * 127))]] : ['/renoise/trigger/note_off', [instrument, track, renoise]];
  }
  const id = String(name).replace(/[^\w-]/g, '_');
  return on ? [`/wax/${id}/note_on`, [Math.max(0, Math.min(127, n)), Math.round(vel * 127)]] : [`/wax/${id}/note_off`, [Math.max(0, Math.min(127, n))]];
}
