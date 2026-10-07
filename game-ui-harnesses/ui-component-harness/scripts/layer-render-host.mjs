/** Local static acceptance host. No model, API middleware, writable routes or proxy. */
import { createServer } from 'node:http';
import { lstat, readFile, realpath } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, sep, extname } from 'node:path';
import { randomInt } from 'node:crypto';
export { checkLayerPlanRender } from './studio-layer-render.mjs';
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.woff2': 'font/woff2', '.png': 'image/png', '.svg': 'image/svg+xml' };
export async function startLayerRenderServer({ directory = fileURLToPath(new URL('../dist/', import.meta.url)), port = 0 } = {}) {
  // Chromium's restricted-port list ends at 10080. Keep explicit/fallback ports
  // above it; do not disable browser safety checks to make a renderer pass.
  if (!Number.isInteger(port) || (port !== 0 && (port < 16384 || port > 65535))) throw Error('LAYER_RENDER_PORT_INVALID');
  const root = await realpath(directory);
  if (!(await lstat(resolve(root, 'layer-plan-check.html'))).isFile()) throw Error('LAYER_RENDER_ENTRY_MISSING');
  const server = createServer(async (request, response) => {
    const reject = status => { response.writeHead(status, { 'Cache-Control': 'no-store' }); response.end(); };
    try {
      if (request.headers.host !== `127.0.0.1:${server.address().port}`) { reject(403); return; }
      if (!['GET', 'HEAD'].includes(request.method)) { reject(405); return; }
      const url = new URL(request.url, 'http://127.0.0.1');
      const pathname = decodeURIComponent(url.pathname);
      if (url.search || !(pathname === '/layer-plan-check.html' || /^\/assets\/[a-zA-Z0-9._-]+$/.test(pathname))) { reject(404); return; }
      const file = resolve(root, '.' + pathname), stat = await lstat(file), actual = await realpath(file);
      if (!actual.startsWith(root + sep) || stat.isSymbolicLink() || !stat.isFile() || !mime[extname(file)]) { reject(404); return; }
      const bytes = await readFile(file);
      response.writeHead(200, { 'Content-Type': mime[extname(file)], 'Content-Length': bytes.length, 'Cache-Control': 'no-store' });
      response.end(request.method === 'HEAD' ? undefined : bytes);
    } catch { reject(404); }
  });
  const listen = value => new Promise((resolveReady, reject) => {
    const failed = error => { server.off('listening', ready); reject(error); };
    const ready = () => { server.off('error', failed); resolveReady(); };
    server.once('error', failed); server.once('listening', ready); server.listen(value, '127.0.0.1');
  });
  await listen(port);
  if (server.address().port < 16384) {
    await new Promise((resolveClosed, reject) => server.close(error => error ? reject(error) : resolveClosed()));
    for (let attempt = 0; attempt < 32; attempt++) {
      try { await listen(randomInt(16384, 65536)); break; }
      catch (error) { if (!['EADDRINUSE', 'EACCES'].includes(error.code) || attempt === 31) throw error; }
    }
  }
  let closing;
  return { origin: `http://127.0.0.1:${server.address().port}`,
    close: () => closing ??= new Promise((resolveClosed, reject) => { server.close(error => error ? reject(error) : resolveClosed()); server.closeIdleConnections(); }) };
}
