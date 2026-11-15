import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { contextFor, loadSceneKit } from '../src/kit.mjs';
import { createProjectWorkspace } from '../src/studio/projects.mjs';
import { openEnvironmentLibraryExchange } from '../src/generation/environment-library-exchange.mjs';
import { assessEnvironmentLibraryOutput, compileEnvironmentLibraryPlan, environmentContentPolicy } from '../src/generation/environment-library-plan.mjs';
import { assessEnvironmentSourceV2 } from '../src/generation/environment-source.mjs';
import { jsonBytes, seal, unseal } from '../src/generation/common.mjs';
import { encodeRgbaPng, inspectPng } from '../src/png.mjs';

const handle = loadSceneKit(fileURLToPath(new URL('./fixtures/synthetic/', import.meta.url)));
const context = contextFor(handle), marker = context.modules.get('environment-marker');
const anchor = context.files.get(marker.source.path);
const style = { kitId: handle.kitId, name: 'Project palette', rules: ['Muted diffuse fill'], anchorAssetId: marker.assetId, anchorSha256: marker.source.sha256 };
const content = { subject: 'Stone lamp', structure: 'Square base and cap', materials: 'Stone', details: 'Vines under cap' };
const code = expected => error => error.errors?.[0].code === expected;
function temporary(t) {
  const base = resolve(tmpdir()), folder = mkdtempSync(join(base, 'scene-environment-library-'));
  t.after(() => { assert.equal(dirname(folder), base); rmSync(folder, { recursive: true, force: true }); });
  return folder;
}
function sprite(edgeAlpha = 0) {
  const rgba = Buffer.alloc(24 * 24 * 4);
  rgba[0] = 200;
  rgba[3] = edgeAlpha;
  rgba[4] = 200;
  for (let y = 4; y < 20; y++) for (let x = 6; x < 18; x++) rgba.set([44, 66, x + y, 250], (y * 24 + x) * 4);
  return encodeRgbaPng(24, 24, rgba);
}

