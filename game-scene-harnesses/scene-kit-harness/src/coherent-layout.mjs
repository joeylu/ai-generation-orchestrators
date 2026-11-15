import {check,exact,hash,seal,unseal,digest,id,text} from './generation/common.mjs';
import {coherentRole,envelopeBounds} from './generation/coherent-source.mjs';

const q=value=>Math.round(value*1000000)/1000000;
const terrainSurface=(target,surface)=>target.instances.some(instance=>instance.instanceId===surface.instanceId&&coherentRole(instance.role)==='ground');

// Explicit author calibration, never a rewrite of accepted observations. The
// existing curve/editor constraints still apply to every selected control point.
export function createCoherentSurfaceCalibration(target,{calibrationId,maximumDeviationWorld,surfaces,notes,endpointPolicy}){
  const quantized=endpointPolicy!==undefined;
  check(!quantized||endpointPolicy==='inward-integer-world-v1','COHERENT_CALIBRATION_ENDPOINT_POLICY');
  const record=seal({format:quantized?'ai_scene_coherent_surface_calibration_v2':'ai_scene_coherent_surface_calibration_v1',profile:'bounded-authored-surface-calibration-v1',
    calibrationId,targetSha256:target.sha256,observationsSha256:digest(target.surfaces),maximumDeviationWorld,surfaces,notes,
    ...(quantized?{endpointPolicy}:{})});
  calibratedCoherentTarget(target,record);return record;
}
export function calibratedCoherentTarget(target,record){
  if(!record)return target;unseal(target);const v=unseal(record);
  const quantized=v.format==='ai_scene_coherent_surface_calibration_v2';
  exact(v,['format','profile','calibrationId','targetSha256','observationsSha256','maximumDeviationWorld','surfaces','notes',...(quantized?['endpointPolicy']:[])]);
  check(!quantized||v.endpointPolicy==='inward-integer-world-v1','COHERENT_CALIBRATION_ENDPOINT_POLICY');
  id(v.calibrationId);text(v.notes,{limit:2000});
  check((quantized||v.format==='ai_scene_coherent_surface_calibration_v1')&&v.profile==='bounded-authored-surface-calibration-v1'
    &&v.targetSha256===target.sha256&&v.observationsSha256===digest(target.surfaces)
    &&Number.isFinite(v.maximumDeviationWorld)&&v.maximumDeviationWorld>0&&v.maximumDeviationWorld<=32,'COHERENT_CALIBRATION_BINDING');
  const ground=target.surfaces.filter(s=>terrainSurface(target,s)),seen=new Set(),byId=new Map();
  check(Array.isArray(v.surfaces)&&v.surfaces.length===ground.length,'COHERENT_CALIBRATION_COVERAGE');
  const lineY=(points,x)=>{const i=points.findIndex((p,i)=>i<points.length-1&&x>=p.x&&x<=points[i+1].x),a=points[i],b=points[i+1];return a.y+(b.y-a.y)*(x-a.x)/(b.x-a.x);};
  for(const row of v.surfaces){exact(row,['surfaceId','points']);const original=ground.find(s=>s.surfaceId===row.surfaceId);check(original&&!seen.has(row.surfaceId),'COHERENT_CALIBRATION_COVERAGE');seen.add(row.surfaceId);
    check(Array.isArray(row.points)&&row.points.length>=2&&row.points.length<=32&&row.points.every(p=>{exact(p,['x','y']);return Number.isInteger(p.x)&&Number.isInteger(p.y)&&p.x>=0&&p.x<=target.mapping.viewport.width&&p.y>=0&&p.y<=target.mapping.viewport.height-16;}),'COHERENT_CALIBRATION_POINTS');
    coherentSurfacePoints(row);
    if(quantized){
      // Only remove the fractional edge sliver. Never add solid occupancy to air.
      const left=Math.ceil(original.points[0].x),right=Math.floor(original.points.at(-1).x);
      check(left<right&&digest(row.points[0])===digest({x:left,y:Math.round(lineY(original.points,left))})
        &&digest(row.points.at(-1))===digest({x:right,y:Math.round(lineY(original.points,right))}),'COHERENT_CALIBRATION_ENDPOINTS');
    }else check(digest(row.points[0])===digest(original.points[0])&&digest(row.points.at(-1))===digest(original.points.at(-1)),'COHERENT_CALIBRATION_ENDPOINTS');
    // A difference of linear segments is extremal at an input breakpoint.
    const xs=new Set([...row.points,...original.points].map(p=>p.x).filter(x=>x>=row.points[0].x&&x<=row.points.at(-1).x));
    for(const x of xs)check(Math.abs(lineY(row.points,x)-lineY(original.points,x))<=v.maximumDeviationWorld,'COHERENT_CALIBRATION_DEVIATION');
    byId.set(row.surfaceId,{...original,points:row.points});
  }
  return {...target,surfaces:target.surfaces.map(s=>byId.get(s.surfaceId)??s)};
}

