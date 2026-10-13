import test from 'node:test';
import assert from 'node:assert/strict';
import * as panel from '../src/index.mjs';
import {readJson} from '../src/io.mjs';
import {loadWorkspaceCore} from '../src/component-adapter.mjs';
import {imageSpec,imageRequest,imageIntent,flatten} from '../examples/image-slots-v1/fixture.mjs';
import {materializePanelIntent,validateNativePanelIntentEvidence,buildNativePanelIntentResponseSchema} from '../src/panel-intent.mjs';
import {createWorkbenchModel} from '../src/workbench-model.mjs';
import {buildCodexEditResponseSchema,codexEditOperationContracts} from '../src/codex-edit-schema.mjs';
import {materializeCodexEditDraft} from '../src/codex-edit-draft.mjs';
import {digestJson} from '../src/canonical.mjs';
import {imageAssetPool} from '../examples/image-slots-v1/assets.mjs';
import {workbenchAssetInputs,workbenchRetrieval,verifyWorkbenchContextPool} from '../src/workbench-assets.mjs';
import {headingSpec,headingCases} from '../examples/section-headings-v1/fixture.mjs';
import {composePanelBundles,validatePanelComposition} from '../src/panel-composition.mjs';
import {readFile} from 'node:fs/promises';
const catalog=await readJson(new URL('../examples/modern-image-slots.catalog.json',import.meta.url));
const core=await loadWorkspaceCore();
const pool=await imageAssetPool(),library={id:pool.index.id,sha256:pool.index.sha256},keys=pool.index.records.map(record=>record.key);
function sourcedSpec(fit='contain') {const spec=imageSpec(panel,catalog,{source:keys[0],fit});spec.assets={library,panelSurface:null,rowIcons:[]};return spec;}
test('image retrieval is opt-in; exact PNGs enter the image-only resource closure',async()=>{
  const old=workbenchRetrieval(imageRequest.text,pool),retrieval=workbenchRetrieval(imageRequest.text,pool,{images:true});
  assert.equal(old.assetRetrievalVersion,'0.1');assert.deepEqual(old.candidates,[]);
  assert.equal(retrieval.assetRetrievalVersion,'0.2');assert.equal(retrieval.candidates.length,3);assert(retrieval.candidates.every(candidate=>candidate.slot==='content-image'));
  const context=await panel.createPlanningContext(imageRequest,catalog,retrieval);assert.deepEqual(await verifyWorkbenchContextPool(context,pool),retrieval);
  const intent=imageIntent(context,{source:keys}),proposal=await materializePanelIntent(context,intent),inputs=await workbenchAssetInputs(proposal.spec,pool);
  const bundle=await panel.createPanelBundle(proposal.spec,catalog,core,undefined,inputs);
  assert.deepEqual(panel.panelAssetKeys(bundle.spec),keys);assert.equal(bundle.assetClosure.records.length,3);
  assert.equal(flatten(bundle.componentBundle.document.root).filter(node=>node.type==='Image').length,3);
  assert.deepEqual((await panel.checkPanelProposal(context,proposal)).assetEvidence.selectedKeys,keys);
  assert.deepEqual(await panel.validatePanelBundle(JSON.parse(JSON.stringify(bundle)),core),bundle);
  const model=await createWorkbenchModel({catalog,pool},core);const prepared=await model.prepare(imageRequest);
  assert.equal(prepared.context.assetRetrieval.assetRetrievalVersion,'0.2');
  assert.equal((await model.acceptProposal(await materializePanelIntent(prepared.context,imageIntent(prepared.context,{source:keys})))).phase,'ready');model.dispose();
});
for(const fit of ['contain','cover','stretch'])test(`static PNG ${fit}: exact source pixels and equivalent UGUI region`,async()=>{
  const spec=sourcedSpec(fit),bundle=await panel.createPanelBundle(spec,catalog,core,undefined,await workbenchAssetInputs(spec,pool));
  const image=flatten(bundle.componentBundle.document.root).find(node=>node.id.endsWith('portrait.control'));
  assert.equal(image.type,'Image');assert.equal(image.props.fit,fit);assert.equal(image.props.drawBackground,false);
  const native=(await panel.createUnityDocument(bundle,core)).nodes.find(node=>node.id===image.id);
  assert.equal(native.source,image.props.source);assert.equal(native.fit,fit==='cover'?'stretch':fit);
  if(fit==='cover'){assert.equal(native.hasRegion,true);assert.equal(native.regionWidth,128);assert(native.regionHeight<192);assert(Math.abs(native.regionWidth/native.regionHeight-image.layout.width/image.layout.height)<1e-12);}
  else assert.equal(native.hasRegion,false);
});
test('first image attaches one pinned library; replacement uses exact candidates and edits retain unused state',async()=>{
  const spec=imageSpec(panel,catalog),model=await createWorkbenchModel({catalog,pool},core);await model.importPanel(await panel.createPanelBundle(spec,catalog,core,{row0:31}));
  const request={...imageRequest,text:'角色肖像绑定战士验证纹理，完整显示，其他内容不变。'},prepared=await model.prepareEdit(request,{rowId:'portrait'}),context=prepared.context;
  assert(context.assetRetrieval.candidates.some(candidate=>candidate.asset.key===keys[0]));
  const operation={op:'set-image-properties',rowId:'portrait',source:keys[0],width:'fill',height:180,fit:'contain',assetLibrary:library};
  const draft={codexEditDraftVersion:'0.3',contextSha256:context.sha256,patch:{patchVersion:'0.1',baseSpecSha256:context.baseSpecSha256,reason:request.text,operations:[operation]},bases:[{kind:'request-interpretation',quote:request.text}],unresolved:[],noChange:null};
  const proposal=await materializeCodexEditDraft(context,draft);await model.acceptEditProposal(proposal);
  const first=model.getSnapshot().panel;assert.deepEqual(first.state,{row0:31});assert.deepEqual(first.spec.assets.library,library);assert.deepEqual(first.assetClosure.records.map(record=>record.key),[keys[0]]);
  await model.patch({patchVersion:'0.1',baseSpecSha256:await digestJson(first.spec),reason:'只修改标题',operations:[{op:'set-panel-title',title:'角色预览'}]});
  const second=model.getSnapshot().panel;assert.deepEqual(second.assetClosure,first.assetClosure);assert.deepEqual(second.spec.sections,first.spec.sections);assert.deepEqual(second.state,first.state);
  await model.patch({patchVersion:'0.1',baseSpecSha256:await digestJson(second.spec),reason:'恢复占位',operations:[{...operation,source:null,assetLibrary:null}]});
  assert.equal(model.getSnapshot().panel.spec.assets,null);assert.equal(model.getSnapshot().panel.assetClosure,undefined);assert.deepEqual(model.getSnapshot().panel.state,first.state);model.dispose();
});
test('saved image bundle edits work without an installed image library',async()=>{
  const spec=sourcedSpec(),bundle=await panel.createPanelBundle(spec,catalog,core,undefined,await workbenchAssetInputs(spec,pool));
  const model=await createWorkbenchModel({catalog,pool:null},core);await model.importPanel(JSON.parse(JSON.stringify(bundle)),{row0:23});
  await model.patch({patchVersion:'0.1',baseSpecSha256:await digestJson(spec),reason:'修改占位描述不换图',operations:[{op:'set-row-label',rowId:'portrait',label:'战士肖像'}]});
  const result=model.getSnapshot().panel;assert.deepEqual(result.assetClosure,bundle.assetClosure);assert.deepEqual(result.state,{row0:23});model.dispose();
});
test('image source and geometry gates reject invented paths, lost bindings and overflow',async()=>{
  for(const change of [row=>row.source='https://invalid.test/image.png',row=>row.width=0,row=>row.height=4096,row=>row.fit='crop',row=>row.enabled=true,row=>row.bind='row0']){
    const spec=imageSpec(panel,catalog);change(spec.sections[0].rows[0]);assert.throws(()=>panel.validatePanelSpec(spec));
  }
  assert.throws(()=>panel.validatePanelSpec({...sourcedSpec(),assets:null}),{code:'asset-selection'});
  const wide=imageSpec(panel,catalog);wide.sections[0].rows[0].width=1000;assert.throws(()=>panel.compilePanel(wide,catalog,core),{code:'IMAGE_GEOMETRY'});
  const oldTheme=structuredClone(catalog);oldTheme.themes=oldTheme.themes.map(theme=>theme.id===wide.theme.id&&theme.version===wide.theme.version?{id:theme.id,version:theme.version,tokens:theme.tokens,visualStyle:'modern-v2'}:theme);
  assert.throws(()=>panel.compilePanel(imageSpec(panel,catalog),oldTheme,core),{code:'VISUAL_STYLE_VERSION'});
  const tiny=imageSpec(panel,catalog);tiny.sections[0].rows[0].height=16;assert.throws(()=>panel.compilePanel(tiny,catalog,core),{code:'IMAGE_PLACEHOLDER_LABEL'});
  const strict=structuredClone(catalog);strict.recipes.find(recipe=>recipe.kind==='image-row').minWidth=200;
  const narrow=sourcedSpec();narrow.sections[0].rows[0].width=128;const narrowAssets=await workbenchAssetInputs(narrow,pool);assert.throws(()=>panel.compilePanel(narrow,strict,core,undefined,narrowAssets.closure),{code:'RECIPE_GEOMETRY'});
  const spec=sourcedSpec(),inputs=await workbenchAssetInputs(spec,pool);inputs.resources[0].bytes[20]^=1;
  await assert.rejects(panel.createPanelBundle(spec,catalog,core,undefined,inputs));
  const context=await panel.createPlanningContext(imageRequest,catalog,workbenchRetrieval(imageRequest.text,pool,{images:true})),intent=imageIntent(context,{source:'image-fixtures/missing@1.0.0'});
  await assert.rejects(materializePanelIntent(context,intent),{code:'PLAN_ASSET_CANDIDATE'});
});
test('placeholder image coexists with volume 57 without acquiring a binding or event',async()=>{
  const spec=imageSpec(panel,catalog),bundle=await panel.createPanelBundle(spec,catalog,core);
  assert.equal(bundle.compilerVersion,'0.29.0');assert.equal(bundle.panelBundleVersion,'0.15');
  assert.deepEqual(bundle.state,{row0:57});assert.deepEqual(bundle.bindings.map(x=>x.fieldId),['row0']);
  const node=flatten(bundle.componentBundle.document.root).find(node=>node.id.endsWith('portrait.control'));
  assert.equal(node.type,'Container');assert.equal(node.layout.height,180);assert.equal(node.layout.y,0);
  assert.deepEqual(await panel.validatePanelBundle(JSON.parse(JSON.stringify(bundle)),core),bundle);
  const unity=await panel.createUnityDocument(bundle,core);assert.equal(unity.controls.length,1);
});
test('image edits expose exact native operations, preserve current values, save and undo',async()=>{
  const spec=imageSpec(panel,catalog),model=await createWorkbenchModel({catalog,pool:null},core);
  await model.importPanel(await panel.createPanelBundle(spec,catalog,core,{row0:42}));
  const request={...imageRequest,text:'把角色肖像高度改成220，保留占位和其他内容。'};
  const {context}=await model.prepareEdit(request,{rowId:'portrait'});
  assert.equal(context.editContextVersion,'0.15');assert.deepEqual(context.capabilities.operations,['set-row-label','remove-row','set-image-properties']);
  const schema=await buildCodexEditResponseSchema({draft:true,context});
  assert(codexEditOperationContracts(schema,context).some(op=>op.operation==='set-image-properties'));
  const patch={patchVersion:'0.1',baseSpecSha256:context.baseSpecSha256,reason:request.text,operations:[{op:'set-image-properties',rowId:'portrait',source:null,width:'fill',height:220,fit:'contain',assetLibrary:null}]};
  const proposal=await materializeCodexEditDraft(context,{codexEditDraftVersion:'0.3',contextSha256:context.sha256,patch,bases:[{kind:'request-interpretation',quote:request.text}],unresolved:[],noChange:null});
  await model.acceptEditProposal(proposal);const current=model.getSnapshot().panel;
  assert.equal(current.spec.sections[0].rows[0].height,220);assert.deepEqual(current.state,{row0:42});assert.deepEqual(current.spec.state,spec.state);
  assert.deepEqual(current.spec.sections[0].rows[1],spec.sections[0].rows[1]);assert.equal(model.getEditBudget().used,1);
  assert.deepEqual(await panel.validatePanelBundle(JSON.parse(JSON.stringify(current)),core),current);
  await model.undo();assert.deepEqual(model.getSnapshot().panel.spec,spec);assert.deepEqual(model.getSnapshot().panel.state,{row0:42});assert.equal(model.getEditBudget().used,1);model.dispose();
});
test('image add/remove patches preserve protocol and never allocate fake state',async()=>{
  const spec=imageSpec(panel,catalog),image={...spec.sections[0].rows[0],id:'second',label:'另一个肖像'};
  const result=await panel.applyPanelPatch(spec,{patchVersion:'0.1',baseSpecSha256:await digestJson(spec),reason:'新增图片槽',operations:[{op:'add-row',sectionId:spec.sections[0].id,afterRowId:'portrait',row:image,state:null,assetLibrary:null}]});
  assert.equal(result.spec.panelSpecVersion,'0.15');assert.deepEqual(result.spec.state,spec.state);
  await panel.createPanelBundle(result.spec,catalog,core);
  const removed=await panel.applyPanelPatch(result.spec,{patchVersion:'0.1',baseSpecSha256:await digestJson(result.spec),reason:'移除新增图片槽',operations:[{op:'remove-row',rowId:'second'}]});assert.deepEqual(removed.spec,spec);
});
test('native image intent materializes names, independent actions and exact placeholders',async()=>{
  const context=await panel.createPlanningContext(imageRequest,catalog,null);
  assert.equal(context.planningContextVersion,'0.10');assert(context.capabilities.rowKinds.includes('image'));
  const schema=buildNativePanelIntentResponseSchema(context);assert.deepEqual(schema.properties.panelIntentVersion.enum,['0.11']);
  const intent=imageIntent(context);validateNativePanelIntentEvidence(context,intent);
  const proposal=await materializePanelIntent(context,intent),bundle=await panel.createPanelBundle(proposal.spec,catalog,core);
  assert.equal(bundle.spec.panelSpecVersion,'0.15');assert.equal(bundle.spec.state.length,0);
  assert.deepEqual(bundle.spec.sections.map(section=>section.rows[1].text),['战士','魔法师','弓箭手']);
  assert.equal(bundle.actions.length,3);assert.equal(bundle.spec.assets,null);
});

