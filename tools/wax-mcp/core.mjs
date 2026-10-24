// Everything the Wax tools do, with no browser: the project is loaded into the same engine the page uses (its audio
// thread stubbed out), rendered with the same offline renderer as the Export button, and measured.
import { readFileSync } from 'node:fs';
import { Engine } from '../../src/audio/engine.js';
import { renderSong, encodeWav } from '../../src/audio/export.js';
import { parseProject } from '../../src/project/file.js';
import { ensureMaster } from '../../src/instruments.js';
import { prepareSong } from '../../src/seq/lane.js';
import { ensurePool, slotsOf, sampleMessage, syncSamplerStereo } from '../../src/project/ops.js';
import { NODE_TYPES } from '../../src/audio/nodes/index.js';
import { compileDsp } from '../../src/audio/wasm/load.js';
import { fftPlan } from '../../src/audio/fft.js';

export { encodeWav, NODE_TYPES };

export function loadProject(path) {
  const project = parseProject(readFileSync(path, 'utf8'));
  ensureMaster(project);
  return project;
}

// An engine without a sound card: it only collects what the audio thread would be told.
export function buildEngine(project, { solo = [], mute = [] } = {}) {
  const engine = new Engine();
  engine.node = { port: { postMessage() {} } };
  engine.wasmModule = compileDsp();
  ensurePool(project.samples, 44100);
  for (const [id, def] of Object.entries(project.instruments)) {
    syncSamplerStereo(def, project.samples);
    engine.loadInstrument(id, def.graph);
    for (const node of Object.keys(def.samples ?? {})) {
      slotsOf(def.samples[node]).forEach((sampleId, slot) => { if (project.samples[sampleId]) engine.sendToNode(id, node, sampleMessage(project.samples[sampleId], slot)); });
    }
  }
  const lanes = prepareSong(project.song, project.instruments, engine.registry);
  engine.setSong(project.song);
  const keep = l => l.instrument === 'master' || (solo.length ? solo.includes(l.id) : !mute.includes(l.id));
  for (const { id, instrument, columns, pages, mask, auto } of lanes.filter(keep)) engine.setLane({ id, instrument, columns, pages, mask, auto });
  return { engine, lanes };
}

export async function render(project, { tail = 6, solo = [], mute = [], maxSeconds } = {}) {
  const { engine } = buildEngine(project, { solo, mute });
  return renderSong(engine.exportState(), { tail, ...(maxSeconds ? { maxSeconds } : {}) });
}

// ---------- measuring ----------
const db = x => 20 * Math.log10(Math.max(x, 1e-9));
const BANDS = [['sub', 20, 60], ['low', 60, 250], ['lowmid', 250, 1000], ['mid', 1000, 4000], ['high', 4000, 10000], ['air', 10000, 20000]];

// K-weighting (ITU-R BS.1770): a high shelf, then a high-pass
function kWeight(x, sr) {
  const biquad = (src, b, a) => { let z1 = 0, z2 = 0; const y = new Float32Array(src.length); for (let i = 0; i < src.length; i++) { const v = b[0] * src[i] + z1; z1 = b[1] * src[i] - a[0] * v + z2; z2 = b[2] * src[i] - a[1] * v; y[i] = v; } return y; };
  const K1 = Math.tan(Math.PI * 1681.974450955533 / sr), Q1 = 0.7071752369554196, Vh = Math.pow(10, 3.999843853973347 / 20), Vb = Math.pow(Vh, 0.4996667741545416), d1 = 1 + K1 / Q1 + K1 * K1;
  const shelf = y => biquad(y, [(Vh + Vb * K1 / Q1 + K1 * K1) / d1, 2 * (K1 * K1 - Vh) / d1, (Vh - Vb * K1 / Q1 + K1 * K1) / d1], [2 * (K1 * K1 - 1) / d1, (1 - K1 / Q1 + K1 * K1) / d1]);
  const K2 = Math.tan(Math.PI * 38.13547087602444 / sr), Q2 = 0.5003270373238773, d2 = 1 + K2 / Q2 + K2 * K2;
  return biquad(shelf(x), [1, -2, 1], [2 * (K2 * K2 - 1) / d2, (1 - K2 / Q2 + K2 * K2) / d2]);
}

