// Kleiner Speedtest-Server ohne Abhängigkeiten.
// Liefert die App aus und stellt die Messpunkte bereit:
//   GET  /__down?bytes=N   -> N Bytes Zufallsdaten
//   POST /__up             -> Body wird gelesen und verworfen
// Start: node server/server.mjs   (Port über PORT=… änderbar)

import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = Number(process.env.PORT) || 8080;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MAX_DOWN = 200e6;
const CHUNK = randomBytes(1 << 20);

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png',
};

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': '*',
  'Cache-Control': 'no-store',
};

function down(req, res, bytes) {
  res.writeHead(200, { ...CORS, 'Content-Type': 'application/octet-stream', 'Content-Length': bytes });
  let left = bytes;
  const pump = () => {
    while (left > 0 && !res.destroyed) {
      const n = Math.min(left, CHUNK.length);
      left -= n;
      if (!res.write(n === CHUNK.length ? CHUNK : CHUNK.subarray(0, n))) return res.once('drain', pump);
    }
    res.end();
  };
  pump();
}

function up(req, res) {
  req.on('data', () => {});
  req.on('end', () => { res.writeHead(200, { ...CORS, 'Content-Type': 'text/plain' }); res.end('ok'); });
}

async function serveStatic(req, res, pathname) {
  if (pathname.endsWith('/')) pathname += 'index.html';
  const file = path.join(ROOT, path.normalize(decodeURIComponent(pathname)));
  if (!file.startsWith(ROOT + path.sep) || file.includes(`${path.sep}.`)) {
    res.writeHead(403); return res.end();
  }
  try {
    const data = await readFile(file);
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  } catch {
    res.writeHead(404); res.end('Nicht gefunden');
  }
}

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (req.method === 'OPTIONS') { res.writeHead(204, CORS); return res.end(); }
  if (url.pathname === '/__down') {
    const bytes = Math.max(0, Math.min(MAX_DOWN, Number(url.searchParams.get('bytes')) || 0));
    return down(req, res, Math.round(bytes));
  }
  if (url.pathname === '/__up' && req.method === 'POST') return up(req, res);
  if (req.method === 'GET') return serveStatic(req, res, url.pathname);
  res.writeHead(405); res.end();
}).listen(PORT, () => console.log(`Speedtest läuft auf http://localhost:${PORT}`));