test('image sections retain multi-group, tabs and explicit title rules and native version gates',async()=>{
  for(const id of ['distinct-groups','explicit-show','tabs']){
    const fixture=headingCases.find(item=>item.id===id),spec=headingSpec(panel,catalog,fixture);
    Object.assign(spec,{panelSpecVersion:'0.15',appearance:null,actionLayouts:[],buttonStyles:[],buttonFonts:[],titleBar:null,textLayouts:[],frame:null});
    for(const [i,section]of spec.sections.entries())section.rows.unshift({...imageSpec(panel,catalog).sections[0].rows[0],id:'portrait'+i,height:120});
    const bundle=await panel.createPanelBundle(spec,catalog,core),nodes=flatten(bundle.componentBundle.document.root);
    assert.deepEqual(nodes.filter(node=>/\.section\.[^.]+\.title$/.test(node.id)).map(node=>node.props.text),fixture.headings);
    assert.equal(bundle.state.row0,57);assert.equal(nodes.find(node=>node.id.endsWith('portrait0.control')).layout.y,spec.layout.sectionTitleHeight+spec.layout.gap);
    if(fixture.tabs){assert.equal(bundle.state.page,'page0');assert.deepEqual(bundle.spec.tabs,spec.tabs);}
    assert.deepEqual(await panel.validatePanelBundle(JSON.parse(JSON.stringify(bundle)),core),bundle);
    const native=await panel.createUnityDocument(bundle,core);assert.equal(native.panelSpecVersion,'0.15');assert.equal(native.controls.filter(control=>control.kind==='tabs').length,fixture.tabs?1:0);
  }
  for(const path of ['../adapters/unity/Editor/PanelPrefabBuilder.cs','../adapters/unity/Runtime/PanelController.cs']){
    const source=await readFile(new URL(path,import.meta.url),'utf8');
    const gates=[...source.matchAll(/(?:document|source)\.panelSpecVersion != "0\.[0-9]+"(?: && (?:document|source)\.panelSpecVersion != "0\.[0-9]+")*/g)].map(match=>match[0]).filter(gate=>gate.includes(" && "));
    assert(gates.length>=4);for(const gate of gates)assert(gate.includes('"0.15"'),gate);
    for(const match of source.matchAll(/new\[\] \{([^}]+)\}\.Contains\(document\.panelSpecVersion\)/g))assert(match[1].includes('"0.15"'));
  }
});

