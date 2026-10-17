import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {extractPanelEditSource,panelEditSourceFromSnapshot} from '../src/studio/panel-edit-source.mjs';
import {panelEditController} from '../src/studio/panel-edit.mjs';
import {tmpdir} from 'node:os';

const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const profile=JSON.parse(await readFile(new URL('../fixtures/neutral.skin.json',import.meta.url)));
const theme=Object.fromEntries(Object.entries(profile).filter(([key])=>!['kind','version','id','purpose','slice'].includes(key)));
function fixture(){
  const bindings=Object.fromEntries(['template','registry','usage'].map(key=>[key+'Sha256','a'.repeat(64)]));
  const resource=(file,text)=>{const bytes=Buffer.from(text);return {file,bytes:bytes.length,sha256:hash(bytes)};};
  const resources={},register=(file,text)=>{resources[file]=Buffer.from(text).toString('base64');return resource(file,text);};
  const asset=(id,x,inset)=>({...register('assets/'+id+'.png',id),assetId:id,code:'surface',state:'normal',sheetId:'S01',crop:[x,0,16,16],width:16,height:16,stretch:'nine-slice',nineSlice:{left:1,top:1,right:1,bottom:1},contentInsets:{left:inset,top:inset,right:inset,bottom:inset},minSize:{width:8,height:8}});
  const manifest={kind:'ui_skin_asset_pack',version:'0.1',id:'synthetic-test',revision:1,sourceKind:'imported',visualAcceptance:'unreviewed',scale:1,bindings,theme,
    sources:[{...resource('sources/S01.png','sheet'),sheetId:'S01',width:32,height:32}],assets:[asset('panel',0,2),asset('content',16,3)],
    roles:[{role:'skin.surface.panel',assetId:'panel'},{role:'skin.surface.content',assetId:'content'}],
    fonts:[{...register('fonts/font.woff2','font'),family:theme.fontFamily,weight:400,style:'normal',unicodeRange:'U+0000-00FF'}],licenses:[register('licenses/font.txt','license')]};
  const bytes=Buffer.from(JSON.stringify(manifest)),manifestSha256=hash(bytes);
  const pack={manifest:bytes.toString('base64'),manifestSha256,bindings,resources};
  const ctx={registry:{recipes:[]},usage:{},template:{},profile,canvases:{presets:{landscape:{width:1280,height:720},portrait:{width:720,height:1280}}},binding:{sourceKind:'imported',sha256:manifestSha256}};
  const document=orientation=>({kind:'ui_panel_document',version:'0.1',id:'example-'+orientation,revision:0,title:'Test',canvas:orientation,bindings:{...ctx.binding},rootId:'root',nodes:[]});
  const behavior={version:'1.0',fields:[],actions:[],dismissOnEmit:true};
  const action={ctx,pack,source:'model-response',presets:[{content:{presetId:'custom',title:'测试 < 面板'},behavior,documents:{landscape:document('landscape')},provenance:{privateSession:'must not be returned'}}]};
  const settings={ctx,pack,content:{fields:[],title:'设置'},documents:{portrait:document('portrait')}};
  return {action,settings,manifest};
}
const preview=(data,name='Actions')=>Buffer.from('<!doctype html><html><script type="module">const bundle="never execute";\nawait initialize'+name+'('+JSON.stringify(data).replaceAll('<','\\u003c')+');</script></html>');

test('action extraction preserves public skin, document and behavior while discarding producer provenance',()=>{
  const {action}=fixture(),bytes=preview(action),value=extractPanelEditSource({artifactId:'panel-test',previewBytes:bytes,expectedPreviewSha256:hash(bytes)});
  assert.equal(value.kind,'ui_panel_edit_source');assert.equal(value.version,'1.0');assert.equal(value.producer,'action-panel-preview');assert.equal(value.source,'model-response');assert.equal(value.previewSha256,hash(bytes));
  assert.deepEqual(value.pack,action.pack);assert.equal(value.variants[0].key,'custom-landscape');assert.equal(value.variants[0].label,'测试 < 面板 · 横版 16:9');
  assert.deepEqual(value.variants[0].document,action.presets[0].documents.landscape);assert.deepEqual(value.variants[0].behavior,action.presets[0].behavior);
  assert.equal(JSON.stringify(value).includes('must not be returned'),false);
  value.variants[0].document.title='edited';assert.equal(action.presets[0].documents.landscape.title,'Test');
});

test('old settings payload obtains public geometry from digest-bound manifest without changing its selected orientation',()=>{
  const {settings}=fixture();settings.ctx.privateSession='do not return';
  const result=extractPanelEditSource({artifactId:'settings-test',previewBytes:preview(settings,'Settings')});
  assert.equal(result.source,'frozen-preview');assert.equal(result.producer,'settings-panel-preview');assert.equal(result.variants.length,1);assert.equal(result.variants[0].key,'settings-portrait');
  assert.equal(result.variants[0].behavior,undefined);assert.equal(result.ctx.privateSession,undefined);assert.deepEqual(result.ctx.panelInsets,{left:2,top:2,right:2,bottom:2});assert.deepEqual(result.ctx.scrollInsets,{left:3,top:3,right:3,bottom:3});
  assert.equal(result.ctx.skinGeometry.assets.length,2);
});

