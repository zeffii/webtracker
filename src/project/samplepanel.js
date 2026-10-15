import { setLoop, setSampleProps, SAMPLE_PROPS, removeSample, renameSample, usersOfSample } from './ops.js';

// The list of the project's samples: size, loop points, remove. Rebuilt with render().
// onLoop(users) is called after loop points change, with the instruments that play it.
export function createSamplePanel({ container, statusEl, doc = document, getProject, onLoop, onRemove, onRename = () => {}, onSelect = () => {} }) {
  const el = (tag, props = {}, ...kids) => {
    const e = doc.createElement(tag);
    Object.assign(e, props);
    for (const k of kids) e.appendChild(typeof k === 'string' ? doc.createTextNode(k) : k);
    return e;
  };
  const say = text => { if (statusEl) statusEl.textContent = text; };

  function render() {
    const project = getProject();
    const ids = Object.keys(project.samples);
    if (!ids.length) { container.replaceChildren(el('p', {}, 'No samples loaded.')); return; }
    container.replaceChildren(...ids.map(id => {
      const s = project.samples[id];
      const say2 = err => say(err.message);
      const run = fn => { try { const users = fn(); say(''); onLoop(users); } catch (err) { say2(err); } };
      const num = (value, max) => el('input', { type: 'number', min: 0, max, value, size: 7 });
      // one loop: on switch, begin, end, crossfade
      const loopRow = (label, kind) => {
        const [sk, ek, ok, xk] = kind === 'sus' ? ['susStart', 'susEnd', 'susOn', 'susXfade'] : ['loopStart', 'loopEnd', 'loopOn', 'loopXfade'];
        const start = num(s[sk] ?? 0, s.data.length), end = num(s[ek] ?? 0, s.data.length), xf = num(s[xk] ?? 0);
        const on = el('input', { type: 'checkbox', checked: s[ok] !== false && (s[ek] ?? 0) > 0, ariaLabel: `${label} on` });
        on.addEventListener('change', () => run(() => setSampleProps(project, id, { [ok]: on.checked })));
        const points = () => run(() => setLoop(project, id, Number(start.value), Number(end.value), kind));
        start.addEventListener('change', points);
        end.addEventListener('change', points);
        xf.addEventListener('change', () => run(() => setSampleProps(project, id, { [xk]: Number(xf.value) })));
        return el('div', {}, el('label', {}, label, ' ', on), el('label', {}, ' begin ', start), el('label', {}, ' end ', end), el('label', {}, ' xfade ', xf));
      };
      // a slider for volume, global volume or pan, with its number
      const slider = (label, key) => {
        const spec = SAMPLE_PROPS[key];
        const input = el('input', { type: 'range', min: spec.min, max: spec.max, step: 0.01, value: s[key] ?? spec.def, ariaLabel: label });
        const shown = el('span', { textContent: Number(input.value).toFixed(2) });
        input.addEventListener('input', () => {
          shown.textContent = Number(input.value).toFixed(2);
          run(() => setSampleProps(project, id, { [key]: Number(input.value) }));
        });
        return el('label', {}, `${label} `, input, ' ', shown);
      };
      const remove = el('button', { textContent: 'Remove', disabled: usersOfSample(project, id).length > 0 });
      remove.addEventListener('click', () => {
        try { removeSample(project, id); say(''); render(); onRemove(id); } catch (err) { say(err.message); }
      });
      const show = el('button', { textContent: 'Waveform' });
      show.addEventListener('click', () => onSelect(id));
      const name = el('input', { type: 'text', value: id, size: 14, ariaLabel: 'Sample name' });
      name.addEventListener('change', () => {
        try {
          const next = renameSample(project, id, name.value);
          say('');
          render();
          onRename(id, next);
        } catch (err) {
          say(err.message);
          name.value = id;
        }
      });
      return el('div', { className: 'srow' },
        name,
        el('span', { textContent: `${(s.data.length / s.rate).toFixed(2)} s · ${s.rate} Hz · ${s.right ? 'stereo' : 'mono'} · ${s.data.length} frames` }),
        remove, show,
        loopRow('Loop', 'loop'), loopRow('Sustain loop', 'sus'),
        el('div', {}, slider('Volume', 'volume'), ' ', slider('Global volume', 'globalVolume'), ' ', slider('Pan', 'pan')));
    }));
  }

  return { render };
}
