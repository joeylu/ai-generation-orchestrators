import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectPng} from '../src/png.mjs';
import {hash,unseal,imageRef} from '../src/generation/common.mjs';
import {backgroundBandCoverageGuide,BACKGROUND_BAND_COVERAGE_BUDGET as coverageBudget,
  BACKGROUND_BAND_COVERAGE_GUIDE_PROFILE,BACKGROUND_BAND_COVERAGE_GUIDE_IMAGE_ROLE,
  BACKGROUND_BAND_COVERAGE_GUIDE_INSTRUCTION} from '../src/generation/background-band-coverage-guide.mjs';
import {backgroundBandGuide,BACKGROUND_BAND_GUIDE_PROFILE} from '../src/generation/background-band-guide.mjs';

const options=(role='backdrop',canvasAspect={numerator:26,denominator:11})=>({role,canvasAspect,coverageBudget});
const expected={
  backdrop:{aspect:{numerator:26,denominator:11},size:[1040,440],sha:'3caefd7ef9783b26191bef4997e765d3c5544dfcc8586a3eae4b6622a3a286c0',
    recipe:'f23fd6d2d064b410683bbaec1757fd838bcc6dfdef281c75c5c913a1dba33745',bytes:3514},
  valley:{aspect:{numerator:104,denominator:41},size:[1040,410],sha:'7777246bd25b27bd9f65137a48d0f0f25499e190d3082a5a2b02a7a1611812ef',
    recipe:'28f793d22ae7e92d8ea49273e9b8657d59fe4c53e7af50d5f809c972f13e5c6a',bytes:3289},
};
const rejects=(fn,code)=>assert.throws(fn,e=>e.errors?.some(i=>i.code===code));

test('coverage guide fingerprints bind its declared aspect, fixed budget and role, while old guides stay unchanged',()=>{
  for(const[role,e]of Object.entries(expected)){
    const g=backgroundBandCoverageGuide(options(role,e.aspect)),p=inspectPng(g.bytes,{includePixels:true,pixelStats:true});
    assert.equal(g.profile,BACKGROUND_BAND_COVERAGE_GUIDE_PROFILE);assert.equal(g.role,role);assert.equal(g.recipe.imageRole,BACKGROUND_BAND_COVERAGE_GUIDE_IMAGE_ROLE);
    assert.equal(hash(g.bytes),e.sha);assert.equal(g.bytes.length,e.bytes);assert.equal(g.recipe.sha256,e.recipe);assert.deepEqual(g.artifact,imageRef(g.bytes));
    assert.deepEqual([p.width,p.height],e.size);assert.equal(p.width*e.aspect.denominator,p.height*e.aspect.numerator);
    assert.deepEqual(g.recipe.canvasAspect,e.aspect);assert.deepEqual(g.recipe.coverageBudget,coverageBudget);
    const fresh=backgroundBandCoverageGuide(options(role,e.aspect));assert.deepEqual(fresh.bytes,g.bytes);assert.notStrictEqual(fresh.bytes,g.bytes);
  }
  const equivalent=backgroundBandCoverageGuide(options('backdrop',{numerator:52,denominator:22}));
  assert.equal(hash(equivalent.bytes),expected.backdrop.sha);assert.notEqual(equivalent.recipe.sha256,expected.backdrop.recipe,'recipe also binds the exact declared rational');
  assert.equal(hash(backgroundBandGuide(BACKGROUND_BAND_GUIDE_PROFILE,'backdrop').bytes),'7951627c6abc4e56ca751eac0fef1b663a694e3dfae562cc5c22be72e3332797');
  assert.equal(hash(backgroundBandGuide(BACKGROUND_BAND_GUIDE_PROFILE,'valley').bytes),'78f2d6b0b6e790a6dae945a538790fb3aa67025c8dbee969ddb8784010068b08');
});

