import { SPEC_NAMES, WAVES, FILTERS, LFO_WAVES, LFO_DESTS, filterResponse, lfoShape, oscPreview, envCurve } from '../audio/nodes/cardinal.js';

// The pictures of the Cardinal synth, one canvas with four panels, redrawn when a parameter moves:
//   oscillators   a few cycles of osc 1 (blue), osc 2 (amber) and the two together (ink), with sync, fm and ring applied
//   filter        the gain of the chosen filter against frequency, with the stretch the mod envelope sweeps the cutoff through shaded
//   envelopes     the amp envelope (amber) and the mod envelope (blue), held and then let go
//   lfos          one cycle of each LFO, with what it moves
// The oscillator picture is the node's own code run offline, so it shows exactly what is heard.
const W = 360, PL = 34, PR = 8, SR = 44100;
const PANEL_H = { osc: 92, filter: 104, env: 92, lfo: 70 };
const OSC_Y = 0, FILTER_Y = OSC_Y + PANEL_H.osc, ENV_Y = FILTER_Y + PANEL_H.filter, LFO_Y = ENV_Y + PANEL_H.env, H = LFO_Y + PANEL_H.lfo + 4;
const COLOUR = { one: 'hsl(205 70% 50%)', two: 'hsl(35 85% 52%)', amp: 'hsl(35 85% 52%)', mod: 'hsl(205 70% 50%)', lfo1: 'hsl(145 55% 42%)', lfo2: 'hsl(290 50% 55%)' };
const DB_TOP = 18, DB_BOTTOM = -48;

