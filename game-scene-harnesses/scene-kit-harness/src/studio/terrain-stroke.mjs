// Turn one canvas gesture into an explicit atomic command batch. The core still
// validates every expansion and edit; this planner never changes author state.
import {cellsFromRuns} from '../document.mjs';
import {gridRectangles} from '../mixed-terrain.mjs';

// A changed grid shape may no longer satisfy a fixed rectangular curve joint.
// Plan explicit disconnects from the final occupancy, before any grid edit.
function invalidatedConnections(document,definitions,command){
  if(!document.terrainConnections?.length)return [];
  const cells=cellsFromRuns(document.terrainRuns);
  for(const instance of document.assemblyInstances)for(const run of definitions.get(instance.presetId).terrainRuns??[])
    for(let x=run.x;x<run.x+run.length;x++)cells.set(`${x+instance.column},${run.y+instance.row}`,run.familyId);
  for(const cell of command.cells){const key=`${cell.x},${cell.y}`;if(command.type==='paint-cells')cells.set(key,command.familyId);else cells.delete(key);}
  const index=gridRectangles(cells),curves=new Map(document.curveTerrains.map(curve=>[curve.curveId,curve]));
  return document.terrainConnections.filter(link=>{
    const rectangle=index.byCell.get(`${link.cell.x},${link.cell.y}`),curve=curves.get(link.curveId),start=link.endpoint==='start',point=start?curve.points[0]:curve.points.at(-1);
    return !rectangle?.rectangular||link.cell.y!==rectangle.minY||link.cell.x!==(start?rectangle.maxX:rectangle.minX)
      ||point.x!==(start?link.cell.x+1:link.cell.x)*64||point.y!==link.cell.y*64||point.slope!==0
      ||curve.baseY!==(rectangle.maxY+1)*64||curve.familyId!==rectangle.familyId;
  });
}

export function planTerrainStroke({command,document,presets,scene,locked=new Set(),hidden=new Set(),hiddenObjects=new Set()}){
  const reject=(code,message)=>({commands:[],expandedCount:0,code,message});
  const terrainLayer=document.layers.find(layer=>layer.kind==='terrain');
  if(locked.has(terrainLayer?.layerId)||hidden.has(terrainLayer?.layerId))return reject('STROKE_TERRAIN_UNAVAILABLE','请先显示并解锁地形图层。');
  if(!['paint-cells','erase-cells'].includes(command?.type)||!Array.isArray(command.cells)||command.cells.length>100000)return reject('COMMAND_CELLS','本次地形笔划无效或超过容量。');
  const rows=new Map(),cells=[],seen=new Set(),bounds=document.bounds;
  for(const cell of command.cells){
    if(!Number.isSafeInteger(cell?.x)||!Number.isSafeInteger(cell?.y))return reject('COMMAND_CELL','地形笔划需要整数格子坐标。');
    if(cell.x<bounds.x||cell.y<bounds.y||cell.x>=bounds.x+bounds.width||cell.y>=bounds.y+bounds.height)return reject('TERRAIN_OUT_OF_BOUNDS','地形超出地图范围，请先扩建。');
    const key=`${cell.x},${cell.y}`;if(seen.has(key))continue;seen.add(key);cells.push(cell);if(!rows.has(cell.y))rows.set(cell.y,[]);rows.get(cell.y).push(cell.x);
  }
  for(const xs of rows.values())xs.sort((a,b)=>a-b);
  function intersect(runs,dx,dy,visit){for(const run of runs??[]){const xs=rows.get(run.y+dy);if(!xs)continue;const start=run.x+dx,end=start+run.length;
    let lo=0,hi=xs.length;while(lo<hi){const mid=(lo+hi)>>1;if(xs[mid]<start)lo=mid+1;else hi=mid;}
    for(let i=lo;i<xs.length&&xs[i]<end;i++)visit(`${xs[i]},${run.y+dy}`);
  }}
  const direct=new Set(),owners=new Map(),touched=new Map(),definitions=new Map(presets.map(p=>[p.presetId,p]));intersect(document.terrainRuns,0,0,key=>direct.add(key));
  for(const instance of document.assemblyInstances){const preset=definitions.get(instance.presetId);if(!preset)return reject('PRESET_MISSING','组合信息与当前资产包不一致，请刷新后继续。');
    intersect(preset.terrainRuns,instance.column,instance.row,key=>{owners.set(key,instance);touched.set(instance.instanceId,instance);});}
  const painting=command.type==='paint-cells',effective=cells.filter(cell=>painting?!direct.has(`${cell.x},${cell.y}`)&&!owners.has(`${cell.x},${cell.y}`):direct.has(`${cell.x},${cell.y}`)||owners.has(`${cell.x},${cell.y}`));
  if(!effective.length)return {commands:[],expandedCount:0,code:null,message:painting?'这里已有地形，未重复绘制或拆开组合。':'这里没有可擦除的格子地形。'};
  if(!painting)for(const instance of touched.values()){
    if(locked.has(instance.layerId)||locked.has(instance.instanceId))return reject('STROKE_ASSEMBLY_LOCKED','擦到的组合已锁定，请先解锁所在图层或组合。');
    if(hidden.has(instance.layerId)||hiddenObjects.has(instance.instanceId))return reject('STROKE_ASSEMBLY_HIDDEN','擦到的组合已隐藏，请先显示后再编辑。');
  }
  if(!painting&&(scene.terrainSkins??[]).some(skin=>skin.cells.some(cell=>seen.has(`${cell.x},${cell.y}`))))return reject('STROKE_RIGID_PLATFORM','这是整张平台外壳，不能逐格擦除。请用选择工具选中平台后删除整件，或改用普通地形组合。');
  const stroke={...command,cells:effective},disconnected=invalidatedConnections(document,definitions,stroke);
  for(const link of disconnected){
    if(locked.has(link.curveId))return reject('STROKE_CONNECTION_LOCKED','本次笔划会解除已锁定曲线的接头，请先解锁曲线。');
    if(hiddenObjects.has(link.curveId))return reject('STROKE_CONNECTION_HIDDEN','本次笔划会解除已隐藏曲线的接头，请先显示曲线。');
  }
  const expansions=painting?[]:[...touched.keys()].map(instanceId=>({type:'expand-assembly',instanceId}));
  if(disconnected.length+expansions.length+1>256)return reject('COMMAND_BATCH','本次笔划涉及的组合或接头太多，请分次编辑。');
  return {commands:[...disconnected.map(link=>({type:'disconnect-curve-grid',curveId:link.curveId,endpoint:link.endpoint})),...expansions,stroke],expandedCount:expansions.length,disconnectedCount:disconnected.length,code:null};
}
