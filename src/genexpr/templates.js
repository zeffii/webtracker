// Starting points for the code node: working programs to load into the code box and change. The instruments are meant to
// sit in front of a Voices node, so each key gets its own copy of the code; they play from freq, gate, vel and trig (see
// the node's help). The effects take the audio at in1 and in2. Each one is checked by the tests: it compiles, makes sound
// and stays finite.
export const TEMPLATES = [
  {
    name: 'Sine voice', kind: 'instrument',
    code: `// A playable sine voice. Put this node in front of a Voices node.
// freq, gate and vel come from the note being played.
Param attack(8, min=1, max=2000);     // ms
Param release(300, min=5, max=5000);  // ms

env = slide(gate, mstosamps(attack), mstosamps(release));
out1 = cycle(freq) * env * vel * 0.5;
out2 = out1;
`,
  },
  {
    name: 'Detuned saw pad', kind: 'instrument',
    code: `// Three saw oscillators a little apart, through two one-pole lowpasses, with a slow envelope.
Param detune(0.4, min=0, max=2);      // how far apart the saws are
Param bright(0.25, min=0.01, max=1);  // the lowpass: higher is brighter
Param attack(300, min=1, max=4000);   // ms
Param release(900, min=5, max=6000);  // ms
History lp1(0);
History lp2(0);

env = slide(gate, mstosamps(attack), mstosamps(release));
spread = detune * 0.01;
a = phasor(freq * (1 - spread)) * 2 - 1;
b = phasor(freq) * 2 - 1;
c = phasor(freq * (1 + spread)) * 2 - 1;

lp1 = lp1 + ((a + b + c) / 3 - lp1) * bright;
lp2 = lp2 + (lp1 - lp2) * bright;
out1 = lp2 * env * vel * 0.8;
out2 = out1;
`,
  },
  {
    name: 'FM bell', kind: 'instrument',
    code: `// Two-operator FM: a modulator at freq x ratio bends the phase of the carrier. A note starts it at full strength; it
// rings out over decay, and much faster when the key is let go.
Param ratio(3.5, min=0.5, max=8);
Param index(2.5, min=0, max=8);       // how far the modulator bends the carrier
Param decay(1200, min=50, max=6000);  // ms
History ring(0);

ring = trig ? 1 : ring * pow(0.001, 1 / mstosamps(gate ? decay : decay * 0.1));
bend = sin(twopi * phasor(freq * ratio)) * index * ring;
out1 = sin(twopi * phasor(freq) + bend) * ring * vel * 0.4;
out2 = out1;
`,
  },
  {
    name: 'Plucked string', kind: 'instrument',
    code: `// Karplus-Strong: a burst of noise goes round a delay line one period long, and a lowpass in the loop takes a little of
// the top off on every trip, so the sound dies away like a string. A note starts the burst (trig).
Param decay(0.997, min=0.95, max=0.9999);  // the loop gain: nearer 1 rings longer
Param bright(0.6, min=0.05, max=1);        // the lowpass in the loop
Delay line(4096);                          // up to about 12 Hz at 48 kHz
History lp(0);
History count(0);

count = trig ? samplerate / freq : max(count - 1, 0);
burst = count > 0 ? noise() : 0;
period = clamp(samplerate / freq - 1, 2, 4000);
y = line.read(period);
lp = lp + (y - lp) * bright;
line.write(burst + lp * (gate ? decay : decay * 0.9));   // a key let go damps it
out1 = y * vel * 0.8;
out2 = out1;
`,
  },
  {
    name: 'Kick drum', kind: 'instrument',
    code: `// A sine that falls in pitch, from a note trigger. Any note plays it; pitch sets the low end, in Hz.
Param pitch(55, min=30, max=120);
Param sweep(4, min=0, max=12);        // how far above pitch it starts
Param decay(300, min=50, max=1500);   // ms
History env(0);
History amp(0);
History ph(0);

env = trig ? 1 : env * pow(0.001, 1 / mstosamps(60));
amp = trig ? 1 : amp * pow(0.001, 1 / mstosamps(decay));
ph = fract(ph + pitch * (1 + sweep * env * env) / samplerate);
out1 = tanh(sin(twopi * ph) * 1.5) * amp * vel * 0.8;
out2 = out1;
`,
  },
  {
    name: 'Hi-hat', kind: 'instrument',
    code: `// White noise through a first-difference highpass, with a short envelope started by every note.
Param decay(70, min=10, max=800);     // ms: short is closed, long is open
History env(0);
History prev(0);

n = noise();
env = trig ? 1 : env * pow(0.001, 1 / mstosamps(decay));
out1 = (n - prev) * env * vel * 0.5;
prev = n;
out2 = out1;
`,
  },
  {
    name: 'Echo', kind: 'effect',
    code: `// A feedback delay on the audio coming in.
Param time(300, min=20, max=1500);    // ms
Param feedback(0.45, min=0, max=0.95);
Param wet(0.4, min=0, max=1);
Delay line(samplerate * 2);

tap = line.read(mstosamps(time));
line.write((in1 + in2) * 0.5 + tap * feedback);
out1 = in1 + tap * wet;
out2 = in2 + tap * wet;
`,
  },
  {
    name: 'Bitcrusher', kind: 'effect',
    code: `// Fewer bits and a lower sample rate: every hold-th sample is kept, and rounded to a number of steps.
Param bits(6, min=1, max=16);
Param hold(4, min=1, max=64);         // samples each value is held for
History heldL(0);
History heldR(0);
History count(0);

count = count + 1;
if (count >= hold) {
  count = 0;
  heldL = in1;
  heldR = in2;
}
steps = pow(2, bits - 1);
out1 = round(heldL * steps) / steps;
out2 = round(heldR * steps) / steps;
`,
  },
  {
    name: 'Ring modulator', kind: 'effect',
    code: `// The sound is multiplied by a sine. depth blends from the plain sound (0) to the full ring modulation (1).
Param rate(300, min=1, max=4000);     // Hz
Param depth(1, min=0, max=1);

m = mix(1, cycle(rate), depth);
out1 = in1 * m;
out2 = in2 * m;
`,
  },
  {
    name: 'Soft clipper', kind: 'effect',
    code: `// tanh squashes the peaks and rounds the corners: more drive, more distortion. The divide keeps a loud signal near 1; level trims it.
Param drive(4, min=1, max=30);
Param level(0.5, min=0, max=1.5);

out1 = tanh(in1 * drive) / tanh(drive) * level;
out2 = tanh(in2 * drive) / tanh(drive) * level;
`,
  },
];
