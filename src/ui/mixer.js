// The mixer: a strip for every lane that makes sound, side by side in the mixer dock (see mixerdock.js), each a fixed width. Each strip is a proxy
// for the Out node of the lane's instrument: its fader is that node's gain, its "mix" button is that node's master switch, and M and S
// are the lane's silence and solo. The level of the instrument is drawn inside the fader's track.
//
// "test" turns the fader into a test gain: moving it changes only what is heard (the running engine), not the Out node, so a level
// can be tried without touching the instrument. A tick on the track marks the real gain; turning test off puts the real gain back.
// Test gains are never saved, and are dropped when the project is loaded again.
import { dragSlider } from './kit/slider.js';

const GAIN_DEFAULT = 0.8;
// The fader and the level share one scale in dB: DB_MIN at the bottom, DB_MAX at the top (nothing at all is the very bottom).
const DB_MIN = -30, DB_MAX = 6;
const MAJOR_DB = [6, 0, -6, -12, -24], MINOR_DB = [3, -3, -9, -18];   // numbered marks, and the short ones between
const posOfGain = g => (g < 0.0316 ? 0 : Math.max(0, Math.min(1, (20 * Math.log10(g) - DB_MIN) / (DB_MAX - DB_MIN))));   // 0 to 1 up the track
const gainAtPos = p => (p < 0.01 ? 0 : 10 ** ((DB_MIN + p * (DB_MAX - DB_MIN)) / 20));
const posOfDb = db => (db - DB_MIN) / (DB_MAX - DB_MIN);
const percent = p => `${p * 100}%`;

// The carve block: its three settings and on switch are parameters of the master lane's tempo node ('m').
const CARVE = { carve: 0, cvamt: 0.5, cvdepth: 6, cvfocus: 0.6 };
const FOCUS_NAMES = f => { const bpo = 1 + 5 * f; return bpo < 1.25 ? '1 oct' : `1/${Math.round(bpo)} oct`; };
const dbText = g => (g < 0.001 ? '-inf' : `${(20 * Math.log10(g)).toFixed(1)}`);

