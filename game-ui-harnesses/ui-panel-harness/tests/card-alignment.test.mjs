import test from 'node:test';
import assert from 'node:assert/strict';
import * as panel from '../src/index.mjs';
import {core} from './helpers.mjs';
import {readJson} from '../src/io.mjs';
import {canonicalJson,digestJson} from '../src/canonical.mjs';
import {centeredCardTextIds,alignCardText} from '../src/card-alignment.mjs';
import {createWorkbenchModel} from '../src/workbench-model.mjs';
import {materializePanelIntent} from '../src/panel-intent.mjs';
import {themePlanningGuide} from '../src/theme-planning.mjs';
import {conciseRoleSpec,flatten} from '../examples/image-slots-v1/fixture.mjs';
import {imageAssetPool} from '../examples/image-slots-v1/assets.mjs';
import {workbenchAssetInputs} from '../src/workbench-assets.mjs';
import {sampleCases,sampleRequest,sampleIntent} from '../examples/panel-samples-v1/fixture.mjs';
import {headingSpec} from '../examples/section-headings-v1/fixture.mjs';
const old=await readJson(new URL('../examples/modern-image-slots.catalog.json',import.meta.url)),
  catalog=await readJson(new URL('../examples/modern-centered-cards.catalog.json',import.meta.url));
const themeFor=(spec,c=catalog)=>c.themes.find(t=>t.id===spec.theme.id&&t.version===spec.theme.version);

test('new pinned themes change only card alignment and version; colors, recipes and old catalog stay exact',()=>{
  const visual=({version,cardAlignment,...t})=>t;
  assert.equal(catalog.themes.length,16);assert.deepEqual(catalog.recipes,old.recipes);
  for(const t of catalog.themes){
    const source=old.themes.find(v=>v.id===t.id&&v.headingStyle===t.headingStyle);
    assert.deepEqual(visual(t),visual(source));assert.equal(t.cardAlignment,'centered-v1');
    assert.equal(t.version,t.headingStyle==='visible-v2'?'0.21.1':'0.21.0');assert.equal(source.cardAlignment,undefined);
  }
  for(const change of [{cardAlignment:'center'},{headingStyle:'concise-v1'},{surfaceStyle:'minimal-v1'}]){
    const invalid=structuredClone(catalog);Object.assign(invalid.themes[0],change);assert.throws(()=>panel.validateCatalog(invalid));
  }
  assert(themePlanningGuide(catalog).includes('Centered-v1'));assert(!themePlanningGuide(old).includes('Centered-v1'));
});

for(const mode of ['light','dark'])test(`${mode}: image card headings/hints opt in; content, actions and state are preserved`,async()=>{
  const before=await panel.createPanelBundle(conciseRoleSpec(panel,old,{mode}),old,core),spec=structuredClone(before.spec);
  const t=catalog.themes.find(t=>t.id===spec.theme.id&&t.headingStyle==='concise-v2');spec.theme={id:t.id,version:t.version};
  const after=await panel.createPanelBundle(spec,catalog,core,before.state);
  assert.equal(before.compilerVersion,'0.29.0');assert.equal(after.compilerVersion,'0.30.0');
  assert.deepEqual({...after.spec,theme:before.spec.theme},before.spec);assert.deepEqual(after.actions,before.actions);assert.deepEqual(after.state,before.state);
  assert.deepEqual(centeredCardTextIds(before.spec,themeFor(before.spec,old)),[]);assert.equal(centeredCardTextIds(after.spec,t).length,6);
  assert.deepEqual(after.componentBundle.document,before.componentBundle.document);
  assert.deepEqual(await panel.validatePanelBundle(JSON.parse(JSON.stringify(after)),core),after);
  assert.deepEqual(await panel.validatePanelBundle(before,core),before);
  const native=await panel.createUnityDocument(after,core),ids=new Set(centeredCardTextIds(after.spec,t));
  assert.equal(native.adapterVersion,'0.1.6');assert.equal(native.controls.length,3);
  for(const node of native.nodes)if(ids.has(node.id))assert.equal(node.textAlignment,'MiddleCenter');
  assert.equal(native.nodes.filter(n=>ids.has(n.id)).length,6);
  const legacy=await panel.createUnityDocument(before,core);assert(legacy.nodes.filter(n=>ids.has(n.id)).every(n=>n.textAlignment===undefined));
});

