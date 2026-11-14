#!/usr/bin/env node
// Reference renders for the native port (github.com/zeffii/wax-core): a .wax song rendered offline by this engine to a
// 32-bit float WAV, the same way every time, so the C++ engine's render of the same song can be compared sample by sample.
//
//   node tools/render-ref.mjs song.wax [out.wav] [--tail 6]
//   node tools/render-ref.mjs --demos outdir [--tail 6]      every song in src/project/demos
//
// Beside each WAV goes a .json with the facts a comparison needs: sample rate, frames, peak, a checksum of the samples and
// the node types the song uses (the ones the native engine must have before it can play that song).
import { writeFileSync, readdirSync, mkdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';   // (a URL's .pathname is "/C:/..." on Windows)

// The few places that roll dice (dvii, the note sequencer) use Math.random. A reference has to come out the same on every
// run, so it is replaced by a seeded xorshift32 before the engine is loaded. The native engine uses the same generator.
const SEED = 0x9e3779b9;
let dice = SEED;
const seededRandom = () => {
  dice ^= dice << 13; dice >>>= 0;
  dice ^= dice >>> 17;
  dice ^= dice << 5; dice >>>= 0;
  return dice / 4294967296;
};
Math.random = seededRandom;

const { loadProject, render, encodeWav } = await import('./wax-mcp/core.mjs');

const nodeTypesOf = project => {
  const types = new Set();
  for (const def of Object.values(project.instruments)) for (const node of def.graph?.nodes ?? []) types.add(node.type);
  return [...types].sort();
};

async function renderReference(waxPath, wavPath, tail) {
  dice = SEED;   // every song starts from the same dice
  const project = loadProject(waxPath);
  const started = performance.now();
  const audio = await render(project, { tail });
  const wav = Buffer.from(await encodeWav(audio, 32).arrayBuffer());
  writeFileSync(wavPath, wav);
  const facts = {
    song: basename(waxPath),
    version: JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version,
    sampleRate: audio.sampleRate,
    frames: audio.left.length,
    seconds: +audio.seconds.toFixed(3),
    peak: +audio.peak.toFixed(6),
    tail,
    seed: SEED,
    sha256: createHash('sha256').update(wav.subarray(44)).digest('hex'),
    nodeTypes: nodeTypesOf(project),
  };
  writeFileSync(wavPath.replace(/\.wav$/i, '.json'), `${JSON.stringify(facts, null, 2)}\n`);
  const took = ((performance.now() - started) / 1000).toFixed(1);
  console.log(`${facts.song}: ${facts.seconds} s, peak ${facts.peak}, ${facts.nodeTypes.length} node types, rendered in ${took} s -> ${wavPath}`);
  return facts;
}

const args = process.argv.slice(2);
const flag = name => { const at = args.indexOf(name); return at < 0 ? null : args.splice(at, 2)[1]; };
const tail = Number(flag('--tail') ?? 6);
const demosOut = flag('--demos');

if (demosOut) {
  const demos = fileURLToPath(new URL('../src/project/demos/', import.meta.url));
  mkdirSync(demosOut, { recursive: true });
  for (const file of readdirSync(demos).filter(f => f.endsWith('.wax')).sort()) {
    await renderReference(join(demos, file), join(demosOut, file.replace(/\.wax$/, '.wav')), tail);
  }
} else if (args[0]) {
  await renderReference(args[0], args[1] ?? args[0].replace(/\.wax$/i, '.ref.wav'), tail);
} else {
  console.log('usage: node tools/render-ref.mjs song.wax [out.wav] [--tail 6]\n       node tools/render-ref.mjs --demos outdir [--tail 6]');
  process.exit(1);
}
