import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {focusedLayoutFixtures,layoutSettings} from '../examples/focused-layout-v1/fixture.mjs';
import {createPanelBundle,validatePanelBundle} from '../src/panel-bundle.mjs';
import {compilePanel} from '../src/compiler.mjs';
import {loadWorkspaceCore} from '../src/component-adapter.mjs';
import {arrangeIntentSpec} from '../src/panel-intent.mjs';
import {measureFlowLayout,measureTabbedLayout} from '../src/flow-layout.mjs';
import {createPresentationPolicy} from '../src/panel-presentation.mjs';
import {createUnityDocument} from '../src/unity-export.mjs';
import {composePanelBundles} from '../src/panel-composition.mjs';
import {validateCatalog} from '../src/catalog.mjs';
import {BUTTON_STYLE_KEYS} from '../src/button-style.mjs';
import {semanticSettingsFixture} from '../examples/semantic-controls-v1/fixture.mjs';
import {attachPanelSession} from '../src/state.mjs';
const json=async path=>JSON.parse(await readFile(new URL(path,import.meta.url),'utf8'));
const [catalog,oldCatalog,core,base]=await Promise.all([json('../examples/modern-layout.catalog.json'),json('../examples/modern-controls.catalog.json'),loadWorkspaceCore(),json('../examples/settings-controls.panel.json')]);
const fixtures=await focusedLayoutFixtures(catalog),theme=catalog.themes.find(t=>t.id===fixtures.form.theme.id);
const all=b=>{const list=[];const visit=n=>{list.push(n);n.children?.forEach(visit);};visit(b.componentBundle.document.root);return list;};
const measure=spec=>(spec.tabs?measureTabbedLayout:measureFlowLayout)(spec,createPresentationPolicy(spec,theme.tokens,theme.presentationStyle));

test('focused menu is centered, equal width and ordered; duplicate heading removed',async()=>{
 const bundle=await createPanelBundle(fixtures.menu,catalog,core),nodes=all(bundle),buttons=nodes.filter(n=>n.type==='Button');assert.equal(bundle.compilerVersion,'0.16.0');
 assert.equal(buttons.length,3);assert(buttons.every(n=>n.layout.width===240&&n.layout.height===44));assert.equal(buttons[0].layout.x,(fixtures.menu.layout.width-48-240)/2);
 assert(buttons.every((b,i)=>!i||b.layout.y>buttons[i-1].layout.y+buttons[i-1].layout.height));assert(!nodes.some(n=>n.id.endsWith('section.section0.title')));
 assert.deepEqual(bundle.actions.map(a=>a.event),fixtures.menu.sections[0].rows.map(r=>r.event));await validatePanelBundle(bundle,core);
});

test('form field and label share the content edge; validation and separated footer fit measured height',async()=>{
 const bundle=await createPanelBundle(fixtures.form,catalog,core),nodes=all(bundle),input=nodes.find(n=>n.type==='Input'),label=nodes.find(n=>n.id.endsWith('row.row0.label')),error=nodes.find(n=>n.id.endsWith('.required')),buttons=nodes.filter(n=>n.type==='Button');
 assert.equal(input.layout.x,0);assert.equal(label.layout.x,0);assert.equal(input.layout.width,372);assert.equal(input.layout.height,44);assert(error.layout.y>=input.layout.y+input.layout.height+8);
 assert.equal(buttons[0].layout.y,buttons[1].layout.y);assert.equal(buttons[1].layout.x+buttons[1].layout.width,372);assert(buttons[0].layout.y>=measure(fixtures.form).sections[0].presentation.rows[0].height+12);
 const native=await createUnityDocument(bundle,core);for(const n of [input,...buttons]){const u=native.nodes.find(u=>u.id===n.id);for(const key of ['x','y','width','height'])assert.equal(u[key],n.layout[key]);}assert(!native.nodes.some(n=>n.id.endsWith('center-label')));
});

