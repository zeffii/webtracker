// Frame-time overlay (Ctrl+Alt+F). Shows where each animation frame goes, so a sluggish screen can be pinned on one part.
//
// The main loop wraps each piece of its work in perf.time('name', fn). While the overlay is off that costs one
// boolean test. While it is on, every piece is timed, and the panel shows over the last two seconds:
//   fps and the frame gap (average, worst), the long tasks the browser reported (work that blocked input for 50 ms+),
//   and each section's average and worst milliseconds, biggest first.
// "Copy" puts the same numbers on the clipboard as text, to paste back when something is slow.

const WINDOW_MS = 2000;

export function createPerfMeter() {
  let on = false;
  let el = null, graph = null, text = null;
  const gaps = [];              // [time, ms between frames]
  const longTasks = [];         // [time, ms]
  const sections = new Map();   // name -> [[time, ms], ...]
  let lastFrame = 0, lastPaint = 0, observer = null;

  function build() {
    el = document.createElement('div');
    el.id = 'perfmeter';
    el.innerHTML = '<canvas width="240" height="40"></canvas><pre></pre><button type="button">copy</button>';
    document.body.appendChild(el);
    graph = el.querySelector('canvas');
    text = el.querySelector('pre');
    el.querySelector('button').addEventListener('click', () => navigator.clipboard?.writeText(text.textContent));
  }

  function trim(list, now) { while (list.length && now - list[0][0] > WINDOW_MS) list.shift(); }
  function stats(list) {
    let sum = 0, worst = 0;
    for (const [, ms] of list) { sum += ms; if (ms > worst) worst = ms; }
    return { avg: list.length ? sum / list.length : 0, worst, n: list.length };
  }

  function paintGraph(now) {
    const g = graph.getContext('2d'), w = graph.width, h = graph.height;
    g.clearRect(0, 0, w, h);
    const css = getComputedStyle(el);
    g.strokeStyle = css.color; g.globalAlpha = 0.25;
    g.beginPath(); g.moveTo(0, h - h * 16.7 / 50); g.lineTo(w, h - h * 16.7 / 50); g.stroke();   // 60 fps line
    g.globalAlpha = 1;
    const x = t => w - (now - t) / WINDOW_MS * w;
    g.beginPath();
    for (const [t, ms] of gaps) { const y = h - Math.min(ms, 50) / 50 * h; if (t === gaps[0][0]) g.moveTo(x(t), y); else g.lineTo(x(t), y); }
    g.stroke();
  }

  function report(now) {
    const gap = stats(gaps), lt = stats(longTasks);
    const lines = [
      `${(gap.n / (WINDOW_MS / 1000)).toFixed(0)} fps   frame gap avg ${gap.avg.toFixed(1)}  worst ${gap.worst.toFixed(1)} ms`,
      `long tasks ${lt.n}   worst ${lt.worst.toFixed(0)} ms`,
      '',
    ];
    const rows = [...sections].filter(([, list]) => list.length).map(([name, list]) => ({ name, ...stats(list) })).sort((a, b) => b.avg - a.avg);
    for (const r of rows) lines.push(`${r.name.padEnd(12)} ${r.avg.toFixed(2).padStart(6)}  worst ${r.worst.toFixed(1).padStart(5)}`);
    return lines.join('\n');
  }

  return {
    get on() { return on; },
    toggle() {
      on = !on;
      if (on && !el) build();
      if (el) el.hidden = !on;
      if (on) {
        gaps.length = longTasks.length = 0; sections.clear(); lastFrame = 0;
        try {
          observer = new PerformanceObserver(list => { for (const e of list.getEntries()) longTasks.push([performance.now(), e.duration]); });
          observer.observe({ entryTypes: ['longtask'] });
        } catch { observer = null; }   // not every browser reports long tasks
      } else { observer?.disconnect(); observer = null; }
      return on;
    },
    // Time one piece of the frame. Off: just run it.
    time(name, fn) {
      if (!on) return fn();
      const t0 = performance.now();
      try { return fn(); } finally {
        let list = sections.get(name);
        if (!list) sections.set(name, list = []);
        list.push([t0, performance.now() - t0]);
      }
    },
    // Called once at the top of every frame.
    frame(now) {
      if (!on) return;
      if (lastFrame) gaps.push([now, now - lastFrame]);
      lastFrame = now;
      trim(gaps, now); trim(longTasks, now);
      for (const list of sections.values()) trim(list, now);
      if (now - lastPaint < 250) return;   // repaint the panel four times a second, not every frame
      lastPaint = now;
      text.textContent = report(now);
      paintGraph(now);
    },
  };
}
