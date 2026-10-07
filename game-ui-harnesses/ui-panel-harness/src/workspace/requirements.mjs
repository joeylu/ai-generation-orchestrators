/** Explicit development contract; installation and production packaging are separate. */
export const WORKSPACE_REQUIREMENTS = Object.freeze({
  version: '0.1',
  component: Object.freeze({
    packageName: 'ai-ui-component-harness',
    schemaVersion: '0.2',
    capabilities: Object.freeze(['input-value-overflow-ellipsis']),
  }),
  packages: Object.freeze({
    'pixi.js': '8.20.1',
    vite: '8.2.2',
    '@playwright/test': '1.63.0',
  }),
});
