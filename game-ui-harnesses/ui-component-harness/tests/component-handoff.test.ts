import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { importAndApplyComponentHandoff } from '../src/component-handoff.ts';
import { DecompositionImportError, importComponentHandoffArchive } from '../src/decomposition-import.ts';
import { appearanceDocumentSha256 } from '../src/appearance-binding.ts';
import { walkNodes } from '../src/tree-contract.ts';
import { appearanceApplicationFixture } from './helpers/appearance-application-fixture.ts';
import { forceZip64Stored } from './helpers/decomposition-fixture.ts';

const encoder = new TextEncoder();
const cli = fileURLToPath(new URL('../scripts/cli.mjs', import.meta.url));
function runCli(directory: string, ...args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise(resolve => {
    const child = spawn(process.execPath, [cli, ...args], { cwd: directory, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = ''; let stderr = '';
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('close', code => resolve({ code: code ?? 1, stdout, stderr }));
  });
}
async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new Uint8Array(bytes).buffer);
  return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
}

async function outerArchive(options: { badBundleDigest?: boolean; invisibleRoot?: boolean } = {}) {
  const { fixture, target, binding } = await appearanceApplicationFixture();
  const componentBundle = structuredClone(target);
  const appearanceBinding = structuredClone(binding);
  if (options.invisibleRoot && componentBundle.document.schemaVersion === '0.2') {
    componentBundle.document.root.props.style.opacity = 0;
    appearanceBinding.documentSha256 = await appearanceDocumentSha256(componentBundle.document);
  }
  const bundleBytes = encoder.encode(`${JSON.stringify(componentBundle, null, 2)}\n`);
  const bindingBytes = encoder.encode(`${JSON.stringify(appearanceBinding, null, 2)}\n`);
  const manifest = {
    kind: 'ai_ui_component_handoff_v1', status: 'contracts_packaged_unreviewed_draft',
    decomposition: { path: 'decomposition/layered-fixture.draft.zip', sha256: await sha256(fixture.zip) },
    component_bundle: { path: 'component.ui-bundle.json', sha256: options.badBundleDigest ? '0'.repeat(64) : await sha256(bundleBytes) },
    appearance_binding: { path: 'appearance-binding.json', sha256: await sha256(bindingBytes) },
    delivery_policy: 'unreviewed_draft', human_visual_acceptance: false,
  };
  return forceZip64Stored([
    { name: 'appearance-binding.json', bytes: bindingBytes },
    { name: 'component.ui-bundle.json', bytes: bundleBytes },
    { name: 'decomposition/layered-fixture.draft.zip', bytes: fixture.zip },
    { name: 'handoff.json', bytes: encoder.encode(`${JSON.stringify(manifest, null, 2)}\n`) },
  ]);
}

test('one outer archive authenticates decomposition, semantics and binding then produces a runnable bundle', async () => {
  const archive = await outerArchive();
  const imported = await importComponentHandoffArchive(archive);
  assert.equal(imported.decomposition.layers.length, 7);
  assert.equal(imported.review.humanVisualAcceptance, false);
  const bundle = await importAndApplyComponentHandoff(archive);
  const nodes = new Map(walkNodes(bundle.document).map(node => [node.id, node]));
  assert.ok(nodes.get('apply-button')?.props.appearance);
  assert.ok(nodes.get('apply-switch')?.props.appearance);
  assert.ok(nodes.get('apply-select')?.props.appearance);
  assert.equal(bundle.resources.length, 6);
});

test('outer archive rejects a stale component bundle fingerprint before contract application', async () => {
  await assert.rejects(importAndApplyComponentHandoff(await outerArchive({ badBundleDigest: true })),
    (error: unknown) => error instanceof DecompositionImportError && error.code === 'COMPONENT_HANDOFF_BUNDLE_DIGEST');
});

test('outer archive rejects a fully transparent root instead of producing a blank runtime', async () => {
  const archive = await outerArchive({ invisibleRoot: true });
  await assert.rejects(importAndApplyComponentHandoff(archive),
    (error: unknown) => error instanceof DecompositionImportError && error.code === 'COMPONENT_HANDOFF_INVISIBLE_ROOT');
});

test('CLI rejects a fully transparent root without writing a blank bundle', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ai-ui-component-handoff-invisible-cli-'));
  await writeFile(join(directory, 'handoff.zip'), await outerArchive({ invisibleRoot: true }));
  const output = join(directory, 'ui-bundle.json');
  const result = await runCli(directory, 'component-handoff', 'handoff.zip', '--output', output);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /COMPONENT_HANDOFF_INVISIBLE_ROOT/);
  await assert.rejects(readFile(output), (error: any) => error?.code === 'ENOENT');
});

test('CLI consumes the one-file handoff and writes a validated portable bundle', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ai-ui-component-handoff-cli-'));
  await writeFile(join(directory, 'handoff.zip'), await outerArchive());
  const result = await runCli(directory, 'component-handoff', 'handoff.zip', '--output', 'ui-bundle.json');
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stdout, '');
  const bundle = JSON.parse(await readFile(join(directory, 'ui-bundle.json'), 'utf8'));
  assert.equal(bundle.bundleVersion, '0.1');
  assert.equal(bundle.document.schemaVersion, '0.2');
  assert.equal(bundle.resources.length, 6);
});
