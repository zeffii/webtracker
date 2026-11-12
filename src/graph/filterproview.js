import { ORANGE, makeCanvas, drag, heartbeat, clamp } from './spaceui.js';
import { responseDb, formantsAt, F_LOW, F_HIGH } from '../audio/nodes/filterproresponse.js';

// The FilterPro panel: the sound going in (grey), the sound coming out (orange) and the filter's own curve between them (green),
// on one frequency axis from 20 Hz to 20 kHz. The spectra are live (the node reports them while the panel asks, every second) and
// fall away a little slower than they rise so they can be read. The curve is drawn from the settings, so it moves with every knob;
// the cutoff has a dot on it to drag (along for the cutoff, up and down for the resonance). Some voicings add marks of their own:
// the vowel its three formants, the combs the teeth at whole multiples of the cutoff.
const W = 560, PL = 40, PR = 20, TOP = 22, PLOT = 190, H = TOP + PLOT + 34;
const DB_TOP = 24, DB_BOTTOM = -36;   // the curve's scale
const GREEN = 'hsl(165 55% 52%)', AMBER = 'hsl(40 95% 62%)';
const LABELS = [[50, '50'], [100, '100'], [200, '200'], [500, '500'], [1000, '1k'], [2000, '2k'], [5000, '5k'], [10000, '10k']];
const MODES = ['lowpass', 'bandpass', 'highpass', 'notch', 'peak', 'allpass', 'morph', 'lowpass 24', 'ladder', 'vowel', 'comb +', 'comb -'];
const NAMES = ['cutoff', 'resonance', 'mode', 'morph', 'vowel', 'damp', 'mix', 'level'];

const hz = v => (v >= 1000 ? `${+(v / 1000).toFixed(v >= 10000 ? 0 : 2)} kHz` : `${Math.round(v)} Hz`);
const dbText = v => `${v >= 0 ? '+' : '-'}${Math.abs(v).toFixed(1)} dB`;