test('natural upper profile stays in the budget, dominant waves have soft relative scale, and all three cuts contain uninterrupted body',()=>{
  for(const[role,e]of Object.entries(expected)){
    const g=backgroundBandCoverageGuide(options(role,e.aspect)),p=inspectPng(g.bytes,{includePixels:true}),at=(x,y)=>p.rgba[(y*p.width+x)*4],tops=[];
    const shades=new Set();
    for(let i=0;i<p.rgba.length;i+=4){assert.equal(p.rgba[i],p.rgba[i+1]);assert.equal(p.rgba[i],p.rgba[i+2]);assert.equal(p.rgba[i+3],255);shades.add(p.rgba[i]);}
    assert.deepEqual([...shades].sort((a,b)=>a-b),[136,232]);
    for(let x=0;x<p.width;x++){
      let top=0;while(top<p.height&&at(x,top)!==136)top++;tops.push(top);
      assert(top>=Math.floor(.04*p.height)&&top<=Math.ceil(.12*p.height));
      for(let y=top;y<p.height;y++)assert.equal(at(x,y),136,'no empty lower foot or inset side/bottom surround');
      assert.equal(at(x,0),232);assert.equal(at(x,p.height-1),136);
    }
    const plateaus=[];
    for(let i=0;i<tops.length;){let end=i+1;while(end<tops.length&&tops[end]===tops[i])end++;
      if(i>0&&end<tops.length&&tops[i]<tops[i-1]&&tops[i]<tops[end])plateaus.push((i+end-1)/2);i=end;}
    assert(plateaus.length>=2,'the example demonstrates frequency rather than a single enlarged central mass');
    for(let i=1;i<plateaus.length;i++){const relative=(plateaus[i]-plateaus[i-1])/p.width;assert(relative>=.20&&relative<=.34,'soft22–32percent major scale with raster tolerance');}
    assert.equal(g.recipe.sideBottomBlankFramePixels,0);assert.deepEqual(g.recipe.finiteCuts,['left','right','bottom']);
  }
});

test('aspect/budget/role are bounded exact data and callers cannot supply custom guides or alter future output',()=>{
  for(const a of [{numerator:0,denominator:1},{numerator:1,denominator:0},{numerator:1,denominator:2},{numerator:9,denominator:1},
    {numerator:1041,denominator:500},{numerator:Infinity,denominator:1}])rejects(()=>backgroundBandCoverageGuide(options('backdrop',a)),'BACKGROUND_BAND_COVERAGE_GUIDE_ASPECT');
  for(const mutate of [b=>b.upperContourPercent.min=5,b=>b.majorFeatureWidthPercent.max=40,b=>b.profile='external']){
    const b=structuredClone(coverageBudget);mutate(b);rejects(()=>backgroundBandCoverageGuide({...options(),coverageBudget:b}),'BACKGROUND_BAND_COVERAGE_GUIDE_BUDGET');
  }
  rejects(()=>backgroundBandCoverageGuide(options('foreground')),'BACKGROUND_BAND_COVERAGE_GUIDE_ROLE');
  assert.throws(()=>backgroundBandCoverageGuide({...options(),path:'external.png'}));assert.throws(()=>backgroundBandCoverageGuide(options(),{}));
  const extreme=backgroundBandCoverageGuide(options('valley',{numerator:521,denominator:66}));
  assert(extreme.artifact.pixelSize.height>=128);assert(extreme.artifact.pixelSize.width<=2048);
  assert.equal(extreme.artifact.pixelSize.width*66,extreme.artifact.pixelSize.height*521);
  const input=structuredClone(options()),g=backgroundBandCoverageGuide(input);assert(!Object.isFrozen(input.canvasAspect));
  g.bytes.fill(0);assert.throws(()=>{g.recipe.coverageBudget.upperContourPercent.min=0;},TypeError);
  assert.equal(hash(backgroundBandCoverageGuide(options()).bytes),expected.backdrop.sha);
});

test('instructions require normalized proportions but reserve theme, original color and transparency for the actual source',()=>{
  const g=backgroundBandCoverageGuide(options()),r=unseal(g.recipe);
  assert.equal(r.instruction,BACKGROUND_BAND_COVERAGE_GUIDE_INSTRUCTION);assert.equal(r.normalizedBudgetRequired,true);
  assert.match(r.instruction,/Use these relative proportions/);assert.match(r.instruction,/SOFT size cue/);
  assert.match(r.instruction,/contain several smaller variations/);assert.match(r.instruction,/does not prescribe a number/);
  assert.doesNotMatch(r.instruction,/do not copy.*proportion|do not copy.*aspect/i);
  assert.match(r.instruction,/representing transparent sky/);assert.match(r.instruction,/Do not copy this opaque surround/);
  assert.match(r.instruction,/Input 1 remains the complete accepted reference/);assert.equal(r.maximumNewImageCalls,0);
  assert.equal(r.sourceInputs,0);assert.equal(r.sourcePngModified,false);assert.equal(r.sourceArtAcceptance,'not-granted');
  assert(!/(?:https?:\/\/|[a-z]:[\\/]|\bprovider\b|\bendpoint\b)/i.test(JSON.stringify(r)));
});
