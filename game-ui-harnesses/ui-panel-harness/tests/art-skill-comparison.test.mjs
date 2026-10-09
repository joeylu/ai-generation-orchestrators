import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {core} from './helpers.mjs';
import {assetUsageFixtures} from '../examples/asset-usage-v1/fixture.mjs';
import {craftedAudioStudy} from '../examples/crafted-audio-v1/fixture.mjs';
import {ART_SKILL_CONDITIONS,artSkillResponseSchema,materializeArtSkillResponse} from '../examples/crafted-audio-v1/skill-comparison.mjs';
import {loadBundledCoreAssets} from '../src/bundled-core-assets.mjs';
import {workbenchAssetInputs} from '../src/workbench-assets.mjs';
import {createPanelBundle,validatePanelBundle,panelBundleAssetInputs} from '../src/panel-bundle.mjs';
const json=async path=>JSON.parse(await readFile(new URL(path,import.meta.url),'utf8'));
const [catalog,base,pool]=await Promise.all([json('../examples/modern-minimal.catalog.json'),json('../examples/settings-controls.panel.json'),loadBundledCoreAssets()]);
const fixtures=await assetUsageFixtures(catalog,base,pool),baselines={},response={artStudyVersion:'0.1',designNote:'Test double only; no Skill/model result.'};
for(const mode of ['light','dark']){
  const spec=structuredClone(fixtures.settings.chosen);spec.theme={id:`modern-mint-${mode}`,version:'0.9.0'};
  const before=await createPanelBundle(spec,catalog,core,{volume:67,music:32,muted:true},await workbenchAssetInputs(spec,pool));
  const study=craftedAudioStudy(before),bundle=await createPanelBundle(study.spec,study.catalog,core,before.state,panelBundleAssetInputs(before,core));
  baselines[mode]=bundle;response[mode]={tokens:bundle.catalog.themes.find(t=>t.id===bundle.spec.theme.id).tokens,
    canvas:bundle.spec.canvas,layout:bundle.spec.layout,titleBar:null,buttonStyles:bundle.spec.buttonStyles,actionLayouts:bundle.spec.actionLayouts};
}
test('all guidance conditions lower through the same compiler with exact played state, actions and original assets',async()=>{
  const snapshot=structuredClone(baselines),input=structuredClone(response);
  for(const condition of ART_SKILL_CONDITIONS){
    const result=await materializeArtSkillResponse(response,baselines,core,{conditionId:condition.id,fixture:true});
    for(const mode of ['light','dark']){
      await validatePanelBundle(result[mode],core);assert.equal(result[mode].compilerVersion,'0.20.0');
      assert.equal(result[mode].spec.provenance.kind,'programmatic-fixture');
      assert.deepEqual(result[mode].spec.sections,baselines[mode].spec.sections);
      for(const key of ['state','actions','bindings','assetClosure'])assert.deepEqual(result[mode][key],baselines[mode][key]);
    }
  }
  assert.deepEqual(baselines,snapshot);assert.deepEqual(response,input);
});
test('model cannot smuggle replacement business fields or fonts through the art response',async()=>{
  for(const edit of [r=>r.state={volume:0},r=>r.dark.spec=baselines.dark.spec,r=>r.dark.tokens.fontFamily='unapproved font']){
    const bad=structuredClone(response);edit(bad);
    await assert.rejects(()=>materializeArtSkillResponse(bad,baselines,core,{conditionId:'frontend-design'}),/ART_STUDY_RESPONSE_FIELDS|ART_STUDY_FONT/);
  }
});
test('invalid model geometry fails without fitting, clamping or modifying the source',async()=>{
  const bad=structuredClone(response),snapshot=structuredClone(baselines);bad.dark.layout.width=200;
  await assert.rejects(()=>materializeArtSkillResponse(bad,baselines,core,{conditionId:'impeccable'}));assert.deepEqual(baselines,snapshot);
});
test('schema locks renderer and source section identities, and unknown conditions/baselines are refused',async()=>{
  const schema=artSkillResponseSchema(baselines.dark);
  assert.deepEqual(schema.properties.light,schema.properties.dark);
  assert.deepEqual(schema.properties.dark.properties.tokens.properties.fontFamily.enum,[response.dark.tokens.fontFamily]);
  assert.deepEqual(schema.properties.dark.properties.layout.properties.body.properties.children.items.enum,baselines.dark.spec.layout.body.children);
  await assert.rejects(()=>materializeArtSkillResponse(response,baselines,core,{conditionId:'other'}),/ART_STUDY_CONDITION/);
  const saved={...baselines,dark:{...baselines.dark,spec:{...baselines.dark.spec,provenance:{...baselines.dark.spec.provenance,kind:'agent-authored'}}}};
  await assert.rejects(()=>materializeArtSkillResponse(response,saved,core,{conditionId:'taste-redesign'}),/ART_STUDY_BASELINE/);
});
