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
  } else parts.push('<p class="hp-none">There is no written page for this node yet. This is its list of parameters.</p>');
  parts.push(`<h3>Ports</h3><p>In: ${esc(kinds(def.inputs ?? []))}. Out: ${esc(kinds(def.outputs ?? []))}.</p>`);
  const rows = (def.params ?? []).map(spec => {
    const hint = hintFor(type, spec), facts = factsFor(spec);
    return `<dt>${esc(spec.name)}</dt><dd>${esc(hint)}${facts ? ` <span class="hp-f">${esc(typeof facts === 'string' ? facts : facts.join ? facts.join(', ') : '')}</span>` : ''}</dd>`;
  });
  if (rows.length) parts.push(`<h3>Parameters</h3><dl>${rows.join('')}</dl>`);
  return { title: type, html: parts.join('') };
}
