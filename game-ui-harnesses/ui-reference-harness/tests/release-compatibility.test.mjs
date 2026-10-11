import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import path from 'node:path';
import * as api from '../src/index.mjs';
import { DEVELOPMENT_0_7_RUNTIME_SHA256 } from '../src/compiler.mjs';
import { jsonBytes, local, readJson, seal } from '../src/common.mjs';
import { accepted, setup, syntheticImage } from './helpers.mjs';

// Historical synthetic fixtures only. Never rewrite real project evidence.
function archiveFixture(root, run) {
  const plan = readJson(local(root, `${run}/plan.json`));
  delete plan.sha256;
  plan.runtimeSha256 = DEVELOPMENT_0_7_RUNTIME_SHA256;
  const archived = seal(plan);
  fs.writeFileSync(local(root, `${run}/plan.json`), jsonBytes(archived));
  let authorizationSha256;
  for (const name of ['authorization', 'attempt', 'receipt', 'technical', 'review']) {
    const record = readJson(local(root, `${run}/${name}.json`));
    delete record.sha256;
    record.planSha256 = archived.sha256;
    if (name === 'attempt') record.authorizationSha256 = authorizationSha256;
    const sealed = seal(record);
    if (name === 'authorization') authorizationSha256 = sealed.sha256;
    fs.writeFileSync(local(root, `${run}/${name}.json`), jsonBytes(sealed));
  }
  return archived;
}

test('distributed 0.7 development results and revision budgets survive release as read-only evidence', async t => {
  const { root, temp } = await setup(t), first = accepted(root);
  archiveFixture(root, first.plan.run);
  const revision = api.createRevisionPlan(root, { sourceRun: first.plan.run, note: 'Synthetic revision.' });
  api.authorize(root, revision.run, revision.planSha256, 'Synthetic revision compute decision.');
  const request = api.reserve(root, revision.run), result = api.receive(root, revision.run, request.requestSha256, syntheticImage());
  api.reviewRun(root, revision.run, { imageSha256: result.imageSha256, layout: 'pass', style: 'pass', copy: 'pass', decision: 'accept', note: 'Synthetic acceptance.' });
  const archived = archiveFixture(root, revision.run);
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
