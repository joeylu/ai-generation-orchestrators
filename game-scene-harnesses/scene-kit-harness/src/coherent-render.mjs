import {inspectPng,encodeRgbaPng} from './png.mjs';
import {resampleEnvironmentAlpha} from './environment-proof.mjs';
import {check} from './generation/common.mjs';
import {paintCoherentMesh} from './coherent-mesh-render.mjs';
import {appearanceMatrix,instanceOpacity} from './instance-appearance.mjs';
function displayResize(source,width,height){
  if(width<=source.width&&height<=source.height)return resampleEnvironmentAlpha(source,{x:0,y:0,width:source.width,height:source.height},width,height);
  // Display enlargement only, not a larger source asset. Match the nearest texture preview rule.
  const rgba=Buffer.alloc(width*height*4);for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const sx=Math.min(source.width-1,Math.floor(x*source.width/width)),sy=Math.min(source.height-1,Math.floor(y*source.height/height));
    source.rgba.copy(rgba,(y*width+x)*4,(sy*source.width+sx)*4,(sy*source.width+sx+1)*4);
  }return {width,height,rgba};
}
// Deterministic default-map comparison, not a Studio screenshot or art acceptance.
// Sprites use the historical resize rule; terrain meshes use the same indexed
// geometry, repeat/clamp policy and body-then-cap ordering as the Pixi consumer.
export function renderCoherentFrame(scene,readAsset){
  const {width,height}=scene.defaultCamera.viewport,pixels=Buffer.alloc(width*height*4);
  for(let p=0;p<pixels.length;p+=4)pixels.set([29,43,59,255],p);
  const left=scene.defaultCamera.center.x-width/2,top=scene.defaultCamera.center.y-height/2,cache=new Map();
  const patches=scene.mixedTerrains??[],patchCells=new Set(patches.flatMap(p=>p.source.gridCells.map(c=>`${c.x},${c.y}`)));
  const gridTerrains=scene.gridTerrains??[],meshCells=new Set(gridTerrains.flatMap(p=>p.source.gridCells.map(c=>`${c.x},${c.y}`)));
  const patchCurves=new Set(patches.flatMap(p=>p.source.curveIds));
  const curves=[...gridTerrains,...(scene.curveTerrains??[]).filter(c=>!patchCurves.has(c.curveId)),...patches];
  const asset=(source)=>{if(!cache.has(source.sha256))cache.set(source.sha256,inspectPng(readAsset(source.path),{includePixels:true,allowCabx:true,allowHiddenRgb:true}));return cache.get(source.sha256);};
  for(const layer of scene.layers){if(!layer.visible)continue;for(const node of layer.nodes){
    if(node.cell&&(patchCells.has(`${node.cell.x},${node.cell.y}`)||meshCells.has(`${node.cell.x},${node.cell.y}`)))continue;
    check(node.kind==='sprite','COHERENT_RENDER_SPRITE');const key=node.source.sha256;
    if(!cache.has(key))cache.set(key,inspectPng(readAsset(node.source.path),{includePixels:true,allowCabx:true,allowHiddenRgb:true}));
    const source=cache.get(key),w=Math.max(1,Math.round(node.size.width)),h=Math.max(1,Math.round(node.size.height));
    const sprite=displayResize(source,w,h),x0=Math.round(node.position.x-left),y0=Math.round(node.position.y-top);
    const color=node.renderStyle?.tint??0xffffff,tint=[color>>16&255,color>>8&255,color&255];
    const matrix=appearanceMatrix(node.appearance),opacity=instanceOpacity(node);
    for(let y=Math.max(0,-y0);y<Math.min(h,height-y0);y++)for(let x=Math.max(0,-x0);x<Math.min(w,width-x0);x++){
      const s=(y*w+x)*4,d=((y+y0)*width+x+x0)*4,a=sprite.rgba[s+3]/255*opacity;
      if(matrix){
        const r=sprite.rgba[s]*tint[0]/255,g=sprite.rgba[s+1]*tint[1]/255,b=sprite.rgba[s+2]*tint[2]/255;
        for(let c=0;c<3;c++){
          const [mr,mg,mb,offset]=matrix[c],value=Math.min(255,Math.max(0,mr*r+mg*g+mb*b+255*offset));
          pixels[d+c]=Math.round(value*a+pixels[d+c]*(1-a));
        }
      }else for(let c=0;c<3;c++)pixels[d+c]=Math.round(sprite.rgba[s+c]*tint[c]/255*a+pixels[d+c]*(1-a));
    }
  }
    for(const curve of curves.filter(c=>c.layerId===layer.layerId)){
      check(scene.terrainMaterial,'COHERENT_RENDER_MATERIAL');
      for(const kind of ['body','cap']){
        if(kind==='cap'&&Array.isArray(curve.topCoverBands))continue;
        for(const data of kind==='cap'&&curve.capBands?curve.capBands:[curve[kind]])paintCoherentMesh(pixels,{width,height},data,asset(scene.terrainMaterial[kind].source),
          {left,top,cap:kind==='cap',tint:scene.terrainMaterial.tint??0xffffff,opacity:data.coverageOpacity??1,topLeftRule:!!curve.capBands});
      }
      for(const edge of curve.edgeMeshes??[])paintCoherentMesh(pixels,{width,height},edge,asset(edge.source),
        {left,top,clampU:true,clampV:true,...(edge.coverageOpacity!==undefined?{opacity:edge.coverageOpacity,topLeftRule:true}:{})});
      for(const band of curve.fieldBoundaryBands??[])paintCoherentMesh(pixels,{width,height},band,asset(scene.terrainMaterial.body.source),
        {left,top,tint:band.shadeTint,opacity:band.coverageOpacity,topLeftRule:true});
    }
    for(const curve of curves.filter(c=>c.layerId===layer.layerId))for(const data of curve.topCoverBands??[])
      paintCoherentMesh(pixels,{width,height},data,asset(scene.terrainMaterial.cap.source),
        {left,top,cap:true,tint:scene.terrainMaterial.tint??0xffffff,opacity:data.coverageOpacity??1,topLeftRule:true});
    for(const curve of curves.filter(c=>c.layerId===layer.layerId))for(const edge of curve.nativeTopCornerMeshes??[])
      paintCoherentMesh(pixels,{width,height},edge,asset(edge.source),
        {left,top,clampU:true,clampV:true,opacity:edge.coverageOpacity??1,topLeftRule:true});
    for(const curve of curves.filter(c=>c.layerId===layer.layerId))for(const data of curve.cornerMeshes??[])
      paintCoherentMesh(pixels,{width,height},data,asset(scene.terrainMaterial[data.materialKind].source),
        {left,top,cap:data.materialKind==='cap',opacity:data.coverageOpacity??1,topLeftRule:true});
  }
  return encodeRgbaPng(width,height,pixels);
}
export function coherentComparison(referenceBytes,renderBytes){
  const original=inspectPng(referenceBytes,{includePixels:true,allowCabx:true}),render=inspectPng(renderBytes,{includePixels:true,allowCabx:true});
  const w=Math.min(1024,render.width,original.width),h=Math.max(1,Math.round(w*render.height/render.width));check(w*2<=4096,'COHERENT_COMPARISON_SIZE');
  const reference=displayResize(original,w,h),rendered=displayResize(render,w,h),rgba=Buffer.alloc(w*2*h*4);
  for(let y=0;y<h;y++){reference.rgba.copy(rgba,y*w*2*4,y*w*4,(y+1)*w*4);rendered.rgba.copy(rgba,(y*w*2+w)*4,y*w*4,(y+1)*w*4);}
  return encodeRgbaPng(w*2,h,rgba);
}
