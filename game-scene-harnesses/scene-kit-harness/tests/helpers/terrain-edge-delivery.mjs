import {join} from 'node:path';
import * as flow from '../../src/generation/index.mjs';
import {compileMeasuredSurfaceMapping} from '../../src/terrain-proof/measured-field.mjs';
import {createMeasuredCoherentComposition} from '../../src/coherent-composition.mjs';
import {encodeRgbaPng,inspectPng} from '../../src/png.mjs';
import {setupCoherent,sourcePng,coherentSurfaceObservations} from './coherent.mjs';
import {terrainEdgesFixture} from './terrain-edges.mjs';
import {decision} from './generation.mjs';

export const receiveEdgeFixture=(workflow,sha,bytes)=>{const {request,...ticket}=flow.reservePlan(workflow,sha);flow.recordSubmission(workflow,ticket);return flow.receiveResult(workflow,ticket,bytes);};

// The enlarged synthetic input exercises native reception bounds. It does not
// enlarge generated artwork or represent a real source-generation call.
export function nativeFixtures(palette,sourceAlpha){
  const fixture=terrainEdgesFixture({palette}),controls={left:{},right:{}},raws=new Map();
  for(const side of ['left','right'])for(const part of ['wall','corner']){
    const item=fixture.edges[side][part],png=inspectPng(fixture.files.get(item.source.path),{includePixels:true}),factor=6,
      width=png.width*factor,height=png.height*factor,rgba=Buffer.alloc(width*height*4);
    for(let y=0;y<height;y++)for(let x=0;x<width;x++){
      const p=(Math.floor(y/factor)*png.width+Math.floor(x/factor))*4;png.rgba.copy(rgba,(y*width+x)*4,p,p+4);
      if(rgba[(y*width+x)*4+3])rgba[(y*width+x)*4+3]=sourceAlpha;
    }
    rgba.set([11,23,37,0],0);
    raws.set(side+'-'+(part==='wall'?'wall':'top-corner'),encodeRgbaPng(width,height,rgba));
    controls[side][part]={scale:{numerator:1,denominator:12},boundaryX:item.boundaryX*factor,innerX:item.innerX*factor,
      ...(part==='wall'?{repeatY:{from:item.repeatY.from*factor,to:item.repeatY.to*factor}}:{surfaceY:item.surfaceY*factor,wallStartY:item.wallStartY*factor})};
  }
  return {controls,raws};
}

export function setupTerrainEdgeDelivery(t,{receiveEdges=true,palette='autumn',sourceAlpha=255,surfaceObservations=coherentSurfaceObservations()}={}){
  const f=setupCoherent(t,palette==='snow'?'Snowy cliff fixture':'Autumn rock fixture'),base=flow.freezeCoherentSources(f.workflow,{...f.options,sourceScopes:flow.createLayerSourceScopes(f.brief.requirements)});
  flow.authorizeReferenceAssetBatch(f.workflow,base.sha256,decision('base.compute',base.sha256,'approve-compute'));
  base.planSha256s.forEach((sha,index)=>receiveEdgeFixture(f.workflow,sha,sourcePng(flow.getGenerationPlan(f.workflow,sha).target.alpha==='transparent',index+17)));
  const material=flow.getGenerationResult(f.workflow,base.planSha256s[0]).bytes,
    mapping=compileMeasuredSurfaceMapping({reference:f.raw,target:f.target,material,observations:surfaceObservations}),
    composition=createMeasuredCoherentComposition(base,f.target,mapping),baseCandidateRoot=join(f.parent,'base-candidate');
  flow.buildCoherentCandidate(f.workflow,base.sha256,'base.fixture',baseCandidateRoot,composition);
  const edgeOptions={batchId:'edges.first',baseBatchSha256:base.sha256,capabilitiesSha256:f.options.capabilitiesSha256,
    items:flow.TERRAIN_EDGE_ROLES.map((role,index)=>({assetId:'edge.'+index,role,content:'One synthetic '+palette+' rock edge with an irregular outer contour.',exclusions:['Independent props']}))},
    batch=flow.freezeTerrainEdgeSources(f.workflow,edgeOptions),native=nativeFixtures(palette,sourceAlpha);
  if(receiveEdges){
    flow.authorizeReferenceAssetBatch(f.workflow,batch.sha256,decision('edge.compute',batch.sha256,'approve-compute'));
    batch.planSha256s.forEach(sha=>receiveEdgeFixture(f.workflow,sha,native.raws.get(flow.getGenerationPlan(f.workflow,sha).recipe.edgeRole)));
  }
  return {...f,base,baseKitRoot:join(baseCandidateRoot,'kit'),baseCandidateRoot,edgeOptions,batch,controls:native.controls,raws:native.raws,
    deliveryOptions:{workflow:f.workflow,baseKitRoot:join(baseCandidateRoot,'kit'),batchSha256:batch.sha256,controls:native.controls,output:join(f.parent,'edge-delivery')}};
}
