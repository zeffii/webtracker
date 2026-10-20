// The command console: a one-line box (press | in the pattern editor or the arrangement) that runs short typed commands on
// the selection. What you can type is a list of rules, one per line, kept in Config:
//
//   cop     -> clone              what you type -> what it does
//   tp{n}   -> transpose {n}      {n} stands for a number you type; the action can use it, or its negative (-{n})
//   tp{n}-  -> transpose -{n}
//   r{n}    -> rotate {n}
//   up      -> transpose 12; clone     several steps in one rule are separated by ;
//
// The rules are checked as they are edited: a rule that is wrong, or that could match the same typing as another rule, is
// switched off (and flagged in Config) until it is fixed, so the console never has to guess which one you meant.

export const DEFAULT_RULES = `# what you type -> what it does.  {n} is a number you type.  Lines starting with # are notes.
cop     -> clone
tp{n}   -> transpose {n}
tp{n}-  -> transpose -{n}
r{n}    -> rotate {n}
r{n}-   -> rotate -{n}
`;

// The things a rule can do. takes: whether the action wants a number. The functions are given by the page (see run()).
export const ACTIONS = {
  clone: { takes: false, help: 'give this placement its own copy of its pattern (Ctrl+G, or N in the arrangement)' },
  transpose: { takes: true, help: 'move the notes of the selection by this many semitones (negative is down)' },
  rotate: { takes: true, help: 'rotate the selected rows by this many rows (negative is up)' },
};

const NUM = /^-?\d+$/;
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Turns the text of the list into rules: { line, typed, steps: [{ action, arg }], regex, witnesses, error }. A rule with an
// `error` is not usable; conflicts between rules are added by analyse().
export function parseRules(text) {
  const rules = [];
  String(text ?? '').split('\n').forEach((raw, at) => {
    const line = raw.trim();
    if (!line || line.startsWith('#')) return;
    const rule = { line: at + 1, text: line, typed: '', steps: [], error: null };
    rules.push(rule);
    const cut = line.indexOf('->');
    if (cut < 0) { rule.error = 'needs "->" between what you type and what it does'; return; }
    const typed = line.slice(0, cut).trim().toLowerCase().replace(/\s+/g, ''), what = line.slice(cut + 2).trim();
    rule.typed = typed;
    if (!typed) { rule.error = 'nothing to type before "->"'; return; }
    const holes = typed.split('{n}').length - 1;
    if (holes > 1) { rule.error = 'only one {n} per rule'; return; }
    if (/[{}]/.test(typed.replace('{n}', ''))) { rule.error = 'a { or } that is not {n}'; return; }
    if (!what) { rule.error = 'nothing after "->"'; return; }
    let usesN = false;
    for (const part of what.split(';')) {
      const [action, ...rest] = part.trim().split(/\s+/), arg = rest.join('');
      const def = ACTIONS[action];
      if (!def) { rule.error = `unknown action "${action}" (${Object.keys(ACTIONS).join(', ')})`; return; }
      if (def.takes && !arg) { rule.error = `${action} needs a number`; return; }
      if (!def.takes && arg) { rule.error = `${action} takes no number`; return; }
      let value = null;
      if (def.takes) {
        if (arg === '{n}') { value = { n: 1 }; usesN = true; }
        else if (arg === '-{n}') { value = { n: -1 }; usesN = true; }
        else if (NUM.test(arg)) value = { fixed: Number(arg) };
        else { rule.error = `"${arg}" is not a number or {n}`; return; }
      }
      rule.steps.push({ action, value });
    }
    if (holes && !usesN) { rule.error = 'you type {n} but nothing uses it'; return; }
    if (!holes && usesN) { rule.error = 'the action uses {n} but you do not type one'; return; }
    const [pre, post = ''] = typed.split('{n}');
    rule.regex = holes ? new RegExp(`^${esc(pre)}(\\d+)${esc(post)}$`) : new RegExp(`^${esc(typed)}$`);
    rule.witnesses = holes ? ['1', '2', '4', '10', '12', '100', '123'].map(n => `${pre}${n}${post}`) : [typed];
  });
  return rules;
}

// Marks the rules that cannot be used: with a mistake of their own (error), or that match some typing another rule also
// matches (clash: the other rule's line). Both rules of a clash are switched off. Returns the same rules.
// A clash is found by trying a spread of numbers in each rule, so a very contrived overlap can slip through.
export function analyse(rules) {
  for (const r of rules) { r.clash = null; }
  const ok = rules.filter(r => !r.error);
  for (const a of ok) for (const b of ok) {
    if (a === b || a.clash?.includes(b.line)) continue;
    if (a.witnesses.some(w => b.regex.test(w)) || b.witnesses.some(w => a.regex.test(w))) {
      const sample = a.witnesses.find(w => b.regex.test(w)) ?? b.witnesses.find(w => a.regex.test(w));
      (a.clash ??= []).push(b.line); (b.clash ??= []).push(a.line);
      (a.clashWhy ??= {})[b.line] = sample; (b.clashWhy ??= {})[a.line] = sample;
    }
  }
  for (const r of rules) r.usable = !r.error && !r.clash;
  return rules;
}

export const describe = rule => rule.error ? `line ${rule.line}: ${rule.error}` : rule.clash ? `line ${rule.line} clashes with line ${rule.clash.join(', ')} (both match "${rule.clashWhy[rule.clash[0]]}")` : '';

// What a typed command means: { rule, n } or { none: true }. Only usable rules count.
export function resolve(rules, input) {
  const text = String(input).trim().toLowerCase().replace(/\s+/g, '');
  if (!text) return { empty: true };
  for (const rule of rules) {
    if (!rule.usable) continue;
    const m = rule.regex.exec(text);
    if (m) return { rule, n: m[1] === undefined ? null : Number(m[1]) };
  }
  const near = rules.filter(r => r.usable && r.typed.replace('{n}', '').startsWith(text.replace(/\d+/g, ''))).map(r => r.text);
  const blocked = rules.find(r => !r.usable && !r.error && r.regex?.test(text));
  return { none: true, near: near.slice(0, 4), blocked };
}

// The steps of a resolved command as [action, number] pairs.
export const stepsOf = ({ rule, n }) => rule.steps.map(s => [s.action, s.value == null ? null : s.value.fixed ?? s.value.n * n]);

// What a step did, in words, for the status line.
export const label = (action, n) => (ACTIONS[action].takes ? `${action} ${n > 0 ? '+' : ''}${n}` : action);

const UNKNOWN_KEY = 'webtracker.console.unknown';
export const unknownTyped = () => { try { return JSON.parse(localStorage.getItem(UNKNOWN_KEY)) ?? {}; } catch { return {}; } };
export const noteUnknown = text => { try { const u = unknownTyped(); u[text] = (u[text] ?? 0) + 1; localStorage.setItem(UNKNOWN_KEY, JSON.stringify(u)); } catch { /* not kept */ } };
export const clearUnknown = () => { try { localStorage.removeItem(UNKNOWN_KEY); } catch { /* nothing */ } };
