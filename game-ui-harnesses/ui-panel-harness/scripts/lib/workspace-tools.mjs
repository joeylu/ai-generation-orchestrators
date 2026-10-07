/** Read-only development tool resolution. No installs, network or global configuration. */
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { WORKSPACE_REQUIREMENTS } from '../../src/workspace/requirements.mjs';

const componentPackage = new URL('../../../ui-component-harness/package.json', import.meta.url);
const requireComponent = createRequire(componentPackage);

export function checkWorkspacePackage(name, metadata) {
  const expected = WORKSPACE_REQUIREMENTS.packages[name];
  if (!Object.hasOwn(WORKSPACE_REQUIREMENTS.packages, name)) throw new Error('WORKSPACE_PACKAGE_UNDECLARED');
  if (metadata?.name !== name || metadata.version !== expected) throw new Error('WORKSPACE_PACKAGE_VERSION');
  return Object.freeze({ name, version: expected });
}

async function packageInfo(name) {
  if (!Object.hasOwn(WORKSPACE_REQUIREMENTS.packages, name)) throw new Error('WORKSPACE_PACKAGE_UNDECLARED');
  const url = new URL(`node_modules/${name}/package.json`, componentPackage);
  let metadata;
  try { metadata = JSON.parse(await readFile(url, 'utf8')); }
  catch { throw new Error('WORKSPACE_PACKAGE_MISSING'); }
  return { url, evidence: checkWorkspacePackage(name, metadata) };
}

export async function workspacePackageEvidence(name) {
  return (await packageInfo(name)).evidence;
}

export function workspaceToolApi(name, namespace) {
  if (!['vite', '@playwright/test'].includes(name)) throw new Error('WORKSPACE_TOOL_UNSUPPORTED');
  const usable = value => name === 'vite' ? typeof value?.build === 'function' : typeof value?.chromium?.launch === 'function';
  // Package exports may resolve to ESM or CommonJS. Check the API, not the filename.
  if (usable(namespace)) return namespace;
  if (usable(namespace?.default)) return namespace.default;
  throw new Error('WORKSPACE_TOOL_API_UNSUPPORTED');
}

export async function loadWorkspaceTool(name) {
  await packageInfo(name);
  if (!['vite', '@playwright/test'].includes(name)) throw new Error('WORKSPACE_TOOL_UNSUPPORTED');
  if (name === 'vite') await packageInfo('pixi.js');
  try { return workspaceToolApi(name, await import(pathToFileURL(requireComponent.resolve(name)).href)); }
  catch { throw new Error('WORKSPACE_TOOL_LOAD_FAILED'); }
}

export async function readPixiLicense() {
  const { url } = await packageInfo('pixi.js');
  try { return await readFile(new URL('LICENSE', url), 'utf8'); }
  catch { throw new Error('WORKSPACE_LICENSE_MISSING'); }
}

export async function checkWorkspaceDependencies() {
  let metadata;
  try { metadata = JSON.parse(await readFile(componentPackage, 'utf8')); }
  catch { throw new Error('WORKSPACE_COMPONENT_MISSING'); }
  if (metadata.name !== WORKSPACE_REQUIREMENTS.component.packageName) throw new Error('WORKSPACE_COMPONENT_IDENTITY');
  const { loadWorkspaceCore } = await import('../../src/component-adapter.mjs');
  try { await loadWorkspaceCore(); }
  catch (error) {
    if (/^COMPONENT_[A-Z_]+$/.test(error.message ?? '')) throw error;
    throw new Error('WORKSPACE_COMPONENT_LOAD_FAILED');
  }
  const packages = await Promise.all(Object.keys(WORKSPACE_REQUIREMENTS.packages).map(workspacePackageEvidence));
  await Promise.all(['vite', '@playwright/test'].map(loadWorkspaceTool));
  return { status: 'WORKSPACE_READY', contractVersion: WORKSPACE_REQUIREMENTS.version,
    component: WORKSPACE_REQUIREMENTS.component, packages, modelCalls: 0 };
}
