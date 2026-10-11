// Cell tokens <-> floats. The sentinels are exact in float32:
// empty -1, note cut '^^^' -0.75, note off '===' -0.5.
export const EMPTY = -1, CUT = -0.75, OFF = -0.5;
const NAMES = ['C-', 'C#', 'D-', 'D#', 'E-', 'F-', 'F#', 'G-', 'G#', 'A-', 'A#', 'B-'];

export function encodeCell(token, kind) {
  if (kind === 'note') {
    if (token === '...') return EMPTY;
    if (token === '^^^') return CUT;
    if (token === '===') return OFF;
    const semitone = NAMES.indexOf(token.slice(0, 2)), octave = Number(token[2]);
    const midi = (octave + 1) * 12 + semitone;
    if (token.length !== 3 || semitone < 0 || !Number.isInteger(octave) || midi > 127) {
      throw new Error(`bad note "${token}"`);
    }
    return midi / 127;
  }
  if (kind === '2hex') {
    if (token === '..') return EMPTY;
    if (!/^[0-9A-Fa-f]{2}$/.test(token)) throw new Error(`bad 2hex cell "${token}"`);
    return parseInt(token, 16) / 255;
  }
  throw new Error(`unknown cell kind "${kind}"`);
}

export const decodeNote = v => Math.round(v * 127);
export const decodeHex2 = v => Math.round(v * 255);
