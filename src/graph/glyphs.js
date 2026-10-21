// Small fixed pictures for the inside of a node, drawn with canvas paths. Each takes
// (ctx, cx, cy, w, h) and strokes in the current stroke style. Together with the node's
// shape they say what the node does: sources are rounded with a waveform, processors are
// boxes with a response curve, mixing and gain are circles.
const line = (ctx, pts) => {
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.stroke();
};
const curve = (ctx, cx, cy, w, h, fn, steps = 24) => {
  line(ctx, Array.from({ length: steps + 1 }, (_, i) => {
    const t = i / steps;
    return [cx - w / 2 + t * w, cy - (fn(t) * h) / 2];
  }));
};

export const GLYPHS = {
  osc: (ctx, cx, cy, w, h) => curve(ctx, cx, cy, w, h, t => Math.sin(t * Math.PI * 4)),
  lfo: (ctx, cx, cy, w, h) => curve(ctx, cx, cy, w, h, t => Math.sin(t * Math.PI * 2) * 0.9),
  sample: (ctx, cx, cy, w, h) => {
    const env = [0.1, 0.9, 0.6, 0.75, 0.35, 0.5, 0.2, 0.25, 0.08];   // a decaying, uneven waveform
    ctx.beginPath();
    env.forEach((a, i) => {
      const x = cx - w / 2 + (i / (env.length - 1)) * w, y = (i % 2 ? -1 : 1) * a * h * 0.5;
      ctx.moveTo(x, cy - y);
      ctx.lineTo(x, cy + y);
    });
    ctx.stroke();
  },
  adsr: (ctx, cx, cy, w, h) => {
    const x = f => cx - w / 2 + f * w, y = f => cy + h / 2 - f * h;
    line(ctx, [[x(0), y(0)], [x(0.2), y(1)], [x(0.4), y(0.55)], [x(0.75), y(0.55)], [x(1), y(0)]]);
  },
  lowpass: (ctx, cx, cy, w, h) => {
    const x = f => cx - w / 2 + f * w, y = f => cy + h / 2 - f * h;
    line(ctx, [[x(0), y(0.7)], [x(0.5), y(0.7)], [x(0.65), y(0.95)], [x(0.85), y(0.3)], [x(1), y(0)]]);
  },
  delay: (ctx, cx, cy, w, h) => {
    ctx.beginPath();
    [1, 0.7, 0.5, 0.35, 0.2].forEach((a, i) => {
      const x = cx - w / 2 + (i / 4) * w;
      ctx.moveTo(x, cy + h / 2);
      ctx.lineTo(x, cy + h / 2 - a * h);
    });
    ctx.stroke();
  },
  gain: (ctx, cx, cy, w, h) => {
    const s = Math.min(w, h) * 0.45;
    ctx.beginPath();
    ctx.moveTo(cx - s * 0.6, cy - s);
    ctx.lineTo(cx + s, cy);
    ctx.lineTo(cx - s * 0.6, cy + s);
    ctx.closePath();
    ctx.stroke();
  },
  mix: (ctx, cx, cy, w, h) => {
    const s = Math.min(w, h) * 0.3;
    line(ctx, [[cx - s, cy - s], [cx + s, cy + s]]);
    line(ctx, [[cx - s, cy + s], [cx + s, cy - s]]);
  },
  pan: (ctx, cx, cy, w, h) => {   // two arrows pointing apart
    const s = Math.min(w, h) * 0.4;
    line(ctx, [[cx - s, cy], [cx + s, cy]]);
    line(ctx, [[cx - s * 0.4, cy - s * 0.5], [cx - s, cy], [cx - s * 0.4, cy + s * 0.5]]);
    line(ctx, [[cx + s * 0.4, cy - s * 0.5], [cx + s, cy], [cx + s * 0.4, cy + s * 0.5]]);
  },
  chorus: (ctx, cx, cy, w, h) => {   // two waves drifting against each other
    curve(ctx, cx, cy - h * 0.18, w, h * 0.5, t => Math.sin(t * Math.PI * 3));
    curve(ctx, cx, cy + h * 0.18, w, h * 0.5, t => Math.sin(t * Math.PI * 3 + 1.2));
  },
  phaser: (ctx, cx, cy, w, h) => curve(ctx, cx, cy, w, h, t => 0.8 - 1.8 * Math.abs(Math.sin(t * Math.PI * 2.5)) * (0.4 + t * 0.6)),   // a response with moving notches
  flanger: (ctx, cx, cy, w, h) => curve(ctx, cx, cy, w, h, t => Math.sin(Math.PI * 2 * (1.5 * t + 3 * t * t)) * 0.85, 40),   // a wave sweeping upwards
  distortion: (ctx, cx, cy, w, h) => curve(ctx, cx, cy, w, h, t => Math.max(-0.55, Math.min(0.55, 1.7 * Math.sin(t * Math.PI * 2))) / 0.55 * 0.8),   // a sine with its peaks cut off
  shiva: (ctx, cx, cy, w, h) => {   // stems of different heights, a dot on each for its pan
    line(ctx, [[cx - w / 2, cy + h * 0.35], [cx + w / 2, cy + h * 0.35]]);
    ctx.beginPath();
    [0.5, 0.9, 0.35, 0.7, 0.25, 0.5].forEach((a, i) => {
      const x = cx - w / 2 + ((i + 0.5) / 6) * w;
      ctx.moveTo(x, cy + h * 0.35);
      ctx.lineTo(x, cy + h * 0.35 - a * h * 0.85);
    });
    ctx.stroke();
  },
  gater: (ctx, cx, cy, w, h) => {   // a square pulse train: open, closed, open, open
    const x0 = cx - w / 2, base = cy + h * 0.3, top = cy - h * 0.3, u = w / 8;
    ctx.beginPath();
    ctx.moveTo(x0, base);
    [[0, 1], [1, 0], [2, 1], [3, 1], [4, 0], [5, 1]].forEach(([i, on], k, a) => {
      const y = on ? top : base;
      ctx.lineTo(x0 + i * u * 1.33, y); ctx.lineTo(x0 + (i + 1) * u * 1.33, y);
    });
    ctx.stroke();
  },
  specpan: (ctx, cx, cy, w, h) => {   // bars of the spectrum leaning left and right of a centre line
    ctx.beginPath();
    [-0.3, 0.25, -0.15, 0.3, -0.25].forEach((d, i) => { const y = cy - h * 0.34 + i * h * 0.17; ctx.moveTo(cx, y); ctx.lineTo(cx + d * w, y); });
    ctx.moveTo(cx, cy - h * 0.4); ctx.lineTo(cx, cy + h * 0.4);
    ctx.stroke();
  },
  freqshift: (ctx, cx, cy, w, h) => {   // a row of harmonics, all moved along by the same step
    for (const [dy, dx] of [[-0.25, 0], [0.2, 0.18]]) {
      ctx.beginPath();
      for (let i = 0; i < 4; i++) { const x = cx - w * 0.42 + i * w * 0.2 + dx * w; ctx.moveTo(x, cy + h * (dy + 0.25)); ctx.lineTo(x, cy + h * (dy - 0.15 - i * 0.04)); }
      ctx.stroke();
    }
    ctx.beginPath(); ctx.moveTo(cx - w * 0.1, cy); ctx.lineTo(cx + w * 0.3, cy); ctx.stroke();
  },
  blur: (ctx, cx, cy, w, h) => {   // sharp spectral bars on the left, melting into a smooth hill on the right
    const base = cy + h * 0.4;
    ctx.beginPath();
    [0.8, 0.25, 0.65, 0.2].forEach((a, i) => { const x = cx - w / 2 + (i + 0.5) * (w * 0.5 / 4); ctx.moveTo(x, base); ctx.lineTo(x, base - a * h * 0.8); });
    ctx.stroke();
    curve(ctx, cx + w * 0.25, base - h * 0.28, w * 0.5, h * 0.56, t => Math.exp(-Math.pow((t - 0.5) / 0.28, 2)) * 0.9 - 0.45, 32);
  },
  multitap: (ctx, cx, cy, w, h) => {   // taps fanning left and right of a centre line
    line(ctx, [[cx - w / 2, cy], [cx + w / 2, cy]]);
    ctx.beginPath();
    [1, -0.8, 0.6, -0.45, 0.3].forEach((a, i) => {
      const x = cx - w / 2 + (i / 4) * w;
      ctx.moveTo(x, cy);
      ctx.lineTo(x, cy - (a * h) / 2);
    });
    ctx.stroke();
  },
  waveshaper: (ctx, cx, cy, w, h) => curve(ctx, cx, cy, w * 0.8, h, t => Math.tanh((t * 2 - 1) * 2.5)),
  exciter: (ctx, cx, cy, w, h) => {   // a high-pass slope with a few harmonics above it
    const x = f => cx - w / 2 + f * w, y = f => cy + h / 2 - f * h;
    line(ctx, [[x(0), y(0)], [x(0.4), y(0.2)], [x(0.6), y(0.55)], [x(1), y(0.55)]]);
    ctx.beginPath();
    [0.55, 0.75, 0.95].forEach((f, i) => { ctx.moveTo(x(f), y(0.75)); ctx.lineTo(x(f), y(0.95 - i * 0.12)); });
    ctx.stroke();
  },
  transient: (ctx, cx, cy, w, h) => {   // a spike that falls to a low tail
    const x = f => cx - w / 2 + f * w, y = f => cy + h / 2 - f * h;
    line(ctx, [[x(0), y(0.1)], [x(0.2), y(1)], [x(0.32), y(0.3)], [x(1), y(0.15)]]);
  },
  split: (ctx, cx, cy, w, h) => {   // one line fanning out to four
    ctx.beginPath();
    for (let i = 0; i < 4; i++) {
      ctx.moveTo(cx - w / 2, cy);
      ctx.lineTo(cx, cy);
      ctx.lineTo(cx + w / 2, cy - h / 2 + (i / 3) * h);
    }
    ctx.stroke();
  },
  compressor: (ctx, cx, cy, w, h) => {   // the transfer curve: straight, then flatter above the threshold
    const x = f => cx - w / 2 + f * w, y = f => cy + h / 2 - f * h;
    line(ctx, [[x(0), y(0)], [x(0.45), y(0.45)], [x(0.6), y(0.55)], [x(1), y(0.7)]]);
  },
  eq: (ctx, cx, cy, w, h) => curve(ctx, cx, cy, w, h, t => 0.55 * Math.exp(-Math.pow((t - 0.3) / 0.1, 2)) - 0.45 * Math.exp(-Math.pow((t - 0.72) / 0.12, 2)), 40),   // a boost and a cut
  crusher: (ctx, cx, cy, w, h) => { const pts = []; for (let i = 0; i < 8; i++) { const y = Math.round(Math.sin(i / 7 * Math.PI * 1.5 + 0.2) * 2.4) / 2.4 * 0.4; const x0 = cx - w / 2 + i / 8 * w, x1 = cx - w / 2 + (i + 1) / 8 * w; pts.push([x0, cy - y * h], [x1, cy - y * h]); } line(ctx, pts); },   // a stepped wave
  dcblock: (ctx, cx, cy, w, h) => {   // a wave riding above the centre line, then settling onto it
    ctx.save();
    ctx.setLineDash([2, 3]);
    line(ctx, [[cx - w / 2, cy], [cx + w / 2, cy]]);
    ctx.restore();
    curve(ctx, cx, cy, w, h, t => 0.2 * Math.sin(t * Math.PI * 5) + (t < 0.35 ? 0.28 : t < 0.65 ? 0.28 * (0.65 - t) / 0.3 : 0) - 0.04, 40);
  },
  ctrl: (ctx, cx, cy, w, h) => line(ctx, [[cx - w / 2, cy + h * 0.3], [cx - w * 0.1, cy + h * 0.3], [cx + w * 0.1, cy - h * 0.3], [cx + w / 2, cy - h * 0.3]]),   // a glide from one level to another
  gate: (ctx, cx, cy, w, h) => {   // a signal chopped into blocks
    const x = f => cx - w / 2 + f * w, y = f => cy + h / 2 - f * h;
    line(ctx, [[x(0), y(0.5)], [x(0.05), y(0.95)], [x(0.15), y(0.05)], [x(0.25), y(0.9)], [x(0.3), y(0.5)], [x(0.45), y(0.5)], [x(0.5), y(0.95)], [x(0.6), y(0.05)], [x(0.7), y(0.9)], [x(0.75), y(0.5)], [x(1), y(0.5)]]);
  },
  hall: (ctx, cx, cy, w, h) => {   // reflections thinning out under a decaying envelope
    ctx.beginPath();
    [1, 0.55, 0.7, 0.35, 0.45, 0.2, 0.28, 0.1, 0.14, 0.05].forEach((a, i) => {
      const x = cx - w / 2 + (i / 9) * w;
      ctx.moveTo(x, cy + h / 2);
      ctx.lineTo(x, cy + h / 2 - a * h);
    });
    ctx.stroke();
  },
  plate: (ctx, cx, cy, w, h) => {   // a thin sheet, shaking
    const x = f => cx - w / 2 + f * w, y = f => cy + h / 2 - f * h;
    line(ctx, [[x(0.1), y(0.15)], [x(0.9), y(0.15)], [x(0.9), y(0.85)], [x(0.1), y(0.85)], [x(0.1), y(0.15)]]);
    curve(ctx, cx, cy, w * 0.7, h * 0.5, t => Math.sin(t * Math.PI * 5) * Math.exp(-t * 1.2) * 0.9, 40);
  },
  shimmer: (ctx, cx, cy, w, h) => {   // sparkles rising
    const star = (sx, sy, r) => { line(ctx, [[sx - r, sy], [sx + r, sy]]); line(ctx, [[sx, sy - r], [sx, sy + r]]); };
    star(cx - w * 0.15, cy + h * 0.1, h * 0.36); star(cx + w * 0.28, cy - h * 0.22, h * 0.2); star(cx + w * 0.1, cy + h * 0.3, h * 0.12);
  },
  oberheim: (ctx, cx, cy, w, h) => {   // a notch swept across a pulse: the filter's lowpass, notch and highpass in one curve
    const x = f => cx - w / 2 + f * w, y = f => cy + h / 2 - f * h;
    line(ctx, [[x(0), y(0.35)], [x(0.12), y(0.35)], [x(0.12), y(0.8)], [x(0.3), y(0.8)], [x(0.3), y(0.35)], [x(0.42), y(0.35)], [x(0.42), y(0.8)], [x(0.6), y(0.8)], [x(0.6), y(0.35)], [x(1), y(0.35)]]);
    curve(ctx, cx, cy + h * 0.3, w, h * 0.3, t => 0.8 - 1.6 * Math.exp(-Math.pow((t - 0.5) / 0.14, 2)) , 40);
  },
  notetrig: (ctx, cx, cy, w, h) => {   // a note's block, and the spike it fires
    const x = f => cx - w / 2 + f * w, y = f => cy + h / 2 - f * h;
    line(ctx, [[x(0), y(0.08)], [x(0.15), y(0.08)], [x(0.15), y(0.45)], [x(0.7), y(0.45)], [x(0.7), y(0.08)], [x(1), y(0.08)]]);
    line(ctx, [[x(0.15), y(0.55)], [x(0.15), y(0.95)]]); line(ctx, [[x(0.1), y(0.85)], [x(0.15), y(0.95)], [x(0.2), y(0.85)]]);
  },
  subsynth: (ctx, cx, cy, w, h) => {   // a saw, the raw material the filter carves
    const x = f => cx - w / 2 + f * w, y = f => cy + h / 2 - f * h;
    line(ctx, [[x(0), y(0.1)], [x(0.3), y(0.95)], [x(0.3), y(0.1)], [x(0.6), y(0.95)], [x(0.6), y(0.1)], [x(1), y(0.95)]]);
  },
  fourpole: (ctx, cx, cy, w, h) => {   // two waves, a saw over a square, summed
    const x = f => cx - w / 2 + f * w, y = f => cy + h / 2 - f * h;
    line(ctx, [[x(0), y(0.55)], [x(0.3), y(0.95)], [x(0.3), y(0.55)], [x(0.6), y(0.95)], [x(0.6), y(0.55)], [x(1), y(0.95)]]);
    line(ctx, [[x(0), y(0.1)], [x(0), y(0.4)], [x(0.25), y(0.4)], [x(0.25), y(0.1)], [x(0.5), y(0.1)], [x(0.5), y(0.4)], [x(0.75), y(0.4)], [x(0.75), y(0.1)], [x(1), y(0.1)]]);
  },
  wavetable: (ctx, cx, cy, w, h) => { for (let r = 0; r < 4; r++) { const oy = cy + (r - 1.5) * h * 0.2; ctx.beginPath(); for (let i = 0; i <= 24; i++) { const t = i / 24, x = cx - w / 2 + t * w, y = oy - Math.sin(t * Math.PI * 2 * (1 + r * 0.5)) * h * 0.1; if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); } ctx.stroke(); } },   // a stack of waves
  granular: (ctx, cx, cy, w, h) => { for (let i = 0; i < 7; i++) { const x = cx + (i - 3) * w * 0.13, a = h * (0.16 + 0.1 * ((i * 5) % 4)); ctx.beginPath(); ctx.ellipse(x, cy + ((i * 3) % 3 - 1) * h * 0.12, w * 0.05, a, 0, 0, Math.PI * 2); ctx.stroke(); } },
  follower: (ctx, cx, cy, w, h) => { const env = t => (t < 0.3 ? t / 0.3 : Math.exp(-(t - 0.3) * 3)); for (let i = 0; i < 12; i++) { const t = i / 11, x = cx - w / 2 + t * w, a = env(t) * h * 0.45 * (i % 2 ? 0.55 : 1); line(ctx, [[x, cy - a], [x, cy + a]]); } curve(ctx, cx, cy - h * 0.45, w, h * 0.9, env, 40); },   // a burst under its outline
  tap: (ctx, cx, cy, w, h) => { line(ctx, [[cx - w / 2, cy - h * 0.15], [cx + w / 2, cy - h * 0.15]]); line(ctx, [[cx, cy - h * 0.15], [cx, cy + h * 0.35]]); ctx.beginPath(); ctx.arc(cx, cy + h * 0.38, h * 0.12, 0, 7); ctx.stroke(); },   // a line with a branch dropping off it to a dot
  bands: (ctx, cx, cy, w, h) => { for (let i = 0; i < 8; i++) { const x = cx - w / 2 + (i + 0.5) / 8 * w, a = h * (0.2 + 0.7 * Math.abs(Math.sin(i * 1.3 + 0.4))); line(ctx, [[x, cy + h / 2], [x, cy + h / 2 - a]]); } },   // a row of level bars: a vocoder's bands
  specsynth: (ctx, cx, cy, w, h) => { for (let i = 0; i < 9; i++) { const x = cx - w / 2 + (i + 0.5) / 9 * w, a = h * (0.12 + 0.75 * Math.abs(Math.sin(i * 1.7 + 0.6)) * Math.exp(-i * 0.18)); line(ctx, [[x, cy + h / 2], [x, cy + h / 2 - a]]); } },   // bars of a spectrum
  sidechain: (ctx, cx, cy, w, h) => { line(ctx, [[cx - w / 2, cy - h * 0.25], [cx + w * 0.1, cy - h * 0.25], [cx + w * 0.1, cy + h * 0.25], [cx + w / 2, cy + h * 0.25]]); line(ctx, [[cx + w * 0.3, cy + h * 0.12], [cx + w / 2, cy + h * 0.25], [cx + w * 0.3, cy + h * 0.38]]); },   // a signal from outside, coming in
  piano: (ctx, cx, cy, w, h) => {   // a few white keys with the black ones between them
    const x = f => cx - w / 2 + f * w, y = f => cy + h / 2 - f * h;
    line(ctx, [[x(0), y(0)], [x(0), y(1)]]); line(ctx, [[x(1), y(0)], [x(1), y(1)]]);
    for (let i = 1; i < 5; i++) line(ctx, [[x(i / 5), y(0)], [x(i / 5), y(1)]]);
    const lw = ctx.lineWidth; ctx.lineWidth = 3.5;
    for (const i of [1, 2, 4]) line(ctx, [[x(i / 5), y(1)], [x(i / 5), y(0.45)]]);   // the black keys
    ctx.lineWidth = lw;
  },
  modchan: (ctx, cx, cy, w, h) => {   // an 8-bit sample: a stepped wave
    const pts = [];
    for (let i = 0; i < 10; i++) {
      const y = Math.round(Math.sin(i / 9 * Math.PI * 2) * 3) / 3 * 0.42;
      const x0 = cx - w / 2 + i / 10 * w, x1 = cx - w / 2 + (i + 1) / 10 * w;
      pts.push([x0, cy - y * h], [x1, cy - y * h]);
    }
    line(ctx, pts);
  },
  hat808: (ctx, cx, cy, w, h) => {   // two bursts of noise: a short one and a longer, ringing one
    const x = f => cx - w / 2 + f * w, y = f => cy + h / 2 - f * h;
    const burst = (from, len, amp) => { const pts = []; for (let i = 0; i <= 14; i++) { const t = i / 14; pts.push([x(from + t * len), y(0.5 + (i % 2 ? 1 : -1) * amp * Math.exp(-t * (len > 0.3 ? 3 : 6)) * 0.5)]); } return pts; };
    line(ctx, burst(0.02, 0.2, 0.7));
    line(ctx, burst(0.32, 0.64, 0.9));
  },
  squelch: (ctx, cx, cy, w, h) => {   // a saw tooth rising through a resonant filter peak
    const x = f => cx - w / 2 + f * w, y = f => cy + h / 2 - f * h;
    const saw = []; for (let i = 0; i <= 3; i++) { saw.push([x(0.05 + i * 0.12), y(0.15)], [x(0.05 + i * 0.12 + 0.11), y(0.55)]); }
    line(ctx, saw);
    const curve = []; for (let i = 0; i <= 24; i++) { const t = i / 24; curve.push([x(0.5 + t * 0.45), y(0.78 - 0.45 * t * t + 0.28 * Math.exp(-Math.pow((t - 0.55) / 0.08, 2)))]); }
    line(ctx, curve);
  },
  noise: (ctx, cx, cy, w, h) => {   // a jagged random line
    const pts = []; let s = 7;
    for (let i = 0; i <= 28; i++) { s = (s * 9301 + 49297) % 233280; pts.push([cx - w / 2 + (i / 28) * w, cy + (s / 233280 - 0.5) * h * 0.85]); }
    line(ctx, pts);
  },
  combperc: (ctx, cx, cy, w, h) => {   // a comb of teeth over a falling ring
    const x = f => cx - w / 2 + f * w, y = f => cy + h / 2 - f * h;
    ctx.beginPath();
    for (let i = 0; i < 5; i++) { ctx.moveTo(x(0.1 + i * 0.2), y(0.5)); ctx.lineTo(x(0.1 + i * 0.2), y(0.95 - i * 0.08)); }
    ctx.moveTo(x(0.02), y(0.5)); ctx.lineTo(x(0.98), y(0.5));
    ctx.stroke();
    const pts = []; for (let i = 0; i <= 30; i++) { const t = i / 30; pts.push([x(0.02 + t * 0.96), y(0.22 + Math.sin(t * 30) * 0.2 * Math.pow(1 - t, 1.4))]); }
    line(ctx, pts);
  },
  string: (ctx, cx, cy, w, h) => curve(ctx, cx, cy, w, h, t => Math.sin(t * Math.PI * 7) * Math.pow(1 - t, 1.3) * 0.9, 56),   // a ringing, fading string
  dvii: (ctx, cx, cy, w, h) => {   // a stack of six small boxes joined by lines: operators in an algorithm
    const bw = w * 0.22, bh = h * 0.2, xs = [-0.3, 0.3];
    ctx.beginPath();
    for (const dx of xs) for (let r = 0; r < 3; r++) ctx.rect(cx + dx * w - bw / 2, cy - h * 0.45 + r * h * 0.32, bw, bh);
    for (const dx of xs) for (let r = 0; r < 2; r++) { ctx.moveTo(cx + dx * w, cy - h * 0.45 + r * h * 0.32 + bh); ctx.lineTo(cx + dx * w, cy - h * 0.45 + (r + 1) * h * 0.32); }
    ctx.stroke();
  },
  fmsynth: (ctx, cx, cy, w, h) => curve(ctx, cx, cy, w, h, t => Math.sin(t * Math.PI * 4 + 2.2 * Math.sin(t * Math.PI * 10)) * 0.85, 48),   // a sine bent by another
  addsynth: (ctx, cx, cy, w, h) => {   // a row of harmonics falling away
    ctx.beginPath();
    [1, 0.5, 0.33, 0.25, 0.2, 0.16, 0.14].forEach((a, i) => {
      const x = cx - w / 2 + (i / 6) * w;
      ctx.moveTo(x, cy + h / 2);
      ctx.lineTo(x, cy + h / 2 - a * h);
    });
    ctx.stroke();
  },
  voices: (ctx, cx, cy, w, h) => {   // several lines fanning in to one
    ctx.beginPath();
    for (let i = 0; i < 3; i++) {
      ctx.moveTo(cx - w / 2, cy - h / 2 + (i / 2) * h);
      ctx.lineTo(cx, cy);
    }
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + w / 2, cy);
    ctx.stroke();
  },
  speaker: (ctx, cx, cy, w, h) => {
    const s = Math.min(w, h) * 0.4;
    ctx.beginPath();
    ctx.moveTo(cx - s, cy - s * 0.4);
    ctx.lineTo(cx - s * 0.4, cy - s * 0.4);
    ctx.lineTo(cx + s * 0.3, cy - s);
    ctx.lineTo(cx + s * 0.3, cy + s);
    ctx.lineTo(cx - s * 0.4, cy + s * 0.4);
    ctx.lineTo(cx - s, cy + s * 0.4);
    ctx.closePath();
    ctx.stroke();
  },
};
