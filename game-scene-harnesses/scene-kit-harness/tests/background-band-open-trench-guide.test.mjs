import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectPng} from '../src/png.mjs';
import {hash,imageRef,unseal} from '../src/generation/common.mjs';
import {backgroundBandOpenTrenchGuide,BACKGROUND_BAND_OPEN_TRENCH_GUIDE_PROFILE,
 BACKGROUND_BAND_OPEN_TRENCH_GUIDE_IMAGE_ROLE,BACKGROUND_BAND_OPEN_TRENCH_GUIDE_INSTRUCTION} from '../src/generation/background-band-open-trench-guide.mjs';
import {backgroundBandOpenDepthGuide} from '../src/generation/background-band-open-depth-guide.mjs';
import {backgroundBandCoverageGuide,BACKGROUND_BAND_COVERAGE_BUDGET as coverageBudget} from '../src/generation/background-band-coverage-guide.mjs';

const expected={
 valley:{aspect:{numerator:104,denominator:41},size:[1040,410],sha:'6741c5d6236f303230cee95a3507ff89b660292aaac6833a2f7b2dd19d5052c3',recipe:'2c033a60abf58d215bbaf0ca0bb76a97971318e8ecf7d39e29d2d09736762f99',bytes:5813}
};
const options=(role='valley',canvasAspect=expected.valley.aspect)=>({role,canvasAspect,coverageBudget});
const rejects=(fn,code)=>assert.throws(fn,e=>e.errors?.some(i=>i.code===code));
const alpha=(p,x,y)=>p.rgba[(y*p.width+x)*4+3];
function components(p,wantedAlpha){
 const visited=new Uint8Array(p.width*p.height),queue=new Int32Array(visited.length),groups=[];
 for(let seed=0;seed<visited.length;seed++){
  if(visited[seed]||p.rgba[seed*4+3]!==wantedAlpha)continue;
  let head=0,tail=0,minX=p.width,maxX=0,minY=p.height,maxY=0;const cuts={left:false,right:false,top:false,bottom:false};visited[seed]=1;queue[tail++]=seed;
  while(head<tail){const i=queue[head++],x=i%p.width,y=Math.floor(i/p.width);
   minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);
   if(x===0)cuts.left=true;if(x===p.width-1)cuts.right=true;if(y===0)cuts.top=true;if(y===p.height-1)cuts.bottom=true;
   for(const j of [x?i-1:-1,x+1<p.width?i+1:-1,y?i-p.width:-1,y+1<p.height?i+p.width:-1]){
    if(j<0||visited[j]||p.rgba[j*4+3]!==wantedAlpha)continue;visited[j]=1;queue[tail++]=j;
   }
  }
  groups.push({pixelCount:tail,width:maxX-minX+1,height:maxY-minY+1,cuts});
 }
 return groups;
}

test('trench subtype pins exact aspect/role/PNG/recipe while prior open-depth and solid coverage examples stay unchanged',()=>{
 for(const [role,e]of Object.entries(expected)){
  const g=backgroundBandOpenTrenchGuide(options(role,e.aspect)),p=inspectPng(g.bytes,{includePixels:true});
  assert.equal(g.profile,BACKGROUND_BAND_OPEN_TRENCH_GUIDE_PROFILE);assert.equal(g.role,role);
  assert.equal(g.recipe.imageRole,BACKGROUND_BAND_OPEN_TRENCH_GUIDE_IMAGE_ROLE);assert.equal(g.recipe.alpha,'transparent');assert.equal(g.recipe.surround,'none');
  assert.equal(hash(g.bytes),e.sha);assert.equal(g.bytes.length,e.bytes);assert.equal(g.recipe.sha256,e.recipe);assert.deepEqual(g.artifact,imageRef(g.bytes));
  assert.deepEqual([p.width,p.height],e.size);assert.equal(p.width*e.aspect.denominator,p.height*e.aspect.numerator);
  assert.deepEqual(g.recipe.canvasAspect,e.aspect);assert.deepEqual(g.recipe.coverageBudget,coverageBudget);
  const again=backgroundBandOpenTrenchGuide(options(role,e.aspect));assert.deepEqual(again.bytes,g.bytes);assert.notStrictEqual(again.bytes,g.bytes);
 }
 assert.equal(hash(backgroundBandOpenDepthGuide(options('backdrop',{numerator:26,denominator:11})).bytes),'eed8983043e5d58e00d948eadf4a0c331278856160fcab0e10d42c0f859721c7');
 assert.equal(backgroundBandOpenDepthGuide(options('backdrop',{numerator:26,denominator:11})).recipe.sha256,'c0591b8e097fd891189f0839701a20c55bc2bb17d9636a5b7f53cffc7e26bf19');
 assert.equal(hash(backgroundBandOpenDepthGuide(options('valley',expected.valley.aspect)).bytes),'7e9ebdb3b095125f96f7e3544c7afa8643ec9f46798b4301d6142cafdc445a69');
 assert.equal(hash(backgroundBandCoverageGuide(options('backdrop',{numerator:26,denominator:11})).bytes),'3caefd7ef9783b26191bef4997e765d3c5544dfcc8586a3eae4b6622a3a286c0');
});

