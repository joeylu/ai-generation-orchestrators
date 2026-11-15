import {test} from 'node:test';
import assert from 'node:assert/strict';
import {contourCoverage,previewNativeContour} from '../experiments/native-contour-preview.mjs';
import {encodeRgbaPng,inspectPng} from '../src/png.mjs';
import {hash} from '../src/generation/common.mjs';

const pixels=Buffer.alloc(16*16*4);for(let p=0;p<pixels.length;p+=4)pixels.set([80,30,12,200],p);
const raw=encodeRgbaPng(16,16,pixels);
const design={format:'ai_scene_native_contour_design_v2',sourceSha256:hash(raw),canvas:{width:16,height:16},
  polygons:[[[2.25,8.25],[13,8.25],[13,14],[2.25,14]]],strokes:[[[6,10,3],[6,3,1]]],strokeColorGuard:null,
  excludeProbes:[[0,0],[13,3]],keepProbes:[[6,7],[6,12]]};
const placement={sourceSha256:hash(raw),sourceCrop:{x:0,y:0,width:16,height:16},outputSize:{width:12,height:12},transparentMarginPx:2};
test('native contour keeps nominated branches and excludes rear wall probes with area coverage',()=>{
  const c=contourCoverage(design);assert.equal(c.alpha[7*16+6],255);assert.equal(c.alpha[3*16+13],0);
  assert(c.alpha.some(a=>a>0&&a<255));
});
test('preview preserves source, uses frozen mapping, multiplies Alpha and never grows it',()=>{
  const copy=Buffer.from(raw),p=previewNativeContour(raw,design,placement);
  assert.deepEqual(raw,copy);assert.equal(p.virtualNative.rgba[(12*16+6)*4+3],200);
  for(let i=0;i<16*16;i++){
    const q=i*4,a=p.virtualNative.rgba[q+3];assert(a<=200);
    if(a)assert.deepEqual(p.virtualNative.rgba.subarray(q,q+3),pixels.subarray(q,q+3));
    else assert.deepEqual([...p.virtualNative.rgba.subarray(q,q+4)],[0,0,0,0]);
  }
  const out=inspectPng(p.virtualModule,{includePixels:true});assert.equal(out.width,12);assert.equal(out.height,12);
  assert.equal(out.rgba[3],0);assert.equal(p.evidence.autoFit,false);
  assert.equal(p.evidence.humanArtAcceptance,'pending');
});
test('changed source, wrong mapping, wrong keep/exclude geometry cannot make a preview',()=>{
  const code=c=>e=>e.errors?.some(row=>row.code===c);
  assert.throws(()=>previewNativeContour(Buffer.concat([raw,Buffer.from('x')]),design,placement),code('CONTOUR_SOURCE_BINDING'));
  assert.throws(()=>previewNativeContour(raw,design,{...placement,sourceSha256:'0'.repeat(64)}),code('CONTOUR_PLACEMENT_SOURCE'));
  assert.throws(()=>contourCoverage({...design,excludeProbes:[[6,12]]}),code('CONTOUR_PROBE_MISMATCH'));
});
test('bounded branch color guard removes wall-colored stroke pixels while retaining bright polygon rocks',()=>{
  const guarded={...design,strokeColorGuard:{opaqueMaxChannel:40,clearMaxChannel:70}};
  const p=previewNativeContour(raw,guarded,placement),a=(x,y)=>p.virtualNative.rgba[(y*16+x)*4+3];
  assert.equal(a(6,7),0);assert.equal(a(6,12),200);assert.equal(a(13,3),0);
});
