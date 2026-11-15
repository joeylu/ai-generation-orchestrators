import {demand} from './errors.mjs';
import {deepFreeze} from './document.mjs';
import {cellKey} from './topology.mjs';

export const GRID_TERRAIN_FIELD_PROFILE=deepFreeze({profile:'grid-solid-union-continuous-field-v1',
  grid:64,maximumCells:100000,body:'exact-cell-union-quads',cap:'exposed-north-faces-only',
  bodyMapping:'column-solid-run-surface-depth-v1',capMapping:'world-x-512-v1',
  collision:'original-grid-cells-unchanged',holes:'preserved-no-rectangular-hull',
  source:'current-validated-measured-material-fields',visualAcceptance:'not-assessed'});
const check=(value,code,message)=>demand(value,code,'scene.document.json','/terrainRuns',message);
const ratio=value=>value?.numerator/value?.denominator;
const order=(a,b)=>a.y-b.y||a.x-b.x;
function mesh(){return {positions:[],uvs:[],indices:[]};}
function rectangle(target,x0,y0,x1,y1,u0,v0,u1,v1){
  const start=target.positions.length/2;
  target.positions.push(x0,y0,x0,y1,x1,y0,x1,y1);target.uvs.push(u0,v0,u0,v1,u1,v0,u1,v1);
  target.indices.push(start,start+1,start+2,start+2,start+1,start+3);
}

// The original occupancy owns topology and collision. This function changes
// presentation only; it does not turn cells into author curves, fill holes,
// expand attached platform skins, or infer a different painted silhouette.
export function compileGridTerrainFields(cells,{grid,appearance,layerId,excludedCells=new Set()}={}){
  check(cells instanceof Map&&cells.size<=GRID_TERRAIN_FIELD_PROFILE.maximumCells&&excludedCells instanceof Set,
    'GRID_FIELD_CELLS','Grid fields require bounded validated occupancy and an explicit exclusion set');
  if(!cells.size||[...cells.keys()].every(key=>excludedCells.has(key)))return [];
  check(grid?.width===64&&grid?.height===64&&typeof layerId==='string'&&layerId.length>0,
    'GRID_FIELD_GEOMETRY','Continuous grid material uses the existing 64-unit author grid');
  const dense=appearance?.format==='ai_scene_continuous_terrain_appearance_v6';
  check(dense||appearance?.format==='ai_scene_continuous_terrain_appearance_v5','GRID_FIELD_MATERIAL','Grid fields require the current measured body and surface material');
  const normalization=dense?506:253,origin=ratio(appearance.surfaceOriginInBodyPixels)/normalization,
    capDepth=ratio(appearance.capDepth),capUvEnd=ratio(appearance.capUvEnd);
  check(Number.isFinite(origin)&&Number.isFinite(capDepth)&&capDepth>0&&capDepth<=128
    &&Number.isFinite(capUvEnd)&&capUvEnd>0&&capUvEnd<=1,'GRID_FIELD_MATERIAL','Measured source origin and coverage must remain finite and bounded');
  const entries=[...cells].map(([key,familyId])=>{
    const [x,y]=key.split(',').map(Number);
    check(Number.isSafeInteger(x)&&Number.isSafeInteger(y)&&key===cellKey(x,y),'GRID_FIELD_CELL','Grid cells use canonical integer coordinates');
    return {key,x,y,familyId};
  }).sort(order),byColumn=new Map(),runForCell=new Map();
  for(const entry of entries){if(!byColumn.has(entry.x))byColumn.set(entry.x,[]);byColumn.get(entry.x).push(entry);}
  // Include excluded cells while finding a column's original solid run. This
  // avoids adding a fake north surface where a skin or other owner still sits.
  for(const column of byColumn.values()){
    let current=[];
    const finish=()=>{if(!current.length)return;const top=current[0].y*grid.height,bottom=(current.at(-1).y+1)*grid.height;
      for(const entry of current)runForCell.set(entry.key,{top,bottom});current=[];};
    for(const entry of column){if(current.length&&entry.y!==current.at(-1).y+1)finish();current.push(entry);}finish();
  }
  const available=new Map(entries.filter(entry=>!excludedCells.has(entry.key)).map(entry=>[entry.key,entry])),unseen=new Set(available.keys()),patches=[];
  for(const first of entries){
    if(!unseen.delete(first.key))continue;
    const queue=[first.key],component=[];
    for(let cursor=0;cursor<queue.length;cursor++){
      const entry=available.get(queue[cursor]);component.push(entry);
      for(const [dx,dy]of [[1,0],[-1,0],[0,-1],[0,1]]){
        const next=cellKey(entry.x+dx,entry.y+dy);if(unseen.delete(next))queue.push(next);
      }
    }
    component.sort(order);const body=mesh(),cap=mesh(),north=new Map();
    let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
    for(const entry of component){
      const x0=entry.x*grid.width,x1=x0+grid.width,y0=entry.y*grid.height,y1=y0+grid.height,run=runForCell.get(entry.key);
      minX=Math.min(minX,x0);minY=Math.min(minY,y0);maxX=Math.max(maxX,x1);maxY=Math.max(maxY,y1);
      rectangle(body,x0,y0,x1,y1,x0/512,origin+(y0-run.top)/256,x1/512,origin+(y1-run.top)/256);
      if(!cells.has(cellKey(entry.x,entry.y-1))){
        let continuousDepth=grid.height;
        while(continuousDepth<capDepth&&available.has(cellKey(entry.x,entry.y+continuousDepth/grid.height)))continuousDepth+=grid.height;
        const depth=Math.min(capDepth,continuousDepth);
        rectangle(cap,x0,y0,x1,y0+depth,x0/512,0,x1/512,capUvEnd*depth/capDepth);
        if(!north.has(y0))north.set(y0,[]);north.get(y0).push({x0,x1});
      }
    }
    const surfaceSpans=[];
    for(const [y,spans]of [...north].sort(([a],[b])=>a-b)){
      spans.sort((a,b)=>a.x0-b.x0);let merged;
      for(const span of spans){
        if(merged&&merged.to.x===span.x0)merged.to.x=span.x1;
        else {merged={from:{x:span.x0,y},to:{x:span.x1,y}};surfaceSpans.push(merged);}
      }
    }
    const anchor=component[0];
    patches.push({gridTerrainId:`grid-field/${anchor.x},${anchor.y}`,layerId,profile:GRID_TERRAIN_FIELD_PROFILE,
      source:{gridCells:component.map(({x,y})=>({x,y}))},body,cap,surfaceSpans,
      bounds:{x:minX,y:minY,width:maxX-minX,height:maxY-minY},
      materialMapping:{format:'ai_scene_world_material_mapping_v1',bodyPeriod:{width:512,height:256},capPeriod:512,
        bodyMapping:GRID_TERRAIN_FIELD_PROFILE.bodyMapping,capMapping:'world-x-512-v1',
        surfaceOriginInBodyPixels:structuredClone(appearance.surfaceOriginInBodyPixels),sourceOriginNormalizationHeight:normalization,
        surfaceMappingSha256:appearance.surfaceMappingSha256,capUvEnd:structuredClone(appearance.capUvEnd)},
      geometry:'exact-four-connected-cell-union-no-hole-fill',stepPhase:'local-column-surface-depth-not-art-seam-certified',
      visualAcceptance:'not-assessed',generationCalls:0});
  }
  return patches;
}
