// Cell tokens <-> floats. The sentinels are exact in float32:
// empty -1, note cut '^^^' -0.75, note off '===' -0.5.
export const EMPTY = -1, CUT = -0.75, OFF = -0.5;
const NAMES = ['C-', 'C#', 'D-', 'D#', 'E-', 'F-', 'F#', 'G-', 'G#', 'A-', 'A#', 'B-'];

// Cell kinds: characters per cell, float channels in the lane buffer, empty token.
// cmd is CCXXYY: a 2hex command id on one channel, a 4hex value on the next.
export const KINDS = {
  '1hex': { width: 1, channels: 1, blank: '.' },
  note: { width: 3, channels: 1, blank: '...' },
  '2hex': { width: 2, channels: 1, blank: '..' },
  '4hex': { width: 4, channels: 1, blank: '....' },
  cmd: { width: 6, channels: 2, blank: '......' },
  spacer: { width: 1, channels: 1, blank: '|' },   // a meta machine's gap between groups of columns: holds nothing
};

const hexCell = (token, digits, denom) => {
  if (token === '.'.repeat(digits)) return EMPTY;
  if (!new RegExp(`^[0-9A-Fa-f]{${digits}}$`).test(token)) throw new Error(`bad ${digits}-digit hex cell "${token}"`);
  return parseInt(token, 16) / denom;
};

// Returns one float per buffer channel.
export function encodeCell(token, kind) {
  if (kind === 'note') {
    if (token === '...') return [EMPTY];
    if (token === '^^^') return [CUT];
    if (token === '===') return [OFF];
    const semitone = NAMES.indexOf(token.slice(0, 2)), octave = Number(token[2]);
    const midi = (octave + 1) * 12 + semitone;
    if (token.length !== 3 || semitone < 0 || !Number.isInteger(octave) || midi > 127) {
      throw new Error(`bad note "${token}"`);
    }
    return [midi / 127];
  }
  if (kind === '1hex') return [hexCell(token, 1, 15)];
  if (kind === '2hex') return [hexCell(token, 2, 255)];
  if (kind === '4hex') return [hexCell(token, 4, 65535)];
  if (kind === 'spacer') return [EMPTY];
  if (kind === 'cmd') {
    if (token === KINDS.cmd.blank) return [EMPTY, EMPTY];
    return [hexCell(token.slice(0, 2), 2, 255), hexCell(token.slice(2), 4, 65535)];
  }
  throw new Error(`unknown cell kind "${kind}"`);
}

// The semitone count above C-0 of a note token such as "C#4", or null for anything else (a blank, note off, note cut).
export function noteSemitones(token) {
  const i = NAMES.indexOf(token?.slice(0, 2)), octave = Number(token?.[2]);
  return i < 0 || token.length !== 3 || !Number.isInteger(octave) ? null : octave * 12 + i;
}

// A note token from an absolute semitone count above C-0. Throws if out of range.
export function noteToken(semitones) {
  const token = `${NAMES[semitones % 12]}${Math.floor(semitones / 12)}`;
  encodeCell(token, 'note');
  return token;
}

export const decodeNote = v => Math.round(v * 127);
export const decodeHex1 = v => Math.round(v * 15);
export const decodeHex2 = v => Math.round(v * 255);
export const decodeHex4 = v => Math.round(v * 65535);

// A relative note cell (a 2hex value, 80 the root note) as the float a note cell holds: 00 is a note off, 81 a semitone above the root.
export const relativeNote = (v, root) => {
  const h = decodeHex2(v);
  return h === 0 ? OFF : Math.max(0, Math.min(127, root + h - 0x80)) / 127;
};
