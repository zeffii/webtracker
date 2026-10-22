// Help pages for nodes: what a node is for, how to get the most out of it, where it falls short. Every node gets a page.
// The ones written by hand are in PAGES; for the rest the page is built from the node's own definition (its ports and the
// hint of each parameter), so F1 always shows something and the hand-written ones can be added a few at a time.
import { hintFor, factsFor } from './hints.js';

// summary: one or two sentences. best: ways to get the most out of it. limits: what it will not do well.
export const PAGES = {
  noise: {
    summary: 'Noise in every colour, from deep brown through pink and white to thin violet, set with tilt (the slope of the spectrum in dB per octave).',
    best: [
      'Hats and snares: white or blue noise through a highpass and a short envelope. Hi-hat air is mostly blue and violet.',
      'Pink noise sounds even to the ear and makes rain, surf and breath; brown makes wind, thunder and rumble under a kick.',
      'Sweep tilt with a pattern column or an envelope for a noise that darkens or brightens during the hit.',
      'Free on gives a constant bed. Put it through a filter and an envelope follower or a gate, so it only speaks when you want.',
      'Restart on makes every hit identical (a snare that never changes); turn it off and each hit differs, which is better for open hats and washes.',
    ],
    limits: [
      'Brown noise carries a lot of energy at the lowest frequencies: put a highpass after it or it will eat your headroom and your speakers.',
      'The slopes are approximations of the ideal colours, and exact only in the middle of the audio range.',
      'A free-running noise never lets the instrument go quiet, so it keeps using CPU.',
    ],
  },
  specpan: {
    summary: 'Splits the sound into ten bands, from 150 Hz to 10 kHz, and gives each band its own place in the stereo field. Below the low mono frequency the sound is made mono. Used for widening and for keeping the low end in the middle.',
    best: [
      'Put it on a pad, a bus or the whole mix, and start with spread around 0.2 to 0.4. It widens without delays or chorus, so the sound stays tight.',
      'Keep low mono at 80 to 150 Hz. Kick and bass stay in the centre and the mix holds up on club systems and in mono.',
      'shape 0 (alternate) is the airy widener, 1 (sweep) leans the highs to one side, 2 (wave) is two smooth swings. 3 (custom) uses the sliders b1 (lowest band) to b10 (highest).',
      'Write rotate from a pattern, or drive it from a slow lfo, and the image drifts along the spectrum.',
      'Use mix to blend the effect in: at 0.5 it is half as wide.',
    ],
    limits: [
      'A band moves toward the pan position by blending, so the pattern is smooth rather than sharp, and bands bleed into each other near the crossovers.',
      'Widening by band thins the sound when it is summed to mono. Check in mono, and lower spread if the mids go hollow.',
      'The bands are fixed. The crossover points cannot be moved, only the low mono frequency.',
      'It works on the whole sound: it cannot pan one instrument inside a mixed signal.',
      'Do not put it on a kick or bass sound. Width belongs to the mids and the highs.',
    ],
  },
  compressor: {
    summary: 'Turns the loud parts down so the level evens out; the make-up gain then brings the whole sound back up.',
    best: ['Slow attack lets the front of a drum through, so it keeps its punch; a fast attack calms it.', 'Release should breathe with the music: long enough not to pump, short enough to recover before the next hit.', 'A sidechain from the kick (the sidechain node) makes the bass and pads duck under it.'],
    limits: ['It cannot fix a sound that is wrong to begin with, and heavy settings make quiet details louder with the noise.'],
  },
  hall: {
    summary: 'A reverb: the sound is placed in a large room. The tail is what is heard after the sound stops.',
    best: ['Use it on a send or on one instrument, not on everything: a reverb on all of a mix turns it to mud.', 'Short pre-delay keeps the dry sound clear in front of the tail.', 'Turn the damping up to keep the tail dark so it stays out of the way of the hats.'],
    limits: ['A long tail runs on for a while after the last note, and costs CPU while it rings.'],
  },
  delay: {
    summary: 'Repeats the sound after a time. With feedback, the repeats repeat.',
    best: ['Set the time from the tick lines on the slider: the repeats then fall exactly on the grid.', 'Low-pass the feedback path (or keep it low) so each repeat is duller and sits behind the last.', 'Feedback close to 1 rings on for a long time; give yourself a way to turn it down.'],
    limits: ['Moving the time while the sound plays bends the pitch of the repeats.'],
  },
  filter: {
    summary: 'Removes part of the spectrum: a lowpass takes the highs, a highpass the lows, a bandpass keeps a band.',
    best: ['Sweep the cutoff from a pattern column or an envelope: that is most of the sound of electronic music.', 'Some resonance gives the sweep a voice; a lot of it whistles.'],
    limits: ['A resonant filter can be much louder than its input at the cutoff: watch the level.'],
  },
  freqshift: {
    summary: 'Moves every frequency by a fixed number of Hz. Unlike a pitch shift, the harmonics no longer line up, so the sound turns metallic.',
    best: ['A few Hz of shift gives a slow, shimmering detune; hundreds of Hz gives bells and robot voices.', 'Feedback makes spirals that climb or fall forever. Use small values and keep a hand on mix.'],
    limits: ['It does not keep musical intervals: a shifted chord is not a transposed chord.'],
  },
  sampler: {
    summary: 'Plays the samples of the instrument, one note at a time or in repeating bursts. Besides pitch and level it has a start position, slices, loops, a new-note action, and a retrigger engine that can repeat, move through the sample, change pitch and speed, and scatter the repeats randomly into grains.',
    best: [
      'One-shots (drums): leave grain and the jitters at 0. Each hit plays to its end and rings over the next note.',
      'Stutters and rolls: put an interval in the Rtg column (1000 is one tick, 0800 half a tick) and the repeats follow until the note ends. 0A reverse and 11 flip turn them backwards.',
      'Fake granular synthesis: a short Rtg, a grain length a little longer than the interval, a tiny 08 shift so the window creeps through the sample, and a little jitter on offset, pitch and pan. Sustained notes become clouds.',
      'Use a long, slow sample (a pad, a voice, a field recording), set the Off column to the interesting part, and let 08 shift walk away from it.',
      'Rising and falling rolls: 0D accel below 1 speeds the repeats up, above 1 slows them. 0E step makes each repeat a semitone (or any amount) higher.',
      'Everything is a pattern command, so a roll can change from row to row. Write 0000 to the command to turn it off again.',
    ],
    limits: [
      'Sixteen voices per instrument. A big cloud (short interval, long grains) uses a voice per grain in flight, and the oldest is stolen when they run out: shorten the grain or slow the rate if it starts to sound thin.',
      'The jitters come from a random number generator that is not reset, so a bar with jitter sounds a little different each time it plays. Exported renders differ from run to run.',
      'Repeats keep going until the note ends: a new note, a note off or a cut. A repeat that would start past the end (or before the start) of the sample ends the chain.',
      'The gap between repeats cannot go below 1 ms, so a strong accel does not run away.',
      'No time stretching: grain length and pitch are independent only in the sense that you choose both. Every sound plays at the speed that its pitch implies.',
    ],
    sections: [
      {
        title: 'How a note plays',
        text: [
          'A note starts a sound at the start position (the Off column, or a slice marker if the 10 slice command points at one) and plays it forward, or backward when 0A reverse is 1. The sample\'s own loops apply: a looping sample plays on until the note ends, a one-shot plays to its end.',
          'A new note fades out what its column was still playing over nnaFade ms (new-note action), so a new hit cuts the one before it. Write 1F nnaAll 0000 to let one-shots ring on instead.',
        ],
      },
      {
        title: 'Making a new note cut the old one (or not)',
        text: [
          'By default a new note cuts the note its own column was still playing, over the 06 nnaFade time in ms (0000 cuts it at once, 0014 is the default 20 ms). Notes in other columns, and chords, are left alone.',
          'To let one-shots (drums, hits) ring on over the next note instead, write 1F nnaAll 0000 in a command column of the sampler\'s lane (on the first row is enough, it stays until changed); 1F 0001 turns the cutting back on. Looping samples always fade out.',
        ],
      },
      {
        title: 'Repeats: how a note becomes a chain',
        text: [
          'Give the note an interval in the Rtg column and it repeats. The interval is in ticks, written as four hex digits: 1000 is one tick, 0800 half a tick, 0400 a quarter, 2000 two ticks.',
          '07 repeats says how many (0 means until the note ends). Before each repeat the chain moves on: 08 shift moves the start along the sample, 09 ramp multiplies the volume, 0E step raises the pitch, 11 flip turns the direction round, and 0D accel changes the interval for the repeat after.',
          'Without a grain length, each repeat cuts the one before (2 ms crossfade), like a stutter. With a grain length the sounds end on their own and overlap.',
        ],
      },
      {
        title: 'Grains',
        text: [
          '0B grain is how long each sound lasts. Every sound, the first and each repeat, gets a fade in and a fade out; 0C edge sets how much of the grain is fade (0 hard edges of 2 ms, 1 a triangle, 8000-ish halfway).',
          'A grain a little longer than the interval overlaps the next one, which smooths into a continuous sound. A grain shorter than the interval leaves gaps and sounds like a gate. The sample pitch and the grain length are independent: shift moves through the sample slowly while grains keep their own pitch.',
          'The jitters make the texture. 13 jOffset moves each grain\'s start, 14 jPitch detunes it, 15 jPan places it, 16 jTime makes the repeat late, 17 jLevel makes it quieter. Each takes a maximum; the actual value is random between none and that.',
          '12 prob drops repeats at random (the timing carries on, so it is a gap, not a slowdown).',
        ],
      },
      {
        title: 'Recipes',
        text: [
          'Cloud: Rtg 0400, 07 repeats 0000, 0B grain 1800, 0C edge 8000, 08 shift 8040, 13 jOffset 0200, 14 jPitch 0800, 15 jPan 4000. Hold the note and the cloud drifts through the sample.',
          'Rising roll: Rtg 1000, 07 repeats 0010, 0D accel 6000, 0E step 8800, 09 ramp B000. Sixteen hits, each faster, a semitone higher, and getting louder.',
          'Tape stop: 0F slide 7800 bends down one semitone every tick for as long as the sound plays.',
          'Gated chop: 0B grain 0400, Rtg 0800, 12 prob C000, 11 flip 0001. Quarter-tick chops, a quarter missing, every other one backwards.',
          'Fade out a held note: 1A 0C18 (down 24 dB over two ticks), or 19 0C01 for a fade to nearly nothing in two ticks. Write the slide on the row where the fade should start; the note keeps playing underneath. A slide stops at its target, so write another to go on.',
          'Reset: write 0000 to 0B grain, 08 shift 8000, 0D accel 8000, 0E step 8000, 0F slide 8000, 11 flip 0000, 12 prob FFFF and the jitters 0000. (Rtg 0000 stops the repeats.)',
        ],
      },
      {
        title: 'Absolute offsets (FF, F0)',
        text: [
          'The Off column is four hex digits, so on its own it can only say where in the sample to start as a fraction, 0000 the start to FFFF the end: on a long sample each step is many frames. Command FF switches this instance of the sampler to absolute offsets: Off then holds a frame number.',
          'A frame number can be bigger than four digits, so it is written in two parts, hh:hhhh. The last four digits go in Off. The block count, how many full blocks of 65536 frames (0000 to FFFF) have gone by, is the value of FF. The Samples screen shows slice positions the same way.',
          'Example: Off 0300 and the command FF0002 start the note at frame 2:0300, which is 2 x 65536 + 768 = 131840. Off 0300 with FF0000 is frame 768. Frame 70000 is 1:1170, so FF0001 and Off 1170.',
          'It stays in force, for this instrument only, until you write F0 (any value; F00000 will do), which puts Off back to a fraction of the sample. A slice marker (command 10) still wins over Off, and reverse still counts from the end. A frame past the end of the sample starts at the end.',
        ],
      },
      {
        title: 'The command list',
        rows: [
          ['Smp', 'column: which sample of the instrument\'s list plays'],
          ['Off', 'column: start position, 0000 the start, FFFF the end'],
          ['Rtg', 'column: ticks between repeats, 1000 is one tick, 0000 no repeats'],
          ['01 / 02', 'filter cutoff / resonance'],
          ['03, 04, 05', 'delay time / feedback / mix'],
          ['06 nnaFade', 'ms for the old sound to fade out when a new note starts in its column (looping samples always; one-shots when 1F nnaAll is 1, the default); 0000 cuts it at once'],
          ['1F nnaAll', '0001 (the default): a new note cuts the one-shot its column was still playing (over the 06 nnaFade time), so hits choke each other; 0000: they ring on'],
          ['07 repeats', 'how many repeats (0000 until the note ends)'],
          ['08 shift', 'the start moves this far along the sample per repeat; 8000 none, above goes forward, below back'],
          ['09 ramp', 'each repeat\'s volume is multiplied by this; C000 is x1, 8000 halves it'],
          ['0A reverse', '0001 plays backwards (the start counts from the end)'],
          ['0B grain', 'each sound lasts this many ticks (1000 is one tick); 0000 plays to the sample\'s end'],
          ['0C edge', 'fade share of a grain: 0000 hard, FFFF triangle'],
          ['0D accel', 'each repeat\'s interval is multiplied by this: 8000 is x1, 4000 halves it (speeds up), C000 is x1.5'],
          ['0E step', 'semitones each repeat is higher: 8000 none, 8800 +1, 7800 -1 (0800 is one semitone)'],
          ['0F slide', 'pitch bend while a sound plays, semitones per tick: 8000 none, 8800 up one per tick, 7800 down'],
          ['10 slice', 'start at a slice marker: 0000 the first, 0001 the second; FFFF puts Off back in charge'],
          ['18 volLin', 'XXYY: slide the volume in a straight line to the level YY/40 (hex; 40 is the sound\'s own level, 20 half, 80 double), in XX subticks (six to a tick; 00 at once). Written while a sound plays it slides that sound; before a note, every sound of the note'],
          ['19 volLog', 'XXYY: the same, even in dB (a steady fade); level 00 goes to about -80 dB'],
          ['1A volDown', 'XXYY: slide down by YY dB in XX subticks (1A 0606: 6 dB over one tick)'],
          ['1B volUp', 'XXYY: slide up by YY dB in XX subticks'],
          ['1C / 1D', 'XXYY: fine slide down / up by YY/256 dB (1C 0680: half a dB over one tick)'],
          ['FF blockCount', 'Off becomes an absolute frame number: the value is the block count, the full 65536-frame blocks before it, and Off the last four hex digits (FF0002 with Off 0300 starts at frame 2:0300)'],
          ['F0', 'back to relative: Off is a fraction of the sample again (any value, F00000 will do)'],
          ['20 / 21', 'XXYY: pitch slide down / up by XX semitones over YY subticks. Written while a sound plays it bends that sound; before a note, every sound of the note'],
          ['22 / 23', 'XXYY: the same in 256ths of a semitone (22 0680: half a semitone down over eight subticks)'],
          ['24 portTo', 'glide: a note that follows one still sounding in its column bends to the new pitch over XXY.Y subticks (0060: six subticks) instead of restarting. 0000 restarts as usual'],
          ['25 / 26', 'the shortest (XX.YY subticks) and longest (XXYY subticks) time between repeats; 0000 no limit'],
          ['27 curve', 'the nth interval is also multiplied by n to the power (value - 8000) / 4000: C000 lengthens them like n, 4000 shortens them like 1/n, 8000 is none'],
          ['28 cut', 'every sound is cut after XXX.Y ticks (0010 one tick, 0018 one and a half, 0100 sixteen); 0000 never'],
          ['29 release', 'every sound is released after XXX.Y ticks, and fades over the Release time (even a one-shot)'],
          ['2A scale', 'each repeat multiplies the cut and release times by this: 8000 is x1'],
          ['2B / 2C / 2D', 'stretch: the whole sample is spread over xxyy-8000 subticks (2B), ticks (2C), or ticks that hold when the repeat time changes (2D); each repeat starts as far along as the time since the last. Needs a repeat time (Rtg). 8000 off; negative goes backwards (set Off to FFFF)'],
          ['60 to 67', 'jump in the wave of the sounds playing, xxyy subticks (60 to 63) or ticks (64 to 67): 60 ahead, 61 back, 62 ahead and 63 back counted in the sound\'s playing speed; 64 to 67 the same in ticks'],
          ['30 to 32', 'a filter on each sound: 30 type (0 off, 1 low pass, 2 high pass, 3 and 4 band pass, 5 notch), 31 cutoff (0000 is 20 Hz, FFFF 20 kHz), 32 resonance'],
          ['33 / 34 / 35', 'cutoff slide down / up, XX semitones over YY subticks; 35 moves the cutoff that many semitones each repeat (8000 none, 0800 one semitone)'],
          ['38 / 39', 'humanize: a random cutoff up to XX.YY semitones, and each repeat late by up to XX.YY subticks'],
          ['40 to 42', 'vibrato: speed (the period in subticks, XXY.Y), depth (XX.YY semitones), wave (0 sine, 1 triangle, 2 square, 3 saw)'],
          ['43 to 45', 'cutoff LFO: speed, depth (semitones of cutoff), wave'],
          ['50 to 53', 'phases: 50 and 52 set the vibrato / cutoff LFO phase now, 51 and 53 make every note start at that phase (FFFF: free running)'],
          ['A0 to AF', 'reset to what the instrument starts with, additively: 1 the retrigger settings (shift, ramp, accel, step, flip, probability, limits, curve, cut scale, stretch), 2 humanization, 4 the filter, 8 vibrato and LFO. A0 and AF reset all'],
          ['70 / 71', 'save / load settings: XX which groups (added up as for Ax), YY one of 16 slots (00 to 0F), kept per lane. Handy for a texture you come back to'],
          ['1E subdivide', 'subticks in a tick, default 6: the unit of the slides\' time (a slide of XX subticks lasts XX/subdivide ticks)'],
          ['90 to 93', 'the same as 1A to 1D, with XX in tens of milliseconds, whatever the tempo (90 0A06: 6 dB down over 100 ms)'],
          ['11 flip', '0001: every repeat plays the other way round'],
          ['12 prob', 'chance a repeat sounds: FFFF always, 8000 half'],
          ['13 jOffset', 'random start, up to this fraction of the sample either way: FFFF is the whole sample'],
          ['14 jPitch', 'random pitch, up to this many semitones either way: FFFF is 12'],
          ['15 jPan', 'random pan: FFFF is anywhere from full left to full right'],
          ['16 jTime', 'each repeat late by a random part of the interval: FFFF up to a whole interval'],
          ['17 jLevel', 'random volume: FFFF down to silence at worst'],
        ],
      },
    ],
  },
  blur: {
    summary: 'Smears the sound across frequency and time, so it melts into a breathy wash.',
    best: ['Use it on a send, with mix partly open, to turn a sound into a pad.', 'Freeze holds the moment, so the sound hangs in the air until you release it.'],
    limits: ['It works in frames, so it adds delay (bigger size, more delay), and attacks are smeared whatever you do.'],
  },
};

