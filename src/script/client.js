// Runs a script request in a Worker, with a time limit. A run that goes over is ended (the Worker is terminated) and
// reports a stop, with nothing changed; the next run starts a fresh Worker.
export function createScriptRunner({ limit = () => 2000, make = () => new Worker(new URL('./worker.js', import.meta.url), { type: 'module' }) } = {}) {
  let worker = null, next = 1, busy = false;
  const run = req => new Promise(resolve => {
    if (busy) { resolve({ ok: false, error: { message: 'A script is still running.' } }); return; }
    busy = true;
    let w;
    try { w = worker ??= make(); } catch (err) { busy = false; resolve({ ok: false, error: { message: `Scripts need Web Workers: ${err.message}` } }); return; }
    const id = next++, ms = limit();
    const finish = res => { clearTimeout(timer); w.removeEventListener('message', onMessage); w.removeEventListener('error', onError); busy = false; resolve(res); };
    const onMessage = e => { if (e.data?.id === id) finish(e.data); };
    const onError = e => { if (worker === w) worker = null; w.terminate(); finish({ ok: false, error: { message: e.message || 'The script worker failed to start.' } }); };
    const timer = setTimeout(() => {
      if (worker === w) worker = null;
      w.terminate();
      finish({ ok: false, killed: true, error: { message: `Stopped: the script ran for more than ${ms / 1000} s. Nothing was changed.` } });
    }, ms);
    w.addEventListener('message', onMessage);
    w.addEventListener('error', onError);
    w.postMessage({ id, ...req });
  });
  return { run, dispose() { worker?.terminate(); worker = null; }, get busy() { return busy; } };
}