test('description remains left aligned; bound PNG has centered heading and no invented caption',async()=>{
  const pool=await imageAssetPool(),spec=conciseRoleSpec(panel,catalog);
  spec.assets={library:{id:pool.index.id,sha256:pool.index.sha256},panelSurface:null,rowIcons:[]};
  spec.sections.forEach((s,i)=>{s.rows[0].source=pool.index.records[i].key;s.rows[0].label='肖像';});
  spec.sections[0].rows.splice(1,0,{id:'description',kind:'text',recipe:{id:'settings.text',version:'0.1.0'},label:'说明',text:'擅长近战'});
  spec.canvas.height=680;spec.layout.maxHeight=640;
  const b=await panel.createPanelBundle(spec,catalog,core,undefined,await workbenchAssetInputs(spec,pool));
  assert.equal(centeredCardTextIds(spec,themeFor(spec)).length,3);
  const doc=await panel.createUnityDocument(b,core);assert(doc.nodes.filter(n=>n.id.includes('.description.')).every(n=>n.textAlignment===undefined));
  assert.equal(doc.assets.length,3);assert.equal(flatten(b.componentBundle.document.root).filter(n=>n.id.endsWith('.placeholder')).length,0);
});

for(const item of sampleCases)test(`current generation path ${item.id}: align only cards, preserve form/settings/Tabs semantics`,async()=>{
  for(const mode of ['light','dark']){
    const model=await createWorkbenchModel({catalog,pool:null},core);
    try{
      const {context}=await model.prepare(sampleRequest(item)),intent=sampleIntent(context,item,mode),proposal=await materializePanelIntent(context,intent);
      const bundle=(await model.acceptProposal(proposal)).panel;assert.equal(bundle.compilerVersion,'0.30.0');
      const ids=centeredCardTextIds(bundle.spec,themeFor(bundle.spec));assert.equal(ids.length,item.id==='roles'?6:0);
      const native=await panel.createUnityDocument(bundle,core);assert.equal(native.nodes.filter(n=>n.textAlignment==='MiddleCenter').length,item.id==='roles'?6:0);
      assert.deepEqual(await panel.validatePanelBundle(JSON.parse(JSON.stringify(bundle)),core),bundle);
      if(item.id==='audio')assert.deepEqual(bundle.state,{row0:70,row1:40,row2:false});
      if(item.id==='tabs')assert.equal(bundle.state.row5,57);
    }finally{model.dispose();}
  }
});

test('mixed settings, multiple buttons and non-emit actions do not acquire card centering',()=>{
  const spec=conciseRoleSpec(panel,catalog),t=themeFor(spec);
  const modified=changes=>{const clone=structuredClone(spec);changes(clone.sections[0]);return centeredCardTextIds(clone,t).filter(id=>id.includes('.role0.')||id.includes('.portrait0.'));};
  assert.deepEqual(modified(s=>s.rows.push({...s.rows[1],id:'extra'})),[]);
  assert.deepEqual(modified(s=>s.rows[1].action={kind:'reset-initial',fields:['f']}),[]);
  assert.deepEqual(modified(s=>s.rows[1].label='操作'),[]);
  assert.deepEqual(modified(s=>s.rows.push({kind:'slider'})),[]);
});

