import test from 'node:test';
import assert from 'node:assert/strict';
import {locateSheet} from '../src/skins/locate.mjs';
import {associateSheet} from '../src/skins/associate.mjs';
import {assertSeparatedCrops} from '../src/skins/proposal-crops.mjs';
const policy={version:'1.0',weakComponentMaxAlpha:4,attachmentGapLogicalPixels:4,automaticAcceptance:false,primaryOwnership:{minimumPixelFraction:.6,minimumAlphaFraction:.6,maximumOtherSlotFraction:.2}};
const sheet={id:'S01',parts:[{assetId:'surface.popup',slotRect:[0,0,32,30]},{assetId:'surface.bar',slotRect:[0,34,32,30]}]};
function fill(image,x,y,w,h,alpha=255){for(let yy=y;yy<y+h;yy++)for(let xx=x;xx<x+w;xx++)image.pixels[(yy*image.width+xx)*4+3]=alpha;return image;}
function fixture(){
  const image={width:32,height:64,pixels:Buffer.alloc(32*64*4)};
  fill(image,4,6,24,16);fill(image,4,40,24,16);
  // Attached alpha-1 fringe enters the other slot without touching its artwork.
  fill(image,18,28,1,12,1);
  const before=Buffer.from(image.pixels),location=locateSheet(image,sheet,{width:32,height:64});
  return {image,before,association:associateSheet(image,location,policy)};
}
test('attached near-transparent fringe crossing a neighboring slot does not block separate crops',()=>{
  const {image,before,association}=fixture(),[popup,bar]=association.parts;
  assert.ok(popup.issues.includes('foreign-component-in-slot'));
  assert.ok(bar.issues.includes('proposal-crosses-slot'));
  assert.deepEqual(popup.proposedCrop,[4,6,24,16]);assert.deepEqual(bar.proposedCrop,[4,28,24,28]);
  assert.doesNotThrow(()=>assertSeparatedCrops(association.parts));
  assert.deepEqual(image.pixels,before);assert.equal(association.pixelsModified,false);
  assert.equal(association.assemblyReady,false);assert.equal(association.semanticIdentity,'not-verified');
  assert.equal(association.accounting.coveredAlphaSum,association.accounting.sourceAlphaSum);
});
test('actual overlap is rejected even if the caller omits its warning',()=>{
  const {association}=fixture();association.parts[0].proposedCrop=[4,6,24,30];
  assert.throws(()=>assertSeparatedCrops(association.parts),{code:'metadata.overlap: surface.popup'});
});
test('unresolved ownership and missing or multiple bodies still require inspection',()=>{
  for(const issue of ['shared-substantial-component','multiple-substantial-pieces','no-substantial-anchor']){
    const {association}=fixture();association.parts[0].issues=[issue];
    assert.throws(()=>assertSeparatedCrops(association.parts),{code:'metadata.proposal-unresolved: surface.popup'});
  }
  for(const change of [p=>p.proposedCrop=null,p=>p.conflictComponentIds=[1]]){
    const {association}=fixture();change(association.parts[0]);
    assert.throws(()=>assertSeparatedCrops(association.parts),/proposal-unresolved/);
  }
});
test('touching crop edges remain separate under half-open pixel coordinates',()=>{
  const {association}=fixture();association.parts[0].proposedCrop=[4,6,24,22];
  assert.doesNotThrow(()=>assertSeparatedCrops(association.parts));
});
