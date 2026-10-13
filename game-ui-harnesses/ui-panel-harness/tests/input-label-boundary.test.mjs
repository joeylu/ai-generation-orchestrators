import test from 'node:test';
import assert from 'node:assert/strict';
import {labelBoundaryQuestions} from '../src/input-interpretation.mjs';
import {createPlanningContext} from '../src/planning-context.mjs';
import {materializePanelIntent} from '../src/panel-intent.mjs';
import {checkPanelProposal,validatePanelProposal,requireReadyProposal} from '../src/proposal.mjs';
import {readJson} from '../src/io.mjs';
import {referenceIntent} from '../examples/input-adaptability-v1/suite.mjs';
import {oldRows} from '../examples/all-components-v1/fixture.mjs';
import {createClarifiedRequest} from '../src/clarification.mjs';
import {digestJson} from '../src/canonical.mjs';

const catalog=await readJson(new URL('../examples/modern-all-components.catalog.json',import.meta.url));
const input=oldRows.find(row=>row.kind==='input');
const specFor=(label,kind='input')=>({sections:[{rows:[{kind,label}]}]});
for(const [text,label] of [
  ['玩家名单行文字输入，初始小蓝莓','玩家名单'],
  ['角色名单行文字输入初始小蓝莓','角色名单'],
  ['备注多行文本输入框','备注多'],
  ['订单单行输入框','订单单'],
])test(`descriptor absorbed by candidate requires clarification: ${text}`,()=>{
  const questions=labelBoundaryQuestions(text,specFor(label));
  assert.equal(questions.length,1);assert(questions[0].question.includes(`“${label}”`));
  assert(questions[0].question.includes(`“${label.slice(0,-1)}”`));
});

for(const [text,label,kind] of [
  ['玩家名单行文字输入','玩家名','input'],
  ['订单单行输入框','订单','input'],
  ['Input标签“玩家名单”，单行文字输入','玩家名单','input'],
  ['Input标签为玩家名单，单行文字输入','玩家名单','input'],
  ['玩家名单行文字输入。更正：完整名称“玩家名单”。','玩家名单','input'],
  ['正文为“玩家名单行文字输入”','玩家名单','input'],
  ['正文为「玩家名单行文字输入」','玩家名单','input'],
  ['玩家名单行文字输入','玩家名单','text'],
  ['玩家名单输入框','玩家名单','input'],
])test(`literal/complete boundary remains unchanged: ${text}/${label}/${kind}`,()=>{
  assert.deepEqual(labelBoundaryQuestions(text,specFor(label,kind)),[]);
});

async function prepare(text,label){
  const context=await createPlanningContext({requestVersion:'0.1',id:'boundary',target:'pixi',text},catalog);
  const intent=referenceIntent(context,{reference:{title:'输入验收',rows:[{...input,label}]}});
  return {context,intent,proposal:await materializePanelIntent(context,intent)};
}
test('native wrong-label intent becomes specific NEEDS_INPUT without a partial panel or mutation',async()=>{
  const {context,intent,proposal}=await prepare('玩家名单行文字输入，初始小蓝莓，占位请输入角色名，必填最少2最多12，可编辑、启用。','玩家名单');
  const snapshot=JSON.stringify(intent),report=await checkPanelProposal(context,proposal);
  assert.equal(report.status,'NEEDS_INPUT');assert.equal(proposal.spec,null);assert.deepEqual(proposal.decisions,[]);
  assert.equal(proposal.unresolved.length,1);assert.match(proposal.unresolved[0].question,/玩家名.*玩家名单/u);
  await assert.rejects(requireReadyProposal(context,proposal),{code:'PLAN_NEEDS_INPUT'});
  assert.equal(JSON.stringify(intent),snapshot);
});
test('raw proposal cannot bypass the boundary guard',async()=>{
  const text='玩家名单行文字输入，初始小蓝莓，占位请输入角色名，必填最少2最多12，可编辑、启用。';
  const {context,proposal}=await prepare(text,'玩家名');
  proposal.spec.sections[0].rows[0].label='玩家名单';
  await assert.rejects(validatePanelProposal(context,proposal),{code:'PLAN_LABEL_BOUNDARY'});
});
test('explicit literal name survives full lowering; correct unquoted name remains ready',async()=>{
  for(const [text,label] of [['Input标签“玩家名单”，单行文字输入，初始小蓝莓。','玩家名单'],['玩家名单行文字输入，初始小蓝莓。','玩家名']]){
    const {context,proposal}=await prepare(text,label);
    assert.equal((await checkPanelProposal(context,proposal)).status,'READY_TO_COMPILE');
    assert.equal(proposal.spec.sections[0].rows[0].label,label);
  }
});
test('real clarification envelope does not mistake the repeated question for the selected name',async()=>{
  const {context,proposal}=await prepare('玩家名单行文字输入，初始小蓝莓。','玩家名单');
  for(const selected of ['玩家名','玩家名单']){
    const request=await createClarifiedRequest(context,proposal,{clarificationVersion:'0.1',contextSha256:context.sha256,
      proposalSha256:await digestJson(proposal),answers:[{questionId:proposal.unresolved[0].id,text:`完整名称为“${selected}”。`}]});
    const next=await createPlanningContext(request,catalog);
    for(const candidate of ['玩家名','玩家名单']){
      const result=await materializePanelIntent(next,referenceIntent(next,{reference:{title:'输入验收',rows:[{...input,label:candidate}]}}));
      if(candidate===selected)assert.equal((await checkPanelProposal(next,result)).status,'READY_TO_COMPILE');
      if(selected==='玩家名'&&candidate==='玩家名单')assert.equal((await checkPanelProposal(next,result)).status,'NEEDS_INPUT');
    }
  }
});
