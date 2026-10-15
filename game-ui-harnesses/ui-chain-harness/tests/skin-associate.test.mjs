import {test} from 'node:test';
import assert from 'node:assert/strict';
import {locateSheet} from '../src/skins/locate.mjs';
import {associateSheet} from '../src/skins/associate.mjs';
import {readFileSync} from 'node:fs';
const policy={version:'1.0',weakComponentMaxAlpha:2,attachmentGapLogicalPixels:2,automaticAcceptance:false};
const sheet={id:'S',parts:[{assetId:'a',slotRect:[0,0,15,32]},{assetId:'b',slotRect:[17,0,15,32]}]},coords={width:32,height:32};
const blank=()=>({width:32,height:32,pixels:Buffer.alloc(32*32*4)});
function fill(im,x,y,w,h,alpha=255){for(let yy=y;yy<y+h;yy++)for(let xx=x;xx<x+w;xx++)im.pixels[(yy*im.width+xx)*4+3]=alpha;return im;}
const run=im=>associateSheet(im,locateSheet(im,sheet,coords),policy);
const primaryPolicy={...policy,primaryOwnership:{minimumPixelFraction:0.6,minimumAlphaFraction:0.6,maximumOtherSlotFraction:0.2}};
const runPrimary=im=>associateSheet(im,locateSheet(im,sheet,coords),primaryPolicy);

test('production policy retains detached alpha-4 fringe without classifying it as another substantial body',()=>{
 const config=JSON.parse(readFileSync(new URL('../configs/skin-localization-policy.json',import.meta.url)));
 const im=fill(fill(blank(),3,8,9,10),4,6,7,1,4),before=Buffer.from(im.pixels);
 const r=associateSheet(im,locateSheet(im,sheet,coords),config),p=r.parts[0];
 assert.equal(p.anchorComponentIds.length,1);assert.equal(p.attachedWeakComponentIds.length,1);
 assert.ok(!p.issues.includes('multiple-substantial-pieces'));assert.deepEqual(p.proposedCrop,[3,6,9,12]);assert.deepEqual(im.pixels,before);
 assert.equal(r.accounting.sourceAlphaSum,r.accounting.coveredAlphaSum+r.accounting.outsideAlphaSum);assert.equal(r.assemblyReady,false);
 fill(im,4,6,7,1,5);const stronger=associateSheet(im,locateSheet(im,sheet,coords),config);
 assert.ok(stronger.parts[0].issues.includes('multiple-substantial-pieces'));
});
test('actual pixel ownership keeps full overflowing piece and warns affected slot',()=>{
  const im=fill(blank(),3,5,17,3),r=runPrimary(im);
  assert.equal(r.ownership[0].primary,'a');
  assert.deepEqual(r.parts[0].proposedCrop,[3,5,17,3]);
  assert.ok(r.parts[0].issues.includes('substantial-crosses-slot'));
  assert.ok(r.parts[1].issues.includes('foreign-component-in-slot'));
  const c=locateSheet(im,sheet,coords).components[0];
  assert.equal(c.slotDistribution.reduce((n,s)=>n+s.nonzeroPixels,0)+r.ownership[0].outsidePixels,c.pixels);
  assert.equal(r.assemblyReady,false);
});
test('similar ownership, pixel/alpha disagreement, and mostly outside remain unresolved',()=>{
  assert.equal(runPrimary(fill(blank(),12,5,8,3)).ownership[0].primary,null);
  const im=fill(fill(blank(),3,5,17,3,1),17,5,3,3,255);
  assert.equal(runPrimary(im).ownership[0].primary,null);
  const tiny={id:'S',parts:[{assetId:'a',slotRect:[1,1,4,4]}]},large=fill(blank(),0,0,10,10);
  assert.equal(associateSheet(large,locateSheet(large,tiny,coords),primaryPolicy).ownership[0].primary,null);
  const missing=locateSheet(im,sheet,coords);delete missing.components[0].slotDistribution;
  assert.throws(()=>associateSheet(im,missing,primaryPolicy),/rerun/);
});
test('keeps tiny opaque decoration and nearby faint fragment; records distant alpha without deletion',()=>{
  const im=fill(fill(fill(fill(blank(),3,5,5,10),11,6,1,1),3,17,2,2,1),1,29,1,1,1),before=Buffer.from(im.pixels),r=run(im),p=r.parts[0];
  assert.equal(p.anchorComponentIds.length,2);assert.equal(p.attachedWeakComponentIds.length,1);
  assert.deepEqual(p.proposedCrop,[3,5,9,14]);assert.ok(p.issues.includes('multiple-substantial-pieces'));
  assert.equal(r.accounting.outsideNonzeroPixels,1);assert.equal(r.accounting.outsideAlphaSum,1);
  assert.equal(r.accounting.sourceAlphaSum,r.accounting.coveredAlphaSum+r.accounting.outsideAlphaSum);
  assert.deepEqual(im.pixels,before);assert.equal(r.assemblyReady,false);
});
test('does not follow chains of weak fragments or choose between shared anchors',()=>{
  const im=fill(fill(fill(blank(),3,5,3,3),7,5,1,1,1),10,5,1,1,1),r=run(im);
  assert.deepEqual(r.parts[0].proposedCrop,[3,5,5,3]);assert.equal(r.unresolvedWeak.length,1);
  const cross=run(fill(blank(),12,4,8,8));assert.ok(cross.parts.every(p=>p.proposedCrop===null));
  assert.equal(cross.unassignedSubstantialComponentIds.length,1);
});
test('low opacity artwork is unresolved rather than silently discarded or accepted',()=>{
  const r=run(fill(blank(),3,5,5,10,2));assert.equal(r.parts[0].proposedCrop,null);
  assert.equal(r.accounting.sourceAlphaSum,r.accounting.outsideAlphaSum);assert.equal(r.pixelsModified,false);
  assert.throws(()=>associateSheet(blank(),locateSheet(blank(),sheet,coords),{...policy,automaticAcceptance:true}),/policy/);
});
test('weak fragment near two groups stays unresolved, and scale preserves logical reach',()=>{
  const im=fill(fill(fill(blank(),10,5,3,4),19,5,3,4),15,5,2,1,1);
  const r=run(im);
  assert.ok(r.unresolvedWeak.some(c=>c.reason==='multiple-anchor-groups'));
  assert.equal(r.parts[0].attachedWeakComponentIds.length,0);
  assert.equal(r.parts[1].attachedWeakComponentIds.length,0);
  const small=fill(fill(blank(),3,5,3,4),7,5,1,1,1),large={width:64,height:64,pixels:Buffer.alloc(64*64*4)};
  for(let y=0;y<32;y++)for(let x=0;x<32;x++)fill(large,x*2,y*2,2,2,small.pixels[(y*32+x)*4+3]);
  const scaled=associateSheet(large,locateSheet(large,sheet,coords),policy);
  assert.deepEqual(scaled.parts[0].proposedCrop,run(small).parts[0].proposedCrop.map(n=>n*2));
});
