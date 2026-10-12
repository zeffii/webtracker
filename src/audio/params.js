// Parameter registry. One slot per parameter in a shared block of 32-bit floats.
// The graph compiler allocates slots; the UI and sequencer write them; the
// audio thread reads them once per block.
export const PARAM_CAPACITY = 1024;

export class ParamRegistry {
  slots = new Map();
  meta = [];

  constructor(sab = new SharedArrayBuffer(PARAM_CAPACITY * 4)) {
    this.sab = sab;
    this.values = new Float32Array(sab);
  }

  // Re-allocating a known address returns its slot and keeps the current value.
  allocate(address, def, min, max, int = false) {
    const known = this.slots.get(address);
    if (known !== undefined) return known;
    const slot = this.slots.size;
    if (slot >= PARAM_CAPACITY) throw new Error('parameter block is full');
    this.slots.set(address, slot);
    this.meta[slot] = { address, min, max, int };
    this.values[slot] = def;
    return slot;
  }

  set(address, value) {
    const slot = this.slots.get(address);
    if (slot === undefined) throw new Error(`unknown parameter "${address}"`);
    const { min, max } = this.meta[slot];
    this.values[slot] = Math.min(max, Math.max(min, value));
  }

  get(address) {
    const slot = this.slots.get(address);
    if (slot === undefined) throw new Error(`unknown parameter "${address}"`);
    return this.values[slot];
  }
}
