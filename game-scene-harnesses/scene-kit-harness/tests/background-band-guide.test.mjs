import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectPng} from '../src/png.mjs';
import {hash,imageRef,unseal} from '../src/generation/common.mjs';
import {BACKGROUND_BAND_GUIDE_PROFILE as profile,BACKGROUND_BAND_GUIDE_IMAGE_ROLE,
  BACKGROUND_BAND_GUIDE_INSTRUCTION,backgroundBandGuide} from '../src/generation/background-band-guide.mjs';

const expected={
  backdrop:{sha256:'7951627c6abc4e56ca751eac0fef1b663a694e3dfae562cc5c22be72e3332797',byteLength:3792,top:32,
    recipeSha256:'7350b9455573c8b6419d7bb4812e724c1f93604872ec65b2aaf8249c2058d65e'},
  valley:{sha256:'78f2d6b0b6e790a6dae945a538790fb3aa67025c8dbee969ddb8784010068b08',byteLength:3863,top:56,
    recipeSha256:'da7872a5060f7ec3bfe502ea524a05b1148aebd4b59b9e61f32c42b69f9e2863'},
};
const invalid=fn=>assert.throws(fn,e=>e.errors?.some(x=>x.code==='BACKGROUND_BAND_GUIDE_PROFILE'));

test('each fixed role has canonical independent opaque neutral PNG bytes and a frozen recipe',()=>{
  for(const role of ['backdrop','valley']){
    const a=backgroundBandGuide(profile,role),b=backgroundBandGuide(profile,role),p=inspectPng(a.bytes,{includePixels:true,pixelStats:true});
    assert.equal(a.profile,profile);assert.equal(a.role,role);assert.equal(a.recipe.imageRole,BACKGROUND_BAND_GUIDE_IMAGE_ROLE);
    assert.equal(hash(a.bytes),expected[role].sha256);assert.equal(a.bytes.length,expected[role].byteLength);
    assert.equal(a.recipe.sha256,expected[role].recipeSha256);assert.deepEqual(a.artifact,imageRef(a.bytes));
    assert.deepEqual(a.bytes,b.bytes);assert.notStrictEqual(a.bytes,b.bytes);
    assert.deepEqual({width:p.width,height:p.height,transparentPixels:p.transparentPixels},{width:1024,height:512,transparentPixels:0});
    const values=new Set();for(let i=0;i<p.rgba.length;i+=4){const[r,g,b,alpha]=p.rgba.subarray(i,i+4);assert.equal(r,g);assert.equal(g,b);assert.equal(alpha,255);values.add(r);}
    assert.deepEqual([...values].sort((a,b)=>a-b),[136,232],'no colored theme, markings, grid, lights or textured surface');
  }
});

test('the body continues from its upper contour through every column to the finite side and bottom cuts',()=>{
  for(const role of ['backdrop','valley']){
    const guide=backgroundBandGuide(profile,role),p=inspectPng(guide.bytes,{includePixels:true}),at=(x,y)=>p.rgba[(y*p.width+x)*4],tops=[];
    let area=0;
    for(let y=0;y<512;y++)for(let x=0;x<1024;x++){
      const body=at(x,y)===136;
      if(x<16||x>=1008||y<16||y>=496)assert(!body,'all 16 technical frame pixels remain blank display surround');
      if(body)area++;
    }
    for(let x=16;x<1008;x++){
      const top=Array.from({length:496},(_,y)=>y).find(y=>at(x,y)===136);assert.notEqual(top,undefined);tops.push(top);
      for(let y=top;y<496;y++)assert.equal(at(x,y),136,'no closed mountain foot, hole or fade before the bottom cut');
      assert.equal(at(x,496),232,'the finite lower cut is straight at the technical frame, not a wavy natural closure');
    }
    assert.equal(Math.min(...tops),expected[role].top);assert(Math.max(...tops)<112,'upper contour remains in the upper part');
    assert(Math.max(...tops)-Math.min(...tops)>20,'upper contour is natural and non-flat');assert(area/(1024*512)>.72);
    for(let y=Math.max(...tops);y<496;y++){assert.equal(at(16,y),136);assert.equal(at(1007,y),136);}
  }
});

test('only the named roles/profile are selectable and the example grants no palette, output surround, art or compute',()=>{
  for(const bad of [undefined,null,0,true,{},[],'sky','foreground','mountains','toString','__proto__'])invalid(()=>backgroundBandGuide(profile,bad));
  invalid(()=>backgroundBandGuide('three-edge-continuation-v2','backdrop'));
  invalid(()=>backgroundBandGuide(profile,'valley',{gray:20}));invalid(()=>backgroundBandGuide());
  const g=backgroundBandGuide(profile,'backdrop'),recipe=unseal(g.recipe);
  assert.equal(recipe.maximumNewImageCalls,0);assert.equal(recipe.sourceInputs,0);assert.equal(recipe.sourcePngModified,false);
  assert.equal(recipe.finalArtwork,false);assert.equal(recipe.sourceArtAcceptance,'not-granted');
  assert.equal(recipe.instruction,BACKGROUND_BAND_GUIDE_INSTRUCTION);
  assert.match(recipe.instruction,/technical display space ONLY, never the output background/);
  assert.match(recipe.instruction,/genuine transparent sky/);assert.match(recipe.instruction,/Input 1 remains the complete accepted reference/);
  assert.match(recipe.instruction,/not mountains, trees, buildings, rocks/);assert.match(recipe.instruction,/does not certify camera coverage/);
  assert(!/(?:https?:\/\/|[a-z]:[\\/]|\bprovider\b|\bendpoint\b)/i.test(JSON.stringify(recipe)));
  g.bytes.fill(0);g.artifact.sha256='0'.repeat(64);
  assert.throws(()=>{g.recipe.upperContour[0][0]=0;},TypeError);
  const fresh=backgroundBandGuide(profile,'backdrop');assert.equal(hash(fresh.bytes),expected.backdrop.sha256);assert.equal(fresh.artifact.sha256,expected.backdrop.sha256);
});
