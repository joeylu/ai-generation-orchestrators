import { cellsFromRuns, runsFromCells } from './document.mjs';
import { gridRectangles } from './mixed-terrain.mjs';
import { sampleCurve } from './curves.mjs';
import { demand } from './errors.mjs';

// A connected piece includes adjoining cells, their owning assemblies, attached
// platform skins and explicitly connected curves. Incidental scenery stays put.
export function terrainRegions(document, { grid, presets, terrainSkins = [] }) {
  const cells = cellsFromRuns(document.terrainRuns), assemblyCells = new Map();
  const definitions = new Map(presets.map(p => [p.presetId, p]));
  for (const a of document.assemblyInstances) {
    const keys = [];
    for (const [key, family] of cellsFromRuns(definitions.get(a.presetId).terrainRuns)) {
      const [x,y] = key.split(',').map(Number), next = `${x+a.column},${y+a.row}`;
      keys.push(next); cells.set(next, family);
    }
    assemblyCells.set(a.instanceId, keys);
  }
  const index = gridRectangles(cells), parent = new Map(), find = id => {
    let root = id;
    while (parent.get(root) !== root) root = parent.get(root);
    while (id !== root) { const next = parent.get(id); parent.set(id, root); id = next; }
    return root;
  };
  const add = id => parent.set(id,id), union = (a,b) => parent.set(find(a),find(b));
  for (const c of index.components) add(c.id);
  for (const c of document.curveTerrains ?? []) add('curve/'+c.curveId);
  for (const [id,keys] of assemblyCells) if (keys.length) {
    add('assembly/'+id);
    for (const key of keys) union('assembly/'+id,index.byCell.get(key).id);
  }
  for (const link of document.terrainConnections ?? []) union('curve/'+link.curveId,index.byCell.get(`${link.cell.x},${link.cell.y}`).id);
  const groups = new Map(), group = id => {
    const root = find(id);
    if (!groups.has(root)) groups.set(root,{ cells:[], curveIds:[], assemblyIds:[], instanceIds:[], outlines:[], bounds:null });
    return groups.get(root);
  };
  const include = (region,box) => {
    const old=region.bounds;
    if(!old)region.bounds={...box};
    else { const x=Math.min(old.x,box.x),y=Math.min(old.y,box.y);region.bounds={x,y,width:Math.max(old.x+old.width,box.x+box.width)-x,height:Math.max(old.y+old.height,box.y+box.height)-y}; }
  };
  for (const c of index.components) {
    const r=group(c.id);r.cells.push(...c.cells);
    include(r,{x:c.minX*grid.width,y:c.minY*grid.height,width:(c.maxX-c.minX+1)*grid.width,height:(c.maxY-c.minY+1)*grid.height});
  }
  for (const c of document.curveTerrains ?? []) {
    const r=group('curve/'+c.curveId),line=sampleCurve(c);r.curveIds.push(c.curveId);
    r.outlines.push({curveId:c.curveId,line,baseY:c.baseY});
    include(r,{x:line[0].x,y:Math.min(...line.map(p=>p.y)),width:line.at(-1).x-line[0].x,height:c.baseY-Math.min(...line.map(p=>p.y))});
  }
  for (const [id,keys] of assemblyCells) if(keys.length)group('assembly/'+id).assemblyIds.push(id);
  const directIds = new Set(document.instances.map(i=>i.instanceId));
  for (const skin of terrainSkins) if(directIds.has(skin.instanceId))group(index.byCell.get(`${skin.cells[0].x},${skin.cells[0].y}`).id).instanceIds.push(skin.instanceId);
  return [...groups.values()].map(r=>({...r,cellKeys:new Set(r.cells.map(c=>`${c.x},${c.y}`)),terrainLayerId:document.layers.find(l=>l.kind==='terrain').layerId}));
}

