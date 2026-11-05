import { createBezierEditor } from './bezieredit.js';
import { renderPreview, REFERENCE_MS, DEFAULT_SHAPES, NOISE_TYPES } from '../audio/nodes/drumsynth2.js';

// The drum synth 2 panel: three drawings to edit (pitch, volume, noise) and the whole hit as it sounds, drawn from the node's own code.
const COL = { pitch: 'hsl(200 70% 55%)', amp: 'hsl(35 85% 55%)', noise: 'hsl(145 55% 48%)' };
const W = 520, H = 86, PL = 48, PR = 12, SR = 44100;
const PARAMS = ['startPitch', 'endPitch', 'pitchMul', 'keytrack', 'root', 'prate', 'body', 'arate', 'harm', 'drive', 'noise', 'noiseType', 'noiseTone', 'noiseHigh', 'nrate', 'click', 'clickMode', 'clickLen', 'clickTone', 'clickTail', 'boost', 'boostFreq'];

export function createDrum2View({ doc = document, getParam, getClickSample = () => null, env = {}, onChange }) {
  const el = (tag, props = {}, ...kids) => { const e = doc.createElement(tag); Object.assign(e, props); for (const k of kids) e.appendChild(typeof k === 'string' ? doc.createTextNode(k) : k); return e; };
  const drawings = { ...env };
  const hz = v => (v >= 1000 ? `${(v / 1000).toFixed(1)}k` : `${Math.round(v)} Hz`);
  const editors = {
    pitch: createBezierEditor({ doc, title: 'PITCH', color: COL.pitch, points: env.pitch, fallback: DEFAULT_SHAPES.pitch, getMs: () => REFERENCE_MS.pitch / getParam('prate'), labels: () => [hz(getParam('startPitch') * getParam('pitchMul')), hz(getParam('endPitch') * getParam('pitchMul'))], onChange: p => { drawings.pitch = p; onChange('pitch', p); refresh(); } }),
    amp: createBezierEditor({ doc, title: 'VOLUME', color: COL.amp, points: env.amp, fallback: DEFAULT_SHAPES.amp, getMs: () => REFERENCE_MS.amp / getParam('arate'), onChange: p => { drawings.amp = p; onChange('amp', p); refresh(); } }),
    noise: createBezierEditor({ doc, title: () => `NOISE (${NOISE_TYPES[Math.round(getParam('noiseType'))] ?? 'white'})`, color: COL.noise, points: env.noise, fallback: DEFAULT_SHAPES.noise, getMs: () => REFERENCE_MS.noise / getParam('nrate'), onChange: p => { drawings.noise = p; onChange('noise', p); refresh(); } }),
  };
  const dpr = Math.max(1, Math.min(3, (typeof devicePixelRatio === 'number' ? devicePixelRatio : 1)));
  const canvas = el('canvas', { width: W * dpr, height: H * dpr, className: 'bezier-pad' });
  canvas.style && Object.assign(canvas.style, { width: `${W}px`, height: `${H}px` });
  const ctx = canvas.getContext?.('2d') ?? null;

  const preview = () => {
    if (!ctx) return;
    const values = Object.fromEntries(PARAMS.map(n => [n, getParam(n)]));
    const ms = Math.min(1500, Math.max(150, REFERENCE_MS.amp / values.arate * 1.05));
    const data = renderPreview(values, { env: drawings, sample: getClickSample(), ms, sr: SR });
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const ink = typeof getComputedStyle === 'function' ? getComputedStyle(canvas).color : '#888';
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = ink; ctx.globalAlpha = 0.65; ctx.font = '10px ui-monospace, Consolas, monospace'; ctx.textBaseline = 'top';
    ctx.fillText('THE HIT', PL, 2); ctx.textAlign = 'right'; ctx.fillText(`${Math.round(ms)} ms`, W - PR, H - 12); ctx.textAlign = 'left';
    const pw = W - PL - PR, mid = H / 2 + 4, amp = H / 2 - 12;
    ctx.globalAlpha = 0.2; ctx.fillRect(PL, Math.round(mid), pw, 1); ctx.globalAlpha = 1;
    ctx.fillStyle = COL.amp;
    for (let px = 0; px < pw; px++) {
      const a = Math.floor(px * data.length / pw), b = Math.max(a + 1, Math.floor((px + 1) * data.length / pw));
      let lo = 0, hi = 0;
      for (let i = a; i < b; i++) { if (data[i] < lo) lo = data[i]; if (data[i] > hi) hi = data[i]; }
      const y0 = mid - Math.min(1, hi) * amp, y1 = mid - Math.max(-1, lo) * amp;
      ctx.fillRect(PL + px, y0, 1, Math.max(1, y1 - y0));
    }
  };
  const refresh = () => { for (const e of Object.values(editors)) e.draw(); preview(); };
  const root = el('div', { className: 'curve-editor drum2' }, editors.pitch.el, editors.amp.el, editors.noise.el, canvas);
  preview();
  return { el: root, refresh, draw: refresh };
}
