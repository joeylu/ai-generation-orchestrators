import { defineConfig } from '@playwright/test';
import base from './playwright.config.ts';
const output = process.env.UI_REFERENCE_TEST_OUTPUT || `test-results/reference-v2-${Date.now()}`;
export default defineConfig({ ...base, testMatch: ['reference-*.spec.ts', 'studio-handoff.spec.ts', 'studio-large-canvas.spec.ts', 'switch-state-images.spec.ts', 'raster-tabs-motion.spec.ts', 'scrollbar-insets.spec.ts', 'scroll-recoil.spec.ts', 'input-editing.spec.ts', 'value-text-bindings.spec.ts', 'select-option-icons.spec.ts'], outputDir: output,
  reporter: [['list'], ['json', { outputFile: `${output}/results.json` }]],
  webServer: undefined, globalSetup: './scripts/reference-test-setup.mjs',
});
