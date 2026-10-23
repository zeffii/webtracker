#!/usr/bin/env node
// OSC relay: a page in the browser cannot send UDP, so Wax sends each OSC message over a WebSocket to this script, and this
// script sends it on as a UDP packet. No packages needed.
//   node tools/osc-relay.mjs [--port 8765] [--to 127.0.0.1:8000] [--log]
// --port   where Wax connects (Wax's setting "OSC relay port")
// --to     where the OSC goes: Renoise's OSC server (Preferences > OSC), Max's udpreceive, and so on
import http from 'node:http';
import dgram from 'node:dgram';
import crypto from 'node:crypto';

const arg = (name, def) => { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : def; };
const port = Number(arg('port', 8765));
const [host, udpPort] = arg('to', '127.0.0.1:8000').split(':');
const log = process.argv.includes('--log');
const udp = dgram.createSocket('udp4');

const str = (b, at) => { let e = at; while (b[e] !== 0 && e < b.length) e++; return [b.toString('utf8', at, e), at + ((e - at + 4) & ~3)]; };
const show = b => { try { const [a, at] = str(b, 0), [tags, at2] = str(b, at); let p = at2; const args = []; for (const t of tags.slice(1)) { if (t === 'i') { args.push(b.readInt32BE(p)); p += 4; } else if (t === 'f') { args.push(+b.readFloatBE(p).toFixed(3)); p += 4; } else if (t === 's') { const [s, q] = str(b, p); args.push(s); p = q; } } return `${a} ${args.join(' ')}`; } catch { return `${b.length} bytes`; } };

const server = http.createServer((req, res) => { res.writeHead(426); res.end('This is the OSC relay for Wax: connect with a WebSocket.'); });
server.on('upgrade', (req, socket) => {
  const key = req.headers['sec-websocket-key'];
  if (!key) return socket.destroy();
  const accept = crypto.createHash('sha1').update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64');
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
  console.log('Wax connected.');
  let buf = Buffer.alloc(0);
  socket.on('data', chunk => {
    buf = Buffer.concat([buf, chunk]);
    for (;;) {   // a frame: 2 header bytes, the length (7, 16 or 64 bits), a 4-byte mask (browsers always mask) and the payload
      if (buf.length < 2) return;
      const op = buf[0] & 0x0f, masked = (buf[1] & 0x80) !== 0;
      let len = buf[1] & 0x7f, at = 2;
      if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); at = 4; } else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); at = 10; }
      if (buf.length < at + (masked ? 4 : 0) + len) return;
      const mask = masked ? buf.subarray(at, at + 4) : null;
      if (masked) at += 4;
      const payload = Buffer.from(buf.subarray(at, at + len));
      if (mask) for (let i = 0; i < len; i++) payload[i] ^= mask[i & 3];
      buf = buf.subarray(at + len);
      if (op === 8) return socket.end();
      if (op === 9) { socket.write(Buffer.from([0x8a, 0])); continue; }   // ping: pong
      if (op === 2 || op === 1) { udp.send(payload, Number(udpPort), host); if (log) console.log(show(payload)); }
    }
  });
  socket.on('close', () => console.log('Wax disconnected.'));
  socket.on('error', () => {});
});
server.listen(port, '127.0.0.1', () => console.log(`OSC relay: ws://localhost:${port}  ->  udp ${host}:${udpPort}${log ? ' (logging)' : ''}`));