export function regionForTarget(regions,target) {
  return regions.find(r=>target?.curveId?r.curveIds.includes(target.curveId):target?.assemblyId?r.assemblyIds.includes(target.assemblyId):target?.cell?r.cellKeys.has(`${target.cell.x},${target.cell.y}`):false) ?? null;
}
export function hitTerrainRegion(regions,p,grid) {
  const key=`${Math.floor(p.x/grid.width)},${Math.floor(p.y/grid.height)}`;
  for(const r of regions) {
    if(r.cellKeys.has(key))return {region:r,target:{cell:{x:Math.floor(p.x/grid.width),y:Math.floor(p.y/grid.height)}}};
    for(const {curveId,line,baseY}of r.outlines) {
      if(p.x<line[0].x||p.x>line.at(-1).x||p.y>baseY)continue;
      for(let i=1;i<line.length;i++)if(line[i].x>=p.x){const a=line[i-1],b=line[i],y=a.y+(b.y-a.y)*(p.x-a.x)/(b.x-a.x);if(p.y>=y)return {region:r,target:{curveId}};break;}
    }
  }
  return null;
}
export function terrainMoveBlock(region,document,{locked=new Set(),hidden=new Set(),hiddenObjects=new Set()}={}) {
  const owners=[{layerId:region.terrainLayerId},...document.assemblyInstances.filter(a=>region.assemblyIds.includes(a.instanceId)),...document.instances.filter(i=>region.instanceIds.includes(i.instanceId))];
  if(owners.some(o=>locked.has(o.layerId)||locked.has(o.instanceId)))return '这块地形或连接的组合已锁定，请先解锁再移动。';
  if(owners.some(o=>hidden.has(o.layerId)||hiddenObjects.has(o.instanceId)||!document.layers.find(l=>l.layerId===o.layerId)?.visible))return '这块地形包含隐藏的连接对象，请先显示后再移动。';
  return null;
}
export function terrainMoveDelta(region,start,p,grid) {
  const sx=region.cells.length?grid.width:1,sy=region.cells.length?grid.height:1;
  return {dx:Math.round((p.x-start.x)/sx)*sx||0,dy:Math.round((p.y-start.y)/sy)*sy||0};
}

export function moveTerrainRegion(document,region,dx,dy,grid) {
  const check=(condition,code,message)=>demand(condition,code,'commands.json','/terrain-move',message);
  check(Number.isSafeInteger(dx)&&Number.isSafeInteger(dy)&&Math.abs(dx)<=1048576&&Math.abs(dy)<=1048576,'TERRAIN_MOVE_OFFSET','Movement requires bounded integer world offsets');
  check(!region.cells.length||(dx%grid.width===0&&dy%grid.height===0),'TERRAIN_MOVE_GRID','Grid terrain moves in whole cells');
  const next=structuredClone(document),cx=dx/grid.width,cy=dy/grid.height,cells=cellsFromRuns(document.terrainRuns);
  for(const key of region.cellKeys)cells.delete(key);
  for(const [key,family]of cellsFromRuns(document.terrainRuns))if(region.cellKeys.has(key)) {
    const [x,y]=key.split(',').map(Number),target=`${x+cx},${y+cy}`;
    check(!cells.has(target),'TERRAIN_OVERLAP','Moved terrain conflicts with stationary terrain');cells.set(target,family);
  }
  next.terrainRuns=runsFromCells(cells);
  for(const a of next.assemblyInstances)if(region.assemblyIds.includes(a.instanceId)){a.column+=cx;a.row+=cy;}
  for(const i of next.instances)if(region.instanceIds.includes(i.instanceId)){i.x+=dx;i.y+=dy;}
  for(const c of next.curveTerrains??[])if(region.curveIds.includes(c.curveId)){c.baseY+=dy;for(const p of c.points){p.x+=dx;p.y+=dy;}}
  for(const link of next.terrainConnections??[])if(region.curveIds.includes(link.curveId)){link.cell.x+=cx;link.cell.y+=cy;}
  for(const entry of next.inspectionCases)if(region.cellKeys.has(`${entry.cell.x},${entry.cell.y}`)){entry.cell.x+=cx;entry.cell.y+=cy;}
  return next;
}
