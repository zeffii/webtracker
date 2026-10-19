// Recording a sample from outside the tracker: another browser tab or the screen's audio (the browser's share picker),
// or an input device (a microphone, an interface, a loopback). The audio goes through a worklet into memory and becomes
// a new sample when you stop. Nothing here touches the project; main.js adds the sample.
export const MAX_SECONDS = 300;
export const SOUND_LEVEL = 0.01;   // about -40 dB: "start on sound" waits for this

// Joins the recorded blocks into one sample: mono when both sides are the same, otherwise stereo.
export function finishTake(lefts, rights) {
  const n = lefts.reduce((a, c) => a + c.length, 0), data = new Float32Array(n), right = new Float32Array(n);
  let o = 0;
  lefts.forEach((c, i) => { data.set(c, o); right.set(rights[i], o); o += c.length; });
  let same = true;
  for (let i = 0; i < n; i++) if (Math.abs(data[i] - right[i]) > 1e-5) { same = false; break; }
  return same ? { data } : { data, right };
}

const RAW = { echoCancellation: false, noiseSuppression: false, autoGainControl: false };

export function createRecorder({ getCtx, onLevel = () => {}, onEnd = () => {}, media = () => (typeof navigator === 'undefined' ? null : navigator.mediaDevices) }) {
  let node = null, source = null, stream = null, sink = null;
  let lefts = [], rights = [], frames = 0, waiting = false, pre = null, loaded = null, ending = false;
  const state = { recording: false, level: 0, seconds: 0 };

  async function inputs() {
    const m = media(); if (!m?.enumerateDevices) return [];
    return (await m.enumerateDevices()).filter(d => d.kind === 'audioinput').map((d, i) => ({ id: d.deviceId, label: d.label || `Input ${i + 1}` }));
  }

  // source: 'display' (the share picker) or an input device id. waitForSound holds the take until something is heard.
  async function start(src, { waitForSound = false } = {}) {
    const m = media(), ctx = getCtx();
    if (!m || !ctx) throw new Error('Recording is not available in this browser.');
    if (state.recording) return;
    if (src === 'display') {
      if (!m.getDisplayMedia) throw new Error('This browser cannot share tab audio. Use Chrome or Edge.');
      stream = await m.getDisplayMedia({ video: true, audio: { ...RAW, suppressLocalAudioPlayback: false }, systemAudio: 'include' });
      stream.getVideoTracks().forEach(t => t.stop());   // only the sound is wanted
      if (!stream.getAudioTracks().length) { stream.getTracks().forEach(t => t.stop()); stream = null; throw new Error('No audio was shared. Pick a tab and tick "Also share tab audio".'); }
    } else {
      stream = await m.getUserMedia({ audio: { ...(src ? { deviceId: { exact: src } } : {}), ...RAW, channelCount: 2 } });
    }
    if (!loaded) loaded = ctx.audioWorklet.addModule(new URL('../audio/recorder-worklet.js', import.meta.url));
    await loaded;
    source = ctx.createMediaStreamSource(stream);
    node = new AudioWorkletNode(ctx, 'recorder', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1], channelCount: 2, channelCountMode: 'explicit', channelInterpretation: 'speakers' });
    sink = ctx.createGain(); sink.gain.value = 0;   // a node nobody listens to still has to be pulled
    source.connect(node); node.connect(sink); sink.connect(ctx.destination);
    lefts = []; rights = []; frames = 0; pre = null; waiting = waitForSound; ending = false;
    node.port.onmessage = ({ data }) => {
      state.level = data.peak; onLevel(data.peak);
      if (ending) return;
      if (waiting) { if (data.peak < SOUND_LEVEL) { pre = data; return; } waiting = false; if (pre) add(pre); pre = null; }
      add(data);
    };
    stream.getAudioTracks().forEach(t => t.addEventListener('ended', () => { if (state.recording) onEnd(stop()); }));   // "Stop sharing" in the browser bar
    node.port.postMessage('start');
    state.recording = true; state.seconds = 0; state.level = 0;
  }

  function add(chunk) {
    const room = MAX_SECONDS * getCtx().sampleRate - frames;
    if (room <= 0) return;
    const n = Math.min(room, chunk.l.length);
    lefts.push(n < chunk.l.length ? chunk.l.subarray(0, n) : chunk.l); rights.push(n < chunk.r.length ? chunk.r.subarray(0, n) : chunk.r);
    frames += n; state.seconds = frames / getCtx().sampleRate;
    if (frames >= MAX_SECONDS * getCtx().sampleRate && state.recording) queueMicrotask(() => state.recording && onEnd(stop()));
  }

  // Ends the take and returns { data, right?, rate, seconds }, or null when nothing was kept.
  function stop() {
    if (!state.recording) return null;
    state.recording = false; ending = true;
    const ctx = getCtx();
    node.port.postMessage('stop');   // the last partial block arrives after this; it is dropped, a few ms
    stream.getTracks().forEach(t => t.stop());
    try { source.disconnect(); node.disconnect(); sink.disconnect(); } catch { /* already gone */ }
    node = source = sink = stream = null;
    state.level = 0;
    if (!frames) return null;
    const take = finishTake(lefts, rights);
    lefts = []; rights = [];
    return { ...take, rate: ctx.sampleRate, seconds: take.data.length / ctx.sampleRate };
  }

  return { state, inputs, start, stop };
}