export function createMixer({ el, lanes, instruments, setParam, hear, solo, silence, cursorLane = () => -1 }) {
  let strips = [];   // the strips on show: { li, inst, nodeId, show(), meter }
  const testing = new Map();   // instrument -> the test gain it is heard at while "test" is on
  const held = new Map();   // instrument -> the level drawn (it falls back between readings)

  // The Out node of an instrument: where the gain and the master switch live. Null for an instrument without one.
  const outOf = id => instruments()[id]?.graph?.nodes?.find(n => n.type === 'out') ?? null;
  const gainOf = node => node.params?.gain ?? GAIN_DEFAULT;
  const leadOf = node => (node.params?.lead ?? 0) >= 0.5;
  const mixOf = node => (node.params?.master ?? 1) >= 0.5;

  function button(text, title, onClick) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'mx-btn'; b.textContent = text; b.title = title;
    b.tabIndex = -1;   // the mixer is for the mouse: the keyboard stays with the arrangement
    b.addEventListener('mousedown', e => e.preventDefault());   // a click does not take the focus away from the arrangement
    b.addEventListener('click', onClick);
    return b;
  }

  // The marks of the scale as empty elements placed up their parent: short ones for the in-between values, a longer one for the numbered.
  function tickMarks(tag, className = 'tk') {
    return [...MAJOR_DB, ...MINOR_DB].map(db => {
      const mark = document.createElement(tag);
      mark.className = `${className}${MAJOR_DB.includes(db) ? ' major' : ''}${db === 0 ? ' zero' : ''}`; mark.style.bottom = percent(posOfDb(db));
      return mark;
    });
  }

  // The carve block at the left of the mixer: a title with an on/off switch, and bars for amount, depth and focus.
  function makeCarve() {
    const m = instruments().master?.graph?.nodes?.find(n => n.id === 'm');
    if (!m) return null;
    const val = k => m.params?.[k] ?? CARVE[k];
    const box = document.createElement('div'), head = document.createElement('div'), note = document.createElement('div');
    box.className = 'mx-carve'; head.className = 'mx-carve-head'; head.textContent = 'CARVE';
    const on = val('carve') >= 0.5;
    box.classList.toggle('off', !on);
    const sw = button(on ? 'on' : 'off', 'Spectral carve: where lanes overlap in a band, the loudest keeps its level and the quieter ones dip. For mastering: it adds about 85 ms of delay while on.', () => { setParam('master', 'm', 'carve', on ? 0 : 1); refresh(); });
    sw.classList.toggle('on', on); head.append(sw); box.append(head);
    const bar = (label, key, title, lo, hi, text) => {
      const row = document.createElement('div'), name = document.createElement('i'), track = document.createElement('div'), t = document.createElement('span');
      row.className = 'mx-carve-row'; row.title = title; name.textContent = label; track.className = 'mx-carve-bar'; track.append(t);
      const norm = () => (val(key) - lo) / (hi - lo), draw = () => { track.style.setProperty('--p', `${norm() * 100}%`); t.textContent = text(val(key)); };
      draw();
      dragSlider(track, { axis: 'x', onChange: p => { setParam('master', 'm', key, Math.round((lo + p * (hi - lo)) * 100) / 100); draw(); }, onReset: () => { setParam('master', 'm', key, CARVE[key]); draw(); } });
      row.append(name, track); box.append(row);
    };
    bar('Amt', 'cvamt', 'How strongly quieter lanes give way in a band where another lane is louder (0 does nothing). Double-click resets.', 0, 1, v => `${Math.round(v * 100)}%`);
    bar('Depth', 'cvdepth', 'The most any lane is dipped in a band, in dB.', 0, 15, v => `${Math.round(v)} dB`);
    bar('Focus', 'cvfocus', 'How narrow the bands are: from an octave to a sixth of one.', 0, 1, FOCUS_NAMES);
    note.className = 'mx-carve-note'; note.textContent = on ? '+85 ms delay' : 'off: no delay'; box.append(note);
    return box;
  }

  // The scale down the left of the mixer: the numbered values, level with the marks on every strip.
  function makeScale() {
    const box = document.createElement('div'), name = document.createElement('div'), row = document.createElement('div'), labels = document.createElement('div');
    box.className = 'mx-strip mx-scale'; name.className = 'mx-name'; name.textContent = '\u00a0'; row.className = 'mx-row'; labels.className = 'mx-labels';
    for (const db of MAJOR_DB) {
      const label = document.createElement('span');
      label.textContent = db > 0 ? `+${db}` : `${db}`; label.style.bottom = percent(posOfDb(db)); labels.append(label);
    }
    row.append(labels); box.append(name, row);
    return box;
  }

  // A vertical fader: drag, or click anywhere on its track; double-click puts the gain back to its default.
  function makeFader(strip, node) {
    const track = document.createElement('div'), meter = document.createElement('s'), mark = document.createElement('u'), cap = document.createElement('b');
    track.className = 'mx-track'; track.append(meter, mark, cap, ...tickMarks('i'));
    const pos = g => percent(posOfGain(g));
    const show = () => {
      const test = testing.has(strip.inst), g = test ? testing.get(strip.inst) : gainOf(node);
      cap.style.bottom = pos(g); mark.style.bottom = pos(gainOf(node)); mark.hidden = !test;
      track.classList.toggle('test', test);
      strip.readout.textContent = dbText(g);   // dB; the test button shows when it is a test gain
      strip.readout.title = `${test ? 'Test gain' : 'Gain'} ${dbText(g)} dB`;
    };
    const put = g => {
      if (testing.has(strip.inst)) { testing.set(strip.inst, g); hear(strip.inst, node.id, 'gain', g); }
      else setParam(strip.inst, node.id, 'gain', g);
      for (const s of strips) if (s.inst === strip.inst) s.show();
    };
    dragSlider(track, {
      axis: 'y',
      onChange: p => put(Math.round(gainAtPos(p) * 100) / 100),
      onReset: () => put(testing.has(strip.inst) ? gainOf(node) : GAIN_DEFAULT),
    });
    strip.show = show; strip.meter = meter; strip.track = track;
    return track;
  }

  // Test on: the fader starts at the real gain and from then on only the engine hears it. Test off: the engine gets the real gain back.
  function toggleTest(inst, node) {
    if (testing.has(inst)) { testing.delete(inst); hear(inst, node.id, 'gain', gainOf(node)); }
    else testing.set(inst, gainOf(node));
    refresh();
  }

  function refresh() {
    el.replaceChildren(); strips = [];
    const carve = makeCarve(); if (carve) el.append(carve);
    el.append(makeScale());
    const all = lanes();
    all.forEach((lane, li) => {
      const box = document.createElement('div');
      box.className = 'mx-strip'; box.dataset.lane = li;
      if (lane.instrument === 'master') { box.classList.add('blank'); el.append(box); return; }
      const node = outOf(lane.instrument);
      const name = document.createElement('div'), readout = document.createElement('div');
      name.className = 'mx-name'; name.textContent = lane.id; name.title = `${lane.id} plays ${lane.instrument}`;
      readout.className = 'mx-db';
      if (!node) { box.classList.add('nooutput'); name.title += ': no Out node'; readout.textContent = 'no out'; box.append(name, readout); el.append(box); return; }
      const strip = { li, inst: lane.instrument, readout, node }, fader = makeFader(strip, node);
      const mute = button('M', 'Silence this lane (Alt+M)', () => { silence(li); refresh(); });
      const solob = button('S', 'Solo this lane (Alt+S)', () => { solo(li); refresh(); });
      const test = button('test', 'Test gain: on, the fader changes only what you hear, not the Out node\'s gain (a tick marks the real gain); off, the fader is the gain.', () => toggleTest(lane.instrument, node));
      const mix = button('mix', 'On: the instrument is in the mix. Off: only sidechain nodes hear it (the Out node\'s master switch).', () => { setParam(lane.instrument, node.id, 'master', mixOf(node) ? 0 : 1); refresh(); });
      mute.classList.toggle('on', !!lane.silenced); solob.classList.toggle('on', !!lane.solo); mix.classList.toggle('on', mixOf(node)); test.classList.toggle('on', testing.has(lane.instrument));
      const lead = button('lead', 'Lead: the carve stage never dips this lane, the other lanes give way to it.', () => { setParam(lane.instrument, node.id, 'lead', leadOf(node) ? 0 : 1); refresh(); });
      lead.classList.toggle('lead', leadOf(node)); lead.classList.toggle('on', leadOf(node));
      const side = document.createElement('div'); side.className = 'mx-side'; side.append(readout, mute, solob, test, lead, mix);
      const row = document.createElement('div'); row.className = 'mx-row'; row.append(...tickMarks('hr', 'grid'), fader, side);
      box.append(name, row); el.append(box); strips.push(strip);
      strip.show();
    });
    cursor();
  }

  // The strip of the lane the cursor is on gets a rule above it.
  function cursor() {
    const here = cursorLane();
    for (const box of el.children) box.classList.toggle('cur', Number(box.dataset.lane) === here);
  }

  // Readings from the audio thread: the loudest sample of each instrument since the last one. The drawn level rises at once and falls away.
  function levels(peaks) {
    for (const s of strips) {
      const was = held.get(s.inst) ?? 0, now = Math.max(peaks[s.inst] ?? 0, was * 0.82);
      held.set(s.inst, now);
      s.meter.style.clipPath = `inset(${100 - posOfGain(now) * 100}% 0 0 0)`;   // the colours are fixed to the scale: the meter uncovers them
      s.track.classList.toggle('clip', now >= 1 && mixOf(s.node));   // at 0 dB or over, a red dot above the track
      s.track.classList.toggle('nomix', !mixOf(s.node));   // not in the mix: the meter is grey, the sound does not reach the output
    }
  }

  el.addEventListener('mousedown', e => e.preventDefault());   // nothing in the mixer takes the focus: the arrangement keeps it

  return { refresh, cursor, levels, drop: () => testing.clear() };
}
