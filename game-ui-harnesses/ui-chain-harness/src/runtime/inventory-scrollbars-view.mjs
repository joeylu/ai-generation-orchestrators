import {Container,Graphics} from 'pixi.js';
import {VerticalScrollbar} from './controls.mjs';

class InventoryScrollbar extends VerticalScrollbar{
 startUpdate(event){if(this.inputAllowed())super.startUpdate(event);}
}

// Reuse the verified vertical track and thumb on both axes. A rotated complete
// control preserves slice axes and the slider's local pointer coordinates.
export function createInventoryScrollbars({skin,view,box,listen,allowed,own}){
 const bars={},roots={},width=skin.profile.geometry.scrollbarWidth;
 let geometry,suppress=false;
 for(const axis of ['x','y']){
  const root=own(new Container()),bar=own(new InventoryScrollbar({
   bg:skin.view('skin.scrollbar.track',width,Math.max(32,skin.profile.geometry.minThumbLength)),
   fill:new Graphics().rect(0,0,1,1).fill({color:0,alpha:0}),
   slider:skin.view('skin.scrollbar.thumb',width,skin.profile.geometry.minThumbLength),min:0,max:1,step:1,value:0,
  }));
  bar.inputAllowed=allowed;root.label='inventory-scrollbar-'+axis;root.visible=false;root.eventMode='none';root.addChild(bar);view.addChild(root);
  if(axis==='x'){bar.rotation=-Math.PI/2;bar.position.y=width;}
  bars[axis]=bar;roots[axis]=root;
  listen(bar.onUpdate,value=>{if(suppress||!allowed()||!geometry?.[axis])return;box[axis==='x'?'scrollX':'scrollY']=-value;box.update();sync();});
 }
 function sync(){
  if(!geometry)return;
  suppress=true;
  try{for(const axis of ['x','y']){
   const spec=geometry[axis],bar=bars[axis],root=roots[axis];
   if(!spec){bar.cancel();root.visible=false;root.eventMode='none';continue;}
   root.visible=true;root.eventMode='passive';root.position.set(spec.x,spec.y);
   const length=axis==='x'?spec.width:spec.height;
   bar.resizeTrack(length,spec.thumbLength);bar.max=Math.max(1,geometry.range[axis]);bar.value=Math.max(0,-box[axis==='x'?'scrollX':'scrollY']);
  }}finally{suppress=false;}
 }
 listen(box.onScroll,sync);
 return {bars,roots,get geometry(){return geometry;},setGeometry(next){geometry=next;sync();},sync,suspend(){suppress=true;try{for(const bar of Object.values(bars))bar.cancel();}finally{suppress=false;}sync();}};
}
