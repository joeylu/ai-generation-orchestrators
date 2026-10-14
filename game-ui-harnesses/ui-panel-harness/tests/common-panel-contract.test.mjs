import test from 'node:test';
import assert from 'node:assert/strict';
import {readJson} from '../src/io.mjs';
import {createPlanningContext} from '../src/planning-context.mjs';
import {buildNativePanelIntentResponseSchema,materializePanelIntent} from '../src/panel-intent.mjs';
import {createCodexDiagnostic} from '../src/codex-diagnostics.mjs';
import {COMMON_GAME_PANEL_CASES,commonGamePanelFixture} from '../examples/common-game-panels-v1/suite.mjs';
import {referenceIntent} from '../examples/input-adaptability-v1/suite.mjs';
import {validateArtResponseConstraints} from '../scripts/lib/art-skill-native-schema.mjs';
const catalog=await readJson(new URL('../examples/modern-action-headings.catalog.json',import.meta.url));
const item=COMMON_GAME_PANEL_CASES.find(item=>item.reference.title==='购买确认');
const context=await createPlanningContext(item.request,catalog);
const layout={direction:'row',align:'center',gap:12,buttonWidth:160,buttonHeight:48,shape:'default',sourceRef:'request'};
test('dispatch schema separates mixed content from button-only action layout',()=>{
  const schema=buildNativePanelIntentResponseSchema(context),[mixed,,buttons]=schema.$defs.body.anyOf;
  assert.equal(context.planningContextVersion,'0.11');
  assert.equal(mixed.properties.actionLayout.type,'null');
  assert(buttons.properties.rows.items.anyOf.every(row=>row.properties.kind.enum[0]==='button'));
  assert.deepEqual(buttons.properties.actionLayout.anyOf[1].required,Object.keys(layout));
  const text=mixed.properties.rows.items.anyOf.find(row=>row.properties.kind.enum[0]==='text');
  assert.equal(text.properties.label.minLength,1);assert.equal(text.properties.label.maxLength,120);
  assert(!new RegExp(text.properties.label.pattern).test('   '));
});
test('a reproduced mixed action layout fails unchanged with a useful redacted diagnostic',async()=>{
  const intent=commonGamePanelFixture(context,item,referenceIntent);
  intent.panel.body.children[0].actionLayout=layout;const before=structuredClone(intent);
  await assert.rejects(materializePanelIntent(context,intent),error=>{
    assert.equal(error.code,'action-layout-rows');
    const diagnostic=createCodexDiagnostic(error,{operation:'plan',contextSha256:context.sha256,proposalJsonSha256:'a'.repeat(64),stage:'intent-validation'});
    assert.equal(diagnostic.validatorCode,'action-layout-rows');assert.equal(diagnostic.path,'$.actionLayouts[0]');
    assert.equal(Object.hasOwn(diagnostic,'message'),false);return true;
  });assert.deepEqual(intent,before);
  const valid=structuredClone(intent),section=valid.panel.body.children[0];
  const actions=section.rows.filter(row=>row.kind==='button');section.rows=section.rows.filter(row=>row.kind!=='button');section.actionLayout=null;
  valid.panel.body.children.push({kind:'section',title:'操作',rows:actions,actionLayout:layout});
  const proposal=await materializePanelIntent(context,valid);
  assert.equal(proposal.spec.actionLayouts.length,1);assert.equal(proposal.spec.actionLayouts[0].sectionId,'section1');
});
test('layout diagnostics preserve public constants but redact private paths and messages',()=>{
  const binding={operation:'plan',contextSha256:'a'.repeat(64),proposalJsonSha256:'b'.repeat(64),stage:'intent-validation'};
  for(const code of ['action-layout','action-layout-target','action-layout-rows','action-layout-size','action-layout-circle']){
    const diagnostic=createCodexDiagnostic({code,path:'$.actionLayouts[0].buttonWidth',message:'SECRET https://private.invalid'},binding);
    assert.equal(diagnostic.validatorCode,code);assert.equal(diagnostic.path,'$.actionLayouts[0].buttonWidth');assert(!JSON.stringify(diagnostic).includes('SECRET'));
    assert.equal(createCodexDiagnostic({code,path:'$.actionLayouts[0].privateToken'},binding).path,null);
  }
});
test('native button shapes reject irrelevant or missing action targets before materialization',()=>{
  const root=buildNativePanelIntentResponseSchema(context);
  const bind=value=>Array.isArray(value)?value.map(bind):value&&typeof value==='object'
    ?value.$ref?bind(root.$defs[value.$ref.split('/').at(-1)]):Object.fromEntries(Object.entries(value).map(([key,entry])=>[key,bind(entry)])):value;
  const schemas=root.$defs.body.anyOf[0].properties.rows.items.anyOf.filter(row=>row.properties.kind.enum[0]==='button').map(bind);
  const row=commonGamePanelFixture(context,item,referenceIntent).panel.body.children[0].rows.find(row=>row.kind==='button');
  validateArtResponseConstraints(row,{anyOf:schemas});
  for(const change of [{resetRows:[0]},{submitRows:[0]},{action:'submit'},{action:'reset-initial'},{label:''}])
    assert.throws(()=>validateArtResponseConstraints({...row,...change},{anyOf:schemas}),{code:'ART_RESPONSE_CONSTRAINT'});
  for(const change of [{action:'submit',submitRows:[0]},{action:'reset-initial',resetRows:[0]}])
    validateArtResponseConstraints({...row,...change},{anyOf:schemas});
});
test('geometry and content errors retain bounded public codes and paths without exposing discarded data',()=>{
  const binding={operation:'plan',stage:'intent-validation',contextSha256:'a'.repeat(64),proposalJsonSha256:'b'.repeat(64)};
  for(const [code,path]of [['CONTROL_WIDTH','$.sections[0].rows[0]'],['TEXT_WRAP_REQUIRED','$.textLayouts[0].wrap'],['dialog-fit','$.sections[0].rows[0].dialogWidth'],['tabs-section','$.tabs.pages[0].sections'],['INTENT_LABEL_QUALIFIER','$.panel.body.children[0].rows[0].label']]){
    const diagnostic=createCodexDiagnostic({code,path,message:'DISCARDED_PRIVATE_VALUE'},binding);
    assert.equal(diagnostic.validatorCode,code);assert.equal(diagnostic.path,path);assert(!JSON.stringify(diagnostic).includes('DISCARDED_PRIVATE_VALUE'));
  }
  assert.equal(createCodexDiagnostic({code:'CONTROL_WIDTH',path:'$.sections[0].privateToken'},binding).path,null);
});
