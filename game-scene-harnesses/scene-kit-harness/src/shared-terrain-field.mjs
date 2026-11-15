import {check,digest,exact,seal,unseal} from './generation/common.mjs';
import {validateTerrainSurfaceInterface} from './terrain-union-material.mjs';

export const SHARED_TERRAIN_FIELD_PROFILE='world-material-occupancy-boundary-v1';
export const SHARED_TERRAIN_UNION_PROFILE='world-material-grid-curve-boundary-v2';
export function supportsSharedTerrainAppearance(appearance, profile) {
  return appearance?.format === 'ai_scene_continuous_terrain_appearance_v6'
    || (profile?.profile === SHARED_TERRAIN_UNION_PROFILE
      && appearance?.format === 'ai_scene_continuous_terrain_appearance_v5');
}
const EPS=1e-8,q=n=>Math.round(n*1e6)/1e6,key=(x,y)=>`${x},${y}`,ratio=v=>v?.numerator/v?.denominator;
const mesh=()=>({positions:[],uvs:[],indices:[]});
const limits={maximumCells:4096,maximumTriangles:262144,maximumClipWork:4194304};
function clip(poly,value){
  const out=[];for(let i=0;i<poly.length;i++){
    const a=poly[i],b=poly[(i+1)%poly.length],da=value(a),db=value(b),ia=da>=-EPS,ib=db>=-EPS;
    if(ia)out.push(a);if(ia!==ib){const t=da/(da-db);out.push({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t});}
  }return out;
}
function area(poly){let a=0;for(let i=0;i<poly.length;i++){const b=poly[(i+1)%poly.length];a+=poly[i].x*b.y-b.x*poly[i].y;}return a/2;}
function append(target,poly,uv,report){
  if(poly.length<3||Math.abs(area(poly))<EPS)return;
  check(report.outputTriangles+poly.length-2<=limits.maximumTriangles,'SHARED_FIELD_BUDGET');
  const start=target.positions.length/2;for(const p of poly){target.positions.push(q(p.x),q(p.y));target.uvs.push(...uv(p).map(q));}
  for(let n=1;n<poly.length-1;n++)target.indices.push(start,start+n,start+n+1);report.outputTriangles+=poly.length-2;
}
function noise(x,y,seed,wavelength){
  x/=wavelength;y/=wavelength;const ix=Math.floor(x),iy=Math.floor(y),f=t=>t*t*(3-2*t),fx=f(x-ix),fy=f(y-iy);
  const h=(a,b)=>{let v=(Math.imul(a,374761393)^Math.imul(b,668265263)^seed)>>>0;v=Math.imul(v^(v>>>13),1274126177)>>>0;return ((v^(v>>>16))>>>0)/4294967295;};
  return (h(ix,iy)*(1-fx)+h(ix+1,iy)*fx)*(1-fy)+(h(ix,iy+1)*(1-fx)+h(ix+1,iy+1)*fx)*fy;
}

export function sharedTerrainInset({maximumInsetWorld,seed,wavelengthWorld},x,y){
  return maximumInsetWorld*(.25+.75*noise(x,y,seed,wavelengthWorld));
}

