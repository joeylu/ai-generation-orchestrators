import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectPng} from '../src/png.mjs';
import {hash,imageRef,unseal} from '../src/generation/common.mjs';
import {backgroundBandOpenDepthGuide,BACKGROUND_BAND_OPEN_DEPTH_GUIDE_PROFILE,
 BACKGROUND_BAND_OPEN_DEPTH_GUIDE_IMAGE_ROLE,BACKGROUND_BAND_OPEN_DEPTH_GUIDE_INSTRUCTION} from '../src/generation/background-band-open-depth-guide.mjs';
import {backgroundBandCoverageGuide,BACKGROUND_BAND_COVERAGE_BUDGET as coverageBudget} from '../src/generation/background-band-coverage-guide.mjs';

const expected={
 backdrop:{aspect:{numerator:26,denominator:11},size:[1040,440],sha:'eed8983043e5d58e00d948eadf4a0c331278856160fcab0e10d42c0f859721c7',recipe:'c0591b8e097fd891189f0839701a20c55bc2bb17d9636a5b7f53cffc7e26bf19',bytes:10137},
 valley:{aspect:{numerator:104,denominator:41},size:[1040,410],sha:'7e9ebdb3b095125f96f7e3544c7afa8643ec9f46798b4301d6142cafdc445a69',recipe:'77ec3bdf263ed55f6e64dfb8989704fe25c696b1f319c51216fe170d20035674',bytes:9462}
};
const options=(role='backdrop',canvasAspect=expected.backdrop.aspect)=>({role,canvasAspect,coverageBudget});
const rejects=(fn,code)=>assert.throws(fn,e=>e.errors?.some(i=>i.code===code));
const rgbaAt=(p,x,y)=>p.rgba.subarray((y*p.width+x)*4,(y*p.width+x+1)*4);
function transparentFlood(p,x,y){
 const seen=new Uint8Array(p.width*p.height),queue=new Int32Array(seen.length),seed=y*p.width+x;let head=0,tail=0;
 assert.equal(p.rgba[seed*4+3],0);seen[seed]=1;queue[tail++]=seed;
 while(head<tail){
  const i=queue[head++],xx=i%p.width,yy=Math.floor(i/p.width);
  for(const j of [xx?i-1:-1,xx+1<p.width?i+1:-1,yy?i-p.width:-1,yy+1<p.height?i+p.width:-1]){
   if(j<0||seen[j]||p.rgba[j*4+3]!==0)continue;seen[j]=1;queue[tail++]=j;
  }
 }
 return {seen,pixelCount:tail};
}

test('open-depth guide binds real aspect, role and canonical transparent PNG/recipe without changing v3 examples',()=>{
 for(const [role,e]of Object.entries(expected)){
  const g=backgroundBandOpenDepthGuide(options(role,e.aspect)),p=inspectPng(g.bytes,{includePixels:true});
  assert.equal(g.profile,BACKGROUND_BAND_OPEN_DEPTH_GUIDE_PROFILE);assert.equal(g.role,role);
  assert.equal(g.recipe.imageRole,BACKGROUND_BAND_OPEN_DEPTH_GUIDE_IMAGE_ROLE);assert.equal(g.recipe.alpha,'transparent');
  assert.equal(g.recipe.surround,'none');assert.equal(hash(g.bytes),e.sha);assert.equal(g.bytes.length,e.bytes);assert.equal(g.recipe.sha256,e.recipe);
  assert.deepEqual(g.artifact,imageRef(g.bytes));assert.deepEqual([p.width,p.height],e.size);
  assert.equal(p.width*e.aspect.denominator,p.height*e.aspect.numerator);assert.deepEqual(g.recipe.canvasAspect,e.aspect);
  assert.deepEqual(g.recipe.coverageBudget,coverageBudget);assert.equal(g.recipe.maximumNewImageCalls,0);
  const again=backgroundBandOpenDepthGuide(options(role,e.aspect));assert.deepEqual(again.bytes,g.bytes);assert.notStrictEqual(again.bytes,g.bytes);
 }
 const equivalent=backgroundBandOpenDepthGuide(options('backdrop',{numerator:52,denominator:22}));
 assert.equal(hash(equivalent.bytes),expected.backdrop.sha);assert.notEqual(equivalent.recipe.sha256,expected.backdrop.recipe);
 assert.equal(hash(backgroundBandCoverageGuide(options()).bytes),'3caefd7ef9783b26191bef4997e765d3c5544dfcc8586a3eae4b6622a3a286c0');
 assert.equal(backgroundBandCoverageGuide(options()).recipe.sha256,'f23fd6d2d064b410683bbaec1757fd838bcc6dfdef281c75c5c913a1dba33745');
 assert.equal(hash(backgroundBandCoverageGuide(options('valley',expected.valley.aspect)).bytes),'7777246bd25b27bd9f65137a48d0f0f25499e190d3082a5a2b02a7a1611812ef');
});

