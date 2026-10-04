import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile, stat, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { createPlanningContext } from '../src/planning-context.mjs';
import { proposalTargets } from '../src/proposal.mjs';
import { digestJson } from '../src/canonical.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const catalogPath = join(root, 'examples/modern-mint-controls.catalog.json');
const json = async path => JSON.parse(await readFile(path, 'utf8'));
const catalog = await json(catalogPath), spec = await json(join(root, 'examples/settings-controls.panel.json'));
await mkdir(join(root, '.tmp'), { recursive: true });
const work = await mkdtemp(join(root, '.tmp', 'workbench-build-'));
const run = (...args) => spawnSync(process.execPath, ['scripts/build-workbench.mjs', ...args],
  { cwd: root, encoding: 'utf8', timeout: 60000, maxBuffer: 1024 * 1024, windowsHide: true });
const put = async (name, value) => { const path = join(work, name); await writeFile(path, JSON.stringify(value)); return path; };
const request = { requestVersion: '0.1', id: 'workbench-build', target: 'pixi',
  text: `${await readFile(join(root, 'examples/controls-planning/request.txt'), 'utf8')}\n文字数据：</script><script>window.seedInjected=true</script> & <b>data</b>` };
const context = await createPlanningContext(request, catalog);
function proposalFor(value, chosenSpec = structuredClone(spec)) {
  return { proposalVersion: value.planningContextVersion, contextSha256: value.sha256, spec: chosenSpec, unresolved: [],
    decisions: proposalTargets(chosenSpec, value.planningContextVersion).map(target => ({ target,
      basis: { kind: 'request-interpretation', start: 0, end: value.request.text.length, quote: value.request.text } })) };
}
const proposal = proposalFor(context);
const contextPath = await put('context.json', context), proposalPath = await put('proposal.json', proposal);
const basic = output => ['--catalog', catalogPath, '--output', output];
const example = ['--example-context', contextPath, '--example-proposal', proposalPath];
async function rejected(output, result, code) {
  assert.notEqual(result.status, 0, result.stdout);
  assert.equal(JSON.parse(result.stderr).code, code, result.stderr);
  assert.equal(result.stderr.includes(root), false);
  await assert.rejects(stat(output), { code: 'ENOENT' });
}
function embeddedSeed(html) {
  const match = html.match(/<script\b[^>]*type="application\/json"[^>]*>([\s\S]*?)<\/script>/);
  assert(match, 'Workbench HTML contains the inert JSON seed');
  return { seed: JSON.parse(match[1]), source: match[1] };
}

test('static workbench compiles a real asset-free example and records only actual output byte fingerprints', async () => {
  const output = join(work, 'example-build');
  const result = run(...basic(output), ...example);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).status, 'STATIC_WORKBENCH_BUILT');
  assert.deepEqual((await readdir(output)).sort(), ['index.html', 'workbench-build.json', 'workbench.js']);
  const manifest = await json(join(output, 'workbench-build.json'));
  assert.equal(manifest.workbenchBuildVersion, '0.1'); assert.equal(manifest.status, 'COMPLETE');
  assert.equal(manifest.catalogSha256, await digestJson(catalog));
  assert.equal(manifest.poolSha256, null); assert.equal(manifest.library, null);
  assert.equal(manifest.recordCount, 0); assert.equal(manifest.imageCount, 0);
  assert.equal(manifest.sourceReplay, 'NOT_APPLICABLE');
  assert.equal(manifest.browser, 'NOT_RUN'); assert.equal(manifest.humanVisualReview, 'NOT_RUN');
  assert.equal(manifest.nativeEngines, 'NOT_RUN');
  assert.equal(manifest.example.contextSha256, context.sha256);
  assert.equal(manifest.example.proposalSha256, await digestJson(proposal));
  assert.match(manifest.example.panelSha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(manifest.files.map(file => file.path), ['index.html', 'workbench.js']);
  for (const file of manifest.files) {
    const bytes = await readFile(join(output, file.path));
    assert.equal(file.bytes, bytes.length);
    assert.equal(file.sha256, createHash('sha256').update(bytes).digest('hex'));
  }
  const html = await readFile(join(output, 'index.html'), 'utf8'), { seed, source } = embeddedSeed(html);
  assert.deepEqual(Object.keys(seed).sort(), ['catalog', 'example', 'pool', 'workbenchSeedVersion']);
  assert.equal(seed.workbenchSeedVersion, '0.1'); assert.deepEqual(seed.catalog, catalog);
  assert.equal(seed.pool, null); assert.deepEqual(seed.example, { context, proposal });
  assert.equal(source.includes('<'), false, 'Raw request markup cannot terminate the inert JSON script');
  assert.match(html, /src="(?:\.\/)?workbench\.js"/);
  const before = await readFile(join(output, 'workbench-build.json'));
  const repeated = run(...basic(output));
  assert.notEqual(repeated.status, 0); assert.equal(JSON.parse(repeated.stderr).code, 'OUTPUT_EXISTS');
  assert.deepEqual(await readFile(join(output, 'workbench-build.json')), before);
});