export function createSharedTerrainFieldProfile(appearance,{outline,surfaceInterface,lighting,curveSideRelief,candidateReview,geometryProfile=SHARED_TERRAIN_FIELD_PROFILE}){
  const profile=seal({format:geometryProfile===SHARED_TERRAIN_UNION_PROFILE?'ai_scene_shared_terrain_field_v2':'ai_scene_shared_terrain_field_v1',profile:geometryProfile,
    bodySourceSha256:appearance.body.source.sha256,capSourceSha256:appearance.cap.source.sha256,outline,surfaceInterface,
    ...(curveSideRelief===undefined?{}:{curveSideRelief}),...(lighting===undefined?{}:{lighting}),
    ...(candidateReview===undefined?{}:{candidateReview})});
  validateSharedTerrainFieldProfile(profile,appearance);return profile;
}
export function validateSharedTerrainFieldProfile(profile,appearance){
  const p=unseal(profile);exact(p,['format','profile','bodySourceSha256','capSourceSha256','outline','surfaceInterface',
    ...['lighting','curveSideRelief','candidateReview'].filter(key=>Object.hasOwn(p,key))]);
  check((p.format==='ai_scene_shared_terrain_field_v1'&&p.profile===SHARED_TERRAIN_FIELD_PROFILE
    ||p.format==='ai_scene_shared_terrain_field_v2'&&p.profile===SHARED_TERRAIN_UNION_PROFILE)
    &&p.bodySourceSha256===appearance?.body?.source?.sha256&&p.capSourceSha256===appearance?.cap?.source?.sha256,'SHARED_FIELD_SOURCE_BINDING');
  exact(p.outline,['maximumInsetWorld','sampleStepWorld','wavelengthWorld','seed']);const o=p.outline;
  check(Number.isFinite(o.maximumInsetWorld)&&o.maximumInsetWorld>=0&&o.maximumInsetWorld<=16
    &&[4,8,16].includes(o.sampleStepWorld)&&Number.isFinite(o.wavelengthWorld)&&o.wavelengthWorld>=32&&o.wavelengthWorld<=512
    &&Number.isSafeInteger(o.seed)&&o.seed>=0&&o.seed<=4294967295,'SHARED_FIELD_OUTLINE');
  check(!Object.hasOwn(p,'curveSideRelief')||p.profile===SHARED_TERRAIN_UNION_PROFILE
    &&p.curveSideRelief==='exposed-inset-v1'&&o.maximumInsetWorld>0,'SHARED_FIELD_CURVE_RELIEF');
  check(!Object.hasOwn(p,'candidateReview')||p.profile===SHARED_TERRAIN_UNION_PROFILE
    &&p.candidateReview==='placement-required-v1','SHARED_FIELD_CANDIDATE_REVIEW');
  if(p.lighting){exact(p.lighting,['bandWorld','fadeBands','leftShade','rightShade','bottomShade']);
    check(Number.isFinite(p.lighting.bandWorld)&&p.lighting.bandWorld>0&&p.lighting.bandWorld<=8
      &&Number.isSafeInteger(p.lighting.fadeBands)&&p.lighting.fadeBands>=1&&p.lighting.fadeBands<=8
      &&['leftShade','rightShade','bottomShade'].every(k=>Number.isFinite(p.lighting[k])&&p.lighting[k]>=.5&&p.lighting[k]<=1),'SHARED_FIELD_LIGHTING');}
  validateTerrainSurfaceInterface(p.surfaceInterface,appearance);return profile;
}

