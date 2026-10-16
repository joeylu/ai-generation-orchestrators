// maxVisibleItems is an upper limit. Keep full rows in the existing scroll
// content and restrict only its viewport so the popup stays inside the canvas.
export function selectPopupBox({width,height,itemHeight,itemCount,maxVisibleItems,canvasWidth,canvasHeight,x=0,y=0}){
 const desired=Math.min(itemCount,maxVisibleItems)*itemHeight,available=canvasHeight-height;
 if(![width,height,itemHeight,canvasWidth,canvasHeight,x,y].every(Number.isFinite)||!Number.isInteger(itemCount)||itemCount<0||!Number.isInteger(maxVisibleItems)||maxVisibleItems<1||width<=0||height<=0||itemHeight<=0||width>canvasWidth||height>canvasHeight||desired>0&&available<Math.min(itemHeight,desired))throw Object.assign(Error('画布空间不足以完整显示下拉框及至少一行选项，请减小控件高度或字号。'),{code:'select.viewport'});
 const menuHeight=Math.min(desired,Math.max(0,available)),popupHeight=height+menuHeight;
 return {x:Math.max(0,Math.min(canvasWidth-width,x)),y:Math.max(0,Math.min(canvasHeight-popupHeight,y)),width,height:popupHeight,menuHeight};
}
