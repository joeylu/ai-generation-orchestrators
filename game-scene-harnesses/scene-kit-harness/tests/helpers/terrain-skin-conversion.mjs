import {mkdirSync,writeFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import * as flow from '../../src/generation/index.mjs';
import {buildTerrainEdgeDelivery} from '../../src/terrain-edge-pipeline.mjs';
import {loadSceneKit,contextFor,readMap} from '../../src/kit.mjs';
import {canonicalJson} from '../../src/document.mjs';
import {sha256} from '../../src/validate.mjs';
import {setupBottomDelivery,bottomSideControls,freezeBottomDeliverySources} from './terrain-bottom-delivery.mjs';

// Public producers with synthetic returned PNGs only. This deliberately keeps
// a rigid skin next to the same v6/full-perimeter compiler used after conversion.
export function prepareTerrainSkinConversion(t){
  const f=setupBottomDelivery(t,{receiveSides:false}),{batch,bottom}=freezeBottomDeliverySources(f,flow.TERRAIN_PERIMETER_ROLES,'conversion.perimeter'),
    options={...f.deliveryOptions,batchSha256:batch.sha256,controls:{...bottomSideControls(f),bottom:bottom.controls},output:join(f.parent,'conversion-perimeter')};
  buildTerrainEdgeDelivery(options);
  const original=loadSceneKit(join(options.output,'candidate/kit')),context=contextFor(original),files=new Map(context.files),
    library=structuredClone(context.library),platform=library.presets.find(p=>p.instances.some(i=>context.modules.get(i.assetId)?.terrainSkin)),
    skin=context.modules.get(platform.instances.find(i=>context.modules.get(i.assetId)?.terrainSkin).assetId),
    marker=[...context.modules.values()].find(m=>m.kind==='environment'&&!m.terrainSkin&&m.assetId!==skin.assetId),
    w=platform.sizeCells.width,h=platform.sizeCells.height;
  library.presets.push({presetId:'platform.conversion.decorated',sizeCells:{width:w,height:h+1},terrainRuns:[],
    instances:[{instanceId:'ornament',assetId:marker.assetId,x:0,y:h*64}],
    assemblies:[{instanceId:'shell',presetId:platform.presetId,column:0,row:0}]},
  {presetId:'platform.conversion.multiple',sizeCells:{width:w*2+1,height:h},terrainRuns:[],instances:[],assemblies:[
    {instanceId:'first',presetId:platform.presetId,column:0,row:0},{instanceId:'second',presetId:platform.presetId,column:w+1,row:0}]});
  const descriptor=structuredClone(context.kit),bytes=Buffer.from(canonicalJson(library,true)+'\n');
  files.set(descriptor.files.presets.path,bytes);descriptor.files.presets.sha256=sha256(bytes);files.set('kit.json',Buffer.from(canonicalJson(descriptor,true)+'\n'));
  const root=join(f.parent,'conversion-kit');mkdirSync(root);
  for(const [name,content]of files){const path=join(root,name);mkdirSync(dirname(path),{recursive:true});writeFileSync(path,content);}
  const handle=loadSceneKit(root),map=readMap(handle),layerId=skin.preferredLayerId??map.assemblyInstances.find(a=>a.presetId===platform.presetId).layerId;
  Object.assign(map,{bounds:{x:0,y:0,width:Math.max(16,w*2+4),height:Math.max(9,h+5)},
    defaultCamera:{center:{x:512,y:288},viewport:{width:1024,height:576},scale:1},terrainRuns:[],curveTerrains:[],terrainConnections:[],instanceTransforms:[],
    instances:[{instanceId:'preserved.visual',assetId:marker.assetId,layerId,x:64,y:64}],
    assemblyInstances:[{instanceId:'conversion.platform',presetId:'platform.conversion.decorated',column:6,row:3,layerId}]});
  return {f,root,handle,map,platform,skin,marker,layerId,width:w,height:h,context:contextFor(handle)};
}