test('separate content and style requests, exclusive approvals, atomic add and portable reopen', async t => {
  const folder = temporary(t), root = join(folder, 'studio');
  const workspace = createProjectWorkspace({ root, handle });
  const { project } = workspace.current(), projectId = project.projectId;
  const rev = () => workspace.state().revision;
  const operate = (action, fields) => workspace.operate({ revision: rev(), action, ...fields });
  const initialMapId = project.activeMapId;
  operate('create-map', { name: '第二张地图', template: 'current' });
  operate('switch-map', { mapId: initialMapId });
  const original = workspace.state().document;
  const layerId = original.layers.find(layer => layer.kind === 'environment').layerId;
  workspace.edit({ revision: rev(), action: 'commands', commands: [{
    type: 'add-instance', instance: { instanceId: 'evidence.old', assetId: marker.assetId, layerId, x: 128, y: 128 },
  }] });
  const edited = workspace.state().document;
  const exchangeRoot = join(folder, 'exchange');
  const exchange = openEnvironmentLibraryExchange(exchangeRoot), otherWorker = openEnvironmentLibraryExchange(exchangeRoot);
  const reference = sprite();
  const args = { projectId, kitSha256: handle.bundleSha256, style, anchor, prompt: 'A stone lamp, photorealistic', reference };
  const brief = exchange.create(args), jobId = brief.jobId;
  const confirm = targetSha256 => exchange.authorize({ projectId, kitSha256: handle.bundleSha256, style, jobId, targetSha256 });
  assert.throws(() => exchange.authorize({ projectId, kitSha256: handle.bundleSha256,
    style: { ...style, rules: ['Changed rules'] }, jobId, targetSha256: brief.briefSha256 }), code('ENVIRONMENT_PLAN_CHANGED'));
  assert.throws(() => confirm('0'.repeat(64)), code('ENVIRONMENT_PLAN_CHANGED'));
  let interpretations = 0, generations = 0;
  const adapter = {
    async interpretContent(input) {
      interpretations++;
      assert.equal(input.prompt, args.prompt);
      assert.deepEqual(input.reference, reference);
      assert.equal(input.planSha256, brief.briefSha256);
      assert.equal('style' in input, false);
      assert.equal(await otherWorker.dispatch(adapter), false);
      return content;
    },
    async generate(input) {
      generations++;
      assert.deepEqual(input.images.map(image => [image.role, image.bytes]), [['project-style-anchor', anchor]]);
      assert.match(input.request.prompt, /Square base and cap/);
      assert.match(input.request.prompt, /Muted diffuse fill/);
      assert.doesNotMatch(input.request.prompt, /photorealistic/);
      assert.equal(await otherWorker.dispatch(adapter), false);
      return sprite(1);
    },
  };
  assert.equal(await exchange.dispatch(adapter), false);
  assert.throws(() => exchange.create(args), code('ENVIRONMENT_OPERATION_ACTIVE'));
  confirm(brief.briefSha256);
  assert.throws(() => confirm(brief.briefSha256), code('ENVIRONMENT_PLAN_CHANGED'));
  assert.equal(await exchange.dispatch(adapter), true);
  const planned = exchange.get(projectId);
  assert.deepEqual(planned.content, content);
  assert.equal(planned.status, 'review-plan');
  assert.equal(generations, 0);
  assert.equal(await exchange.dispatch(adapter), false);
  confirm(planned.planSha256);
  assert.equal(await exchange.dispatch(adapter), true);
  assert.equal(await exchange.dispatch(adapter), false);
  assert.deepEqual([interpretations, generations], [1, 1]);

  const ready = exchange.get(projectId);
  assert.equal(ready.status, 'candidate');
  assert.equal(workspace.current().asset.handle.bundleSha256, handle.bundleSha256);
  assert.throws(() => exchange.accept({ projectId, jobId, spriteSha256: '0'.repeat(64) }), code('ENVIRONMENT_CANDIDATE_CHANGED'));
  const candidate = exchange.accept({ projectId, jobId, spriteSha256: ready.sprite.sha256 });
  const accepted = inspectPng(candidate.bytes, { includePixels: true });
  assert.deepEqual([...accepted.rgba.subarray(0, 8)], [200, 0, 0, 1, 0, 0, 0, 0]);
  assert.deepEqual([...accepted.rgba.subarray((6 + 4 * 24) * 4, (7 + 4 * 24) * 4)], [44, 66, 10, 250]);
  assert.deepEqual(readFileSync(join(exchangeRoot, jobId, 'raw.png')), sprite(1));
  assert.deepEqual(readFileSync(join(exchangeRoot, jobId, 'reference.png')), reference);
  const after = workspace.addEnvironment(candidate, rev());
  const newId = 'environment-' + jobId;
  assert.deepEqual(contextFor(workspace.current().asset.handle).modules.get(newId).anchorPx, { x: 12, y: 19 });
  assert.equal(after.history.undoDepth, 1);
  assert.deepEqual(after.document, { ...edited, kitRef: after.document.kitRef });
  assert.equal(workspace.addEnvironment(candidate, rev()).revision, after.revision);
  workspace.edit({ revision: rev(), action: 'undo' });
  assert.deepEqual(workspace.state().document, { ...original, kitRef: after.document.kitRef });
  workspace.edit({ revision: rev(), action: 'redo' });
  assert.deepEqual(workspace.state().document, after.document);

  const portable = workspace.exportProject(rev());
  const reopened = createProjectWorkspace({ root, handle });
  assert.deepEqual(reopened.state().document, after.document);
  const imported = createProjectWorkspace({ root: join(folder, 'reopen-independent'), handle });
  imported.importProject(portable, imported.state().revision);
  assert.equal(imported.current().project.maps.length, 2);
  assert.deepEqual(imported.state().document, after.document);
  const importedContext = contextFor(imported.current().asset.handle);
  assert.deepEqual(importedContext.files.get(importedContext.modules.get(newId).source.path), candidate.bytes);
});

test('failed or unknown attempts keep the exact record and cannot redispatch', async t => {
  const root = temporary(t), exchange = openEnvironmentLibraryExchange(root);
  const projectId = '45a06fd8-1209-47de-bbc4-4ed16afde53a', kitSha256 = handle.bundleSha256;
  const brief = exchange.create({ projectId, kitSha256, style, anchor, prompt: 'Lamp', reference: null });
  const authorize = targetSha256 => exchange.authorize({ projectId, kitSha256, style, jobId: brief.jobId, targetSha256 });
  authorize(brief.briefSha256);
  let calls = 0;
  const adapter = { async interpretContent() { calls++; throw new Error('connection lost'); } };
  assert.equal(await exchange.dispatch(adapter), true);
  const reopened = openEnvironmentLibraryExchange(root);
  assert.equal(reopened.get(projectId).status, 'indeterminate');
  assert.equal(await reopened.dispatch(adapter), false);
  assert.throws(() => authorize(brief.briefSha256), code('ENVIRONMENT_PLAN_CHANGED'));
  assert.equal(calls, 1);
});

