// maxVisibleItems is an upper limit. Keep full rows in the existing scroll
// content and restrict only its viewport so the popup stays inside the canvas.
export function selectPopupBox({width,height,itemHeight,itemCount,maxVisibleItems,canvasWidth,canvasHeight,x=0,y=0,bottomPadding=0}){
 const desired=Math.min(itemCount,maxVisibleItems)*itemHeight,available=canvasHeight-height;
 if(![width,height,itemHeight,canvasWidth,canvasHeight,x,y,bottomPadding].every(Number.isFinite)||!Number.isInteger(itemCount)||itemCount<0||!Number.isInteger(maxVisibleItems)||maxVisibleItems<1||bottomPadding<0||width<=0||height<=0||itemHeight<=0||width>canvasWidth||height>canvasHeight||desired>0&&available<Math.min(itemHeight,desired))throw Object.assign(Error('画布空间不足以完整显示下拉框及至少一行选项，请减小控件高度或字号。'),{code:'select.viewport'});
 const padding=desired?Math.min(bottomPadding,Math.max(0,available-Math.min(itemHeight,desired))):0;
 const menuHeight=Math.min(desired,Math.max(0,available-padding)),popupHeight=height+menuHeight+padding;
 return {x:Math.max(0,Math.min(canvasWidth-width,x)),y:Math.max(0,Math.min(canvasHeight-popupHeight,y)),width,height:popupHeight,menuHeight,...(bottomPadding?{bottomPadding:padding}:{})};
}
// Map visible alpha bounds through the same fixed-cap nine-slice transform.
export function selectVisibleEdges(width,{sourceWidth,left,right,bounds}){
 const map=x=>x<=left?x:x>=sourceWidth-right?width-(sourceWidth-x):left+(x-left)*(width-left-right)/(sourceWidth-left-right);
 return {left:map(bounds.x*sourceWidth),right:map((bounds.x+bounds.width)*sourceWidth)};
}
export function selectBackdropBox(width,field,popup,minWidth=1){
 const target=selectVisibleEdges(width,field),a=selectVisibleEdges(width,popup),b=selectVisibleEdges(width+1,popup);
 const slope=(b.right-b.left)-(a.right-a.left),span=target.right-target.left;
 if(slope<=0)return {x:0,width};
 const fitted=width+(span-(a.right-a.left))/slope;
 if(!Number.isFinite(fitted)||fitted<minWidth||fitted>width)return {x:0,width};
 return {x:target.left-selectVisibleEdges(fitted,popup).left,width:fitted};
}
