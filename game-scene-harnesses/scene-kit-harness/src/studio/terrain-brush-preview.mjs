import {readMap,contextFor} from '../kit.mjs';
import {compileMap} from '../compile.mjs';
import {renderCoherentFrame} from '../coherent-render.mjs';

// Isolated painted examples use the same compiler/materials as the canvas.
// Neither old tile thumbnails nor author-map contents define this preview.
export function renderTerrainBrushExamples(handle){
  const {kit,rules,files}=contextFor(handle);
  if(!kit.terrainSharedField&&kit.terrainEdges?.gridProfile!=='grid-solid-union-native-v1')return [];
  const examples=[
    {id:'flat',label:'连续地面',rows:[[0,0,4],[0,1,4]]},
    {id:'steps',label:'阶梯',rows:[[0,2,4],[1,1,3],[2,0,2]]},
    {id:'gap',label:'开口',rows:[[0,0,1],[3,0,1],[0,1,1],[3,1,1]]},
    {id:'concave',label:'凹角',rows:[[0,0,1],[3,0,1],[0,1,4]]},
  ];
  return examples.map(({id,label,rows})=>{
    const document=readMap(handle);
    for(const key of ['terrainRuns','instances','assemblyInstances','inspectionCases','curveTerrains','terrainConnections','instanceTransforms','instanceAppearances','instanceAnimations'])
      if(Object.hasOwn(document,key))document[key]=[];
    document.mapId='studio.brush-preview';document.bounds={x:0,y:0,width:6,height:5};
    document.layers=document.layers.map(layer=>({...layer,visible:true}));
    document.terrainRuns=rows.map(([x,y,length])=>({x:x+1,y:y+1,length,familyId:rules.familyId}));
    document.defaultCamera={...document.defaultCamera,center:{x:3*kit.grid.width,y:2.5*kit.grid.height},viewport:{width:6*kit.grid.width,height:5*kit.grid.height}};
    const scene=compileMap(handle,document);
    return {id,label,bytes:renderCoherentFrame(scene,path=>files.get(path))};
  });
}
