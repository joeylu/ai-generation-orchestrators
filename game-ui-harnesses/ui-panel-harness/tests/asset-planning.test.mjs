import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fixture, catalog, copy } from './helpers.mjs';
import { digestBytes, digestJson } from '../src/canonical.mjs';
import { importAssetBatch } from '../src/asset-library.mjs';
import { createAssetRetrieval } from '../src/asset-retrieval.mjs';
import { createPlanningContext, validatePlanningContext } from '../src/planning-context.mjs';
import { proposalTargets, validatePanelProposal, checkPanelProposal, requireReadyProposal } from '../src/proposal.mjs';
import { createAssetPlanningContext, loadPanelPlanAssets } from '../src/panel-assets-io.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
await mkdir(join(root, '.tmp'), { recursive: true });
const work = await mkdtemp(join(root, '.tmp', 'asset-planning-'));
const png = await readFile(new URL('../examples/custom-assets/panel-surface.png', import.meta.url));
// The small repository PNG supplies genuine headers. All decoding and rendering behavior here is an explicit deterministic double.
const adapter = {
  evidence: { name: 'asset-planning-fixture-double', version: '1' },
  async analyze() {
    return { width: 64, height: 64, channels: 4, alpha: { mode: 'opaque', opaquePixels: 4096,
      transparentPixels: 0, softPixels: 0, hiddenRgbPixels: 0, visibleBounds: { x: 0, y: 0, width: 64, height: 64 } } };
  },
  normalizePng: async () => Buffer.from(png),
  render: async () => Buffer.from(png),
  gallery: async items => Buffer.from((await Promise.all(items.map(item => digestBytes(item.bytes)))).join(',')),
};
const entry = (id, role, extra = {}) => ({ id, version: '1.0.0', file: 'source.png', name: id,
  role, tags: ['音量', '声音', '面板', '圆角'], size: { width: 64, height: 64 }, family: id,
  style: 'mint', variant: 'default', slice: null, ...extra });
async function makeLibrary(name) {
  const input = join(work, `${name}-input`), output = join(work, `${name}-library`);
  await mkdir(input);
  await writeFile(join(input, 'source.png'), png);
  await writeFile(join(input, 'assets.json'), JSON.stringify({ assetBatchVersion: '0.1', namespace: 'plan-kit', assets: [
    entry('volume', 'icon'), entry('volume', 'icon', { version: '2.0.0' }), entry('mute', 'icon'),
    entry('surface', 'shape', { slice: { left: 8, top: 8, right: 8, bottom: 8 } }),
    entry('unsliced', 'shape'), entry('glow', 'effect'),
    entry('inventory', 'icon', { tags: ['inventory'], family: 'inventory' }),
  ] }));
  const index = await importAssetBatch(join(input, 'assets.json'), output, adapter, { id: 'planning-assets' });
  return { output, index };
}
const library = await makeLibrary('shared');
const request = { requestVersion: '0.1', id: 'audio', target: 'pixi',
  text: '生成设置面板，使用现代圆角背景。音量滑条范围 0–100、步长 1、初值 80，显示百分比。启用声音开关初始开启，关闭后保留音量。变化通知宿主。两行使用声音图标。' };
const iconKey = 'plan-kit/volume@2.0.0', alternateIconKey = 'plan-kit/mute@1.0.0', surfaceKey = 'plan-kit/surface@1.0.0';
const contextFor = () => createAssetPlanningContext(request, catalog, library.output, adapter, { style: 'mint' });
function specFor(context) {
  const spec = copy(fixture); spec.panelSpecVersion = '0.2';
  spec.assets = { library: copy(context.assetRetrieval.library), panelSurface: surfaceKey,
    rowIcons: [{ rowId: 'volume-row', asset: iconKey }, { rowId: 'audio-enabled-row', asset: alternateIconKey }] };
  return spec;
}
function proposalFor(context, spec = specFor(context)) {
  const version = context.planningContextVersion;
  return { proposalVersion: version, contextSha256: context.sha256, spec, unresolved: [],
    decisions: proposalTargets(spec, version).map(target => ({ target,
      basis: target.startsWith('state:') || target.startsWith('row:')
        ? { kind: 'request-interpretation', start: 0, end: context.request.text.length, quote: context.request.text }
        : { kind: 'design-choice', reason: 'Use the declared layout and a matching asset for this specific visual slot.' } })) };
}