test('dialog body uses explicit word wrapping across its full content width',async()=>{
 const spec=fixtures.dialog,bundle=await createPanelBundle(spec,catalog,core),nodes=all(bundle),lines=nodes.filter(n=>n.id.startsWith(`${spec.id}.row.message.control`));
 assert.equal(spec.layout.width,480);assert(lines.length>1);assert(lines.every(n=>n.layout.x===0&&n.layout.width===432));assert.equal(lines.map(n=>n.props.text).join(''),spec.sections[0].rows[0].text);
 const p=measure(spec).sections[0].presentation;assert.equal(p.purpose,'dialog');assert(p.rows[1].y>=p.rows[0].y+p.rows[0].height+20);assert(p.rows.every(r=>r.y+r.height<=p.height));
 assert.equal(nodes.find(n=>n.id.endsWith('row.delete.control')).props.style.backgroundColor,'#C42B43');await validatePanelBundle(bundle,core);
});

test('clearing explicit wrapping restores single-line presentation and rejects unrequested truncation',async()=>{
 const spec=structuredClone(fixtures.dialog);spec.textLayouts=[];
 assert.throws(()=>compilePanel(spec,catalog,core),{code:'TEXT_WRAP_REQUIRED'});
 spec.sections[0].rows[0].text='删除后无法恢复。';const bundle=await createPanelBundle(spec,catalog,core),nodes=all(bundle),body=nodes.find(n=>n.id.endsWith('row.message.control')),label=nodes.find(n=>n.id.endsWith('row.message.label'));
 assert.equal(body.props.text,'删除后无法恢复。');assert.equal(body.layout.x,0);assert(body.layout.y>=label.layout.y+label.layout.height+8);assert(!nodes.some(n=>n.id.endsWith('.line1')));
});

test('focused session verifies every derived text line; wrong content, position and old profile fail closed',async()=>{
 const bundle=await createPanelBundle(fixtures.dialog,catalog,core);let document=bundle.componentBundle.document;
 const runtime={getDocument:()=>document,subscribe:()=>()=>{},setValue:()=>{}};
 attachPanelSession(bundle.spec,runtime,()=>{},bundle.state,'focused-v1').destroy();
 assert.throws(()=>attachPanelSession(bundle.spec,runtime,()=>{},bundle.state),/PANEL_RUNTIME_MISMATCH/);
 for(const change of [n=>n.props.text='错误内容',n=>n.layout.y+=1,n=>n.layout.width-=1]){document=structuredClone(bundle.componentBundle.document);const nodes=[];const visit=n=>{nodes.push(n);n.children?.forEach(visit);};visit(document.root);change(nodes.find(n=>n.id.endsWith('.line1')));assert.throws(()=>attachPanelSession(bundle.spec,runtime,()=>{},bundle.state,'focused-v1'),/PANEL_RUNTIME_MISMATCH/);}
 assert.throws(()=>attachPanelSession(bundle.spec,runtime,()=>{},bundle.state,'unknown'),/PANEL_PRESENTATION_PROFILE/);
});

test('long/footer labels stack on a narrow panel; explicit typography determines width',async()=>{
 const spec=structuredClone(fixtures.form);spec.panelSpecVersion='0.11';spec.appearance=null;spec.actionLayouts=[];spec.buttonStyles=[];spec.buttonFonts=[{rowId:'row1',fontSize:24}];
 spec.sections[0].rows[1].buttonLabel='确认并保存';spec.sections[0].rows[2].buttonLabel='取消并返回上一页';
 const arranged=arrangeIntentSpec(spec,layoutSettings(360),theme),bundle=await createPanelBundle(arranged,catalog,core),buttons=all(bundle).filter(n=>n.type==='Button');
 assert(buttons[1].layout.y>buttons[0].layout.y+buttons[0].layout.height);assert(buttons[0].layout.width>=5*24*1.1+32);assert.equal(buttons[0].props.style.fontSize,24);
 assert(buttons.every(n=>n.layout.x>=0&&n.layout.x+n.layout.width<=312));
});