test('all true transparent space is connected from top through center to bottom, with no enclosed hole or bridge',()=>{
 for(const [role,e]of Object.entries(expected)){
  const g=backgroundBandOpenTrenchGuide(options(role,e.aspect)),p=inspectPng(g.bytes,{includePixels:true}),empty=components(p,0),paint=components(p,255);
  assert.equal(empty.length,1,'no disconnected enclosed holes of any shape');
  assert(empty[0].cuts.top&&empty[0].cuts.bottom&&empty[0].cuts.left&&empty[0].cuts.right);
  for(let y=0;y<p.height;y++)assert.equal(alpha(p,Math.floor(p.width/2),y),0,'the entire middle depth corridor stays open');
  assert(paint.length>=2,'the example separates material around the trench');
  for(const group of paint){
   assert(group.cuts.left!==group.cuts.right,'no material bridge joins across the void');assert(group.cuts.bottom,'no independent floating upright fragment');
   assert(group.width>=p.width*.30,'no isolated thin column');assert(group.pixelCount>=p.width*p.height*.25,'the material is broad body, not a stick or ring');
  }
  for(let y=Math.ceil(p.height*.15);y<p.height;y++){
   let left=0,right=0;while(left<p.width&&alpha(p,left,y)===255)left++;while(right<p.width&&alpha(p,p.width-1-right,y)===255)right++;
   assert(left>=p.width*.25&&right>=p.width*.25,'both side bodies remain broad through their height');
   assert(p.width-left-right>=p.width*.18,'the central open trench is a broad passage');
  }
 }
});

test('native paint reaches lateral/lower finite cuts while top is empty and no lower floor or opaque surround exists',()=>{
 for(const [role,e]of Object.entries(expected)){
  const g=backgroundBandOpenTrenchGuide(options(role,e.aspect)),p=inspectPng(g.bytes,{includePixels:true});let first=p.height;
  for(let y=0;y<p.height;y++){
   let painted=0;
   for(let x=0;x<p.width;x++){
    const pixel=[...p.rgba.subarray((y*p.width+x)*4,(y*p.width+x+1)*4)];
    if(pixel[3]===0)assert.deepEqual(pixel,[0,0,0,0]);else{assert.deepEqual(pixel,[136,136,136,255]);first=Math.min(first,y);painted++;}
    if(y<2)assert.equal(pixel[3],0);
   }
   assert(painted<p.width,'there is no full-width top wave or lower fill');
  }
  assert(first>=Math.floor(.04*p.height)&&first<=Math.ceil(.12*p.height));
  assert.equal(alpha(p,0,p.height-1),255);assert.equal(alpha(p,p.width-1,p.height-1),255);assert.equal(alpha(p,Math.floor(p.width/2),p.height-1),0);
  assert.deepEqual(g.recipe.finiteCuts,['left','right','bottom']);assert.equal(g.recipe.sideBottomBlankFramePixels,0);
  assert(g.recipe.openings.includes('no-enclosed-holes'));assert(g.recipe.silhouetteLanguage.includes('no-independent-slender-columns'));
 }
});

