/** Exact independent business assertions. Fixtures are never real model evidence. */
import assert from 'node:assert/strict';
import { validatePanelSpec } from '../src/spec.mjs';
import { digestJson } from '../src/canonical.mjs';
import { checkStressEdit, findStressRow, stressFixturePatch, stressFixtureProposal } from './input-stress-contract.mjs';
export { findStressRow, stressFixtureProposal };
export async function checkChainEdit(beforeInput,afterInput,step) {
  if(!['disableMute','enableMute'].includes(step.expectation))return checkStressEdit(beforeInput,afterInput,step);
  const before=validatePanelSpec(beforeInput),after=validatePanelSpec(afterInput),expected=structuredClone(before);
  const mute=findStressRow(expected,'静音');assert.equal(mute.kind,'switch');
  assert.equal(mute.enabled,step.expectation==='disableMute');mute.enabled=step.expectation==='enableMute';
  assert.deepEqual(after,expected,'Only enabled may change; all IDs, defaults, events and reset fields remain');
  return {editChainSemanticVersion:'0.1',status:'PASS',stepId:step.id,beforeSpecSha256:await digestJson(before),
    afterSpecSha256:await digestJson(after),checks:['only-enabled-changed','all-unmentioned-properties-preserved'],modelCalls:0};
}
export async function chainFixturePatch(spec,step) {
  if(!['disableMute','enableMute'].includes(step.expectation))return stressFixturePatch(spec,step);
  return {patchVersion:'0.1',baseSpecSha256:await digestJson(spec),reason:'Zero-model driver fixture; not model output.',
    operations:[{op:'set-row-enabled',rowId:findStressRow(spec,'静音').id,enabled:step.expectation==='enableMute'}]};
}