test('image bundles compose into tabs with deduplicated resources and separate current state',async()=>{
  const spec=sourcedSpec(),inputs=await workbenchAssetInputs(spec,pool),a=await panel.createPanelBundle(spec,catalog,core,{row0:21},inputs),b=await panel.createPanelBundle({...spec,id:'other-portrait'},catalog,core,{row0:82},inputs);
  const request={panelCompositionRequestVersion:'0.1',id:'portrait-tabs',title:'角色页',sources:[{namespace:'one',bundleSha256:a.sha256},{namespace:'two',bundleSha256:b.sha256}],layout:'tabs',width:640,canvasWidth:704,canvasHeight:800,maxHeight:700,surfaceFrom:null};
  const result=await composePanelBundles(request,[a,b],core),combined=result.bundle;
  assert.equal(combined.spec.panelSpecVersion,'0.15');assert.equal(combined.spec.tabs.pages.length,2);assert.equal(combined.spec.frame,null);
  assert.equal(combined.state.one_f_row0,21);assert.equal(combined.state.two_f_row0,82);assert.equal(combined.assetClosure.records.length,1);
  assert.equal(flatten(combined.componentBundle.document.root).filter(node=>node.type==='Image'&&node.props.source===`textures/${combined.assetClosure.records[0].sha256}.png`).length,2);
  assert.deepEqual(await validatePanelComposition(result,[a,b],core),result);
});

