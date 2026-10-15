import {test} from 'node:test';
import assert from 'node:assert/strict';
import {locateSheet} from '../src/skins/locate.mjs';
const coordinates={width:32,height:32},sheet={id:'S',parts:[{assetId:'a',slotRect:[1,1,13,30]},{assetId:'b',slotRect:[18,1,13,30]}]};
function image(scale=1){return{width:32*scale,height:32*scale,pixels:Buffer.alloc(32*32*scale*scale*4)};}
function fill(img,x,y,w,h,a=255){for(let yy=y;yy<y+h;yy++)for(let xx=x;xx<x+w;xx++)img.pixels[(yy*img.width+xx)*4+3]=a;return img;}
test('locates full alpha including low-opacity edges in original scaled coordinates',()=>{
  const im=fill(fill(image(2),6,6,16,20),40,6,16,20,1),r=locateSheet(im,sheet,coordinates);
  assert.equal(r.status,'candidate');assert.deepEqual(r.parts.map(p=>p.crop),[[6,6,16,20],[40,6,16,20]]);
  assert.equal(r.semanticIdentity,'not-verified');
});
test('missing, multiple disconnected parts, crossing and outside pixels stay ambiguous',()=>{
  let im=fill(image(),3,3,4,4);assert.deepEqual(locateSheet(im,sheet,coordinates).parts[1].issues,['missing']);
  fill(im,9,10,2,2);assert.ok(locateSheet(im,sheet,coordinates).parts[0].issues.includes('multiple-components'));
  im=fill(image(),3,3,20,4);const r=locateSheet(im,sheet,coordinates);
  assert.ok(r.parts.every(p=>p.crop===null&&p.issues.includes('slot-boundary-or-crossing')));
  im=fill(fill(fill(image(),3,3,4,4),20,3,4,4),16,20,1,1);
  assert.equal(locateSheet(im,sheet,coordinates).outsideComponents.length,1);
});
test('opaque backgrounds, overlap and aspect changes are not silently segmented',()=>{
  assert.equal(locateSheet(fill(image(),0,0,32,32),sheet,coordinates).status,'unsupported');
  assert.throws(()=>locateSheet(image(),{id:'S',parts:[sheet.parts[0],{assetId:'c',slotRect:[2,2,4,4]}]},coordinates),/overlapping/);
  assert.throws(()=>locateSheet(image(),sheet,{width:64,height:32}),/aspect/);
});
test('a shape in the wrong semantic slot remains explicitly unverified',()=>{
  const r=locateSheet(fill(fill(image(),3,3,4,4),20,3,4,4),sheet,coordinates);
  assert.equal(r.status,'candidate');assert.equal(r.semanticIdentity,'not-verified');
});
