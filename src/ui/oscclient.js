// The link to the OSC relay (tools/osc-relay.mjs): a WebSocket on this computer that passes each binary message on as UDP.
// It connects when the first message is sent, tries again a couple of seconds after a failure, and tells onState what happened.
import { encodeMessage } from '../osc.js';

export function createOscClient({ port, onState = () => {}, WS = globalThis.WebSocket, now = () => performance.now() }) {
  let ws = null, failedAt = -Infinity, up = false, sent = 0, waiting = [];   // waiting: what was sent while the link was still opening
  const connect = () => {
    if (ws || !WS || now() - failedAt < 2000) return;
    try { ws = new WS(`ws://localhost:${port()}`); } catch { failedAt = now(); onState({ up: false, error: 'bad address' }); return; }
    ws.binaryType = 'arraybuffer';
    ws.onopen = () => { up = true; onState({ up: true }); const late = waiting; waiting = []; for (const [t, address, args] of late) if (now() - t < 1000) { ws.send(encodeMessage(address, args)); sent++; } };
    ws.onclose = ws.onerror = () => { const was = up; up = false; ws = null; waiting = []; failedAt = now(); onState({ up: false, error: was ? 'the relay closed the link' : `no OSC relay on port ${port()} (run: node tools/osc-relay.mjs)` }); };
  };
  return {
    send(address, args) {
      if (!ws) connect();
      if (!up) { if (ws && waiting.length < 64) waiting.push([now(), address, args]); return false; }
      ws.send(encodeMessage(address, args));
      sent++;
      return true;
    },
    get up() { return up; },
    get sent() { return sent; },
    close() { try { ws?.close(); } catch { /* already closed */ } ws = null; up = false; },
  };
}
