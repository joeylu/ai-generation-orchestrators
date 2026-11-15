import {findCurveEndpointJoin} from '../curve-join.mjs';
import {curveBezier,CURVE_PROFILE} from '../curves.mjs';
import {compareText} from '../document.mjs';

export const TERRAIN_BASE_SNAP_POLICY=Object.freeze({profile:'terrain-base-snap-v1',screenRadius:12,maximumBaseDistance:8,maximumSideDistance:64});
const radius=scale=>scale>0?Math.min(TERRAIN_BASE_SNAP_POLICY.maximumBaseDistance,TERRAIN_BASE_SNAP_POLICY.screenRadius/scale):0;

// Snap a whole moving piece by translation, preserving its shape and grid phase.
export function snapTerrainBase(document,region,delta,{grid,worldBounds,scale}) {
  const limit=radius(scale);if(!limit||!region.curveIds.length)return {delta,snap:null};
  const moving=document.curveTerrains.filter(c=>region.curveIds.includes(c.curveId)),stationary=document.curveTerrains.filter(c=>!region.curveIds.includes(c.curveId));
  const sides=Math.min(TERRAIN_BASE_SNAP_POLICY.maximumSideDistance,TERRAIN_BASE_SNAP_POLICY.screenRadius/scale),candidates=[];
  function candidate(curve,y,kind,target,sideDistance=0) {
    const correction=y-(curve.baseY+delta.dy),dy=delta.dy+correction,b=region.bounds;
    if(Math.abs(correction)>limit||!Number.isSafeInteger(dy)||(region.cells.length&&dy%grid.height!==0))return;
    if(b.y+dy<worldBounds.y||b.y+b.height+dy>worldBounds.y+worldBounds.height)return;
    if(moving.some(c=>c.points.slice(1).some((p,i)=>curveBezier(c.points[i],p).some(p=>p.y+dy<worldBounds.y))))return;
    candidates.push({delta:{...delta,dy:dy||0},snap:{kind,y,curveId:curve.curveId,targetCurveId:target?.curveId,
      xFrom:Math.min(b.x+delta.dx,target?.points.at(-1).x??Infinity),xTo:Math.max(b.x+b.width+delta.dx,target?.points[0].x??-Infinity)},correction:Math.abs(correction),sideDistance});
  }
  for(const curve of moving) {
    for(const target of stationary) {
      if(curve.familyId!==target.familyId||curve.profile!==target.profile)continue;
      const gap=Math.min(Math.abs(curve.points[0].x+delta.dx-target.points.at(-1).x),Math.abs(curve.points.at(-1).x+delta.dx-target.points[0].x));
      if(gap<=sides)candidate(curve,target.baseY,'neighbor',target,gap);
    }
    candidate(curve,worldBounds.y+worldBounds.height,'map');
  }
  candidates.sort((a,b)=>Number(a.snap.kind==='map')-Number(b.snap.kind==='map')||a.correction-b.correction||a.sideDistance-b.sideDistance||compareText(a.snap.targetCurveId??'',b.snap.targetCurveId??''));
  const best=candidates[0];return best?{delta:best.delta,snap:best.snap}:{delta,snap:null};
}

// The core join command remains strict. Only the small, explicitly previewed
// correction is put into its complete curve author before the one submission.
export function findCurveJoinWithBaseSnap(document,moved,index,scale) {
  const original=findCurveEndpointJoin(document,moved,index,scale);
  if(original?.blocked!=='CURVE_JOIN_BASE')return original;
  const target=document.curveTerrains.find(c=>c.curveId===original.targetCurveId);
  if(Math.abs(moved.baseY-target.baseY)>radius(scale)||moved.familyId!==target.familyId||moved.profile!==target.profile)return original;
  const sourceLinked=document.terrainConnections?.some(c=>c.curveId===moved.curveId),targetLinked=document.terrainConnections?.some(c=>c.curveId===target.curveId);
  if(sourceLinked&&targetLinked)return original;
  const y=sourceLinked?moved.baseY:target.baseY,adjusted={...(sourceLinked?target:moved),baseY:y};
  if(adjusted.points.slice(1).some((p,i)=>curveBezier(adjusted.points[i],p).some(p=>p.y>y-CURVE_PROFILE.minimumDepth)))return original;
  const adjustedDocument=sourceLinked?{...document,curveTerrains:document.curveTerrains.map(c=>c.curveId===target.curveId?adjusted:c)}:document;
  const join=findCurveEndpointJoin(adjustedDocument,sourceLinked?moved:adjusted,index,scale);
  if(!join||join.blocked)return original;
  return {...join,...(sourceLinked?{commands:[{type:'replace-curve-terrain',curve:adjusted},join.command]}:{}),baseSnap:{kind:'neighbor',y,curveId:adjusted.curveId,targetCurveId:target.curveId,
    xFrom:Math.min(moved.points[0].x,target.points[0].x),xTo:Math.max(moved.points.at(-1).x,target.points.at(-1).x)}};
}
