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

// Per-instrument rings (mono, the mean of left and right) for the layered spectrum: a header of one write position per slot
// and, after the last, the bit mask of the slots the page wants; then RING frames for each slot. A slot not in the mask is not written.
export const LANE_SLOTS = 24;
export const laneBuffer = () => new SharedArrayBuffer(4 * (LANE_SLOTS + 1) + LANE_SLOTS * RING * 4);

export function laneWriter(sab) {
  const head = new Int32Array(sab, 0, LANE_SLOTS + 1), data = new Float32Array(sab, 4 * (LANE_SLOTS + 1));
  return {
    wants: slot => (Atomics.load(head, LANE_SLOTS) >> slot & 1) === 1,
    // Silence into every wanted slot: the engine is cut, and the displays should die down rather than freeze.
    silence(n) {
      for (let k = 0; k < LANE_SLOTS; k++) {
        if (!this.wants(k)) continue;
        let w = head[k];
        for (let i = 0; i < n; i++, w = (w + 1) | 0) data[k * RING + (w & (RING - 1))] = 0;
        Atomics.store(head, k, w);
      }
    },
    write(slot, l, r, n) {
      const base = slot * RING;
      let w = head[slot];
      for (let i = 0; i < n; i++, w = (w + 1) | 0) data[base + (w & (RING - 1))] = (l[i] + r[i]) * 0.5;
      Atomics.store(head, slot, w);
    },
  };
}

export function laneReader(sab) {
  const head = new Int32Array(sab, 0, LANE_SLOTS + 1), data = new Float32Array(sab, 4 * (LANE_SLOTS + 1)), at = new Int32Array(LANE_SLOTS);
  return {
    mask(m) {
      const was = Atomics.load(head, LANE_SLOTS);
      Atomics.store(head, LANE_SLOTS, m);
      for (let k = 0; k < LANE_SLOTS; k++) if ((m >> k & 1) && !(was >> k & 1)) at[k] = Atomics.load(head, k);
    },
    // The frames written to a slot since the last read (at most RING), oldest first, into `out`; returns how many.
    read(slot, out) {
      const w = Atomics.load(head, slot), base = slot * RING;
      let n = (w - at[slot]) | 0;
      if (n > RING) { at[slot] = (w - RING) | 0; n = RING; }
      for (let i = 0; i < n; i++, at[slot] = (at[slot] + 1) | 0) out[i] = data[base + (at[slot] & (RING - 1))];
      return n;
    },
  };
}
