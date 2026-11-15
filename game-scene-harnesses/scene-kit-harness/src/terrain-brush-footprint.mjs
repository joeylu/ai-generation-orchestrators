import {contextFor} from './kit.mjs';
import {check,digest,exact,seal} from './generation/common.mjs';
import {validateTerrainSurfaceInterface} from './terrain-union-material.mjs';
import {resolveTerrainMaterialAppearance,resolveTerrainSurfaceInterface} from './terrain-loop-material.mjs';
import {validateTerrainSurfaceSpanProfile,terrainSurfaceSpanRows} from './terrain-surface-span-envelope.mjs';

// A declared size budget can reject an unsuitable brush before expensive
// delivery work. It neither analyses painted forms nor grants art acceptance.
const finite=(n,min,max)=>Number.isFinite(n)&&n>=min&&n<=max;
const ratio=value=>value?.numerator/value?.denominator;
const q=n=>Math.round(n*1e9)/1e9;
const positive=n=>finite(n,1e-9,65536);
export function reviewTerrainBrushFootprint({grid,terrainEdges,terrainBottomEdges=null,policy}){
  exact(policy,['minimumSpanCells','maximumCornerTransitionCells','minimumInteriorWidthCells','minimumBottomRepeatCells','requireFullPerimeter']);
  exact(policy.minimumSpanCells,['width','height']);
  check(['width','height'].every(k=>Number.isSafeInteger(grid?.[k])&&grid[k]>0&&grid[k]<=4096
    &&Number.isSafeInteger(policy.minimumSpanCells[k])&&policy.minimumSpanCells[k]>=1&&policy.minimumSpanCells[k]<=64)
    &&positive(policy.maximumCornerTransitionCells)&&finite(policy.minimumInteriorWidthCells,0,policy.minimumSpanCells.width)
    &&positive(policy.minimumBottomRepeatCells)&&typeof policy.requireFullPerimeter==='boolean','TERRAIN_BRUSH_FOOTPRINT_POLICY');
  const width=grid.width*policy.minimumSpanCells.width,height=grid.height*policy.minimumSpanCells.height,
    issues=[],sides={};
  for(const side of ['left','right']){
    const sign=side==='left'?1:-1,items=terrainEdges?.[side];
    check(items?.wall&&items?.corner,'TERRAIN_BRUSH_FOOTPRINT_INPUT');
    const parts={};
    for(const part of ['wall','corner']){
      const item=items[part],s=ratio(item.scale),end=item.inboardBlend?.toX??(side==='left'?item.pixelSize?.width:0),
        inset=sign*(item.innerX-item.boundaryX)*s,inward=sign*(end-item.boundaryX)*s;
      check(positive(s)&&s<=1&&Number.isSafeInteger(item.pixelSize?.width)&&item.pixelSize.width>=4
        &&Number.isSafeInteger(item.pixelSize?.height)&&item.pixelSize.height>=4
        &&Number.isSafeInteger(item.boundaryX)&&item.boundaryX>=0&&item.boundaryX<item.pixelSize.width
        &&Number.isSafeInteger(item.innerX)&&item.innerX>=1&&item.innerX<item.pixelSize.width-1
        &&finite(end,0,item.pixelSize.width)&&positive(inset)&&positive(inward)&&inward>=inset,'TERRAIN_BRUSH_FOOTPRINT_INPUT');
      parts[part]={insetWorld:q(inset),inwardRenderWorld:q(inward)};
    }
    const corner=items.corner,depth=(corner.wallStartY-corner.surfaceY)*ratio(corner.scale),
      extent=Math.max(parts.wall.inwardRenderWorld,parts.corner.inwardRenderWorld),fit=Math.min(1,width/2/extent);
    check(Number.isSafeInteger(corner.surfaceY)&&corner.surfaceY>=0&&Number.isSafeInteger(corner.wallStartY)
      &&corner.wallStartY<=corner.pixelSize.height&&positive(depth),'TERRAIN_BRUSH_FOOTPRINT_INPUT');
    sides[side]={...parts,cornerTransitionWorld:q(depth),minimumSpanInwardFitFactor:q(fit)};
    if(fit<1-1e-9)issues.push({code:'TERRAIN_BRUSH_INWARD_COMPRESSION',side,actualWorld:q(extent),maximumWorld:q(width/2)});
    if(depth>grid.height*policy.maximumCornerTransitionCells+1e-9)
      issues.push({code:'TERRAIN_BRUSH_CORNER_DEPTH',side,actualWorld:q(depth),maximumWorld:q(grid.height*policy.maximumCornerTransitionCells)});
  }
  const interior=width-Math.max(sides.left.wall.insetWorld,sides.left.corner.insetWorld)-Math.max(sides.right.wall.insetWorld,sides.right.corner.insetWorld),
    requiredInterior=policy.minimumInteriorWidthCells*grid.width;
  if(interior<requiredInterior-1e-9)issues.push({code:'TERRAIN_BRUSH_INTERIOR_WIDTH',actualWorld:q(interior),minimumWorld:q(requiredInterior)});
  let bottom=null;
  if(terrainBottomEdges){
    const e=terrainBottomEdges.edge,period=(e?.repeatX?.to-e?.repeatX?.from)*ratio(e?.scale);
    check(positive(period),'TERRAIN_BRUSH_FOOTPRINT_INPUT');
    bottom={repeatWorld:q(period),repeatsPerMinimumSpan:q(width/period)};
    if(period<grid.width*policy.minimumBottomRepeatCells-1e-9)
      issues.push({code:'TERRAIN_BRUSH_BOTTOM_REPEAT',actualWorld:q(period),minimumWorld:q(grid.width*policy.minimumBottomRepeatCells)});
  }
  if(policy.requireFullPerimeter&&(!terrainBottomEdges?.edge||!terrainBottomEdges.leftCorner||!terrainBottomEdges.rightCorner))
    issues.push({code:'TERRAIN_BRUSH_FULL_PERIMETER_REQUIRED'});
  return seal({format:'ai_scene_terrain_brush_footprint_review_v1',status:issues.length?'fail':'pass',
    inputSha256:digest({grid,terrainEdges,terrainBottomEdges}),policy,policySha256:digest(policy),
    minimumSpanWorld:{width,height},sides,interiorWidthWorld:q(interior),bottom,issues,
    scope:'declared-controls-only-not-source-byte-collar-or-painted-form-validation',
    artAcceptance:'not-assessed',productionKit:false,generationCalls:0});
}

