import {readMap,contextFor} from '../kit.mjs';
import {compileMap} from '../compile.mjs';

// Compile an isolated assembly with the ordinary topology, skin and placement rules.
// This temporary document never enters author maps, undo or persistence.
export function compilePresetPreview(handle,preset,preferredLayerId){
  const document=readMap(handle),{kit}=contextFor(handle);
  for(const key of ['terrainRuns','instances','assemblyInstances','inspectionCases','curveTerrains','terrainConnections','instanceTransforms'])if(Object.hasOwn(document,key))document[key]=[];
  document.mapId='studio.preset-preview';document.bounds={x:0,y:0,width:Math.max(document.bounds.width,preset.sizeCells.width),height:Math.max(document.bounds.height,preset.sizeCells.height)};
  document.defaultCamera.center={x:document.bounds.width*kit.grid.width/2,y:document.bounds.height*kit.grid.height/2};
  document.layers=document.layers.map(layer=>({...layer,visible:true}));
  let layer=document.layers.find(l=>l.layerId===preferredLayerId&&l.kind!=='terrain'&&l.parallax.x===1&&l.parallax.y===1)
    ??document.layers.find(l=>l.kind!=='terrain'&&l.parallax.x===1&&l.parallax.y===1);
  if(!layer){layer={layerId:'studio.preview',kind:'environment',zIndex:Math.max(...document.layers.map(l=>l.zIndex))+1,parallax:{x:1,y:1},visible:true};document.layers.push(layer);}
  document.assemblyInstances=[{instanceId:'studio.preview',presetId:preset.presetId,column:0,row:0,layerId:layer.layerId}];
  const scene=compileMap(handle,document),nodes=scene.layers.flatMap(l=>l.nodes).map(node=>({assetId:node.assetId,kind:node.kind,position:node.position,size:node.size,
    ...(node.cell?{cell:node.cell,signature:node.signature,sourceToLogical:node.sourceToLogical}:{}),...(node.renderStyle?{renderStyle:node.renderStyle}:{})}));
  const left=Math.min(0,...nodes.map(n=>n.position.x)),top=Math.min(0,...nodes.map(n=>n.position.y));
  const right=Math.max(preset.sizeCells.width*scene.grid.width,...nodes.map(n=>n.position.x+n.size.width)),bottom=Math.max(preset.sizeCells.height*scene.grid.height,...nodes.map(n=>n.position.y+n.size.height));
  return {bounds:{x:left,y:top,width:right-left,height:bottom-top},nodes};
}
