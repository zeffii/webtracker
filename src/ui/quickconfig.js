// A few settings from Config, drawn small where they are used (the Shader view, the Sample screen). Each control is the setting itself:
// changing it here changes it in Config and the other way round. rows: [[key, short label], ...]; schema: config.schemaOf(key).
export function mountConfig(host, config, rows) {
  const syncs = [];
  for (const [key, label] of rows) {
    const s = config.schemaOf(key); if (!s) continue;
    const row = document.createElement('label'); row.className = `qc ${s.type}`; row.title = s.hint ?? '';
    const text = Object.assign(document.createElement('span'), { textContent: label });
    let box;
    if (s.type === 'bool') {
      box = Object.assign(document.createElement('input'), { type: 'checkbox' });
      box.addEventListener('change', () => config.set(key, box.checked));
      syncs.push(() => { box.checked = !!config.get(key); });
      row.append(box, text);
    } else if (s.type === 'int') {
      box = Object.assign(document.createElement('input'), { type: 'number', min: s.min, max: s.max, step: 1 });
      box.addEventListener('change', () => { config.set(key, Number(box.value)); box.value = config.get(key); });
      box.addEventListener('keydown', e => e.stopPropagation());   // typing a number is not a shortcut
      syncs.push(() => { if (document.activeElement !== box) box.value = config.get(key); });
      row.append(text, box);
    } else {
      box = document.createElement('select');
      for (const o of s.options) box.append(Object.assign(document.createElement('option'), { value: o, textContent: s.labels?.[o] ?? o }));
      box.addEventListener('change', () => config.set(key, box.value));
      syncs.push(() => { box.value = config.get(key); });
      row.append(text, box);
    }
    host.append(row);
  }
  const all = () => syncs.forEach(f => f());
  config.onChange(all); all();
  return { sync: all };
}
