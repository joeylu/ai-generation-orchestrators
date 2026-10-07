import test from 'node:test';
import assert from 'node:assert/strict';
import {core} from './helpers.mjs';
import {createEditBoundaryFixtures,runEditBoundaryCase,probePartialOmission,EDIT_BOUNDARY_CASES,EDIT_BOUNDARY_GAPS} from '../scripts/edit-boundaries-contract.mjs';
const fixtures=await createEditBoundaryFixtures(core);
for(const item of EDIT_BOUNDARY_CASES)test(`user-edit boundary ${item.id}: ${item.text}`,async()=>{
  const {result}=await runEditBoundaryCase(item,fixtures,core);
  assert.equal(result.modelInterpretation,'NOT_RUN');
});
test('the omission probe exposes structural acceptance without claiming complete request satisfaction',async()=>{
  const result=await probePartialOmission(fixtures);
  assert.equal(result.status,'SEMANTIC_LIMIT_OBSERVED');assert.equal(result.applied,false);
});
test('known capability gaps have unique reviewable inputs and are separate from executed cases',()=>{
  const all=[...EDIT_BOUNDARY_CASES,...EDIT_BOUNDARY_GAPS];assert.equal(new Set(all.map(c=>c.id)).size,28);
  assert(EDIT_BOUNDARY_GAPS.every(c=>c.text&&c.missing&&c.evidence&&!Object.hasOwn(c,'operations')));
});
