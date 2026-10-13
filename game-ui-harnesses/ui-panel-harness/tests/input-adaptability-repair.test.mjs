import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {INPUT_ADAPTABILITY_CASES,referenceIntent} from '../examples/input-adaptability-v1/suite.mjs';
import {INPUT_ADAPTABILITY_REPAIR_CASES} from '../examples/input-adaptability-v2/suite.mjs';
import {prepareAdaptability,verifyAdaptability} from '../scripts/input-adaptability.mjs';
import {checkAdaptabilityResult} from '../scripts/lib/input-adaptability-oracle.mjs';
import {createWorkbenchModel} from '../src/workbench-model.mjs';
import {materializePanelIntent} from '../src/panel-intent.mjs';
import {checkPanelProposal} from '../src/proposal.mjs';
import {loadWorkspaceCore} from '../src/component-adapter.mjs';
import {imageAssetPool} from '../examples/image-slots-v1/assets.mjs';
import {harnessRoot,readJson} from '../src/io.mjs';
import {digestJson} from '../src/canonical.mjs';

const scratch=await mkdtemp(resolve(harnessRoot,'.tmp','input-adaptability-repair-'));
const prepared=join(scratch,'prepared'),plan=await prepareAdaptability(prepared,{cohort:'repair-v1'});
const core=await loadWorkspaceCore(),catalog=await readJson(resolve(harnessRoot,'examples/modern-all-components.catalog.json')),pool=await imageAssetPool();

test('repair plan binds eight fresh requests, keeps original failed wording and cannot inherit the old budget',async()=>{
  assert.equal(plan.inputAdaptabilityPlanVersion,'0.2');assert.equal(plan.cohort,'repair-v1');assert.equal(plan.policy.maxInvocations,8);
  assert.equal(plan.sourceKind,'NO_EDIT_BASES');assert.equal(plan.driverSimulation.realModelCalls,0);
  assert.deepEqual(plan.cases.map(item=>item.id),['R01','R02','R03','R04','R05','R06','R07','R08']);
  assert.equal(INPUT_ADAPTABILITY_REPAIR_CASES[0].request.text,INPUT_ADAPTABILITY_CASES.find(item=>item.id==='G10').request.text);
  assert.equal((await verifyAdaptability(prepared,{checkLogin:false})).sha256,plan.sha256);
  const path=join(prepared,'input-adaptability-plan.json'),bytes=await readFile(path),mutated=JSON.parse(bytes);
  mutated.policy.maxInvocations=24;const {sha256,...payload}=mutated;mutated.sha256=await digestJson(payload);
  await writeFile(path,JSON.stringify(mutated));await assert.rejects(verifyAdaptability(prepared,{checkLogin:false}),/ADAPT_POLICY/);await writeFile(path,bytes);
});

for(const item of INPUT_ADAPTABILITY_REPAIR_CASES)test(`${item.id}: repair driver compiles the independent expectation without real inference`,async()=>{
  const model=await createWorkbenchModel({catalog,pool},core);
  try{
    const {context}=await model.prepare(item.request),proposal=await materializePanelIntent(context,referenceIntent(context,item)),report=await checkPanelProposal(context,proposal);
    assert.deepEqual(context,await readJson(join(prepared,item.id+'.context.json')));
    const expected=await readJson(join(prepared,item.id+'.expectation.json'));await model.acceptProposal(proposal);const after=await model.exportPanel();
    checkAdaptabilityResult(item,{proposal,report},{expectedSpec:expected.expectedSpec,after});
    const wrong=structuredClone(proposal);wrong.spec.sections[0].rows[0].label+='错';
    assert.throws(()=>checkAdaptabilityResult(item,{proposal:wrong,report},{expectedSpec:expected.expectedSpec,after}),/ADAPT_BUSINESS_FACTS/);
    if(item.reference.maxCanvasHeight){const taller=structuredClone(after);taller.spec.canvas.height=item.reference.maxCanvasHeight+1;
      assert.throws(()=>checkAdaptabilityResult(item,{proposal,report},{expectedSpec:expected.expectedSpec,after:taller}),/ADAPT_CANVAS_TOO_TALL/);}
  }finally{model.dispose();}
});

test('quoted corrected names retain descriptor characters while the new unquoted case separates them',async()=>{
  const quoted=await readJson(join(prepared,'R02.expectation.json')),unquoted=await readJson(join(prepared,'R03.expectation.json'));
  assert.deepEqual(quoted.expectedSpec.sections.flatMap(section=>section.rows).map(row=>row.label),['角色名单','验证纹理图片']);
  assert.deepEqual(unquoted.expectedSpec.sections.flatMap(section=>section.rows).map(row=>row.label),['玩家名','角色头像']);
});
