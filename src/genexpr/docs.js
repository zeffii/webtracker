// One line of help for everything in the language, shown when the pointer rests on a word in the code box. [signature, what it does].
export const DOCS = {
  // trigonometry
  sin: ['sin(x)', 'sine of x, in radians'], cos: ['cos(x)', 'cosine of x, in radians'], tan: ['tan(x)', 'tangent of x, in radians'],
  asin: ['asin(x)', 'arc sine; x is held between -1 and 1'], acos: ['acos(x)', 'arc cosine; x is held between -1 and 1'], atan: ['atan(x)', 'arc tangent'], atan2: ['atan2(y, x)', 'the angle of the point (x, y), from -pi to pi'],
  sinh: ['sinh(x)', 'hyperbolic sine'], cosh: ['cosh(x)', 'hyperbolic cosine'], tanh: ['tanh(x)', 'hyperbolic tangent: a soft clipper that keeps its output between -1 and 1'],
  // rounding and size
  abs: ['abs(x)', 'x without its sign'], sign: ['sign(x)', '-1, 0 or 1'], floor: ['floor(x)', 'x rounded down'], ceil: ['ceil(x)', 'x rounded up'], round: ['round(x)', 'x rounded to the nearest whole number'], trunc: ['trunc(x)', 'x with its fraction cut off'], fract: ['fract(x)', 'the fraction of x: x - floor(x)'],
  // powers
  sqrt: ['sqrt(x)', 'square root; a negative x gives 0'], exp: ['exp(x)', 'e to the power x'], log: ['log(x)', 'natural logarithm; x of 0 or less gives 0'], log2: ['log2(x)', 'logarithm base 2; x of 0 or less gives 0'], log10: ['log10(x)', 'logarithm base 10; x of 0 or less gives 0'], pow: ['pow(a, b)', 'a to the power b; a result that is not a finite number gives 0'],
  // comparing and limiting
  min: ['min(a, b)', 'the smaller of the two'], max: ['max(a, b)', 'the larger of the two'], clamp: ['clamp(x, lo, hi)', 'x held between lo and hi'], clip: ['clip(x, lo, hi)', 'the same as clamp'],
  mix: ['mix(a, b, t)', 'a at t = 0, b at t = 1, a blend between'], scale: ['scale(x, inLo, inHi, outLo, outHi)', 'maps x from one range to another'],
  wrap: ['wrap(x, lo, hi)', 'x wrapped round into the range, like a phase'], fold: ['fold(x, lo, hi)', 'x folded back from the edges of the range, like a wavefolder'], mod: ['mod(a, b)', 'the remainder of a / b, always the sign of b; 0 when b is 0'],
  // musical units
  mtof: ['mtof(m)', 'MIDI note number to frequency in Hz (69 is 440)'], ftom: ['ftom(f)', 'frequency in Hz to MIDI note number'], dbtoa: ['dbtoa(db)', 'decibels to a gain'], atodb: ['atodb(a)', 'a gain to decibels'],
  mstosamps: ['mstosamps(ms)', 'milliseconds to samples at the sample rate'], sampstoms: ['sampstoms(n)', 'samples to milliseconds'], fixdenorm: ['fixdenorm(x)', 'flushes tiny numbers to 0, which keeps feedback from slowing the CPU'],
  // generators and followers
  noise: ['noise()', 'white noise between -1 and 1'], phasor: ['phasor(hz)', 'a ramp from 0 up to 1, hz times a second'], cycle: ['cycle(hz)', 'a sine wave of hz cycles a second'],
  delta: ['delta(x)', 'how much x changed since the last sample'], change: ['change(x)', '-1, 0 or 1: whether x went down, stayed, or went up since the last sample'],
  slide: ['slide(x, up, down)', 'x smoothed: it takes up samples to rise and down samples to fall (1 follows at once)'], dcblock: ['dcblock(x)', 'a high-pass at a few hertz that takes the DC offset out of x'],
  // buffers
  peek: ['peek(data, index)', 'reads a Data buffer; the index wraps round'], poke: ['poke(data, value, index)', 'writes a value into a Data buffer; the index wraps round'], dim: ['dim(buffer)', 'the number of samples in a Data or Delay'],
  read: ['name.read(i)', 'a Data: the sample at index i. A Delay: the value written that many samples ago (fractions are interpolated)'], write: ['name.write(v)', 'a Delay: puts v in at the write head. (A Data takes name.write(v, i).)'],
  // constants
  pi: ['pi', '3.14159...'], twopi: ['twopi', '2 x pi'], halfpi: ['halfpi', 'pi / 2'], invpi: ['invpi', '1 / pi'], e: ['e', '2.71828...'], ln2: ['ln2', 'the natural log of 2'], ln10: ['ln10', 'the natural log of 10'], sqrt2: ['sqrt2', 'the square root of 2'], sqrt1_2: ['sqrt1_2', 'the square root of one half'],
  samplerate: ['samplerate', 'samples a second of the engine'],
  // inputs, outputs, words
  in1: ['in1', 'the first input, the signal arriving at "in"'], in2: ['in2', 'the second input, the signal arriving at "mod"'], out1: ['out1', 'the first output: set it, once a sample'], out2: ['out2', 'the second output'],
  freq: ['freq', 'the frequency in Hz of the note being played (and of the last one after it ends); 440 before any note'],
  gate: ['gate', '1 while a key is held, 0 when the last one is let go; use it to open and close an envelope'],
  vel: ['vel', 'the velocity of the latest note, 0 to 1'],
  note: ['note', 'the note number of the latest note (60 is middle C, 69 is A 440)'],
  trig: ['trig', '1 for the first sample after a note starts, else 0: restart an envelope or fill a delay with it'],
  Param: ['Param name(default, min=0, max=1)', 'a knob on the node, p1 to p8 in the order they are declared'], History: ['History name(start)', 'a value that is kept from one sample to the next'],
  Data: ['Data name(size)', 'a buffer of size samples to read and write by index'], Delay: ['Delay name(size)', 'a delay line of size samples: name.write(x), name.read(time)'],
  if: ['if (cond) { ... } else { ... }', 'runs the first block while cond is not 0, the second otherwise'], else: ['else', 'the block that runs when the if was false'],
};