test('upper, middle and broad lower transparent passages are actually connected, with independent real holes',()=>{
 for(const [role,e]of Object.entries(expected)){
  const g=backgroundBandOpenDepthGuide(options(role,e.aspect)),p=inspectPng(g.bytes,{includePixels:true}),point=(x,y)=>[Math.floor(x*p.width/100),Math.floor(y*p.height/100)],
   flood=transparentFlood(p,Math.floor(.60*p.width),p.height-1);
  for(const [x,y]of [[60,99],[60,75],[65,50],[69,30],[50,75],[32,50],[50,1],[1,1]]){
   const [xx,yy]=point(x,y);assert.equal(flood.seen[yy*p.width+xx],1,role+': the declared void must connect to the lower opening');
  }
  for(const h of g.recipe.exampleNormalizedGeometry.holes){
   const [xx,yy]=point(h.x,h.y);assert.equal(rgbaAt(p,xx,yy)[3],0,'hole center is actual transparency');
   assert.equal(flood.seen[yy*p.width+xx],0,'closed local hole is separate from the outside passage');
  }
  let transparent=0;
  for(let i=0;i<p.rgba.length;i+=4)if(p.rgba[i+3]===0)transparent++;
  assert(flood.pixelCount>transparent*.85,'the main void is broadly connected, not a few isolated holes');
  assert(g.recipe.bodyTopology.includes('connected-transparent-voids'));
  assert.equal(g.recipe.openings,'real-alpha-zero-voids-may-connect-through-cuts');
 }
});

test('finite cuts contain both native paint and genuine empty space while every row avoids a full-width fill',()=>{
 for(const [role,e]of Object.entries(expected)){
  const g=backgroundBandOpenDepthGuide(options(role,e.aspect)),p=inspectPng(g.bytes,{includePixels:true});
  let firstPaint=p.height;
  for(let y=0;y<p.height;y++){
   let painted=0;
   for(let x=0;x<p.width;x++){
    const pixel=rgbaAt(p,x,y);
    if(pixel[3]===0)assert.deepEqual([...pixel],[0,0,0,0]);
    else{assert.deepEqual([...pixel],[136,136,136,255]);painted++;firstPaint=Math.min(firstPaint,y);}
    if(y<2)assert.equal(pixel[3],0,'top two native rows stay transparent');
   }
   assert(painted<p.width,'no full-width upper wave or lower backing sheet');
  }
  assert(firstPaint>=Math.floor(.04*p.height)&&firstPaint<=Math.ceil(.12*p.height));
  const cutAlphas=[
   Array.from({length:p.height},(_,y)=>rgbaAt(p,0,y)[3]),
   Array.from({length:p.height},(_,y)=>rgbaAt(p,p.width-1,y)[3]),
   Array.from({length:p.width},(_,x)=>rgbaAt(p,x,p.height-1)[3])
  ];
  for(const cut of cutAlphas){assert(cut.includes(255),'material actually reaches each finite cut');assert(cut.includes(0),'a transparent void may reach a finite cut');}
  const lowerEmpty=cutAlphas[2].filter(a=>a===0).length/p.width;assert(lowerEmpty>.35&&lowerEmpty<.70,'the lower opening is genuinely broad');
  assert.deepEqual(g.recipe.finiteCuts,['left','right','bottom']);assert.equal(g.recipe.sideBottomBlankFramePixels,0);
 }
});

