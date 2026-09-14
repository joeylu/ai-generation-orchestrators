import test from 'node:test';import assert from 'node:assert/strict';
import {selectMenuHighlightsFixture,fixtureMenuHighlights} from './helpers/select-menu-highlights-fixture.ts';
import {validateSelectMenuHighlights,scaleSelectMenuHighlights} from '../src/select-menu-highlights.ts';
import {validateAppearanceBinding,appearanceDocumentSha256} from '../src/appearance-binding.ts';
import {applyAppearanceBinding} from '../src/appearance-apply.ts';
import {importComponentHandoffWithReview} from '../src/component-handoff.ts';
import {validateDocument} from '../src/tree-contract.ts';
import {validateBundle,createBundle} from '../src/bundle.ts';
import {exportReferenceHandoff,zip} from '../src/reference-persistence.ts';
import {componentHandoffEntries} from '../src/decomposition-import.ts';
const f=await selectMenuHighlightsFixture();
const runtime=(d:any)=>d.root.children[0].props.appearance;
test('menu highlights compile through official handoff and preserve old optional behavior',async()=>{
 const {bundle}=await importComponentHandoffWithReview(f.zip);assert.deepEqual(runtime(bundle.document).menuHighlights,fixtureMenuHighlights);
 const old=structuredClone(f.binding);delete old.bindings[2].states.select.menuHighlights;
 assert.equal(runtime((await applyAppearanceBinding(f.target,f.imported,old)).document).menuHighlights,undefined);
});
for(const [name,mutate,code] of [
 ['version',(h:any)=>h.version='2.0','UNSUPPORTED_VERSION'],['space',(h:any)=>h.coordinateSpace='screen','UNSUPPORTED_COORDINATE_SPACE'],
 ['named color',(h:any)=>h.selected.color='blue','INVALID_COLOR'],['short hex',(h:any)=>h.selected.color='#ABC','INVALID_COLOR'],['bad hex',(h:any)=>h.hover.color='#00GG22','INVALID_COLOR'],
 ['alpha overflow',(h:any)=>h.selected.alpha=1.01,'INVALID_ALPHA'],['negative alpha',(h:any)=>h.hover.alpha=-0.1,'INVALID_ALPHA'],['NaN',(h:any)=>h.hover.alpha=NaN,'INVALID_ALPHA'],
 ['negative inset',(h:any)=>h.selected.insets.left=-1,'INVALID_INSET'],['infinite inset',(h:any)=>h.hover.insets.top=Infinity,'INVALID_INSET'],['empty rectangle',(h:any)=>h.selected.insets.top=44,'HIGHLIGHT_OUT_OF_BOUNDS'],
 ['negative radius',(h:any)=>h.hover.cornerRadius=-1,'INVALID_RADIUS'],['radius overflow',(h:any)=>h.selected.cornerRadius=30,'RADIUS_OUT_OF_BOUNDS'],
 ['missing state',(h:any)=>delete h.hover,'REQUIRED_FIELD'],['unknown field',(h:any)=>h.script='anything','UNKNOWN_FIELD'],['nested unknown',(h:any)=>h.selected.tint=true,'UNKNOWN_FIELD'],
 ] as const)test('both binding/runtime reject '+name,async()=>{
 const binding=structuredClone(f.binding);mutate(binding.bindings[2].states.select.menuHighlights);await assert.rejects(validateAppearanceBinding(binding,f.document,f.imported),new RegExp(code));
 const {bundle}=await importComponentHandoffWithReview(f.zip);const doc:any=structuredClone(bundle.document);mutate(runtime(doc).menuHighlights);assert.throws(()=>validateDocument(doc),new RegExp(code));
});
test('explicit safe area is mandatory and alpha zero/one are legal',async()=>{
 const b=structuredClone(f.binding);delete b.bindings[2].states.select.popupContentLayout;await assert.rejects(validateAppearanceBinding(b,f.document,f.imported),/POPUP_CONTENT_REQUIRED/);
 const h=structuredClone(fixtureMenuHighlights);h.selected.alpha=0;h.hover.alpha=1;assert.deepEqual(validateSelectMenuHighlights(h,{width:276,height:144},3,'h'),[]);
});
test('highlight units scale once without changing colors/alpha or source',()=>{
 const doubled=scaleSelectMenuHighlights(fixtureMenuHighlights,2);assert.equal(doubled.selected.insets.left,8);assert.equal(doubled.selected.cornerRadius,12);assert.equal(doubled.selected.color,fixtureMenuHighlights.selected.color);assert.deepEqual(scaleSelectMenuHighlights(doubled,0.5),fixtureMenuHighlights);assert.equal(fixtureMenuHighlights.selected.insets.left,4);
});
test('official appearance application converts registered highlight geometry once',async()=>{
 const doc=structuredClone(f.document),binding=structuredClone(f.binding);doc.canvas={width:1000,height:800};
 for(const n of [doc.root,...doc.root.children])for(const key of ['x','y','width','height'])n.layout[key]*=2;
 binding.registration.targetCanvas=doc.canvas;binding.registration.transform.scale=2;
 for(const b of binding.bindings)if(b.states){const state=b.states.select??b.states.button;for(const key of ['x','y','width','height'])state.labelLayout[key]*=2;
  if(b.states.select){state.popupPlacement.gap*=2;for(const key of ['x','y','width','height'])state.popupContentLayout[key]*=2;
   for(const item of state.optionIcons.items)for(const box of [item.labelLayout,item.icon.layout])for(const key of ['x','y','width','height'])box[key]*=2;
   state.menuHighlights=scaleSelectMenuHighlights(state.menuHighlights,2);
  }
 }
 binding.documentSha256=await appearanceDocumentSha256(doc);const target=await createBundle(doc,[],{kind:'programmatic-fixture',description:'Explicit registered scale for menu highlight geometry'});
 const applied=await applyAppearanceBinding(target,f.imported,binding);assert.deepEqual(runtime(applied.document).menuHighlights,fixtureMenuHighlights);
});
test('changing authored highlights without updating the package digest is rejected',async()=>{
 const entries=new Map(f.entries),binding=structuredClone(f.binding);binding.bindings[2].states.select.menuHighlights.selected.color='#FF0000';entries.set('appearance-binding.json',new TextEncoder().encode(JSON.stringify(binding)));
 await assert.rejects(importComponentHandoffWithReview(zip(entries)),/DIGEST|SHA256|HASH|CHECKSUM/);
});
test('saved bundle/export/reimport preserve declaration and all reference bytes',async()=>{
 const {bundle}=await importComponentHandoffWithReview(f.zip);const saved:any=JSON.parse(JSON.stringify(bundle));saved.document.root.children[0].props.selectedId='green';
 const out=await exportReferenceHandoff(await validateBundle(saved));const entries=await componentHandoffEntries(out);
 for(const [name,bytes]of f.entries)if(name!=='handoff.json')assert.deepEqual(entries.get(name),bytes,name);
 const again=await importComponentHandoffWithReview(out);assert.deepEqual(runtime(again.bundle.document).menuHighlights,fixtureMenuHighlights);assert.equal((again.bundle.document as any).root.children[0].props.selectedId,'green');
 const invalid:any=structuredClone(saved);runtime(invalid.document).menuHighlights.selected.color='#FF0000';await assert.rejects(validateBundle(invalid),/STALE|CHANGED|MISMATCH|reference/i);
});
