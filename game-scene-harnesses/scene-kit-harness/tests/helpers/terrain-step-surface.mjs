import {buildTerrainStepCornerProfile} from '../../src/terrain-step-corners.mjs';
import {buildTerrainStepSurface} from '../../src/terrain-step-surface.mjs';
import {buildTerrainSurfaceSpanProfile,buildTerrainSurfaceSpanEnvelope} from '../../src/terrain-surface-span-envelope.mjs';

export function stepSurfaceFixture({bound=true,adaptive=true}={}){
  const cells=new Map();for(let y=2;y<5;y++)for(let x=2;x<7;x++)cells.set(`${x},${y}`,'primary');
  for(let x=3;x<6;x++)cells.set(`${x},1`,'primary');
  const owner={gridTerrainId:'grid-field/3,1',layerId:'terrain',source:{gridCells:[...cells.keys()].map(k=>{const [x,y]=k.split(',').map(Number);return {x,y};})},
    body:{positions:[128,128,128,320,448,128,448,320],uvs:[0,0,0,1,1,0,1,1],indices:[0,1,2,2,1,3]},cap:{positions:[],uvs:[],indices:[]},
    capBands:[],edgeMeshes:[],bounds:{x:128,y:64,width:320,height:256},unionMaterial:{group:0}},
    north=[{from:{x:128,y:128},to:{x:192,y:128},ownerId:owner.gridTerrainId},{from:{x:192,y:64},to:{x:384,y:64},ownerId:owner.gridTerrainId},
      {from:{x:384,y:128},to:{x:448,y:128},ownerId:owner.gridTerrainId}],
    appearance={format:'ai_scene_continuous_terrain_appearance_v6',cap:{source:{path:'cap.png',sha256:'a'.repeat(64),byteLength:128},pixelSize:{width:128,height:72}},
      capDepth:{numerator:36,denominator:1},capUvEnd:{numerator:1,denominator:1}},
    surfaceInterface={profile:'world-body-native-lip-v1',capSourceSha256:appearance.cap.source.sha256,capEndRow:16,fadeRows:4},
    profile=buildTerrainStepCornerProfile({widthWorld:32,heightWorld:12}),input={gridTerrains:[owner],curveTerrains:[],
      edgePlacement:{placed:[{side:'left',x:192,fromY:64,toY:128,ownerIds:[owner.gridTerrainId]},{side:'right',x:384,fromY:64,toY:128,ownerIds:[owner.gridTerrainId]}]},
      unionMaterial:{groups:[{ownerIds:[owner.gridTerrainId],exposedNorthSegments:north}]},appearance,profile,
      world:{x:0,y:0,width:640,height:512},cells,grid:{width:64,height:64}};
  if(bound){input.surfaceInterface=surfaceInterface;if(adaptive)input.surfaceSpanEnvelope=buildTerrainSurfaceSpanProfile({shortWidthWorld:64,fullWidthWorld:128,capEndRow:8,fadeRows:4},{appearance,surfaceInterface});rebindStepSurfaceFixture(input);}
  return input;
}

export function rebindStepSurfaceFixture(input){
  const {appearance,surfaceInterface,surfaceSpanEnvelope,profile:stepCorners}=input;
  input.surfaceBinding=buildTerrainStepSurface({appearance,surfaceInterface,surfaceSpanEnvelope,stepCorners});
  if(surfaceSpanEnvelope)for(const group of input.unionMaterial.groups){
    const layout=buildTerrainSurfaceSpanEnvelope(group.exposedNorthSegments.map(s=>({a:s.from,b:s.to})),{envelope:surfaceSpanEnvelope.options,capEndRow:surfaceInterface.capEndRow,fadeRows:surfaceInterface.fadeRows});
    group.surfaceSpanEnvelope={spans:layout.spans,work:layout.work,endpointToleranceWorld:layout.endpointToleranceWorld};
  }
}
