import test from 'node:test';
import assert from 'node:assert/strict';
import {previewPalette} from '../src/panel/preview-theme.mjs';
import {rgb,contrastRatio} from '../src/skins/text-readability.mjs';

test('light and dark skin previews keep readable chrome and distinct neutral backdrops',()=>{
 const backdrops=new Set();
 for(const base of ['#FAFBFD','#384563','#FFFFFF','#FFF3D8','#E3D7BB','#F5F0DD']){
  const profile={palette:{base,text:base,stroke:'#79BDB1'}},before=structuredClone(profile),p=previewPalette(profile);
  assert(contrastRatio(rgb(p.surfaceInk),rgb(p.surface))>=4.5);
  assert(contrastRatio(rgb(p.ink),rgb(p.canvas))>=4.5);
  assert.notEqual(p.canvas,p.surface);backdrops.add(p.canvas);assert.deepEqual(profile,before);
 }
 assert(backdrops.size>=5);
 assert.throws(()=>previewPalette({palette:{base:'url(example)'}}),/PREVIEW_PALETTE_INVALID/);
});
