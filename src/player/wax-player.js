// <wax-player src="song.wax" art="cover.png" title="Name"></wax-player>
// A song from a .wax file, played by the real engine, with no tracker around it: a square of artwork, a play button, a
// progress line you can click to seek, the title and the length. Any number of them can be on a page; they share one engine
// and only one plays at a time (starting one stops the others). Attributes: src (the .wax file), art (a square picture),
// title, by (a second line), loop (play for ever instead of stopping at the end).
// Events (bubbling): wax-play, wax-pause, wax-ended, wax-error.
// The page must be cross-origin isolated (the engine shares memory with the audio thread): player.html shows how.
import { Engine } from '../audio/engine.js';
import { parseProject } from '../project/file.js';
import { ensureMaster } from '../instruments.js';
import { prepareSong } from '../seq/lane.js';
import { ensurePool, slotsOf, sampleMessage, syncSamplerStereo } from '../project/ops.js';

let engine = null, starting = null, current = null;

async function getEngine() {
  if (engine) return engine;
  starting ??= (async () => { const e = new Engine(); await e.start(); engine = e; return e; })();
  try { return await starting; } catch (err) { starting = null; throw err; }
}

// What the page's own openProject does, without the screens.
function open(e, { song, instruments, samples }) {
  e.reset();
  ensurePool(samples, e.ctx.sampleRate);
  for (const [id, def] of Object.entries(instruments)) {
    syncSamplerStereo(def, samples);
    e.loadInstrument(id, def.graph);
    for (const node of Object.keys(def.samples ?? {})) slotsOf(def.samples[node]).forEach((sampleId, slot) => { if (samples[sampleId]) e.sendToNode(id, node, sampleMessage(samples[sampleId], slot)); });
  }
  const lanes = prepareSong(song, instruments, e.registry);
  e.setSong(song);
  for (const { id, instrument, columns, pages, mask, auto } of lanes) e.setLane({ id, instrument, columns, pages, mask, auto });
}

const clock = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

const STYLE = `
:host { display: block; max-width: 400px; font: 13px/1.4 ui-monospace, Consolas, monospace; color: var(--wax-fg, #2a2f36); }
.art { position: relative; aspect-ratio: 1; background: var(--wax-art-bg, linear-gradient(145deg, #7aa7b2, #3b4b5c)); overflow: hidden; cursor: pointer; box-shadow: 0 10px 30px #2a3a4a30; }
.art img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; display: block; transition: transform .6s, filter .3s; }
:host([playing]) .art img { transform: scale(1.03); }
button.play { position: absolute; left: 12px; bottom: 16px; font: inherit; letter-spacing: .06em; color: var(--wax-pill-fg, #4a666e); background: var(--wax-pill, #f4f1ea); border: 1px solid #5d7b8340; border-radius: .6em; padding: .55em 1.1em; cursor: pointer; box-shadow: 0 1px 10px #2a6f7a30; }
button.play:hover, .art:hover button.play { background: #fff; }
button.play:focus-visible { outline: 2px solid #3b8fa0; outline-offset: 2px; }
.bar { position: absolute; left: 0; right: 0; bottom: 0; height: 6px; background: #ffffff30; }
.bar i { position: absolute; left: 0; top: 0; bottom: 0; width: 0; background: var(--wax-pill, #f4f1ea); }
.cap { display: flex; justify-content: space-between; gap: 1em; padding: .7em .1em 0; }
.cap b { font-weight: 600; letter-spacing: .03em; }
.cap span { opacity: .65; white-space: nowrap; }
.by { opacity: .65; padding: 0 .1em; }
.err { color: #a33; padding: .5em .1em; }
`;

export class WaxPlayer extends HTMLElement {
  static observedAttributes = ['src', 'art', 'title', 'by'];
  project = null; state = 'idle'; resumeAt = 0; last = 0; raf = 0;

  constructor() {
    super();
    const root = this.attachShadow({ mode: 'open' });
    root.innerHTML = `<style>${STYLE}</style>
      <div class="art" part="art"><img alt="" crossorigin="anonymous"><button class="play" type="button">play</button><div class="bar"><i></i></div></div>
      <div class="cap"><b></b><span></span></div><div class="by"></div><div class="err" hidden></div>`;
    const $ = s => root.querySelector(s);
    Object.assign(this, { img: $('img'), btn: $('.play'), art_: $('.art'), bar: $('.bar'), fill: $('.bar i'), titleEl: $('.cap b'), meta: $('.cap span'), byEl: $('.by'), errEl: $('.err') });
    this.img.addEventListener('error', () => { this.img.hidden = true; });
    this.btn.addEventListener('click', e => { e.stopPropagation(); this.toggle(); });
    this.art_.addEventListener('click', e => { if (e.target === this.bar || this.bar.contains(e.target)) this.seek(e); else this.toggle(); });
  }

