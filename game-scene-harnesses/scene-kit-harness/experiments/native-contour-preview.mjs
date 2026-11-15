// Explicit source-native geometry trial. No provider, workflow mutation, kit writer
// or acceptance capability. Only flattened review images and a geometry proposal
// may be published by the caller; temporary layer bytes remain preview inputs.
import {inspectPng, encodeRgbaPng} from '../src/png.mjs';
import {resampleEnvironmentAlpha} from '../src/environment-proof.mjs';
import {check, exact, hash, isDigest, seal} from '../src/generation/common.mjs';

const S = 4;
function validPoint(p, width, height, stroke = false) {
  check(Array.isArray(p) && p.length === (stroke ? 3 : 2)
    && p.every(Number.isFinite) && p[0] >= 0 && p[0] <= width
    && p[1] >= 0 && p[1] <= height && (!stroke || p[2] > 0 && p[2] <= 128), 'CONTOUR_POINT');
}
export function contourCoverage(design) {
  const v2=design?.format==='ai_scene_native_contour_design_v2';
  exact(design, ['format','sourceSha256','canvas','polygons','strokes',...(v2?['strokeColorGuard']:[]),'excludeProbes','keepProbes']);
  exact(design.canvas, ['width','height']);
  const {width, height} = design.canvas;
  check((v2||design.format === 'ai_scene_native_contour_design_v1') && isDigest(design.sourceSha256)
    && [width,height].every(v => Number.isSafeInteger(v) && v > 0 && v <= 2048), 'CONTOUR_DESIGN');
  check(Array.isArray(design.polygons) && design.polygons.length <= 64 && Array.isArray(design.strokes)
    && design.strokes.length <= 128 && design.polygons.length + design.strokes.length > 0, 'CONTOUR_COMPONENTS');
  const W = width*S, H = height*S, samples = Buffer.alloc(W*H);
  for (const points of design.polygons) {
    check(Array.isArray(points) && points.length >= 3 && points.length <= 1024, 'CONTOUR_POLYGON');
    points.forEach(p => validPoint(p,width,height));
    const low = Math.max(0,Math.floor(Math.min(...points.map(p=>p[1]))*S));
    const high = Math.min(H,Math.ceil(Math.max(...points.map(p=>p[1]))*S));
    for (let y=low;y<high;y++) {
      const py=(y+.5)/S, crossings=[];
      for(let i=0;i<points.length;i++) {
        const a=points[i],b=points[(i+1)%points.length];
        if((a[1]>py)!==(b[1]>py)) crossings.push((a[0]+(py-a[1])*(b[0]-a[0])/(b[1]-a[1]))*S);
      }
      crossings.sort((a,b)=>a-b);
      for(let i=0;i+1<crossings.length;i+=2) {
        const x0=Math.max(0,Math.ceil(crossings[i]-.5)),x1=Math.min(W,Math.ceil(crossings[i+1]-.5));
        if(x1>x0) samples.fill(1,y*W+x0,y*W+x1);
      }
    }
  }
  const downsample=()=>{
    const alpha=Buffer.alloc(width*height);
    for(let y=0;y<height;y++)for(let x=0;x<width;x++){
      let n=0;for(let sy=0;sy<S;sy++)for(let sx=0;sx<S;sx++)n+=samples[(y*S+sy)*W+x*S+sx];
      alpha[y*width+x]=Math.round(n*255/(S*S));
    }return alpha;
  };
  const polygonAlpha=downsample();
  if(design.strokeColorGuard!=null){
    exact(design.strokeColorGuard,['opaqueMaxChannel','clearMaxChannel']);
    const g=design.strokeColorGuard;
    check([g.opaqueMaxChannel,g.clearMaxChannel].every(Number.isSafeInteger)
      &&g.opaqueMaxChannel>=0&&g.clearMaxChannel<=255&&g.opaqueMaxChannel<g.clearMaxChannel,'CONTOUR_STROKE_GUARD');
  }
  for(const points of design.strokes) {
    check(Array.isArray(points) && points.length>=2 && points.length<=1024,'CONTOUR_STROKE');
    points.forEach(p=>validPoint(p,width,height,true));
    for(let i=1;i<points.length;i++) {
      const a=points[i-1],b=points[i],radius=Math.max(a[2],b[2])/2;
      const x0=Math.max(0,Math.floor((Math.min(a[0],b[0])-radius)*S));
      const x1=Math.min(W,Math.ceil((Math.max(a[0],b[0])+radius)*S));
      const y0=Math.max(0,Math.floor((Math.min(a[1],b[1])-radius)*S));
      const y1=Math.min(H,Math.ceil((Math.max(a[1],b[1])+radius)*S));
      const dx=b[0]-a[0],dy=b[1]-a[1],len=dx*dx+dy*dy;
      check(len>0,'CONTOUR_STROKE_SEGMENT');
      for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++) {
        const px=(x+.5)/S,py=(y+.5)/S,t=Math.max(0,Math.min(1,((px-a[0])*dx+(py-a[1])*dy)/len));
        const r=(a[2]+(b[2]-a[2])*t)/2;
        if((px-a[0]-t*dx)**2+(py-a[1]-t*dy)**2<=r*r) samples[y*W+x]=1;
      }
    }
  }
  const alpha=downsample();
  const probes=(points,keep)=>{
    check(Array.isArray(points)&&points.length>0&&points.length<=64,'CONTOUR_PROBES');
    return points.map(p=>{validPoint(p,width-1,height-1);check(p.every(Number.isSafeInteger),'CONTOUR_PROBE_INTEGER');
      const a=alpha[p[1]*width+p[0]];check(keep?a===255:a===0,'CONTOUR_PROBE_MISMATCH');return {point:p,alpha:a};});
  };
  return {width,height,alpha,polygonAlpha,probes:{excluded:probes(design.excludeProbes,false),retained:probes(design.keepProbes,true)}};
}
export function previewNativeContour(raw, design, placement) {
  check(hash(raw)===design.sourceSha256,'CONTOUR_SOURCE_BINDING');
  const source=inspectPng(raw,{includePixels:true,allowCabx:true,allowHiddenRgb:true});
  check(source.width===design.canvas.width&&source.height===design.canvas.height,'CONTOUR_CANVAS');
  const coverage=contourCoverage(design), rgba=Buffer.alloc(source.rgba.length), mask=Buffer.alloc(source.rgba.length);
  let retained=0,removed=0,partial=0;
  for(let i=0;i<coverage.alpha.length;i++) {
    const p=i*4,g=design.strokeColorGuard;
    // Optional, explicit material hint ONLY in the nominated branch strokes.
    // It cannot change polygon interiors or search/infer a silhouette elsewhere.
    const colorWeight=g?Math.max(0,Math.min(1,(g.clearMaxChannel-Math.max(...source.rgba.subarray(p,p+3)))/(g.clearMaxChannel-g.opaqueMaxChannel))):1;
    const geometryAlpha=Math.max(coverage.polygonAlpha[i],Math.round(coverage.alpha[i]*colorWeight));
    const a=Math.round(source.rgba[p+3]*geometryAlpha/255);
    if(a){source.rgba.copy(rgba,p,p,p+3);retained++;if(a<255)partial++;}
    if(source.rgba[p+3]>0&&a<source.rgba[p+3])removed++;
    rgba[p+3]=a;mask.set([geometryAlpha,geometryAlpha,geometryAlpha,255],p);
  }
  check(retained>0&&removed>0,'CONTOUR_EMPTY_OR_UNCHANGED');
  check(placement.sourceSha256===hash(raw),'CONTOUR_PLACEMENT_SOURCE');
  // Frozen original crop and output size, never fit to the newly reduced Alpha.
  const margin=placement.transparentMarginPx, W=placement.outputSize.width,H=placement.outputSize.height;
  check(Number.isSafeInteger(margin)&&margin>=0&&margin<=16&&W>2*margin&&H>2*margin,'CONTOUR_MAPPING');
  const reduced=resampleEnvironmentAlpha({width:source.width,height:source.height,rgba},placement.sourceCrop,W-2*margin,H-2*margin);
  const pixels=Buffer.alloc(W*H*4);
  for(let y=0;y<reduced.height;y++)reduced.rgba.copy(pixels,((y+margin)*W+margin)*4,y*reduced.width*4,(y+1)*reduced.width*4);
  const virtualModule=encodeRgbaPng(W,H,pixels), alphaPng=encodeRgbaPng(source.width,source.height,mask);
  return {source,virtualNative:{width:source.width,height:source.height,rgba},virtualModule,alphaPng,
    evidence:seal({format:'ai_scene_native_contour_preview_v1',purpose:'review-only-not-a-kit-or-art-acceptance',
      sourceSha256:hash(raw),design,geometryAlphaPngSha256:hash(alphaPng),placement,
      expectedModuleSha256:hash(virtualModule),expectedModuleBytes:virtualModule.length,
      rasterization:'4x4-area-coverage-union-polygon-and-variable-width-stroke',
      actualOpticalAlphaEstimated:false,formula:'round(sourceAlpha*geometryAlpha/255)',
      strokeColorGuard:design.strokeColorGuard??null,guardScope:'explicit-strokes-outside-polygons-only',
      retainedPixels:retained,removedOrReducedPixels:removed,partialAlphaPixels:partial,
      probes:coverage.probes,zeroRgbAtZeroAlpha:true,newSourcePixels:false,
      colorChange:false,autoFit:false,studioChanged:false,humanArtAcceptance:'pending'})};
}
export function flattenContour(image, background = 'light') {
  const rgba=Buffer.alloc(image.rgba.length),colors=background==='dark'?[[30,36,44],[48,54,64]]:[[244,242,235],[218,219,212]];
  for(let y=0;y<image.height;y++)for(let x=0;x<image.width;x++) {
    const p=(y*image.width+x)*4,a=image.rgba[p+3]/255,c=colors[(Math.floor(x/24)+Math.floor(y/24))%2];
    for(let n=0;n<3;n++)rgba[p+n]=Math.round(image.rgba[p+n]*a+c[n]*(1-a));rgba[p+3]=255;
  }return {width:image.width,height:image.height,rgba};
}
