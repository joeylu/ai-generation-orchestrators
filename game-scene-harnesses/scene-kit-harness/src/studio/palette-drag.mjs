// Pointer capture keeps palette dragging inside the webview; no OS drag service is needed.
export function bindPaletteDrag(element,{enabled,start,move,drop,cancel}){
  let gesture=null,suppressClick=false;
  function finish(event,commit=false){
    if(!gesture)return;const previous=gesture;gesture=null;
    window.removeEventListener('blur',abort);window.removeEventListener('keydown',key);
    window.removeEventListener('pointerdown',secondTouch,true);
    if(element.hasPointerCapture(previous.id))element.releasePointerCapture(previous.id);
    delete element.dataset.dragging;suppressClick=!commit||previous.moved;
    if(commit&&previous.moved)drop(event);else cancel();
  }
  function abort(){finish(null);}
  function key(event){if(event.key==='Escape'&&!event.isComposing)finish(event);}
  function secondTouch(event){if(event.pointerType==='touch'&&!event.isPrimary)finish(event);}
  element.draggable=false;
  element.addEventListener('click',event=>{
    if(!suppressClick)return;
    suppressClick=false;
    if(event.detail===0)return;
    event.preventDefault();event.stopImmediatePropagation();
  },true);
  element.addEventListener('pointerdown',event=>{
    if(gesture){if(event.button===2)finish(event);return;}
    suppressClick=false;
    const touch=event.pointerType==='touch';
    if(event.button!==0||(touch&&!event.isPrimary)||!enabled())return;
    gesture={id:event.pointerId,x:event.clientX,y:event.clientY,moved:false,touch};
    element.setPointerCapture(event.pointerId);window.addEventListener('blur',abort);window.addEventListener('keydown',key);
    if(touch)window.addEventListener('pointerdown',secondTouch,true);
  });
  element.addEventListener('pointermove',event=>{
    if(!gesture||event.pointerId!==gesture.id)return;
    if(!(event.buttons&1)||(event.buttons&2)){finish(event);return;}
    if(!gesture.moved){
      const dx=event.clientX-gesture.x,dy=event.clientY-gesture.y;
      if(Math.hypot(dx,dy)<6)return;
      if(gesture.touch&&Math.abs(dy)>Math.abs(dx)){finish(event);return;}
      gesture.moved=true;element.dataset.dragging='true';start();
    }
    event.preventDefault();move(event);
  });
  element.addEventListener('pointerup',event=>{if(gesture?.id===event.pointerId)finish(event,true);});
  for(const name of ['pointercancel','lostpointercapture'])element.addEventListener(name,event=>{if(gesture?.id===event.pointerId)finish(event);});
}
