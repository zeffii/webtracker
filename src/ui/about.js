// The About box: how this came about, and what changed in each build, newest first.
export const ABOUT = [
  'Wax is a tracker that lives in the browser: patterns you type on a grid, played by instruments you build out of a graph of nodes. It is the successor of ztracker, a tracker built in Max/MSP, and it grew up looking at the machines that made tracking worth doing: the grid and the speed of the old trackers, the machines-and-wires thinking of Buzz and Buze, and the patching of modular synths and Reaktor.',
  'It is made in conversation. One of us has the ear and the ideas, tries each build in the browser and says what is wrong or missing; the other writes the code, checks it against a test suite and sends the next build back. Big features are talked through first, with no code until the idea is right; small polish goes round in minutes. Most of these features come from the author\'s longstanding wish-list, but some emerged in conversation and in reflection after implementation.',
  'It is meant for making real music, techno especially, and it is experimental on purpose.',
  'I think you\'ll like it.',
];

export const CHANGELOG = [
  ['561', ['Pattern editor fills down to the status bar; scrolling it is lighter and a wheel notch moves further']],
  ['560', ['Stream Manager columns are fixed width, so they stop jumping as numbers and names change']],
  ['559', ['Delay compensation moves the playhead to where the sound is; Snarl note off fixes']],
  ['558', ['Delay compensation between instruments: quicker machines wait for the slowest, so heavy spectral nodes stay on the beat; one setting switches all of it off']],
  ['557', ['Delay compensation inside an instrument: where a quick path meets a slow one (dry sound and a spectral or oversampled branch), the quick one is delayed to match; setting Delay compensation, on by default']],
  ['556', ['Delay compensation, first step: spectral and oversampled nodes declare how late they are, and the status bar shows the slowest instrument as chain N ms']],
  ['555', ['New synth, Snarl: two resonant filters in a row (high-pass, then low-pass), ring mod, two envelopes and a modulation generator, for screaming leads and growling basses']],
  ['554', ['New synth, Jaw harp: a plucked reed drones and the mouth picks out its harmonics; sweep the vowel for the wah and the tune']],
  ['553', ['New effect, Body blur (Effects, Spectral): smooths and rounds the body of a sound while its hits pass through untouched, in time; standard or eco quality']],
  ['552', ['New demo, ?demo=weights: chords with a volume for every note, played in turn by a Phrase node, with a pad moved by lfos']],
    ];
