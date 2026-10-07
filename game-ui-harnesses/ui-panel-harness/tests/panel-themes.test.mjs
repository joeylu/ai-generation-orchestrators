import test from 'node:test';
import assert from 'node:assert/strict';
import {readJson} from '../src/io.mjs';
import {createPlanningContext} from '../src/planning-context.mjs';
import {materializePanelIntent,buildNativePanelIntentResponseSchema} from '../src/panel-intent.mjs';
import {createPanelBundle,validatePanelBundle} from '../src/panel-bundle.mjs';
import {createPanelEditContext,validatePanelEditContext,validatePanelEditProposal} from '../src/edit-planning.mjs';
import {createWorkbenchModel} from '../src/workbench-model.mjs';
import {buildCodexEditResponseSchema} from '../src/codex-edit-schema.mjs';
import {themePlanningGuide} from '../src/theme-planning.mjs';
import {createUnityDocument} from '../src/unity-export.mjs';
import {panelVisualMotion} from '../src/panel-visuals.mjs';
import {loadWorkspaceCore} from '../src/component-adapter.mjs';
import {formRequest,formIntent} from '../examples/forms-v1/fixture.mjs';
import {tabsRequest,tabsIntent} from '../examples/tabs-v1/fixture.mjs';
import {ordinalFixture} from './ordinal-intent-fixture.mjs';
import {requestReferenceFixture} from '../examples/request-reference-v1/fixture.mjs';
const core=await loadWorkspaceCore(),catalog=await readJson(new URL('../examples/modern-game-themes.catalog.json',import.meta.url));
const ref=theme=>({id:theme.id,version:theme.version});
const nodes=bundle=>{const all=[];const visit=n=>{all.push(n);n.children?.forEach(visit);};visit(bundle.componentBundle.document.root);return all;};
function contrast(a,b){
 const l=color=>{const c=[1,3,5].map(i=>parseInt(color.slice(i,i+2),16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);return c[0]*.2126+c[1]*.7152+c[2]*.0722;};
 const x=l(a),y=l(b);return(Math.max(x,y)+.05)/(Math.min(x,y)+.05);
}
async function fixture(theme,request=formRequest,make=formIntent){
 const context=await createPlanningContext(request,catalog),intent=requestReferenceFixture(ordinalFixture(make(context)));
 intent.panel.themeKey=`${theme.id}@${theme.version}`;
 const proposal=await materializePanelIntent(context,intent);
 return {context,intent,proposal,bundle:await createPanelBundle(proposal.spec,catalog,core)};
}
const fixtures=await Promise.all(catalog.themes.map(theme=>fixture(theme)));
const editProposal=(context,operations,basis)=>({editProposalVersion:'0.1',contextSha256:context.sha256,
 patch:{patchVersion:'0.1',baseSpecSha256:context.baseSpecSha256,reason:'Explicit test fixture edit.',operations},unresolved:[],
 decisions:operations.map((_,operationIndex)=>({operationIndex,basis:basis??{kind:'request-interpretation',start:0,end:context.request.text.length,quote:context.request.text}}))});

test('eight exact palettes use the opt-in compiler and bind native selection to their complete catalog',async()=>{
 assert.equal(fixtures.length,8);assert.equal(new Set(catalog.themes.map(t=>t.id)).size,8);
 for(const {context,bundle} of fixtures){
  assert.equal(bundle.compilerVersion,'0.7.2');assert.deepEqual(await validatePanelBundle(bundle,core),bundle);
  const schema=buildNativePanelIntentResponseSchema(context);
  assert.deepEqual(schema.properties.panel.anyOf.find(s=>s.type==='object').properties.themeKey.enum,catalog.themes.map(t=>`${t.id}@${t.version}`));
  assert(panelVisualMotion(bundle),'new profile retains feedback');
  const forged=structuredClone(bundle);forged.compilerVersion='0.7.1';await assert.rejects(validatePanelBundle(forged,core),/VISUAL_STYLE_VERSION/);
 }
});

for(const [index,theme] of catalog.themes.entries())test(`${theme.id}: text, values, validation, navigation and button contrasts`,async()=>{
 const t=theme.tokens,bundle=fixtures[index].bundle;
 for(const [fg,bg]of[[t.text,t.surface],[t.text,t.control],[t.muted,t.surface],[t.accent,t.surface],[t.accent,t.control]])assert(contrast(fg,bg)>=4.5,`${fg}/${bg}`);
 for(const n of nodes(bundle).filter(n=>n.type==='Button'))assert(contrast(n.props.style.textColor,n.props.style.backgroundColor)>=4.5);
 for(const n of nodes(bundle).filter(n=>n.id.endsWith('.required')||n.id.endsWith('.min-length')))assert(contrast(n.props.style.textColor,t.control)>=4.5);
 if(theme.id.endsWith('-dark'))for(const bg of[t.surface,t.control])assert(contrast('#75869A',bg)>=4.5,'native placeholder on dark field');
 const tabbed=await fixture(theme,tabsRequest,tabsIntent),tabs=nodes(tabbed.bundle).find(n=>n.type==='Tabs');
 for(const bg of['#FFFFFF','#E8F3EE'])assert(contrast(tabs.props.style.textColor,bg)>=4.5,'native tab headers remain readable');
 const native=await createUnityDocument(tabbed.bundle,core),exported=native.nodes.find(n=>n.id===tabs.id);
 assert(contrast(exported.textColor,exported.backgroundColor)>=4.5);assert.equal(exported.textColor,tabs.props.style.textColor);
 assert(!native.nodes.some(n=>n.id.endsWith('.center-label')));
 const context=await createPlanningContext({...formRequest,text:'生成选项面板，画质下拉选项低、中、高，默认中。'},catalog);
 const intent={panelIntentVersion:'0.8',contextSha256:context.sha256,unresolved:[],panel:{id:context.request.id,title:'选项',themeKey:`${theme.id}@${theme.version}`,panelSurface:null,
  layout:{width:null,canvasWidth:null,canvasHeight:null,maxHeight:null,overflow:'auto'},body:{kind:'column',children:[{kind:'section',title:'显示',rows:[{kind:'select',label:'画质',recipeKey:'settings.select@0.1.0',sourceRef:'request',icon:null,enabled:true,options:[{label:'低',initial:false},{label:'中',initial:true},{label:'高',initial:false}]}]}]}}};
 const selectBundle=await createPanelBundle((await materializePanelIntent(context,intent)).spec,catalog,core),select=nodes(selectBundle).find(n=>n.type==='Select');
 for(const bg of[select.props.style.backgroundColor,'#FFFFFF','#E3F1EC'])assert(contrast(select.props.style.textColor,bg)>=4.5,'collapsed field and popup options');
 assert(contrast(select.props.style.borderColor,select.props.style.backgroundColor)>=3,'navigation boundary');
});

test('theme guidance retains mode/accent for partial requests without interpreting prose in the core',()=>{
 const guide=themePlanningGuide(catalog,catalog.themes[3]);
 assert(guide.includes('modern-blue-dark@0.3.0'));assert(guide.includes('keep the current accent'));assert(guide.includes('keep the current mode'));
 assert(guide.includes('unless this edit explicitly requests'));assert(themePlanningGuide(catalog).includes('defaultThemeKey'));
});

test('edits require quote evidence and exact catalog pairs; business-only edits retain the theme and current state',async()=>{
 const original=fixtures[3].bundle,model=await createWorkbenchModel({catalog,pool:null},core);await model.importPanel(original);
 const prepare=async text=>(await model.prepareEdit({...formRequest,text})).context;
 let context=await prepare('把标题改成创建角色，其他保持不变。');
 assert.equal(context.capabilities.themePolicy,'explicit-change-v1');assert.deepEqual(await validatePanelEditContext(context),context);
 let result=await model.acceptEditProposal(editProposal(context,[{op:'set-panel-title',title:'创建角色'}]),{row0:'蓝莓'});
 assert.deepEqual(result.panel.spec.theme,ref(catalog.themes[3]));assert.deepEqual(result.panel.state,{row0:'蓝莓'});
 context=await prepare('改成浅色橙色主题，其他不变。');
 const themeEdit=editProposal(context,[{op:'set-theme',theme:ref(catalog.themes[6])}]);
 const unauthorized=structuredClone(themeEdit);unauthorized.decisions[0].basis={kind:'design-choice',reason:'Designer preference.'};
 await assert.rejects(model.acceptEditProposal(unauthorized),{code:'EDIT_THEME_ORIGIN'});
 assert.deepEqual(model.getSnapshot().panel,result.panel,'rejected theme leaves current panel intact');
 const missing=structuredClone(themeEdit);missing.patch.operations[0].theme.version='99.0.0';
 await assert.rejects(validatePanelEditProposal(context,missing),{code:'EDIT_THEME_REFERENCE'});
 const schema=await buildCodexEditResponseSchema({draft:true,context}),operation=Object.values(schema.$defs).find(s=>s.properties?.op?.enum?.[0]==='set-theme');
 assert.deepEqual(operation.properties.theme.anyOf.map(s=>({id:s.properties.id.enum[0],version:s.properties.version.enum[0]})),catalog.themes.map(ref));
 const changed=await model.acceptEditProposal(themeEdit,{row0:'蓝莓'});
 assert.deepEqual(changed.panel.spec.theme,ref(catalog.themes[6]));assert.deepEqual(changed.panel.state,{row0:'蓝莓'});
 assert.deepEqual(changed.panel.spec.sections,result.panel.spec.sections);assert.deepEqual(changed.panel.bindings,result.panel.bindings);assert.deepEqual(changed.panel.actions,result.panel.actions);
 const restored=await model.undo();assert.deepEqual(restored.panel,result.panel);
});
