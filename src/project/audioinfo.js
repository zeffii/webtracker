// What an audio file says about itself, read from its first bytes without decoding it: the format, the sample rate it was recorded
// at, the number of channels and, where the header has it, the bit depth. The browser's decoder resamples to the rate of the audio
// engine, so this is the only way to show the file's own rate. Covers WAV, AIFF, FLAC, Ogg (Vorbis and Opus) and MP3.
// audioInfo(bytes) takes a Uint8Array and gives { format, rate, channels, bits? } or null when it does not know the file.
const u16le = (b, i) => b[i] | b[i + 1] << 8;
const u32le = (b, i) => (b[i] | b[i + 1] << 8 | b[i + 2] << 16 | b[i + 3] << 24) >>> 0;
const u16be = (b, i) => b[i] << 8 | b[i + 1];
const u32be = (b, i) => (b[i] << 24 | b[i + 1] << 16 | b[i + 2] << 8 | b[i + 3]) >>> 0;
const tag = (b, i, text) => text.split('').every((c, k) => b[i + k] === c.charCodeAt(0));

// RIFF chunks one after the other: 4 letters, a 4 byte length, the data (padded to an even length).
function wav(b) {
  for (let i = 12; i + 8 <= b.length;) {
    const size = u32le(b, i + 4);
    if (tag(b, i, 'fmt ') && i + 24 <= b.length) return { format: 'wav', channels: u16le(b, i + 10), rate: u32le(b, i + 12), bits: u16le(b, i + 22) };
    i += 8 + size + (size & 1);
  }
  return null;
}

// FORM chunks, the same way but big-endian. The rate is an 80 bit extended float: 15 bits of exponent, then 64 bits of mantissa.
function aiff(b) {
  for (let i = 12; i + 8 <= b.length;) {
    const size = u32be(b, i + 4);
    if (tag(b, i, 'COMM') && i + 18 <= b.length) {
      const exp = (u16be(b, i + 16) & 0x7fff) - 16383, mant = u32be(b, i + 18) * 4294967296 + u32be(b, i + 22);
      return { format: 'aiff', channels: u16be(b, i + 8), bits: u16be(b, i + 14), rate: Math.round(mant * 2 ** (exp - 63)) };
    }
    i += 8 + size + (size & 1);
  }
  return null;
}

// "fLaC", then the STREAMINFO block: 20 bits of sample rate, 3 of channels (minus one), 5 of bit depth (minus one).
function flac(b) {
  if (b.length < 26) return null;
  return { format: 'flac', rate: b[18] << 12 | b[19] << 4 | b[20] >> 4, channels: (b[20] >> 1 & 7) + 1, bits: ((b[20] & 1) << 4 | b[21] >> 4) + 1 };
}

// The first Ogg page holds the codec's identification packet.
function ogg(b) {
  const segments = b[26], at = 27 + segments;
  if (tag(b, at, '\x01vorbis')) return { format: 'ogg', channels: b[at + 11], rate: u32le(b, at + 12) };
  if (tag(b, at, 'OpusHead')) return { format: 'opus', channels: b[at + 9], rate: 48000 };   // Opus always plays at 48 kHz, whatever it was recorded at
  return null;
}

// An optional ID3 tag (skipped), then the first frame header: 11 bits of sync, the MPEG version and layer, the rate and the channel mode.
const MPEG_RATES = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };
function mp3(b) {
  let i = 0;
  if (tag(b, 0, 'ID3')) i = 10 + ((b[6] & 127) << 21 | (b[7] & 127) << 14 | (b[8] & 127) << 7 | (b[9] & 127));
  for (const end = Math.min(b.length - 4, i + 8192); i < end; i++) {
    if (b[i] !== 0xff || (b[i + 1] & 0xe0) !== 0xe0) continue;
    const version = b[i + 1] >> 3 & 3, layer = b[i + 1] >> 1 & 3, index = b[i + 2] >> 2 & 3;
    if (version === 1 || layer === 0 || index === 3 || (b[i + 2] >> 4) === 15) continue;   // reserved values: not a frame
    return { format: 'mp3', rate: MPEG_RATES[version][index], channels: (b[i + 3] >> 6) === 3 ? 1 : 2 };
  }
  return null;
}

export function audioInfo(bytes) {
  const b = bytes;
  if (!b || b.length < 12) return null;
  if (tag(b, 0, 'RIFF') && tag(b, 8, 'WAVE')) return wav(b);
  if (tag(b, 0, 'FORM') && (tag(b, 8, 'AIFF') || tag(b, 8, 'AIFC'))) return aiff(b);
  if (tag(b, 0, 'fLaC')) return flac(b);
  if (tag(b, 0, 'OggS')) return ogg(b);
  return mp3(b);
}

// "44.1 kHz", "48 kHz", "22.05 kHz"
export const rateText = rate => `${Number((rate / 1000).toFixed(3))} kHz`;
