import { instruments } from '../instruments.js';
import { makePluck } from '../audio/sample.js';
import { song } from '../song.js';

// The built-in project. Its one sample is generated at the audio context's rate.
export const createDemoProject = sampleRate => ({
  song,
  instruments,
  samples: { pluck: { rate: sampleRate, data: makePluck(sampleRate) } },
});
