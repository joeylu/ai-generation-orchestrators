import {demand} from './errors.mjs';
import {clone} from './document.mjs';
import {surfaceMinimum} from './terrain-overlap.mjs';
import {buildTerrainSurfaceSpanEnvelope} from './terrain-surface-span-envelope.mjs';
import {validateTerrainStepSurface,TERRAIN_STEP_LINEAR_SURFACE_PROFILE} from './terrain-step-surface.mjs';
import {canonicalJson} from './document.mjs';
export const TERRAIN_STEP_CORNER_PROFILE='concave-source-surface-ramp-v1';
const check=(ok,code,message)=>demand(ok,code,'kit.json','/terrainStepCorners',message);
export function buildTerrainStepCornerProfile(options){
  check(options&&typeof options==='object'&&!Array.isArray(options)&&Object.keys(options).length===2
    &&['widthWorld','heightWorld'].every(k=>Object.hasOwn(options,k)),'STEP_CORNER_OPTIONS','Expected explicit bounded corner width and height');
  const value={format:'ai_scene_terrain_step_corners_v1',profile:TERRAIN_STEP_CORNER_PROFILE,...clone(options),segments:16};
  validateTerrainStepCorners(value);return value;
}
export function validateTerrainStepCorners(value){
  check(value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===5
    &&['format','profile','widthWorld','heightWorld','segments'].every(k=>Object.hasOwn(value,k))
    &&value.format==='ai_scene_terrain_step_corners_v1'&&value.profile===TERRAIN_STEP_CORNER_PROFILE
    &&Number.isFinite(value.widthWorld)&&value.widthWorld>=8&&value.widthWorld<=48
    &&Number.isFinite(value.heightWorld)&&value.heightWorld>=4&&value.heightWorld<=Math.min(24,value.widthWorld*.75)
    &&value.segments===16,'STEP_CORNER_PROFILE','Unsupported source-surface ramp profile or dimensions');
  return value;
}

const EPS=1e-6,ratio=v=>v?.numerator/v?.denominator;
export const TERRAIN_STEP_CORNER_LIMITS=Object.freeze({maximumOwners:2048,maximumCorners:2048,
  maximumCandidateComparisons:1048576,maximumProbeComparisons:2097152,maximumCornerMeshes:131072,
  maximumTriangles:262144,capEndFadeWorld:8,capWallOverlapWorld:8,maximumCapFadeWorld:12,capFadeBands:24});
function mesh(){return {positions:[],uvs:[],indices:[]};}
function quad(target,positions,uvs){const n=target.positions.length/2;target.positions.push(...positions.flat());
  target.uvs.push(...uvs.flat());target.indices.push(n,n+1,n+2,n+2,n+1,n+3);}
function surfaceAt(curve,x){const s=curve.surface;if(x<s[0].x-EPS||x>s.at(-1).x+EPS)return Infinity;
  for(let i=0;i<s.length-1;i++)if(x>=s[i].x-EPS&&x<=s[i+1].x+EPS){const a=s[i],b=s[i+1];return a.y+(b.y-a.y)*(x-a.x)/(b.x-a.x);}
  return Infinity;}

