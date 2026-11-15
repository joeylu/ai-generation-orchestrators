import {encodeRgbaPng} from '../../src/png.mjs';
import {hash} from '../../src/generation/common.mjs';
export function edgeRoleFixture(){
  const files=new Map(),source=(path,color)=>{const b=encodeRgbaPng(2,2,Buffer.from(Array(4).fill(color).flat()));files.set(path,b);return {path,sha256:hash(b),byteLength:b.length};},
    body=source('body.png',[90,60,40,255]),cap=source('cap.png',[230,240,250,255]),
    red=source('red.png',[190,50,40,255]),blue=source('blue.png',[30,70,200,255]),green=source('green.png',[40,160,80,255]),
    quad=(x,y,w,h)=>({positions:[x,y,x+w,y,x+w,y+h,x,y+h],uvs:[0,0,1,0,1,1,0,1],indices:[0,1,2,0,2,3]}),
    mesh=(role,src,x,y,w,h)=>({...quad(x,y,w,h),source:src,materialKey:role}),
    patch={layerId:'ground',source:{gridCells:[]},body:quad(4,4,24,24),cap:quad(4,4,24,4),
      edgeMeshes:[mesh('left.wall',red,4,10,4,10),mesh('right.wall',green,24,10,4,10),
        mesh('left.corner',red,4,4,4,6),mesh('bottom.edge',green,8,24,16,4),
        {...mesh('bottom.leftCorner',blue,4,20,6,8),coverageOpacity:.75,coverageAlpha:[0,1,1,0]},mesh('bottom.rightCorner',red,22,20,6,8)],
      nativeTopCornerMeshes:[mesh('right.corner',blue,24,4,4,6)],cornerMeshes:[],fieldBoundaryBands:[]},
    scene={format:'ai_scene_compiled_v8',contentSha256:'a'.repeat(64),source:{authorSha256:'b'.repeat(64)},
      defaultCamera:{center:{x:16,y:16},viewport:{width:32,height:32},scale:1},layers:[{layerId:'ground',visible:true,parallax:{x:1,y:1},nodes:[]}],
      terrainMaterial:{body:{source:body},cap:{source:cap},edges:{left:{wall:{source:red},corner:{source:red}},right:{wall:{source:green},corner:{source:blue}}},
        bottomEdges:{edge:{source:green},leftCorner:{source:blue},rightCorner:{source:red}}},gridTerrains:[patch],curveTerrains:[],mixedTerrains:[]};
  return {scene,files};
}
