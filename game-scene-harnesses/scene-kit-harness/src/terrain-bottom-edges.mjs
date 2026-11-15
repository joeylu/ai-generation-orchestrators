import {createHash} from 'node:crypto';
import {demand} from './errors.mjs';
import {clone,deepFreeze} from './document.mjs';
import {inspectPng} from './png.mjs';
import {mergeNativeCoveragePartitions} from './terrain-coverage-mesh.mjs';
import {TERRAIN_WALL_REPEAT_WINDOW_PROFILE} from './terrain-edge-junction.mjs';

export const TERRAIN_BOTTOM_EDGE_PROFILE='native-horizontal-bottom-union-v1';
export const TERRAIN_BOTTOM_EDGE_PROFILE_V2='native-horizontal-bottom-union-v2';
export const TERRAIN_BOTTOM_NATIVE_SIZE_PROFILE='bounded-native-4m-v1';
export const TERRAIN_BOTTOM_RENDER_ENVELOPE_PROFILE='visible-alpha8-outward16-native-rgba-v1';
export const TERRAIN_BOTTOM_JUNCTION_PROFILE='native-bottom-endpoint-underlap-v1';
export const TERRAIN_BOTTOM_ADAPTIVE_COVERAGE_PROFILE='native-bottom-adaptive-coverage-v2';
export const TERRAIN_BOTTOM_BODY_SUPPORT_PROFILE='author-solid-world-body-v1';
export const TERRAIN_BOTTOM_THIN_PLATFORM_TOP_PROFILE='isolated-flat-platform-top-v1';
export const TERRAIN_BOTTOM_JUNCTION_PROFILES=Object.freeze([TERRAIN_BOTTOM_JUNCTION_PROFILE,TERRAIN_BOTTOM_ADAPTIVE_COVERAGE_PROFILE]);
export const TERRAIN_BOTTOM_EDGE_LIMITS=deepFreeze({maximumSourceDimension:2048,maximumSourcePixels:4194304,
  maximumSourceBytes:16777216,maximumInboardWorld:64,maximumOutwardWorld:16,maximumFadeWorld:8,
  underlapWorld:2,minimumAirClearanceWorld:1,coverageBands:16,maximumRepeatLayers:8,maximumOwners:2048,maximumSegments:262144,
  maximumWork:4194304,maximumOutputTriangles:262144,maximumNativeMeshes:32768});
export const TERRAIN_BOTTOM_EDGE_LIMITS_V2=deepFreeze({...TERRAIN_BOTTOM_EDGE_LIMITS,maximumSourceDimension:4096,visibleContourMinimumAlpha:8});
const EPS=1e-7,ratio=v=>v?.numerator/v?.denominator,q=n=>Math.round(n*1e12)/1e12;
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const integer=(v,a,b)=>Number.isSafeInteger(v)&&v>=a&&v<=b;
const hash=b=>createHash('sha256').update(b).digest('hex');
const digest=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const check=(v,code,message)=>demand(v,code,'kit.json','/terrainBottomEdges',message);
const safePath=v=>typeof v==='string'&&v.length<=240&&!v.includes('\\')&&!v.includes(':')&&v.endsWith('.png')
  &&v.split('/').every(p=>p&&p!=='.'&&p!=='..'&&/^[a-zA-Z0-9_.-]+$/.test(p));
export function terrainBottomEdgeSources(value){return ['edge','leftCorner','rightCorner'].map(key=>({key,...value[key]}));}