test('lower-level layout and style edits preserve image protocol, source and resource closure',async()=>{
  const spec=imageSpec(panel,catalog,{cards:true,source:keys[0]});spec.assets={library,panelSurface:null,rowIcons:[]};
  const bundle=await panel.createPanelBundle(spec,catalog,core,undefined,await workbenchAssetInputs(spec,pool)),model=await createWorkbenchModel({catalog,pool:null},core);await model.importPanel(bundle);
  const edits=[{op:'set-text-wrap',rowId:'name0',wrap:'word'},{op:'set-title-bar',style:{horizontalAlign:'center',verticalAlign:'middle',backgroundColor:null,textColor:null,cornerRadius:null,fontSize:null,padding:4}},{op:'set-button-font-size',rowId:'choose0',fontSize:16},{op:'set-button-style',rowId:'choose0',style:{backgroundColor:null,textColor:null,borderColor:null,borderWidth:null,cornerRadius:12,width:200,height:64,shape:'default'}},{op:'set-panel-ratio',ratio:{width:16,height:9},width:1000}];
  for(const operation of edits){const before=model.getSnapshot().panel;await model.patch({patchVersion:'0.1',baseSpecSha256:await digestJson(before.spec),reason:'确定性布局修改',operations:[operation]});const after=model.getSnapshot().panel;
    assert.equal(after.spec.panelSpecVersion,'0.15');assert.deepEqual(after.assetClosure,bundle.assetClosure);assert.deepEqual(after.state,bundle.state);assert.equal(after.spec.sections[0].rows[0].source,keys[0]);}
  assert.equal(model.getEditBudget().used,edits.length);model.dispose();
});

