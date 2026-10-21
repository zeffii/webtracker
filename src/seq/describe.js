import { display } from '../graph/units.js';
import { KINDS } from './cells.js';

const isBlank = token => !token || /^\.+$/.test(token);

// What the status bar says about the column under the caret: its long name, the range of the real value, and the cell's
// value as hex and in real units. A blank cell shows what holds there: the last value written above it in the lane, or
// the parameter's default when the column has never been written.

const hexOf = (n, width) => Math.round(n).toString(16).toUpperCase().padStart(width, '0');
const spec = c => ({ name: c.param, min: c.min, max: c.max, int: c.int });
const scale = (c, denom, raw) => {
  const x = raw / denom;
  return c.int ? Math.min(c.max, c.min + raw) : c.log ? c.min * Math.pow(c.max / c.min, x) : c.min + x * (c.max - c.min);
};
export const unscale = (c, denom, v) => {
  const x = c.int ? v - c.min : c.log ? (Math.log(v / c.min) / Math.log(c.max / c.min)) * denom : ((v - c.min) / (c.max - c.min)) * denom;
  return Math.max(0, Math.min(denom, Math.round(x)));
};

// The range of a parameter as text: "20 Hz to 20 kHz (log)".
const rangeText = c => `${display(c.type, spec(c), c.min)} to ${display(c.type, spec(c), c.max)}${c.log ? ' (log)' : ''}`;

// The same, in parts for the status bar: { name, details: [text], value: the real value as text or null, frac: where the
// value sits in its range (0 to 1) or null }.
export function describeParts(lane, tick, ci) {
  const c = lane.columns[ci], token = lane.rows[tick]?.[ci];
  const out = { name: c.long ?? c.label, details: [], value: null, frac: null };
  const width = KINDS[c.token].width;
  if (c.kind === 'param') {
    out.details.push(rangeText(c));
    let hex = token, note = '';
    if (isBlank(token)) {
      hex = null;
      for (let t = tick - 1; t >= 0 && hex === null; t--) if (!isBlank(lane.rows[t]?.[ci])) { hex = lane.rows[t][ci]; note = 'held '; }
      if (hex === null) { hex = hexOf(unscale(c, c.denom, c.dflt), width); note = 'default '; }
    }
    out.value = display(c.type, spec(c), scale(c, c.denom, parseInt(hex, 16)));
    out.frac = parseInt(hex, 16) / c.denom;
    out.details.push(`${note}${hex}`);
  } else if (c.kind === 'vel' || c.kind === 'trig') {
    out.details.push(c.kind === 'vel' ? '00 to FF' : '1 to F (0 is nothing)');
    if (!isBlank(token)) {
      out.frac = parseInt(token, 16) / (c.kind === 'vel' ? 255 : 15);
      out.value = `${Math.round(out.frac * 100)}%`;
      out.details.push(token);
    }
  } else if (c.kind === 'cmd') {
    const id = isBlank(token) ? null : parseInt(token.slice(0, 2), 16), t = id === null ? null : c.commands.find(x => x.id === id);
    if (t && (t.reset || t.setting)) { out.details.push(`${token.slice(0, 2)}: ${t.reset ? 'reset settings (1 retrigger, 2 humanize, 4 filter, 8 vibrato and LFO; A0 all)' : `${t.setting}: XX = settings added up, YY = slot 00 to 0F`}`); out.value = t.reset ? 'reset' : token.slice(2); }
    else if (t) {
      out.details.push(`${token.slice(0, 2)}: ${t.name}`, rangeText(t));
      const raw = parseInt(token.slice(2), 16);
      out.value = display(t.type, spec(t), scale(t, 65535, raw));
      out.frac = raw / 65535;
      out.details.push(token.slice(2));
    } else if (id === 0 && c.presets.length) { out.details.push('00: recall preset'); out.value = `number ${parseInt(token.slice(2), 16)}`; }
    else out.details.push('CC = command, XXXX = value');
  }
  return out;
}

export function describeColumn(lane, tick, ci) {
  const c = lane.columns[ci], token = lane.rows[tick]?.[ci];
  const parts = [c.long ?? c.label];
  const width = KINDS[c.token].width;
  if (c.kind === 'param') {
    parts.push(rangeText(c));
    let hex = token, note = '';
    if (isBlank(token)) {
      hex = null;
      for (let t = tick - 1; t >= 0 && hex === null; t--) if (!isBlank(lane.rows[t]?.[ci])) { hex = lane.rows[t][ci]; note = 'held '; }
      if (hex === null) { hex = hexOf(unscale(c, c.denom, c.dflt), width); note = 'default '; }
    }
    parts.push(`${note}${hex} = ${display(c.type, spec(c), scale(c, c.denom, parseInt(hex, 16)))}`);
  } else if (c.kind === 'vel' || c.kind === 'trig') {
    parts.push(c.kind === 'vel' ? '00 to FF' : '1 to F (0 is nothing)');
    if (!isBlank(token)) parts.push(`${token} = ${Math.round(parseInt(token, 16) / (c.kind === 'vel' ? 255 : 15) * 100)}%`);
  } else if (c.kind === 'cmd') {
    const id = isBlank(token) ? null : parseInt(token.slice(0, 2), 16), t = id === null ? null : c.commands.find(x => x.id === id);
    if (t && (t.reset || t.setting)) parts.push(`${token.slice(0, 2)}: ${t.reset ? 'reset settings' : `${t.setting} settings (XX groups, YY slot)`}`);
    else if (t) {
      parts.push(`${token.slice(0, 2)}: ${t.name}`, rangeText(t));
      const raw = parseInt(token.slice(2), 16);
      parts.push(`${token.slice(2)} = ${display(t.type, spec(t), scale(t, 65535, raw))}`);
    } else if (id === 0 && c.presets.length) parts.push('00: recall preset', `number ${parseInt(token.slice(2), 16)}`);
    else parts.push('CC = command, XXXX = value');
  }
  return parts.join(' · ');
}
