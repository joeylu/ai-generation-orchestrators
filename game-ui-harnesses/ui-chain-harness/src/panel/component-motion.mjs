import {unit,phase,pop} from './motion-design.mjs';
// Per-control presentation bridge. Adapters own logical state, signals,
// hit regions and overlay lifetime; motion-design owns the authored recipes.
export const componentMotionCoverage={
 Button:['press','release','hover'],Switch:['thumb-travel'],CheckBox:['mark-reveal'],RadioGroup:['mark-crossfade'],
 Input:['native-text-editing'],Select:['dropdown-reveal','dropdown-close','chevron','row-press'],Slider:['value-ease','direct-drag','thumb-press'],
 ProgressBar:['fill-ease'],ScrollView:['scroll-ease','direct-drag'],List:['row-feedback','row-stagger'],
 Dialog:['open','close','modal-shield','action-press'],Tabs:['page-reveal','tab-press'],
 Image:['enter'],Text:['enter'],Container:['enter','child-stagger'],Panel:['enter','child-stagger'],
};
export function bindComponentMotion({h,animator,key,profile,active}){
 const a=h.adapter,v=a.view,type=h.recipe.type,channels=new Map(),cleanups=[],restores=[];
 let previous=h.readState(),size=JSON.stringify(h.size),pressed=false,dead=false,settling=false;
 const bounded=()=>profile()?.easing==='spring'?'ease-out':profile()?.easing;
 function finish(name){const c=channels.get(name);animator.cancel(key+'-'+name);channels.delete(name);if(c&&!h.disposed){c.apply(c.to);c.done?.();}}
 function run(name,from,to,ms,apply,done,easing=bounded(),delay=0){
  if(!active()||h.disposed||settling){if(!h.disposed)apply(to);done?.();return;}
  const current=channels.get(name)?.value??from,c={value:current,to,apply,done};channels.set(name,c);
  const steps=[];if(delay)steps.push({to:current,duration:delay,easing:'linear'});
  steps.push({to,duration:Math.max(1,ms),easing});
  animator.animate(key+'-'+name,current,steps,value=>{if(h.disposed)return;c.value=value;apply(value);},()=>{if(channels.get(name)!==c)return;channels.delete(name);done?.();});
 }
 const signal=(obj,name,fn)=>{const c=obj?.[name]?.connect(fn);if(c)cleanups.push(()=>c.disconnect());};
 const on=(obj,event,fn)=>{obj.on(event,fn);cleanups.push(()=>obj.off(event,fn));};
 // Track direct manipulation: dragging stays 1:1 with the pointer, never chases it.
 on(h.root,'pointerdown',()=>{pressed=true;});on(h.root,'pointerup',()=>{pressed=false;});on(h.root,'pointerupoutside',()=>{pressed=false;});on(h.root,'pointercancel',()=>{pressed=false;});
 function button(b,index){
  if(!b)return;const node=b.view??b,sx=node.scale.x,sy=node.scale.y,px=node.pivot.x,py=node.pivot.y;
  const apply=({s,y=0})=>{if(node.destroyed)return;const width=b.defaultView?.width??node.hitArea?.width??h.size.width,height=b.defaultView?.height??node.hitArea?.height??h.size.height;node.scale.set(sx*s,sy*s);node.pivot.set(px+width/2*(1-1/s),py+height/2*(1-1/s)-y/s);};
  restores.push(()=>apply({s:1}));const name='button'+index;
  const move=(s,ms,easing,y=0)=>run(name,{s:1,y:0},{s,y},ms,apply,undefined,easing);
  signal(b,'onHover',()=>{if(h.allowed())move(profile()?.hoverScale??1,profile()?.hoverMs??1,bounded());});
  signal(b,'onOut',()=>move(1,profile()?.hoverMs??1,bounded()));
  signal(b,'onDown',()=>{if(h.allowed())move(profile()?.pressScale??1,profile()?.pressMs??1,'ease-out',profile()?.recipe?.buttonOffset??0);});
  signal(b,'onUp',()=>{const p=profile();if(!p)return;run(name,{s:1,y:0},{s:p.releasePeak,y:0},p.releasePeakMs,apply,()=>{if(p.releaseSettleMs)run(name,{s:p.releasePeak,y:0},{s:1,y:0},p.releaseSettleMs,apply,undefined,'ease-out');},'ease-out');});
 }
 if(type==='Select')v.rows?.forEach(button);
 if(type==='Dialog')a.buttons?.forEach(button);
 if(type==='Tabs'||type==='List')a.rows?.forEach(button);
 const rowAlphas=type==='List'?a.rows.map(b=>(b.view??b).alpha):[];
 const rowPivots=type==='List'?a.rows.map(b=>({x:(b.view??b).pivot.x,y:(b.view??b).pivot.y})):[];
 if(type==='List')restores.push(()=>a.rows.forEach((b,i)=>{const node=b.view??b;if(!node.destroyed){node.alpha=rowAlphas[i];node.pivot.set(rowPivots[i].x,rowPivots[i].y);}}));
 if(type==='Slider'){
  const old=v.onThumbPressed,thumb=v.slider1?.children[0],alpha=thumb?.alpha??1;
  const handler=down=>{old?.(down);pressed=down;if(thumb)run('thumb',{a:thumb.alpha},{a:down?alpha*(profile()?.recipe?.thumbAlpha??.72):alpha},profile()?.pressMs??1,({a})=>{if(!thumb.destroyed)thumb.alpha=a;});};
  v.onThumbPressed=handler;cleanups.push(()=>{if(v.onThumbPressed===handler)v.onThumbPressed=old;});restores.push(()=>{if(thumb&&!thumb.destroyed)thumb.alpha=alpha;});
 }
 let driver;
 const selectRows=type==='Select'?(v.rows??[]).map(row=>({node:row,alpha:row.alpha,py:row.pivot.y})):[];
 const contentAlpha=type==='Dialog'?v.contentView?.alpha??1:1;
 function reveal(value,p){
  v.applyReveal(value,p);const t=unit(value),recipe=p?.recipe,kind=recipe?.kind;
  if(type==='Select'){
   // Only presentation is shifted: mask, bounds and the visible field stay fixed.
   selectRows.forEach(({node,alpha,py},i)=>{const delay=kind==='slide'?0:Math.min(i*.09,.27),local=phase(t,delay,1),travel=kind==='pop'?1-pop(local):1-local;node.alpha=alpha*(kind==='slide'?1:local);node.pivot.y=py+(recipe?.rowOffset??0)*travel;});
   if(kind==='pop')v.indicator.rotation=Math.PI*pop(t);
  }else if(type==='Dialog'&&kind){
   const s=kind==='pop'?p.enterScale+(1-p.enterScale)*value:1;
   v.innerView.scale.set(s);v.innerView.position.set(-v.options.width*s/2+(kind==='slide'?recipe.dialogOffset*(1-t):0),-v.options.height*s/2);
   v.innerView.alpha=kind==='layered'?phase(t,0,.65):t;
   v.contentView.alpha=contentAlpha*(kind==='layered'?phase(t,.24,1):1);
   v.onVisualProgress?.(kind==='layered'?phase(t,0,.45):t);
  }
 }
 restores.push(()=>{selectRows.forEach(({node,alpha,py})=>{if(!node.destroyed){node.alpha=alpha;node.pivot.y=py;}});if(type==='Dialog'&&v.contentView&&!v.contentView.destroyed)v.contentView.alpha=contentAlpha;});
 if(['Select','Dialog'].includes(type)&&typeof v.applyReveal==='function'){
  const isOpen=()=>type==='Select'?v.expanded:v.isOpen;
  driver={play(open,done){
    if(!active())return false;
    const p=profile();run('reveal',{t:v.motionProgress??(open?0:1)},{t:open?1:0},open?p.enterMs:p.exitMs,
      ({t})=>reveal(t,p),done,open&&type==='Dialog'?p.easing:bounded());return true;
   },finish(){finish('reveal');if(!v.destroyed){v.applyReveal(isOpen()?1:0);if(!isOpen())v.finishClose();}}
  };
  v.motionDriver=driver;cleanups.push(()=>{if(v.motionDriver===driver)v.motionDriver=null;});
 }
 function marks(box,target,index){
  if(!box?.views?.[1]?.children?.[1])return;
  const off=box.views[0],onView=box.views[1],mark=onView.children[1];
  // Mark sprites are sized at creation: pivot must use their unscaled local size.
  const restore=()=>{if(mark.destroyed)return;mark.alpha=1;mark.scale.set(markBase[index].sx,markBase[index].sy);mark.pivot.set(markBase[index].px,markBase[index].py);onView.visible=box.checked;off.visible=!box.checked;};
  run('mark'+index,{t:target?0:1},{t:target?1:0},profile().changeMs,({t})=>{
    if(mark.destroyed)return;onView.visible=true;off.visible=false;mark.alpha=Math.max(0,Math.min(1,t));const b=markBase[index],s=1-(1-profile().enterScale)*4*(1-t);mark.scale.set(b.sx*s,b.sy*s);mark.pivot.set(b.px+mark.texture.orig.width/2*(1-1/s),b.py+mark.texture.orig.height/2*(1-1/s)-(profile().recipe?.markOffset??0)*(1-unit(t))/b.sy);
  },restore,target?profile().easing:bounded());
 }
 const checkItems=type==='CheckBox'?[v]:type==='RadioGroup'?(a.items??[]):[];
 const markBase=checkItems.map(box=>{const m=box.views[1].children[1];const b={sx:m.scale.x,sy:m.scale.y,px:m.pivot.x,py:m.pivot.y};restores.push(()=>{if(m.destroyed)return;m.alpha=1;m.scale.set(b.sx,b.sy);m.pivot.set(b.px,b.py);box.views[1].visible=box.checked;box.views[0].visible=!box.checked;});return b;});
 let presented=previous.value,scroll=previous.initialOffsetY;
 const presentValue=value=>{presented=value;if(type==='Slider')v.presentValue?.(value);else a.bar.progress=100*(value-h.props.min)/(h.props.max-h.props.min);};
 const presentScroll=value=>{scroll=value;a.box.list.pivot.y=value-h.readState().initialOffsetY;const travel=Math.max(0,a.box.height-a.bar.slider1.height);a.bar.slider1.y=travel*value/a.bar.max;};
 if(type==='Slider'||type==='ProgressBar')restores.push(()=>presentValue(h.readState().value));
 if(type==='ScrollView')restores.push(()=>{a.box.list.pivot.y=0;a.bar.updateSlider();scroll=h.readState().initialOffsetY;});
 // The switch geometry is owned by its fixed mark token, independent of label width.
 const switchTravel=type==='Switch'?v.views[1].children[1].x-2:0;
 const restoreSwitch=()=>v.views.forEach((item,i)=>item.children[1].x=2+i*switchTravel);
 if(type==='Switch')restores.push(restoreSwitch);
 const contentBase=type==='Tabs'?{alpha:a.switcher.alpha,px:a.switcher.pivot.x,py:a.switcher.pivot.y}:null;
 const tabViews=type==='Tabs'?(a.switcher.views??[]).map(node=>({node,alpha:node.alpha,mode:node.eventMode})):[];
 const settlePages=()=>tabViews.forEach(({node,alpha,mode},i)=>{if(!node.destroyed){node.alpha=alpha;node.eventMode=mode;node.visible=i===a.switcher.active;}});
 if(tabViews.length)restores.push(settlePages);
 if(contentBase)restores.push(()=>{a.switcher.alpha=contentBase.alpha;a.switcher.pivot.set(contentBase.px,contentBase.py);});
 function change(next){const p=profile();if(!p)return;
  if(type==='Switch'&&next.checked!==previous.checked)run('switch',{t:previous.checked?1:0},{t:next.checked?1:0},p.changeMs,({t})=>v.views.forEach(item=>item.children[1].x=2+switchTravel*Math.max(0,Math.min(1,t))),restoreSwitch,p.recipe?.valueEasing);
  if(type==='CheckBox'&&next.checked!==previous.checked)marks(v,next.checked,0);
  if(type==='RadioGroup'&&next.selectedId!==previous.selectedId)checkItems.forEach((box,i)=>{if([next.selectedId,previous.selectedId].includes(h.props.options[i].id))marks(box,box.checked,i);});
  if(['Slider','ProgressBar'].includes(type)&&next.value!==previous.value){if(pressed||v.dragging){finish('value');presentValue(next.value);}else run('value',{value:presented},{value:next.value},p.changeMs,({value})=>presentValue(value),undefined,p.recipe?.valueEasing);}
  if(type==='ScrollView'&&next.initialOffsetY!==previous.initialOffsetY){if(pressed||a.bar.dragging){finish('scroll');presentScroll(next.initialOffsetY);}else run('scroll',{value:scroll},{value:next.initialOffsetY},p.scrollMs,({value})=>presentScroll(value),undefined,p.recipe?.valueEasing);}
  if(type==='Tabs'&&next.activeId!==previous.activeId){
   finish('page');const nextIndex=h.props.tabs.findIndex(tab=>tab.id===next.activeId),oldIndex=h.props.tabs.findIndex(tab=>tab.id===previous.activeId),direction=Math.sign(nextIndex-oldIndex)||1,old=tabViews[oldIndex],current=tabViews[nextIndex],kind=p.recipe?.kind;
   run('page',{t:0},{t:1},p.changeMs,({t})=>{
    // The outgoing page is visual-only: pointer and keyboard routing remain
    // disabled until it is hidden again. Selection is already committed.
    if(kind==='layered'&&old&&current){old.node.visible=true;old.node.eventMode='none';old.node.alpha=old.alpha*(1-unit(t));current.node.alpha=current.alpha*unit(t);a.switcher.alpha=contentBase.alpha;}
    else a.switcher.alpha=contentBase.alpha*unit(t);
    a.switcher.pivot.x=contentBase.px-(kind==='slide'?direction*p.recipe.tabOffset*(1-t):0);a.switcher.pivot.y=contentBase.py-(kind==='pop'?p.recipe.tabOffset*(1-t):0);
   },settlePages,kind==='pop'?'spring':bounded());
  }
  if(type==='List'&&next.selectedId!==previous.selectedId){const i=h.props.items.findIndex(item=>item.id===next.selectedId),b=a.rows[i]?.view??a.rows[i];if(b){finish('stagger'+i);run('row'+i,{t:0},{t:1},p.changeMs,({t})=>{if(b.destroyed)return;const kind=p.recipe?.kind;b.alpha=rowAlphas[i]*(.55+.45*unit(t));b.pivot.x=rowPivots[i].x-(kind==='slide'?p.recipe.rowOffset*(1-t):0);b.pivot.y=rowPivots[i].y-(kind==='pop'?p.recipe.rowOffset*(1-t):0);},undefined,p.easing);}}
 }
 function stagger(nodes){const p=profile();nodes.slice(0,24).forEach((node,i)=>{const alpha=node.alpha,py=node.pivot.y,px=node.pivot.x;run('stagger'+i,{t:0},{t:1},p.enterMs,({t})=>{if(node.destroyed)return;const kind=p.recipe?.kind;node.alpha=alpha*unit(t);node.pivot.y=py-(kind==='pop'?p.recipe.rowOffset*(1-t):0);node.pivot.x=px-(kind==='slide'?p.recipe.rowOffset*(1-t):0);},undefined,p.recipe?.kind==='pop'?'spring':bounded(),Math.min(i*p.staggerMs,350));});}
 function reset(){settling=true;try{for(const name of [...channels.keys()])finish(name);driver?.finish();if(!h.disposed){for(const restore of restores)restore();previous=h.readState();size=JSON.stringify(h.size);}pressed=false;}finally{settling=false;}}
 return {
  enter(){if(!active())return;const p=profile();if(type==='Dialog'&&v.isOpen&&driver){v.applyReveal(0,p);driver.play(true);}if(type==='List')stagger(a.rows.map(b=>b.view??b));if(['Panel','Container'].includes(type))stagger(a.motionChildren?.map(c=>c.root)??a.layoutChildren?.map(c=>c.root)??[]);},
  sync(){if(dead||h.disposed)return;if(!active()||!h.allowed(true)||JSON.stringify(h.size)!==size){reset();return;}const next=h.readState();change(next);previous=next;
  },reset,
  inspect:()=>({channels:[...channels.keys()],reveal:v.motionProgress??null,presentedValue:presented??null}),
  dispose(){if(dead)return;reset();for(const cleanup of cleanups)cleanup();dead=true;},
 };
}
