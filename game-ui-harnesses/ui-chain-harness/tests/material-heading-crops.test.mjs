import test from 'node:test';
import assert from 'node:assert/strict';
import geometry from '../configs/material-template.json' with {type:'json'};
import {materialHeadingCrops,completeHeadingCrop} from '../src/skins/material-heading-crops.mjs';

const blank=()=>({width:1024,height:1024,pixels:Buffer.alloc(1024*1024*4)});
function fill(image,[x,y,w,h],alpha=255){for(let yy=y;yy<y+h;yy++)for(let xx=x;xx<x+w;xx++)image.pixels.set([24,50,80,alpha],(yy*image.width+xx)*4);return image;}
const fixed=id=>geometry.parts.find(p=>p.assetId===id).bodyRect;
const title='material.title-band',section='material.section-band',tile='material.panel-fill';

test('complete separated heading contours preserve borders outside nominal bodies without expanding the tile sample',()=>{
 const image=blank(),titleRect=[56,86,912,166],sectionRect=[56,298,912,100];
 fill(image,titleRect);fill(image,sectionRect);fill(image,fixed(tile));fill(image,[70,944,1,75],1);
 const before=Buffer.from(image.pixels),crops=materialHeadingCrops(image,geometry);
 assert.deepEqual(completeHeadingCrop(fixed(title),crops.get(title)).crop,titleRect);
 assert.deepEqual(completeHeadingCrop(fixed(section),crops.get(section)).crop,sectionRect);
 assert.equal(crops.has(tile),false);assert.deepEqual(completeHeadingCrop(fixed(tile),crops.get(tile)),{crop:fixed(tile)});
 assert.deepEqual(image.pixels,before);
});

test('exact template body crops retain the previous shape without extra crop evidence',()=>{
 const image=blank();for(const part of geometry.parts)fill(image,part.bodyRect);
 const crops=materialHeadingCrops(image,geometry);
 for(const part of geometry.parts)assert.deepEqual(completeHeadingCrop(part.bodyRect,crops.get(part.assetId)),{crop:part.bodyRect});
});

test('disconnected substantial pieces or uncertain shared ownership never expand a heading crop',()=>{
 for(const extra of [[72,236,12,8],[72,50,12,8]]){
  const image=blank();for(const part of geometry.parts)fill(image,part.bodyRect);fill(image,extra);
  const crops=materialHeadingCrops(image,geometry);
  // The outside isolated decoration has no reliable slot identity; a second
  // opaque body in the heading slot makes that heading unresolved.
  assert.deepEqual(completeHeadingCrop(fixed(title),crops.get(title)).crop,fixed(title));
 }
 const image=blank();fill(image,[60,180,900,180]);fill(image,fixed(tile));
 assert.equal(materialHeadingCrops(image,geometry).size,0);
});
