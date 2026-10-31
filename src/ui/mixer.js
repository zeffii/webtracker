// The mixer: a strip under the arrangement for every lane that makes sound. Each strip is a proxy for the Out node of the lane's
// instrument: its fader is that node's gain, its "mix" button is that node's master switch, and M and S are the lane's silence and
// solo. Move a fader here and the slider in the instrument's graph moves with it (they are one value), and the other way round
// once the strips are refreshed. Lanes that share an instrument show the same gain.
const GAIN_MAX = 1.5, GAIN_DEFAULT = 0.8;

const dbText = g => (g < 0.001 ? '-inf' : `${(20 * Math.log10(g)).toFixed(1)}`);

export function createMixer({ el, lanes, instruments, setParam, solo, silence, cursorLane = () => -1 }) {
  let strips = [];   // { li, inst, nodeId, fader, readout, ... } of the strips on show

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
  function makeFader(strip) {
    const track = document.createElement('div'), fill = document.createElement('i'), cap = document.createElement('b');
    track.className = 'mx-track'; track.append(fill, cap);
    const show = g => { const f = Math.max(0, Math.min(1, g / GAIN_MAX)) * 100; fill.style.height = `${f}%`; cap.style.bottom = `${f}%`; strip.readout.textContent = `${dbText(g)} dB`; };
    const put = g => { setParam(strip.inst, strip.nodeId, 'gain', g); for (const s of strips) if (s.inst === strip.inst) s.show(g); };
    const at = e => { const r = track.getBoundingClientRect(); return Math.round(Math.max(0, Math.min(1, (r.bottom - e.clientY) / r.height)) * GAIN_MAX * 100) / 100; };
    track.addEventListener('pointerdown', e => {
      track.setPointerCapture(e.pointerId); put(at(e));
      const move = ev => put(at(ev)), up = () => { track.removeEventListener('pointermove', move); track.removeEventListener('pointerup', up); };
      track.addEventListener('pointermove', move); track.addEventListener('pointerup', up);
    });
    track.addEventListener('dblclick', () => put(GAIN_DEFAULT));
    strip.show = show;
    return track;
  }

  function refresh() {
    el.replaceChildren(); strips = [];
    const all = lanes();
    all.forEach((lane, li) => {
      if (lane.instrument === 'master') return;
      const node = outOf(lane.instrument);
      const box = document.createElement('div'), name = document.createElement('div'), readout = document.createElement('div');
      box.className = 'mx-strip'; box.dataset.lane = li;
      name.className = 'mx-name'; name.textContent = lane.id; name.title = `${lane.id} plays ${lane.instrument}`;
      readout.className = 'mx-db';
      if (!node) { box.classList.add('nooutput'); name.title += ': no Out node'; box.append(name, readout); readout.textContent = 'no out'; el.append(box); return; }
      const strip = { li, inst: lane.instrument, nodeId: node.id, readout };
      const fader = makeFader(strip);
      const mute = button('M', 'Silence this lane (Alt+M)', () => { silence(li); refresh(); });
      const solob = button('S', 'Solo this lane (Alt+S)', () => { solo(li); refresh(); });
      const mix = button('mix', 'On: the instrument is in the mix. Off: only sidechain nodes hear it (the Out node\'s master switch).', () => { setParam(lane.instrument, node.id, 'master', mixOf(node) ? 0 : 1); refresh(); });
      mute.classList.toggle('on', !!lane.silenced); solob.classList.toggle('on', !!lane.solo); mix.classList.toggle('on', mixOf(node));
      const side = document.createElement('div'); side.className = 'mx-side'; side.append(readout, mute, solob, mix);
      const row = document.createElement('div'); row.className = 'mx-row'; row.append(fader, side);
      box.append(name, row); el.append(box); strips.push(strip);
      strip.show(gainOf(node));
    });
    cursor();
  }

  // The strip of the lane the cursor is on gets a rule above it.
  function cursor() {
    const here = cursorLane();
    for (const box of el.children) box.classList.toggle('cur', Number(box.dataset.lane) === here);
  }

  return { refresh, cursor };
}
