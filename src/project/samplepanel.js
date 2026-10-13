import { setLoop, removeSample, usersOfSample } from './ops.js';

// The list of the project's samples: size, loop points, remove. Rebuilt with render().
// onLoop(users) is called after loop points change, with the instruments that play it.
export function createSamplePanel({ container, statusEl, doc = document, getProject, onLoop, onRemove }) {
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
      const start = el('input', { type: 'number', min: 0, max: s.data.length, value: s.loopStart ?? 0 });
      const end = el('input', { type: 'number', min: 0, max: s.data.length, value: s.loopEnd ?? 0 });
      const apply = () => {
        try {
          const users = setLoop(project, id, Number(start.value), Number(end.value));
          say('');
          onLoop(users);
        } catch (err) {
          say(err.message);
        }
      };
      start.addEventListener('change', apply);
      end.addEventListener('change', apply);
      const remove = el('button', { textContent: 'Remove', disabled: usersOfSample(project, id).length > 0 });
      remove.addEventListener('click', () => {
        try { removeSample(project, id); say(''); render(); onRemove(id); } catch (err) { say(err.message); }
      });
      return el('div', { className: 'srow' },
        el('strong', { textContent: id }),
        el('span', { textContent: `${(s.data.length / s.rate).toFixed(2)} s · ${s.rate} Hz · ${s.data.length} frames` }),
        el('label', {}, 'loop start ', start), el('label', {}, 'end ', end), remove);
    }));
  }

  return { render };
}
