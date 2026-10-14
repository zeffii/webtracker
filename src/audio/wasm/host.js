// Gives a node its own instance of the DSP module with its own memory, laid out
// from a list of regions: { name: byteLength }. Regions are 8-byte aligned and
// exposed as byte offsets plus typed views, so nodes copy a block in, call an
// export, and copy the result out.
export function instantiateDsp(module, regions) {
  const offsets = {};
  let at = 64;   // keep clear of address 0
  for (const [name, bytes] of Object.entries(regions)) {
    offsets[name] = at;
    at += (bytes + 7) & ~7;
  }
  const memory = new WebAssembly.Memory({ initial: Math.ceil(at / 65536) });
  const { exports } = new WebAssembly.Instance(module, { env: { memory } });
  const f32 = (name, length) => new Float32Array(memory.buffer, offsets[name], length);
  const f64 = (name, length) => new Float64Array(memory.buffer, offsets[name], length);
  const i32 = (name, length) => new Int32Array(memory.buffer, offsets[name], length);
  return { exports, offsets, f32, f64, i32 };
}
