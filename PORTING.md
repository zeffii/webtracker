# Porting notes: webtracker -> a dedicated device

webtracker is the prototype. The device would be a native build (C++ on a Teensy 4.1 or Daisy Seed class board, or a
Pi running this page in a kiosk browser). These notes keep that later port honest. Update them when a node is added
or changes shape.

## What carries over unchanged
- The `.wax` file format (JSON project: song, instruments as node graphs, samples).
- The sequencer logic (`src/audio/sequencer.js`): rows -> param writes, note on/off, trigger columns, a clock of
  `{ tickSamples, stamps, playing, songPos, tickId }`. Deterministic, no allocation per tick.
- Each node's `process(inputs, outputs, n, params, slots)` over float buffers. Param value = `params[slots[index]]`.
- The pattern/column model (`src/seq/lane.js`) and the MOD effect semantics (`modchan.js`).

## Rules for new DSP (so it ports line by line)
1. No allocation inside `process`; buffers are sized in `create()`.
2. State lives in typed arrays or plain numbers, not objects/closures created per block.
3. Plain numeric code: no JS-only tricks. `Math.sin/exp/tan` are fine at block rate; use a xorshift for noise (hat808
   does), not `Math.random`.
4. Say how big a node is when adding it (run `node tools/node-memory.mjs`) and whether it should be `shared`.

## Memory per node instance (KB, at 44.1 kHz; `node tools/node-memory.mjs`)
A per-voice node is copied for every voice of its instrument unless it is `shared`, so multiply by the voice count.
Samples, curves and wavetables arrive later by message and are not counted here.

| node | KB | note |
|---|---|---|
| multitap | 1378 | 8 taps x 1 s of delay line |
| wavetable | 1188 | the table itself |
| string | 512 | |
| piano | 384 | |
| shiva | 345 | |
| blur | 336 | FFT buffers |
| shimmer | 260 | |
| hall | 244 | |
| delay | 172 | up to the longest delay time |
| plate | 165 | |
| chorus | 21 | |
| everything else | < 10 | most are 0 |

Reference points (approximate): Teensy 4.1 has about 1 MB of RAM, plus optional PSRAM (up to 16 MB); the Daisy Seed has
about 64 MB of SDRAM. Sample data dominates in practice, not nodes.

## Things that need real work in a port
- **Samples and data uploads.** `message()` hands nodes samples, curves, wavetables and spectra; natively these load
  from an SD card. Nodes using it: addsynth, dvii, fmsynth, gater, granular, modchan, sampler, shiva, waveshaper,
  wavetable, specsynth.
- **FFT.** blur, braids-waves and specsynth use their own FFT; natively use CMSIS-DSP.
- **WASM nodes.** `delay` and `filter` run `assembly/dsp.ts` (AssemblyScript); translating it to C is direct.
- **Double precision.** Filters run in f64. The M7 cores have a double-precision FPU, but it is slower than f32;
  check when profiling.
- **Randomness.** `dvii` uses `Math.random`; replace with a seeded xorshift.
- **Routing.** `connected` flags and `dual` (stereo pair) nodes are decided when a graph is built; natively the graph
  would be compiled once on load.
- **The UI.** Plain canvas/DOM; a device needs its own small renderer. The column widths and short names are
  designed to fit a character grid.
