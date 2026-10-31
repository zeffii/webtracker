// The mixer: a strip under the arrangement for every lane that makes sound, as wide as the lane's own column. Each strip is a proxy
// for the Out node of the lane's instrument: its fader is that node's gain, its "mix" button is that node's master switch, and M and S
// are the lane's silence and solo. The level of the instrument is drawn inside the fader's track.
//
// "test" turns the fader into a test gain: moving it changes only what is heard (the running engine), not the Out node, so a level
// can be tried without touching the instrument. A tick on the track marks the real gain; turning test off puts the real gain back.
// Test gains are never saved, and are dropped when the project is loaded again.
const GAIN_MAX = 1.5, GAIN_DEFAULT = 0.8;

const dbText = g => (g < 0.001 ? '-inf' : `${(20 * Math.log10(g)).toFixed(1)}`);

export function createMixer({ el, seq, lanes, widths, chars, instruments, setParam, hear, solo, silence, cursorLane = () => -1 }) {
  let strips = [];   // the strips on show: { li, inst, nodeId, show(), meter }
  const testing = new Map();   // instrument -> the test gain it is heard at while "test" is on
  const held = new Map();   // instrument -> the level drawn (it falls back between readings)

  // The Out node of an instrument: where the gain and the master switch live. Null for an instrument without one.
  const outOf = id => instruments()[id]?.graph?.nodes?.find(n => n.type === 'out') ?? null;
  const gainOf = node => node.params?.gain ?? GAIN_DEFAULT;
  const mixOf = node => (node.params?.master ?? 1) >= 0.5;

  function button(text, title, onClick) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'mx-btn'; b.textContent = text; b.title = title;
    b.addEventListener('click', onClick);
    return b;
  }

  // A vertical fader: drag, or click anywhere on its track; double-click puts the gain back to its default.
  function makeFader(strip, node) {
    const track = document.createElement('div'), meter = document.createElement('s'), mark = document.createElement('u'), cap = document.createElement('b');
    track.className = 'mx-track'; track.append(meter, mark, cap);
    const pos = g => `${Math.max(0, Math.min(1, g / GAIN_MAX)) * 100}%`;
    const show = () => {
      const test = testing.has(strip.inst), g = test ? testing.get(strip.inst) : gainOf(node);
      cap.style.bottom = pos(g); mark.style.bottom = pos(gainOf(node)); mark.hidden = !test;
      track.classList.toggle('test', test);
      strip.readout.textContent = `${test ? 'test ' : ''}${dbText(g)} dB`;
    };
    const put = g => {
      if (testing.has(strip.inst)) { testing.set(strip.inst, g); hear(strip.inst, node.id, 'gain', g); }
      else setParam(strip.inst, node.id, 'gain', g);
      for (const s of strips) if (s.inst === strip.inst) s.show();
    };
    const at = e => { const r = track.getBoundingClientRect(); return Math.round(Math.max(0, Math.min(1, (r.bottom - e.clientY) / r.height)) * GAIN_MAX * 100) / 100; };
    track.addEventListener('pointerdown', e => {
      track.setPointerCapture(e.pointerId); put(at(e));
      const move = ev => put(at(ev)), up = () => { track.removeEventListener('pointermove', move); track.removeEventListener('pointerup', up); };
      track.addEventListener('pointermove', move); track.addEventListener('pointerup', up);
    });
    track.addEventListener('dblclick', () => put(testing.has(strip.inst) ? gainOf(node) : GAIN_DEFAULT));
    strip.show = show; strip.meter = meter;
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
    sync();
    const gutter = document.createElement('div'); gutter.className = 'mx-gutter'; el.append(gutter);
    const all = lanes(), w = widths();
    all.forEach((lane, li) => {
      const box = document.createElement('div');
      box.className = 'mx-strip'; box.dataset.lane = li; box.style.setProperty('--n', String(w[li] ?? chars));
      if (lane.instrument === 'master') { box.classList.add('blank'); el.append(box); return; }
      const node = outOf(lane.instrument);
      const name = document.createElement('div'), readout = document.createElement('div');
      name.className = 'mx-name'; name.textContent = lane.id; name.title = `${lane.id} plays ${lane.instrument}`;
      readout.className = 'mx-db';
      if (!node) { box.classList.add('nooutput'); name.title += ': no Out node'; readout.textContent = 'no out'; box.append(name, readout); el.append(box); return; }
      const strip = { li, inst: lane.instrument, readout }, fader = makeFader(strip, node);
      const mute = button('M', 'Silence this lane (Alt+M)', () => { silence(li); refresh(); });
      const solob = button('S', 'Solo this lane (Alt+S)', () => { solo(li); refresh(); });
      const test = button('test', 'Test gain: on, the fader changes only what you hear, not the Out node\'s gain (a tick marks the real gain); off, the fader is the gain.', () => toggleTest(lane.instrument, node));
      const mix = button('mix', 'On: the instrument is in the mix. Off: only sidechain nodes hear it (the Out node\'s master switch).', () => { setParam(lane.instrument, node.id, 'master', mixOf(node) ? 0 : 1); refresh(); });
      mute.classList.toggle('on', !!lane.silenced); solob.classList.toggle('on', !!lane.solo); mix.classList.toggle('on', mixOf(node)); test.classList.toggle('on', testing.has(lane.instrument));
      const side = document.createElement('div'); side.className = 'mx-side'; side.append(readout, mute, solob, test, mix);
      const row = document.createElement('div'); row.className = 'mx-row'; row.append(fader, side);
      box.append(name, row); el.append(box); strips.push(strip);
      strip.show();
    });
    cursor();
  }

  // The strips are laid out with the arrangement's own column size: the sequence view keeps it in --cw (a lane's width) and --gw (the tick column).
  function sync() {
    for (const k of ['--cw', '--gw']) { const v = seq.style.getPropertyValue(k); if (v) el.style.setProperty(k, v); }
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
      s.meter.style.height = `${Math.min(1, now / GAIN_MAX) * 100}%`;
      s.meter.classList.toggle('hot', now > 1);
    }
  }

  // The engine's levels are only worth sending while the strips are on screen.
  new MutationObserver(sync).observe(seq, { attributes: true, attributeFilter: ['style'] });

  return { refresh, cursor, levels, sync, drop: () => testing.clear() };
}
