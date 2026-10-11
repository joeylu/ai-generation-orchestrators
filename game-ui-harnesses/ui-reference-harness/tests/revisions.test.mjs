import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import path from 'node:path';
import * as api from '../src/index.mjs';
import { jsonBytes, local, readJson, seal } from '../src/common.mjs';
import { setup, syntheticImage } from './helpers.mjs';

test('three frozen visual revisions preserve the initial intent, source bytes and review boundary; a fourth is refused', async t => {
  const { root, temp } = await setup(t);
  let plan = api.createPlan(root, { panelId: 'audio-settings', note: 'Keep buttons readable.' });
  const originalRun = plan.run;
  for (let round = 0; round <= 3; round++) {
    const frozen = api.verifyPlan(root, plan.run);
    assert.equal(frozen.intent.note, 'Keep buttons readable.');
    if (round) {
      assert.equal(frozen.revision.round, round);
      assert.equal(frozen.request.images[0].role, 'revision-source');
      assert.ok(frozen.request.prompt.includes(`feedback ${round}`));
      assert.equal(frozen.anchor, null);
      assert.ok(fs.readFileSync(local(root, frozen.revision.image.path)).equals(fs.readFileSync(local(root, `${frozen.revision.run}/reference.png`))));
    }
    assert.throws(() => api.reserve(root, plan.run));
    api.authorize(root, plan.run, plan.planSha256, 'Synthetic explicit one-image click.');
    await api.generateWithAdapter(root, plan.run, { generate: async () => syntheticImage(384, 256) });
    assert.equal(api.inspectRun(root, plan.run).status, 'pending_visual_review');
    assert.equal(api.projectStatus(root).panels[0].acceptedRun, null);
    if (round < 3) plan = api.createRevisionPlan(root, { sourceRun: plan.run, note: `feedback ${round + 1}` });
  }
  assert.throws(() => api.createRevisionPlan(root, { sourceRun: plan.run, note: 'fourth' }), /REVISION_LIMIT/);
  assert.equal(api.inspectRun(root, originalRun).status, 'pending_visual_review');
  const result = api.inspectRun(root, plan.run);
  api.reviewRun(root, plan.run, { imageSha256: result.imageSha256, layout: 'pass', style: 'pass', copy: 'pass', decision: 'accept', note: 'Synthetic review.' });
  const output = path.join(temp, 'revision-delivery'); api.exportProject(root, output);
  assert.equal(api.validateDelivery(output).status, 'valid');
  const provenance = readJson(path.join(output, 'panels/audio-settings/provenance.json'));
  assert.equal(provenance.revision.round, 3); assert.equal(Object.hasOwn(provenance.revision, 'run'), false);
  const file = local(root, `${plan.run}/plan.json`), original = readJson(file);
  for (const mutate of [v => { v.revision.run = plan.run; }, v => { v.revision.round = 4; },
    v => { v.revision.image.sha256 = '0'.repeat(64); }, v => { v.revision.note = 'changed unfrozen feedback'; }]) {
    const changed = structuredClone(original); delete changed.sha256; mutate(changed);
    fs.writeFileSync(file, jsonBytes(seal(changed)));
    assert.throws(() => api.verifyPlan(root, plan.run), /REVISION|BLOB|PLAN_REQUEST/);
  }
  fs.writeFileSync(file, jsonBytes(original));
  const reference = path.join(temp, 'changed-style.png'); fs.writeFileSync(reference, syntheticImage(96, 64));
  const style = api.createStyle(root, { preset: 'pixel-cartoon', reference }); api.activateStyle(root, style.sha256, 'Synthetic style change.');
  assert.throws(() => api.createRevisionPlan(root, { sourceRun: originalRun, note: 'stale style' }), /REVISION_SOURCE/);
});