const esc = t => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// The page as { title, html } for a node type and its definition.
export function helpPage(type, def) {
  const page = PAGES[type];
  const kinds = list => list.map(n => `${n} (${def.kinds?.[n] ?? 'audio'})`).join(', ') || 'none';
  const parts = [`<p class="hp-cat">${esc(def.category ?? '')}</p>`];
  if (page) {
    parts.push(`<p>${esc(page.summary)}</p>`);
    if (page.best.length) parts.push(`<h3>Getting the most out of it</h3><ul>${page.best.map(b => `<li>${esc(b)}</li>`).join('')}</ul>`);
    if (page.limits.length) parts.push(`<h3>Limits</h3><ul>${page.limits.map(b => `<li>${esc(b)}</li>`).join('')}</ul>`);
    for (const sec of page.sections ?? []) {   // longer explanations: paragraphs and command lists
      parts.push(`<h3>${esc(sec.title)}</h3>`);
      for (const t of sec.text ?? []) parts.push(`<p>${esc(t)}</p>`);
      if (sec.rows) parts.push(`<dl>${sec.rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>`);
    }
  } else parts.push('<p class="hp-none">There is no written page for this node yet. This is its list of parameters.</p>');
  parts.push(`<h3>Ports</h3><p>In: ${esc(kinds(def.inputs ?? []))}. Out: ${esc(kinds(def.outputs ?? []))}.</p>`);
  const rows = (def.params ?? []).map(spec => {
    const hint = hintFor(type, spec), facts = factsFor(spec);
    return `<dt>${esc(spec.name)}</dt><dd>${esc(hint)}${facts ? ` <span class="hp-f">${esc(typeof facts === 'string' ? facts : facts.join ? facts.join(', ') : '')}</span>` : ''}</dd>`;
  });
  if (rows.length) parts.push(`<h3>Parameters</h3><dl>${rows.join('')}</dl>`);
  return { title: type, html: parts.join('') };
}
