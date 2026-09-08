import { defineConfig, loadEnv } from 'vite';
declare const process: { env: Record<string, string | undefined> };
// @ts-expect-error This Node-only local middleware is intentionally a .mjs module without browser declarations.
import { createVisionBridgePlugin } from './scripts/studio-vision.mjs';
export default defineConfig(({ mode }) => {
  // Only server-side adapter settings; never expose these through VITE_ defines.
  const settings = loadEnv(mode, '.', 'UI_VISION_');
  for (const name of ['UI_VISION_ADAPTER', 'UI_VISION_MCP_URL', 'UI_VISION_MCP_KEY_FILE', 'UI_VISION_MCP_STATE_DIR']) {
    if (settings[name]) process.env[name] = settings[name];
  }
  return {
  base: './',
  build: { rollupOptions: { input: {
    studio: 'index.html',
    workbench: 'workbench.html',
  } } },
  server: { host: '127.0.0.1', port: 4173, strictPort: true },
  preview: { host: '127.0.0.1', port: 4173, strictPort: true },
  plugins: [createVisionBridgePlugin()],
  };
});
