// A sample (or a part of it) as the bytes of a .wav file: mono or stereo as the sample is, at the sample's own rate,
// 24 bit by default. The slice markers go in as cue points, so a tool that reads them can find them again.
// from and to are frames (to is not included); leaving them out saves the whole sample.
export function sampleToWav(sample, { from = 0, to = sample.data.length, bits = 24 } = {}) {
  const a = Math.max(0, Math.min(from, sample.data.length)), z = Math.max(a, Math.min(to, sample.data.length));
  const n = z - a, channels = sample.right ? 2 : 1, bytes = bits / 8, size = n * channels * bytes;
  const cues = (sample.slices ?? []).filter(f => f >= a && f < z).sort((x, y) => x - y);
  const cueSize = cues.length ? 12 + cues.length * 24 : 0;
  const buf = new ArrayBuffer(44 + size + cueSize), v = new DataView(buf);
  const str = (at, s) => { for (let i = 0; i < s.length; i++) v.setUint8(at + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + size + cueSize, true); str(8, 'WAVE'); str(12, 'fmt '); v.setUint32(16, 16, true);
  v.setUint16(20, bits === 32 ? 3 : 1, true); v.setUint16(22, channels, true); v.setUint32(24, sample.rate, true);
  v.setUint32(28, sample.rate * channels * bytes, true); v.setUint16(32, channels * bytes, true); v.setUint16(34, bits, true);
  str(36, 'data'); v.setUint32(40, size, true);
  let at = 44;
  const put = x => {
    const c = Math.max(-1, Math.min(1, x));
    if (bits === 32) v.setFloat32(at, c, true);
    else if (bits === 16) v.setInt16(at, Math.round(c * 32767), true);
    else { const q = Math.round(c * 8388607); v.setUint8(at, q & 255); v.setUint8(at + 1, (q >> 8) & 255); v.setUint8(at + 2, (q >> 16) & 255); }
    at += bytes;
  };
  for (let i = a; i < z; i++) { put(sample.data[i]); if (sample.right) put(sample.right[i]); }
  if (cues.length) {   // a 'cue ' chunk: one point for each marker
    str(at, 'cue '); v.setUint32(at + 4, 4 + cues.length * 24, true); v.setUint32(at + 8, cues.length, true); at += 12;
    cues.forEach((f, i) => { v.setUint32(at, i + 1, true); v.setUint32(at + 4, f - a, true); str(at + 8, 'data'); v.setUint32(at + 12, 0, true); v.setUint32(at + 16, 0, true); v.setUint32(at + 20, f - a, true); at += 24; });
  }
  return buf;
}
