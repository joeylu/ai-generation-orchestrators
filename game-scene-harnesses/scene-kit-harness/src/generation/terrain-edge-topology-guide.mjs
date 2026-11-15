import {encodeRgbaPng} from '../png.mjs';
import {check,hash} from './common.mjs';

// A transparent, neutral occupancy example. It conveys which side of the
// boundary is solid, not a silhouette, texture, palette or scene geometry.
export const TERRAIN_EDGE_TOPOLOGY_PROFILE='neutral-perimeter-topology-v1';
export const TERRAIN_EDGE_TOPOLOGY_V2_PROFILE='neutral-perimeter-open-joins-v2';
export function terrainEdgeTopologyGuide(role){
  const roles=['left-wall','right-wall','left-top-corner','right-top-corner','bottom-edge','left-bottom-corner','right-bottom-corner'];
  check(roles.includes(role),'TERRAIN_EDGE_TOPOLOGY_ROLE');
  const width=256,height=256,rgba=Buffer.alloc(width*height*4);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const inside=x>=32&&x<224&&y>=32&&y<224;
    const solid=role==='left-wall'?x>=112:role==='right-wall'?x<144:
      role==='bottom-edge'?y<144:role==='left-top-corner'?x>=112&&y>=112:
      role==='right-top-corner'?x<144&&y>=112:role==='left-bottom-corner'?x>=112&&y<144:x<144&&y<144;
    if(inside&&solid){const p=(y*width+x)*4;rgba[p]=rgba[p+1]=rgba[p+2]=128;rgba[p+3]=255;}
  }
  const bytes=encodeRgbaPng(width,height,rgba);
  return {bytes,artifact:{sha256:hash(bytes),byteLength:bytes.length,pixelSize:{width,height}}};
}

// Solid gray runs to the diagram frame at the two continuation cuts. Dashed
// white marks on those cuts identify connections, never painted features.
// Transparent pixels are outside the source body. The PNG's own frame is a
// diagram convention; generated assets still use their own transparent gutter.
export function terrainEdgeTopologyGuideV2(role){
  const joins={
    'left-wall':['top','bottom'],'right-wall':['top','bottom'],'bottom-edge':['left','right'],
    'left-top-corner':['right','bottom'],'right-top-corner':['left','bottom'],
    'left-bottom-corner':['top','right'],'right-bottom-corner':['top','left']
  };
  check(Object.hasOwn(joins,role),'TERRAIN_EDGE_TOPOLOGY_ROLE');
  const width=256,height=256,rgba=Buffer.alloc(width*height*4),ends=joins[role];
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const solid=role==='left-wall'?x>=96:role==='right-wall'?x<160:
      role==='bottom-edge'?y<160:role==='left-top-corner'?x>=96&&y>=96:
      role==='right-top-corner'?x<160&&y>=96:role==='left-bottom-corner'?x>=96&&y<160:x<160&&y<160;
    if(!solid)continue;
    const mark=(ends.includes('top')&&y<6&&x>=6&&x<250&&x%18<10)||(ends.includes('bottom')&&y>=250&&x>=6&&x<250&&x%18<10)
      ||(ends.includes('left')&&x<6&&y>=6&&y<250&&y%18<10)||(ends.includes('right')&&x>=250&&y>=6&&y<250&&y%18<10);
    const p=(y*width+x)*4;rgba[p]=rgba[p+1]=rgba[p+2]=mark?255:128;rgba[p+3]=255;
  }
  const bytes=encodeRgbaPng(width,height,rgba);
  return {bytes,artifact:{sha256:hash(bytes),byteLength:bytes.length,pixelSize:{width,height}}};
}
export function resolveTerrainEdgeTopologyGuide(profile,role){
  check([TERRAIN_EDGE_TOPOLOGY_PROFILE,TERRAIN_EDGE_TOPOLOGY_V2_PROFILE].includes(profile),'TERRAIN_EDGE_TOPOLOGY_PROFILE');
  return profile===TERRAIN_EDGE_TOPOLOGY_PROFILE?terrainEdgeTopologyGuide(role):terrainEdgeTopologyGuideV2(role);
}
