import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import * as flow from '../../src/generation/index.mjs';
import {encodeRgbaPng} from '../../src/png.mjs';
import {hash} from '../../src/generation/common.mjs';
import {deriveMeasuredFieldDensity2} from '../../src/terrain-proof/measured-field-density.mjs';
import {NEAR_OPAQUE_JOIN_PROFILE,GRID_TERRAIN_EDGE_PROFILE,EXPOSED_SIDE_TERMINATION_PROFILE} from '../../src/terrain-edges.mjs';
import {TERRAIN_UNION_MATERIAL_PROFILE,TERRAIN_SURFACE_INTERFACE_PROFILE} from '../../src/terrain-union-material.mjs';
import {setupTerrainEdgeDelivery,receiveEdgeFixture} from './terrain-edge-delivery.mjs';
import {coherentSurfaceObservations} from './coherent.mjs';
import {decision} from './generation.mjs';

// Deliberately simple synthetic paint. It is not production art or a generated
// image. The hidden-RGB pixel proves normalization never changes native alpha.
export function bottomFixture(){
  const raws=new Map(),controls={};
  for(const [index,[key,role]]of [['edge','bottom-edge'],['leftCorner','left-bottom-corner'],['rightCorner','right-bottom-corner']].entries()){
    const width=384,height=384,rgba=Buffer.alloc(width*height*4),left=key==='leftCorner'?128:48,right=key==='rightCorner'?256:336;
    for(let y=64;y<240;y++)for(let x=left;x<right;x++)rgba.set([70+index*20+x%23,90+y%31,130+x%17,252],(y*width+x)*4);
    rgba.set([11,23,37,0],0);raws.set(role,encodeRgbaPng(width,height,rgba));
    controls[key]={scale:{numerator:1,denominator:4},boundaryY:224,innerY:192,inboardBlend:{fromY:192,toY:184},
      ...(key==='edge'?{repeatX:{from:96,to:288}}:key==='leftCorner'?{boundaryX:128,innerX:160,wallStartY:96,stripStartX:192}
        :{boundaryX:256,innerX:224,wallStartY:96,stripStartX:192})};
  }
  return {raws,controls};
}

export function freezeBottomDeliverySources(f,roles,batchId,receive=true){
  const bottom=bottomFixture(),raws=new Map([...f.raws,...bottom.raws]),batch=flow.freezeTerrainEdgeSources(f.workflow,{batchId,
    baseBatchSha256:f.base.sha256,capabilitiesSha256:f.options.capabilitiesSha256,coverageProfile:'full-perimeter-v1',
    items:roles.map((role,index)=>({assetId:batchId+'.'+index,role,content:'One isolated synthetic native edge responsibility '+role+'.',exclusions:['Independent props']}))});
  if(receive){flow.authorizeReferenceAssetBatch(f.workflow,batch.sha256,decision(batchId+'.compute',batch.sha256,'approve-compute'));
    for(const sha of batch.planSha256s)receiveEdgeFixture(f.workflow,sha,raws.get(flow.getGenerationPlan(f.workflow,sha).recipe.edgeRole));}
  return {batch,bottom};
}

export function bottomSideControls(f){
  const composition=JSON.parse(readFileSync(join(f.baseCandidateRoot,'evidence/composition-profile.json'),'utf8')),
    material=flow.getGenerationResult(f.workflow,f.base.planSha256s[0]).bytes,density=deriveMeasuredFieldDensity2(material,composition.surfaceMapping),
    controls={...structuredClone(f.controls),joinProfile:NEAR_OPAQUE_JOIN_PROFILE,materialDensityProfile:'reference-native-2x-v1',gridProfile:GRID_TERRAIN_EDGE_PROFILE,
      junctions:{},materialProfile:TERRAIN_UNION_MATERIAL_PROFILE,sideTerminationProfile:EXPOSED_SIDE_TERMINATION_PROFILE,
      surfaceInterface:{profile:TERRAIN_SURFACE_INTERFACE_PROFILE,capSourceSha256:hash(density.files.get('materials/cap-field.png')),capEndRow:20,fadeRows:4},
      rigidBodyRepeat:{fromRow:24,toRow:360}};
  for(const side of ['left','right'])for(const part of ['wall','corner'])controls[side][part].inboardBlend={fromX:controls[side][part].innerX,toX:side==='left'?264:24};
  return controls;
}

export function setupBottomDelivery(t,{receiveSides=true}={}){
  const observations=coherentSurfaceObservations();observations.rockFeaturePairs[0].source.toX=160;
  return setupTerrainEdgeDelivery(t,{receiveEdges:receiveSides,sourceAlpha:252,surfaceObservations:observations});
}