export function createFilterProView({ doc = document, getParam, setParam, watch = () => {}, sampleRate = 48000 }) {
  const el = doc.createElement('div'); el.className = 'spacepanel filterpro-panel';
  const { canvas, ctx, ink } = makeCanvas(doc, W, H, 'sp-pad');
  const info = doc.createElement('div'); info.className = 'sp-info';
  el.append(canvas, info);

  const lo = Math.log2(F_LOW), hi = Math.log2(F_HIGH), pw = W - PL - PR;
  const X = f => PL + (Math.log2(f) - lo) / (hi - lo) * pw;
  const freqAt = x => Math.pow(2, lo + (x - PL) / pw * (hi - lo));
  const Y = d => TOP + PLOT - (clamp(d, DB_BOTTOM, DB_TOP) - DB_BOTTOM) / (DB_TOP - DB_BOTTOM) * PLOT;
  const shown = { input: new Float32Array(240), output: new Float32Array(240), live: false };
  let queued = false;

  const settings = () => { const p = {}; for (const n of NAMES) p[n] = getParam(n); return p; };

  const feed = msg => {
    for (const key of ['input', 'output']) { const a = msg[key], s = shown[key]; for (let i = 0; i < s.length; i++) s[i] = Math.max(a[i], s[i] * 0.85); }
    shown.live = true;
    if (!queued) { queued = true; (doc.defaultView?.requestAnimationFrame ?? (f => f()))(() => { queued = false; draw(); }); }
  };

  // a spectrum along the bottom of the plot, 0 dB at the top and -90 dB at the bottom
  const spectrum = (values, colour, fill) => {
    const y0 = TOP + PLOT;
    ctx.beginPath(); ctx.moveTo(PL, y0);
    for (let i = 0; i < values.length; i++) ctx.lineTo(PL + (i + 0.5) / values.length * pw, y0 - values[i] * (PLOT - 6));
    ctx.lineTo(W - PR, y0); ctx.closePath();
    ctx.globalAlpha = fill; ctx.fillStyle = colour; ctx.fill();
    ctx.globalAlpha = 1; ctx.strokeStyle = colour; ctx.lineWidth = 1.1; ctx.stroke();
  };

  function draw() {
    if (!ctx) return;
    const c = ink(), p = settings(), mode = Math.round(p.mode), fc = clamp(p.cutoff, 20, 18000);
    ctx.setTransform(canvas.width / W, 0, 0, canvas.height / H, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.font = '9px ui-monospace, Consolas, monospace'; ctx.textBaseline = 'top';

    // the grid and the frequency labels
    ctx.lineWidth = 1; ctx.strokeStyle = c; ctx.fillStyle = c; ctx.textAlign = 'center';
    for (const [f, t] of LABELS) {
      ctx.globalAlpha = 0.13; ctx.beginPath(); ctx.moveTo(Math.round(X(f)) + 0.5, TOP); ctx.lineTo(Math.round(X(f)) + 0.5, TOP + PLOT); ctx.stroke();
      ctx.globalAlpha = 0.6; ctx.fillText(t, X(f), TOP + PLOT + 4);
    }
    ctx.globalAlpha = 0.35; ctx.beginPath(); ctx.moveTo(PL, TOP + PLOT + 0.5); ctx.lineTo(W - PR, TOP + PLOT + 0.5); ctx.stroke();
    ctx.globalAlpha = 0.6; ctx.textAlign = 'left'; ctx.fillText('INPUT', PL, 6); ctx.fillStyle = ORANGE; ctx.fillText('OUTPUT', PL + 46, 6);
    ctx.fillStyle = GREEN; ctx.fillText('FILTER', PL + 100, 6);
    ctx.globalAlpha = 1;

    // the audio
    spectrum(shown.input, c, 0.16);
    spectrum(shown.output, ORANGE, 0.3);
    if (!shown.live) { ctx.fillStyle = c; ctx.globalAlpha = 0.45; ctx.textAlign = 'center'; ctx.fillText('play something through it to see the sound', PL + pw / 2, TOP + PLOT / 2 + 20); ctx.textAlign = 'left'; ctx.globalAlpha = 1; }

    // the curve, on its own scale (0 dB dashed, the ends named on the right)
    ctx.strokeStyle = GREEN; ctx.globalAlpha = 0.45; ctx.setLineDash([3, 3]); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(PL, Math.round(Y(0)) + 0.5); ctx.lineTo(W - PR, Math.round(Y(0)) + 0.5); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = GREEN; ctx.globalAlpha = 0.8; ctx.textAlign = 'right';
    ctx.fillText(`+${DB_TOP}`, PL - 4, Y(DB_TOP) - 1); ctx.fillText('0 dB', PL - 4, Y(0) - 4); ctx.fillText(`${DB_BOTTOM}`, PL - 4, Y(DB_BOTTOM) - 8);
    ctx.textAlign = 'left'; ctx.globalAlpha = 1;
    const freqs = [], gains = [];
    for (let i = 0; i <= 300; i++) { const f = F_LOW * Math.pow(F_HIGH / F_LOW, i / 300); freqs.push(f); gains.push(responseDb(f, p, sampleRate)); }
    ctx.strokeStyle = GREEN; ctx.lineWidth = 1.7; ctx.beginPath();
    freqs.forEach((f, i) => { if (i) ctx.lineTo(X(f), Y(gains[i])); else ctx.moveTo(X(f), Y(gains[i])); });
    ctx.stroke();

    // what the voicing adds: formants, comb teeth, or just the cutoff
    const mark = (f, label, colour, dot = true, row = 0) => {
      const x = X(f);
      ctx.strokeStyle = colour; ctx.globalAlpha = 0.7; ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.moveTo(Math.round(x) + 0.5, TOP + 12 + row * 10); ctx.lineTo(Math.round(x) + 0.5, TOP + PLOT); ctx.stroke(); ctx.setLineDash([]);
      ctx.globalAlpha = 1; ctx.fillStyle = colour; ctx.textAlign = 'center'; ctx.fillText(label, clamp(x, PL + 24, W - PR - 24), TOP + 1 + row * 10);
      if (dot) { ctx.beginPath(); ctx.arc(x, Y(responseDb(f, p, sampleRate)), 4, 0, Math.PI * 2); ctx.fill(); }
      ctx.textAlign = 'left';
    };
    let note = '';
    if (mode === 9) {
      const f = formantsAt(p.vowel, fc, sampleRate);
      f.forEach((v, q) => mark(v, `F${q + 1} ${hz(v)}`, GREEN, true, q % 2));
      note = `vowel ${'aeiou'[Math.round(clamp(p.vowel, 0, 4))]} · formants at ${f.map(hz).join(', ')} (they follow the cutoff, 1 kHz is the written pitch)`;
    } else if (mode >= 10) {
      const teeth = [];
      for (let n = 1; n * fc < F_HIGH && n <= 16; n++) teeth.push(n * fc);
      teeth.forEach((v, i) => { if (i < 5) mark(v, `${i + 1}x`, i ? GREEN : AMBER, false); else { ctx.strokeStyle = GREEN; ctx.globalAlpha = 0.25; ctx.beginPath(); ctx.moveTo(Math.round(X(v)) + 0.5, TOP + 12); ctx.lineTo(Math.round(X(v)) + 0.5, TOP + PLOT); ctx.stroke(); ctx.globalAlpha = 1; } });
      note = `${MODES[mode]} · teeth at multiples of ${hz(fc)} (${mode === 10 ? 'peaks' : 'notches, then peaks'} on the whole multiples)`;
    } else {
      mark(fc, `cutoff ${hz(fc)}`, AMBER);
      let top = 0; for (let i = 1; i < gains.length; i++) if (gains[i] > gains[top]) top = i;
      const edges = [];
      if (mode === 0 || mode === 7 || mode === 8) { const ref = gains[0]; const i = gains.findIndex((g, k) => k > 0 && g < ref - 3 && freqs[k] > 20); if (i > 0) edges.push(freqs[i]); }
      else if (mode === 2) { const ref = gains[gains.length - 1]; let i = gains.length - 1; while (i > 0 && gains[i] > ref - 3) i--; if (i > 0) edges.push(freqs[i]); }
      else if (mode === 1) { const ref = gains[top] - 3; let a = top, b = top; while (a > 0 && gains[a] > ref) a--; while (b < gains.length - 1 && gains[b] > ref) b++; if (a > 0) edges.push(freqs[a]); if (b < gains.length - 1) edges.push(freqs[b]); }
      note = `${MODES[mode]}${edges.length ? ` · -3 dB at ${edges.map(hz).join(' and ')}` : ''} · highest point ${dbText(gains[top])} at ${hz(freqs[top])}`;
    }
    info.textContent = `${note}${p.mix < 1 ? ` · mix ${Math.round(p.mix * 100)}%` : ''}`;
  }

  // drag the cutoff dot: along the axis for the cutoff, up and down for the resonance
  let grab = null;
  drag(canvas, W, H, {
    start: (x, y) => {
      if (Math.abs(x - X(clamp(getParam('cutoff'), 20, 18000))) > 9 || y < TOP || y > TOP + PLOT + 6) return false;
      grab = { y, resonance: getParam('resonance') };
      return true;
    },
    move: (x, y) => {
      setParam('cutoff', Math.round(clamp(freqAt(x), 20, 18000)));
      setParam('resonance', Math.round(clamp(grab.resonance + (grab.y - y) / PLOT, 0, 1) * 100) / 100);
      draw();
    },
    done: () => { grab = null; },
  });

  heartbeat(doc, el, watch);
  draw();
  return { el, refresh: draw, draw, feed };
}