test('manifest-bound material crops and one shared source extend the exact resource allowlist',()=>{
  const {action,manifest}=fixture();
  const resource=(file,value)=>{const bytes=Buffer.from(value);action.pack.resources[file]=bytes.toString('base64');return {file,bytes:bytes.length,sha256:hash(bytes)};};
  const source={...resource('material-sources/'+'b'.repeat(64)+'.png','original'),width:32,height:16};
  manifest.materialAssets=['left','right'].map((part,index)=>({assetId:'material.'+part,...resource('materials/'+part+'.png',part),width:16,height:16,source:{...source,crop:[index*16,0,16,16]}}));
  const bytes=Buffer.from(JSON.stringify(manifest)),sha256=hash(bytes);action.pack.manifest=bytes.toString('base64');action.pack.manifestSha256=sha256;action.ctx.binding.sha256=sha256;action.presets[0].documents.landscape.bindings.sha256=sha256;
  const result=extractPanelEditSource({artifactId:'panel-materials',previewBytes:preview(action)});
  assert.deepEqual(result.pack.resources,action.pack.resources);
  assert.equal(Object.keys(result.pack.resources).filter(file=>file.startsWith('material-sources/')).length,1);
  action.pack.resources[source.file]=Buffer.from('changed').toString('base64');
  assert.throws(()=>extractPanelEditSource({artifactId:'panel-materials',previewBytes:preview(action)}),{code:'STUDIO_PANEL_EDIT_RESOURCE_DIGEST'});
});

test('old frozen registries gain only optional local text style declarations without changing source identity',()=>{
  const {action}=fixture();
  action.ctx.registry.recipes=[{type:'Text',recipeId:'text',propsSchema:{type:'object',additionalProperties:false,properties:{text:{type:'string',default:''}}}},{type:'Container',recipeId:'container',propsSchema:{type:'object',properties:{}}}];
  const before=structuredClone(action),bytes=preview(action),result=extractPanelEditSource({artifactId:'panel-test',previewBytes:bytes});
  const properties=result.ctx.registry.recipes[0].propsSchema.properties;
  assert.deepEqual(properties.fontSize,{type:'integer',minimum:12,maximum:96});assert.equal(Object.hasOwn(properties.fontSize,'default'),false);
  assert.deepEqual(properties.textColor,{type:'string',pattern:'^#[0-9A-Fa-f]{6}$'});
  assert.equal(Object.hasOwn(result.ctx.registry.recipes[1].propsSchema.properties,'fontSize'),false);
  delete properties.fontSize;delete properties.textColor;assert.deepEqual(result.ctx.registry,action.ctx.registry);
  assert.deepEqual(action,before);assert.deepEqual(result.pack,action.pack);assert.equal(result.previewSha256,hash(bytes));
  assert.deepEqual(result.variants[0].document,action.presets[0].documents.landscape);assert.deepEqual(result.variants[0].behavior,action.presets[0].behavior);
});

test('an incompatible existing text style declaration is rejected rather than overwritten',()=>{
  const {action}=fixture();action.ctx.registry.recipes=[{type:'Button',recipeId:'button',propsSchema:{properties:{fontSize:{type:'number',default:16}}}}];
  assert.throws(()=>extractPanelEditSource({artifactId:'panel-test',previewBytes:preview(action)}),{code:'text.registry'});
});

test('snapshot API accepts only explicit verified panel entries and exact preview bytes',()=>{
  const {action}=fixture(),bytes=preview(action),snapshot={items:[{id:'panel-test',type:'panel'}],files:new Map([['artifacts/panel-test/preview.html',bytes]])};
  assert.equal(panelEditSourceFromSnapshot(snapshot,'panel-test').previewSha256,hash(bytes));
  assert.throws(()=>panelEditSourceFromSnapshot(snapshot,'../panel-test'),{code:'STUDIO_PANEL_EDIT_ARTIFACT'});
  assert.throws(()=>panelEditSourceFromSnapshot({...snapshot,items:[{id:'panel-test',type:'components'}]},'panel-test'),{code:'STUDIO_PANEL_EDIT_NOT_FOUND'});
  assert.throws(()=>extractPanelEditSource({artifactId:'panel-test',previewBytes:bytes,expectedPreviewSha256:'b'.repeat(64)}),{code:'STUDIO_PANEL_EDIT_PREVIEW_CHANGED'});
});

