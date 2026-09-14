import test from 'node:test';import assert from 'node:assert/strict';
import {fixture} from './helpers/scrollbar-insets-fixture.ts';
import {applyAppearanceBinding} from '../src/appearance-apply.ts';
import {validateBundle} from '../src/bundle.ts';
import {insetThumbGeometry} from '../src/scrollbar-insets.ts';
test('insets validate, scale once and survive save/reopen',async()=>{
 for(const scale of [1,2]){const f=await fixture(scale);f.binding.bindings[0].states.scrollView.scrollbarInsets={version:'1.0',top:20*scale,bottom:20*scale};const b=await applyAppearanceBinding(f.target,f.imported,f.binding);assert.deepEqual((b.document as any).root.children[0].children[0].props.appearance.scrollbarInsets,{version:'1.0',top:20,bottom:20});assert.deepEqual(await validateBundle(JSON.parse(JSON.stringify(b))),b);}
 for(const value of [{version:'2.0',top:20,bottom:20},{version:'1.0',top:-1,bottom:20},{version:'1.0',top:60,bottom:60},{version:'1.0',top:20}]){const f=await fixture();f.binding.bindings[0].states.scrollView.scrollbarInsets=value;await assert.rejects(applyAppearanceBinding(f.target,f.imported,f.binding));}
});
test('small and zero overflow never paint into end caps',()=>{for(const content of [120,140,240])for(const scroll of [0,10,1000]){const g=insetThumbGeometry(5,110,20,120,content,scroll,{version:'1.0',top:20,bottom:20});assert(g.y>=25);assert(g.y+g.height<=95);if(content===120)assert.deepEqual(g,{y:25,height:70,travelY:0});}});
