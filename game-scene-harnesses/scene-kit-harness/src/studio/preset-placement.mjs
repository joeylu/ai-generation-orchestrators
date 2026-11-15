// Advisory placement feedback. The command editor still performs complete validation.
import {gridColumnIndex,gridCurveConflict} from '../terrain-overlap.mjs';
import {sceneDisplayRole} from './layer-groups.mjs';
import {isGeneratedEnvironment} from './generated-environment-id.mjs';
export function presetPlacement(preset,position,scene,document,presets){
  const column=Math.floor(position.x/scene.grid.width),row=Math.floor(position.y/scene.grid.height),size=preset.sizeCells,b=document.bounds;
  const bounds={x:column*scene.grid.width,y:row*scene.grid.height,width:size.width*scene.grid.width,height:size.height*scene.grid.height};
  const runs=(preset.terrainRuns??[]).map(run=>({...run,x:run.x+column,y:run.y+row}));
  if(column<b.x||row<b.y||column+size.width>b.x+b.width||row+size.height>b.y+b.height)return{bounds,runs,code:'ASSEMBLY_OUT_OF_BOUNDS',message:'组合包含实际地形，请完整放进地图框内'};
  const occupied=[...document.terrainRuns,...document.assemblyInstances.flatMap(item=>(presets.find(p=>p.presetId===item.presetId)?.terrainRuns??[]).map(run=>({...run,x:run.x+item.column,y:run.y+item.row})))];
  if(runs.some(run=>occupied.some(other=>run.y===other.y&&run.x<other.x+other.length&&other.x<run.x+run.length)))return{bounds,runs,code:'TERRAIN_OVERLAP',message:'这里已有地形，请移到空白位置'};
  const cells=new Map();for(const run of runs)for(let x=run.x;x<run.x+run.length;x++)cells.set(`${x},${run.y}`,run.familyId);
  if(gridCurveConflict(scene.curveTerrains??[],gridColumnIndex(cells),scene.grid))return{bounds,runs,code:'CURVE_GRID_OVERLAP',message:'这里会与曲线地形实体重叠，请放到坡面上方或其他空位'};
  return{bounds,runs,code:null,message:`松开放置组合 · ${size.width} × ${size.height} 格`};
}

export function placementLayer(layers,asset,activeLayer,isTerrainPreset=false,instances=[]){
  const visual=layers.filter(layer=>layer.kind!=='terrain');
  if(isTerrainPreset){const unit=visual.filter(layer=>layer.parallax.x===1&&layer.parallax.y===1);
    return unit.find(layer=>layer.layerId===asset.preferredLayerId)??unit.find(layer=>layer.layerId===activeLayer)??unit.find(layer=>layer.kind==='environment')??unit[0];}
  const explicit=visual.find(layer=>layer.layerId===activeLayer)??visual.find(layer=>layer.layerId===asset.preferredLayerId);
  if(explicit)return explicit;
  if(isGeneratedEnvironment(asset)){
    const main=visual.find(layer=>layer.kind==='environment'&&sceneDisplayRole(layer)==='environment');
    if(main)return main;
  }
  if(asset.assetId&&asset.preferredLayerId){
    // An author may replace an unused preferred layer while keeping the kit immutable.
    const authored=new Set(instances.filter(item=>item.assetId===asset.assetId).map(item=>item.layerId));
    if(authored.size===1){
      const match=visual.find(layer=>authored.has(layer.layerId));
      if(match)return match;
    }
  }
  return visual.find(layer=>layer.kind===(['background','strip'].includes(asset.kind)?'background':'environment'));
}