// These points retain every reviewed observation. A short interval is rejected,
// rather than silently dropping a point or inventing a more detailed outline.
export function coherentSurfacePoints(surface){
  check(Array.isArray(surface?.points)&&surface.points.length>=2,'COHERENT_LAYOUT_SURFACE');
  const points=surface.points;
  check(points.every(point=>Number.isInteger(point.x)&&Number.isInteger(point.y)),'COHERENT_LAYOUT_SURFACE');
  check(points.every((point,index)=>!index||point.x-points[index-1].x>=32),'COHERENT_LAYOUT_POINT_SPACING');
  return points.map((point,index)=>{
    let slope=0;
    if(index>0&&index<points.length-1){
      const before=(point.y-points[index-1].y)/(point.x-points[index-1].x),after=(points[index+1].y-point.y)/(points[index+1].x-point.x);
      if(before*after>0)slope=Math.sign(before)*Math.min(2,Math.abs(before),Math.abs(after));
    }
    return {x:point.x,y:point.y,slope:q(slope)};
  });
}

export function coherentSurfaceY(surface,x){
  const points=coherentSurfacePoints(surface);
  check(Number.isFinite(x)&&x>=points[0].x&&x<=points.at(-1).x,'COHERENT_CONTACT_DOMAIN');
  const index=points.findIndex((point,i)=>i<points.length-1&&x>=point.x&&x<=points[i+1].x),a=points[index],b=points[index+1];
  const dx=b.x-a.x,t=(x-a.x)/dx;
  return q((2*t*t*t-3*t*t+1)*a.y+(t*t*t-2*t*t+t)*dx*a.slope+(-2*t*t*t+3*t*t)*b.y+(t*t*t-t*t)*dx*b.slope);
}

export function coherentTerrainLayout(target,familyId='terrain.primary',calibration=null){
  const observed=target;target=calibratedCoherentTarget(target,calibration);
  const viewport=target.mapping?.viewport;
  check(viewport&&Number.isInteger(viewport.width)&&Number.isInteger(viewport.height),'COHERENT_LAYOUT_VIEWPORT');
  const curveTerrains=[],sources=[];
  for(const instance of target.instances.filter(instance=>coherentRole(instance.role)==='ground')){
    const surfaces=target.surfaces.filter(surface=>surface.instanceId===instance.instanceId);
    check(surfaces.length>0,'COHERENT_GROUND_SURFACE');
    for(const surface of surfaces){
      const points=coherentSurfacePoints(surface),left=points[0].x,right=points.at(-1).x;
      check(left>=0&&right<=viewport.width&&points.every(point=>point.y>=0&&point.y<=viewport.height-16),'COHERENT_LAYOUT_SURFACE_BOUNDS');
      const curveId='surface.'+hash(Buffer.from(surface.surfaceId)).slice(0,16);
      curveTerrains.push({curveId,familyId,profile:'sideview-height-curve-v1',points,baseY:viewport.height});
      sources.push({instanceId:instance.instanceId,surfaceId:surface.surfaceId,curveId,
        observedPoints:observed.surfaces.find(s=>s.surfaceId===surface.surfaceId).points,...(calibration?{authoredPoints:surface.points}:{}),worldSpan:{left,right},baseY:viewport.height,
        avoidedGridExpansion:{left:q(left-Math.floor(left/64)*64),right:q(Math.ceil(right/64)*64-right)}});
    }
  }
  check(new Set(curveTerrains.map(curve=>curve.curveId)).size===curveTerrains.length,'COHERENT_LAYOUT_DUPLICATE_SURFACE');
  return {curveTerrains,report:seal({format:'ai_scene_coherent_surface_layout_v1',targetSha256:target.sha256,
    policy:'reviewed-surface-curves-v1',surfaceInterpolation:'monotone-limited-hermite-v1',sources,...(calibration?{surfaceCalibrationSha256:calibration.sha256,contour:'explicit-bounded-author-calibration-not-exact-observation'}:{}),
    sidewalls:'vertical-at-reviewed-surface-endpoints',unseenOutlineReconstructed:false,
    gridSnapApplied:false,generationCalls:0,visualAcceptance:'not-assessed'})};
}

