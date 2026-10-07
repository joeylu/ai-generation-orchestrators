import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createComponentCore } from '../src/workspace/component-contract.mjs';
import { loadWorkspaceCore } from '../src/component-adapter.mjs';
import { WORKSPACE_REQUIREMENTS } from '../src/workspace/requirements.mjs';
import { checkWorkspacePackage, checkWorkspaceDependencies, workspaceToolApi, loadWorkspaceTool } from '../scripts/lib/workspace-tools.mjs';

const compiler = { compileTree() {} };
const bundle = { createBundle() {}, validateBundle() {}, bundleResources() {} };
const contract = { UI_SCHEMA_VERSION: '0.2', validateDocument: value => structuredClone(value) };

test('component contract accepts the installed API and preserves its input overflow extension', async () => {
  const actual = await loadWorkspaceCore();
  assert.equal(typeof actual.compileTree, 'function');
  assert(Object.isFrozen(actual));
});

test('a matching old schema version cannot hide a missing Input capability', () => {
  const oldContract = { ...contract, validateDocument(value) {
    if (value.root.props.valueOverflow) throw new Error('Old contract diagnostic with private source context');
    return structuredClone(value);
  } };
  assert.throws(() => createComponentCore(compiler, oldContract, bundle), { message: 'COMPONENT_INPUT_OVERFLOW_UNSUPPORTED' });
  const lossyContract = { ...contract, validateDocument(value) {
    const result = structuredClone(value); delete result.root.props.valueOverflow; return result;
  } };
  assert.throws(() => createComponentCore(compiler, lossyContract, bundle), { message: 'COMPONENT_INPUT_OVERFLOW_UNSUPPORTED' });
});

test('unsupported schemas and incomplete module exports fail before compilation', () => {
  assert.throws(() => createComponentCore(compiler, { ...contract, UI_SCHEMA_VERSION: '0.1' }, bundle), { message: 'COMPONENT_SCHEMA_UNSUPPORTED' });
  assert.throws(() => createComponentCore(compiler, contract, { ...bundle, createBundle: undefined }), { message: 'COMPONENT_API_UNSUPPORTED' });
});

test('tools require declared identities and exact versions, including prototype property names', () => {
  for (const [name, version] of Object.entries(WORKSPACE_REQUIREMENTS.packages)) {
    assert.deepEqual(checkWorkspacePackage(name, { name, version }), { name, version });
    assert.throws(() => checkWorkspacePackage(name, { name, version: '0.0.0' }), { message: 'WORKSPACE_PACKAGE_VERSION' });
    assert.throws(() => checkWorkspacePackage(name, { name: 'other', version }), { message: 'WORKSPACE_PACKAGE_VERSION' });
  }
  for (const name of ['toString', '__proto__', '../unknown']) {
    assert.throws(() => checkWorkspacePackage(name, {}), { message: 'WORKSPACE_PACKAGE_UNDECLARED' });
  }
});

test('read-only workspace doctor reports portable evidence without host paths or model calls', async () => {
  const report = await checkWorkspaceDependencies();
  assert.equal(report.status, 'WORKSPACE_READY'); assert.equal(report.modelCalls, 0);
  assert.deepEqual(report.packages.map(item => item.name), Object.keys(WORKSPACE_REQUIREMENTS.packages));
  assert(!JSON.stringify(report).includes(fileURLToPath(new URL('../', import.meta.url))));
  assert.deepEqual(Object.keys(report).sort(), ['component', 'contractVersion', 'modelCalls', 'packages', 'status']);
  const result = spawnSync(process.execPath, ['scripts/check-workspace.mjs', '--unexpected'], {
    cwd: fileURLToPath(new URL('../', import.meta.url)), windowsHide: true, encoding: 'utf8', timeout: 10000,
  });
  assert.equal(result.status, 1);
  assert.deepEqual(JSON.parse(result.stderr), { status: 'FAILED', code: 'WORKSPACE_ARGUMENTS', modelCalls: 0 });
});

test('tool loading handles ESM and CommonJS entry points and rejects missing browser/build APIs', async () => {
  const playwright = { chromium: { launch() {} } }, vite = { build() {} };
  assert.equal(workspaceToolApi('@playwright/test', playwright), playwright);
  assert.equal(workspaceToolApi('@playwright/test', { default: playwright }), playwright);
  assert.equal(workspaceToolApi('vite', vite), vite);
  assert.equal(workspaceToolApi('vite', { default: vite }), vite);
  assert.throws(() => workspaceToolApi('@playwright/test', { default: {} }), { message: 'WORKSPACE_TOOL_API_UNSUPPORTED' });
  assert.throws(() => workspaceToolApi('vite', { build: 'not-a-function' }), { message: 'WORKSPACE_TOOL_API_UNSUPPORTED' });
  assert.equal(typeof (await loadWorkspaceTool('@playwright/test')).chromium.launch, 'function');
  assert.equal(typeof (await loadWorkspaceTool('vite')).build, 'function');
});
