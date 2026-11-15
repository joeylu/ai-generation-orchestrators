import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectPng} from '../src/png.mjs';
import {hash,imageRef,unseal} from '../src/generation/common.mjs';
import {SOURCE_VISUAL_GUIDE_PROFILE,SOURCE_VISUAL_GUIDE_ROLE,SOURCE_VISUAL_GUIDE_INSTRUCTION,
  SOURCE_VISUAL_GUIDE_RECIPE,sourceVisualGuide} from '../src/generation/source-visual-guide.mjs';

const expectedSha256='43f8b69d4d2bcea1e947167d678c6b1f4c48cda8c2edd96bc5a602535f20dbff';
const sample=()=>{const guide=sourceVisualGuide(SOURCE_VISUAL_GUIDE_PROFILE);return {...guide,image:inspectPng(guide.bytes,{includePixels:true,pixelStats:true})};};
const grayAt=(image,x,y)=>image.rgba[(y*image.width+x)*4];
const invalid=fn=>assert.throws(fn,error=>error.errors?.some(item=>item.code==='SOURCE_VISUAL_GUIDE_PROFILE'));

test('the single named profile produces fixed opaque PNG bytes and an exact checked artifact',()=>{
  const a=sample(),b=sample();
  assert.equal(a.profile,'deep-shadow-complete-fixture-v1');
  assert.equal(a.role,'neutral-deep-shadow-complete-fixture-example');
  assert.equal(hash(a.bytes),expectedSha256);assert.equal(a.bytes.length,6455);
  assert.equal(a.recipe.sha256,'ee3f8bba8c9f2d483648101bc09e58f9eae8fce74db91712b9f8ed4a3b3c5991','v1 instructions and recipe remain frozen with the preview');
  assert.deepEqual(a.bytes,b.bytes);assert.notStrictEqual(a.bytes,b.bytes);
  assert.deepEqual(a.artifact,imageRef(a.bytes));
  assert.deepEqual(a.artifact,{sha256:expectedSha256,byteLength:6455,pixelSize:{width:1024,height:576}});
  assert.equal(a.image.width,1024);assert.equal(a.image.height,576);
  assert.equal(a.image.channels,4);assert.equal(a.image.transparentPixels,0);assert.equal(a.image.varied,true);
  assert.equal(a.image.hiddenRgbPixels,undefined);
});

test('front, side and top planes are all deep neutral gray with only sparse small bright marks',()=>{
  const {image}=sample(),histogram=new Map();let subject=0,bright=0;
  for(let p=0;p<image.rgba.length;p+=4){
    const [r,g,b,a]=image.rgba.subarray(p,p+4);
    assert.equal(r,g);assert.equal(g,b);assert.equal(a,255);
    histogram.set(r,(histogram.get(r)??0)+1);
    if(r!==232){subject++;assert(r<=64);if(r>=55)bright++;}
  }
  assert.equal(grayAt(image,480,260),26,'large front panel remains in shadow');
  assert.equal(grayAt(image,685,260),18,'side panel is darker than the front');
  assert.equal(grayAt(image,500,150),30,'the entire top is dark rather than a broad bright lid');
  assert.equal(grayAt(image,500,164),55,'only a one-pixel top edge supplies a rim mark');
  assert.equal(histogram.get(64),6,'the indicator is only3x2pixels');
  assert(bright/subject<.005,'bright marks cannot turn into long broad strips or a bright plane');
  assert(((histogram.get(26)??0)+(histogram.get(18)??0)+(histogram.get(30)??0))/subject>.85,
    'most subject area is in the three dark major planes');
  assert.deepEqual([...histogram.keys()].sort((a,b)=>a-b),[12,18,22,24,26,30,34,36,40,55,64,232]);
});

test('the complete single fixture has more than12percent blank surroundings on every edge',()=>{
  const {image}=sample();let minX=image.width,minY=image.height,maxX=-1,maxY=-1,subject=0;
  for(let y=0;y<image.height;y++)for(let x=0;x<image.width;x++)if(grayAt(image,x,y)!==232){
    subject++;minX=Math.min(minX,x);minY=Math.min(minY,y);maxX=Math.max(maxX,x);maxY=Math.max(maxY,y);
  }
  assert.deepEqual({minX,minY,maxX,maxY},{minX:254,minY:139,maxX:760,maxY:457});
  assert(minX*100>=image.width*12);assert((image.width-maxX-1)*100>=image.width*12);
  assert(minY*100>=image.height*12);assert((image.height-maxY-1)*100>=image.height*12);
  const visited=new Uint8Array(image.width*image.height),stack=[minY*image.width+391];let connected=0;
  while(stack.length){const i=stack.pop();if(visited[i]||image.rgba[i*4]===232)continue;visited[i]=1;connected++;
    const x=i%image.width,y=Math.floor(i/image.width);
    for(const [dx,dy]of [[1,0],[-1,0],[0,1],[0,-1]])if(x+dx>=0&&x+dx<image.width&&y+dy>=0&&y+dy<image.height)stack.push((y+dy)*image.width+x+dx);
  }
  assert.equal(connected,subject,'one connected device, not a pair of examples or detached scene pieces');
});

