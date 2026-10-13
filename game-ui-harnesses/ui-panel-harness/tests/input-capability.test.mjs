import test from 'node:test';
import assert from 'node:assert/strict';
import {nativeInputCapabilityGuide,contradictsInputCapabilities} from '../src/input-interpretation.mjs';
import {buildNativePanelIntentResponseSchema,materializePanelIntent} from '../src/panel-intent.mjs';
import {createPlanningContext} from '../src/planning-context.mjs';
import {checkPanelProposal} from '../src/proposal.mjs';
import {readJson} from '../src/io.mjs';
import {referenceIntent} from '../examples/input-adaptability-v1/suite.mjs';
import {INPUT_CAPABILITY_CASES} from '../examples/input-adaptability-v3/suite.mjs';
import {imageAssetPool} from '../examples/image-slots-v1/assets.mjs';
import {createWorkbenchModel} from '../src/workbench-model.mjs';
import {loadWorkspaceCore} from '../src/component-adapter.mjs';
const catalog=await readJson(new URL('../examples/modern-all-components.catalog.json',import.meta.url));
const context=await createPlanningContext(INPUT_CAPABILITY_CASES[0].request,catalog);
const wrong='当前可用的 input 行字段无法表达“必填、最少2、最多12”校验。是否允许省略这些校验并生成面板？';
test('capability reminder uses actual native input definitions and is absent without Input',()=>{
  const schema=buildNativePanelIntentResponseSchema(context),guide=nativeInputCapabilityGuide(schema);
  assert.match(guide,/row-level/);assert.match(guide,/"required":\{"type":"boolean"\}/);
  assert.match(guide,/"maximum":512/);assert.equal(nativeInputCapabilityGuide({type:'object'}),'');
});
test('reproduced false capability denial fails instead of becoming a valid clarification',async()=>{
  await assert.rejects(materializePanelIntent(context,{panelIntentVersion:'0.12',contextSha256:context.sha256,panel:null,unresolved:[{id:'q0',question:wrong}]}),{code:'PLAN_CAPABILITY_CONTRADICTION'});
});
for(const question of ['输入框名称是“玩家名”还是“玩家名单”？','最少12且最多2互相冲突，应该采用哪些长度？','不支持远程校验，是否改为宿主处理？','正则表达式校验不受支持，是否调整需求？',wrong.replace('最多12','最多999')])test('preserve legitimate or out-of-scope question: '+question,async()=>{
  assert.equal(contradictsInputCapabilities(context,[{question}]),false);
  const proposal=await materializePanelIntent(context,{panelIntentVersion:'0.12',contextSha256:context.sha256,panel:null,unresolved:[{id:'q0',question}]});
  assert.equal((await checkPanelProposal(context,proposal)).status,'NEEDS_INPUT');
});
test('legacy context does not advertise or reject unavailable forms',()=>{
  assert.equal(contradictsInputCapabilities({capabilities:{}},[{question:wrong}]),false);
});
test('all eight independent capability expectations use public driver without inference',async()=>{
  const model=await createWorkbenchModel({catalog,pool:await imageAssetPool()},await loadWorkspaceCore());
  try{for(const item of INPUT_CAPABILITY_CASES){const ctx=(await model.prepare(item.request)).context;
    const proposal=await materializePanelIntent(ctx,referenceIntent(ctx,item));
    assert.equal((await checkPanelProposal(ctx,proposal)).status,item.clarification?'NEEDS_INPUT':'READY_TO_COMPILE');
  }}finally{model.dispose();}
});
