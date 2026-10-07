import { defineConfig, loadEnv } from 'vite';
declare const process: { env: Record<string, string | undefined> };
// @ts-expect-error This Node-only local middleware is intentionally a .mjs module without browser declarations.
import { createVisionBridgePlugin } from './scripts/studio-vision.mjs';
// @ts-expect-error Node-only optional planning bridge.
import { createLayerPlanBridgePlugin } from './scripts/studio-layer-plan.mjs';
export default defineConfig(({ mode }) => {
  // Only server-side adapter settings; never expose these through VITE_ defines.
  const settings = loadEnv(mode, '.', 'UI_VISION_');
  for (const name of ['UI_VISION_ADAPTER', 'UI_VISION_MCP_URL', 'UI_VISION_MCP_KEY_FILE', 'UI_VISION_MCP_STATE_DIR']) {
    if (settings[name]) process.env[name] = settings[name];
  }
  const plannerSettings = loadEnv(mode, '.', 'UI_COMPONENT_CODEX_');
  for (const name of ['UI_COMPONENT_CODEX_COMMAND', 'UI_COMPONENT_CODEX_MODEL', 'UI_COMPONENT_CODEX_EFFORT']) {
    if (plannerSettings[name]) process.env[name] = plannerSettings[name];
  }
  return {
  base: './',
  build: { rollupOptions: { input: {
    studio: 'index.html',
    workbench: 'workbench.html',
    referenceAcceptance: 'reference-acceptance.html',
    layerPlanCheck: 'layer-plan-check.html',
  } } },
  server: { host: '127.0.0.1', port: 4173, strictPort: true },
  preview: { host: '127.0.0.1', port: 4173, strictPort: true },
  plugins: [createVisionBridgePlugin(), createLayerPlanBridgePlugin()],
  };
});
