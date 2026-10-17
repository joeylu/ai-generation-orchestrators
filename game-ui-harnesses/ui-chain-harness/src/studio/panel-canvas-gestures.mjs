import {indexDocument} from '../panel/document.mjs';
import {sizeEditTargets,rectangleEditDocument} from '../panel/size-edit.mjs';

// DOM pointer capture belongs to the editor; authoring and Pixi play state never
// receive provisional pointer mutations. A release publishes one whole candidate.
export function mountPanelCanvasGestures({viewport,world,canvas,document:readDocument,context,scene,selected,canEdit,beforeEdit,choose,start,preview,invalid,finish,cancel,status}){
 if(beforeEdit!==undefined&&typeof beforeEdit!=='function')throw new TypeError('beforeEdit must be a function.');
 let gesture=null,pending=null,frame=0,disposed=false;
 const consume=event=>{event.preventDefault();event.stopImmediatePropagation();};
 const point=event=>{const box=canvas.getBoundingClientRect(),board=context().canvases.presets[readDocument().canvas];return {x:(event.clientX-box.left)*board.width/box.width,y:(event.clientY-box.top)*board.height/box.height};};
 const rect=id=>{const handle=scene().runtime.handles.get(id);if(!handle)return null;const p=handle.root.toGlobal({x:0,y:0});return {...p,width:handle.size.width,height:handle.size.height};};
 function hits(at){
  const doc=readDocument(),{nodes,parents}=indexDocument(doc),order=[];
  const walk=id=>{const node=nodes.get(id);order.push(node);Object.values(node.slots).flat().forEach(walk);};walk(doc.rootId);
  const contains=(r,p)=>r&&p.x>=r.x&&p.y>=r.y&&p.x<=r.x+r.width&&p.y<=r.y+r.height;
  return order.reverse().filter(node=>{
   if(node.id===doc.rootId||!contains(rect(node.id),at))return false;
   for(let n=node;n;n=parents.get(n.id)?.node){
    if(n.props.visible===false)return false;
    const handle=scene().runtime.handles.get(n.id);
    for(let view=handle?.root;view;view=view.parent)if(!view.visible||!view.renderable||view.alpha===0)return false;
    if(!contains(rect(n.id),at))return false;
   }
   return true;
  });
 }
 function release(g){if(viewport.hasPointerCapture(g.pointerId))viewport.releasePointerCapture(g.pointerId);}
 function stop(reason='cancel'){
  if(pending){const waiting=pending;pending=null;release(waiting);}
  if(!gesture)return;const old=gesture;gesture=null;cancelAnimationFrame(frame);frame=0;release(old);cancel({reason,moved:old.moved});
 }
 function update(){
  frame=0;const g=gesture;if(!g||!g.moved)return;
  const dx=Math.round(g.last.x-g.start.x),dy=Math.round(g.last.y-g.start.y),edit={nodeId:g.nodeId};g.dx=dx;g.dy=dy;
  if(g.kind==='move'){edit.x=g.target.x+dx;edit.y=g.target.y+dy;}
  else{
   edit.keepPosition=true;
   if(/[ew]/.test(g.edge))edit.width=g.target.width+(g.edge.includes('w')?-dx:dx);
   if(/[ns]/.test(g.edge))edit.height=g.target.height+(g.edge.includes('n')?-dy:dy);
   if(g.edge.includes('w'))edit.x=g.target.x+dx;
   if(g.edge.includes('n'))edit.y=g.target.y+dy;
  }
  try{
   if(g.revision!==readDocument().revision)throw Error('文档已变更，请重新拖动。');
   const candidate=rectangleEditDocument(g.document,edit,context());
   preview(candidate);g.candidate=candidate;g.valid=true;g.error=null;
  }catch(error){g.candidate=null;g.valid=false;g.error=error;invalid(error);}
 }
 function begin(event){
  if(disposed||gesture||!canEdit()||!world.contains(event.target))return;
  const edge=event.target.closest?.('[data-resize]')?.dataset.resize,move=event.target.closest?.('#selection-move');
  const hitPoint=point(event),candidates=edge||move?[selected()]:hits(hitPoint).map(node=>node.id);
  if(!candidates.length)return;
  const id=event.altKey?candidates[(candidates.indexOf(selected())+1)%candidates.length]:candidates[0];
  choose(id);event.preventDefault();event.stopImmediatePropagation();
  if(event.altKey){status('已选择重叠层中的下一项。');return;}
  const doc=readDocument(),target=sizeEditTargets(doc,context()).find(item=>item.id===id);
  if(edge&&(!target.editableWidth&&!target.editableHeight))return;
  if(!edge&&!target.editablePosition){status(target.positionReason??'该节点的位置由所属布局管理，可拖动边框调整尺寸。');return;}
  // Selection may focus the node by moving or scaling the camera. Hit testing
  // uses its previous frame, but all drag samples must use the selected frame.
  const at=point(event);
  gesture={pointerId:event.pointerId,kind:edge?'resize':'move',edge,nodeId:id,start:at,last:at,client:{x:event.clientX,y:event.clientY},document:doc,revision:doc.revision,target,valid:true,candidate:null,moved:false};
  viewport.focus({preventScroll:true});viewport.setPointerCapture(event.pointerId);start();
 }
 function report(error){try{invalid(error);}catch{/* An async boundary must not leave an unhandled rejection. */}}
 function down(event){
  if(disposed||gesture||pending||!canEdit()||event.button!==0||!world.contains(event.target))return;
  if(!beforeEdit){begin(event);return;}
  let result;
  // Invoke before registering a wait: the hook may synchronously commit input
  // through the editor's normal change()/cancel('change') path.
  try{result=beforeEdit();}catch(error){report(error);return;}
  if(disposed){void Promise.resolve(result).catch(()=>{});return;}
  if(!result||typeof result.then!=='function'){if(result===true)begin(event);return;}
  consume(event);
  const waiting={pointerId:event.pointerId,event,last:null};pending=waiting;
  // Capture while waiting so a release outside the viewport cannot arrive late
  // and turn an already completed click into a drag after the hook resolves.
  try{viewport.setPointerCapture(event.pointerId);}catch(error){pending=null;report(error);void Promise.resolve(result).catch(()=>{});return;}
  let resumed=false;
  void Promise.resolve(result).then(allowed=>{
   if(disposed||pending!==waiting)return;
   pending=null;resumed=true;
   try{if(allowed===true)begin(waiting.event);if(gesture&&waiting.last)move(waiting.last);}
   finally{if(!gesture||gesture.pointerId!==waiting.pointerId)release(waiting);}
  }).catch(error=>{
   if(disposed||!resumed&&pending!==waiting)return;
   if(pending===waiting)pending=null;
   try{if(gesture?.pointerId===waiting.pointerId)stop('before-edit');else release(waiting);}catch{/* Preserve the original boundary error below. */}
   report(error);
  });
 }
 function move(event){
  if(pending&&event.pointerId===pending.pointerId){consume(event);pending.last=event;return;}
  if(!gesture||event.pointerId!==gesture.pointerId)return;
  event.preventDefault();event.stopImmediatePropagation();gesture.last=point(event);
  if(Math.hypot(event.clientX-gesture.client.x,event.clientY-gesture.client.y)>2)gesture.moved=true;
  if(gesture.moved&&!frame)frame=requestAnimationFrame(update);
 }
 function up(event){
  if(pending&&event.pointerId===pending.pointerId){consume(event);stop('pointerup');return;}
  if(!gesture||event.pointerId!==gesture.pointerId)return;
  event.preventDefault();event.stopImmediatePropagation();gesture.last=point(event);cancelAnimationFrame(frame);frame=0;update();
  const g=gesture;gesture=null;release(g);
  if(!g.moved||(!g.dx&&!g.dy)){cancel({reason:'click',moved:false});return;}
  if(!g.valid||!g.candidate){cancel({reason:'invalid',moved:true});invalid(g.error??Error('调整未通过安全检查。'));return;}
  finish(g.candidate,g.revision);
 }
 const abort=event=>{if(event.pointerId===(gesture??pending)?.pointerId)stop(event.type);};
 const escape=event=>{if((gesture||pending)&&event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();stop('escape');}};
 const blur=()=>stop('blur');
 viewport.addEventListener('pointerdown',down,true);viewport.addEventListener('pointermove',move,true);viewport.addEventListener('pointerup',up,true);
 viewport.addEventListener('pointercancel',abort,true);viewport.addEventListener('lostpointercapture',abort,true);
 window.addEventListener('keydown',escape,true);window.addEventListener('blur',blur);
 return {
  get active(){return !!gesture;},
  get pending(){return !!pending;},
  inspect(){return gesture?{active:true,kind:gesture.kind,nodeId:gesture.nodeId,valid:gesture.valid,...(gesture.candidate?{candidateDocument:structuredClone(gesture.candidate)}:{})}:{active:false,...(pending?{pending:true}:{})};},
  cancel:stop,
  dispose(){disposed=true;stop('dispose');viewport.removeEventListener('pointerdown',down,true);viewport.removeEventListener('pointermove',move,true);viewport.removeEventListener('pointerup',up,true);viewport.removeEventListener('pointercancel',abort,true);viewport.removeEventListener('lostpointercapture',abort,true);window.removeEventListener('keydown',escape,true);window.removeEventListener('blur',blur);}
 };
}
