import test from 'node:test';
import assert from 'node:assert/strict';
import { readJson } from '../src/io.mjs';
import { createPlanningContext } from '../src/planning-context.mjs';
import { materializePanelIntent, buildPanelIntentResponseSchema, buildNativePanelIntentResponseSchema, validateNativePanelIntentEvidence } from '../src/panel-intent.mjs';
import { checkPanelProposal } from '../src/proposal.mjs';
import { loadWorkspaceCore } from '../src/component-adapter.mjs';
import { createPanelBundle, validatePanelBundle } from '../src/panel-bundle.mjs';
import { evaluatePanelSemantics } from '../src/panel-evaluation.mjs';
import { INPUT_STRESS_SUITE } from '../examples/input-stress-v1/suite.mjs';
import { QUOTE_RECHECK_SUITE, quoteRecheckFixture } from '../examples/quote-recheck-v1/suite.mjs';
import { compactIntentFixture } from '../examples/panel-evaluation/intent-fixture.mjs';
import { ordinalFixture } from './ordinal-intent-fixture.mjs';
import { requestReferenceFixture } from '../examples/request-reference-v1/fixture.mjs';
const catalog=await readJson(new URL('../examples/modern-mint-forms.catalog.json',import.meta.url)),core=await loadWorkspaceCore();
async function audio(text) {
  const item=QUOTE_RECHECK_SUITE.cases.find(value=>value.id==='quote-clarified-audio');
  const context=await createPlanningContext({...item.request,...(text?{text}:{})},catalog);
  const old=quoteRecheckFixture(context,item);return {context,intent:requestReferenceFixture(old),old,item};
}
test('native 0.8 schema uses only bound request references for all seven row kinds and navigation',async()=>{
  const {context}=await audio(),schema=buildNativePanelIntentResponseSchema(context);
  assert.deepEqual(schema.properties.panelIntentVersion.enum,['0.8']);
  assert.deepEqual(schema.properties.contextSha256.enum,[context.sha256]);
  assert.deepEqual(schema.$defs.requestSourceRef,{type:'string',enum:['request']});
  assert.equal(schema.$defs.exactRequestQuote,undefined);
  const rows=schema.$defs.body.anyOf[0].properties.rows.items.anyOf;
  assert.deepEqual(rows.map(row=>row.properties.kind.enum[0]).sort(),['button','input','progress','select','slider','switch','text']);
  const tabs=schema.properties.panel.anyOf[1].properties.body.anyOf[1];
  for(const node of [...rows,tabs,tabs.properties.pages.items]){
    assert.deepEqual(node.properties.sourceRef,{$ref:'#/$defs/requestSourceRef'});
    assert(!node.properties.sourceQuote);assert(node.required.includes('sourceRef'));assert(!node.required.includes('sourceQuote'));
    assert.equal(node.additionalProperties,false);
  }
  assert.deepEqual(buildPanelIntentResponseSchema(context).properties.panelIntentVersion.enum,['0.7']);
  const oldCatalog=await readJson(new URL('../examples/modern-mint-tabs.catalog.json',import.meta.url));
  const oldContext=await createPlanningContext(context.request,oldCatalog);
  assert.deepEqual(buildNativePanelIntentResponseSchema(oldContext),buildPanelIntentResponseSchema(oldContext));
});
for(const item of INPUT_STRESS_SUITE.cases)test(`bound references preserve ${item.id} business, identities and compiled bundle`,async()=>{
  const context=await createPlanningContext(item.request,catalog),old=ordinalFixture(compactIntentFixture(context,item));
  const intent=requestReferenceFixture(old),before=structuredClone(intent),beforeContext=structuredClone(context);
  const proposal=await materializePanelIntent(context,intent);
  assert.deepEqual(proposal,await materializePanelIntent(context,old));
  assert.equal((await checkPanelProposal(context,proposal)).status,'READY_TO_COMPILE');
  assert.equal(evaluatePanelSemantics(proposal.spec,item.expected).status,'PASS');
  validateNativePanelIntentEvidence(context,intent);
  await validatePanelBundle(await createPanelBundle(proposal.spec,catalog,core),core);
  assert.deepEqual(intent,before);assert.deepEqual(context,beforeContext);
});
for(const item of QUOTE_RECHECK_SUITE.cases)test(`bound references preserve original quote failure fixture ${item.id}`,async()=>{
  const context=await createPlanningContext(item.request,catalog),old=quoteRecheckFixture(context,item),intent=requestReferenceFixture(old);
  assert.deepEqual(await materializePanelIntent(context,intent),await materializePanelIntent(context,old));
  validateNativePanelIntentEvidence(context,intent);
});
test('source binding preserves exact CRLF, emoji, repeated words and clarification bytes without model copying',async()=>{
  const text='声音🌿\r\n静音 静音；引号“静音”与"静音"。\r\n【补充回答】\r\n音量0～100，步长1，默认70；静音默认false，恢复默认仅两项。';
  const {context,intent}=await audio(text),before=structuredClone(intent),proposal=await materializePanelIntent(context,intent);
  const bases=proposal.decisions.filter(decision=>decision.basis.kind==='request-interpretation').map(decision=>decision.basis);
  assert(bases.length>=5);for(const basis of bases)assert.deepEqual(basis,{kind:'request-interpretation',start:0,end:text.length,quote:text});
  assert.deepEqual(intent,before);assert(!JSON.stringify(intent).includes(text));
});
test('0.8 rejects missing, malformed, stale and quotation fields without modifying returned data',async()=>{
  const {context,intent}=await audio();
  const changes=[row=>{delete row.sourceRef;},row=>{row.sourceRef='old-request';},row=>{row.sourceRef=null;},
    row=>{row.sourceQuote=context.request.text;},row=>{delete row.sourceRef;row.sourceQuote=context.request.text;},
    row=>{row.sourceRef={kind:'request'};}];
  for(const edit of changes){const bad=structuredClone(intent);edit(bad.panel.body.children[0].rows[0]);const before=structuredClone(bad);
    await assert.rejects(materializePanelIntent(context,bad));assert.deepEqual(bad,before);}
  const stale={...intent,contextSha256:'f'.repeat(64)};
  await assert.rejects(materializePanelIntent(context,stale),{code:'PLAN_CONTEXT_MISMATCH'});
  const older={...context,planningContextVersion:'0.6'};
  assert.throws(()=>validateNativePanelIntentEvidence(older,intent),{code:'INTENT_VERSION'});
});
test('0.8 independently validates tabs root and page references and still rejects invalid business structure',async()=>{
  const item=QUOTE_RECHECK_SUITE.cases.find(value=>value.id==='quote-tabs-progress'),context=await createPlanningContext(item.request,catalog);
  const intent=requestReferenceFixture(quoteRecheckFixture(context,item));
  for(const edit of [bad=>{bad.panel.body.sourceRef='other';},bad=>{bad.panel.body.pages[1].sourceRef='other';},
    bad=>{bad.panel.body.pages[0].body.children[0].rows[0].sourceRef='other';}]){
    const bad=structuredClone(intent);edit(bad);await assert.rejects(materializePanelIntent(context,bad),{code:'INTENT_SOURCE_REFERENCE'});
  }
  const {context:plain,intent:plainIntent,item:expected}=await audio();
  const range=structuredClone(plainIntent);range.panel.body.children[0].rows[0].step=0;
  await assert.rejects(materializePanelIntent(plain,range));
  const action=structuredClone(plainIntent);action.panel.body.children[0].rows[2].resetRows=[99];
  await assert.rejects(materializePanelIntent(plain,action));
  const recipe=structuredClone(plainIntent);recipe.panel.body.children[0].rows[0].recipeKey='unknown@0.1.0';
  await assert.rejects(materializePanelIntent(plain,recipe));
  const wrongDefault=structuredClone(plainIntent);wrongDefault.panel.body.children[0].rows[0].initial=71;
  assert.equal(evaluatePanelSemantics((await materializePanelIntent(plain,wrongDefault)).spec,expected.expected).status,'FAIL',
    'source identity must never be reported as semantic correctness');
});
test('0.8 clarification remains NEEDS_INPUT and legacy short quotes are never reinterpreted as references',async()=>{
  const {context,old}=await audio();
  const unresolved={panelIntentVersion:'0.8',contextSha256:context.sha256,panel:null,unresolved:[{id:'q0',question:'请明确重置范围。'}]};
  const proposal=await materializePanelIntent(context,unresolved);assert.equal((await checkPanelProposal(context,proposal)).status,'NEEDS_INPUT');
  validateNativePanelIntentEvidence(context,unresolved);
  old.panel.body.children[0].rows.forEach(row=>{row.sourceQuote='音量0到100、步长1、默认70';});
  await materializePanelIntent(context,old);
  assert.throws(()=>validateNativePanelIntentEvidence(context,old),{code:'INTENT_NATIVE_QUOTE'});
});
