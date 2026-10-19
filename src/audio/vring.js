// A ring of the last output samples (left, right), shared between the audio thread, which writes it, and the page, which
// draws it. Nothing is written while the page has it switched off, so it costs nothing then.
export const RING = 4096;   // frames; a power of two
export const ringBuffer = () => new SharedArrayBuffer(8 + RING * 8);

export function ringWriter(sab) {
  const head = new Int32Array(sab, 0, 2), data = new Float32Array(sab, 8);
  return {
    get on() { return Atomics.load(head, 1) !== 0; },
    write(l, r, n) {
      let w = Atomics.load(head, 0);
      for (let i = 0; i < n; i++, w = (w + 1) | 0) { const at = (w & (RING - 1)) * 2; data[at] = l[i]; data[at + 1] = r[i]; }
      Atomics.store(head, 0, w);
    },
  };
}

// Each reader has its own bit (0 to 30) in the on-switch, so the vectorscope and the meters can come and go independently.
export function ringReader(sab, bit = 0) {
  const head = new Int32Array(sab, 0, 2), data = new Float32Array(sab, 8);
  let at = Atomics.load(head, 0);
  return {
    enable(on) { if (on) Atomics.or(head, 1, 1 << bit); else Atomics.and(head, 1, ~(1 << bit)); at = Atomics.load(head, 0); },
    // The frames written since the last read (at most RING, the newest), as interleaved left, right in `out`; returns how many frames.
    read(out) {
      const w = Atomics.load(head, 0);
      let n = (w - at) | 0;
      if (n > RING) { at = (w - RING) | 0; n = RING; }
      for (let i = 0; i < n; i++, at = (at + 1) | 0) { const k = (at & (RING - 1)) * 2; out[i * 2] = data[k]; out[i * 2 + 1] = data[k + 1]; }
      return n;
    },
  };
}