  connectedCallback() { this.paint(); this.peek(); }
  disconnectedCallback() { if (current === this) this.pause(); cancelAnimationFrame(this.raf); }
  attributeChangedCallback(name) { if (this.isConnected) { this.paint(); if (name === 'src') { this.project = null; this.peek(); } } }

  paint() {
    const art = this.getAttribute('art');
    if (art && this.img.getAttribute('src') !== art) { this.img.hidden = false; this.img.src = art; } else if (!art) this.img.hidden = true;
    this.titleEl.textContent = this.getAttribute('title') ?? (this.getAttribute('src') ?? '').split('/').pop().replace(/\.wax$/i, '');
    this.byEl.textContent = this.getAttribute('by') ?? '';
    this.byEl.hidden = !this.getAttribute('by');
    this.btn.textContent = this.state === 'loading' ? 'loading…' : this.state === 'playing' ? 'pause' : 'play';
    this.toggleAttribute('playing', this.state === 'playing');
  }

  fail(err) { this.errEl.textContent = err.message ?? String(err); this.errEl.hidden = false; this.state = 'idle'; this.paint(); this.dispatchEvent(new CustomEvent('wax-error', { bubbles: true, detail: err })); }

  // The file, read and parsed (once): its length and tempo are shown before anything plays.
  async peek() {
    if (this.project) return this.project;
    const src = this.getAttribute('src');
    if (!src) return null;
    try {
      const res = await fetch(src);
      if (!res.ok) throw new Error(`${src}: ${res.status}`);
      const project = parseProject(await res.text());
      ensureMaster(project);
      this.project = project;
      const { bpm, ticksPerBeat, length } = project.song;
      this.seconds = length * 60 / bpm / ticksPerBeat;
      this.meta.textContent = `${clock(this.seconds)} · ${Math.round(bpm)} bpm`;
      return project;
    } catch (err) { this.fail(err); return null; }
  }

  toggle() { if (this.state === 'playing') this.pause(); else this.play(); }

  async play(from = null) {
    if (this.state === 'loading') return;
    this.errEl.hidden = true;
    const wasCurrent = current === this;
    if (current && !wasCurrent) current.halt();
    this.state = 'loading'; this.paint();
    try {
      const project = await this.peek();
      if (!project) return;
      const e = await getEngine();
      if (!wasCurrent || from === null && this.resumeAt === 0) {
        e.stop();
        open(e, { ...project, song: { ...project.song, loop: this.hasAttribute('loop') ? project.song.loop : { off: true } } });
      }
      current = this;
      this.state = 'playing'; this.paint();
      e.play(from ?? (this.resumeAt || 0));
      this.last = from ?? this.resumeAt ?? 0;
      this.dispatchEvent(new CustomEvent('wax-play', { bubbles: true }));
      this.watch();
    } catch (err) { this.fail(err); }
  }

  pause() {
    if (current !== this || this.state !== 'playing') return;
    this.resumeAt = engine.tick;
    engine.stop();
    this.state = 'idle'; this.paint(); cancelAnimationFrame(this.raf);
    this.dispatchEvent(new CustomEvent('wax-pause', { bubbles: true }));
  }

  // Another player took over: back to the start, quietly.
  halt() { cancelAnimationFrame(this.raf); this.state = 'idle'; this.resumeAt = 0; this.fill.style.width = '0'; this.paint(); }

  seek(ev) {
    if (!this.project) return;
    const r = this.bar.getBoundingClientRect(), x = Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width));
    this.resumeAt = Math.floor(x * this.project.song.length);
    this.fill.style.width = `${x * 100}%`;
    if (this.state === 'playing') { engine.stop(); this.play(this.resumeAt); }
  }

  watch() {
    cancelAnimationFrame(this.raf);
    const step = () => {
      if (current !== this || this.state !== 'playing') return;
      const tick = engine.tick, length = this.project.song.length;
      if (tick < this.last - 8 && !this.hasAttribute('loop')) {   // the song has come round again: it has ended
        engine.stop(); this.state = 'idle'; this.resumeAt = 0; this.fill.style.width = '0'; this.paint();
        this.dispatchEvent(new CustomEvent('wax-ended', { bubbles: true }));
        return;
      }
      this.last = tick;
      this.fill.style.width = `${Math.min(100, tick / length * 100)}%`;
      this.raf = requestAnimationFrame(step);
    };
    this.raf = requestAnimationFrame(step);
  }
}

if (!customElements.get('wax-player')) customElements.define('wax-player', WaxPlayer);
