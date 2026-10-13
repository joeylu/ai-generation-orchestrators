import test from 'node:test';
import assert from 'node:assert/strict';
import {readJson} from '../src/io.mjs';
import {loadWorkspaceCore} from '../src/component-adapter.mjs';
import {createPanelBundle,validatePanelBundle} from '../src/panel-bundle.mjs';
import {fitDraftPanelLayout} from '../src/draft-layout.mjs';
import {businessFacts} from '../scripts/lib/input-adaptability-oracle.mjs';
import {createPlanningContext} from '../src/planning-context.mjs';
import {materializePanelIntent} from '../src/panel-intent.mjs';
import {referenceIntent} from '../examples/input-adaptability-v1/suite.mjs';
import {SHORT_INPUT_REQUESTS} from '../examples/short-input-comparison-v1/suite.mjs';
import {createCodexDiagnostic} from '../src/codex-diagnostics.mjs';
const catalog=await readJson(new URL('../examples/modern-all-components.catalog.json',import.meta.url)),core=await loadWorkspaceCore();
const {fixtures}=await readJson(new URL('./fixtures/short-draft-layout-v1.json',import.meta.url));
const mutableDimensions=['width','maxHeight','canvasWidth','canvasHeight'];
const flatten=node=>[node,...(node.children??[]).flatMap(flatten)];
for(const fixture of fixtures)test(`${fixture.id}: saved real geometry fits without changing controls, values, actions or styles`,async()=>{
  const input=structuredClone(fixture.spec);
  if(fixture.id.endsWith('P07'))await assert.rejects(createPanelBundle(input,catalog,core),{code:'CONTROL_WIDTH'});
  else {const original=await createPanelBundle(input,catalog,core);assert(flatten(original.componentBundle.document.root).some(node=>node.type==='ScrollView'&&node.id===input.id+'.body'));}
  const fitted=fitDraftPanelLayout(input,catalog,core,{mutableDimensions});
  assert.equal(fitted.evidence.status,'CONTENT_VISIBLE');assert.deepEqual(input,fixture.spec);
  assert.deepEqual(businessFacts(fitted.spec),businessFacts(input));
  const scrub=spec=>{const value=structuredClone(spec);delete value.canvas;delete value.layout.width;delete value.layout.maxHeight;return value;};
  assert.deepEqual(scrub(fitted.spec),scrub(input));
  const bundle=await createPanelBundle(fitted.spec,catalog,core);assert.deepEqual(await validatePanelBundle(bundle,core),bundle);
  assert(!flatten(bundle.componentBundle.document.root).some(node=>node.type==='ScrollView'&&node.id===input.id+'.body'));
  assert.deepEqual(fitDraftPanelLayout(fitted.spec,catalog,core,{mutableDimensions}).spec,fitted.spec);
});
test('fixed dimensions stay fixed and cannot be silently repaired',()=>{
  const narrow=fixtures.find(item=>item.id==='U0_P07').spec;
  assert.throws(()=>fitDraftPanelLayout(narrow,catalog,core),{code:'CONTROL_WIDTH'});
  const scroll=fixtures.find(item=>item.id==='U2_P09').spec;
  const result=fitDraftPanelLayout(scroll,catalog,core);
  assert.deepEqual(result.spec,scroll);assert.equal(result.evidence.status,'FIXED_DIMENSIONS_REQUIRE_SCROLL');
  assert.throws(()=>fitDraftPanelLayout(scroll,catalog,core,{mutableDimensions:['color']}),{code:'DRAFT_DIMENSION_POLICY'});
});
test('typed action diagnostics reject wrong targets without changing or retrying an intent',async()=>{
  const item=SHORT_INPUT_REQUESTS[8],context=await createPlanningContext(item.request,catalog);
  const cases=[{indices:[0],action:'submit',code:'INTENT_SUBMIT_REQUIRES_INPUT'},
    {indices:[99],action:'reset-initial',code:'INTENT_ACTION_TARGET_MISSING'},
    {indices:[0,0],action:'reset-initial',code:'INTENT_ACTION_DUPLICATE'},
    {indices:[2],action:'reset-initial',code:'INTENT_RESET_REQUIRES_STATE'}];
  for(const entry of cases){
    const intent=referenceIntent(context,item),button=intent.panel.body.children[0].rows[2];button.action=entry.action;button[entry.action==='submit'?'submitRows':'resetRows']=entry.indices;
    const before=structuredClone(intent);
    await assert.rejects(materializePanelIntent(context,intent),error=>{
      assert.equal(error.code,entry.code);
      const diagnostic=createCodexDiagnostic(error,{operation:'plan',contextSha256:context.sha256,proposalJsonSha256:'a'.repeat(64),stage:'intent-validation'});
      assert.equal(diagnostic.validatorCode,entry.code);assert(diagnostic.path.includes('Rows['));return true;
    });assert.deepEqual(intent,before);
  }
  const valid=referenceIntent(context,item);valid.panel.body.children[0].rows[2].action='reset-initial';valid.panel.body.children[0].rows[2].resetRows=[0,1];
  const result=await materializePanelIntent(context,valid);assert.equal(result.spec.sections[0].rows[2].action.kind,'reset-initial');
});