test('bounded exact inputs and immutable recipes prevent caller drawings or changed future bytes',()=>{
 for(const a of [{numerator:0,denominator:1},{numerator:1,denominator:0},{numerator:1,denominator:2},{numerator:9,denominator:1},
  {numerator:1041,denominator:500},{numerator:Infinity,denominator:1}])rejects(()=>backgroundBandOpenTrenchGuide(options('valley',a)),'BACKGROUND_BAND_OPEN_TRENCH_GUIDE_ASPECT');
 for(const mutate of [b=>b.upperContourPercent.min=5,b=>b.majorFeatureWidthPercent.max=40,b=>b.profile='external']){
  const b=structuredClone(coverageBudget);mutate(b);rejects(()=>backgroundBandOpenTrenchGuide({...options(),coverageBudget:b}),'BACKGROUND_BAND_OPEN_TRENCH_GUIDE_BUDGET');
 }
 rejects(()=>backgroundBandOpenTrenchGuide(options('foreground')),'BACKGROUND_BAND_OPEN_TRENCH_GUIDE_ROLE');
 rejects(()=>backgroundBandOpenTrenchGuide(options('backdrop')),'BACKGROUND_BAND_OPEN_TRENCH_GUIDE_ROLE');
 assert.throws(()=>backgroundBandOpenTrenchGuide({...options(),geometry:[]}));assert.throws(()=>backgroundBandOpenTrenchGuide(options(),{}));
 const equivalent=backgroundBandOpenTrenchGuide(options('valley',{numerator:208,denominator:82}));
 assert.equal(hash(equivalent.bytes),expected.valley.sha);assert.notEqual(equivalent.recipe.sha256,expected.valley.recipe);
 const extreme=backgroundBandOpenTrenchGuide(options('valley',{numerator:521,denominator:66}));assert(extreme.artifact.pixelSize.height>=128);assert(extreme.artifact.pixelSize.width<=2048);
 assert.equal(extreme.artifact.pixelSize.width*66,extreme.artifact.pixelSize.height*521);
 const input=structuredClone(options()),g=backgroundBandOpenTrenchGuide(input);assert(!Object.isFrozen(input.canvasAspect));assert(!Object.isFrozen(input.coverageBudget));
 input.canvasAspect.numerator=999;input.coverageBudget.majorFeatureWidthPercent.max=99;
 assert.deepEqual(g.recipe.canvasAspect,expected.valley.aspect);assert.equal(g.recipe.coverageBudget.majorFeatureWidthPercent.max,32);
 assert.throws(()=>{g.recipe.exampleNormalizedGeometry.masses[0][0][0]=99;},TypeError);
 g.bytes.fill(0);assert.equal(hash(backgroundBandOpenTrenchGuide(options()).bytes),expected.valley.sha);
});

test('instructions own only open topology/aspect/soft scale and explicitly reject subject count, architecture and pixel locking',()=>{
 const r=unseal(backgroundBandOpenTrenchGuide(options()).recipe);
 assert.equal(r.instruction,BACKGROUND_BAND_OPEN_TRENCH_GUIDE_INSTRUCTION);assert.match(r.instruction,/OPEN TRENCH topology example/);
 assert.match(r.instruction,/explicitly selected subtype.*rear-depth valley/);assert.match(r.instruction,/not a default for distant backdrops/);
 assert.match(r.instruction,/does not require two subjects/);assert.match(r.instruction,/not a complete scene layout/);
 assert.match(r.instruction,/no.*enclosed hole, round opening or isolated narrow upright mark/);
 assert.match(r.instruction,/Do not turn.*freestanding thin columns/);assert.match(r.instruction,/Input 1 remains the complete accepted reference/);
 assert.match(r.instruction,/genuinely transparent/);assert.match(r.instruction,/does not|do not|Do not/);
 assert.equal(r.normalizedBudgetRequired,true);assert.equal(r.maximumNewImageCalls,0);assert.equal(r.sourceInputs,0);
 assert.equal(r.sourcePngModified,false);assert.equal(r.sourceArtAcceptance,'not-granted');assert.equal(r.finalArtwork,false);
 assert(!/(?:https?:\/\/|[a-z]:[\\/]|\bprovider\b|\bendpoint\b)/i.test(JSON.stringify(r)));
});
