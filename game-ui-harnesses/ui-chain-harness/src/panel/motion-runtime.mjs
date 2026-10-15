import {MotionAnimator} from '../../../ui-component-harness/src/motion-system.ts';
import {motionSelection} from './motion-profile.mjs';
import {bindComponentMotion,componentMotionCoverage} from './component-motion.mjs';

// Presentation-only adapter for the Chain runtime. It does not replace PixiUI
// controls, delay state commits, mutate authoring JSON, or intercept input.
export function attachPanelMotion(win,selection=motionSelection('original')){
 return attachMotion(win,win.actionPreview??win.settingsPreview,selection);
}
export function attachComponentMotion(win,selection=motionSelection('original','components')){
 const canvas=win.studioCanvas;if(!canvas?.items?.length)throw Error('COMPONENT_MOTION_RUNTIME_UNAVAILABLE');
 return attachMotion(win,{app:canvas.h.app,scene:{runtime:canvas.h.runtime,roots:canvas.items.map(i=>i.n)}},selection);
}
function attachMotion(win,preview,selection){
 selection=motionSelection(selection.style,selection.kind==='ui_chain_component_motion'?'components':'panel');
 if(!preview?.app||!preview.scene?.runtime?.handles)throw Error('PANEL_MOTION_RUNTIME_UNAVAILABLE');
 const media=win.matchMedia('(prefers-reduced-motion: reduce)');
 let scene,records=[],dead=false,error=null;
 const animator=new MotionAnimator({now:()=>win.performance.now(),request:fn=>win.requestAnimationFrame(fn),cancel:id=>win.cancelAnimationFrame(id)},e=>{error=String(e.message??e);reset();});
 const active=()=>selection.style!=='original'&&!media.matches&&!win.document.hidden;
 function base(r){const h=r.h,v=h.root;if(v.destroyed)return;v.scale.set(r.sx,r.sy);v.pivot.set(r.px,r.py);if(r.alpha!==null)v.alpha=h.props.enabled===false?scene.runtime.skin.profile.disabledAlpha:r.baseAlpha;r.scale=1;r.offset=0;r.alpha=null;}
 function cancel(r){animator.cancel(r.key+'-scale');animator.cancel(r.key+'-enter');base(r);}
 function apply(r,s,y=0){if(r.h.disposed||r.h.root.destroyed)return;const h=r.h;h.root.scale.set(r.sx*s,r.sy*s);h.root.pivot.set(r.px+h.size.width/2*(1-1/s),r.py+h.size.height/2*(1-1/s)-y/s);r.scale=s;}
 function scale(r,steps,offset=0){if(!active()||!r.h.allowed())return;animator.cancel(r.key+'-enter');if(r.alpha!==null){r.h.root.alpha=r.baseAlpha;r.alpha=null;}animator.animate(r.key+'-scale',{s:r.scale,y:r.offset??0},steps.map(([s,duration,easing],i)=>({to:{s,y:i===0?offset:0},duration,easing})),v=>{r.offset=v.y;apply(r,v.s,v.y);});}
 function enter(){
  reset();if(!active())return;const p=selection.profile;
  // Animate the scene as a unit, avoiding compounded parent/child transforms.
  for(const r of records.filter(r=>(scene.roots??[scene.root]).includes(r.h))){
  if(!r.h.root.visible||r.h.readState().open===false)continue;
  r.internal?.enter();
  if(r.h.recipe.type==='Dialog'&&r.h.adapter.view.motionDriver)continue;
  r.baseAlpha=r.h.root.alpha;r.alpha=0;
  const staticContent=['Text','Image','Container'].includes(r.h.recipe.type);
  const enterScale=staticContent?1:p.enterScale,enterOffset=staticContent?(p.recipe?.staticOffset??p.enterOffsetY):p.enterOffsetY;
  animator.animate(r.key+'-enter',{s:enterScale,a:0,y:enterOffset},[{to:{s:1,a:1,y:0},duration:p.enterMs,easing:p.easing}],v=>{apply(r,v.s,v.y);r.alpha=Math.min(1,Math.max(0,v.a));r.h.root.alpha=r.baseAlpha*r.alpha;},()=>base(r));
  }
 }
 function reset(){for(const r of records){r.internal?.reset();base(r);}animator.cancelAll();}
 function detach(){reset();for(const r of records){r.internal?.dispose();for(const cleanup of r.listeners)cleanup();}records=[];}
 function bind(){
  detach();scene=preview.scene;
  for(const h of scene.runtime.handles.values()){
   const v=h.root,r={h,key:'motion-'+records.length,sx:v.scale.x,sy:v.scale.y,px:v.pivot.x,py:v.pivot.y,baseAlpha:v.alpha,scale:1,alpha:null,state:JSON.stringify(h.readState()),focus:!!h.focusRing?.visible,listeners:[]};records.push(r);
   const on=(event,fn)=>{v.on(event,fn);r.listeners.push(()=>v.off(event,fn));};
   r.internal=bindComponentMotion({h,animator,key:r.key+'-control',profile:()=>selection.profile,active:()=>active()&&h.allowed(true)});
   if(h.recipe.type==='Button'){
    const listen=(name,event,fn)=>{const signal=h.adapter.view[name];if(signal?.connect){const c=signal.connect(fn);r.listeners.push(()=>c.disconnect());}else on(event,fn);};
    listen('onDown','pointerdown',()=>{const p=selection.profile;if(p)scale(r,[[p.pressScale,p.pressMs,'ease-out']],p.recipe?.buttonOffset??0);});
    listen('onHover','pointerover',()=>{const p=selection.profile;if(p)scale(r,[[p.hoverScale,p.hoverMs,p.easing]]);});
    listen('onOut','pointerout',()=>{const p=selection.profile;if(p)scale(r,[[1,p.hoverMs,p.easing]]);});
    const release=()=>{const p=selection.profile;if(p)scale(r,[[p.releasePeak,p.releasePeakMs,p.easing],...(p.releaseSettleMs?[[1,p.releaseSettleMs,'ease-out']]:[])]);};
    listen('onUp','pointerup',release);on('pointercancel',()=>cancel(r));
   }
  }
  enter();
 }
 function tick(){
  if(dead)return;if(preview.scene!==scene){bind();return;}
  for(const r of records){const h=r.h;if(h.disposed){r.internal?.dispose();cancel(r);continue;}r.internal?.sync();if((!(scene.roots??[scene.root]).includes(h)&&!h.allowed())||!h.root.visible||h.readState().open===false||!active()){cancel(r);continue;}
   const state=JSON.stringify(h.readState()),focus=!!h.focusRing?.visible;
   r.state=state;r.focus=focus;
  }
 }
 const stop=()=>reset();media.addEventListener('change',stop);win.document.addEventListener('visibilitychange',stop);
 bind();preview.app.ticker.add(tick);
 return {set(next){const resolved=motionSelection(next.style,next.kind==='ui_chain_component_motion'?'components':'panel');reset();selection=resolved;enter();},replay:enter,
  inspect:()=>({style:selection.style,designVersion:selection.designVersion,reducedMotion:media.matches,error,legacyInternal:records.filter(r=>['Select','Dialog'].includes(r.h.recipe.type)&&typeof r.h.adapter.view.applyReveal!=='function').map(r=>r.h.recipe.type),...animator.snapshot(),targets:records.map(r=>({id:r.h.id,type:r.h.recipe.type,scale:r.scale,...r.internal?.inspect()}))}),
  export:()=>({...selection,targets:records.map(r=>({id:r.h.id,type:r.h.recipe.type})),coverage:[scene.roots?'component-enter':'panel-enter','button-press-release','component-state-transitions'],componentCoverage:componentMotionCoverage}),
  dispose(){if(dead)return;dead=true;preview.app.ticker.remove(tick);detach();animator.destroy();media.removeEventListener('change',stop);win.document.removeEventListener('visibilitychange',stop);}
 };
}
