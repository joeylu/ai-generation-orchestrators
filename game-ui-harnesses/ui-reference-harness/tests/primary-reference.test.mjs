import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import * as api from '../src/index.mjs';
import { local, sha256, verifyBlob } from '../src/common.mjs';
import { setup, secondPanel, syntheticImage, accepted } from './helpers.mjs';

const operation = () => ({ operationId: randomUUID() });
const primary = plan => plan.request.images.find(image => image.role === 'primary-style').artifact;

test('any panel can be first; every frozen plan uses the same complete confirmed primary PNG', async t => {
  const { root, temp, style } = await setup(t); await secondPanel(root, temp);
  const dag = api.createProjectDag(root, { anchorPanelId: 'audio-settings' }); // inert legacy selection
  assert.equal(dag.anchor, null);
  assert.equal(dag.nodes.some(node => node.id === 'anchor'), false);
  assert.ok(dag.nodes.filter(node => node.type === 'plan').every(node => node.status === 'ready'));
  for (const panelId of ['audio-secondary', 'audio-settings']) {
    const state = api.prepareProjectDagPanel(root, dag.dag, panelId, operation());
    const plan = api.verifyPlan(root, state.panels.find(panel => panel.panelId === panelId).latest.run);
    assert.equal(plan.anchor, null);
    assert.equal(primary(plan).sha256, style.references[0].artifact.sha256);
    assert.ok(verifyBlob(root, primary(plan)).equals(verifyBlob(root, style.references[0].artifact)));
    assert.deepEqual(plan.request.images.map(image => image.role), ['layout-reference', 'primary-style']);
  }
  assert.equal(api.inspectProjectDag(root, dag.dag).computeCalls, 0);
});

test('acceptance cannot promote a result; modification binds distinct source and frozen primary snapshots', async t => {
  const { root, temp, style } = await setup(t);
  const first = accepted(root), projectBefore = fs.readFileSync(local(root, 'project.json'));
  const draftBefore = fs.readFileSync(local(root, `styles/${style.sha256}.json`));
  assert.throws(() => api.reviewRun(root, first.plan.run, {
    imageSha256: first.result.imageSha256, layout: 'pass', style: 'pass', copy: 'pass',
    decision: 'accept', note: 'Old client must upgrade.', useAsAnchor: true,
  }), /PROJECT_ANCHOR_REMOVED/);
  assert.ok(projectBefore.equals(fs.readFileSync(local(root, 'project.json'))));
  assert.ok(draftBefore.equals(fs.readFileSync(local(root, `styles/${style.sha256}.json`))));
  const revision = api.createRevisionPlan(root, { sourceRun: first.plan.run, note: 'Adjust existing button contrast.' });
  const plan = api.verifyPlan(root, revision.run);
  assert.equal(plan.revision.image.sha256, first.result.imageSha256);
  assert.equal(primary(plan).sha256, style.references[0].artifact.sha256);
  assert.notEqual(plan.revision.image.sha256, primary(plan).sha256);
  assert.deepEqual(plan.request.images.map(image => image.role), ['revision-source', 'layout-reference', 'primary-style']);
  const output = path.join(temp, 'accepted-delivery'); api.exportProject(root, output);
  assert.equal(api.validateDelivery(output).status, 'valid');
});

test('confirmed style revisions affect new plans only and do not rewrite old snapshots or deliveries', async t => {
  const { root, temp } = await setup(t), first = accepted(root);
  const frozen = api.createPlan(root, { panelId: 'audio-settings' });
  const oldPlan = fs.readFileSync(local(root, `${frozen.run}/plan.json`));
  const output = path.join(temp, 'old-delivery'); api.exportProject(root, output);
  const zip = fs.readFileSync(path.join(output, 'references.zip'));
  const image = path.join(temp, 'confirmed-preview.png'); fs.writeFileSync(image, syntheticImage(128, 96));
  const next = api.createStyle(root, { preset: 'concept-art', reference: image, notes: 'Confirmed derived preview.' });
  api.activateStyle(root, next.sha256, 'Synthetic explicit revised style confirmation.');
  const current = api.createPlan(root, { panelId: 'audio-settings' });
  assert.equal(primary(api.verifyPlan(root, current.run)).sha256, sha256(fs.readFileSync(image)));
  assert.notEqual(primary(api.verifyPlan(root, frozen.run)).sha256, primary(api.verifyPlan(root, current.run)).sha256);
  assert.ok(oldPlan.equals(fs.readFileSync(local(root, `${frozen.run}/plan.json`))));
  assert.ok(zip.equals(fs.readFileSync(path.join(output, 'references.zip'))));
  assert.equal(api.validateDelivery(output).status, 'valid');
  assert.equal(api.inspectRun(root, first.plan.run).status, 'accepted');
  assert.throws(() => api.authorize(root, frozen.run, frozen.planSha256, 'Stale plan cannot dispatch.'), /STYLE_STALE/);
});

test('missing primary requires explicit style repair; no default, panel result or foreign image is substituted', async t => {
  const { root } = await setup(t);
  const missing = api.createStyle(root, { preset: 'concept-art' });
  api.activateStyle(root, missing.sha256, 'Historical rule-only style.');
  const before = fs.readFileSync(local(root, 'project.json'));
  assert.equal(api.projectStatus(root).activeStyle, missing.sha256);
  assert.throws(() => api.createPlan(root, { panelId: 'audio-settings' }), /STYLE_PRIMARY_REFERENCE_REQUIRED/);
  assert.throws(() => api.createProjectDag(root), /STYLE_PRIMARY_REFERENCE_REQUIRED/);
  assert.throws(() => api.createProjectPlans(root), /STYLE_PRIMARY_REFERENCE_REQUIRED/);
  assert.ok(before.equals(fs.readFileSync(local(root, 'project.json'))));
});