test('returning pipe closes into its own body and the capped port and mounts remain fully inside the canvas',()=>{
  const {image}=sample(),outside=new Uint8Array(image.width*image.height),stack=[0];
  while(stack.length){const i=stack.pop();if(outside[i]||image.rgba[i*4]!==232)continue;outside[i]=1;
    const x=i%image.width,y=Math.floor(i/image.width);
    for(const [dx,dy]of [[1,0],[-1,0],[0,1],[0,-1]])if(x+dx>=0&&x+dx<image.width&&y+dy>=0&&y+dy<image.height)stack.push((y+dy)*image.width+x+dx);
  }
  assert.equal(grayAt(image,486,423),232,'the small return loop has a visible opening');
  assert.equal(outside[423*image.width+486],0,'the opening is enclosed by the returning pipe and its own body');
  assert.equal(grayAt(image,267,276),18,'the short port has a closed end face');
  assert.equal(grayAt(image,250,276),232,'clear surround continues beyond the closed port');
  for(const y of [210,331])assert.equal(grayAt(image,750,y),22,'short mounting plate is closed and visible');
  assert.equal(grayAt(image,765,210),232,'there is no backing wall attached to the compact mount');
  for(const x of [0,250,800,1023])for(const y of [0,100,500,575])assert.equal(grayAt(image,x,y),232,'no floor, horizon, captions or comparison grid');
});

test('fixed public recipe and role delimit only dark-surface/completeness guidance without granting art or compute',()=>{
  const {recipe,role}=sample(),body=unseal(recipe);
  assert.equal(recipe,SOURCE_VISUAL_GUIDE_RECIPE);assert.equal(recipe.profile,SOURCE_VISUAL_GUIDE_PROFILE);
  assert.equal(role,SOURCE_VISUAL_GUIDE_ROLE);assert.equal(recipe.instruction,SOURCE_VISUAL_GUIDE_INSTRUCTION);
  assert.equal(body.maximumNewImageCalls,0);assert.equal(body.sourceInputs,0);
  assert.equal(body.sourcePngModified,false);assert.equal(body.finalArtwork,false);assert.equal(body.sourceArtAcceptance,'not-granted');
  assert.deepEqual(body.guidance,['majority-front-side-and-top-surfaces-in-deep-shadow','complete-outer-contour-closed-ports-and-local-connections']);
  assert.deepEqual(body.excludedGuidance,['subject-identity','content','count','structure','composition','framing','style','material-hue','output-background']);
  assert.match(body.instruction,/TECHNICAL INPUT 2 demonstrates ONLY/);
  assert.match(body.instruction,/front, side AND top faces are dark/);
  assert.match(body.instruction,/Input 1 remains the accepted scene reference/);
  assert.match(body.instruction,/Only the accepted written scope decides subject identity, content/);
  assert(!/Input 1[^.]*subject identity/.test(body.instruction),'the scene image cannot override the written single-subject scope');
  assert.match(body.instruction,/does not override the newly requested darker foreground exposure/);
  assert.match(body.instruction,/transparent source still requires real transparency/);
  assert.match(body.instruction,/Do not copy/);assert.match(body.instruction,/not final artwork/);
  assert(!/(?:https?:\/\/|[a-z]:[\\/]|\bprovider\b|\bendpoint\b)/i.test(JSON.stringify(body)),
    'the fixed recipe contains no operational path, provider or endpoint');
});

test('unknown profiles, overrides and caller mutations cannot select or alter canonical artwork',()=>{
  for(const value of [undefined,null,0,true,[],{},'','deep-shadow-complete-fixture-v2','Deep-Shadow-Complete-Fixture-V1',
    {profile:SOURCE_VISUAL_GUIDE_PROFILE},'C:\\private\\example.png','https://example.invalid/guide.png'])invalid(()=>sourceVisualGuide(value));
  invalid(()=>sourceVisualGuide());invalid(()=>sourceVisualGuide(SOURCE_VISUAL_GUIDE_PROFILE,{width:4096}));
  const guide=sourceVisualGuide(SOURCE_VISUAL_GUIDE_PROFILE);guide.bytes.fill(0);guide.artifact.sha256='0'.repeat(64);
  assert.throws(()=>{guide.recipe.faceGrays.front=220;},TypeError);
  assert.throws(()=>{guide.recipe.excludedGuidance.push('override');},TypeError);
  const fresh=sourceVisualGuide(SOURCE_VISUAL_GUIDE_PROFILE);
  assert.equal(hash(fresh.bytes),expectedSha256);assert.equal(fresh.artifact.sha256,expectedSha256);
  assert.equal(fresh.recipe.faceGrays.front,26);
});