export function createCardinalView({ doc = document, getParam }) {
  const canvas = doc.createElement('canvas');
  canvas.width = W; canvas.height = H; canvas.className = 'drumview';
  const ctx = canvas.getContext('2d');
  const plotW = W - PL - PR;
  const values = () => Object.fromEntries(SPEC_NAMES.map(name => [name, getParam(name)]));

  // the title bar of a panel, and a faint line under it
  function frame(ink, y, height, title, right = '') {
    ctx.globalAlpha = 0.1; ctx.fillStyle = ink; ctx.fillRect(0, y + height - 1, W, 1);
    ctx.globalAlpha = 0.75; ctx.fillText(title, 6, y + 4);
    if (right) { ctx.textAlign = 'right'; ctx.fillText(right, W - PR, y + 4); ctx.textAlign = 'left'; }
    ctx.globalAlpha = 1;
  }
  // a line through samples spread over the width of the plot; `at(sample)` gives the y position
  function trace(samples, x0, y0, h, colour, width = 1.5, scale = 1) {
    ctx.beginPath(); ctx.strokeStyle = colour; ctx.lineWidth = width;
    const mid = y0 + h / 2, half = h / 2 - 2;
    for (let i = 0; i < samples.length; i++) {
      const x = x0 + (i / (samples.length - 1)) * plotW, y = mid - Math.max(-1, Math.min(1, samples[i] * scale)) * half;
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.stroke();
  }
  const guide = (ink, x, y, w) => { ctx.globalAlpha = 0.2; ctx.fillStyle = ink; ctx.fillRect(x, Math.round(y), w, 1); ctx.globalAlpha = 1; };
  const hzText = v => (v >= 1000 ? `${(v / 1000).toFixed(v >= 10000 ? 0 : 1)}k` : `${Math.round(v)}`);

  function drawOscillators(ink, v) {
    const detail = [v.o2sync >= 0.5 ? 'sync' : '', v.fm > 0 ? 'fm' : '', v.ring > 0 ? 'ring' : ''].filter(Boolean).join(' + ');
    frame(ink, OSC_Y, PANEL_H.osc, 'oscillators', `${WAVES[Math.round(v.o1wave)]} / ${WAVES[Math.round(v.o2wave)]}${detail ? ` · ${detail}` : ''}`);
    const y0 = OSC_Y + 16, h = PANEL_H.osc - 22;
    guide(ink, PL, y0 + h / 2, plotW);
    trace(oscPreview(v, { sr: SR, only: 1 }), PL, y0, h, COLOUR.one, 1.1);
    trace(oscPreview(v, { sr: SR, only: 2 }), PL, y0, h, COLOUR.two, 1.1);
    trace(oscPreview(v, { sr: SR }), PL, y0, h, ink, 1.8);
  }

  function drawFilter(ink, v) {
    const type = Math.round(v.ftype);
    frame(ink, FILTER_Y, PANEL_H.filter, 'filter', `${FILTERS[type]} · ${hzText(v.cutoff)} Hz · res ${Math.round(v.res * 100)}%`);
    const x0 = PL, y0 = FILTER_Y + 16, h = PANEL_H.filter - 30;
    const lo = Math.log(20), hi = Math.log(20000);
    const xOf = hz => x0 + ((Math.log(hz) - lo) / (hi - lo)) * plotW;
    const yOf = db => y0 + (1 - (Math.max(DB_BOTTOM, Math.min(DB_TOP, db)) - DB_BOTTOM) / (DB_TOP - DB_BOTTOM)) * h;
    ctx.fillStyle = ink; ctx.globalAlpha = 0.5;
    for (const hz of [100, 1000, 10000]) { ctx.fillRect(Math.round(xOf(hz)), y0, 1, h); ctx.fillText(hzText(hz), xOf(hz) + 2, y0 + h - 1); }
    guide(ink, x0, yOf(0), plotW);
    if (v.e2cut !== 0) {   // the stretch the mod envelope moves the cutoff through
      const a = xOf(Math.min(20000, Math.max(20, v.cutoff * Math.pow(2, Math.min(0, v.e2cut))))), b = xOf(Math.min(20000, Math.max(20, v.cutoff * Math.pow(2, Math.max(0, v.e2cut)))));
      ctx.globalAlpha = 0.13; ctx.fillStyle = COLOUR.mod; ctx.fillRect(a, y0, Math.max(1, b - a), h);
    }
    ctx.globalAlpha = 1;
    ctx.beginPath(); ctx.strokeStyle = ink; ctx.lineWidth = 1.8;
    for (let px = 0; px <= plotW; px++) {
      const hz = Math.exp(lo + (px / plotW) * (hi - lo)), db = 20 * Math.log10(Math.max(1e-5, filterResponse(v, hz)));
      px ? ctx.lineTo(x0 + px, yOf(db)) : ctx.moveTo(x0 + px, yOf(db));
    }
    ctx.stroke();
    ctx.strokeStyle = COLOUR.mod; ctx.lineWidth = 1; ctx.setLineDash([2, 3]);
    ctx.beginPath(); ctx.moveTo(Math.round(xOf(v.cutoff)) + 0.5, y0); ctx.lineTo(Math.round(xOf(v.cutoff)) + 0.5, y0 + h); ctx.stroke(); ctx.setLineDash([]);
  }

  function drawEnvelopes(ink, v) {
    const long = Math.max(v.atk + v.dec, v.matk + v.mdec), hasSustain = v.sus > 0.02 || v.msus > 0.02;
    const total = Math.round(Math.min(4000, Math.max(100, long * 1.2 + (hasSustain ? 150 : 0) + Math.max(v.rel, v.mrel) * 0.7)));
    const hold = hasSustain ? Math.round(Math.min(total * 0.55, long * 1.1 + 60)) : 100000;
    frame(ink, ENV_Y, PANEL_H.env, 'envelopes', `${Math.round(total)} ms`);
    const legend = [['amp', COLOUR.amp], ['mod', COLOUR.mod]]; let lx = 82;
    for (const [t, c] of legend) { ctx.fillStyle = c; ctx.fillRect(lx, ENV_Y + 5, 8, 3); ctx.fillStyle = ink; ctx.fillText(t, lx + 11, ENV_Y + 2); lx += 40; }
    const y0 = ENV_Y + 18, h = PANEL_H.env - 28;
    guide(ink, PL, y0 + h, plotW); guide(ink, PL, y0, plotW);
    for (const [curve, colour, width] of [[envCurve(v.matk, v.mdec, v.msus, v.mrel, hold, total), COLOUR.mod, 1.5], [envCurve(v.atk, v.dec, v.sus, v.rel, hold, total), COLOUR.amp, 2]]) {
      ctx.beginPath(); ctx.strokeStyle = colour; ctx.lineWidth = width;
      curve.forEach((value, i) => { const x = PL + (i / (curve.length - 1)) * plotW, y = y0 + h - value * h; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
      ctx.stroke();
    }
    if (hold < total) { ctx.globalAlpha = 0.5; ctx.fillStyle = ink; ctx.fillRect(Math.round(PL + (hold / total) * plotW), y0, 1, h); ctx.globalAlpha = 1; }   // where the key comes up
  }

  function drawLfos(ink, v) {
    frame(ink, LFO_Y, PANEL_H.lfo, 'lfos');
    const half = (plotW - 10) / 2, y0 = LFO_Y + 16, h = PANEL_H.lfo - 22;
    [['l1', COLOUR.lfo1, PL], ['l2', COLOUR.lfo2, PL + half + 10]].forEach(([key, colour, x0]) => {
      const wave = Math.round(v[`${key}wave`]), amount = v[`${key}amt`];
      ctx.fillStyle = colour; ctx.globalAlpha = 0.9;
      ctx.fillText(`${LFO_WAVES[wave]} ${v[`${key}rate`] < 10 ? v[`${key}rate`].toFixed(1) : Math.round(v[`${key}rate`])} Hz → ${LFO_DESTS[Math.round(v[`${key}dest`])]}`, x0, LFO_Y + 4);
      ctx.globalAlpha = 1;
      guide(ink, x0, y0 + h / 2, half);
      ctx.beginPath(); ctx.strokeStyle = colour; ctx.lineWidth = 1.6; ctx.globalAlpha = amount > 0 ? 1 : 0.35;
      const held = [0.4, -0.7, 0.9, -0.2];   // a few made-up steps for the random wave
      for (let i = 0; i <= half; i++) {
        const p = (i / half) % 1, y = y0 + h / 2 - lfoShape(wave, p, held[Math.min(3, Math.floor((i / half) * 4))]) * (h / 2 - 2) * Math.max(0.12, amount);
        i ? ctx.lineTo(x0 + i, y) : ctx.moveTo(x0 + i, y);
      }
      ctx.stroke(); ctx.globalAlpha = 1;
    });
  }

  function draw() {
    const ink = typeof getComputedStyle === 'function' ? getComputedStyle(canvas).color : '#888';
    ctx.clearRect(0, 0, W, H);
    ctx.font = '10px ui-monospace, Consolas, monospace'; ctx.textBaseline = 'top'; ctx.textAlign = 'left'; ctx.lineWidth = 1; ctx.fillStyle = ink; ctx.strokeStyle = ink;
    const v = values();
    drawOscillators(ink, v); drawFilter(ink, v); drawEnvelopes(ink, v); drawLfos(ink, v);
  }

  draw();
  return { el: canvas, refresh: draw };
}
