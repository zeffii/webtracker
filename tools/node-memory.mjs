// Prints how much typed-array memory each node allocates when it is created (44.1 kHz, defaults), biggest first. Run: node tools/node-memory.mjs
// Some nodes allocate more later, when a message hands them samples, curves or wavetables.
import { NODE_TYPES } from '../src/audio/nodes/index.js';
const names = ['Float32Array','Float64Array','Int32Array','Uint32Array','Int16Array','Uint16Array','Uint8Array','Int8Array'];
let total = 0;
const orig = {};
for (const n of names) {
  const C = globalThis[n]; orig[n] = C;
  globalThis[n] = new Proxy(C, { construct(t, args, nt) { if (typeof args[0] === 'number') total += args[0] * C.BYTES_PER_ELEMENT; else if (args[0]?.byteLength !== undefined && !(args[0] instanceof ArrayBuffer)) total += args[0].byteLength; return Reflect.construct(t, args, nt); } });
}
const clock = { tickSamples: 2000, stamps: new Uint32Array(64), playing: false, songPos: 0, tickId: 0 };
const rows = [];
for (const [type, def] of Object.entries(NODE_TYPES)) {
  total = 0;
  const connected = new Array(8).fill(false);
  let ok = true;
  try { def.create({ sampleRate: 44100, maxBlock: 128, connected, wasm: null, data: undefined, init: undefined, stereo: false, clock, source: undefined, tap: () => null }); } catch (e) { ok = e.message.slice(0, 40); }
  rows.push([type, total, ok]);
}
rows.sort((a, b) => b[1] - a[1]);
for (const [t, b, ok] of rows) console.log(t.padEnd(12), (b / 1024).toFixed(1).padStart(9), 'KB', ok === true ? '' : `(create failed: ${ok})`);
