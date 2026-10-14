import { DSP_WASM_BASE64 } from './dsp.wasm.js';

// Compiles the embedded DSP module. Runs on the main thread (or in tests); the
// resulting WebAssembly.Module is posted to the worklet, which has no atob.
export function compileDsp() {
  const bin = atob(DSP_WASM_BASE64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new WebAssembly.Module(bytes);
}