export function lufs(left, right, sr) {
  const l = kWeight(left, sr), r = kWeight(right, sr), size = Math.round(0.4 * sr), hop = Math.round(0.1 * sr), blocks = [];
  for (let at = 0; at + size <= l.length; at += hop) { let s = 0; for (let i = at; i < at + size; i++) s += l[i] * l[i] + r[i] * r[i]; blocks.push(s / size); }
  const lk = p => -0.691 + 10 * Math.log10(Math.max(p, 1e-12));
  const above = blocks.filter(p => lk(p) > -70);
  if (!above.length) return -Infinity;
  const mean = a => a.reduce((x, y) => x + y, 0) / a.length;
  const gate = lk(mean(above)) - 10, kept = above.filter(p => lk(p) > gate);
  return kept.length ? lk(mean(kept)) : -Infinity;
}

function spectrum(mono, sr, from, n = 8192) {
  const re = new Float64Array(n), im = new Float64Array(n);
  for (let i = 0; i < n; i++) re[i] = (mono[from + i] ?? 0) * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / n));
  fftPlan(n).run(re, im);
  const mag = new Float64Array(n / 2); for (let i = 0; i < n / 2; i++) mag[i] = re[i] * re[i] + im[i] * im[i];
  return mag;
}

// A report on a rendered song: the whole, then window by window.
export function analyse({ left, right, sampleRate: sr }, { window = 8 } = {}) {
  const n = left.length, mono = new Float32Array(n);
  let peak = 0, clipped = 0, dcL = 0, dcR = 0;
  for (let i = 0; i < n; i++) { mono[i] = (left[i] + right[i]) / 2; const a = Math.max(Math.abs(left[i]), Math.abs(right[i])); if (a > peak) peak = a; if (a >= 0.999) clipped++; dcL += left[i]; dcR += right[i]; }
  const nan = [left, right].some(c => c.some(v => !Number.isFinite(v)));
  const whole = { seconds: +(n / sr).toFixed(2), peak_db: +db(peak).toFixed(1), loudness_lufs: +lufs(left, right, sr).toFixed(1), clipped_samples: clipped, dc_offset: +Math.max(Math.abs(dcL), Math.abs(dcR)) / n, not_finite: nan };
  whole.dc_offset = +whole.dc_offset.toExponential(1);
  const sections = [], size = Math.round(window * sr), hz = sr / 8192;
  for (let at = 0; at < n; at += size) {
    const end = Math.min(n, at + size); let sum = 0, pk = 0, ll = 0, rr = 0, lr = 0;
    for (let i = at; i < end; i++) { const a = left[i], b = right[i]; sum += mono[i] * mono[i]; pk = Math.max(pk, Math.abs(a), Math.abs(b)); ll += a * a; rr += b * b; lr += a * b; }
    // the spectrum: a few frames spread over the window, averaged
    const band = Object.fromEntries(BANDS.map(([name]) => [name, 0])); let cen = 0, tot = 0, frames = 0;
    for (let f = at; f + 8192 <= end; f += Math.max(8192, Math.floor((end - at) / 6))) {
      const mag = spectrum(mono, sr, f); frames++;
      for (let i = 1; i < mag.length; i++) { const fr = i * hz; cen += mag[i] * fr; tot += mag[i]; for (const [name, lo, hi] of BANDS) if (fr >= lo && fr < hi) band[name] += mag[i]; }
    }
    // onsets: rises of the 10 ms envelope
    const step = Math.round(0.01 * sr); let onsets = 0, prev = 0, armed = true;
    for (let i = at; i + step <= end; i += step) { let e = 0; for (let k = i; k < i + step; k++) e += Math.abs(mono[k]); e /= step; if (armed && e > prev * 1.8 && e > 0.003) { onsets++; armed = false; } else if (e < prev) armed = true; prev = e; }
    const rms = Math.sqrt(sum / Math.max(1, end - at)), total = Object.values(band).reduce((x, y) => x + y, 0) || 1;
    sections.push({
      from: +(at / sr).toFixed(1), to: +(end / sr).toFixed(1), rms_db: +db(rms).toFixed(1), peak_db: +db(pk).toFixed(1),
      centroid_hz: tot ? Math.round(cen / tot) : 0, onsets_per_s: +(onsets / ((end - at) / sr)).toFixed(1),
      correlation: ll * rr > 0 ? +(lr / Math.sqrt(ll * rr)).toFixed(2) : 1,
      bands_pct: Object.fromEntries(Object.entries(band).map(([k, v]) => [k, Math.round(100 * v / total)])),
    });
  }
  return { whole, sections };
}