test('asset planning context round-trips and pins real library versions while legacy contexts remain unchanged', async () => {
  const context = await contextFor();
  assert.equal(context.planningContextVersion, '0.2');
  assert.deepEqual(context.assetRetrieval.library, { id: library.index.id, sha256: library.index.sha256 });
  assert.deepEqual(await validatePlanningContext(JSON.parse(JSON.stringify(context))), context);
  assert.deepEqual(context.assetRetrieval, createAssetRetrieval(request.text, library.index, { style: 'mint' }));
  const keys = context.assetRetrieval.candidates.map(candidate => candidate.asset.key);
  assert.ok(keys.includes(iconKey)); assert.ok(keys.includes(surfaceKey));
  assert.ok(!keys.includes('plan-kit/volume@1.0.0'));
  assert.ok(!keys.includes('plan-kit/unsliced@1.0.0')); assert.ok(!keys.includes('plan-kit/glow@1.0.0'));
  const plain = await createPlanningContext(request, catalog);
  assert.equal(plain.planningContextVersion, '0.1'); assert.equal(plain.assetRetrieval, undefined);
  assert.deepEqual(await validatePlanningContext(plain), plain);
  const legacy = proposalFor(plain, copy(fixture));
  assert.deepEqual(await validatePanelProposal(plain, legacy), legacy);
  assert.equal((await checkPanelProposal(plain, legacy)).assetEvidence, undefined);
});

test('proposal/context version pairing cannot be downgraded to bypass per-asset decisions', async () => {
  const context = await contextFor(), proposal = proposalFor(context);
  proposal.proposalVersion = '0.1';
  proposal.decisions = proposal.decisions.filter(decision => !decision.target.startsWith('asset:'));
  await assert.rejects(validatePanelProposal(context, proposal), { code: 'PLAN_ASSET_CONTEXT_VERSION' });
  const plain = await createPlanningContext(request, catalog), future = proposalFor(plain, copy(fixture));
  future.proposalVersion = '0.2';
  await assert.rejects(validatePanelProposal(plain, future), { code: 'PLAN_ASSET_CONTEXT_VERSION' });
});

test('proposal selects only retrieved exact keys, matching slots and the pinned library', async () => {
  const context = await contextFor();
  for (const [mutate, code] of [
    [proposal => { proposal.spec.assets.library.sha256 = 'b'.repeat(64); }, 'PLAN_ASSET_LIBRARY'],
    [proposal => { proposal.spec.assets.library.id = 'another-library'; }, 'PLAN_ASSET_LIBRARY'],
    [proposal => { proposal.spec.assets.panelSurface = iconKey; }, 'PLAN_ASSET_CANDIDATE'],
    [proposal => { proposal.spec.assets.rowIcons[0].asset = surfaceKey; }, 'PLAN_ASSET_CANDIDATE'],
    [proposal => { proposal.spec.assets.rowIcons[0].asset = 'plan-kit/volume@1.0.0'; }, 'PLAN_ASSET_CANDIDATE'],
    [proposal => { proposal.spec.assets.rowIcons[0].asset = 'plan-kit/missing@1.0.0'; }, 'PLAN_ASSET_CANDIDATE'],
  ]) {
    const proposal = proposalFor(context); mutate(proposal);
    await assert.rejects(validatePanelProposal(context, proposal), { code });
  }
});

test('each selected surface and row icon needs its own rationale beyond the general assets decision', async () => {
  const context = await contextFor(), proposal = proposalFor(context);
  const targets = proposalTargets(proposal.spec, '0.2');
  for (const expected of ['assets', 'asset:surface', 'asset:row:volume-row', 'asset:row:audio-enabled-row']) assert.ok(targets.includes(expected));
  for (const target of targets.filter(target => target.startsWith('asset:'))) {
    const missing = copy(proposal); missing.decisions = missing.decisions.filter(decision => decision.target !== target);
    await assert.rejects(validatePanelProposal(context, missing), { code: 'PLAN_COVERAGE' });
  }
  const duplicate = copy(proposal); duplicate.decisions.push(copy(duplicate.decisions.find(decision => decision.target === 'asset:surface')));
  await assert.rejects(validatePanelProposal(context, duplicate), { code: 'PLAN_TARGET' });
});

test('offline proposal report explicitly requires build verification and does not certify semantics', async () => {
  const context = await contextFor(), proposal = proposalFor(context), report = await checkPanelProposal(context, proposal);
  assert.equal(report.status, 'READY_TO_COMPILE'); assert.equal(report.planningReportVersion, '0.2');
  assert.equal(report.assetEvidence.libraryVerification, 'REQUIRES_BUILD_VERIFICATION');
  assert.equal(report.assetEvidence.candidateCount, context.assetRetrieval.candidates.length);
  assert.deepEqual(report.assetEvidence.selectedKeys, [alternateIconKey, surfaceKey, iconKey].sort());
  assert.equal(report.semanticReview, 'NOT_RUN'); assert.equal(report.humanVisualReview, 'NOT_RUN');
});

