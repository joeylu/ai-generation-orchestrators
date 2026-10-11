import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import * as api from '../src/index.mjs';
import { DEVELOPMENT_0_7_RUNTIME_SHA256, SOURCE_0_7_RUNTIME_SHA256, SOURCE_0_7_1_RUNTIME_SHA256 } from '../src/compiler.mjs';
import { accepted, archiveSyntheticRun, setup, syntheticImage } from './helpers.mjs';

for (const runtime of [DEVELOPMENT_0_7_RUNTIME_SHA256, SOURCE_0_7_RUNTIME_SHA256, SOURCE_0_7_1_RUNTIME_SHA256]) {
  test(`archived 0.7 results and revision budgets survive release as read-only evidence: ${runtime.slice(0, 8)}`, async t => {
    const { root, temp } = await setup(t), first = accepted(root);
    archiveSyntheticRun(root, first.plan.run, runtime);
    const revision = api.createRevisionPlan(root, { sourceRun: first.plan.run, note: 'Synthetic revision.' });
    api.authorize(root, revision.run, revision.planSha256, 'Synthetic revision compute decision.');
    const request = api.reserve(root, revision.run), result = api.receive(root, revision.run, request.requestSha256, syntheticImage());
    api.reviewRun(root, revision.run, { imageSha256: result.imageSha256, layout: 'pass', style: 'pass', copy: 'pass', decision: 'accept', note: 'Synthetic acceptance.' });
    const archived = archiveSyntheticRun(root, revision.run, runtime);
    for (const run of [first.plan.run, revision.run]) {
      assert.equal(api.inspectRun(root, run).executable, false);
      assert.equal(api.inspectRun(root, run).status, 'accepted');
      assert.throws(() => api.reserve(root, run), /RUNTIME_CHANGED/);
      assert.throws(() => api.authorize(root, run, api.verifyPlan(root, run, { allowLegacy: true }).sha256, 'No archived compute.'), /RUNTIME_CHANGED/);
    }
    assert.throws(() => api.finish(root, revision.run, result.rawSha256), /RUNTIME_CHANGED/);
    let calls = 0;
    await assert.rejects(api.generateWithAdapter(root, revision.run, { generate: async () => { calls++; return syntheticImage(); } }), /RUNTIME_CHANGED/);
    assert.equal(calls, 0);
    assert.equal(api.verifyPlan(root, revision.run, { allowLegacy: true }).sha256, archived.sha256);
    const dag = api.createProjectDag(root, { anchorPanelId: 'audio-settings' });
    assert.equal(dag.panels[0].revisionsUsed, 1);
    assert.equal(dag.panels[0].accepted.imageSha256, result.imageSha256);
    const output = path.join(temp, 'archived-delivery');
    api.exportProject(root, output);
    assert.equal(api.validateDelivery(output).status, 'valid');
  });
}