test('reference-only briefs use the same gate and preserve rejected image output', async t => {
  const root = temporary(t), exchange = openEnvironmentLibraryExchange(root);
  const projectId = '45a06fd8-1209-47de-bbc4-4ed16afde53a', kitSha256 = handle.bundleSha256;
  const brief = exchange.create({ projectId, kitSha256, style, anchor, prompt: '', reference: sprite() });
  const authorize = targetSha256 => exchange.authorize({ projectId, kitSha256, style, jobId: brief.jobId, targetSha256 });
  const opaque = encodeRgbaPng(24, 24, Buffer.alloc(24 * 24 * 4, 255));
  const adapter = {
    async interpretContent(input) { assert.deepEqual(input.reference, sprite()); return content; },
    async generate() { return opaque; },
  };
  authorize(brief.briefSha256);
  await exchange.dispatch(adapter);
  authorize(exchange.get(projectId).planSha256);
  await exchange.dispatch(adapter);
  const rejected = exchange.get(projectId);
  assert.equal(rejected.status, 'rejected');
  assert.ok(rejected.issues.includes('ENVIRONMENT_ALPHA_AREA'));
  assert.deepEqual(readFileSync(join(root, brief.jobId, 'raw.png')), opaque);
  assert.throws(() => exchange.accept({ projectId, jobId: brief.jobId, spriteSha256: '0'.repeat(64) }), code('ENVIRONMENT_CANDIDATE_CHANGED'));
  assert.equal(await exchange.dispatch(adapter), false);
});

test('old trace-alpha rejection rechecks from the sealed original without another dispatch', async t => {
  const root = temporary(t), exchange = openEnvironmentLibraryExchange(root);
  const projectId = '45a06fd8-1209-47de-bbc4-4ed16afde53a', kitSha256 = handle.bundleSha256;
  const brief = exchange.create({ projectId, kitSha256, style, anchor, prompt: 'Lamp', reference: null });
  const authorize = targetSha256 => exchange.authorize({ projectId, kitSha256, style, jobId: brief.jobId, targetSha256 });
  const raw = sprite(1);
  let calls = 0;
  const adapter = {
    async interpretContent() { return content; },
    async generate() { calls++; return raw; },
  };
  authorize(brief.briefSha256);
  await exchange.dispatch(adapter);
  authorize(exchange.get(projectId).planSha256);
  await exchange.dispatch(adapter);

  const folder = join(root, brief.jobId), resultPath = join(folder, 'result.json');
  const plan = JSON.parse(readFileSync(join(folder, 'plan.json'), 'utf8'));
  assert.deepEqual(assessEnvironmentLibraryOutput(plan, sprite(2)).qa.issues, ['ENVIRONMENT_ALPHA_MARGIN']);
  const oldQa = assessEnvironmentSourceV2(plan, raw);
  assert.deepEqual(oldQa.issues, ['ENVIRONMENT_ALPHA_MARGIN']);
  const result = unseal(JSON.parse(readFileSync(resultPath, 'utf8')));
  const original = jsonBytes(seal({ ...result, qa: oldQa, sprite: null }));
  writeFileSync(resultPath, original);
  unlinkSync(join(folder, 'sprite.png'));
  const old = openEnvironmentLibraryExchange(root);
  assert.equal(old.get(projectId).canRecheckMargin, true);
  const args = { projectId, kitSha256, jobId: brief.jobId };
  assert.throws(() => old.recheckMargin({ ...args, kitSha256: '0'.repeat(64) }), code('ENVIRONMENT_KIT_CHANGED'));
  const rechecked = old.recheckMargin(args);
  assert.equal(rechecked.status, 'candidate');
  assert.deepEqual(old.recheckMargin(args), rechecked);
  assert.deepEqual(readFileSync(resultPath), original);
  assert.deepEqual(readFileSync(join(folder, 'raw.png')), raw);
  assert.deepEqual(old.preview(projectId, brief.jobId, rechecked.sprite.sha256),
    old.accept({ ...args, spriteSha256: rechecked.sprite.sha256 }).bytes);
  assert.equal(await old.dispatch(adapter), false);
  assert.equal(calls, 1);
});

