import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';

// Serve only the separately built mockup, on loopback. There are no API handlers.
const root = resolve('tmp/pro-onboarding-app/browser');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.svg': 'image/svg+xml', '.woff': 'font/woff', '.woff2': 'font/woff2', '.png': 'image/png' };
const server = createServer(async (request, response) => {
  response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; connect-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; img-src 'self' data:; frame-src 'self'; object-src 'none'; form-action 'none'");
  response.setHeader('Cache-Control', 'no-store');
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405).end(); return;
  }
  try {
    const url = new URL(request.url, 'http://localhost');
    if (url.pathname === '/mobile') {
      const width = url.searchParams.get('width') === '320' ? 320 : 390;
      const state = ['start', 'importing', 'ready'].includes(url.searchParams.get('state')) ? url.searchParams.get('state') : 'start';
      const theme = url.searchParams.get('theme') === 'light' ? 'light' : 'dark';
      response.setHeader('Content-Type', 'text/html');
      response.end(`<!doctype html><html><head><title>Pro setup ${width}px preview</title><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0"><iframe title="Phone preview" src="/?state=${state}&theme=${theme}" style="width:${width}px;height:1500px;border:0;display:block"></iframe></body></html>`);
      return;
    }
    const path = resolve(root, '.' + decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
    if (!path.startsWith(root + sep)) { response.writeHead(404).end(); return; }
    const bytes = await readFile(path);
    response.setHeader('Content-Type', types[extname(path)] || 'application/octet-stream');
    response.end(request.method === 'HEAD' ? undefined : bytes);
  } catch { response.writeHead(404).end(); }
});
server.listen(0, '127.0.0.1', () => {
  console.log(`Local app mockup: http://127.0.0.1:${server.address().port}`);
  console.log('States: /?state=start, /?state=importing, /?state=ready; phone: /mobile?width=390');
});
