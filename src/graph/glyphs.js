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
  hall: (ctx, cx, cy, w, h) => {   // reflections thinning out under a decaying envelope
    ctx.beginPath();
    [1, 0.55, 0.7, 0.35, 0.45, 0.2, 0.28, 0.1, 0.14, 0.05].forEach((a, i) => {
      const x = cx - w / 2 + (i / 9) * w;
      ctx.moveTo(x, cy + h / 2);
      ctx.lineTo(x, cy + h / 2 - a * h);
    });
    ctx.stroke();
  },
  subsynth: (ctx, cx, cy, w, h) => {   // a saw, the raw material the filter carves
    const x = f => cx - w / 2 + f * w, y = f => cy + h / 2 - f * h;
    line(ctx, [[x(0), y(0.1)], [x(0.3), y(0.95)], [x(0.3), y(0.1)], [x(0.6), y(0.95)], [x(0.6), y(0.1)], [x(1), y(0.95)]]);
  },
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
