import test from 'node:test';
import assert from 'node:assert/strict';
import { createBundle, validateBundle } from '../src/bundle.ts';
import { applyAppearanceBinding } from '../src/appearance-apply.ts';
import { appearanceDocumentSha256 } from '../src/appearance-binding.ts';
import { nativeTabsFixture } from './helpers/native-tabs-fixture.ts';

for (const value of [undefined,true,false]) test(`Tabs background ${value} survives appearance and serialization`,async()=>{
 const f=await nativeTabsFixture(),doc=structuredClone(f.document) as any;
 if(value!==undefined)doc.root.children[0].props.drawBackground=value;
 const bundle=await createBundle(doc,[],{kind:'programmatic-fixture',description:'Explicit background fixture'});
 const applied=await applyAppearanceBinding(bundle,f.imported,{...f.binding,documentSha256:await appearanceDocumentSha256(doc)});
 const copy=JSON.parse(JSON.stringify(applied));await validateBundle(copy);
 assert.equal(copy.document.root.children[0].props.drawBackground,value);
});
test('Tabs background rejects non booleans',async()=>{
 const f=await nativeTabsFixture();
 for(const value of ['false',0,null]){const doc=structuredClone(f.document) as any;doc.root.children[0].props.drawBackground=value;await assert.rejects(createBundle(doc,[],{kind:'programmatic-fixture',description:'Invalid background fixture'}));}
});
