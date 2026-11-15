import { demand } from './errors.mjs';
import { deepFreeze, compareText } from './document.mjs';
import { cellKey } from './topology.mjs';
import { compileCurveGeometry,CURVE_PROFILE } from './curves.mjs';
import { curveEndpoint, CURVE_JOIN_POLICY } from './curve-join.mjs';

export const MIXED_TERRAIN_PROFILE = deepFreeze({ profile:'rectangular-grid-height-curve-v1',
  grid:64, maximumSpan:8192, texturePeriod:256, capWidth:8,
  body:'world-coordinate-field', cap:'continuous-chain-distance', collision:'one-closed-height-contour',
  sampling:{maximumFlatness:CURVE_PROFILE.maximumFlatness,maximumChord:CURVE_PROFILE.maximumChord,
    maximumDepth:CURVE_PROFILE.maximumDepth,maximumSamples:CURVE_PROFILE.maximumSamples,quantization:CURVE_PROFILE.quantization},
  gridShape:'complete-four-connected-rectangle', authorCells:'preserved', visualAcceptance:'not-assessed' });
const check=(condition,code,message)=>demand(condition,code,'scene.document.json','/terrainConnections',message);
const endpointPoint=(curve,endpoint)=>endpoint==='start'?curve.points[0]:curve.points.at(-1);
export function gridRectangles(cells) {
  const unseen=new Set(cells.keys()), components=[], byCell=new Map();
  for(const key of cells.keys()){
    if(!unseen.delete(key))continue;
    const queue=[key], entries=[];let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity;
    for(let cursor=0;cursor<queue.length;cursor++){
      const key=queue[cursor],[x,y]=key.split(',').map(Number);entries.push({x,y});
      minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);
      for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){const next=cellKey(x+dx,y+dy);if(unseen.delete(next))queue.push(next);}
    }
    entries.sort((a,b)=>a.y-b.y||a.x-b.x);
    const component={id:`grid/${minX},${minY}`,cells:entries,minX,maxX,minY,maxY,
      rectangular:entries.length===(maxX-minX+1)*(maxY-minY+1),familyId:cells.get(key)};
    components.push(component);for(const cell of entries)byCell.set(cellKey(cell.x,cell.y),component);
  }
  return {components,byCell};
}
export function gridConnectionTargets(scene) {
  if(scene.grid.width!==64||scene.grid.height!==64)return [];
  const cells=new Map(scene.layers.filter(layer=>layer.kind==='terrain').flatMap(layer=>layer.nodes).map(node=>[cellKey(node.cell.x,node.cell.y),'primary']));
  return gridRectangles(cells).components.filter(c=>c.rectangular).flatMap(c=>[
    {endpoint:'start',cell:{x:c.maxX,y:c.minY},x:(c.maxX+1)*64,y:c.minY*64,baseY:(c.maxY+1)*64},
    {endpoint:'end',cell:{x:c.minX,y:c.minY},x:c.minX*64,y:c.minY*64,baseY:(c.maxY+1)*64},
  ]);
}
export function connectCurveToGrid(document, moved, endpoint, cell, cells) {
  check(['start','end'].includes(endpoint),'GRID_CONNECTION_ENDPOINT','Choose a curve endpoint');
  check(document.curveTerrains.some(c=>c.curveId===moved?.curveId),'CURVE_MISSING','Curve does not exist');
  check(!document.terrainConnections?.some(c=>c.curveId===moved.curveId&&c.endpoint===endpoint),'GRID_CONNECTION_LOCKED','Disconnect the endpoint before moving it');
  const rectangle=gridRectangles(cells).byCell.get(cellKey(cell.x,cell.y));
  check(rectangle?.rectangular,'GRID_CONNECTION_RECTANGLE','Connected grid component must be a complete rectangle');
  check(cell.y===rectangle.minY&&cell.x===(endpoint==='start'?rectangle.maxX:rectangle.minX),
    'GRID_CONNECTION_EDGE','Connection must use the exposed top corner');
  check(moved.familyId===rectangle.familyId,'GRID_CONNECTION_FAMILY','Connection requires the same terrain family');
  check(moved.baseY===(rectangle.maxY+1)*64,'GRID_CONNECTION_BASE','Connection requires an identical solid base');
  const target={x:(endpoint==='start'?cell.x+1:cell.x)*64,y:cell.y*64,slope:0},point=endpointPoint(moved,endpoint);
  check(Math.hypot(point.x-target.x,point.y-target.y)<=CURVE_JOIN_POLICY.maximumDistance,'GRID_CONNECTION_DISTANCE','Grid corner is outside the connection distance');
  const curve=structuredClone(moved);Object.assign(endpointPoint(curve,endpoint),target);
  return {curve,connection:{curveId:curve.curveId,endpoint,cell:{...cell}}};
}
export function findGridConnection(document, moved, pointIndex, scale, targets) {
  const endpoint=curveEndpoint(moved,pointIndex);
  if(!endpoint||!(scale>0)||document.terrainConnections?.some(c=>c.curveId===moved.curveId&&c.endpoint===endpoint))return null;
  const point=moved.points[pointIndex],radius=Math.min(64,12/scale);
  const target=targets.filter(t=>t.endpoint===endpoint).map(t=>({...t,distance:Math.hypot(point.x-t.x,point.y-t.y)}))
    .filter(t=>t.distance<=radius).sort((a,b)=>a.distance-b.distance||a.x-b.x||a.y-b.y)[0];
  if(!target)return null;
  return {kind:'grid',target,distance:target.distance,blocked:moved.baseY===target.baseY?null:'GRID_CONNECTION_BASE',
    command:{type:'connect-curve-grid',curve:moved,endpoint,cell:target.cell}};
}
export function analyzeMixedTerrain(map,cells,capWidth=8,capOptions={}) {
  if(!['ai_scene_document_v3','ai_scene_document_v4','ai_scene_document_v5','ai_scene_document_v6'].includes(map.format))return [];
  const index=gridRectangles(cells), nodes=new Map(), links=new Map(), occupied=new Set();
  const connect=(a,b)=>{if(!links.has(a))links.set(a,new Set());links.get(a).add(b);};
  for(const connection of map.terrainConnections){
    const key=`${connection.curveId}/${connection.endpoint}`;
    check(!occupied.has(key),'GRID_CONNECTION_DUPLICATE','Each endpoint may have one grid connection');occupied.add(key);
    const curve=map.curveTerrains.find(c=>c.curveId===connection.curveId);
    check(curve,'CURVE_MISSING','Connection references an absent curve');
    const rectangle=index.byCell.get(cellKey(connection.cell.x,connection.cell.y));
    check(rectangle?.rectangular,'GRID_CONNECTION_RECTANGLE','Connected grid component must remain a complete rectangle');
    const cell=connection.cell,endpoint=connection.endpoint,p=endpointPoint(curve,endpoint);
    check(cell.y===rectangle.minY&&cell.x===(endpoint==='start'?rectangle.maxX:rectangle.minX),'GRID_CONNECTION_EDGE','Connection must use the exposed top corner');
    check(p.x===(endpoint==='start'?cell.x+1:cell.x)*64&&p.y===cell.y*64&&p.slope===0,
      'GRID_CONNECTION_ANCHOR','Connected endpoint is fixed to its grid corner; disconnect it first');
    check(curve.baseY===(rectangle.maxY+1)*64,'GRID_CONNECTION_BASE','Grid and curve bases must match');
    check(curve.familyId===rectangle.familyId,'GRID_CONNECTION_FAMILY','Grid and curve families must match');
    const curveKey=`curve/${curve.curveId}`,rectKey=rectangle.id;
    nodes.set(curveKey,{kind:'curve',curve,x:curve.points[0].x});
    nodes.set(rectKey,{kind:'grid',rectangle,x:rectangle.minX*64});connect(curveKey,rectKey);connect(rectKey,curveKey);
  }
  const visited=new Set(),patches=[];
  for(const start of [...nodes.keys()].sort(compareText)){
    if(visited.has(start))continue;
    const queue=[start],group=[];visited.add(start);
    for(let i=0;i<queue.length;i++){const id=queue[i];check(links.get(id).size<=2,'GRID_CONNECTION_BRANCH','Branching connections are unsupported');group.push(nodes.get(id));for(const next of links.get(id))if(!visited.has(next)){visited.add(next);queue.push(next);}}
    group.sort((a,b)=>a.x-b.x);
    const points=[],gridCells=[],curveIds=[];
    for(const item of group){
      const line=item.kind==='curve'?item.curve.points:[{x:item.rectangle.minX*64,y:item.rectangle.minY*64,slope:0},{x:(item.rectangle.maxX+1)*64,y:item.rectangle.minY*64,slope:0}];
      if(points.length)check(points.at(-1).x===line[0].x&&points.at(-1).y===line[0].y,'GRID_CONNECTION_CHAIN','Connected surfaces must form one ordered continuous chain');
      points.push(...line.slice(points.length?1:0).map(p=>({...p})));
      if(item.kind==='curve')curveIds.push(item.curve.curveId);else gridCells.push(...item.rectangle.cells);
    }
    check(points.at(-1).x-points[0].x<=8192,'GRID_CONNECTION_SPAN','Mixed chain exceeds 8192 units');
    curveIds.sort(compareText);gridCells.sort((a,b)=>a.y-b.y||a.x-b.x);
    const curve=map.curveTerrains.find(c=>c.curveId===curveIds[0]);
    const geometry=compileCurveGeometry({...curve,points},capWidth,capOptions);
    const {curveId:unused,profile:oldProfile,...data}=geometry;
    patches.push({...data,patchId:`mixed/${curveIds.join('+')}`,profile:capWidth===8&&!capOptions.profile?MIXED_TERRAIN_PROFILE:{...MIXED_TERRAIN_PROFILE,capWidth,
      ...(capOptions.profile?{surfaceProfile:capOptions.profile,capDirection:'vertical-source-depth-v1'}:{})},
      source:{curveIds,gridCells},baseY:curve.baseY});
  }
  return patches.sort((a,b)=>a.bounds.x-b.bounds.x||compareText(a.patchId,b.patchId));
}
