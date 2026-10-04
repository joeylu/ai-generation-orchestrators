import test from 'node:test';
import assert from 'node:assert/strict';
import {validateDocument,walkNodes} from '../src/tree-contract.ts';
import {treeResourceReferences} from '../src/tree-resources.ts';
import {requiredLayerDecisionFields,validateLayerPlanningEvidence} from '../src/layer-planning-evidence.ts';
import {stateTemplateFixture} from './helpers/state-template-fixture.ts';
const fixture=()=>stateTemplateFixture();
test('independent state templates require an explicit valid policy; legacy mismatch checks remain',()=>{
 const doc=fixture();assert.doesNotThrow(()=>validateDocument(doc));
 for(const id of ['list','tabs']){const changed=fixture(),node=walkNodes(changed).find(n=>n.id===id)! as any;delete node.props.appearance.templateSizing;assert.throws(()=>validateDocument(changed),e=>(e as any).issues.some((i:any)=>i.code.endsWith('TEMPLATE_SIZE_MISMATCH')));node.props.appearance.templateSizing='stretch';assert.throws(()=>validateDocument(changed));}
});
test('selected marker is enumerated and stays within the normal row coordinate system',()=>{
 const doc=fixture();assert.ok(treeResourceReferences(doc).imageSources.has('marker.svg'));
 for(const mutation of [(a:any)=>a.selectedIndicator.layout.x=195,(a:any)=>a.selectedIndicator.canvas.width=0,(a:any)=>a.selectedTextColor='red',(a:any)=>a.selectedIndicator.extra=true]){const bad=fixture(),node=walkNodes(bad).find(n=>n.id==='list')! as any;mutation(node.props.appearance);assert.throws(()=>validateDocument(bad));}
});
test('independent native tab cells keep normal geometry and overlap checks strict',()=>{
 const doc=fixture(),tabs=walkNodes(doc).find(n=>n.id==='tabs')! as any,a=tabs.props.appearance;
 a.items=tabs.props.tabs.map((t:any,i:number)=>({tabId:t.id,layout:{x:i*120,y:0,width:120,height:40},tabImage:a.tabImage,tabCanvas:a.tabCanvas,activeTabImage:a.activeTabImage,activeTabCanvas:a.activeTabCanvas,labelLayout:a.labelLayout,hitArea:a.hitArea}));
 assert.doesNotThrow(()=>validateDocument(doc));
 for(const change of [(b:any)=>delete b.templateSizing,(b:any)=>b.items[0].tabCanvas={width:119,height:40},(b:any)=>b.items[1].layout.x=100]){const bad=structuredClone(doc);change((walkNodes(bad).find(n=>n.id==='tabs')! as any).props.appearance);assert.throws(()=>validateDocument(bad));}
});
test('source plans cannot silently infer independent sizing or selected marker policies',()=>{
 const doc=fixture(),fields=requiredLayerDecisionFields(doc),policies=['/props/appearance/templateSizing','/props/appearance/selectedIndicator','/props/appearance/selectedTextColor'];
 for(const pointer of policies)assert.ok(fields.some(f=>f.componentId==='list'&&f.pointer===pointer));
 const findings=fields.map(f=>({...f,basis:policies.includes(f.pointer)?'explicit-policy':'observed',note:'Deterministic fixture explicitly supplies every field.'}));
 const ev={version:'1.0',referenceSha256:'a'.repeat(64),responseSha256:'b'.repeat(64),findings,issues:[]};
 assert.doesNotThrow(()=>validateLayerPlanningEvidence(ev,doc));
 for(const pointer of policies){const bad=structuredClone(ev);bad.findings.find(f=>f.componentId==='list'&&f.pointer===pointer)!.basis='inferred';assert.throws(()=>validateLayerPlanningEvidence(bad,doc));const missing=structuredClone(ev);missing.findings=missing.findings.filter(f=>!(f.componentId==='list'&&f.pointer===pointer));assert.throws(()=>validateLayerPlanningEvidence(missing,doc));}
});
