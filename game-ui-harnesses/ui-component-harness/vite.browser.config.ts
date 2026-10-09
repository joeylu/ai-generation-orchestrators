import { defineConfig } from 'vite';
/** Self-contained optional browser build, with this release's Pixi version. */
export default defineConfig({ build: {
  outDir: 'dist-browser',
  lib: { entry: 'src/browser.ts', formats: ['es'], fileName: () => 'index.js' },
  rollupOptions: { output: { codeSplitting: false } },
} });
