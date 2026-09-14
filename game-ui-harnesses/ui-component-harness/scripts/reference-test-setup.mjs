import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';

/** In-process ownership avoids Playwright's shell/taskkill teardown on Windows. */
export default async function setup() {
  if (process.env.UI_HARNESS_EXTERNAL_SERVER === '1') return;
  const server = await createServer({ root: fileURLToPath(new URL('../', import.meta.url)), server: { host: '127.0.0.1', port: 4173, strictPort: true } });
  try { await server.listen(); } catch (error) { await server.close(); throw error; }
  return async () => { await server.close(); };
}