test('explicit action arrangements and local dimensions win over centered menu defaults',async()=>{
 const spec=structuredClone(fixtures.menu);spec.panelSpecVersion='0.10';spec.appearance=null;spec.actionLayouts=[{sectionId:'section0',direction:'row',align:'start',gap:12,buttonWidth:120,buttonHeight:64,shape:'default'}];
 spec.buttonStyles=[{rowId:'row1',style:{...Object.fromEntries(BUTTON_STYLE_KEYS.map(k=>[k,null])),width:160,height:72}}];
 const arranged=arrangeIntentSpec(spec,layoutSettings(520),theme),bundle=await createPanelBundle(arranged,catalog,core),buttons=all(bundle).filter(n=>n.type==='Button');
 assert.deepEqual(buttons.map(b=>b.layout.x),[0,172,304]);assert.equal(buttons[0].layout.width,160);assert.equal(buttons[0].layout.height,72);assert.equal(buttons[1].layout.width,120);
 const independent=structuredClone(spec);independent.actionLayouts=[];const n=all(await createPanelBundle(arrangeIntentSpec(independent,layoutSettings(520),theme),catalog,core)).filter(n=>n.type==='Button');assert.equal(n[0].layout.width,160);assert.equal(n[0].layout.height,72);
});

test('long dialog scroll and tab composition share measured geometry and preserve state/actions',async()=>{
 const dialog=structuredClone(fixtures.dialog);dialog.sections[0].rows[0].text=dialog.sections[0].rows[0].text.repeat(2);
 const arranged=arrangeIntentSpec(dialog,{...layoutSettings(360),maxHeight:300},theme),bundle=await createPanelBundle(arranged,catalog,core);assert.equal(measure(arranged).scrollable,true);
 const form=await createPanelBundle(fixtures.form,catalog,core,{row0:'蓝莓'});
 const result=await composePanelBundles({panelCompositionRequestVersion:'0.1',id:'focused-composite',title:'角色与删除确认',sources:[{namespace:'form',bundleSha256:form.sha256},{namespace:'dialog',bundleSha256:bundle.sha256}],layout:'tabs',width:520,canvasWidth:640,canvasHeight:720,maxHeight:480,surfaceFrom:null},[form,bundle],core);
 assert.equal(result.bundle.compilerVersion,'0.16.0');const field=result.receipt.mappings[0].fields.find(f=>f.source==='row0').target;assert.equal(result.bundle.state[field],'蓝莓');await validatePanelBundle(result.bundle,core);
 assert(result.bundle.actions.some(a=>a.action.kind==='submit'));const event=result.receipt.mappings[1].events.find(e=>e.source==='dialog.delete').target;assert(result.bundle.actions.some(a=>a.event===event));
});

test('settings geometry and frozen semantic compiler replay remain unchanged',async()=>{
 const spec=semanticSettingsFixture(catalog,base),before=structuredClone(spec);before.theme.version='0.5.0';
 const old=await createPanelBundle(before,oldCatalog,core),next=await createPanelBundle(spec,catalog,core);assert.equal(old.compilerVersion,'0.15.0');await validatePanelBundle(old,core);
 const geometry=b=>all(b).map(n=>({id:n.id,layout:n.layout}));assert.deepEqual(geometry(next),geometry(old));
 const form=structuredClone(fixtures.form);form.theme.version='0.5.0';const frozen=await createPanelBundle(form,oldCatalog,core);assert.equal(all(frozen).find(n=>n.type==='Input').layout.x,12);
 assert.throws(()=>compilePanel(fixtures.form,catalog,core,undefined,undefined,'0.15.0'),/COMPILER_VERSION/);assert.throws(()=>compilePanel(form,oldCatalog,core,undefined,undefined,'0.16.0'),/COMPILER_VERSION/);
 for(const change of [c=>c.themes[0].presentationStyle='unknown',c=>delete c.themes[0].controlStyle]){const c=structuredClone(catalog);change(c);assert.throws(()=>validateCatalog(c));}
});

for(const theme of catalog.themes)test(`${theme.id}: all focused scenarios validate/replay`,async()=>{
 for(const original of Object.values(fixtures)){const spec=structuredClone(original);spec.theme={id:theme.id,version:theme.version};const arranged=arrangeIntentSpec(spec,layoutSettings(),theme),bundle=await createPanelBundle(arranged,catalog,core);await validatePanelBundle(bundle,core);assert.deepEqual(bundle.state,Object.fromEntries(arranged.state.map(f=>[f.id,f.initial])));}
});
