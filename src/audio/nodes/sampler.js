// Voice-aware sample player. Per-voice state lives in typed arrays.
const VOICES = 8;
const LEVEL = 0, ROOT = 1, RELEASE = 2;

export default {
  type: 'sampler',
  inputs: [],
  outputs: ['out'],
  params: [
    { name: 'level', min: 0, max: 1, def: 0.8 },
    { name: 'root', min: 0, max: 127, def: 60 },
    { name: 'release', min: 5, max: 2000, def: 150 },
  ],
  create({ sampleRate }) {
    let sample = null, ratio = 1, stamp = 0;
    const active = new Uint8Array(VOICES), released = new Uint8Array(VOICES);
    const note = new Int32Array(VOICES);
    const pos = new Float64Array(VOICES), age = new Float64Array(VOICES);
    const gain = new Float32Array(VOICES), env = new Float32Array(VOICES);
    const attack = 1 / (0.002 * sampleRate);

    return {
      message(msg) {
        if (msg.type === 'sample') {
          sample = msg.data;
          ratio = msg.rate / sampleRate;
        }
      },
      note(msg) {
        if (msg.type === 'noteOn') {
          let v = active.indexOf(0);
          if (v < 0) {
            v = 0;
            for (let k = 1; k < VOICES; k++) if (age[k] < age[v]) v = k;
          }
          active[v] = 1; released[v] = 0; note[v] = msg.note;
          pos[v] = 0; gain[v] = msg.vel ?? 1; env[v] = 0; age[v] = ++stamp;
        } else if (msg.type === 'noteCut') {
          active.fill(0);
        } else if (msg.type === 'noteOff') {
          for (let v = 0; v < VOICES; v++) {
            if (active[v] && !released[v] && note[v] === msg.note) released[v] = 1;
          }
        }
      },
      process(inputs, outputs, n, params, slots) {
        const out = outputs[0];
        out.fill(0, 0, n);
        if (!sample) return;
        const level = params[slots[LEVEL]], root = params[slots[ROOT]];
        const relStep = 1 / (params[slots[RELEASE]] * 0.001 * sampleRate);
        const last = sample.length - 1;
        for (let v = 0; v < VOICES; v++) {
          if (!active[v]) continue;
          const rate = Math.pow(2, (note[v] - root) / 12) * ratio;
          let p = pos[v], e = env[v];
          for (let i = 0; i < n; i++) {
            if (p >= last) { active[v] = 0; break; }
            if (released[v]) {
              e -= relStep;
              if (e <= 0) { active[v] = 0; break; }
            } else if (e < 1) {
              e = Math.min(1, e + attack);
            }
            const k = p | 0, f = p - k;
            out[i] += (sample[k] + (sample[k + 1] - sample[k]) * f) * e * gain[v] * level;
            p += rate;
          }
          pos[v] = p; env[v] = e;
        }
      },
    };
  },
};