test('empty retrieval permits an explicit unresolved proposal but blocks build readiness and invented candidates', async () => {
  const context = await createAssetPlanningContext(request, catalog, library.output, adapter, { style: 'missing-style' });
  assert.deepEqual(context.assetRetrieval.candidates, []);
  const proposal = { proposalVersion: '0.2', contextSha256: context.sha256, spec: null, decisions: [],
    unresolved: [{ id: 'missing_assets', question: 'Which asset style should replace the unavailable requested style?' }] };
  const report = await checkPanelProposal(context, proposal);
  assert.equal(report.status, 'NEEDS_INPUT'); assert.deepEqual(report.assetEvidence.selectedKeys, []);
  await assert.rejects(requireReadyProposal(context, proposal), { code: 'PLAN_NEEDS_INPUT' });
  await assert.rejects(validatePanelProposal(context, proposalFor(context)), { code: 'PLAN_ASSET_CANDIDATE' });
});

test('build verifies real package membership, returns only selected bytes and binds its receipt to context/retrieval', async () => {
  const context = await contextFor(), proposal = proposalFor(context);
  await requireReadyProposal(context, proposal);
  const before = await readFile(join(library.output, 'asset-library.json'));
  const { assets, receipt } = await loadPanelPlanAssets(context, proposal.spec, library.output, adapter);
  assert.equal(receipt.status, 'VERIFIED'); assert.equal(receipt.assetBuildVerificationVersion, '0.1');
  assert.equal(receipt.contextSha256, context.sha256);
  assert.equal(receipt.retrievalSha256, await digestJson(context.assetRetrieval));
  assert.deepEqual(receipt.library, context.assetRetrieval.library);
  assert.deepEqual(assets.closure.records.map(record => record.key), receipt.selectedKeys);
  assert.equal(assets.closure.records.length, 3);
  assert.equal(assets.resources.length, 1, 'identical fixture PNGs are embedded once without losing distinct identities');
  assert.deepEqual(Buffer.from(assets.resources[0].bytes), png);
  assert.deepEqual(await readFile(join(library.output, 'asset-library.json')), before);
});

test('rehashed candidate file facts pass offline structure but fail full-library build replay', async () => {
  const original = await contextFor();
  for (const mutate of [
    retrieval => { retrieval.candidates[0].asset.sha256 = 'f'.repeat(64); },
    retrieval => { retrieval.candidates[0].asset.bytes += 1; },
  ]) {
    const retrieval = copy(original.assetRetrieval); mutate(retrieval);
    const forged = await createPlanningContext(request, catalog, retrieval);
    assert.deepEqual(await validatePlanningContext(forged), forged);
    const proposal = proposalFor(forged);
    assert.equal((await checkPanelProposal(forged, proposal)).status, 'READY_TO_COMPILE');
    await assert.rejects(loadPanelPlanAssets(forged, proposal.spec, library.output, adapter), /PLAN_ASSET_RETRIEVAL_MISMATCH/);
  }
});

test('omitting an unselected candidate cannot silently narrow an otherwise rehashed planning context', async () => {
  const original = await contextFor(), retrieval = copy(original.assetRetrieval);
  retrieval.candidates = retrieval.candidates.filter(candidate => candidate.asset.key !== alternateIconKey);
  const incomplete = await createPlanningContext(request, catalog, retrieval);
  assert.deepEqual(await validatePlanningContext(incomplete), incomplete);
  const spec = specFor(incomplete); spec.assets.rowIcons[1].asset = iconKey;
  const proposal = proposalFor(incomplete, spec);
  assert.equal((await checkPanelProposal(incomplete, proposal)).status, 'READY_TO_COMPILE');
  await assert.rejects(loadPanelPlanAssets(incomplete, proposal.spec, library.output, adapter), /PLAN_ASSET_RETRIEVAL_MISMATCH/);
});

test('build rejects legacy contexts and mismatched actual package identity before returning asset evidence', async () => {
  const context = await contextFor(), spec = specFor(context);
  await assert.rejects(loadPanelPlanAssets(await createPlanningContext(request, catalog), spec, library.output, adapter), /PLAN_ASSET_CONTEXT_REQUIRED/);
  const changed = copy(context.assetRetrieval); changed.library.id = 'unverified-package';
  const wrongContext = await createPlanningContext(request, catalog, changed), wrongSpec = specFor(wrongContext);
  await assert.rejects(loadPanelPlanAssets(wrongContext, wrongSpec, library.output, adapter), /PLAN_ASSET_RETRIEVAL_MISMATCH/);
});

test('tampered package bytes fail both intake context creation and final build verification', async () => {
  const fresh = await makeLibrary('corrupt'), context = await createAssetPlanningContext(request, catalog, fresh.output, adapter);
  await writeFile(join(fresh.output, fresh.index.records[0].file.path), 'tampered PNG');
  await assert.rejects(createAssetPlanningContext(request, catalog, fresh.output, adapter), /ASSET_FILE_MISMATCH/);
  await assert.rejects(loadPanelPlanAssets(context, specFor(context), fresh.output, adapter), /ASSET_FILE_MISMATCH/);
});