test('exact bounded inputs refuse custom drawings and mutation cannot alter future canonical bytes',()=>{
 for(const a of [{numerator:0,denominator:1},{numerator:1,denominator:0},{numerator:1,denominator:2},{numerator:9,denominator:1},
  {numerator:1041,denominator:500},{numerator:Infinity,denominator:1}])rejects(()=>backgroundBandOpenDepthGuide(options('backdrop',a)),'BACKGROUND_BAND_OPEN_DEPTH_GUIDE_ASPECT');
 for(const mutate of [b=>b.upperContourPercent.min=5,b=>b.majorFeatureWidthPercent.max=40,b=>b.profile='external']){
  const b=structuredClone(coverageBudget);mutate(b);rejects(()=>backgroundBandOpenDepthGuide({...options(),coverageBudget:b}),'BACKGROUND_BAND_OPEN_DEPTH_GUIDE_BUDGET');
 }
 rejects(()=>backgroundBandOpenDepthGuide(options('foreground')),'BACKGROUND_BAND_OPEN_DEPTH_GUIDE_ROLE');
 assert.throws(()=>backgroundBandOpenDepthGuide({...options(),path:'custom.png'}));assert.throws(()=>backgroundBandOpenDepthGuide(options(),{}));
 const extreme=backgroundBandOpenDepthGuide(options('valley',{numerator:521,denominator:66}));
 assert(extreme.artifact.pixelSize.height>=128);assert(extreme.artifact.pixelSize.width<=2048);
 assert.equal(extreme.artifact.pixelSize.width*66,extreme.artifact.pixelSize.height*521);
 const input=structuredClone(options()),g=backgroundBandOpenDepthGuide(input);assert(!Object.isFrozen(input.canvasAspect));assert(!Object.isFrozen(input.coverageBudget));
 input.canvasAspect.numerator=123;input.coverageBudget.upperContourPercent.min=99;
 assert.deepEqual(g.recipe.canvasAspect,expected.backdrop.aspect);assert.equal(g.recipe.coverageBudget.upperContourPercent.min,4);
 assert.throws(()=>{g.recipe.exampleNormalizedGeometry.masses[0][0][0]=99;},TypeError);
 g.bytes.fill(0);assert.equal(hash(backgroundBandOpenDepthGuide(options()).bytes),expected.backdrop.sha);
});

test('instructions constrain transparency topology while leaving subject, count, layout and art to the reference and source brief',()=>{
 const r=unseal(backgroundBandOpenDepthGuide(options()).recipe);
 assert.equal(r.instruction,BACKGROUND_BAND_OPEN_DEPTH_GUIDE_INSTRUCTION);
 assert.match(r.instruction,/genuinely transparent/);assert.match(r.instruction,/NO opaque display surround/);
 assert.match(r.instruction,/real void reaches a cut/);assert.match(r.instruction,/No rule requires paint in all lower columns/);
 assert.match(r.instruction,/Do not trace.*number of marks/);assert.match(r.instruction,/Input 1 remains the complete accepted reference/);
 assert.match(r.instruction,/subject arrangement or pixel coordinates/);assert.equal(r.normalizedBudgetRequired,true);
 assert.equal(r.sourcePngModified,false);assert.equal(r.sourceArtAcceptance,'not-granted');assert.equal(r.finalArtwork,false);assert.equal(r.sourceInputs,0);
 assert(!/(?:https?:\/\/|[a-z]:[\\/]|\bprovider\b|\bendpoint\b)/i.test(JSON.stringify(r)));
});