// These coordinates describe original source pixels. They never authorize
// recoloring, alpha repair, mirroring, rotation or a source-density change.
export function validateTerrainBottomEdges(value,appearance,{readAsset,terrainEdges}={}){
  const nativeSizeV2=value?.format==='ai_scene_terrain_bottom_edges_v2',L=nativeSizeV2?TERRAIN_BOTTOM_EDGE_LIMITS_V2:TERRAIN_BOTTOM_EDGE_LIMITS;
  const junction=Object.hasOwn(value??{},'junctionProfile');
  const bodySupport=Object.hasOwn(value??{},'bodySupportProfile');
  const thinPlatformTop=Object.hasOwn(value??{},'thinPlatformTopProfile');
  check(!junction||nativeSizeV2&&TERRAIN_BOTTOM_JUNCTION_PROFILES.includes(value.junctionProfile),
    'TERRAIN_BOTTOM_JUNCTION_PROFILE','Endpoint underlap requires the explicit supported v2 profile');
  check(!bodySupport||nativeSizeV2&&value.junctionProfile===TERRAIN_BOTTOM_ADAPTIVE_COVERAGE_PROFILE&&value.bodySupportProfile===TERRAIN_BOTTOM_BODY_SUPPORT_PROFILE,
    'TERRAIN_BOTTOM_BODY_SUPPORT_PROFILE','Author-solid support requires the explicitly selected native-size-v2 adaptive bottom profile');
  check(!thinPlatformTop||bodySupport&&value.thinPlatformTopProfile===TERRAIN_BOTTOM_THIN_PLATFORM_TOP_PROFILE,
    'TERRAIN_BOTTOM_THIN_PLATFORM_TOP_PROFILE','Thin platform top cover requires explicit author-solid body support');
  check(exact(value,['format','profile','sourceBinding','edge','leftCorner','rightCorner',...(nativeSizeV2?['nativeSizeProfile','renderEnvelopeProfile']:[]),...(junction?['junctionProfile']:[]),...(bodySupport?['bodySupportProfile']:[]),...(thinPlatformTop?['thinPlatformTopProfile']:[])])
    &&(nativeSizeV2?value.profile===TERRAIN_BOTTOM_EDGE_PROFILE_V2&&value.nativeSizeProfile===TERRAIN_BOTTOM_NATIVE_SIZE_PROFILE
      &&value.renderEnvelopeProfile===TERRAIN_BOTTOM_RENDER_ENVELOPE_PROFILE
      :value.format==='ai_scene_terrain_bottom_edges_v1'&&value.profile===TERRAIN_BOTTOM_EDGE_PROFILE),
  'TERRAIN_BOTTOM_PROFILE','Unknown native bottom-edge contract');
  check(terrainEdges?.format==='ai_scene_terrain_edges_v6'&&terrainEdges.materialProfile==='union-world-body-local-surface-v1'
    &&['left','right'].every(side=>terrainEdges[side]?.wall&&terrainEdges[side]?.corner),
    'TERRAIN_BOTTOM_DEPENDENCY','Bottom edges require the existing v6 side and union-material contract');
  check(exact(value.sourceBinding,['materialSourceSha256','surfaceMappingSha256'])
    &&digest(value.sourceBinding.materialSourceSha256)&&digest(value.sourceBinding.surfaceMappingSha256)
    &&value.sourceBinding.materialSourceSha256===appearance?.sourceSha256
    &&value.sourceBinding.surfaceMappingSha256===appearance?.surfaceMappingSha256,
  'TERRAIN_BOTTOM_BINDING','Bottom artwork must bind the accepted material and measured source mapping');
  const paths=new Set(),hashes=new Set(),existing=[appearance?.body?.source,appearance?.cap?.source,
    ...['left','right'].flatMap(side=>['wall','corner'].map(part=>terrainEdges[side]?.[part]?.source))].filter(Boolean);
  for(const item of existing){paths.add(item.path);hashes.add(item.sha256);}
  const reports=[];
  for(const item of terrainBottomEdgeSources(value)){
    const {key}=item,corner=key!=='edge',side=key==='leftCorner'?'left':'right',s=ratio(item.scale),w=item.pixelSize?.width,h=item.pixelSize?.height;
    const fields=['source','pixelSize','scale','boundaryY','innerY','inboardBlend',...(corner?['boundaryX','innerX','wallStartY','stripStartX']:['repeatX'])];
    check(exact(value[key],fields)&&exact(item.source,['path','sha256','byteLength'])&&safePath(item.source.path)
      &&digest(item.source.sha256)&&integer(item.source.byteLength,1,L.maximumSourceBytes),
    'TERRAIN_BOTTOM_SOURCE','Bottom artwork requires a bounded relative PNG reference and known role fields');
    check(!paths.has(item.source.path)&&!hashes.has(item.source.sha256),'TERRAIN_BOTTOM_SOURCE_REUSE',
      'Each native bottom role must be independent from body, cap, side and other bottom sources');
    paths.add(item.source.path);hashes.add(item.source.sha256);
    check(exact(item.pixelSize,['width','height'])&&integer(w,4,L.maximumSourceDimension)&&integer(h,4,L.maximumSourceDimension)
      &&w*h<=L.maximumSourcePixels&&exact(item.scale,['numerator','denominator'])
      &&integer(item.scale.numerator,1,65536)&&integer(item.scale.denominator,1,65536)&&s>0&&s<=1,
    'TERRAIN_BOTTOM_GEOMETRY','Bottom source dimensions and native physical scale must remain bounded');
    check(integer(item.boundaryY,2,h-1)&&integer(item.innerY,1,item.boundaryY-1)
      &&(item.boundaryY-item.innerY)*s<=L.maximumInboardWorld
      &&exact(item.inboardBlend,['fromY','toY'])&&item.inboardBlend.fromY===item.innerY
      &&integer(item.inboardBlend.toY,0,item.innerY-1)&&(item.innerY-item.inboardBlend.toY)*s<=L.maximumFadeWorld,
    'TERRAIN_BOTTOM_ROWS','The bottom joining collar must face upward into the solid with a bounded native fade');
    if(!corner){
      check(exact(item.repeatX,['from','to'])&&integer(item.repeatX.from,1,w-3)
        &&integer(item.repeatX.to,item.repeatX.from+2,w-1)
        &&w/(item.repeatX.to-item.repeatX.from)<=L.maximumRepeatLayers,
      'TERRAIN_BOTTOM_REPEAT','Native horizontal repeats require a bounded source interval and overlap count');
    }else{
      const inward=side==='left'?item.innerX-item.boundaryX:item.boundaryX-item.innerX;
      const fade=side==='left'?item.stripStartX-item.innerX:item.innerX-item.stripStartX;
      const wall=terrainEdges[side].wall,topCorner=terrainEdges[side].corner;
      const expected=side==='left'?(wall.innerX-wall.boundaryX)*ratio(wall.scale):(wall.boundaryX-wall.innerX)*ratio(wall.scale);
      const expectedCorner=side==='left'?(topCorner.innerX-topCorner.boundaryX)*ratio(topCorner.scale):(topCorner.boundaryX-topCorner.innerX)*ratio(topCorner.scale);
      check(integer(item.boundaryX,1,w-2)&&integer(item.innerX,1,w-2)&&integer(item.stripStartX,1,w-2)
        &&inward>0&&inward*s<=L.maximumInboardWorld&&fade>=2&&fade*s<=L.maximumFadeWorld
        &&integer(item.wallStartY,1,item.innerY-2)&&(item.boundaryY-item.wallStartY)*s<=L.maximumInboardWorld
        &&Math.abs(inward*s-expected)<EPS&&Math.abs(inward*s-expectedCorner)<EPS
        &&Math.abs((item.boundaryY-item.innerY)*s-(value.edge.boundaryY-value.edge.innerY)*ratio(value.edge.scale))<EPS,
      'TERRAIN_BOTTOM_CORNER','Native bottom corners must meet the checked side inset and bottom joining depth without stretching');
    }
    if(readAsset){
      const bytes=readAsset(item.source.path);
      check(bytes instanceof Uint8Array&&bytes.length===item.source.byteLength&&hash(bytes)===item.source.sha256,
        'TERRAIN_BOTTOM_CHECKSUM','Native bottom PNG bytes differ from their reference');
      let image;try{image=inspectPng(Buffer.from(bytes),{includePixels:true,allowHiddenRgb:true,allowCabx:true});}catch{
        check(false,'TERRAIN_BOTTOM_PNG','Native bottom PNG could not be decoded');
      }
      check(image.width===w&&image.height===h&&image.transparentPixels>0&&image.nonzeroAlphaPixels>0,
        'TERRAIN_BOTTOM_PNG','Bottom artwork needs its checked size, visible paint and genuine transparency');
      let paintedLeft=w,paintedRight=0,paintedTop=h,paintedBottom=0,visibleLeft=w,visibleRight=0,visibleTop=h,visibleBottom=0;
      const weak={measurement:'source-pixel-centers-outside-fixed-outward-window',pixelCount:0,alphaSum:0,maximumAlpha:0,belowPixelCount:0,sidePixelCount:0};
      for(let y=0;y<h;y++)for(let x=0;x<w;x++){
        const alpha=image.rgba[(y*w+x)*4+3];if(!alpha)continue;
        paintedLeft=Math.min(paintedLeft,x);paintedRight=Math.max(paintedRight,x+1);paintedTop=Math.min(paintedTop,y);paintedBottom=Math.max(paintedBottom,y+1);
        if(nativeSizeV2&&alpha>=L.visibleContourMinimumAlpha){visibleLeft=Math.min(visibleLeft,x);visibleRight=Math.max(visibleRight,x+1);visibleTop=Math.min(visibleTop,y);visibleBottom=Math.max(visibleBottom,y+1);}
        if(nativeSizeV2&&alpha<L.visibleContourMinimumAlpha){
          const below=(y+.5-item.boundaryY)*s>L.maximumOutwardWorld+EPS,
            outsideSide=corner&&(side==='left'?item.boundaryX-x-.5:x+.5-item.boundaryX)*s>L.maximumOutwardWorld+EPS;
          if(below||outsideSide){weak.pixelCount++;weak.alphaSum+=alpha;weak.maximumAlpha=Math.max(weak.maximumAlpha,alpha);if(below)weak.belowPixelCount++;if(outsideSide)weak.sidePixelCount++;}
        }
      }
      const outwardY=Math.max(0,paintedBottom-item.boundaryY)*s,
        outwardX=corner?Math.max(0,side==='left'?item.boundaryX-paintedLeft:paintedRight-item.boundaryX)*s:0;
      const visibleOutwardY=Math.max(0,visibleBottom-item.boundaryY)*s,
        visibleOutwardX=corner?Math.max(0,side==='left'?item.boundaryX-visibleLeft:visibleRight-item.boundaryX)*s:0;
      check((nativeSizeV2?visibleOutwardY:outwardY)<=L.maximumOutwardWorld+EPS&&(nativeSizeV2?visibleOutwardX:outwardX)<=L.maximumOutwardWorld+EPS,
        'TERRAIN_BOTTOM_OUTWARD',nativeSizeV2?'Native paint at alpha eight or higher must remain inside the sixteen-world render envelope'
          :'Measured native paint may extend no more than sixteen world units outside the declared lower contour');
      let minimum=255;
      const sample=(x,y)=>{minimum=Math.min(minimum,image.rgba[(y*w+x)*4+3]);};
      const a=corner?Math.min(item.innerX,item.stripStartX):Math.max(0,item.repeatX.from-1),
        b=corner?Math.max(item.innerX,item.stripStartX):Math.min(w-1,item.repeatX.to);
      for(let y=item.innerY-1;y<=item.innerY+1;y++)for(let x=a;x<=b;x++)sample(x,y);
      if(corner)for(let y=Math.max(0,item.wallStartY-1);y<=item.innerY+1;y++)for(let x=item.innerX-1;x<=item.innerX+1;x++)sample(x,y);
      check(minimum>=250,'TERRAIN_BOTTOM_COLLAR','Native horizontal and vertical joining collars must retain at least 250 alpha');
      reports.push({key,minimumCollarAlpha:minimum,sourceSha256:item.source.sha256,nativeOutwardWorld:{x:q(outwardX),y:q(outwardY)},sourceRgbaChanged:false,
        ...(nativeSizeV2?{nativeVisibleOutwardWorld:{x:q(visibleOutwardX),y:q(visibleOutwardY)},nativeRenderEnvelope:{
          profile:TERRAIN_BOTTOM_RENDER_ENVELOPE_PROFILE,visibleAlphaMinimum:L.visibleContourMinimumAlpha,maximumOutwardWorld:L.maximumOutwardWorld,
          bboxConvention:'half-open-original-source-pixels',nativeAlphaBbox:{left:paintedLeft,top:paintedTop,right:paintedRight,bottom:paintedBottom},
          visibleAlphaBbox:visibleRight?{left:visibleLeft,top:visibleTop,right:visibleRight,bottom:visibleBottom}:null,
          weakTailOutsideEnvelope:weak,sourcePngChanged:false,nativeAlphaChanged:false,sourcePixelsRemoved:0,
          clipping:'render-geometry-only-original-RGBA-kept'}}:{})});
    }
  }
  const junctionSources=[];
  if(junction){
    const depth=Math.min(L.maximumInboardWorld,(value.edge.boundaryY-value.edge.innerY)*ratio(value.edge.scale)+L.underlapWorld);
    for(const side of ['left','right']){
      const item=terrainEdges[side].wall,s=ratio(item.scale),fromY=Math.floor(item.repeatY.from-depth/s)-1,toY=item.repeatY.from+1;
      check(fromY>=0&&toY<item.pixelSize.height,'TERRAIN_BOTTOM_JUNCTION_COLLAR',
        'The existing side repeat must have enough native source above its first row for the bounded endpoint underlap');
      if(readAsset){
        const bytes=readAsset(item.source.path);check(bytes instanceof Uint8Array&&bytes.length===item.source.byteLength&&hash(bytes)===item.source.sha256,
          'TERRAIN_BOTTOM_CHECKSUM','Native side source differs while checking its endpoint underlap');
        let image;try{image=inspectPng(Buffer.from(bytes),{includePixels:true,allowHiddenRgb:true,allowCabx:true});}catch{
          check(false,'TERRAIN_BOTTOM_PNG','Native side PNG could not be decoded for endpoint underlap');
        }
        check(image.width===item.pixelSize.width&&image.height===item.pixelSize.height,'TERRAIN_BOTTOM_PNG','Native side dimensions differ');
        let minimum=255;for(let y=fromY;y<=toY;y++)for(let x=item.innerX-1;x<=item.innerX+1;x++)minimum=Math.min(minimum,image.rgba[(y*image.width+x)*4+3]);
        check(minimum>=250,'TERRAIN_BOTTOM_JUNCTION_COLLAR','The native upstream side collar cannot be fabricated or restarted at an endpoint');
        junctionSources.push({side,sourceSha256:item.source.sha256,nativeUpstreamRows:{from:fromY,to:toY},minimumCollarAlpha:minimum,
          extensionDepthWorld:q(depth),sourceRgbaChanged:false,phaseReset:false});
      }
    }
  }
  return {profile:value.profile,...(nativeSizeV2?{nativeSizeProfile:TERRAIN_BOTTOM_NATIVE_SIZE_PROFILE,
    renderEnvelopeProfile:TERRAIN_BOTTOM_RENDER_ENVELOPE_PROFILE,limits:clone(L)}:{}),
    ...(junction?{junctionProfile:value.junctionProfile,junctionSources}:{}),...(bodySupport?{bodySupportProfile:value.bodySupportProfile}:{}),
    ...(thinPlatformTop?{thinPlatformTopProfile:value.thinPlatformTopProfile}:{}),
    sources:reports,nativeScalePreserved:true,sourceRgbaChanged:false};
}

