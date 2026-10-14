// DSP kernels compiled to WASM. Memory is imported: the host owns it, lays out
// the buffers and state, and passes byte offsets. All maths is f64 with f32
// buffers, matching the JS reference nodes so both can be compared sample for sample.

// State at statePtr: f64 ic1, f64 ic2.
export function filterBlock(n: i32, a1: f64, a2: f64, a3: f64, k: f64, mode: i32,
  inPtr: usize, outPtr: usize, statePtr: usize): void {
  let ic1 = load<f64>(statePtr);
  let ic2 = load<f64>(statePtr, 8);
  for (let i = 0; i < n; i++) {
    const x = <f64>load<f32>(inPtr + ((<usize>i) << 2));
    const v3 = x - ic2;
    const v1 = a1 * ic1 + a2 * v3;
    const v2 = ic2 + a2 * ic1 + a3 * v3;
    ic1 = 2 * v1 - ic1;
    ic2 = 2 * v2 - ic2;
    const y = mode == 0 ? v2 : mode == 1 ? v1 : x - k * v1 - v2;
    store<f32>(outPtr + ((<usize>i) << 2), <f32>y);
  }
  if (Math.abs(ic1) < 1e-20) ic1 = 0;
  if (Math.abs(ic2) < 1e-20) ic2 = 0;
  store<f64>(statePtr, ic1);
  store<f64>(statePtr, ic2, 8);
}

// State at statePtr: f64 d (negative until first use), i32 w.
export function delayBlock(n: i32, size: i32, target: f64, slew: f64, fb: f64, mix: f64,
  inPtr: usize, outPtr: usize, bufPtr: usize, statePtr: usize): void {
  let d = load<f64>(statePtr);
  let w = load<i32>(statePtr, 8);
  if (d < 0) d = target;
  for (let i = 0; i < n; i++) {
    d += (target - d) * slew;
    let r = <f64>w - d;
    if (r < 0) r += <f64>size;
    const k = <i32>r;
    const f = r - <f64>k;
    const k1 = k + 1 == size ? 0 : k + 1;
    const b0 = <f64>load<f32>(bufPtr + ((<usize>k) << 2));
    const b1 = <f64>load<f32>(bufPtr + ((<usize>k1) << 2));
    const y = b0 + (b1 - b0) * f;
    const x = <f64>load<f32>(inPtr + ((<usize>i) << 2));
    const v = x + y * fb;
    store<f32>(bufPtr + ((<usize>w) << 2), Math.abs(v) < 1e-20 ? <f32>0 : <f32>v);
    store<f32>(outPtr + ((<usize>i) << 2), <f32>(x + y * mix));
    if (++w == size) w = 0;
  }
  store<f64>(statePtr, d);
  store<i32>(statePtr, w, 8);
}