test('catalog-only workbench requires neither Sharp nor an embedded example', async () => {
  const output = join(work, 'empty-build'), result = run(...basic(output));
  assert.equal(result.status, 0, result.stderr);
  const { seed } = embeddedSeed(await readFile(join(output, 'index.html'), 'utf8'));
  assert.equal(seed.pool, null); assert.equal(seed.example, null);
  const manifest = await json(join(output, 'workbench-build.json'));
  assert.equal(manifest.example, null); assert.equal(manifest.sourceReplay, 'NOT_APPLICABLE');
});

test('arguments reject incomplete example pairs, duplicate flags and orphan Sharp settings without output', async () => {
  const cases = [
    { args: ['--example-context', contextPath], code: 'WORKBENCH_EXAMPLE_PAIR_REQUIRED' },
    { args: ['--example-proposal', proposalPath], code: 'WORKBENCH_EXAMPLE_PAIR_REQUIRED' },
    { args: ['--sharp-module', 'unused-module'], code: 'WORKBENCH_ASSETS_REQUIRED' },
    { args: ['--catalog', catalogPath], code: 'WORKBENCH_ARGUMENTS' },
    { args: ['--unknown', 'value'], code: 'WORKBENCH_ARGUMENTS' },
    { args: ['--assets'], code: 'WORKBENCH_ARGUMENTS' },
  ];
  for (const [i, item] of cases.entries()) {
    const output = join(work, `arguments-${i}`);
    await rejected(output, run(...basic(output), ...item.args), item.code);
  }
  const missing = join(work, 'missing-catalog');
  await rejected(missing, run('--output', missing), 'WORKBENCH_ARGUMENTS');
});

test('example context must use the exact supplied catalog and all unresolved items block embedding', async () => {
  const mismatch = join(work, 'wrong-catalog');
  await rejected(mismatch, run('--catalog', 'examples/modern-mint-light.catalog.json', '--output', mismatch, ...example), 'WORKBENCH_EXAMPLE_CATALOG_MISMATCH');
  const unresolved = { proposalVersion: context.planningContextVersion, contextSha256: context.sha256, spec: null, decisions: [],
    unresolved: [{ id: 'behavior', question: '请明确按钮的行为。' }] };
  const path = await put('unresolved.json', unresolved), output = join(work, 'unresolved-build');
  await rejected(output, run(...basic(output), '--example-context', contextPath, '--example-proposal', path), 'PLAN_NEEDS_INPUT');
});

test('structurally ready examples must compile geometry before any static output is created', async () => {
  const changed = structuredClone(proposal); changed.spec.layout.rowHeight = 4096;
  const path = await put('overflow.json', changed), output = join(work, 'overflow-build');
  await rejected(output, run(...basic(output), '--example-context', contextPath, '--example-proposal', path), 'LAYOUT_OVERFLOW');
});

test('asset retrieval evidence cannot be embedded into a workbench without its verified full pool', async () => {
  const retrieval = { assetRetrievalVersion: '0.1', library: { id: 'test-pool', sha256: 'a'.repeat(64) },
    policy: { algorithm: 'lexical-v1', latestOnly: true, limitPerSlot: 16, style: null }, candidates: [] };
  const assetContext = await createPlanningContext(request, catalog, retrieval), assetProposal = proposalFor(assetContext);
  const c = await put('asset-context.json', assetContext), p = await put('asset-proposal.json', assetProposal);
  const output = join(work, 'missing-pool');
  await rejected(output, run(...basic(output), '--example-context', c, '--example-proposal', p), 'WORKBENCH_EXAMPLE_POOL_REQUIRED');
});

test('ordinary JSON limits and filesystem failures keep structured diagnostics free of host paths', async () => {
  const oversized = join(work, 'oversized.json'); await writeFile(oversized, ' '.repeat(2 * 1024 * 1024) + '{}');
  const output = join(work, 'oversized-build');
  await rejected(output, run('--catalog', oversized, '--output', output), 'JSON_FILE_LIMIT');
  const missing = join(work, 'missing-source-build');
  await rejected(missing, run('--catalog', join(work, 'private-folder-name', 'absent.json'), '--output', missing), 'ENOENT');
});
