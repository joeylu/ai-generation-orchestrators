const fail=message=>{throw Object.assign(new Error(message),{code:'inventory.scrollbar-geometry'});};
const finitePositive=n=>Number.isFinite(n)&&n>0;

// Presentation-only rails consume space inside the pre-existing visible grid.
// The immutable natural content extent and authored fixed cells never change.
export function inventoryScrollbarGeometry({width,height,contentWidth,contentHeight,barWidth=10,gap=8,minThumbLength=24,enabled=true,outsideX=false,outsideY=false}){
 if(![width,height,contentWidth,contentHeight,barWidth,minThumbLength].every(finitePositive)||!Number.isFinite(gap)||gap<0)fail('Invalid scrollbar dimensions.');
 const rail=barWidth+gap;
 let x=false,y=false,iterations=0;
 if(enabled)for(;iterations<3;iterations++){
  const nextX=x||contentWidth>width-(y&&!outsideY?rail:0)+.01,nextY=y||contentHeight>height-(x&&!outsideX?rail:0)+.01;
  if(nextX===x&&nextY===y)break;
  x=nextX;y=nextY;
 }
 const viewport={width:width-(y&&!outsideY?rail:0),height:height-(x&&!outsideX?rail:0)};
 if(![viewport.width,viewport.height].every(finitePositive))fail('Scrollbars leave no usable viewport.');
 const range={x:Math.max(0,contentWidth-viewport.width),y:Math.max(0,contentHeight-viewport.height)};
 const thumb=(view,content)=>Math.min(view,Math.max(minThumbLength,view*view/content));
 return {viewport,range,x:x?{x:0,y:viewport.height+gap,width:viewport.width,height:barWidth,thumbLength:thumb(viewport.width,contentWidth),placement:outsideX?'gap':'inside'}:null,y:y?{x:viewport.width+gap,y:0,width:barWidth,height:viewport.height,thumbLength:thumb(viewport.height,contentHeight),placement:outsideY?'gap':'inside'}:null,iterations};
}

// Prefer the already-authored gap between complete grid/detail surfaces. Its
// bounds exclude the surfaces' frames and exclude the detail content padding.
export function inventoryScrollbarChrome(layout,{details,barWidth=10,gap=8,minThumbLength=24,laneSafety=4}={}){
 const {grid}=layout,surface=grid.surface;
 if(!surface)fail('Explicit grid surface is required.');
 if(!Number.isFinite(laneSafety)||laneSafety<0)fail('Invalid lane safety.');
 const availableY=details==='right'?layout.details.x-(surface.x+surface.width):0;
 const availableX=details==='below'?layout.details.y-(surface.y+surface.height):0;
 const outsideY=availableY>=barWidth+laneSafety*2,outsideX=availableX>=barWidth+laneSafety*2;
 const result=inventoryScrollbarGeometry({width:grid.width,height:grid.height,contentWidth:grid.contentWidth,contentHeight:grid.contentHeight,barWidth,gap,minThumbLength,outsideX,outsideY});
 if(result.x){result.x.x+=grid.x;result.x.y=outsideX?surface.y+surface.height+(availableX-barWidth)/2:grid.y+result.x.y;}
 if(result.y){result.y.x=outsideY?surface.x+surface.width+(availableY-barWidth)/2:grid.x+result.y.x;result.y.y+=grid.y;}
 result.viewport={x:grid.x,y:grid.y,...result.viewport};
 return result;
}

export function clampInventoryScroll(position,geometry){
 if(![position.x,position.y].every(Number.isFinite))fail('Invalid scroll position.');
 return {x:Math.max(-geometry.range.x,Math.min(0,position.x))||0,y:Math.max(-geometry.range.y,Math.min(0,position.y))||0};
}
