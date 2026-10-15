// Camera gestures are presentation state only. Mount before authoring pointer
// listeners so a pan never also moves or resizes the selected document node.
export function mountPanelCameraNavigation({viewport,allowed,play,read,zoom,pan,restore,changed}){
 let gesture=null,hand=false,space=false,disposed=false;
 const consume=event=>{event.preventDefault();event.stopImmediatePropagation();};
 const notify=()=>changed();
 const editable=target=>!!target?.closest?.('input,textarea,select,button,a,[contenteditable]:not([contenteditable="false"])');
 const release=g=>{if(viewport.hasPointerCapture(g.pointerId))viewport.releasePointerCapture(g.pointerId);};

 function cancel(reason='cancel'){
  if(!gesture)return;
  const previous=gesture;gesture=null;
  try{release(previous);}
  finally{try{restore(previous.camera);}finally{notify();}}
 }
 function down(event){
  if(disposed||gesture||!allowed()||!(event.button===1||event.button===0&&(space||hand)))return;
  consume(event);
  const next={pointerId:event.pointerId,x:event.clientX,y:event.clientY,camera:{...read()},moved:false};
  gesture=next;
  try{viewport.setPointerCapture(event.pointerId);}
  catch{gesture=null;return;}
  viewport.focus({preventScroll:true});notify();
 }
 function update(event){
  const current=gesture;if(!current||event.pointerId!==current.pointerId||!allowed())return;
  const dx=event.clientX-current.x,dy=event.clientY-current.y;
  if(!Number.isFinite(dx)||!Number.isFinite(dy))return;
  if(dx||dy)current.moved=true;
  if(current.moved){pan(current.camera,dx,dy);notify();}
 }
 function move(event){
  if(!gesture||event.pointerId!==gesture.pointerId)return;
  consume(event);update(event);
 }
 function up(event){
  if(!gesture||event.pointerId!==gesture.pointerId)return;
  consume(event);
  try{update(event);}
  finally{const previous=gesture;gesture=null;try{release(previous);}finally{notify();}}
 }
 function abort(event){
  if(!gesture||event.pointerId!==gesture.pointerId)return;
  consume(event);cancel(event.type);
 }
 function wheel(event){
  if(disposed)return;
  if(gesture){consume(event);return;}
  if(!allowed()||play()&&!event.ctrlKey&&!event.metaKey)return;
  const unit=event.deltaMode===1?16:event.deltaMode===2?Math.max(1,viewport.clientHeight):1;
  const delta=event.deltaY*unit;
  if(!Number.isFinite(delta)||!delta)return;
  consume(event);
  const rect=viewport.getBoundingClientRect();
  const anchor={x:event.clientX-rect.left-viewport.clientLeft,y:event.clientY-rect.top-viewport.clientTop};
  // Bound only extreme synthetic wheel values; normal wheel/line/page deltas
  // retain the exponential curve, and the camera owns its scale limits.
  zoom(Math.exp(Math.max(-20,Math.min(20,-delta*.0015))),anchor);notify();
 }
 function keydown(event){
  if(disposed)return;
  if(event.key==='Escape'&&gesture){consume(event);cancel('escape');return;}
  if(event.code!=='Space'||event.altKey||event.ctrlKey||event.metaKey||editable(event.target)||!allowed())return;
  event.preventDefault();
  if(!space){space=true;notify();}
 }
 function keyup(event){if(event.code==='Space'&&space){space=false;notify();}}
 function blur(){const wasSpace=space;space=false;if(gesture)cancel('blur');else if(wasSpace)notify();}

 viewport.addEventListener('pointerdown',down,true);viewport.addEventListener('pointermove',move,true);viewport.addEventListener('pointerup',up,true);
 viewport.addEventListener('pointercancel',abort,true);viewport.addEventListener('lostpointercapture',abort,true);
 viewport.addEventListener('wheel',wheel,{capture:true,passive:false});
 window.addEventListener('keydown',keydown,true);window.addEventListener('keyup',keyup,true);window.addEventListener('blur',blur);
 return {
  get active(){return !!gesture;},get hand(){return hand;},get space(){return space;},
  setHand(value){if(disposed||hand===!!value)return;hand=!!value;if(gesture)cancel('tool');else notify();},
  cancel,
  dispose(){
   if(disposed)return;disposed=true;const held=space;space=false;hand=false;
   viewport.removeEventListener('pointerdown',down,true);viewport.removeEventListener('pointermove',move,true);viewport.removeEventListener('pointerup',up,true);
   viewport.removeEventListener('pointercancel',abort,true);viewport.removeEventListener('lostpointercapture',abort,true);viewport.removeEventListener('wheel',wheel,true);
   window.removeEventListener('keydown',keydown,true);window.removeEventListener('keyup',keyup,true);window.removeEventListener('blur',blur);
   if(gesture)cancel('dispose');else if(held)notify();
  }
 };
}
