import {encodeRgbaPng,inspectPng} from '../../src/png.mjs';
import {hash} from '../../src/generation/common.mjs';
import {renderCoherentFrame} from '../../src/coherent-render.mjs';

export function bodyPhaseFixture(){
  const files=new Map(),source=(path,rgba)=>{
    const bytes=encodeRgbaPng(8,8,Buffer.from(rgba));files.set(path,bytes);
    return {path,byteLength:bytes.length,sha256:hash(bytes)};
  },pattern=Array.from({length:64},(_,i)=>[40+i%8*20,50+Math.floor(i/8)*16,30+i%8*5+Math.floor(i/8)*9,255]).flat(),
    body=source('body.png',pattern),cap=source('cap.png',Array(64).fill([220,235,250,192]).flat()),
    edge=source('edge.png',Array(64).fill([150,120,90,255]).flat()),
    quad=(x,y)=>({positions:[x,y,x+8,y,x+8,y+8,x,y+8],uvs:[0,0,1,0,1,1,0,1],indices:[0,1,2,0,2,3]}),
    patch={gridTerrainId:'fixture',layerId:'ground',source:{gridCells:[]},body:quad(4,4),cap:quad(4,20),
      fieldBoundaryBands:[{...quad(16,4),shadeTint:0xffffff,coverageOpacity:.5}],
      cornerMeshes:[{...quad(28,4),materialKind:'body',coverageOpacity:.75},{...quad(40,4),materialKind:'cap',coverageOpacity:.4}],
      nativeTopCornerMeshes:[{...quad(16,20),source:edge,materialKey:'left.corner',coverageOpacity:.8}],
      edgeMeshes:[{...quad(28,20),source:edge,materialKey:'left.wall'},
        {...quad(40,20),source:edge,materialKey:'bottom.edge',coverageOpacity:.6}]},
    scene={format:'ai_scene_compiled_v7',contentSha256:'a'.repeat(64),source:{authorSha256:'b'.repeat(64)},
      defaultCamera:{center:{x:32,y:20},viewport:{width:64,height:40},scale:1},
      layers:[{layerId:'ground',visible:true,parallax:{x:1,y:1},nodes:[]}],
      terrainMaterial:{body:{source:body},cap:{source:cap},
        edges:{left:{wall:{source:edge},corner:{source:edge}},right:{wall:{source:edge},corner:{source:edge}}},
        bottomEdges:{edge:{source:edge},leftCorner:{source:edge},rightCorner:{source:edge}}},
      gridTerrains:[patch],curveTerrains:[],mixedTerrains:[]},
    pixels=s=>inspectPng(renderCoherentFrame(s,p=>files.get(p)),{includePixels:true}).rgba,
    pixel=(rgba,x,y)=>[...rgba.subarray((y*64+x)*4,(y*64+x+1)*4)];
  return {scene,files,pixels,pixel,bodyRects:[{x:4,y:4},{x:16,y:4},{x:28,y:4}]};
}
