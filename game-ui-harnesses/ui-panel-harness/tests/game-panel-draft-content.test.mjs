import test from 'node:test';
import assert from 'node:assert/strict';
import {readJson} from '../src/io.mjs';
import {core,nodesOf} from './helpers.mjs';
import {gamePanelDraftContentGuidance} from '../src/game-panel-draft-content.mjs';
import {themePlanningGuide} from '../src/theme-planning.mjs';
import {CARD_CONTENT_CLOSEOUT_SUITE,cardContentCloseoutFixture} from '../examples/card-content-closeout-v1/suite.mjs';
import {referenceIntent} from '../examples/input-adaptability-v1/suite.mjs';
import {loadBundledCoreAssets} from '../src/bundled-core-assets.mjs';
import {createWorkbenchModel} from '../src/workbench-model.mjs';
import {buildCodexPlanningPrompt} from '../src/codex-planner.mjs';
import {materializePanelIntent} from '../src/panel-intent.mjs';
const catalog=await readJson(new URL('../examples/modern-readable-game-card-layout.catalog.json',import.meta.url)),pool=await loadBundledCoreAssets();
test('achievement generation advice is current-only, sample-honest and subordinate to explicit simple-content requests',async()=>{
 const advice=gamePanelDraftContentGuidance(catalog);assert(advice.includes('attainment condition and progress or completion state'));
 assert(advice.includes('actual unprovided conditions and live state remain unknown'));assert(advice.includes('Keep entries read-only'));
 assert(advice.includes('Explicit name-only, list-only, omitted-detail or other user constraints override'));
 assert.equal(gamePanelDraftContentGuidance(await readJson(new URL('../examples/modern-readable-game-item-groups.catalog.json',import.meta.url))),'');
 const model=await createWorkbenchModel({catalog,pool},core);try{
   const {context}=await model.prepare({...CARD_CONTENT_CLOSEOUT_SUITE.find(item=>item.id==='G16').request,text:'做个成就面板，只列名称，不要条件和进度'});
   const prompt=await buildCodexPlanningPrompt(context);assert(prompt.includes(advice));assert(prompt.includes('只列名称，不要条件和进度'));
 }finally{model.dispose();}
});
test('editing advice preserves authored sparse lists and does not carry the new-generation completeness instruction',()=>{
 const guide=themePlanningGuide(catalog,{id:catalog.themes[0].id,version:catalog.themes[0].version});
 assert(guide.includes('preserve authored names, conditions, progress, state and deliberately simple lists'));
 assert(!guide.includes('Achievement draft completeness:'));
});
test('the separate achievement driver specimen compiles two read-only item groups with conditions, progress, state and true panels',async()=>{
 const item=CARD_CONTENT_CLOSEOUT_SUITE.find(item=>item.id==='G16'),model=await createWorkbenchModel({catalog,pool},core);try{
  const {context}=await model.prepare(item.request),intent=cardContentCloseoutFixture(context,item,referenceIntent);
  const proposal=await materializePanelIntent(context,intent);await model.acceptProposal(proposal);const bundle=await model.exportPanel();
  assert.equal(bundle.compilerVersion,'0.45.0');assert(bundle.spec.layout.width>420);assert.equal(bundle.spec.sections.length,2);
  for(const section of bundle.spec.sections){assert(section.title.startsWith('示例：'));assert.equal(section.rows.length,4);
   assert(section.rows.some(row=>row.kind==='text'&&row.label==='示例条件'&&row.text.length>0));
   assert(section.rows.some(row=>row.kind==='progress'));assert(section.rows.some(row=>row.kind==='text'&&row.label==='示例状态'));
   assert(!section.rows.some(row=>row.kind==='button'));
   assert(nodesOf(bundle.componentBundle.document).some(node=>node.id===bundle.spec.id+'.section.'+section.id&&node.type==='Panel'));
  }
 }finally{model.dispose();}
});
