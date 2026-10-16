// Inventory alone may normalize transparent margins of shared List artwork.
// Keep every nonzero-alpha pixel and use one union crop for both states.
export const inventorySlotFit='visible-square-v1';
export const inventoryViewportFit='whole-slots-v1';
export function inventorySlotCrop(entries){
 if(entries.length!==2)return {status:'unavailable',reason:'missing-slot-state'};
 const [first]=entries,{width,height}=first.image,resolution=first.resolution;
 if(entries.some(e=>e.image.width!==width||e.image.height!==height||e.resolution!==resolution))return {status:'unavailable',reason:'unaligned-slot-states'};
 let left=width,top=height,right=0,bottom=0;
 for(const {image}of entries)for(let y=0;y<height;y++)for(let x=0;x<width;x++)if(image.pixels[(y*width+x)*4+3]){left=Math.min(left,x);top=Math.min(top,y);right=Math.max(right,x+1);bottom=Math.max(bottom,y+1);}
 if(right<=left||bottom<=top)return {status:'unavailable',reason:'empty-slot-artwork'};
 const crop={x:left,y:top,width:right-left,height:bottom-top},removed={left:left/resolution,top:top/resolution,right:(width-right)/resolution,bottom:(height-bottom)/resolution},states=[];
 for(const entry of entries){
  const borders=Object.fromEntries(Object.entries(entry.borders).map(([key,value])=>[key,value-removed[key]]));
  if(Object.values(borders).some(n=>n<0)||borders.left+borders.right>=crop.width/resolution||borders.top+borders.bottom>=crop.height/resolution)return {status:'unavailable',reason:'transparent-margin-crosses-slice'};
  states.push({assetId:entry.assetId,borders});
 }
 return {status:'normalized',crop,resolution,states};
}
export function wholeSlotExtent(available,side,gap,count){
 const visible=Math.max(0,Math.min(count,Math.floor((available+gap+.01)/(side+gap))));
 return visible?visible*side+(visible-1)*gap:0;
}
// Solve complete cells and their real scrollbar reservations together. A rail
// cannot steal room from the one remaining cell or invent cross-axis overflow.
export function wholeSlotViewport({width,height,side,gap,columns,rows,rail=0,outsideX=false,outsideY=false}){
 let best=null;
 for(let y=1;y<=rows;y++)for(let x=1;x<=columns;x++){
  const w=x*side+(x-1)*gap+(y<rows&&!outsideY?rail:0),h=y*side+(y-1)*gap+(x<columns&&!outsideX?rail:0);
  if(w>width+.01||h>height+.01)continue;
  if(!best||x*y>best.visibleColumns*best.visibleRows||x*y===best.visibleColumns*best.visibleRows&&x>best.visibleColumns)best={width:w,height:h,visibleColumns:x,visibleRows:y};
 }
 return best;
}
