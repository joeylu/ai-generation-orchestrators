import test from 'node:test';
import assert from 'node:assert/strict';
import {readJson} from '../src/io.mjs';
import {loadWorkspaceCore} from '../src/component-adapter.mjs';
import {loadBundledCoreAssets} from '../src/bundled-core-assets.mjs';
import {workbenchAssetInputs} from '../src/workbench-assets.mjs';
import {createPanelBundle,validatePanelBundle,panelBundleAssetInputs} from '../src/panel-bundle.mjs';
import {arrangeIntentSpec} from '../src/panel-intent.mjs';
import {createUnityDocument} from '../src/unity-export.mjs';
import {headingThemeTarget} from '../src/section-headings.mjs';
import {validateCatalog} from '../src/catalog.mjs';
import {themePlanningGuide} from '../src/theme-planning.mjs';
const core=await loadWorkspaceCore(),pool=await loadBundledCoreAssets(),catalog=await readJson(new URL('../examples/modern-readable-game-heading-panels.catalog.json',import.meta.url)),{records}=await readJson(new URL('./fixtures/heading-panels-regressions-v1.json',import.meta.url));
const flat=node=>[node,...(node.children??[]).flatMap(flat)],body=node=>node.kind==='section'?{kind:'section',sectionId:node.sectionId}:{kind:node.kind,children:node.children.map(body)};
const arrange=(record,change=()=>{},settings={})=>{const spec=structuredClone(record.spec),theme=catalog.themes.find(theme=>theme.id===spec.theme.id&&theme.headingStyle==='concise-v5');spec.theme={id:theme.id,version:theme.version};change(spec);return arrangeIntentSpec(spec,{width:record.spec.layout.width,canvasWidth:record.spec.canvas.width,canvasHeight:null,maxHeight:null,overflow:'auto',body:body(spec.layout.body),sourceQuote:null,...settings},catalog.themes.find(theme=>theme.id===spec.theme.id&&theme.version===spec.theme.version),catalog);};
for(const record of records)test(`${record.id}: exact v0.39 replay remains intact; v0.40 wraps only visible headings with real Panels`,async()=>{
 const original=await createPanelBundle(record.spec,record.catalog,core,record.state,await workbenchAssetInputs(record.spec,pool));assert.equal(original.sha256,record.originalBundleSha256);await validatePanelBundle(original,core);
 const changed=await createPanelBundle(arrange(record),catalog,core,record.state,panelBundleAssetInputs(original,core)),nodes=flat(changed.componentBundle.document.root),title=nodes.find(node=>node.id===record.spec.id+'.title'),plate=nodes.find(node=>node.id===record.spec.id+'.title-bar');
 assert.equal(changed.compilerVersion,'0.40.0');assert.equal(plate.type,'Panel');assert.equal(plate.props.title,'');assert.equal(plate.children[0].id,title.id);assert.equal(title.type,'Text');assert.equal(title.layout.x,8);assert.equal(title.layout.y,8);assert.equal(title.props.style.fontSize,32);assert.equal(changed.spec.layout.width,record.spec.layout.width);
 assert.deepEqual(changed.spec.sections,original.spec.sections);for(const key of ['state','actions','bindings','assetClosure'])assert.deepEqual(changed[key],original[key]);
 const groupPanels=nodes.filter(node=>node.id.endsWith('.title-panel'));assert(groupPanels.every(node=>node.type==='Panel'&&node.children.length===1&&node.children[0].type==='Text'&&node.children[0].props.style.fontSize===24));
 assert.deepEqual(groupPanels.map(node=>node.children[0].props.text),record.id==='G03'?['音频','画面']:[]);
 const native=await createUnityDocument(changed,core);assert.equal(native.nodes.find(node=>node.id===title.id).parentId,plate.id);assert.equal(native.nodes.find(node=>node.id===title.id).textAlignment,'MiddleCenter');assert.equal(native.nodes.find(node=>node.id===plate.id).type,'Panel');await validatePanelBundle(changed,core);
});
test('ordinary row Text and labels remain outside heading Panels',async()=>{
 const record=records.find(record=>record.id==='G54'),bundle=await createPanelBundle(arrange(record),catalog,core),nodes=flat(bundle.componentBundle.document.root),copy=bundle.spec.sections[0].rows.find(row=>row.kind==='text'),id=bundle.spec.id+'.row.'+copy.id+'.control';assert.equal(nodes.find(node=>node.id===id).type,'Text');assert(!nodes.filter(node=>node.type==='Panel').some(node=>node.children?.some(child=>child.id===id)));
});
test('explicit title colors, padding, radius, font and alignment remain authoritative',async()=>{
 const record=records.find(record=>record.id==='G03'),spec=arrange(record,spec=>{spec.titleBar={horizontalAlign:'right',verticalAlign:'bottom',backgroundColor:'#112233',textColor:'#FFFFFF',cornerRadius:4,fontSize:20,padding:4};}),bundle=await createPanelBundle(spec,catalog,core,record.state,await workbenchAssetInputs(spec,pool)),nodes=flat(bundle.componentBundle.document.root),plate=nodes.find(node=>node.id===spec.id+'.title-bar'),text=plate.children[0];assert.equal(plate.props.style.backgroundColor,'#112233');assert.equal(plate.props.style.cornerRadius,4);assert.equal(text.props.style.fontSize,20);assert.equal(text.props.style.textColor,'#FFFFFF');assert.equal(text.layout.x,4);assert.equal((await createUnityDocument(bundle,core)).nodes.find(node=>node.id===text.id).textAlignment,'LowerRight');
});
test('explicit heading visibility keeps semantic titles in their own Panels',async()=>{
 const record=records.find(record=>record.id==='G03'),spec=arrange(record);spec.theme=headingThemeTarget(spec,catalog,catalog,'show');const bundle=await createPanelBundle(spec,catalog,core,record.state,await workbenchAssetInputs(spec,pool));assert.deepEqual(flat(bundle.componentBundle.document.root).filter(node=>node.id.endsWith('.title-panel')).map(node=>node.children[0].props.text),spec.sections.map(section=>section.title));
});
test('long main and section headings reserve panel padding when auto width is measured',async()=>{
 const record=records.find(record=>record.id==='G03'),spec=arrange(record,spec=>{spec.title='这是一个用于检查标题底板边距的游戏设置';spec.sections[0].title='这是一个用于检查分组标题边距的音频设置';},{width:null,canvasWidth:null}),bundle=await createPanelBundle(spec,catalog,core,record.state,await workbenchAssetInputs(spec,pool));assert(bundle.spec.layout.width>420);await validatePanelBundle(bundle,core);
});
test('explicit canvas and panel dimensions are preserved; insufficient heading slots fail without shrinking text',async()=>{
 const record=records.find(record=>record.id==='G54'),spec=arrange(record,()=>{},{width:500,canvasWidth:560,canvasHeight:600,maxHeight:350,overflow:'scroll'});assert.equal(spec.layout.width,500);assert.equal(spec.canvas.width,560);assert.equal(spec.canvas.height,600);assert.equal(spec.layout.maxHeight,350);spec.layout.titleHeight=42;await assert.rejects(createPanelBundle(spec,catalog,core),{code:'TITLE_BAR_FIT'});
});
test('the new surface cannot silently activate on unrelated or legacy theme families',()=>{
 for(const change of [theme=>theme.headingSurface='auto',theme=>theme.draftSizing='game-readable-v1',theme=>theme.headingStyle='concise-v4']){const bad=structuredClone(catalog);change(bad.themes[0]);assert.throws(()=>validateCatalog(bad),/headingSurface/);}assert(themePlanningGuide(catalog).includes('Panel containers with semantic Text children'));
});
test('all light/dark accent surfaces retain readable title and subtitle contrast',()=>{
 const luminance=value=>{const c=[1,3,5].map(offset=>parseInt(value.slice(offset,offset+2),16)/255).map(value=>value<=.04045?value/12.92:((value+.055)/1.055)**2.4);return c[0]*.2126+c[1]*.7152+c[2]*.0722;},contrast=(a,b)=>{const values=[luminance(a),luminance(b)].sort((a,b)=>b-a);return (values[0]+.05)/(values[1]+.05);};
 for(const theme of catalog.themes)for(const tokens of [theme.tokens,theme.menuTokens])for(const color of [tokens.text,tokens.muted])assert(contrast(color,tokens.control)>=4.5,theme.id+' '+color+' on '+tokens.control);
});
