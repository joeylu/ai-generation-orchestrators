import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buttonLinesFixture} from './helpers/button-label-lines-fixture.ts';
import {applyAppearanceBinding} from '../src/appearance-apply.ts';
import {buttonLabelLinesError} from '../src/button-label-lines.ts';
import {validateBundle} from '../src/bundle.ts';
import {appearanceApplicationFixture} from './helpers/appearance-application-fixture.ts';
test('explicit lines apply, survive portable serialization and legacy remains unchanged',async()=>{
 const f=await buttonLinesFixture(),bundle=await applyAppearanceBinding(f.target,f.imported,f.binding);
 const button=(bundle.document as any).root.children[0];assert.deepEqual(button.props.appearance.labelLines,f.lines);
 assert.deepEqual((await validateBundle(JSON.parse(JSON.stringify(bundle)))).document,bundle.document);
 const old=await appearanceApplicationFixture(),legacy=await applyAppearanceBinding(old.target,old.imported,old.binding);
 assert.equal((legacy.document as any).root.children[0].props.appearance.labelLines,undefined);
});
test('invalid optional lines are rejected by both binding and semantic import',async()=>{
 const mutations=[(v:any)=>v.version='2.0',(v:any)=>delete v.lines[1].layout,(v:any)=>v.lines[1].text='invented',(v:any)=>v.lines[0].fontSize=NaN,(v:any)=>v.lines[0].layout.x=-1,(v:any)=>v.lines[0].layout.width=101,(v:any)=>v.lines[1].layout.y=2,(v:any)=>v.lines[0].align='middle',(v:any)=>v.extra=true];
 for(const mutate of mutations){
  const f=await buttonLinesFixture(),bundle=structuredClone(await applyAppearanceBinding(f.target,f.imported,f.binding));
  mutate((f.binding.bindings[0].states!.button as any).labelLines);
  await assert.rejects(()=>applyAppearanceBinding(f.target,f.imported,f.binding));
  (bundle.document as any).root.children[0].props.appearance.labelLines=(f.binding.bindings[0].states!.button as any).labelLines;
  await assert.rejects(()=>validateBundle(bundle));
 }
});
test('target-local bounds stay independent of a raster source scale',async()=>{
 const {lines}=await buttonLinesFixture();assert.equal(buttonLabelLinesError(lines,'返回\nBACK',100,40),undefined);
 assert.equal(buttonLabelLinesError(lines,'返回\nBACK',50,40),'BUTTON_LABEL_LINES_BOUNDS');
});
