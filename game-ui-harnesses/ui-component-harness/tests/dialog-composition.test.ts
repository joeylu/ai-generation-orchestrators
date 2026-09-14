import test from 'node:test';
import assert from 'node:assert/strict';
import {secondBatchAppearanceFixture} from './helpers/second-batch-appearance-fixture.ts';
import {applyAppearanceBinding} from '../src/appearance-apply.ts';
import {appearanceDocumentSha256} from '../src/appearance-binding.ts';
import {validateBundle} from '../src/bundle.ts';

test('Dialog optional body preserves old composition and supports explicit native backdrop',async()=>{
 const f=await secondBatchAppearanceFixture();const old:any=await applyAppearanceBinding(f.target,f.imported,f.binding);
 assert.ok(old.document.root.children.find(n=>n.type==='Dialog').props.appearance.body);
 const binding:any=structuredClone(f.binding),target:any=structuredClone(f.target);
 binding.bindings.find(b=>b.componentType==='Dialog').parts=binding.bindings.find(b=>b.componentType==='Dialog').parts.filter(p=>!['body','overlay'].includes(p.role));
 target.document.root.children.find(n=>n.type==='Dialog').props.backdrop={color:'#000000',opacity:.6};
 binding.documentSha256=await appearanceDocumentSha256(target.document);
 const next:any=await applyAppearanceBinding(target,f.imported,binding);const dialog=next.document.root.children.find(n=>n.type==='Dialog');
 assert.equal(dialog.props.appearance.body,undefined);assert.deepEqual(dialog.props.backdrop,{color:'#000000',opacity:.6});await validateBundle(next);
 for(const value of [-1,1.1,'0.6']){const bad=structuredClone(next);bad.document.root.children.find(n=>n.type==='Dialog').props.backdrop.opacity=value;await assert.rejects(validateBundle(bad));}
 const mixed=structuredClone(old);mixed.document.root.children.find(n=>n.type==='Dialog').props.backdrop={color:'#000',opacity:.6};await assert.rejects(validateBundle(mixed),/BACKDROP_CONFLICT/);
});