test('ordinary legacy edits retain exact theme/compiler/layout, without adopting new defaults',async()=>{
  const before=await panel.createPanelBundle(conciseRoleSpec(panel,old),old,core),model=await createWorkbenchModel({catalog,pool:null},core);
  try{
    await model.importPanel(before);await model.patch({patchVersion:'0.1',baseSpecSha256:await digestJson(before.spec),reason:'只改标题',operations:[{op:'set-panel-title',title:'选择职业'}]});
    const after=model.getSnapshot().panel;assert.equal(after.compilerVersion,'0.29.0');assert.deepEqual(after.spec.theme,before.spec.theme);
    assert.deepEqual(after.spec.sections,before.spec.sections);assert.deepEqual(after.actions,before.actions);assert.deepEqual(after.state,before.state);
    assert.deepEqual(centeredCardTextIds(after.spec,themeFor(after.spec,after.catalog)),[]);
  }finally{model.dispose();}
});

test('new catalog keeps pre-image Specs and explicit legacy heading adoption compatible',async()=>{
  const spec=headingSpec(panel,catalog),bundle=await panel.createPanelBundle(spec,catalog,core);
  assert.equal(bundle.compilerVersion,'0.28.0');assert.deepEqual(centeredCardTextIds(spec,themeFor(spec)),[]);
  assert.equal(bundle.state.row0,57);assert.deepEqual(await panel.validatePanelBundle(bundle,core),bundle);
  const legacy=await readJson(new URL('./fixtures/section-headings/rc1-single.bundle.json',import.meta.url));
  const model=await createWorkbenchModel({catalog,pool:null},core);
  try{
    await model.importPanel(legacy);const adopted=(await model.adoptSectionHeadings('auto',{row0:57})).panel;
    assert.equal(adopted.compilerVersion,'0.28.0');assert.deepEqual(adopted.spec.sections,legacy.spec.sections);
    assert.deepEqual(adopted.state,legacy.state);assert.deepEqual(centeredCardTextIds(adopted.spec,themeFor(adopted.spec)),[]);
    assert.equal(model.getEditBudget().used,1);await model.undo();assert.deepEqual(model.getSnapshot().panel,legacy);
  }finally{model.dispose();}
});

test('heading-only adoption on saved image cards stays in its original catalog and compiler',async()=>{
  const before=await panel.createPanelBundle(conciseRoleSpec(panel,old),old,core),model=await createWorkbenchModel({catalog,pool:null},core);
  try{
    await model.importPanel(before);const shown=(await model.adoptSectionHeadings('show')).panel;
    assert.equal(shown.compilerVersion,'0.29.0');assert.deepEqual(shown.catalog,old);
    assert.deepEqual(shown.spec.sections,before.spec.sections);assert.deepEqual(shown.actions,before.actions);
    assert.deepEqual(centeredCardTextIds(shown.spec,themeFor(shown.spec,old)),[]);
    const hidden=(await model.adoptSectionHeadings('auto')).panel;assert.deepEqual(hidden.spec,before.spec);
    assert.equal(model.getEditBudget().used,2);await model.undo();await model.undo();assert.deepEqual(model.getSnapshot().panel,before);
  }finally{model.dispose();}
});

test('actual glyph offsets center short/long names and are stable on repeated alignment; hidden heading is skipped',()=>{
  const spec=conciseRoleSpec(panel,catalog),t=themeFor(spec),ids=centeredCardTextIds(spec,t),positions=new Map(ids.slice(0,5).map((id,i)=>[id,{x:0,width:32+i*23}]));
  const calls=[],runtime={inspect:()=>({nodes:[...positions].map(([id,p])=>({id,bounds:{x:100,y:0,width:240,height:32},renderedTextBounds:[{bounds:{x:103+p.x,y:3,width:p.width,height:21}}]}))}),applyMotion:(id,value)=>{assert(positions.has(id));positions.get(id).x=value.x;calls.push(id);}};
  const bundle={spec,catalog};alignCardText(bundle,runtime);const first=canonicalJson([...positions]);alignCardText(bundle,runtime);
  assert.equal(canonicalJson([...positions]),first);
  for(const p of positions.values())assert.equal(103+p.x+p.width/2,220);
  assert(!calls.includes(ids[5]));
  alignCardText({spec:conciseRoleSpec(panel,old),catalog:old},{inspect(){throw Error('legacy renderer must not be touched');}});
});