test('only the producer fixed tail is accepted and JavaScript is never evaluated',()=>{
  const {action}=fixture(),bytes=preview(action);
  const reject=value=>assert.throws(()=>extractPanelEditSource({artifactId:'panel-test',previewBytes:Buffer.from(value)}),{code:'STUDIO_PANEL_EDIT_UNSUPPORTED_PREVIEW'});
  reject(bytes.toString()+'\n');reject(bytes.toString().replace('await initializeActions(','initializeActions('));reject(bytes.toString().replace('type="module"','type="text/javascript"'));
  reject(bytes.toString().replace(');</script>',';globalThis.sourceExecuted=true);</script>'));
  reject('<script type="module">\nawait initializeActions({"x":(()=>globalThis.sourceExecuted=true)()});</script></html>');
  assert.equal(globalThis.sourceExecuted,undefined);
});

test('changed skin bytes, bindings, resources and document direction fail rather than silently replacing them',()=>{
  const check=(mutate,code)=>{const {action}=fixture();mutate(action);assert.throws(()=>extractPanelEditSource({artifactId:'panel-test',previewBytes:preview(action)}),{code});};
  check(data=>data.pack.manifest=Buffer.from('{}').toString('base64'),'STUDIO_PANEL_EDIT_SKIN_DIGEST');
  check(data=>data.pack.resources['assets/panel.png']=Buffer.from('bad').toString('base64'),'STUDIO_PANEL_EDIT_RESOURCE_DIGEST');
  check(data=>data.pack.resources['sources/private.png']='AA==','STUDIO_PANEL_EDIT_RESOURCES');
  check(data=>data.ctx.binding.sha256='b'.repeat(64),'STUDIO_PANEL_EDIT_CONTEXT');
  check(data=>data.presets[0].documents.landscape.bindings.sha256='b'.repeat(64),'STUDIO_PANEL_EDIT_DOCUMENT_BINDING');
  check(data=>data.presets[0].documents.landscape.canvas='portrait','STUDIO_PANEL_EDIT_DOCUMENT_BINDING');
  check(data=>data.presets.push(structuredClone(data.presets[0])),'STUDIO_PANEL_EDIT_DUPLICATE_VARIANT');
});

test('original frozen contract packets preserve exact source bytes and reject changed, duplicate or unbound evidence',()=>{
 const {action}=fixture();
 action.sourceContracts={version:'1.0',files:['registry','usage','template'].map(name=>{const bytes=Buffer.from(JSON.stringify(action.ctx[name],null,3)+'\n');return {name,bytes:bytes.length,sha256:hash(bytes),base64:bytes.toString('base64')};})};
 const manifest=JSON.parse(Buffer.from(action.pack.manifest,'base64'));
 for(const file of action.sourceContracts.files)manifest.bindings[file.name+'Sha256']=file.sha256;
 const bytes=Buffer.from(JSON.stringify(manifest)),sha256=hash(bytes);action.pack.manifest=bytes.toString('base64');action.pack.manifestSha256=sha256;action.pack.bindings=manifest.bindings;action.ctx.binding.sha256=sha256;action.presets[0].documents.landscape.bindings.sha256=sha256;
 const result=extractPanelEditSource({artifactId:'panel-contracts',previewBytes:preview(action)});
 assert.deepEqual(result.sourceContracts,action.sourceContracts);result.sourceContracts.files[0].base64='changed';assert.notEqual(result.sourceContracts.files[0].base64,action.sourceContracts.files[0].base64);
 const badBytes=structuredClone(action);badBytes.sourceContracts.files[0].base64=Buffer.from('{}').toString('base64');assert.throws(()=>extractPanelEditSource({artifactId:'panel-contracts',previewBytes:preview(badBytes)}),{code:'STUDIO_PANEL_EDIT_CONTRACT_DIGEST'});
 const unbound=structuredClone(action);unbound.sourceContracts.files[0].sha256='b'.repeat(64);assert.throws(()=>extractPanelEditSource({artifactId:'panel-contracts',previewBytes:preview(unbound)}),{code:'STUDIO_PANEL_EDIT_CONTRACTS'});
 const duplicate=structuredClone(action);duplicate.sourceContracts.files[1]=structuredClone(duplicate.sourceContracts.files[0]);assert.throws(()=>extractPanelEditSource({artifactId:'panel-contracts',previewBytes:preview(duplicate)}),{code:'STUDIO_PANEL_EDIT_CONTRACTS'});
});

test('cached panel sources immediately honor catalog revocation and detect changed bytes in the same Buffer',async()=>{
 const {action}=fixture(),bytes=preview(action),snapshot={items:[{id:'panel-test',type:'panel'}],files:new Map([['artifacts/panel-test/preview.html',bytes]])},controller=panelEditController(tmpdir(),snapshot);
 const first=await controller('source',{artifactId:'panel-test'});bytes[0]=33;
 const changed=await controller('source',{artifactId:'panel-test'});assert.notEqual(changed.previewSha256,first.previewSha256);
 snapshot.items=[];
 await assert.rejects(()=>controller('source',{artifactId:'panel-test'}),{code:'STUDIO_PANEL_EDIT_NOT_FOUND'});
 await assert.rejects(()=>controller('load',{artifactId:'panel-test',variantKey:'custom-landscape'}),{code:'STUDIO_PANEL_EDIT_NOT_FOUND'});
});
