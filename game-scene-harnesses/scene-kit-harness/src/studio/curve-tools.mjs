export function curvePreset(document, grid, curveId, familyId, preset = 'hill') {
  const oldRight = (document.bounds.x + document.bounds.width) * grid.width;
  const height = document.bounds.height * grid.height, bottom = (document.bounds.y + document.bounds.height) * grid.height;
  const start = oldRight + grid.width, end = oldRight + 15 * grid.width, mid = (start + end) / 2;
  const low = Math.round(bottom - Math.min(96, height / 4)), high = Math.round(bottom - Math.min(256, height * .6));
  const ys = preset === 'valley' ? [high, low, high] : preset === 'slope' ? [low, Math.round((low + high) / 2), high] : [low, high, low];
  return { bounds: { ...document.bounds, width: document.bounds.width + 16 }, curve: {
    curveId, familyId, profile: 'sideview-height-curve-v1', baseY: bottom,
    points: [start, mid, end].map((x, i) => ({ x, y: ys[i], slope: 0 })),
  } };
}
export function curveHandle(curve, index) {
  const p = curve.points[index], neighbor = curve.points[index + 1];
  if (!neighbor || index === 0) return null;
  const length = Math.min(64, (neighbor.x - p.x) / 3);
  return { x: p.x + length, y: p.y + p.slope * length, length };
}
export function mixedPreset(document, curveId, familyId) {
  if(document.bounds.height<4)throw new Error('混合小样需要至少 4 行地图高度。');
  const right=document.bounds.x+document.bounds.width,top=document.bounds.y+document.bounds.height-2,bottom=(top+2)*64;
  const cells=[];
  for(const x of [right+1,right+2,right+3,right+12,right+13,right+14])for(let y=top;y<top+2;y++)cells.push({x,y});
  const curve={curveId,familyId,profile:'sideview-height-curve-v1',baseY:bottom,points:[
    {x:(right+4)*64+1,y:top*64,slope:0},{x:(right+8)*64,y:bottom-256,slope:0},{x:(right+12)*64-1,y:top*64,slope:0}]};
  const first=structuredClone(curve);first.points[0].x--;
  return {curveId,commands:[...(document.format==='ai_scene_document_v1'?[{type:'enable-curve-terrain'}]:[]),
    ...(!['ai_scene_document_v3','ai_scene_document_v4','ai_scene_document_v5','ai_scene_document_v6'].includes(document.format)?[{type:'enable-mixed-terrain'}]:[]),
    {type:'resize-bounds',bounds:{...document.bounds,width:document.bounds.width+16}},
    {type:'paint-cells',familyId,cells},{type:'add-curve-terrain',curve},
    {type:'connect-curve-grid',curve,endpoint:'start',cell:{x:right+3,y:top}},
    {type:'connect-curve-grid',curve:first,endpoint:'end',cell:{x:right+12,y:top}}]};
}
