// Tiny static server. Sends the cross-origin isolation headers that
// SharedArrayBuffer needs. Run with: node serve.mjs
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { versionInfo } from './scripts/stamp.mjs';

const root = resolve(fileURLToPath(new URL('.', import.meta.url)));
const port = Number(process.env.PORT) || 8080;
const js = 'text/javascript; charset=utf-8';
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': js,
  '.mjs': js,
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};
const base = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
  'Cache-Control': 'no-store',
};

createServer(async (req, res) => {
  try {
    const { pathname } = new URL(req.url, 'http://localhost');
    if (pathname === '/version.json') {   // from git, with a + after the commit while there are uncommitted changes (Pages gets a stamped file instead)
      res.writeHead(200, { ...base, 'Content-Type': types['.json'] });
      return res.end(JSON.stringify(versionInfo()));
    }
    const rel = decodeURIComponent(pathname === '/' ? '/index.html' : pathname);
    const file = resolve(join(root, normalize(rel)));
    if (file !== root && !file.startsWith(root + sep)) {
      res.writeHead(403, base);
      return res.end('Forbidden');
    }
    const body = await readFile(file);
    res.writeHead(200, { ...base, 'Content-Type': types[extname(file)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404, base);
    res.end('Not found');
  }
}).listen(port, () => console.log(`http://localhost:${port}`));
