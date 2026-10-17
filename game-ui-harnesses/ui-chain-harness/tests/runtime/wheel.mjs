import assert from 'node:assert/strict';

async function wheelDiagnostic(page,expression){
 return page.evaluate(expression=>{
  try{
   const box=Function('return '+expression)(),bounds=box.getBounds(),receipt=window.__uiChainWheelObserver?.receipt;
   return {isOver:box.isOver,visible:box.visible,allowed:box.inputAllowed?.(),bounds:{x:bounds.x,y:bounds.y,width:bounds.width,height:bounds.height},offset:box.scrollY,currentOffset:window.current?.readState().initialOffsetY,wheel:receipt?{...receipt}:null};
  }catch(error){return {diagnosticError:error.message.slice(0,160)};}
 },expression);
}

// Enter the actual clipped viewport with real pointer events. A wheel sent
// before Pixi's pointerover cannot be recovered by polling the offset later.
export async function hoverScrollBox(page,expression){
 try{
  const points=await page.evaluate(expression=>{
   harness.runtime.flush();const box=Function('return '+expression)(),canvas=harness.app.canvas,rect=canvas.getBoundingClientRect();
   const start=box.toGlobal({x:0,y:0}),end=box.toGlobal({x:box.width,y:box.height}),screen=harness.app.screen;
   const bounds={left:rect.left+Math.min(start.x,end.x)*rect.width/screen.width,right:rect.left+Math.max(start.x,end.x)*rect.width/screen.width,top:rect.top+Math.min(start.y,end.y)*rect.height/screen.height,bottom:rect.top+Math.max(start.y,end.y)*rect.height/screen.height};
   const inside={x:(bounds.left+bounds.right)/2,y:(bounds.top+bounds.bottom)/2};
   const outside=[{x:rect.left+1,y:rect.top+1},{x:rect.right-1,y:rect.top+1},{x:rect.left+1,y:rect.bottom-1},{x:rect.right-1,y:rect.bottom-1}].find(p=>p.x>=0&&p.y>=0&&p.x<innerWidth&&p.y<innerHeight&&(p.x<bounds.left||p.x>bounds.right||p.y<bounds.top||p.y>bounds.bottom));
   if(!outside||inside.x<0||inside.y<0||inside.x>=innerWidth||inside.y>=innerHeight)throw Error('Scroll viewport is not reachable by the real pointer');
   return {inside,outside};
  },expression);
  await page.mouse.move(points.outside.x,points.outside.y);
  await page.waitForFunction(expression=>Function('return '+expression)().isOver===false,expression,{timeout:5000});
  await page.mouse.move(points.inside.x,points.inside.y);
  await page.waitForFunction(expression=>Function('return '+expression)().isOver===true,expression,{timeout:5000});
 }catch(error){throw Error('Scroll hover readiness failed: '+JSON.stringify(await wheelDiagnostic(page,expression))+'; '+error.message.split('\n')[0]);}
}

// Send exactly one native wheel and observe delivery on this canvas plus the
// following rendered frame. Negative input checks must not pass before delivery.
export async function deliverCanvasWheel(page,deltaX,deltaY,expression,{scrollCondition,scrollTimeout=5000}={}){
 await page.evaluate(()=>{
  if(window.__uiChainWheelObserver)throw Error('Wheel observer was not cleaned up');
  const canvas=harness.app.canvas,receipt={received:false,rendered:false},observer={canvas,receipt,frame:null,listener:null};
  observer.listener=event=>{
   Object.assign(receipt,{received:true,trusted:event.isTrusted,deltaX:event.deltaX,deltaY:event.deltaY});
   observer.frame=requestAnimationFrame(()=>{harness.runtime.flush();receipt.rendered=true;});
  };
  window.__uiChainWheelObserver=observer;canvas.addEventListener('wheel',observer.listener,{once:true,capture:true,passive:true});
 });
 let phase='delivery/render';
 try{
  await page.mouse.wheel(deltaX,deltaY);
  // The receipt already waits for a real rendered frame. A second RAF poll
  // can starve in software-rendered CI even after both flags become true.
  await page.waitForFunction(()=>window.__uiChainWheelObserver?.receipt.received&&window.__uiChainWheelObserver.receipt.rendered,null,{polling:50,timeout:15000});
  const receipt=await page.evaluate(()=>({...window.__uiChainWheelObserver.receipt}));
  assert.equal(receipt.trusted,true,'Wheel must come from real browser input');assert.equal(receipt.deltaX,deltaX);assert.equal(receipt.deltaY,deltaY);
  if(scrollCondition){phase='scroll-result';await page.waitForFunction(condition=>Boolean(Function('return '+condition)()),scrollCondition,{timeout:scrollTimeout});}
 }catch(error){throw Error('Canvas wheel '+phase+' failed: '+JSON.stringify(await wheelDiagnostic(page,expression))+'; '+error.message.split('\n')[0]);}
 finally{
  await page.evaluate(()=>{const observer=window.__uiChainWheelObserver;if(observer){observer.canvas.removeEventListener('wheel',observer.listener,true);if(observer.frame!==null)cancelAnimationFrame(observer.frame);}delete window.__uiChainWheelObserver;});
 }
}