const empty=()=>({positions:[],uvs:[],indices:[]});
const cross=(a,b,p)=>(b.x-a.x)*(p.y-a.y)-(b.y-a.y)*(p.x-a.x);
function polygonClip(points,predicate){
  if(!points.length)return [];
  const out=[],first=predicate(points[0]);
  let va=first;
  const appendDistinct=p=>{if(!out.length||Math.hypot(p.x-out.at(-1).x,p.y-out.at(-1).y)>EPS)out.push(p);};
  for(let i=0;i<points.length;i++){
    const a=points[i],next=i+1,b=points[next]??points[0],vb=next===points.length?first:predicate(b),ia=va>=-EPS,ib=vb>=-EPS;
    if(ia)appendDistinct(a);
    if(ia!==ib){const t=va/(va-vb);appendDistinct({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t,
      ...(a.u===undefined?{}:{u:a.u+(b.u-a.u)*t,v:a.v+(b.v-a.v)*t})});}
    va=vb;
  }
  if(out.length>1&&Math.hypot(out[0].x-out.at(-1).x,out[0].y-out.at(-1).y)<=EPS)out.pop();
  return out;
}
function append(target,polygon){
  for(let i=1;i<polygon.length-1;i++){
    if(Math.abs(cross(polygon[0],polygon[i],polygon[i+1]))<EPS)continue;
    const n=target.positions.length/2;
    for(const p of [polygon[0],polygon[i],polygon[i+1]]){target.positions.push(q(p.x),q(p.y));if(p.u!==undefined)target.uvs.push(p.u,p.v);}
    target.indices.push(n,n+1,n+2);
  }return target;
}
function triangles(mesh,transform){
  const result=empty();
  for(let i=0;i<mesh.indices.length;i+=3){const polygon=mesh.indices.slice(i,i+3).map(n=>({x:mesh.positions[n*2],y:mesh.positions[n*2+1],
    ...(mesh.uvs.length===mesh.positions.length?{u:mesh.uvs[n*2],v:mesh.uvs[n*2+1]}:{})}));
    for(const piece of transform(polygon))append(result,piece);}
  return result;
}
const clipMesh=(mesh,predicate)=>triangles(mesh,p=>[polygonClip(p,predicate)]);
function intersect(mesh,polygon){
  return triangles(mesh,p=>{for(let i=0;i<polygon.length&&p.length;i++)p=polygonClip(p,a=>cross(polygon[i],polygon[(i+1)%polygon.length],a));return [p];});
}
function subtract(mesh,polygon){
  return triangles(mesh,p=>{const out=[];for(let i=0;i<polygon.length&&p.length;i++){
    const a=polygon[i],b=polygon[(i+1)%polygon.length],outside=polygonClip(p,v=>-cross(a,b,v));if(outside.length)out.push(outside);
    p=polygonClip(p,v=>cross(a,b,v));}return out;});
}
function join(meshes){const result=empty();for(const m of meshes){const n=result.positions.length/2;result.positions.push(...m.positions);result.uvs.push(...m.uvs);result.indices.push(...m.indices.map(i=>i+n));}return result;}
function rectangle(left,top,right,bottom){return [{x:left,y:top},{x:right,y:top},{x:right,y:bottom},{x:left,y:bottom}];}
const boxOf=mesh=>{
  if(!mesh.positions.length)return null;let left=Infinity,right=-Infinity,top=Infinity,bottom=-Infinity;
  for(let i=0;i<mesh.positions.length;i+=2){left=Math.min(left,mesh.positions[i]);right=Math.max(right,mesh.positions[i]);top=Math.min(top,mesh.positions[i+1]);bottom=Math.max(bottom,mesh.positions[i+1]);}
  return {left,right,top,bottom};
};

// Captured after union material mapping and before native side ownership trims.
// This transient geometry is never an artwork source or a renderer layer.
export function captureTerrainBottomBodySupport({gridTerrains,curveTerrains,profile}){
  check(profile===TERRAIN_BOTTOM_BODY_SUPPORT_PROFILE&&Array.isArray(gridTerrains)&&Array.isArray(curveTerrains),
    'TERRAIN_BOTTOM_BODY_SUPPORT_INPUT','Body support needs the explicit profile and original mapped owners');
  const owners=[...gridTerrains,...curveTerrains];
  check(owners.length<=TERRAIN_BOTTOM_EDGE_LIMITS.maximumOwners,'TERRAIN_BOTTOM_BUDGET','Body support capture exceeds the original owner budget');
  let triangles=0,vertices=0;
  for(const owner of owners){const m=owner.body;
    check(m&&Array.isArray(m.positions)&&Array.isArray(m.uvs)&&Array.isArray(m.indices)&&m.positions.length===m.uvs.length&&m.positions.length%2===0&&m.indices.length%3===0,
      'TERRAIN_BOTTOM_BODY_SUPPORT_INPUT','Body support capture requires indexed mapped body geometry');
    triangles+=m.indices.length/3;vertices+=m.positions.length/2;
    check(triangles<=TERRAIN_BOTTOM_EDGE_LIMITS.maximumOutputTriangles&&vertices<=TERRAIN_BOTTOM_EDGE_LIMITS.maximumOutputTriangles*3,
      'TERRAIN_BOTTOM_BUDGET','Body support capture exceeds the original triangle or corresponding vertex budget');
  }
  return {format:'ai_scene_terrain_bottom_body_support_v1',profile,owners:owners.map(owner=>({ownerId:owner.gridTerrainId??owner.curveId,
    body:{positions:[...owner.body.positions],uvs:[...owner.body.uvs],indices:[...owner.body.indices]}}))};
}
const overlap=(a,b)=>a&&b&&Math.min(a.right,b.right)>Math.max(a.left,b.left)+EPS&&Math.min(a.bottom,b.bottom)>Math.max(a.top,b.top)+EPS;
function merged(values){const out=[];for(const [a,b]of values.sort((p,q)=>p[0]-q[0]||p[1]-q[1])){
  if(b<=a+EPS)continue;if(out.length&&a<=out.at(-1)[1]+EPS)out.at(-1)[1]=Math.max(out.at(-1)[1],b);else out.push([a,b]);}return out;}
function difference(from,to,blocks){const out=[];let x=from;for(const [a,b]of merged(blocks)){
  if(b<=x||a>=to)continue;if(a>x+EPS)out.push([x,Math.min(a,to)]);x=Math.max(x,b);}if(x<to-EPS)out.push([x,to]);return out;}
const lineY=(primitive,x)=>primitive.a.y+(primitive.b.y-primitive.a.y)*(x-primitive.a.x)/(primitive.b.x-primitive.a.x);
function belowIntervals(from,to,y,primitives){
  const blocked=[];
  for(const p of primitives){if(p.bottom<=y+EPS||p.right<=from+EPS||p.left>=to-EPS)continue;
    const a=Math.max(from,p.left),b=Math.min(to,p.right),ya=lineY(p,a)-y,yb=lineY(p,b)-y;
    if(ya<=EPS&&yb<=EPS)blocked.push([a,b]);else if(ya<=EPS||yb<=EPS){const root=a+(b-a)*(-ya)/(yb-ya);blocked.push(ya<=EPS?[a,root]:[root,b]);}}
  return difference(from,to,blocked);
}
const inPolygon=(p,polygon)=>polygon.every((a,i)=>cross(a,polygon[(i+1)%polygon.length],p)>=-EPS);
const contains=(primitives,x,y)=>primitives.some(p=>x>=p.left-EPS&&x<=p.right+EPS&&y>=Math.min(p.a.y,p.b.y)-EPS&&y<=p.bottom+EPS&&inPolygon({x,y},p.polygon));
function hull(points){
  const sorted=points.toSorted((a,b)=>a.x-b.x||a.y-b.y),half=[];
  for(const p of sorted){while(half.length>1&&cross(half.at(-2),half.at(-1),p)<=EPS)half.pop();half.push(p);}const lower=half.slice();half.length=0;
  for(const p of sorted.toReversed()){while(half.length>1&&cross(half.at(-2),half.at(-1),p)<=EPS)half.pop();half.push(p);}lower.pop();half.pop();return [...lower,...half];
}

