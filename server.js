import { createServer, request as httpRequest } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { MiniverseServer } from '@miniverse/server';

const port = parseInt(process.env.PORT || '4321', 10);
const apiPort = port + 1;

// Start miniverse API + WebSocket server on internal port
const mv = new MiniverseServer({ port: apiPort, publicDir: './public' });
await mv.start();
console.log(`[miniverse] API on internal port ${apiPort}`);

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.woff2': 'font/woff2',
};

const distDir = path.resolve('dist');
const publicDir = path.resolve('public');

function tryServe(res, filePath) {
  if (!existsSync(filePath) || !statSync(filePath).isFile()) return false;
  const ext = path.extname(filePath);
  res.writeHead(200, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=86400',
  });
  res.end(readFileSync(filePath));
  return true;
}

function proxy(req, res) {
  const opts = { hostname: '127.0.0.1', port: apiPort, path: req.url, method: req.method, headers: { ...req.headers, host: `127.0.0.1:${apiPort}` } };
  const p = httpRequest(opts, (pRes) => {
    res.writeHead(pRes.statusCode, pRes.headers);
    pRes.pipe(res);
  });
  p.on('error', () => { res.writeHead(502); res.end('Bad gateway'); });
  req.pipe(p);
}

const server = createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${port}`);

  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    res.end();
    return;
  }

  // Proxy API requests
  if (url.pathname.startsWith('/api/')) return proxy(req, res);

  // Serve static: dist first, then public
  const clean = decodeURIComponent(url.pathname);
  let fp = path.join(distDir, clean);
  if (clean === '/' || (!path.extname(clean) && !existsSync(fp))) {
    fp = path.join(distDir, 'index.html');
  }
  if (tryServe(res, fp)) return;

  fp = path.join(publicDir, clean);
  if (tryServe(res, fp)) return;

  res.writeHead(404);
  res.end('Not found');
});

// Proxy WebSocket upgrades
server.on('upgrade', (req, socket, head) => {
  const p = httpRequest({
    hostname: '127.0.0.1', port: apiPort, path: req.url,
    method: req.method, headers: { ...req.headers, host: `127.0.0.1:${apiPort}` },
  });
  p.on('upgrade', (pRes, pSocket) => {
    socket.write(
      `HTTP/1.1 101 Switching Protocols\r\n` +
      Object.entries(pRes.headers).map(([k, v]) => `${k}: ${v}`).join('\r\n') +
      '\r\n\r\n'
    );
    pSocket.pipe(socket);
    socket.pipe(pSocket);
  });
  p.on('error', () => socket.destroy());
  p.end();
});

server.listen(port, () => {
  console.log(`[miniverse-public] http://localhost:${port}`);
});

process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));