test('native image addition binds exact first-library evidence and rejects missing library fields',async()=>{
  const spec=imageSpec(panel,catalog),model=await createWorkbenchModel({catalog,pool},core);await model.importPanel(await panel.createPanelBundle(spec,catalog,core));
  const request={...imageRequest,text:'新增战士肖像图片，使用战士验证纹理。'},context=(await model.prepareEdit(request)).context;
  const schema=await buildCodexEditResponseSchema({draft:true,context}),branches=codexEditOperationContracts(schema,context).filter(contract=>contract.operation==='add-row');
  assert.equal(branches.filter(branch=>branch.required.includes('assetLibrary')).length,1);
  const operation={op:'add-row',sectionId:spec.sections[0].id,afterRowId:'portrait',row:{...spec.sections[0].rows[0],id:'added-portrait',source:keys[0],height:100},state:null,assetLibrary:library};
  const draft={codexEditDraftVersion:'0.3',contextSha256:context.sha256,patch:{patchVersion:'0.1',baseSpecSha256:context.baseSpecSha256,reason:request.text,operations:[operation]},bases:[{kind:'request-interpretation',quote:request.text}],unresolved:[],noChange:null};
  const missing=structuredClone(draft);delete missing.patch.operations[0].assetLibrary;await assert.rejects(materializeCodexEditDraft(context,missing),{code:'EDIT_PATCH'});
  const forged=structuredClone(draft);forged.patch.operations[0].row.source='image-fixtures/missing@1.0.0';await assert.rejects(materializeCodexEditDraft(context,forged),{code:'EDIT_ASSET_CANDIDATE'});
  await model.acceptEditProposal(await materializeCodexEditDraft(context,draft));const current=model.getSnapshot().panel;
  assert.deepEqual(current.state,{row0:57});assert.deepEqual(current.spec.assets.library,library);assert.equal(current.assetClosure.records.length,1);model.dispose();
});