export function validateCoherentContacts(contacts,target,transforms=new Map()){
  check(Array.isArray(contacts)&&contacts.length<=24,'COHERENT_COMPOSITION_CONTACTS');
  const seen=new Set();
  for(const contact of contacts){
    exact(contact,['instanceId','surfaceId','atX','sourceAnchor']);
    const instance=target.instances.find(instance=>instance.instanceId===contact.instanceId),surface=target.surfaces?.find(surface=>surface.surfaceId===contact.surfaceId);
    check(instance&&['scenery','landmark'].includes(coherentRole(instance.role))&&!seen.has(contact.instanceId)
      &&!transforms.has(contact.instanceId),'COHERENT_CONTACT_INSTANCE');
    check(surface&&terrainSurface(target,surface)&&contact.sourceAnchor==='content-bottom-center','COHERENT_CONTACT_SURFACE');
    coherentSurfaceY(surface,contact.atX);seen.add(contact.instanceId);
  }
  return new Map(contacts.map(contact=>[contact.instanceId,contact]));
}

// This is a documented placement convention, not semantic root/foundation
// detection. Wide vistas and buildings with distant footings stay independent.
export function suggestCoherentContacts(target){
  const contacts=[];
  for(const instance of target.instances.filter(instance=>['scenery','landmark'].includes(coherentRole(instance.role)))){
    const box=envelopeBounds(instance.visibleEnvelope),atX=q(box.x+box.width/2),bottom=box.y+box.height;
    const candidates=[];
    for(const surface of target.surfaces.filter(surface=>terrainSurface(target,surface))){
      const points=coherentSurfacePoints(surface);
      if(atX<points[0].x||atX>points.at(-1).x)continue;
      const distance=Math.abs(coherentSurfaceY(surface,atX)-bottom);
      if(distance<=32)candidates.push({surface,distance});
    }
    candidates.sort((a,b)=>a.distance-b.distance||a.surface.surfaceId.localeCompare(b.surface.surfaceId));
    if(candidates.length)contacts.push({instanceId:instance.instanceId,surfaceId:candidates[0].surface.surfaceId,atX,sourceAnchor:'content-bottom-center'});
  }
  return contacts;
}

export function coherentContactPlacement(contact,target,logicalContentSize){
  validateCoherentContacts([contact],target);
  const {width,height}=logicalContentSize;
  check([width,height].every(value=>Number.isFinite(value)&&value>0&&value<=16384),'COHERENT_CONTACT_SIZE');
  const atY=coherentSurfaceY(target.surfaces.find(surface=>surface.surfaceId===contact.surfaceId),contact.atX);
  const position={x:q(contact.atX-width/2),y:q(atY-height)};
  return {position,evidence:seal({format:'ai_scene_coherent_contact_placement_v1',targetSha256:target.sha256,contact,
    policy:'declared-content-bottom-center-to-reviewed-surface-v1',semanticAnchorDetected:false,
    logicalContentSize:{width,height},worldContact:{x:contact.atX,y:atY},position,
    sourcePngModified:false,generationCalls:0,visualAcceptance:'not-assessed'})};
}
