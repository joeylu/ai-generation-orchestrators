import test from 'node:test';
import assert from 'node:assert/strict';
import { compilePaintGeometryDesign, proposedPaintMapping, assertOpaquePaintStudy, paintGeometryGuide } from '../experiments/paint-geometry-proposal.mjs';
import { encodeRgbaPng, inspectPng } from '../src/png.mjs';
import { raster, areaResample } from '../src/terrain-proof/raster.mjs';
import { hash, seal, unseal } from '../src/generation/common.mjs';
const rejects=(fn,code)=>assert.throws(fn,e=>e.errors?.some(v=>v.code===code));
function fixture() {
  const mask=raster(4,4),context=raster(4,4);
  for(let i=0;i<16;i++) {
    const a=i%3===0?0:i===5?128:255;if(a)mask.rgba.set([255,255,255,a],i*4);
    context.rgba.set([40+i,90,130,255],i*4);
  }
  const alpha=encodeRgbaPng(4,4,mask.rgba),image=encodeRgbaPng(4,4,context.rgba);
  const geometry=seal({format:'ai_scene_geometry_design_target_v1',sourcePacketSha256:'1'.repeat(64),sourceDraftSha256:'2'.repeat(64),
    alphaPngSha256:hash(alpha),alphaRgbaSha256:hash(mask.rgba),instanceId:'foreground.synthetic',referenceSha256:hash(image),targetSha256:'4'.repeat(64),
    nativeFrame:{width:4,height:4},localCanvas:{width:4,height:4},origin:{x:0,y:0},frameClippedEdges:['left','right','top','bottom'],
    originalUncertainPixels:3,opticalAlphaMeasured:false});
  const acceptance=seal({format:'ai_scene_geometry_design_acceptance_v1',geometryPacketSha256:geometry.sourcePacketSha256,
    alphaPngSha256:hash(alpha),decision:'accept',scope:'geometry-design-target-only',provenance:'synthetic-test-fixture',recordedOn:'2026-10-26',
    userReply:'synthetic fixture only',computeAuthorized:false,realImageApplicationAuthorized:false});
  const inputs={geometryGuide:paintGeometryGuide(alpha),appearanceReference:image};
  const brief=seal({format:'ai_scene_paint_brief_v1',subject:'synthetic shapes',appearance:'flat fixture colors',exclusions:['background rectangles'],intent:'Keep the four canvas edges.'});
  return {mask,context,alpha,image,geometry,acceptance,inputs,brief,run:(g=geometry,a=acceptance,b=alpha,images=inputs,v=brief)=>compilePaintGeometryDesign(g,b,a,images,v)};
}
test('a design binds exact geometry and two whole-canvas inputs without authorizing compute or application',()=>{
  const f=fixture(),p=f.run();assert.equal(p.executable,false);assert.equal(p.computeAuthorized,false);assert.equal(p.realImageDerivationAuthorized,false);
  assert.equal(p.sourcePaintDraft.suppliedSource,null);assert.equal(p.sourcePaintDraft.maximumCalls,1);assert.equal(p.sourcePaintDraft.transparentBackground,false);
  assert.equal(p.derivationDraft.sourcePaintSha256,null);assert.equal(p.derivationDraft.existingGeneratedSourcesAllowed,false);
  assert.equal(p.sourcePaintDraft.images.length,2);assert.equal(p.sourcePaintDraft.images[1].sha256,hash(f.image));
  assert.deepEqual(f.run(),p);
});
test('accepting approximate design does not erase original optical-alpha uncertainty',()=>{
  const p=fixture().run();assert.equal(p.uncertainty.originalUncertainPixels,3);assert.equal(p.uncertainty.opticalAlphaMeasured,false);
  assert.equal(p.placement.scale,1);assert.equal(p.placement.autoFit,false);assert.equal(p.derivationDraft.maskResampling,'none');
});
test('foreign packet, altered mask, or pending design review cannot compile',()=>{
  const f=fixture();rejects(()=>f.run(f.geometry,seal({...unseal(f.acceptance),geometryPacketSha256:'9'.repeat(64)})),'PAINT_DESIGN_REVIEW');
  rejects(()=>f.run(f.geometry,seal({...unseal(f.acceptance),decision:'pending'})),'PAINT_DESIGN_REVIEW');
  rejects(()=>f.run(f.geometry,f.acceptance,f.image),'PAINT_DESIGN_BINDING');
});
test('design receipts cannot smuggle compute/application authorization into a draft',()=>{
  const f=fixture();for(const key of ['computeAuthorized','realImageApplicationAuthorized'])
    rejects(()=>f.run(f.geometry,seal({...unseal(f.acceptance),[key]:true})),'PAINT_DESIGN_REVIEW');
  rejects(()=>f.run(seal({...unseal(f.geometry),attemptId:'invented'})),'WORKFLOW_SHAPE');
});
test('source normalization is whole-canvas with explicit small axis-ratio tolerance',()=>{
  const m=proposedPaintMapping({width:1120,height:890},{width:560,height:445});assert.equal(m.aspectError.numerator,0);assert.equal(m.crop,'none');
  const n=proposedPaintMapping({width:1280,height:1024},{width:560,height:445});assert(n.aspectError.numerator>0);assert.equal(n.alphaBoundsUsed,false);
  rejects(()=>proposedPaintMapping({width:1672,height:941},{width:560,height:445}),'PAINT_DESIGN_ASPECT');
});
test('small, invalid, and extreme source canvases stop instead of upscaling or auto fitting',()=>{
  rejects(()=>proposedPaintMapping({width:280,height:223},{width:560,height:445}),'PAINT_DESIGN_UPSCALE');
  for(const width of [0,Infinity,4097,1120.5])rejects(()=>proposedPaintMapping({width,height:890},{width:560,height:445}),'PAINT_DESIGN_SIZE');
});
test('opaque paint gate rejects transparent or flat paint without repairing its pixels',()=>{
  const f=fixture(),original=Buffer.from(f.context.rgba);assertOpaquePaintStudy(f.context);assert.deepEqual(f.context.rgba,original);
  f.context.rgba[3]=254;rejects(()=>assertOpaquePaintStudy(f.context),'PAINT_DESIGN_OPAQUE');
  const blank=raster(2,2);for(let i=0;i<4;i++)blank.rgba.set([5,5,5,255],i*4);
  rejects(()=>assertOpaquePaintStudy(blank),'PAINT_DESIGN_BLANK');
});
test('mismatched, transparent or extra guide images cannot be introduced',()=>{
  const f=fixture(),small=encodeRgbaPng(2,2,raster(2,2).rgba);
  rejects(()=>f.run(f.geometry,f.acceptance,f.alpha,{...f.inputs,geometryGuide:small}),'PAINT_DESIGN_INPUT');
  rejects(()=>f.run(f.geometry,f.acceptance,f.alpha,{...f.inputs,appearanceReference:f.alpha}),'PAINT_DESIGN_INPUT');
  rejects(()=>f.run(f.geometry,f.acceptance,f.alpha,{...f.inputs,thirdImage:f.image}),'WORKFLOW_SHAPE');
});
test('mask color, frame contact, placement and measured-alpha claims are checked',()=>{
  const f=fixture();rejects(()=>f.run(seal({...unseal(f.geometry),origin:{x:15,y:0}})),'PAINT_DESIGN_ORIGIN');
  rejects(()=>f.run(seal({...unseal(f.geometry),opticalAlphaMeasured:true})),'PAINT_DESIGN_UNCERTAINTY');
  rejects(()=>f.run(seal({...unseal(f.geometry),frameClippedEdges:['left','bottom']})),'PAINT_DESIGN_FRAME_EDGES');
  const rgba=Buffer.from(f.mask.rgba);rgba[4]=150;const raw=encodeRgbaPng(4,4,rgba);
  const g=seal({...unseal(f.geometry),alphaPngSha256:hash(raw),alphaRgbaSha256:hash(rgba)});
  rejects(()=>f.run(g,seal({...unseal(f.acceptance),alphaPngSha256:hash(raw)}),raw),'PAINT_DESIGN_MASK_ONLY');
});
test('integer area normalization does not mutate or choose an appearance bounding box',()=>{
  const src=raster(4,4);for(let y=0;y<4;y++)for(let x=0;x<4;x++)src.rgba.set([x*40,y*40,100,255],(y*4+x)*4);
  const original=Buffer.from(src.rgba),dst=areaResample(src,{x:0,y:0,width:4,height:4},2,2);
  assert.deepEqual([...dst.rgba.subarray(0,4)],[20,20,100,255]);assert.deepEqual(src.rgba,original);
});
test('the eight-pixel paint halo is an opaque guide and never expands final geometry alpha',()=>{
  const mask=raster(25,25);mask.rgba.set([255,255,255,128],(12*25+12)*4);const before=Buffer.from(mask.rgba);
  const raw=encodeRgbaPng(25,25,mask.rgba),guide=inspectPng(paintGeometryGuide(raw),{includePixels:true});
  assert.equal(guide.transparentPixels,0);assert.equal(guide.rgba[(12*25+12)*4],213);
  assert.equal(guide.rgba[(4*25+4)*4],145);assert.equal(guide.rgba[(3*25+3)*4],70);
  assert.deepEqual(mask.rgba,before);
});
test('an unreplayed guide or a claimed frame cut away from the original frame is rejected',()=>{
  const f=fixture();rejects(()=>f.run(f.geometry,f.acceptance,f.alpha,{...f.inputs,geometryGuide:f.image}),'PAINT_DESIGN_GUIDE_REPLAY');
  rejects(()=>f.run(seal({...unseal(f.geometry),nativeFrame:{width:16,height:16}})),'PAINT_DESIGN_FRAME_EDGES');
});
test('subject and appearance are explicit design inputs rather than a fixed snow-scene template',()=>{
  const f=fixture(),a=f.run(),brief=seal({...unseal(f.brief),subject:'volcanic foreground',appearance:'warm rough basalt'});
  const b=f.run(f.geometry,f.acceptance,f.alpha,f.inputs,brief);assert.notEqual(a.sha256,b.sha256);
  assert.match(b.sourcePaintDraft.prompt,/warm rough basalt/);assert(!b.sourcePaintDraft.prompt.includes('雪山'));
});
test('the appearance input must be the exact accepted full reference, not an edited substitute',()=>{
  const f=fixture();f.context.rgba[0]++;
  const changed=encodeRgbaPng(4,4,f.context.rgba);
  rejects(()=>f.run(f.geometry,f.acceptance,f.alpha,{...f.inputs,appearanceReference:changed}),'PAINT_DESIGN_REFERENCE');
});
