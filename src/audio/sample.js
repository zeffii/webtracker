// Built-in test sample: a decaying harmonic pluck at middle C (note 60).
export function makePluck(sampleRate, seconds = 1.2, freq = 261.6256) {
  const n = Math.floor(sampleRate * seconds);
  const data = new Float32Array(n);
  let peak = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate;
    let s = 0;
    for (let h = 1; h <= 12; h++) {
      s += Math.sin(2 * Math.PI * freq * h * t) / h * Math.exp(-t * (2 + h * 1.5));
    }
    data[i] = s;
    peak = Math.max(peak, Math.abs(s));
  }
  for (let i = 0; i < n; i++) data[i] *= 0.9 / peak;
  return data;
}