test('automatic reference-only generation adds to the originating project after a project switch', async t => {
  const root = temporary(t), workspace = createProjectWorkspace({ root: join(root, 'projects'), handle });
  const exchange = openEnvironmentLibraryExchange(join(root, 'exchange'));
  const projectId = workspace.current().project.projectId, kitSha256 = handle.bundleSha256;
  const reference = sprite();
  const request = { projectId, kitSha256, style, anchor, prompt: '', reference, automatic: true };
  const brief = exchange.create(request);
  const counts = { content: 0, image: 0, additions: 0 };
  const adapter = {
    async interpretContent(input) {
      counts.content++;
      assert.equal(input.prompt, '');
      assert.deepEqual(input.reference, reference);
      return { ...content, subject: '  Stone lamp  ', structure: ' \r\n\t ', materials: 'Stone\n and wood',
        details: 'Faint chips along the base. '.repeat(14) + 'Intact cap.' };
    },
    async generate(input) {
      counts.image++;
      assert.deepEqual(input.images.map(item => item.role), ['project-style-anchor']);
      assert.match(input.request.prompt, /"materials":"Stone and wood"/);
      assert.match(input.request.prompt, /"structure":""/);
      assert.match(input.request.prompt, /Intact cap/);
      return sprite(1);
    },
  };
  assert.equal(brief.status, 'content-ready');
  assert.equal(await exchange.dispatch(adapter), true);
  assert.equal(await exchange.dispatch(adapter), true);
  assert.equal(exchange.get(projectId).status, 'image-ready');
  const operate = (action, args) => workspace.operate({ revision: workspace.state().revision, action, ...args });
  operate('create-project', { name: '另一个项目', template: 'empty' });
  const otherProjectId = workspace.current().project.projectId;
  assert.equal(await exchange.dispatch(adapter), true);
  assert.throws(() => exchange.create(request), code('ENVIRONMENT_OPERATION_ACTIVE'));
  const add = candidate => {
    counts.additions++;
    workspace.addEnvironment(candidate, workspace.state().revision, { background: true });
  };
  exchange.settleAutomatic(add);
  exchange.settleAutomatic(add);
  assert.deepEqual(counts, { content: 1, image: 1, additions: 1 });
  assert.equal(exchange.get(projectId).status, 'added');
  assert.equal(workspace.current().project.projectId, otherProjectId);
  assert.equal(workspace.current().asset, null);
  operate('switch-project', { projectId });
  assert.ok(contextFor(workspace.current().asset.handle).modules.has('environment-' + brief.jobId));
  assert.equal(await exchange.dispatch(adapter), false);
});

test('environment content normalization retains safety checks and legacy plan validation', () => {
  const brief = { projectId: 'test-project', kitSha256: handle.bundleSha256, style };
  const current = seal({ ...brief, contentPolicy: environmentContentPolicy });
  const legacy = seal(brief);
  const compile = fields => compileEnvironmentLibraryPlan(current, { ...content, ...fields }, anchor);
  assert.throws(() => compile({ subject: ' \n ' }), code('ENVIRONMENT_CONTENT_SUBJECT_REQUIRED'));
  assert.throws(() => compile({ details: 'a'.repeat(721) }), code('ENVIRONMENT_CONTENT_LENGTH'));
  assert.throws(() => compile({ details: 'a\x00b' }), code('ENVIRONMENT_CONTENT_TEXT'));
  assert.throws(() => compile({ details: 'https://example.test/private' }), code('PRIVATE_OPERATIONAL_TEXT'));
  assert.throws(() => compile({ details: 'watercolor style' }), code('ENVIRONMENT_CONTENT_STYLE'));
  assert.throws(() => compileEnvironmentLibraryPlan(legacy, { ...content, structure: '' }, anchor), code('WORKFLOW_TEXT'));
  assert.deepEqual(compileEnvironmentLibraryPlan(legacy, content, anchor).content, content);
});
