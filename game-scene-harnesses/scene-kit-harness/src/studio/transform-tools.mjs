// Uniform, bounded author transforms. Preview arithmetic never changes a document.
export function resizeFromCorner(box,corner,point,currentScale=1){
  const west=corner.includes('w'),north=corner.includes('n');
  const fixed={x:west?box.x+box.width:box.x,y:north?box.y+box.height:box.y};
  const vx=west?-box.width:box.width,vy=north?-box.height:box.height;
  const factor=Math.max(.125/currentScale,Math.min(8/currentScale,((point.x-fixed.x)*vx+(point.y-fixed.y)*vy)/(vx*vx+vy*vy)));
  return {x:fixed.x+(west?-box.width*factor:0),y:fixed.y+(north?-box.height*factor:0),width:box.width*factor,height:box.height*factor,scale:Math.round(currentScale*factor*1000)/1000};
}
export const corners=box=>[['nw',box.x,box.y],['ne',box.x+box.width,box.y],['se',box.x+box.width,box.y+box.height],['sw',box.x,box.y+box.height]];