export function requireTerrainBrushFootprint(options){
  const report=reviewTerrainBrushFootprint(options);
  check(report.status==='pass','TERRAIN_BRUSH_FOOTPRINT',report.issues.map(i=>i.code).join(', '));
  return report;
}

export function reviewTerrainBrushKitFootprint(handle,policy){
  const {kit}=contextFor(handle);
  return reviewTerrainBrushFootprint({grid:kit.grid,terrainEdges:kit.terrainEdges,terrainBottomEdges:kit.terrainBottomEdges??null,policy});
}

// A size-budget pass does not establish that a deep shared cover fits its
// remaining central region. Keep these measurements separate from qualification.
export function reviewTerrainSurfaceSpan({grid,terrainEdges,terrainBottomEdges=null,appearance,policy,surfaceSpanEnvelope}){
  const footprint=reviewTerrainBrushFootprint({grid,terrainEdges,terrainBottomEdges,policy}),
    surfaceInterface=terrainEdges?.surfaceInterface;
  check(surfaceInterface,'TERRAIN_SURFACE_SPAN_INTERFACE','Choose an explicit source-bound native-row interface');
  const depths=validateTerrainSurfaceInterface(surfaceInterface,appearance),width=footprint.minimumSpanWorld.width,
    leftInset=Math.max(footprint.sides.left.wall.insetWorld,footprint.sides.left.corner.insetWorld),
    rightInset=Math.max(footprint.sides.right.wall.insetWorld,footprint.sides.right.corner.insetWorld),
    interior=footprint.interiorWidthWorld,corners={};
  let declaredCoverage=null;
  if(surfaceSpanEnvelope){
    validateTerrainSurfaceSpanProfile(surfaceSpanEnvelope,{appearance,surfaceInterface});
    const selected=terrainSurfaceSpanRows(width,surfaceSpanEnvelope.options,surfaceInterface.capEndRow,surfaceInterface.fadeRows),rowWorld=depths.overlayDepthWorld/surfaceInterface.capEndRow;
    declaredCoverage={profileSha256:surfaceSpanEnvelope.sha256,...selected,overlayDepthWorld:q(selected.capEndRow*rowWorld),fadeWorld:q(selected.fadeRows*rowWorld),
      depthToNominalInterior:interior>0?q(selected.capEndRow*rowWorld/interior):null,scope:'declared-minimum-span-not-an-actual-exposed-chain'};
  }
  for(const side of ['left','right']){
    const item=terrainEdges[side].corner,s=ratio(item.scale),sign=side==='left'?1:-1;
    check(item.inboardBlend&&finite(item.inboardBlend.fromX,0,item.pixelSize.width)&&finite(item.inboardBlend.toX,0,item.pixelSize.width),
      'TERRAIN_SURFACE_SPAN_COVERAGE','Explicit native inboard coverage is required');
    const from=sign*(item.inboardBlend.fromX-item.boundaryX)*s,to=sign*(item.inboardBlend.toX-item.boundaryX)*s;
    check(from>=footprint.sides[side].corner.insetWorld-1e-9&&to>from,'TERRAIN_SURFACE_SPAN_COVERAGE');
    corners[side]={insetWorld:footprint.sides[side].corner.insetWorld,
      fadeFromBoundaryWorld:{from:q(from),to:q(to)},nativeSourceSha256:item.source?.sha256??null};
  }
  return seal({format:'ai_scene_terrain_surface_span_review_v1',status:'measured-not-qualified',footprintReviewSha256:footprint.sha256,
    minimumSpanBudgetStatus:footprint.status,minimumSpanWorld:footprint.minimumSpanWorld,
    nominalSharedIntervalWorld:{from:q(leftInset),to:q(width-rightInset),width:q(interior)},
    surfaceInterface:{...surfaceInterface},capSourceSha256:appearance.cap.source.sha256,
    overlayDepthWorld:q(depths.overlayDepthWorld),fadeWorld:q(depths.fadeWorld),unfadedDepthWorld:q(depths.overlayDepthWorld-depths.fadeWorld),
    overlayDepthToNominalInterior:interior>0?q(depths.overlayDepthWorld/interior):null,
    nativeUpperCorners:corners,inputSha256:digest({grid,terrainEdges,terrainBottomEdges,appearance,policy,...(surfaceSpanEnvelope?{surfaceSpanEnvelope}:{})}),
    ...(declaredCoverage?{coverageAtDeclaredSpan:declaredCoverage}:{}),
    scope:'declared-native-row-depth-and-nominal-side-insets-not-rendered-alpha-or-painted-cover-thickness',
    technicalOrArtQualification:false,automaticCalibration:false,sourceProcessing:'none',generationCalls:0,productionKit:false,artAcceptance:'not-assessed'});
}

export function reviewTerrainSurfaceKitSpan(handle,policy){
  const {kit}=contextFor(handle),appearance=resolveTerrainMaterialAppearance(kit.terrainAppearance,kit.terrainMaterialLoop,kit.terrainRigidRepeat,kit.terrainSurfaceCycle),
    edges=structuredClone(kit.terrainEdges);
  check(edges?.surfaceInterface,'TERRAIN_SURFACE_SPAN_INTERFACE');
  edges.surfaceInterface=resolveTerrainSurfaceInterface(edges.surfaceInterface,kit.terrainSurfaceCycle);
  const review=reviewTerrainSurfaceSpan({grid:kit.grid,terrainEdges:edges,terrainBottomEdges:kit.terrainBottomEdges??null,appearance,policy,
    ...(kit.terrainSurfaceSpanEnvelope?{surfaceSpanEnvelope:kit.terrainSurfaceSpanEnvelope}:{})});
  return seal({format:'ai_scene_terrain_surface_kit_span_review_v1',kitSha256:handle.bundleSha256,review,
    generationCalls:0,productionKit:false,artAcceptance:'not-assessed'});
}