// Presentation only. True south-facing union intervals own the new sources;
// body/cap UVs, source bytes, author solids and collision remain unchanged.
export function compileTerrainBottomEdges({gridTerrains,curveTerrains,bottomEdges,terrainEdges,world,grid={width:64,height:64},cells=new Map(),interiorBodySupport}, {ownedMeshes=false}={}){
  const nativeSizeV2=bottomEdges?.format==='ai_scene_terrain_bottom_edges_v2',L=nativeSizeV2?TERRAIN_BOTTOM_EDGE_LIMITS_V2:TERRAIN_BOTTOM_EDGE_LIMITS;
  const junction=Object.hasOwn(bottomEdges??{},'junctionProfile');
  const adaptive=junction&&bottomEdges.junctionProfile===TERRAIN_BOTTOM_ADAPTIVE_COVERAGE_PROFILE;
  const bodySupport=Object.hasOwn(bottomEdges??{},'bodySupportProfile');
  const thinPlatformTop=Object.hasOwn(bottomEdges??{},'thinPlatformTopProfile');
  check(!bodySupport||nativeSizeV2&&adaptive&&bottomEdges.bodySupportProfile===TERRAIN_BOTTOM_BODY_SUPPORT_PROFILE,
    'TERRAIN_BOTTOM_BODY_SUPPORT_PROFILE','Author-solid support requires the explicitly selected native-size-v2 adaptive bottom profile');
  check(bodySupport||interiorBodySupport===undefined,'TERRAIN_BOTTOM_BODY_SUPPORT_INPUT','Unselected body support may not change legacy geometry');
  check(!thinPlatformTop||bodySupport&&bottomEdges.thinPlatformTopProfile===TERRAIN_BOTTOM_THIN_PLATFORM_TOP_PROFILE,
    'TERRAIN_BOTTOM_THIN_PLATFORM_TOP_PROFILE','Thin platform top cover requires explicit author-solid body support');
  check(!junction||nativeSizeV2&&TERRAIN_BOTTOM_JUNCTION_PROFILES.includes(bottomEdges.junctionProfile),
    'TERRAIN_BOTTOM_JUNCTION_PROFILE','Endpoint underlap requires the explicit supported v2 profile');
  check((nativeSizeV2?bottomEdges.profile===TERRAIN_BOTTOM_EDGE_PROFILE_V2&&bottomEdges.nativeSizeProfile===TERRAIN_BOTTOM_NATIVE_SIZE_PROFILE
      &&bottomEdges.renderEnvelopeProfile===TERRAIN_BOTTOM_RENDER_ENVELOPE_PROFILE
      :bottomEdges?.profile===TERRAIN_BOTTOM_EDGE_PROFILE&&bottomEdges.format==='ai_scene_terrain_bottom_edges_v1')
    &&terrainEdges?.format==='ai_scene_terrain_edges_v6'&&grid.width===64&&grid.height===64,
  'TERRAIN_BOTTOM_DEPENDENCY','Native bottom compilation requires a validated v6 union kit');
  check(Array.isArray(gridTerrains)&&Array.isArray(curveTerrains)&&gridTerrains.length+curveTerrains.length<=L.maximumOwners
    &&cells instanceof Map,'TERRAIN_BOTTOM_GEOMETRY','Bottom compilation needs bounded original grid and curve owners');
  // The scene compiler can hand off scratch owners that no earlier pass will use again.
  const outputGrid=ownedMeshes?gridTerrains:gridTerrains.map(clone),
    outputCurves=ownedMeshes?curveTerrains:curveTerrains.map(clone),
    owners=[...outputGrid,...outputCurves],primitives=[],ordinary=new Map(),candidates=[];
  if(bodySupport){
    check(exact(interiorBodySupport,['format','profile','owners'])&&interiorBodySupport.format==='ai_scene_terrain_bottom_body_support_v1'
      &&interiorBodySupport.profile===TERRAIN_BOTTOM_BODY_SUPPORT_PROFILE&&Array.isArray(interiorBodySupport.owners)
      &&interiorBodySupport.owners.length===owners.length,'TERRAIN_BOTTOM_BODY_SUPPORT_INPUT','Body support must bind every original mapped owner');
    let inputTriangles=0,inputVertices=0;
    for(const [i,row]of interiorBodySupport.owners.entries()){
      const m=row.body;
      check(exact(row,['ownerId','body'])&&row.ownerId===(owners[i].gridTerrainId??owners[i].curveId)
        &&m&&Array.isArray(m.positions)&&Array.isArray(m.uvs)&&Array.isArray(m.indices)&&m.positions.length===m.uvs.length&&m.positions.length%2===0
        &&m.indices.length%3===0&&m.positions.every(Number.isFinite)&&m.uvs.every(Number.isFinite)
        &&m.indices.every(n=>Number.isSafeInteger(n)&&n>=0&&n<m.positions.length/2),
      'TERRAIN_BOTTOM_BODY_SUPPORT_INPUT','Body support must retain the mapped owner identity and indexed world-UV mesh');
      inputTriangles+=m.indices.length/3;inputVertices+=m.positions.length/2;
      check(inputTriangles<=L.maximumOutputTriangles&&inputVertices<=L.maximumOutputTriangles*3,
        'TERRAIN_BOTTOM_BUDGET','Body support input exceeds the original aggregate triangle or corresponding vertex budget');
    }
  }
  check(!adaptive||owners.every(owner=>Array.isArray(owner.topCoverBands)),
    'TERRAIN_BOTTOM_ADAPTIVE_TOP_COVER','Adaptive lower coverage requires original supported union cap bands from before side and bottom cutback');
  if(adaptive)for(const owner of owners){
    // Move, never copy: every complete native upper corner is composited once,
    // after the lower arms and central cap, with its original alpha and UVs.
    const upper=edge=>edge.part==='corner'&&['left.corner','right.corner'].includes(edge.materialKey);
    owner.nativeTopCornerMeshes=(owner.edgeMeshes??[]).filter(upper);
    if(owner.edgeMeshes)owner.edgeMeshes=owner.edgeMeshes.filter(edge=>!upper(edge));
  }
  const report={format:nativeSizeV2?'ai_scene_terrain_bottom_edge_placement_v2':'ai_scene_terrain_bottom_edge_placement_v1',profile:bottomEdges.profile,
    ...(nativeSizeV2?{nativeSizeProfile:TERRAIN_BOTTOM_NATIVE_SIZE_PROFILE,renderEnvelopeProfile:TERRAIN_BOTTOM_RENDER_ENVELOPE_PROFILE,
      alphaThresholdUse:'visible-contour-measurement-only-native-render-alpha-unchanged',
      horizontalRepeatSampling:'native-central-repeat-window-v1',nativeWindowClips:0}:{}),
    ...(junction?{junctionProfile:bottomEdges.junctionProfile,endpointHandoffs:[],nativeSideExtensions:[],
      endpointSourcePhase:'existing-native-origin-and-coverage-no-chain-restart'}:{}),
    ...(adaptive?{adaptiveCoverage:{profile:TERRAIN_BOTTOM_ADAPTIVE_COVERAGE_PROFILE,cornerYFadeWorld:2,
      maximumEndpointFadeWorld:8,topCover:'side-trimmed-central-cap-then-original-native-top-corner-once-before-native-bottom-cutback',
      nativeTopCorner:'original-source-alpha-uv-and-side-mask-late-only-bottom-cutback-fade',
      sourceCoordinates:'unchanged-native-scale-and-phase',cornerCoverage:'native-alpha-times-bounded-y-ramp-and-endpoint-fade'},
      adaptiveEndpointFades:[]}:{}),
    ...(bodySupport?{bodySupportProfile:TERRAIN_BOTTOM_BODY_SUPPORT_PROFILE,bodySupport:{profile:TERRAIN_BOTTOM_BODY_SUPPORT_PROFILE,
      source:'union-material-before-native-side-cutback',region:'true-south-exposure-inside-author-only',maximumDepthWorld:L.maximumInboardWorld,
      restoredOwnerRegions:0,outputTriangles:0,uvInterpolation:'original-mapped-triangle-barycentric',sourcePixelsChanged:false,exteriorSupport:false}}:{}),
    ...(thinPlatformTop?{thinPlatformTopProfile:bottomEdges.thinPlatformTopProfile,retainedThinPlatformTops:[]}:{}),
    topology:'true-south-union-exposure-minus-grid-and-curve-solids',grouping:'positive-length-shared-solid-boundary-no-diagonal-joins',
    limits:clone(L),sourcePngChanged:false,visibleRgbaChanged:false,sourceAlphaPolicy:'native-alpha-times-declared-inboard-coverage',
    sourceDensity:'original-native-scale-no-horizontal-fit-or-warp',bodyUvChanged:false,bodyGeometryChanged:false,capBandsChanged:false,
    bodyCutback:'true-south-span-native-inner-collar-minus-two-world-underlap',
    bodyUvPolicy:'retained-world-phase-period-and-rigid-origin-after-render-only-cutback',
    collision:'original-author-solids-unchanged',exterior:'original-native-contour-clipped-at-16-world-and-local-half-air-gap-minus-one-world-clearance',
    clipDisclosure:'occlusion-and-short-span-clips-are-presentation-crops-not-complete-silhouette-recovery',
    placed:[],skipped:[],occlusionClips:0,halfGapClips:0,shortSpanClips:0,bodyCutbacks:0,nativeMeshCount:0,outputTriangles:0,work:0,
    visualAcceptance:'not-assessed',generationCalls:0};
  const consume=n=>{report.work+=n;check(report.work<=L.maximumWork,'TERRAIN_BOTTOM_BUDGET','Bottom geometry work exceeds its explicit budget');};
  const sideTemplates=[];
  if(junction)for(const owner of owners)for(const edge of owner.edgeMeshes??[])if(edge.part==='wall'&&['left','right'].includes(edge.side)){
    check(sideTemplates.length<L.maximumNativeMeshes,'TERRAIN_BOTTOM_BUDGET','Endpoint side templates exceed the bounded mesh budget');sideTemplates.push(edge);
  }
  const addPrimitive=(owner,left,right,a,b,bottom)=>primitives.push({owner,left,right,a,b,bottom,polygon:[a,b,{x:right,y:bottom},{x:left,y:bottom}]});
  for(let i=0;i<outputGrid.length;i++)for(const c of owners[i].source.gridCells)ordinary.set(`${c.x},${c.y}`,i);
  const allCells=new Map(cells);for(const [key,i]of ordinary)if(!allCells.has(key))allCells.set(key,i);
  for(const key of allCells.keys()){const [x,y]=key.split(',').map(Number),left=x*grid.width,right=(x+1)*grid.width,top=y*grid.height,bottom=(y+1)*grid.height;
    addPrimitive(ordinary.get(key)??-1,left,right,{x:left,y:top},{x:right,y:top},bottom);
    const owner=ordinary.get(key);if(owner!==undefined&&!allCells.has(`${x},${y+1}`))candidates.push({owner,fromX:left,toX:right,y:bottom});}
  for(let i=0;i<outputCurves.length;i++){
    const owner=outputGrid.length+i,c=owners[owner],bottom=c.bounds.y+c.bounds.height;
    for(let j=0;j<c.surface.length-1;j++){const a=c.surface[j],b=c.surface[j+1];addPrimitive(owner,a.x,b.x,a,b,bottom);}
    candidates.push({owner,fromX:c.surface[0].x,toX:c.surface.at(-1).x,y:bottom});
  }
  check(candidates.length<=L.maximumSegments&&primitives.length<=L.maximumSegments,'TERRAIN_BOTTOM_BUDGET','Bottom union exceeds its primitive budget');
  const byY=new Map();
  for(const c of candidates){consume(primitives.length);for(const [fromX,toX]of belowIntervals(c.fromX,c.toX,c.y,primitives)){
    if(!byY.has(c.y))byY.set(c.y,[]);byY.get(c.y).push({...c,fromX,toX});}}
  const chains=[];
  for(const [y,segments]of [...byY].sort(([a],[b])=>a-b)){
    segments.sort((a,b)=>a.fromX-b.fromX||a.toX-b.toX||a.owner-b.owner);let chain;
    for(const s of segments){if(chain&&s.fromX<=chain.toX+EPS){chain.toX=Math.max(chain.toX,s.toX);chain.units.push(s);}
      else{chain={y,fromX:s.fromX,toX:s.toX,units:[s]};chains.push(chain);}}
  }
  const worldRect={left:world.x,right:world.x+world.width,top:world.y,bottom:world.y+world.height},
    worldPolygon=rectangle(worldRect.left,worldRect.top,worldRect.right,worldRect.bottom);
  const id=i=>owners[i].gridTerrainId??owners[i].curveId;
  const area=mesh=>{let result=0;for(let i=0;i<mesh.indices.length;i+=3){const [a,b,c]=mesh.indices.slice(i,i+3).map(n=>({x:mesh.positions[n*2],y:mesh.positions[n*2+1]}));result+=Math.abs(cross(a,b,c))/2;}return result;};
  const clipped=(before,after)=>area(before)-area(after)>EPS;
  const local=(box)=>{consume(primitives.length);return primitives.filter(p=>overlap(box,{left:p.left,right:p.right,top:Math.min(p.a.y,p.b.y),bottom:p.bottom}));};
  // The outgoing lower contour is clipped halfway to each real lower solid.
  // Convex polygons preserve sampled curve tops rather than filling a hull.
  function lowerGap(mesh,base){
    let result=mesh;const box=boxOf(mesh);if(!box)return result;
    for(const p of local({left:box.left,right:box.right,top:base,bottom:worldRect.bottom})){
      if(p.bottom<=base+EPS)continue;
      const left=Math.max(box.left,p.left),right=Math.min(box.right,p.right);if(right<=left+EPS)continue;
      const ya=lineY(p,left)-base-2*L.minimumAirClearanceWorld,yb=lineY(p,right)-base-2*L.minimumAirClearanceWorld,xs=[left,right];
      if(ya*yb<0)xs.splice(1,0,left+(right-left)*(-ya)/(yb-ya));
      for(let j=0;j<xs.length-1;j++){
        const a=xs[j],b=xs[j+1],mid=(a+b)/2,blocked=lineY(p,mid)<=base+2*L.minimumAirClearanceWorld+EPS,
          ta=blocked?base:(base+lineY(p,a))/2-L.minimumAirClearanceWorld,tb=blocked?base:(base+lineY(p,b))/2-L.minimumAirClearanceWorld;
        const next=subtract(result,[{x:a,y:ta},{x:b,y:tb},{x:b,y:worldRect.bottom},{x:a,y:worldRect.bottom}]);
        if(clipped(result,next))report.halfGapClips++;result=next;consume(result.indices.length/3+1);
      }
    }return result;
  }
  // For a lower corner's side overhang, a horizontal midpoint transform of
  // actual neighboring convex solids bounds the local left/right air gap.
  function sideGap(mesh,x,side){
    let result=mesh;const box=boxOf(mesh);if(!box)return result;
    for(const p of local({left:side==='left'?worldRect.left:x,right:side==='left'?x:worldRect.right,top:box.top,bottom:box.bottom})){
      const poly=polygonClip(p.polygon,a=>side==='left'?x-a.x:a.x-x);if(poly.length<3)continue;
      const transformed=poly.map(a=>({x:(a.x+x)/2+(side==='left'?1:-1)*L.minimumAirClearanceWorld,y:a.y})),edge=side==='left'?worldRect.left:worldRect.right,
        polygon=hull([...transformed,...transformed.map(a=>({x:edge,y:a.y}))]);
      if(polygon.length<3)continue;const next=subtract(result,polygon);if(clipped(result,next))report.halfGapClips++;result=next;consume(result.indices.length/3+1);
    }return result;
  }
  function mask(mesh,chain,cornerSide,endpoint){
    const base=chain.y,bounded=intersect(mesh,worldPolygon),interior=clipMesh(bounded,p=>base-p.y),
      below=lowerGap(clipMesh(bounded,p=>p.y-base),base),inside=[];
    const box=boxOf(interior);if(box)for(const p of local(box))if(chain.allowed.has(p.owner))inside.push(intersect(interior,p.polygon));
    let exterior=below;
    if(cornerSide){
      let sideways=clipMesh(interior,p=>cornerSide==='left'?endpoint-p.x:p.x-endpoint);
      sideways=sideGap(sideways,endpoint,cornerSide);
      for(const p of local(boxOf(sideways))){const next=subtract(sideways,p.polygon);if(clipped(sideways,next))report.occlusionClips++;sideways=next;}
      exterior=join([exterior,sideways]);
    }
    for(const p of local(boxOf(exterior))){const next=subtract(exterior,p.polygon);if(clipped(exterior,next))report.occlusionClips++;exterior=next;}
    return join([...inside,exterior]);
  }
  function emit(item,key,originX,originY,chain,rect,opacity,cornerSide,endpoint,target){
    if(opacity<=0||rect.right<=rect.left+EPS||rect.bottom<=rect.top+EPS)return;
    const raw=append(empty(),rectangle(rect.left,rect.top,rect.right,rect.bottom)),final=mask(raw,chain,cornerSide,endpoint);
    if(!final.indices.length)return;
    const s=ratio(item.scale),w=item.pixelSize.width,h=item.pixelSize.height;
    final.uvs=final.positions.map((n,i)=>(n-(i%2?originY:originX))/(s*(i%2?h:w)));
    check(final.uvs.every(v=>Number.isFinite(v)&&v>=-EPS&&v<=1+EPS),'TERRAIN_BOTTOM_GEOMETRY','Native bottom UVs may not leave their complete source PNG');
    report.nativeMeshCount++;report.outputTriangles+=final.indices.length/3;
    check(report.nativeMeshCount<=L.maximumNativeMeshes&&report.outputTriangles<=L.maximumOutputTriangles,
      'TERRAIN_BOTTOM_BUDGET','Bottom output exceeds its bounded native-mesh budget');
    target.edgeMeshes??=[];target.edgeMeshes.push({...final,materialKey:'bottom.'+key,source:clone(item.source),part:'bottom',bottomPart:key,
      coverageOpacity:q(opacity),coverageProfile:'native-bottom-inboard-source-over-v1',nativeSourceOriginWorld:{x:q(originX),y:q(originY)},
      ...(nativeSizeV2&&key==='edge'?{nativeRepeatWindow:{from:item.repeatX.from,to:item.repeatX.to,interval:'half-open-source-pixels'}}:{}),
      nativeScale:clone(item.scale),sourcePngChanged:false,unionBottom:{fromX:chain.fromX,toX:chain.toX,y:chain.y}});
  }
  function draw(item,key,chain,from,to,target,side,endpointFade=null,phaseAnchor=from){
    const s=ratio(item.scale),corner=Boolean(side),endpoint=side==='left'?chain.fromX:chain.toX,
      oy=chain.y-item.boundaryY*s,top=Math.max(oy,chain.y-L.maximumInboardWorld),bottom=Math.min(oy+item.pixelSize.height*s,chain.y+L.maximumOutwardWorld),
      yFade0=oy+item.inboardBlend.toY*s,yFade1=oy+item.innerY*s;
    const period=corner?0:(item.repeatX.to-item.repeatX.from)*s,
      first=adaptive&&!corner?Math.floor((from-phaseAnchor)/period):0,
      count=corner?1:adaptive?Math.ceil((to-phaseAnchor)/period)-first+1:Math.ceil((to-from)/period)+1;
    check(Number.isSafeInteger(count)&&count>0&&count<=L.maximumSegments,'TERRAIN_BOTTOM_BUDGET','Bottom horizontal repeats exceed their bounded interval count');
    const origins=corner?[endpoint-item.boundaryX*s]:Array.from({length:count},(_,i)=>(adaptive?phaseAnchor:from)-item.repeatX.from*s+(i+first)*period);
    for(const ox of origins){
      // The isolated horizontal source can contain finite terminal caps. V2
      // repeats only the measured half-open interior window; native lower
      // corners provide the actual endpoints. Keep source coordinates and tile
      // origin unchanged rather than rescaling or baking a cropped texture.
      const window=nativeSizeV2&&!corner,
        left=Math.max(ox+(window?item.repeatX.from*s:0),from),
        right=Math.min(ox+(window?item.repeatX.to:item.pixelSize.width)*s,to);
      if(right<=left+EPS)continue;
      if(window&&(left>Math.max(ox,from)+EPS||right<Math.min(ox+item.pixelSize.width*s,to)-EPS))report.nativeWindowClips++;
      const wallStart=corner?oy+item.wallStartY*s:0,
        ys=[top,...(corner?[wallStart,...(adaptive?Array.from({length:L.coverageBands},(_,i)=>wallStart+L.underlapWorld*(i+1)/L.coverageBands):[])]:[]),
          ...Array.from({length:L.coverageBands+1},(_,i)=>yFade0+(yFade1-yFade0)*i/L.coverageBands),bottom].filter(v=>v>=top-EPS&&v<=bottom+EPS).sort((a,b)=>a-b);
      const x0=corner?ox+item.innerX*s:null,x1=corner?ox+item.stripStartX*s:null,
        xs=corner?[left,...Array.from({length:L.coverageBands+1},(_,i)=>x0+(x1-x0)*i/L.coverageBands),
          ...(endpointFade?Array.from({length:L.coverageBands+1},(_,i)=>endpointFade.from+(endpointFade.to-endpointFade.from)*i/L.coverageBands):[]),
          right].filter(v=>v>=left-EPS&&v<=right+EPS).sort((a,b)=>a-b):[left,right];
      for(let yi=0;yi<ys.length-1;yi++)for(let xi=0;xi<xs.length-1;xi++){
        const ya=ys[yi],yb=ys[yi+1],xa=xs[xi],xb=xs[xi+1],ym=(ya+yb)/2,xm=(xa+xb)/2,
          horizontal=Math.max(0,Math.min(1,(ym-yFade0)/(yFade1-yFade0))),
          vertical=corner&&ym>=wallStart?Math.max(0,Math.min(1,side==='left'?(x1-xm)/(x1-x0):(xm-x1)/(x0-x1)))
            *(adaptive?Math.max(0,Math.min(1,(ym-wallStart)/L.underlapWorld)):1):0,
          endFade=endpointFade?Math.max(0,Math.min(1,(endpointFade.to-xm)/(endpointFade.to-endpointFade.from))):1;
        emit(item,key,ox,oy,chain,{left:xa,right:xb,top:ya,bottom:yb},Math.max(horizontal,vertical)*endFade,side,endpoint,target);
      }
    }
  }
  function protectedPlatformCover(owner,index,chain,cutbackHeight){
    if(!thinPlatformTop||chain.allowed.size!==1||!chain.allowed.has(index)||owner.gridTerrainId)return;
    const surface=owner.surface,top=surface?.[0]?.y;
    if(!Number.isFinite(top)||chain.y-top>=cutbackHeight+L.maximumFadeWorld-EPS
      ||Math.abs(chain.fromX-surface[0].x)>=EPS||Math.abs(chain.toX-surface.at(-1).x)>=EPS)return;
    consume(surface.length);
    if(!surface.every(point=>Math.abs(point.y-top)<EPS))return;
    // The original cap extent inside this author solid also bounds the
    // supported inboard portion of each original native upper corner.
    let bottom=top;
    for(const band of owner.topCoverBands){
      consume(band.positions.length/2);
      for(let i=0;i<band.positions.length;i+=2){
        const x=band.positions[i],y=band.positions[i+1];
        if(x<chain.fromX-EPS||x>chain.toX+EPS||y<top-EPS||y>chain.y+EPS)return;
        bottom=Math.max(bottom,y);
      }
    }
    if(bottom>top+EPS)return {left:chain.fromX,right:chain.toX,top,bottom:Math.min(bottom,chain.y)};
  }
  function cutback(chain){
    const depth=(bottomEdges.edge.boundaryY-bottomEdges.edge.innerY)*ratio(bottomEdges.edge.scale),
      height=Math.max(0,depth-L.underlapWorld);if(height<=EPS)return;
    const cut=rectangle(chain.fromX,chain.y-height,chain.toX,chain.y),box={left:chain.fromX,right:chain.toX,top:chain.y-height,bottom:chain.y};
    for(let index=0;index<owners.length;index++){
      const owner=owners[index];
      const trim=mesh=>{if(!overlap(boxOf(mesh),box))return mesh;consume(mesh.indices.length/3);return {...mesh,...subtract(mesh,cut)};};
      const body=trim(owner.body);if(clipped(owner.body,body)){report.bodyGeometryChanged=true;report.bodyCutbacks++;}owner.body=body;
      if(owner.cap)owner.cap=trim(owner.cap);
      if(owner.capBands)owner.capBands=owner.capBands.map(band=>{const next=trim(band);if(clipped(band,next))report.capBandsChanged=true;return next;});
      const fadeUpper=(bands,{nativeCorner=false}={})=>{
        // A logical solid is not authority to fill a native-alpha recess.
        // Late upper paint fades while retained body still backs it and is
        // absent throughout the lower source's cutback/contour region.
        const fadeWorld=L.maximumFadeWorld,start=chain.y-height-fadeWorld,faded=[];
        for(const band of bands){
          if(!band.indices.length)continue;
          // Endpoint upper corners also own native exterior pixels. The lower
          // contour must own that exterior below the same measured handoff;
          // an unrelated side or neighboring solid gets no expanded mask.
          const endpoint=nativeCorner&&Math.abs((band.unionSide?.toY??Infinity)-chain.y)<EPS,
            left=chain.fromX-(endpoint&&band.side==='left'&&Math.abs(band.unionSide.x-chain.fromX)<EPS?L.maximumOutwardWorld:0),
            right=chain.toX+(endpoint&&band.side==='right'&&Math.abs(band.unionSide.x-chain.toX)<EPS?L.maximumOutwardWorld:0),
            region=rectangle(left,start,right,chain.y);
          if(!overlap(boxOf(band),{left,right,top:start,bottom:chain.y})){faded.push(band);continue;}
          const rest=subtract(band,region);consume(band.indices.length/3+rest.indices.length/3);
          if(rest.indices.length)faded.push({...band,...rest});
          for(let n=0;n<L.coverageBands;n++){
            const a=start+fadeWorld*n/L.coverageBands,b=start+fadeWorld*(n+1)/L.coverageBands,
              piece=intersect(band,rectangle(left,a,right,b));consume(band.indices.length/3+piece.indices.length/3);
            if(piece.indices.length)faded.push({...band,...piece,coverageOpacity:q((band.coverageOpacity??1)*(1-(n+.5)/L.coverageBands)),
              adaptiveBottomFade:{fromWorldY:q(start),toWorldY:q(chain.y-height),nativeContourRegionPainted:false,sourceUvChanged:false}});
          }
        }
        return faded;
      };
      if(adaptive){
        const protectedCover=protectedPlatformCover(owner,index,chain,height);
        if(protectedCover){
          const {left,right,top,bottom}=protectedCover,bandRegion=rectangle(left,top,right,bottom);
          owner.nativeTopCornerMeshes=owner.nativeTopCornerMeshes.flatMap(band=>{
            if(!overlap(boxOf(band),protectedCover))return fadeUpper([band],{nativeCorner:true});
            const inside=intersect(band,bandRegion);consume(band.indices.length/3+inside.indices.length/3);
            if(!inside.indices.length)return fadeUpper([band],{nativeCorner:true});
            const outside=subtract(band,bandRegion);consume(band.indices.length/3+outside.indices.length/3);
            return [...fadeUpper([{...band,...outside}],{nativeCorner:true}),{...band,...inside}];
          });
          report.retainedThinPlatformTops.push({ownerId:id(index),fromX:q(left),toX:q(right),
            topY:q(top),coverBottomY:q(bottom),platformBottomY:q(chain.y)});
        }else{
          owner.topCoverBands=fadeUpper(owner.topCoverBands);
          owner.nativeTopCornerMeshes=fadeUpper(owner.nativeTopCornerMeshes,{nativeCorner:true});
        }
      }
      if(owner.edgeMeshes)owner.edgeMeshes=owner.edgeMeshes.map(edge=>edge.materialKey?.startsWith('bottom.')?edge:trim(edge));
      if(owner.materialMapping?.bodyMapping?.startsWith('fixed-world-')){
        const mapping=owner.materialMapping,origin=mapping.bodyMapping==='fixed-world-rigid-row-repeat-v1'?ratio(mapping.bodyOriginWorldY):0;
        const width=mapping.bodyPeriod?.width??512,height=mapping.bodyPeriod?.height??256;
        owner.body.uvs=owner.body.positions.map((value,i)=>(value-(i%2?origin:0))/(i%2?height:width));
      }
    }
  }
  function supportInterior(chain){
    if(!bodySupport)return;
    const nativeDepth=(bottomEdges.edge.boundaryY-bottomEdges.edge.innerY)*ratio(bottomEdges.edge.scale),
      depth=Math.min(L.maximumInboardWorld,nativeDepth+L.maximumFadeWorld),
      region=rectangle(chain.fromX,chain.y-depth,chain.toX,chain.y),
      box={left:chain.fromX,right:chain.toX,top:chain.y-depth,bottom:chain.y};
    for(let index=0;index<owners.length;index++){
      if(!chain.allowed.has(index))continue;
      const original=interiorBodySupport.owners[index].body;
      if(!overlap(boxOf(original),box))continue;
      consume(original.indices.length/3);
      // Intersect the *mapped author body*, not a rectangular replacement.
      // The snapshot owns its original UVs, sampled slopes, cave boundaries
      // and source phase. Native outside paint keeps its own original Alpha.
      const supported=intersect(original,region);consume(supported.indices.length/3);
      if(!supported.indices.length)continue;
      let clippedSupport=empty();
      for(const p of local(box))if(p.owner===index){
        const piece=intersect(supported,p.polygon);consume(supported.indices.length/3+piece.indices.length/3);
        clippedSupport=join([clippedSupport,piece]);
      }
      if(!clippedSupport.indices.length)continue;
      const owner=owners[index],rest=subtract(owner.body,region);consume(owner.body.indices.length/3+rest.indices.length/3);
      owner.body={...owner.body,...join([rest,clippedSupport])};
      report.bodySupport.outputTriangles+=clippedSupport.indices.length/3;report.bodySupport.restoredOwnerRegions++;report.bodyGeometryChanged=true;
      check(report.bodySupport.outputTriangles+report.outputTriangles<=L.maximumOutputTriangles,
        'TERRAIN_BOTTOM_BUDGET','Author-solid support and native lower geometry exceed the original output triangle budget');
    }
  }
  function handoffSide(chain,side){
    const item=bottomEdges[side==='left'?'leftCorner':'rightCorner'],x=side==='left'?chain.fromX:chain.toX,
      wallStartWorldY=chain.y-(item.boundaryY-item.wallStartY)*ratio(item.scale),handoffWorldY=Math.min(chain.y,wallStartWorldY+L.underlapWorld);
    let clippedMeshes=0;
    for(const owner of owners)for(let i=0;i<(owner.edgeMeshes?.length??0);i++){
      const edge=owner.edgeMeshes[i];consume(1);
      if(edge.side!==side||!['wall','corner'].includes(edge.part)||!edge.unionSide
        ||Math.abs(edge.unionSide.x-x)>EPS||Math.abs(edge.unionSide.toY-chain.y)>EPS)continue;
      // The native lower contour owns exterior alpha. Its inward fade still
      // needs real old side paint behind it; retain only supported interior,
      // already bounded by cutback(), until the horizontal bottom takes over.
      const next=adaptive?join([clipMesh(edge,p=>handoffWorldY-p.y),
        ...local(boxOf(edge)).filter(p=>chain.allowed.has(p.owner)).map(p=>intersect(clipMesh(edge,p=>p.y-handoffWorldY),p.polygon))])
        :clipMesh(edge,p=>handoffWorldY-p.y);consume(edge.indices.length/3+next.indices.length/3);
      if(clipped(edge,next)){owner.edgeMeshes[i]={...edge,...next};clippedMeshes++;}
    }
    report.endpointHandoffs.push({side,x,y:chain.y,wallStartWorldY:q(wallStartWorldY),handoffWorldY:q(handoffWorldY),
      underlapWorld:L.underlapWorld,clippedMeshes,sourcePngChanged:false,includesExterior:true,
      ...(adaptive?{supportedInteriorRetainedToBottomCutback:true}:{} )});
  }
  function extendConcaveSide(chain,endpointSide,target){
    const side=endpointSide==='left'?'right':'left',x=endpointSide==='left'?chain.fromX:chain.toX;
    if(x<=worldRect.left+EPS||x>=worldRect.right-EPS)return;
    const item=terrainEdges[side].wall,s=ratio(item.scale),width=item.pixelSize.width,height=item.pixelSize.height,
      depth=Math.max(0,(bottomEdges.edge.boundaryY-bottomEdges.edge.innerY)*ratio(bottomEdges.edge.scale)-L.underlapWorld),
      fromY=Math.max(worldRect.top,chain.y-depth),toY=chain.y,seen=new Set(),origins=new Set();let nativeMeshes=0;
    // Ownership changes only in the rendered bottom cutback band. Extending
    // above its top would mark retained body paint with an unowned flat-ended
    // side stub. Source validation still checks the larger upstream guard.
    if(depth<=EPS)return;
    consume(sideTemplates.length);
    for(const template of sideTemplates){
      const boundary=template.unionSide;
      if(template.side!==side||!boundary||Math.abs(boundary.x-x)>EPS||Math.abs(boundary.fromY-chain.y)>EPS||boundary.toY<=chain.y+EPS)continue;
      const origin=template.nativeOriginWorld,interval=template.nativeCoverageInterval,factor=template.inboardProjectionFactor??1;
      check(Number.isFinite(origin)&&interval&&Number.isFinite(interval.fromX)&&Number.isFinite(interval.toX)
        &&Number.isFinite(factor)&&factor>0&&factor<=1&&template.source.sha256===item.source.sha256,
      'TERRAIN_BOTTOM_JUNCTION_METADATA','Endpoint underlap must retain the existing native side origin and coverage');
      // Only the first window owns upstream continuation into the cutback. The
      // original image rows immediately above it were checked as a collar.
      const windowed=template.junctionProfile===TERRAIN_WALL_REPEAT_WINDOW_PROFILE;
      if(windowed&&Math.abs(origin+item.repeatY.from*s-toY)>1e-6)continue;
      const top=Math.max(fromY,origin),bottom=Math.min(toY,origin+height*s);if(bottom<=top+EPS)continue;
      const token=[origin,factor,interval.fromX,interval.toX,template.coverageOpacity].join('/');if(seen.has(token))continue;seen.add(token);
      const fadeWorld=Math.min(L.maximumFadeWorld,depth),ys=adaptive?[top,...Array.from({length:L.coverageBands+1},(_,i)=>fromY+fadeWorld*i/L.coverageBands),bottom]
        .filter(y=>y>=top-EPS&&y<=bottom+EPS).sort((a,b)=>a-b):[top,bottom],
        xs=[interval.fromX,...(interval.fromX<item.boundaryX&&interval.toX>item.boundaryX?[item.boundaryX]:[]),interval.toX];
      for(let j=0;j<xs.length-1;j++)for(let yi=0;yi<ys.length-1;yi++){
        const ya=ys[yi],yb=ys[yi+1];if(yb<=ya+EPS)continue;
        const a=xs[j],b=xs[j+1],project=sourceX=>{const p=x+(sourceX-item.boundaryX)*s;return (side==='left'?p>x:p<x)?x+(p-x)*factor:p;},
          left=project(a),right=project(b),raw=append(empty(),[{x:left,y:ya,u:a/width,v:(ya-origin)/(height*s)},
            {x:right,y:ya,u:b/width,v:(ya-origin)/(height*s)},{x:right,y:yb,u:b/width,v:(yb-origin)/(height*s)},
            {x:left,y:yb,u:a/width,v:(yb-origin)/(height*s)}]),bounded=intersect(raw,worldPolygon),parts=[];
        for(const p of local(boxOf(bounded)))if(chain.allowed.has(p.owner))parts.push(intersect(bounded,p.polygon));
        const final=join(parts);if(!final.indices.length)continue;
        report.nativeMeshCount++;report.outputTriangles+=final.indices.length/3;
        check(report.nativeMeshCount<=L.maximumNativeMeshes&&report.outputTriangles<=L.maximumOutputTriangles,
          'TERRAIN_BOTTOM_BUDGET','Endpoint underlap exceeds the native mesh budget');
        target.edgeMeshes??=[];target.edgeMeshes.push({...template,...final,
          ...(windowed?{nativeVerticalRange:{fromY:q((ya-origin)/s),toY:q((yb-origin)/s)}}:{}),
          ...(adaptive?{coverageOpacity:q((template.coverageOpacity??1)*Math.max(0,Math.min(1,((ya+yb)/2-fromY)/fadeWorld)))}:{}),
          edgeId:`${template.edgeId}/bottom-underlap/${q(chain.y)}/${j}${adaptive?'/fade.'+yi:''}`,nativeCoverageInterval:{fromX:a,toX:b},
          bottomJunction:{kind:'concave-side-underlap',profile:bottomEdges.junctionProfile,sourceOriginWorldY:origin,
            fromY:q(fromY),toY:q(toY),renderRegion:'bottom-cutback-band-only',supportedSolidOnly:true,phaseReset:false,sourcePngChanged:false,
            ...(adaptive?{topFadeWorld:q(fadeWorld),backing:'retained-solid-body-or-native-bottom-strip'}:{})}});
        nativeMeshes++;origins.add(origin);
      }
    }
    check(nativeMeshes>0,'TERRAIN_BOTTOM_JUNCTION_METADATA','A concave endpoint requires its existing native side source for phase-preserving underlap');
    report.nativeSideExtensions.push({side,x,y:chain.y,fromY:q(fromY),toY:q(toY),sourceSha256:item.source.sha256,
      sourceOriginWorldYs:[...origins].sort((a,b)=>a-b),nativeMeshes,renderRegion:'bottom-cutback-band-only',supportedSolidOnly:true,phaseReset:false,sourcePngChanged:false,
      ...(adaptive?{topFadeWorld:q(Math.min(L.maximumFadeWorld,depth))}:{})});
  }
  for(const chain of chains){
    if(chain.y>=worldRect.bottom-EPS){report.skipped.push({fromX:chain.fromX,toX:chain.toX,y:chain.y,reason:'world-boundary'});continue;}
    const contributorIndices=[...new Set(chain.units.map(u=>u.owner))],target=owners[Math.max(...contributorIndices)],width=chain.toX-chain.fromX,half=width/2;
    chain.allowed=new Set(contributorIndices);for(const i of contributorIndices){const group=owners[i].unionMaterial?.group;
      if(group!==undefined)for(let j=0;j<owners.length;j++)if(owners[j].unionMaterial?.group===group)chain.allowed.add(j);}
    const leftCorner=!contains(primitives,chain.fromX-1e-4,chain.y-1e-4)&&chain.fromX>worldRect.left+EPS,
      rightCorner=!contains(primitives,chain.toX+1e-4,chain.y-1e-4)&&chain.toX<worldRect.right-EPS;
    const leftItem=bottomEdges.leftCorner,rightItem=bottomEdges.rightCorner,
      leftReach=leftCorner?(leftItem.stripStartX-leftItem.boundaryX)*ratio(leftItem.scale):0,
      rightReach=rightCorner?(rightItem.boundaryX-rightItem.stripStartX)*ratio(rightItem.scale):0,
      actualLeft=Math.min(half,leftReach),actualRight=Math.min(half,rightReach);
    if(actualLeft<leftReach-EPS||actualRight<rightReach-EPS)report.shortSpanClips++;
    const legacyEdgeFrom=chain.fromX+Math.max(0,actualLeft-L.underlapWorld),legacyEdgeTo=chain.toX-Math.max(0,actualRight-L.underlapWorld),
      leftFade=adaptive&&leftCorner?{from:chain.fromX+Math.max(0,actualLeft-Math.min(L.maximumFadeWorld,actualLeft/2)),to:chain.fromX+actualLeft}:null,
      rightFade=adaptive&&rightCorner?{from:chain.toX-Math.max(0,actualRight-Math.min(L.maximumFadeWorld,actualRight/2)),to:chain.toX-actualRight}:null,
      edgeFrom=leftFade?Math.min(legacyEdgeFrom,leftFade.from-L.underlapWorld):legacyEdgeFrom,
      edgeTo=rightFade?Math.max(legacyEdgeTo,rightFade.from+L.underlapWorld):legacyEdgeTo;
    if(adaptive)report.adaptiveEndpointFades.push({fromX:chain.fromX,toX:chain.toX,y:chain.y,
      left:leftFade,right:rightFade,horizontalCoverage:{fromX:edgeFrom,toX:edgeTo,phaseAnchorWorldX:legacyEdgeFrom},sourceCoordinatesWarped:false});
    cutback(chain);
    if(junction){
      if(leftCorner)handoffSide(chain,'left');else extendConcaveSide(chain,'left',target);
      if(rightCorner)handoffSide(chain,'right');else extendConcaveSide(chain,'right',target);
    }
    draw(bottomEdges.edge,'edge',chain,edgeFrom,edgeTo,target,undefined,null,legacyEdgeFrom);
    if(leftCorner)draw(leftItem,'leftCorner',chain,chain.fromX-L.maximumOutwardWorld,chain.fromX+actualLeft,target,'left',leftFade);
    if(rightCorner)draw(rightItem,'rightCorner',chain,chain.toX-actualRight,chain.toX+L.maximumOutwardWorld,target,'right',rightFade);
    supportInterior(chain);
    report.placed.push({fromX:chain.fromX,toX:chain.toX,y:chain.y,ownerIds:contributorIndices.map(id),drawOwnerId:id(owners.indexOf(target)),
      leftCornerApplied:leftCorner,rightCornerApplied:rightCorner,sharedAuthorBoundaryRestarts:0,
      nativeScalePreserved:true,inwardFit:'clip-native-source-at-half-span-no-coordinate-warp',outwardWorldLimit:L.maximumOutwardWorld});
  }
  if(adaptive){
    const before={nativeTopCornerMeshes:owners.reduce((n,o)=>n+(o.nativeTopCornerMeshes??[]).filter(m=>m.indices.length).length,0),
      nativeLowerMeshes:owners.reduce((n,o)=>n+(o.edgeMeshes??[]).filter(m=>m.part==='bottom'&&m.indices.length).length,0)},
      triangles=list=>list.reduce((n,m)=>n+m.indices.length/3,0);
    let conservedTriangles=0;
    for(const owner of owners){
      for(const [key,eligible]of [['nativeTopCornerMeshes',()=>true],['edgeMeshes',m=>m.part==='bottom']]){
        const original=owner[key]??[],count=triangles(original),merged=mergeNativeCoveragePartitions(original,eligible);
        consume(original.length+merged.length);
        check(triangles(merged)===count,'TERRAIN_BOTTOM_GEOMETRY','Coverage draw merging must preserve every original triangle');
        conservedTriangles+=count;owner[key]=merged;
      }
    }
    const after={nativeTopCornerMeshes:owners.reduce((n,o)=>n+(o.nativeTopCornerMeshes??[]).filter(m=>m.indices.length).length,0),
      nativeLowerMeshes:owners.reduce((n,o)=>n+(o.edgeMeshes??[]).filter(m=>m.part==='bottom'&&m.indices.length).length,0)};
    report.nativeMeshCount-=before.nativeLowerMeshes-after.nativeLowerMeshes;
    report.coverageMeshMerging={profile:'disjoint-native-coverage-grid-state-merge-v1',before,after,conservedTriangles,
      placementOrder:'unchanged-between-original-source-placements',withinPlacement:'disjoint-grid-pieces-grouped-by-identical-draw-state',
      verticesUvsTrianglesChanged:false,sourceAlphaChanged:false};
    report.supportedTopCoverTriangles=owners.reduce((sum,owner)=>sum+(owner.topCoverBands??[]).reduce((n,band)=>n+band.indices.length/3,0),0);
    report.nativeTopCornerTriangles=owners.reduce((sum,owner)=>sum+(owner.nativeTopCornerMeshes??[]).reduce((n,band)=>n+band.indices.length/3,0),0);
    report.nativeTopCornerMeshes=owners.reduce((sum,owner)=>sum+(owner.nativeTopCornerMeshes??[]).length,0);
    check(report.nativeTopCornerMeshes+report.nativeMeshCount<=L.maximumNativeMeshes,
      'TERRAIN_BOTTOM_BUDGET',`Late upper corners (${report.nativeTopCornerMeshes}) and native lower meshes (${report.nativeMeshCount}) exceed the original native mesh limit (${L.maximumNativeMeshes})`);
    check(report.supportedTopCoverTriangles+report.nativeTopCornerTriangles+report.outputTriangles+(report.bodySupport?.outputTriangles??0)<=L.maximumOutputTriangles,
      'TERRAIN_BOTTOM_BUDGET',`Adaptive top cover (${report.supportedTopCoverTriangles}), native upper corners (${report.nativeTopCornerTriangles}) and native lower geometry (${report.outputTriangles}) exceed the original output triangle limit (${L.maximumOutputTriangles}); merged native meshes ${report.nativeTopCornerMeshes+report.nativeMeshCount}`);
  }
  return {gridTerrains:outputGrid,curveTerrains:outputCurves,report};
}