// A bounded presentation ramp occupies only the air wedge at a real concave
// ledge/wall meeting. Original logical cells, curve contours and source PNGs
// stay independent. The cap translates source columns; it may shear locally.
export function compileTerrainStepCorners({gridTerrains,curveTerrains,edgePlacement,unionMaterial,appearance,profile,
  surfaceBinding,surfaceInterface,surfaceSpanEnvelope,world,cells=new Map(),grid={width:64,height:64}}, {ownedMeshes=false}={}){
  validateTerrainStepCorners(profile);const L=TERRAIN_STEP_CORNER_LIMITS;
  check(Array.isArray(gridTerrains)&&Array.isArray(curveTerrains)&&cells instanceof Map&&grid.width===64&&grid.height===64
    &&world&&Number.isFinite(world.x)&&Number.isFinite(world.y)&&world.width>0&&world.height>0,'STEP_CORNER_GEOMETRY','Expected validated terrain geometry and world bounds');
  check(Array.isArray(edgePlacement?.placed)&&Array.isArray(unionMaterial?.groups),'STEP_CORNER_GEOMETRY','Corners require the current exposed union reports');
  const outputGrid=ownedMeshes?gridTerrains:gridTerrains.map(clone),
    outputCurves=ownedMeshes?curveTerrains:curveTerrains.map(clone),owners=[...outputGrid,...outputCurves],
    id=owner=>owner.gridTerrainId??owner.curveId,byId=new Map(owners.map((o,i)=>[id(o),{owner:o,index:i}]));
  check(owners.length<=L.maximumOwners,'STEP_CORNER_BUDGET','Too many terrain owners for source-surface ramps');
  const widthPeriod=appearance.bodyPeriod?ratio(appearance.bodyPeriod.width):512,heightPeriod=appearance.bodyPeriod?ratio(appearance.bodyPeriod.height):256,
    capDepth=ratio(appearance.capDepth),capUvEnd=ratio(appearance.capUvEnd);
  check(Number.isFinite(widthPeriod)&&widthPeriod>0&&Number.isFinite(heightPeriod)&&heightPeriod>0
    &&capDepth>0&&capDepth<=128&&capUvEnd>0&&capUvEnd<=1,'STEP_CORNER_MATERIAL','Corners require checked physical body and cap coordinates');
  const report={format:'ai_scene_terrain_step_corner_placement_v1',profile:clone(profile),
    algorithm:'smoothstep-column-translation-source-cap-over-fixed-world-body-v1',
    capEndFadeWorld:L.capEndFadeWorld,capWallOverlapWorld:L.capWallOverlapWorld,capFadeBands:L.capFadeBands,capFadeWorld:Math.min(L.maximumCapFadeWorld,capDepth/2),
    drawOrder:'after-all-terrain-and-native-edges-in-layer',bodyCoordinates:'fixed-world-physical-material-period',
    capProjection:'per-x-vertical-column-translation-local-shear',authorGeometryChanged:false,collisionChanged:false,
    sourcePngChanged:false,sourceAlphaChanged:false,effectiveRenderAlpha:'source-alpha-times-local-coverage',
    limits:{...L},candidateComparisons:0,probeComparisons:0,cornerMeshes:0,triangles:0,placed:[],skipped:[],generationCalls:0,visualAcceptance:'not-assessed'};
  const selectedBySegment=new Map();
  const linearEnd=surfaceBinding?.profile===TERRAIN_STEP_LINEAR_SURFACE_PROFILE;
  if(surfaceBinding){
    validateTerrainStepSurface(surfaceBinding,{appearance,surfaceInterface,surfaceSpanEnvelope,stepCorners:profile});
    report.surfaceBinding=clone(surfaceBinding);
    report.capCoverage='bound-native-lip-continuous-span-reduction-v1';
    report.capFadeWorldScope='legacy-full-cap-only-use-per-corner-surfaceCoverage';
    report.supportProbeDepthWorld=capDepth;
    if(linearEnd){report.endFade=clone(surfaceBinding.endFade);report.alphaDistributionChangedWithinWallOverlap=true;}
    if(surfaceSpanEnvelope)for(const group of unionMaterial.groups){
      const segments=group.exposedNorthSegments,layout=buildTerrainSurfaceSpanEnvelope(segments.map(s=>({a:s.from,b:s.to})),{
        envelope:surfaceSpanEnvelope.options,capEndRow:surfaceInterface.capEndRow,fadeRows:surfaceInterface.fadeRows});
      report.candidateComparisons+=layout.work;
      check(report.candidateComparisons<=L.maximumCandidateComparisons,'STEP_CORNER_BUDGET','Step span topology shares the existing candidate work budget');
      check(canonicalJson(layout.spans)===canonicalJson(group.surfaceSpanEnvelope?.spans),'STEP_SURFACE_SPAN_BINDING',
        'Step coverage must match the already checked shared-surface span selection');
      for(let i=0;i<segments.length;i++)selectedBySegment.set(segments[i],layout.selection[i]);
    }
  }
  const solid=(x,y)=>{
    check(++report.probeComparisons<=L.maximumProbeComparisons,'STEP_CORNER_BUDGET','Corner occupancy checks exceed their budget');
    if(cells.has(`${Math.floor(x/grid.width)},${Math.floor(y/grid.height)}`))return true;
    for(const curve of outputCurves){check(++report.probeComparisons<=L.maximumProbeComparisons,'STEP_CORNER_BUDGET','Corner curve probes exceed their budget');
      if(y>=surfaceAt(curve,x)-EPS&&y<curve.bounds.y+curve.bounds.height-EPS)return true;}
    return false;
  };
  const seen=new Set();
  for(const edge of edgePlacement.placed){
    if(!['left','right'].includes(edge.side)||!Number.isFinite(edge.x)||!Number.isFinite(edge.toY)||edge.toY-edge.fromY<8)continue;
    const direction=edge.side==='left'?-1:1,x=edge.x,y=edge.toY,key=`${edge.side}/${x}/${y}`;if(seen.has(key))continue;
    let match,group;
    for(const g of unionMaterial.groups)for(const span of g.exposedNorthSegments??[]){
      check(++report.candidateComparisons<=L.maximumCandidateComparisons,'STEP_CORNER_BUDGET','Corner boundary matching exceeds its budget');
      const endpoint=edge.side==='left'?span.to:span.from;
      if(Math.abs(endpoint.x-x)>EPS||Math.abs(endpoint.y-y)>EPS||Math.abs(span.from.y-span.to.y)>EPS)continue;
      if(!edge.ownerIds?.some(ownerId=>g.ownerIds.includes(ownerId))||!g.ownerIds.includes(span.ownerId))continue;
      match=span;group=g;break;
    }
    if(!match)continue;seen.add(key);
    const selected=surfaceBinding?(surfaceSpanEnvelope?selectedBySegment.get(match):{
      capEndRow:surfaceInterface.capEndRow,fadeRows:surfaceInterface.fadeRows}):null,
      rowWorld=surfaceBinding?capDepth/(capUvEnd*appearance.cap.pixelSize.height):null,
      coverageDepth=selected?selected.capEndRow*rowWorld:capDepth,
      coverageFade=selected?selected.fadeRows*rowWorld:report.capFadeWorld;
    check(!surfaceBinding||selected,'STEP_SURFACE_SPAN_BINDING','Every ramp needs its adjacent continuous exposed span');
    const available=Math.abs(match.to.x-match.from.x),width=Math.min(profile.widthWorld,available/2),height=Math.min(profile.heightWorld,(y-edge.fromY)/2),
      fromX=x+direction*width,toX=x,left=Math.min(fromX,toX),right=Math.max(fromX,toX),top=y-height,bottom=y+capDepth;
    const skipped=reason=>report.skipped.push({side:edge.side,x,y,reason});
    if(width<8||height<4){skipped('insufficient-ledger-or-wall-span');continue;}
    if(left<world.x-EPS||right>world.x+world.width+EPS||top<world.y-EPS||bottom>world.y+world.height+EPS){skipped('world-boundary');continue;}
    // A whole rectangle around the new wedge must be empty. This deliberately
    // skips more corners than triangle intersection would, rather than missing
    // a thin ceiling between discrete source-projection columns.
    let obstruction=false;
    for(let gy=Math.floor(top/grid.height);gy<Math.ceil(y/grid.height);gy++)for(let gx=Math.floor(left/grid.width);gx<Math.ceil(right/grid.width);gx++){
      check(++report.probeComparisons<=L.maximumProbeComparisons,'STEP_CORNER_BUDGET','Corner air rectangle checks exceed their budget');
      if(cells.has(`${gx},${gy}`)&&Math.min(right,(gx+1)*grid.width)-Math.max(left,gx*grid.width)>EPS
        &&Math.min(y,(gy+1)*grid.height)-Math.max(top,gy*grid.height)>EPS)obstruction=true;
    }
    for(const curve of outputCurves){
      check(++report.probeComparisons<=L.maximumProbeComparisons,'STEP_CORNER_BUDGET','Corner air rectangle curve checks exceed their budget');
      if(curve.bounds.y+curve.bounds.height>top+EPS&&surfaceMinimum(curve.surface,left,right)<y-EPS)obstruction=true;
    }
    if(obstruction){skipped('occupied-air-rectangle');continue;}
    // Remaining probes verify headroom and real supporting source-cap depth.
    let valid=true,invalidReason='blocked-headroom-or-missing-solid-support';
    for(let n=0;n<profile.segments;n++){
      const t=(n+.5)/profile.segments,px=fromX+(x-fromX)*t;
      const lift=height*t*t*(3-2*t);
      if(solid(px,y-height*1.5)||solid(px,y-lift-.5)||!solid(px,y+.5)||!solid(x-direction*.5,y-height*.5)){valid=false;break;}
      for(let k=0;k<3;k++)if(solid(px,y-lift+(lift*(k+.5)/3))){valid=false;invalidReason='occupied-visual-wedge';break;}
      if(!valid)break;
      for(let d=.5;d<capDepth;d+=4)if(!solid(px,y+d)){valid=false;invalidReason='unsupported-cap-depth';break;}
      if(!solid(px,y+capDepth-.5)){valid=false;invalidReason='unsupported-cap-depth';}
      if(!valid)break;
    }
    if(!valid){skipped(invalidReason);continue;}
    const groupOwners=group.ownerIds.map(ownerId=>byId.get(ownerId)).filter(Boolean),draw=groupOwners.sort((a,b)=>a.index-b.index).at(-1);
    if(!draw){skipped('unavailable-draw-owner');continue;}
    const overlapEndX=x-direction*L.capWallOverlapWorld,capLeft=Math.min(left,overlapEndX),capRight=Math.max(right,overlapEndX),
      overlapTop=y-height,overlapBottom=overlapTop+capDepth;
    if(capLeft<world.x-EPS||capRight>world.x+world.width+EPS){skipped('wall-overlap-world-boundary');continue;}
    const groupCells=new Set(),groupCurves=[];
    for(const {owner}of groupOwners)if(owner.gridTerrainId)for(const cell of owner.source.gridCells)groupCells.add(`${cell.x},${cell.y}`);else groupCurves.push(owner);
    const sameGroupSolid=(px,py)=>{
      check(++report.probeComparisons<=L.maximumProbeComparisons,'STEP_CORNER_BUDGET','Wall overlap group checks exceed their budget');
      if(groupCells.has(`${Math.floor(px/grid.width)},${Math.floor(py/grid.height)}`))return true;
      for(const curve of groupCurves){check(++report.probeComparisons<=L.maximumProbeComparisons,'STEP_CORNER_BUDGET','Wall overlap curve checks exceed their budget');
        if(py>=surfaceAt(curve,px)-EPS&&py<curve.bounds.y+curve.bounds.height-EPS)return true;}
      return false;
    };
    // Surface paint can continue onto the already existing wall, but the
    // overlap may not borrow an unrelated terrain owner as its support.
    let overlapSupported=true;
    const overlapColumns=4;
    for(let n=0;n<=overlapColumns;n++){
      const t=n===overlapColumns?1-1e-5:(n+.5)/overlapColumns,px=x+(overlapEndX-x)*t;
      for(let py=overlapTop+.25;py<overlapBottom;py+=4)if(!sameGroupSolid(px,py)){overlapSupported=false;break;}
      if(!sameGroupSolid(px,overlapBottom-.25))overlapSupported=false;
      if(!overlapSupported)break;
    }
    if(!overlapSupported){skipped('unsupported-wall-overlap-same-group');continue;}
    check(report.placed.length<L.maximumCorners,'STEP_CORNER_BUDGET','Too many source-surface ramps');
    const surface=px=>{const t=(px-fromX)/(x-fromX);return y-height*t*t*(3-2*t);},body=mesh(),samples=[];
    for(let n=0;n<=profile.segments;n++){const px=fromX+(x-fromX)*n/profile.segments;samples.push({x:px,y:surface(px)});}
    // Only the new wedge needs body paint. Existing native rocks below the
    // ledge remain visible beneath the surface's bounded source-over coverage.
    for(let n=0;n<profile.segments;n++){const a=samples[n],b=samples[n+1];quad(body,[[a.x,a.y],[a.x,y],[b.x,b.y],[b.x,y]],
      [[a.x/widthPeriod,a.y/heightPeriod],[a.x/widthPeriod,y/heightPeriod],[b.x/widthPeriod,b.y/heightPeriod],[b.x/widthPeriod,y/heightPeriod]]);}
    const cornerId=`step-corner/${edge.side}/${x}/${y}`,newMeshes=[{...body,materialKind:'body',coverageOpacity:1}],
      fade=coverageFade,opaqueEnd=coverageDepth-fade,ranges=[...(opaqueEnd>0?[{from:0,to:opaqueEnd,opacity:1}]:[]),...Array.from({length:fade>0?L.capFadeBands:0},(_,n)=>({
        from:opaqueEnd+fade*n/L.capFadeBands,to:opaqueEnd+fade*(n+1)/L.capFadeBands,opacity:1-(n+.5)/L.capFadeBands}))];
    const capSamples=[...samples,...Array.from({length:overlapColumns},(_,n)=>({x:x+(overlapEndX-x)*(n+1)/overlapColumns,y:y-height}))];
    const wallCap=linearEnd?{...mesh(),vertexCoverage:[]}:null;
    for(const range of ranges)for(let n=0;n<capSamples.length-1;n++){
      const a=capSamples[n],b=capSamples[n+1],m=mesh(),endOpacity=Math.min(1,Math.abs(overlapEndX-(a.x+b.x)/2)/L.capEndFadeWorld);
      const target=linearEnd&&n>=profile.segments?wallCap:m;
      quad(target,[[a.x,a.y+range.from],[a.x,a.y+range.to],[b.x,b.y+range.from],[b.x,b.y+range.to]],
        [[a.x/512,range.from/capDepth*capUvEnd],[a.x/512,range.to/capDepth*capUvEnd],[b.x/512,range.from/capDepth*capUvEnd],[b.x/512,range.to/capDepth*capUvEnd]]);
      if(target===wallCap){
        const at=px=>range.opacity*Math.max(0,Math.min(1,Math.abs(overlapEndX-px)/L.capEndFadeWorld));
        wallCap.vertexCoverage.push(at(a.x),at(a.x),at(b.x),at(b.x));continue;
      }
      newMeshes.push({...m,materialKind:'cap',coverageOpacity:range.opacity*endOpacity,
        sourceLocalDepth:{fromWorld:range.from,toWorld:range.to},capBottomCoverage:range.opacity,capWallEndCoverage:endOpacity});
    }
    if(wallCap){
      check(wallCap.vertexCoverage.length<=surfaceBinding.endFade.maximumVerticesPerMesh,'STEP_CORNER_BUDGET','Linear end fade keeps the original vertex budget');
      newMeshes.push({...wallCap,materialKind:'cap',coverageOpacity:1,coverageInterpolation:'linear-vertex-coverage-v1',
        wallFade:{fromWorld:x,toWorld:overlapEndX,topWorld:overlapTop,depthWorld:coverageDepth},sourceLocalDepth:{fromWorld:0,toWorld:coverageDepth}});
    }
    draw.owner.cornerMeshes??=[];
    for(const m of newMeshes){report.cornerMeshes++;report.triangles+=m.indices.length/3;
      check(report.cornerMeshes<=L.maximumCornerMeshes&&report.triangles<=L.maximumTriangles,'STEP_CORNER_BUDGET','Source-surface ramp meshes exceed their budget');
      draw.owner.cornerMeshes.push({...m,cornerId,sourceOwnerIds:[...group.ownerIds],drawOwnerId:id(draw.owner),
        renderOnlyGeometry:true,logicalBoundary:{x,y},sourcePngChanged:false});}
    report.placed.push({cornerId,side:edge.side,x,y,widthWorld:width,heightWorld:height,samples,drawOwnerId:id(draw.owner),
      sourceOwnerIds:[...group.ownerIds],bodyExtent:'new-air-wedge-only',capExtent:{left:capLeft,right:capRight,top,bottom:surfaceBinding?y+coverageDepth:bottom},
      capWallOverlapWorld:L.capWallOverlapWorld,wallOverlapExtent:{left:Math.min(x,overlapEndX),right:Math.max(x,overlapEndX),top:overlapTop,bottom:surfaceBinding?overlapTop+coverageDepth:overlapBottom},
      ...(surfaceBinding?{surfaceCoverage:{bindingSha256:surfaceBinding.sha256,...clone(selected),overlayDepthWorld:coverageDepth,fadeWorld:coverageFade,
        supportProbeDepthWorld:capDepth,sourceUvDensity:'unchanged-capDepth-capUvEnd',selection:'adjacent-complete-exposed-span-not-ramp-width'}}:{}),
      wallOverlapSupport:'same-connected-owner-group-probed-within-existing-solid',
      authorGeometryChanged:false,collisionChanged:false,sourcePngChanged:false});
  }
  return {gridTerrains:outputGrid,curveTerrains:outputCurves,report};
}