// ---------- the song as written ----------
export function outline(project, { window = 64 } = {}) {
  const { song, instruments } = project;
  const lanes = [];
  for (const L of song.lanes) {
    const placements = [...L.placements].sort((a, b) => a.start - b.start);
    const used = placements.reduce((s, p) => s + p.length, 0);
    const notes = new Array(Math.ceil(song.length / window)).fill(0);
    const defn = instruments[L.instrument], pairs = Math.max(1, defn?.noteColumns ?? 1);
    for (const p of placements) {
      const pat = L.patterns[p.puid]; if (!pat) continue;
      pat.text.split('\n').slice(0, p.length).forEach((row, i) => {
        const cells = row.trim().split(/\s+/); let count = 0;
        for (let c = 0; c < pairs; c++) { const v = cells[c * 2]; if (v && v !== '...' && v !== '===' && v !== '---' && /^[A-G]/.test(v)) count++; }
        const w = Math.floor((p.start + i) / window); if (w < notes.length) notes[w] += count;
      });
    }
    lanes.push({ id: L.id, instrument: L.instrument, patterns: Object.keys(L.patterns).length, placements: placements.length, ticks_filled: used, first: placements[0]?.start ?? null, last: placements.length ? Math.max(...placements.map(p => p.start + p.length)) : null, notes_per_window: notes });
  }
  return { name: song.name, bpm: song.bpm, ticks_per_beat: song.ticksPerBeat, length: song.length, loop: song.loop, window_ticks: window, seconds: +(song.length / song.ticksPerBeat * 60 / song.bpm).toFixed(1), lanes };
}

// ---------- checking ----------
export function validate(path) {
  const problems = [], warnings = [];
  let project;
  try { project = loadProject(path); } catch (e) { return { ok: false, problems: [e.message], warnings }; }
  for (const [id, def] of Object.entries(project.instruments)) {
    for (const n of def.graph.nodes) if (!NODE_TYPES[n.type]) problems.push(`instrument "${id}": node "${n.id}" has the unknown type "${n.type}"`);
    for (const [a, b] of def.graph.connections) for (const port of [a, b]) { const node = port.split('.')[0]; if (!def.graph.nodes.some(n => n.id === node)) problems.push(`instrument "${id}": the connection ${a} → ${b} names a node that is not there`); }
    for (const e of def.exposed ?? []) if (!def.graph.nodes.some(n => n.id === e.node)) problems.push(`instrument "${id}": the exposed parameter ${e.node}.${e.param} has no node`);
    for (const n of def.graph.nodes) { const t = NODE_TYPES[n.type]; if (!t) continue; for (const k of Object.keys(n.params ?? {})) if (!t.params.some(p => p.name === k)) warnings.push(`instrument "${id}": ${n.id} (${n.type}) has no parameter "${k}"`); }
    const voices = def.graph.voices ?? 1;
    if ((def.noteColumns ?? 1) > voices && def.graph.nodes.some(n => n.type === 'voices')) warnings.push(`instrument "${id}": ${def.noteColumns} note columns but only ${voices} voices`);
  }
  if (problems.length) return { ok: false, problems, warnings };
  try {
    const { engine, lanes } = buildEngine(project);
    for (const L of project.song.lanes) {
      const lane = lanes.find(l => l.id === L.id);
      for (const p of L.placements) {
        if (p.start + p.length > project.song.length) warnings.push(`lane "${L.id}": the pattern "${p.puid}" at ${p.start} runs past the end of the song (${project.song.length})`);
        const pat = lane.patterns[p.puid];
        if (pat && p.length > pat.length) warnings.push(`lane "${L.id}": the placement of "${p.puid}" at ${p.start} is ${p.length} long but the pattern has ${pat.length} rows`);
      }
      const sorted = [...L.placements].sort((a, b) => a.start - b.start);
      sorted.forEach((p, i) => { const next = sorted[i + 1]; if (next && p.start + p.length > next.start) warnings.push(`lane "${L.id}": "${p.puid}" at ${p.start} is cut short by the next placement at ${next.start}`); });
    }
    void engine;
  } catch (e) { return { ok: false, problems: [e.message], warnings }; }
  return { ok: true, problems, warnings, lanes: project.song.lanes.length, instruments: Object.keys(project.instruments).length, ticks: project.song.length };
}

// ---------- what the machine offers ----------
export function reference(query = '') {
  const q = query.toLowerCase();
  const nodes = Object.values(NODE_TYPES).filter(t => !q || t.type.toLowerCase().includes(q) || (t.category ?? '').toLowerCase().includes(q))
    .map(t => ({ type: t.type, category: t.category, inputs: t.inputs, outputs: t.outputs, generator: !!t.generator, params: t.params.map(p => `${p.name} ${p.min}..${p.max} (${p.def}${p.int ? ', whole numbers' : ''})`) }));
  return q ? nodes : nodes.map(({ params, ...rest }) => ({ ...rest, params: params.length }));
}
