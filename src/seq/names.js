// Column names. A header must fit its cell so the lanes stay narrow: a 2hex column is two characters wide, a 1hex one,
// one. So every column has a short name for the header (lowercase when it is squeezed: `nöt`, `id`, `ct`) and a long
// name for the status bar, shown when the caret is in the column.

const VOWELS = 'aeiou';
const SHORT = { Note: 'nöt', Smp: 'id', Idx: 'ix' };   // by label, where the squeezing would not read well

// The label made to fit `width` characters: unchanged if it fits, else its first letter and then the first consonants
// after it (Cut -> ct, Res -> rs, Dec -> dc), or the first letter alone in one character. A trailing digit is kept
// (Rt2 -> r2).
export function shortName(label, width) {
  if (SHORT[label] && SHORT[label].length <= width) return SHORT[label];
  if (label.length <= width) return label;
  const lower = label.toLowerCase();
  if (width <= 1) return lower[0];
  if (/\d$/.test(label)) return lower[0] + label.slice(-1);
  const rest = [...lower.slice(1)];
  const picked = rest.filter(c => !VOWELS.includes(c)).slice(0, width - 1);
  for (const c of rest) if (picked.length < width - 1 && !picked.includes(c)) picked.push(c);
  return lower[0] + picked.join('').slice(0, width - 1);
}

const LONG = {
  grain: 'Grain length', edge: 'Grain edge', accel: 'Repeat speed-up', step: 'Pitch step', slide: 'Pitch slide', flip: 'Flip direction', prob: 'Repeat chance',
  volLin: 'Volume slide (linear)', volLog: 'Volume slide (log)', volDown: 'Volume slide down (dB)', volUp: 'Volume slide up (dB)', volFineDown: 'Fine volume slide down', volFineUp: 'Fine volume slide up', subdivide: 'Subticks per tick', blockCount: 'Block count (absolute offset)', volDownMs: 'Volume slide down (ms)', volUpMs: 'Volume slide up (ms)', volFineDownMs: 'Fine volume slide down (ms)', volFineUpMs: 'Fine volume slide up (ms)',
  jOffset: 'Offset jitter', jPitch: 'Pitch jitter', jPan: 'Pan jitter', jTime: 'Timing jitter', jLevel: 'Level jitter',
  sample: 'Sample', offset: 'Sample offset', retrig: 'Retrigger interval', repeats: 'Repeats', cutoff: 'Cutoff', resonance: 'Resonance',
  res: 'Resonance', mix: 'Mix', time: 'Time', amount: 'Amount', decay: 'Decay', fenv: 'Filter envelope', detune: 'Detune', drive: 'Drive',
  glide: 'Glide', mode: 'Mode', pw: 'Pulse width', pwm: 'Pulse width modulation', sweep: 'Sweep', pedal: 'Sustain pedal',
  hard: 'Hammer hardness', body: 'Body', bright: 'Brightness', pos: 'Position', inharm: 'Inharmonicity', prompt: 'Prompt sound',
  algo: 'Algorithm', index: 'Modulation index', fb: 'Feedback', feedback: 'Feedback', voice: 'Voice', lfo: 'LFO', speed: 'Speed', tune: 'Tune',
  cdec: 'Closed decay', odec: 'Open decay', tone: 'Tone', snap: 'Snap', level: 'Level', clvl: 'Closed level', olvl: 'Open level',
  choke: 'Choke', smp: 'Sample number', fx: 'Effect word', pan: 'Pan', bpm: 'Tempo (BPM)', swing: 'Swing', tpb: 'Ticks per beat',
  volume: 'Master volume', bypass: 'Bypass', gain: 'Gain', rate: 'Rate', depth: 'Depth', freq: 'Frequency', attack: 'Attack', release: 'Release',
  sustain: 'Sustain', width: 'Width', size: 'Size', damp: 'Damping', threshold: 'Threshold', ratio: 'Ratio', pitch: 'Pitch',
};

// "fenv" -> "Filter envelope"; a name that is not listed is split at its capitals: "nnaFade" -> "Nna fade".
export function longName(param) {
  if (LONG[param]) return LONG[param];
  const words = param.replace(/([a-z])([A-Z0-9])/g, '$1 $2').toLowerCase();
  return words[0].toUpperCase() + words.slice(1);
}