// Experimental presentation geometry, not an extraction or repair of native
// edge artwork. Source pixels and logical occupancy/collision stay independent.
export function compileSharedTerrainFields(cells,{grid,appearance,layerId,profile,curveContacts=[]}){
  validateSharedTerrainFieldProfile(profile,appearance);
  check(Array.isArray(curveContacts)&&curveContacts.length<=2048&&(!curveContacts.length||profile.profile===SHARED_TERRAIN_UNION_PROFILE),'SHARED_FIELD_CONTACT_INPUT');
  let contactWork=0;
  const contact=(x,y)=>curveContacts.some(c=>{
    check(++contactWork<=limits.maximumClipWork,'SHARED_FIELD_BUDGET');
    if(x<c.bounds.x-EPS||x>c.bounds.x+c.bounds.width+EPS||y<c.bounds.y-EPS||y>c.bounds.y+c.bounds.height+EPS)return false;
    const p=c.contour;for(let n=0;n<p.length;n++){
      check(++contactWork<=limits.maximumClipWork,'SHARED_FIELD_BUDGET');const a=p[n],b=p[(n+1)%p.length],dx=b.x-a.x,dy=b.y-a.y,l=dx*dx+dy*dy;
      const t=l?Math.max(0,Math.min(1,((x-a.x)*dx+(y-a.y)*dy)/l)):0;
      if(Math.hypot(x-a.x-t*dx,y-a.y-t*dy)<EPS)return true;
    }return false;
  });
  check(cells instanceof Map&&cells.size<=limits.maximumCells&&grid?.width===64&&grid?.height===64
    &&typeof layerId==='string'&&layerId.length>0,'SHARED_FIELD_INPUT');
  const entries=[...cells.keys()].map(k=>{const [x,y]=k.split(',').map(Number);check(Number.isSafeInteger(x)&&Number.isSafeInteger(y)
    &&Math.abs(x)<=8192&&Math.abs(y)<=8192&&key(x,y)===k,'SHARED_FIELD_CELL');return {x,y};}).sort((a,b)=>a.y-b.y||a.x-b.x),
    o=profile.outline,inset=(x,y)=>contact(x,y)?0:sharedTerrainInset(o,x,y),
    period=appearance.bodyPeriod?{width:ratio(appearance.bodyPeriod.width),height:ratio(appearance.bodyPeriod.height)}:{width:512,height:256},
    origin=appearance.bodyOriginWorldY?ratio(appearance.bodyOriginWorldY):0,
    bodyUv=p=>[p.x/period.width,(p.y-origin)/period.height],capDepth=ratio(appearance.capDepth),capEnd=ratio(appearance.capUvEnd),
    surface=validateTerrainSurfaceInterface(profile.surfaceInterface,appearance),body=mesh(),capBands=[],boundaries=[],lightingBands=new Map(),
    report={format:'ai_scene_shared_terrain_field_report_v1',profileSha256:profile.sha256,inputOccupancySha256:digest(entries),
      bodySourceSha256:profile.bodySourceSha256,capSourceSha256:profile.capSourceSha256,bodyPeriod:period,bodyOriginWorldY:origin,
      cells:entries.length,outputTriangles:0,clipWork:0,maximumInsetWorld:o.maximumInsetWorld,limits,
      collision:'original-author-occupancy-unchanged',exterior:'geometry-intersected-with-original-occupied-cell-union',
      contour:'explicit-design-geometry-not-inferred-native-alpha',bodyMapping:'fixed-world-no-per-cell-or-component-phase',
      originalPngChanged:false,sourceAlphaChanged:false,sourcePixelsRecolored:false,...(profile.lighting?{renderRgbModulated:true,lighting:profile.lighting}:{}),visualAcceptance:'not-assessed',generationCalls:0};
  check(period.width>0&&period.height>0&&Number.isFinite(origin),'SHARED_FIELD_MATERIAL');
  const vertex=(vx,vy,cx,cy)=>{
    const quadrants=[[-1,-1],[1,-1],[1,1],[-1,1]],occupied=quadrants.filter(([dx,dy])=>cells.has(key(vx+(dx<0?-1:0),vy+(dy<0?-1:0))));
    if(occupied.length===4)return {x:vx*64,y:vy*64};
    let dx=Math.sign(occupied.reduce((n,p)=>n+p[0],0)),dy=Math.sign(occupied.reduce((n,p)=>n+p[1],0));
    if(occupied.length===2&&!dx&&!dy){dx=Math.sign(cx-vx+.5);dy=Math.sign(cy-vy+.5);}
    const d=inset(vx*64,vy*64);return {x:vx*64+dx*d,y:vy*64+dy*d};
  };
  function occupiedPieces(triangle){
    const pieces=[],xs=triangle.map(p=>p.x),ys=triangle.map(p=>p.y);
    for(let y=Math.floor(Math.min(...ys)/64);y<=Math.floor((Math.max(...ys)-EPS)/64);y++)for(let x=Math.floor(Math.min(...xs)/64);x<=Math.floor((Math.max(...xs)-EPS)/64);x++){
      check(++report.clipWork<=limits.maximumClipWork,'SHARED_FIELD_BUDGET');if(!cells.has(key(x,y)))continue;
      let p=triangle;for(const test of [v=>v.x-x*64,v=>(x+1)*64-v.x,v=>v.y-y*64,v=>(y+1)*64-v.y])p=clip(p,test);
      if(p.length>=3&&Math.abs(area(p))>EPS)pieces.push(p);
    }return pieces;
  }
  for(const {x,y}of entries){
    const corners=[[x,y],[x+1,y],[x+1,y+1],[x,y+1]].map(([vx,vy])=>vertex(vx,vy,x,y)),
      directions=[[0,-1],[1,0],[0,1],[-1,0]],poly=[],north=[],localEdges=[];
    for(let side=0;side<4;side++){
      const a=corners[side],b=corners[(side+1)%4],[dx,dy]=directions[side],exposed=!cells.has(key(x+dx,y+dy)),points=[];
      const count=64/o.sampleStepWorld;
      for(let n=0;n<=count;n++){
        const t=n/count,p={x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t};
        if(exposed&&n>0&&n<count){
          if(side===0||side===2)p.y=(side===0?y:y+1)*64-dy*inset(p.x,(side===0?y:y+1)*64);
          else p.x=(side===3?x:x+1)*64-dx*inset((side===3?x:x+1)*64,p.y);
        }
        points.push(p);if(n<count)poly.push(p);
      }
      if(exposed){for(let n=0;n<points.length-1;n++){const edge={direction:['n','e','s','w'][side],a:points[n],b:points[n+1]};boundaries.push(edge);
        if(!contact((edge.a.x+edge.b.x)/2,(edge.a.y+edge.b.y)/2)){localEdges.push(edge);if(side===0)north.push(edge);}}}
    }
    const center={x:(x+.5)*64,y:(y+.5)*64},pieces=[];
    for(let n=0;n<poly.length;n++)for(const p of occupiedPieces([center,poly[n],poly[(n+1)%poly.length]])){append(body,p,bodyUv,report);pieces.push(p);}
    if(profile.lighting)for(const edge of localEdges.filter(e=>e.direction!=='n')){
      const light=profile.lighting,vertical=edge.direction!=='s',axis=vertical?'y':'x',other=vertical?'x':'y',a=edge.a[axis]<=edge.b[axis]?edge.a:edge.b,b=a===edge.a?edge.b:edge.a,
        line=p=>a[other]+(b[other]-a[other])*(p[axis]-a[axis])/(b[axis]-a[axis]),sign=edge.direction==='w'?1:-1,
        shade=light[edge.direction==='w'?'leftShade':edge.direction==='e'?'rightShade':'bottomShade'],channel=Math.round(shade*255),shadeTint=channel*0x010101;
      for(let band=0;band<light.fadeBands;band++){
        const id=edge.direction+'/'+band;let target=lightingBands.get(id);
        if(!target){target={...mesh(),direction:edge.direction,shadeTint,coverageOpacity:q(1-(band+.5)/light.fadeBands)};lightingBands.set(id,target);}
        const from=light.bandWorld*band/light.fadeBands,to=light.bandWorld*(band+1)/light.fadeBands;
        for(const original of pieces){
          check(++report.clipWork<=limits.maximumClipWork,'SHARED_FIELD_BUDGET');let p=original;
          for(const test of [p=>p[axis]-a[axis],p=>b[axis]-p[axis],p=>sign*(p[other]-line(p))-from,p=>to-sign*(p[other]-line(p))])p=clip(p,test);
          append(target,p,bodyUv,report);
        }
      }
    }
    for(const edge of north){
      const {a,b}=edge,top=point=>a.y+(b.y-a.y)*(point.x-a.x)/(b.x-a.x),fade=surface.fadeWorld,
        ranges=[{from:0,to:surface.overlayDepthWorld-fade,opacity:1},...(fade>0?Array.from({length:4},(_,i)=>({from:surface.overlayDepthWorld-fade+fade*i/4,to:surface.overlayDepthWorld-fade+fade*(i+1)/4,opacity:1-(i+.5)/4})):[])];
      for(const range of ranges){if(range.to-range.from<EPS)continue;const band=mesh();
        for(const original of pieces){
          if(Math.max(...original.map(p=>p.x))<a.x-EPS||Math.min(...original.map(p=>p.x))>b.x+EPS
            ||Math.min(...original.map(p=>p.y))>Math.max(a.y,b.y)+range.to+EPS)continue;
          check(++report.clipWork<=limits.maximumClipWork,'SHARED_FIELD_BUDGET');let p=original;
          for(const test of [p=>p.x-a.x,p=>b.x-p.x,p=>p.y-top(p)-range.from,p=>range.to-p.y+top(p)])p=clip(p,test);
          append(band,p,p=>[p.x/512,(p.y-top(p))/capDepth*capEnd],report);
        }
        if(band.indices.length)capBands.push({...band,coverageOpacity:q(range.opacity),coverageProfile:'shared-field-native-surface-depth-v1'});
      }
    }
  }
  const patches=entries.length?[{gridTerrainId:'shared-field',layerId,source:{gridCells:entries},body,cap:mesh(),capBands,
    ...(profile.lighting?{fieldBoundaryBands:[...lightingBands.values()].filter(m=>m.indices.length)}:{}),
    bounds:{x:Math.min(...entries.map(p=>p.x))*64,y:Math.min(...entries.map(p=>p.y))*64,
      width:(Math.max(...entries.map(p=>p.x))-Math.min(...entries.map(p=>p.x))+1)*64,height:(Math.max(...entries.map(p=>p.y))-Math.min(...entries.map(p=>p.y))+1)*64},
    geometry:profile.profile,materialMapping:{bodyMapping:'fixed-world-source-scale-period-v1',bodyPeriod:period},
    visualAcceptance:'not-assessed',generationCalls:0}]:[];
  return {gridTerrains:patches,boundaries,report:seal(report)};
}
