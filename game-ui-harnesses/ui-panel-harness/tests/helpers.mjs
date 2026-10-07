import { readFile } from 'node:fs/promises';
import { loadWorkspaceCore } from '../src/component-adapter.mjs';
export const core = await loadWorkspaceCore();
export const fixture = JSON.parse(await readFile(new URL('../examples/audio-settings.panel.json', import.meta.url), 'utf8'));
export const catalog = JSON.parse(await readFile(new URL('../catalog/modern-core.json', import.meta.url), 'utf8'));
export const copy = value => structuredClone(value);
export function freeze(value) { if (value && typeof value === 'object') { for (const child of Object.values(value)) freeze(child); Object.freeze(value); } return value; }
export function nodesOf(document) { const nodes = []; const visit = node => { nodes.push(node); for (const child of node.children ?? []) visit(child); }; visit(document.root); return nodes; }
