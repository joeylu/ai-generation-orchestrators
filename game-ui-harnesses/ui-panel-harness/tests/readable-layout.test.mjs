import test from 'node:test';
import assert from 'node:assert/strict';
import {readJson} from '../src/io.mjs';
import {loadWorkspaceCore} from '../src/component-adapter.mjs';
import {loadBundledCoreAssets} from '../src/bundled-core-assets.mjs';
import {createWorkbenchModel} from '../src/workbench-model.mjs';
import {materializePanelIntent,arrangeIntentSpec} from '../src/panel-intent.mjs';
import {createPanelBundle,validatePanelBundle} from '../src/panel-bundle.mjs';
import {createUnityDocument} from '../src/unity-export.mjs';
import {createPresentationPolicy} from '../src/panel-presentation.mjs';
import {measureFlowLayout,measureTabbedLayout} from '../src/flow-layout.mjs';
import {validateCatalog} from '../src/catalog.mjs';
import {intent as allIntent,request as allRequest} from '../examples/all-components-v1/fixture.mjs';
import {imageAssetPool} from '../examples/image-slots-v1/assets.mjs';
const core=await loadWorkspaceCore(),pool=await loadBundledCoreAssets(),catalog=await readJson(new URL('../examples/modern-readable-game-layout.catalog.json',import.meta.url)),{records}=await readJson(new URL('./fixtures/readable-layout-regressions-v1.json',import.meta.url));
const flat=node=>[node,...(node.children??[]).flatMap(flat)],setting=records.find(record=>record.id==='G03');
async function replay(record,change=()=>{}){
 const model=await createWorkbenchModel({catalog,pool},core);
 try{const {context}=await model.prepare({requestVersion:'0.1',id:record.id,target:'pixi',text:record.request}),intent={...structuredClone(record.intent),contextSha256:context.sha256};
  intent.panel.themeKey='modern-mint-light@0.26.0';change(intent);
  const proposal=await materializePanelIntent(context,intent);await model.acceptProposal(proposal);return await model.exportPanel();
 }finally{model.dispose();}
}
for(const record of records)test(`${record.id}: original v0.38 outcome stays exact and unchanged native intent replays with opt-in v0.39`,async()=>{
 if(record.sourceFailure)await assert.rejects(createPanelBundle(record.spec,record.catalog,core),{code:record.sourceFailure});
 else{const original=await createPanelBundle(record.spec,record.catalog,core,record.state);assert.equal(original.sha256,record.originalBundleSha256);await validatePanelBundle(original,core);}
 const after=await replay(record);assert.equal(after.compilerVersion,'0.39.0');assert.equal(after.spec.layout.width,420);assert.equal(after.spec.canvas.width,452);
 assert.deepEqual(after.spec.sections,record.spec.sections);assert.deepEqual(after.spec.state,record.spec.state);assert.equal(after.catalog.themes[0].tokens.fontSize,24);await validatePanelBundle(after,core);
});
test('mixed sliders retain a full track with a separate label/value line and all initial actions visible',async()=>{
 const bundle=await replay(setting),nodes=flat(bundle.componentBundle.document.root),slides=nodes.filter(node=>node.type==='Slider'),buttons=nodes.filter(node=>node.type==='Button');
 assert.equal(slides.length,2);assert(slides.every(node=>node.layout.width>=300&&node.layout.height>=44));assert(buttons.every(node=>node.layout.height===64));
 assert(!nodes.some(node=>node.id===bundle.spec.id+'.body'&&node.type==='ScrollView'));assert(bundle.spec.layout.maxHeight>560);
 const native=await createUnityDocument(bundle,core);assert.equal(native.nodes.filter(node=>node.type==='Slider').length,2);
});
for(const kind of ['checkbox','list','image','progress'])test(`mixed slider + ${kind} + actions uses one readable layout without widening`,async()=>{
 const bundle=await replay(setting,intent=>{
  const rows=intent.panel.body.children[0].rows;
  const common={enabled:true,icon:null,label:'示例项目',sourceRef:'request'};
  const row=kind==='checkbox'?{...common,kind,initial:false,recipeKey:'content.checkbox@0.1.0'}
   :kind==='image'?{kind,source:null,width:'fill',height:160,fit:'contain',label:'图片占位',sourceRef:'request',icon:null,recipeKey:'content.image@0.1.0'}
   :kind==='progress'?{kind,label:'示例进度',sourceRef:'request',icon:null,max:100,initial:30,display:'percent',fractionDigits:0,recipeKey:'settings.progress@0.1.0'}
   :{...structuredClone(records.find(record=>record.id==='G17').intent.panel.body.children[0].rows.find(row=>row.kind==='list'))};
  rows.push(row);
 });
 assert.equal(bundle.spec.layout.width,420);const nodes=flat(bundle.componentBundle.document.root);assert(nodes.filter(node=>node.type==='Slider').every(node=>node.layout.width>=300));assert(!nodes.some(node=>node.id===bundle.spec.id+'.body'&&node.type==='ScrollView'));await validatePanelBundle(bundle,core);
 if(kind==='progress')assert(nodes.find(node=>node.type==='ProgressBar').layout.width>=300);
});
test('long unspecified settings grow by measured content instead of clipping trailing actions',async()=>{
 const bundle=await replay(setting,intent=>{const rows=intent.panel.body.children[0].rows;rows.splice(2,0,...Array.from({length:6},(_,i)=>({...structuredClone(rows[0]),label:'音量'+i})));});
 const theme=bundle.catalog.themes[0],measured=measureFlowLayout(bundle.spec,createPresentationPolicy(bundle.spec,theme.tokens,theme.presentationStyle,theme.surfaceStyle,theme.headingStyle,bundle.catalog));
 assert.equal(measured.scrollable,false);assert(bundle.spec.layout.maxHeight>=measured.panelHeight);assert(bundle.spec.canvas.height>=measured.panelHeight+64);
});
test('explicit fixed dimensions and scrolling remain binding',async()=>{
 const bundle=await replay(setting,intent=>Object.assign(intent.panel.layout,{width:500,canvasWidth:532,canvasHeight:600,maxHeight:350,overflow:'scroll'}));
 assert.equal(bundle.spec.layout.width,500);assert.equal(bundle.spec.canvas.width,532);assert.equal(bundle.spec.canvas.height,600);assert.equal(bundle.spec.layout.maxHeight,350);assert.equal(bundle.spec.layout.overflow,'scroll');assert(flat(bundle.componentBundle.document.root).some(node=>node.id===bundle.spec.id+'.body'&&node.type==='ScrollView'));
});
test('explicit button size and font survive readable mixed-control geometry',async()=>{
 const bundle=await replay(setting),spec=structuredClone(bundle.spec),row=spec.sections[0].rows.find(row=>row.kind==='button');spec.buttonStyles=[{rowId:row.id,style:{width:160,height:52,shape:null,cornerRadius:null,backgroundColor:null,textColor:null,borderColor:null,borderWidth:null}}];spec.buttonFonts=[{rowId:row.id,fontSize:20}];
 const changed=await createPanelBundle(spec,catalog,core),button=flat(changed.componentBundle.document.root).find(node=>node.id===spec.id+'.row.'+row.id+'.control');assert.equal(button.layout.width,160);assert.equal(button.layout.height,52);assert.equal(button.props.style.fontSize,20);assert.deepEqual(changed.actions,bundle.actions);
});
test('tabbed mixed content uses the largest measured page while preserving state and meaningful headings',async()=>{
 const bundle=await replay(setting),spec=structuredClone(bundle.spec),all=spec.sections[0].rows,audio=all.filter(row=>row.kind==='slider'),video=all.filter(row=>!audio.includes(row)&&row.kind!=='button'),actions=all.filter(row=>row.kind==='button');
 spec.sections=[{id:'audio',title:'音频',rows:audio},{id:'video',title:'画面',rows:video},{id:'actions',title:'操作',rows:actions},{id:'info',title:'说明',rows:[{id:'copy',kind:'text',label:'提示',text:'请调整设置',recipe:{id:'settings.text',version:'0.1.0'}}]}];spec.layout.body={id:'body',kind:'column',width:'fill',gap:20,align:'start',children:spec.sections.map(section=>({kind:'section',sectionId:section.id,width:'fill'}))};
 const recipe=catalog.recipes.find(recipe=>recipe.kind==='tabs');spec.tabs={id:'pages',recipe:{id:recipe.id,version:recipe.version},bind:'page',enabled:true,event:'page.changed',pages:[{id:'all',label:'全部',sections:['audio','video','actions']},{id:'info',label:'说明',sections:['info']}]};spec.state.push({id:'page',type:'enum',initial:'all',options:spec.tabs.pages.map(({id,label})=>({id,label}))});
 const body=node=>node.kind==='section'?{kind:'section',sectionId:node.sectionId}:{kind:node.kind,children:node.children.map(body)};
 const theme=catalog.themes[0],arranged=arrangeIntentSpec(spec,{width:null,canvasWidth:null,canvasHeight:null,maxHeight:null,overflow:'auto',body:body(spec.layout.body),sourceQuote:null},theme,catalog),after=await createPanelBundle(arranged,catalog,core);
 const measured=measureTabbedLayout(after.spec,createPresentationPolicy(after.spec,theme.tokens,theme.presentationStyle,theme.surfaceStyle,theme.headingStyle,catalog));assert(measured.pages.every(page=>page.contentHeight<=page.viewportHeight));assert.equal(after.state.page,'all');assert.deepEqual(flat(after.componentBundle.document.root).filter(node=>/\.section\.[^.]+\.title$/.test(node.id)).map(node=>node.props.text),['音频','画面']);
});
test('all sixteen native components compile and export under the new profile',async()=>{
 const model=await createWorkbenchModel({catalog,pool:await imageAssetPool()},core);try{const {context}=await model.prepare(allRequest);await model.acceptProposal(await materializePanelIntent(context,allIntent(context)));const bundle=await model.exportPanel(),types=['Panel','CheckBox','RadioGroup','List','Dialog','Container','Text','Image','Slider','Switch','Select','Button','ProgressBar','ScrollView','Tabs','Input'].sort();assert.equal(bundle.compilerVersion,'0.39.0');assert.deepEqual([...new Set(flat(bundle.componentBundle.document.root).map(node=>node.type))].sort(),types);assert.deepEqual([...new Set((await createUnityDocument(bundle,core)).nodes.map(node=>node.type))].sort(),types);}finally{model.dispose();}
});
test('v2 sizing cannot silently activate on legacy heading families',()=>{const bad=structuredClone(catalog);bad.themes[0].headingStyle='concise-v4';assert.throws(()=>validateCatalog(bad),/draftSizing/);});
