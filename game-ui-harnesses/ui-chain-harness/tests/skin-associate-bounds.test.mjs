import {test} from 'node:test';
import assert from 'node:assert/strict';
import {associateSheet} from '../src/skins/associate.mjs';
import {locateSheet} from '../src/skins/locate.mjs';
import {assertSeparatedCrops} from '../src/skins/proposal-crops.mjs';
import policy from '../configs/skin-localization-policy.json' with {type:'json'};
const legacyPolicy={...policy};delete legacyPolicy.boundedWeakAttachments;
const blank=(width=32,height=80)=>({width,height,pixels:Buffer.alloc(width*height*4)});
function fill(image,x,y,w,h,alpha=255){for(let yy=y;yy<y+h;yy++)for(let xx=x;xx<x+w;xx++)image.pixels[(yy*image.width+xx)*4+3]=alpha;return image;}
const sheet={id:'S',parts:[{assetId:'a',slotRect:[0,0,32,35]},{assetId:'b',slotRect:[0,39,32,41]}]},coordinates={width:32,height:80};
const associate=(image,p=policy)=>associateSheet(image,locateSheet(image,sheet,coordinates),p);
function collidingWeak(){const im=fill(fill(blank(),6,4,20,16),6,50,20,16);fill(im,3,18,1,21,1);fill(im,3,38,4,1,1);fill(im,28,31,1,22,1);fill(im,24,31,5,1,1);return im;}
test('long alpha-noise appendages reproduce the collision; bounded attachments preserve original bodies and all source bytes',()=>{
 const image=collidingWeak(),before=Buffer.from(image.pixels),old=associate(image,legacyPolicy),result=associate(image);
 assert.throws(()=>assertSeparatedCrops(old.parts),/metadata.overlap/);
 assert.doesNotThrow(()=>assertSeparatedCrops(result.parts));
 assert.deepEqual(result.parts.map(p=>p.proposedCrop),[[6,4,20,16],[6,50,20,16]]);
 assert.equal(result.unresolvedWeak.filter(p=>p.reason==='outside-anchor-reach').length,2);
 assert.equal(result.accounting.outsideNonzeroPixels,50);
 assert.equal(result.accounting.sourceAlphaSum,result.accounting.coveredAlphaSum+result.accounting.outsideAlphaSum);
 assert.equal(result.accounting.sourceNonzeroPixels,result.accounting.coveredNonzeroPixels+result.accounting.outsideNonzeroPixels);
 assert.deepEqual(image.pixels,before);assert.equal(result.pixelsModified,false);assert.equal(result.assemblyReady,false);
});
test('small detached faint fringe inside fixed reach is retained exactly',()=>{
 const image=fill(fill(fill(blank(),6,4,20,16),6,50,20,16),8,22,2,2,4),r=associate(image);
 assert.equal(r.parts[0].attachedWeakComponentIds.length,1);assert.deepEqual(r.parts[0].proposedCrop,[6,4,20,20]);
 assert.equal(r.accounting.sourceAlphaSum,r.accounting.coveredAlphaSum);
});
test('opaque detached decoration and ambiguous ownership stay blocked, with no area cutoff',()=>{
 const decorated=fill(fill(fill(blank(),6,4,20,16),6,50,20,16),3,8,1,1,255),r=associate(decorated);
 assert.equal(r.parts[0].anchorComponentIds.length,2);assert.ok(r.parts[0].issues.includes('multiple-substantial-pieces'));
 assert.throws(()=>assertSeparatedCrops(r.parts),/proposal-unresolved/);
 const shared=fill(fill(fill(blank(),6,4,20,16),6,50,20,16),2,29,28,14,255),s=associate(shared);
 assert.ok(s.parts.some(p=>p.conflictComponentIds.length));assert.throws(()=>assertSeparatedCrops(s.parts),/proposal-unresolved/);
});
test('legacy weak extent remains available for frozen policies and invalid opt-ins fail',()=>{
 const image=collidingWeak(),location=locateSheet(image,sheet,coordinates);
 const legacy=associateSheet(image,location,legacyPolicy);
 assert.throws(()=>assertSeparatedCrops(legacy.parts),/metadata.overlap/);
 assert.equal(legacy.unresolvedWeak.length,0);
 assert.deepEqual(associateSheet(image,location,{...legacyPolicy,boundedWeakAttachments:false}),legacy);
 for(const value of [1,'true',null])assert.throws(()=>associate(image,{...policy,boundedWeakAttachments:value}),/weak-attachment-policy/);
});
test('logical attachment extent scales with output resolution',()=>{
 const image=collidingWeak(),large=blank(64,160);
 for(let y=0;y<80;y++)for(let x=0;x<32;x++)fill(large,x*2,y*2,2,2,image.pixels[(y*32+x)*4+3]);
 const a=associate(image),b=associateSheet(large,locateSheet(large,sheet,coordinates),policy);
 assert.deepEqual(b.parts.map(p=>p.proposedCrop),a.parts.map(p=>p.proposedCrop.map(n=>n*2)));
 assert.equal(b.accounting.outsideAlphaSum,a.accounting.outsideAlphaSum*4);
});
