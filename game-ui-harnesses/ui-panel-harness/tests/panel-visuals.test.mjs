import test from 'node:test';
import assert from 'node:assert/strict';
import {readJson} from '../src/io.mjs';
import {validateCatalog} from '../src/catalog.mjs';
import {createPlanningContext} from '../src/planning-context.mjs';
import {materializePanelIntent} from '../src/panel-intent.mjs';
import {createPanelBundle,validatePanelBundle} from '../src/panel-bundle.mjs';
import {compilePanel,controlId} from '../src/compiler.mjs';
import {loadWorkspaceCore} from '../src/component-adapter.mjs';
import {panelVisualMotion,attachPanelVisuals,alignPanelButtonLabels} from '../src/panel-visuals.mjs';
import {formRequest,formIntent} from '../examples/forms-v1/fixture.mjs';
import {createUnityDocument} from '../src/unity-export.mjs';
const core=await loadWorkspaceCore(),legacyCatalog=await readJson(new URL('../examples/modern-mint-forms.catalog.json',import.meta.url));
const catalog=await readJson(new URL('../examples/modern-mint-polished.catalog.json',import.meta.url));
const context=await createPlanningContext(formRequest,legacyCatalog);
const proposal=await materializePanelIntent(context,formIntent(context));
const legacy=await createPanelBundle(proposal.spec,legacyCatalog,core);
const spec=structuredClone(proposal.spec);spec.theme={id:catalog.themes[0].id,version:catalog.themes[0].version};
const bundle=await createPanelBundle(spec,catalog,core);
const nodes=b=>{const all=[];const visit=n=>{all.push(n);n.children?.forEach(visit);};visit(b.componentBundle.document.root);return all;};
function contrast(a,b){
 const luminance=color=>{const c=[1,3,5].map(i=>parseInt(color.slice(i,i+2),16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);return c[0]*.2126+c[1]*.7152+c[2]*.0722;};
 const x=luminance(a),y=luminance(b);return(Math.max(x,y)+.05)/(Math.min(x,y)+.05);
}

test('new visual catalog opts in exactly and legacy theme/compiler replay stays unchanged',async()=>{
 assert.deepEqual(validateCatalog(catalog),catalog);
 for(const visualStyle of ['modern','latest',{version:'1.0'}]){const wrong=structuredClone(catalog);wrong.themes[0].visualStyle=visualStyle;assert.throws(()=>validateCatalog(wrong));}
 assert.equal(legacy.compilerVersion,'0.7.0');assert.equal(bundle.compilerVersion,'0.7.1');
 assert.deepEqual(await validatePanelBundle(legacy,core),legacy);
 assert.deepEqual(await validatePanelBundle(bundle,core),bundle);
 assert.equal(panelVisualMotion(legacy),null);
 assert.throws(()=>compilePanel(spec,catalog,core,undefined,undefined,'0.7.0'),/VISUAL_STYLE_VERSION/);
 assert.throws(()=>compilePanel(legacy.spec,legacyCatalog,core,undefined,undefined,'0.7.1'),/VISUAL_STYLE_VERSION/);
 const forged=structuredClone(bundle);forged.compilerVersion='0.7.0';await assert.rejects(validatePanelBundle(forged,core),/VISUAL_STYLE_VERSION/);
});

test('theming preserves state, event/action identities and control rectangles',()=>{
 assert.deepEqual(bundle.state,legacy.state);assert.deepEqual(bundle.bindings,legacy.bindings);assert.deepEqual(bundle.actions,legacy.actions);
 assert.deepEqual(bundle.spec.sections,legacy.spec.sections);assert.deepEqual(bundle.spec.layout,legacy.spec.layout);
 const before=new Map(nodes(legacy).map(n=>[n.id,n]));
 for(const n of nodes(bundle).filter(n=>['Button','Input'].includes(n.type)))assert.deepEqual(n.layout,before.get(n.id).layout);
 const input=nodes(bundle).find(n=>n.type==='Input'),label=nodes(bundle).find(n=>n.id===`${spec.id}.row.row0.label`);
 assert(Math.abs((input.layout.y+input.layout.height/2)-(label.layout.y+label.layout.height/2))<.01,'input label shares field center');
 assert.equal(nodes(bundle).filter(n=>n.id.endsWith('.title-divider')).length,1);
});

test('mint theme normal text, value and accent button pairs have readable contrast',()=>{
 const t=catalog.themes[0].tokens;
 for(const [fg,bg]of[[t.text,t.surface],[t.text,t.control],[t.muted,t.surface],[t.accent,t.surface],[t.accent,t.control],['#FFFFFF',t.accent]])assert(contrast(fg,bg)>=4.5,`${fg}/${bg}`);
 for(const n of nodes(bundle).filter(n=>n.type==='Button'))assert(contrast(n.props.style.textColor,n.props.style.backgroundColor)>=4.5);
 assert(contrast(t.accent,t.surface)>=3,'input boundary contrast');
});

test('native UGUI export retains themed paint and uses the same field/command contract',async()=>{
 const native=await createUnityDocument(bundle,core);
 const button=nodes(bundle).find(n=>n.type==='Button'),lowered=native.nodes.find(n=>n.id===button.id);
 assert.equal(lowered.backgroundColor,button.props.style.backgroundColor);assert.equal(lowered.textColor,button.props.style.textColor);
 assert(!native.nodes.some(node=>node.id.endsWith('.center-label')),'native Button supplies exactly one centered label');
 assert.equal(native.controls.find(n=>n.nodeId===controlId(spec.id,'row1')).action,'submit');
 assert.equal(native.fields[0].initialString,'');assert.equal(native.fields[0].stringValue,'');
});

test('reduced motion changes and teardown cancel feedback without replacing semantic values',()=>{
 const calls=[],listeners=new Set(),frames=new Map(),preference={matches:false,addEventListener(type,fn){assert.equal(type,'change');listeners.add(fn);},removeEventListener(type,fn){assert.equal(type,'change');listeners.delete(fn);}};
 let handler,now=0,frameId=0,unsubscribed=0;
 const clock={now:()=>now,request:fn=>{frames.set(++frameId,fn);return frameId;},cancel:id=>frames.delete(id)};
 const runtime={setMotionSystem:()=>assert.fail('whole-tree reset is forbidden'),inspect:()=>({nodes:[]}),applyMotion:(id,value)=>calls.push({id,value}),subscribe:fn=>{handler=fn;return()=>{unsubscribed++;handler=undefined;};}};
 const stop=attachPanelVisuals(bundle,runtime,query=>{assert.equal(query,'(prefers-reduced-motion: reduce)');return preference;},clock);
 assert.equal(calls.length,0,'installing hover feedback does not redraw the tree');
 assert.equal(panelVisualMotion(bundle).style,'corporate');assert.deepEqual(panelVisualMotion(bundle).bindings.map(b=>b.componentType),['Button','Button']);
 const id=bundle.actions.at(-1).nodeId;handler({id,type:'hover',value:1});assert.equal(frames.size,1);
 const frame=frames.values().next().value;frames.clear();now=100;frame(now);assert.equal(calls.at(-1).value.scaleX,1.01);
 preference.matches=true;listeners.forEach(fn=>fn());assert.equal(calls.at(-1).value.scaleX,1);assert.equal(frames.size,0);
 const reducedCount=calls.length;handler({id,type:'hover',value:1});assert.equal(calls.length,reducedCount);
 preference.matches=false;listeners.forEach(fn=>fn());handler({id,type:'hover',value:1});assert.equal(frames.size,1);
 stop();assert.equal(listeners.size,0);assert.equal(unsubscribed,1);assert.equal(frames.size,0);const count=calls.length;stop();assert.equal(calls.length,count);
 assert.deepEqual(bundle.state,{row0:''});
 const never=()=>assert.fail('legacy media must not be read');attachPanelVisuals(legacy,runtime,never)();assert.equal(calls.length,count);
});

test('cancelled pointer feedback restores only its button and uses centered local transforms',()=>{
 const calls=[],frames=new Map();let handler,now=0,frameId=0;
 const clock={now:()=>now,request:fn=>{frames.set(++frameId,fn);return frameId;},cancel:id=>frames.delete(id)};
 const runtime={inspect:()=>({nodes:[]}),applyMotion:(id,value)=>calls.push({id,value}),subscribe:fn=>{handler=fn;return()=>{};}};
 const stop=attachPanelVisuals(bundle,runtime,undefined,clock),id=bundle.actions.at(-1).nodeId;
 handler({id,type:'hover',value:1});const frame=frames.values().next().value;frames.clear();now=50;frame(now);
 const button=nodes(bundle).find(n=>n.id===id),value=calls.at(-1).value;
 assert(Math.abs(value.x+button.layout.width*value.scaleX/2-button.layout.width/2)<1e-10);
 assert(Math.abs(value.y+button.layout.height*value.scaleY/2-button.layout.height/2)<1e-10);
 handler({id,type:'cancel'});assert.equal(calls.at(-1).value.scaleX,1);assert.equal(frames.size,0);assert(calls.every(c=>c.id===id));stop();
});

test('button centering uses measured glyphs instead of guessing character widths',()=>{
 for(const width of [62.4,99.7,143.1]){
  const calls=[],runtime={inspect:()=>({nodes:[{id:'button',type:'Button',bounds:{x:100,y:30,width:220,height:40}},{id:'button.center-label',type:'Text',renderedTextBounds:[{bounds:{x:108,y:40,width,height:19}}]}]}),applyMotion:(id,value)=>calls.push({id,value})};
  alignPanelButtonLabels(runtime);assert.equal(calls[0].id,'button.center-label');
  assert.equal(calls[0].value.x,100+(220-width)/2-108);assert.equal(calls[0].value.y,.5);
 }
});
