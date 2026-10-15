import {attachComponentMotion} from '../panel/motion-runtime.mjs';
import {motionChoices,motionSelection} from '../panel/motion-profile.mjs';
import {motionDemos} from './motion-demos.mjs';
const $=selector=>document.querySelector(selector),entries=[],timers=new Set();let dead=false;
const later=(fn,ms)=>{const timer=setTimeout(()=>{timers.delete(timer);if(!dead)fn();},ms);timers.add(timer);};
const cancel=()=>{for(const timer of timers)clearTimeout(timer);timers.clear();};
function selected(entry){return entry.win.studioCanvas.items.find(i=>i.n.recipe.type===$('#component').value);}
function prepare(){
 cancel();document.documentElement.dataset.demoPhase='ready';
 for(const e of entries){
  e.controller.set(motionSelection('original','components'));
  e.win.document.activeElement?.blur?.();e.win.studioCanvas.h.runtime.focus(null);
  for(const {n}of e.win.studioCanvas.items){if(n.recipe.type==='Select')n.adapter.view.close(true);const state=e.initial.get(n);if(Object.keys(state).length)n.setState(structuredClone(state));}
  e.win.studioCanvas.locate(selected(e));e.controller.set(motionSelection(e.style,'components'));
 }
 $('#demo-description').textContent=motionDemos[$('#component').value].description;
 $('#status').textContent='已就绪 · '+$('#component').selectedOptions[0].textContent+' · 三列使用相同素材和尺寸';
}
function play(){
 prepare();const demo=motionDemos[$('#component').value];
 const trigger=action=>{for(const e of entries)action?.(selected(e).n,e);};
 if(demo.entrance){document.documentElement.dataset.demoPhase='start';$('#status').textContent='正在同步演示 · 入场';later(complete,900);return;}
 // Let entrance settle before demonstrating state transitions, on one parent clock.
 later(()=>{
  trigger(demo.start);document.documentElement.dataset.demoPhase='start';
  $('#status').textContent='正在同步演示 · 可再次点击重播，也可在各列直接试玩';
  later(()=>trigger(demo.release),120);
  later(()=>{trigger(demo.end);document.documentElement.dataset.demoPhase='return';},1100);
  later(complete,1800);
 },600);
}
function complete(){document.documentElement.dataset.demoPhase='complete';$('#status').textContent='演示完成 · 可重播，也可在各列直接试玩';}
try{
 const params=new URLSearchParams(location.hash.slice(1)),artifact=params.get('artifact'),project=params.get('project');
 if(!/^[a-z][a-z0-9-]{0,48}$/.test(artifact??''))throw Error('组件版本无效，请从组件画布进入');
 if(/^[a-zA-Z0-9-]{1,80}$/.test(project??''))$('#back').href='/index.html#canvas/'+project;
 await Promise.all(motionChoices.filter(c=>c.id!=='original').map(choice=>new Promise((resolve,reject)=>{
  const card=document.createElement('article'),title=document.createElement('h2'),desc=document.createElement('p'),frame=document.createElement('iframe');
  title.textContent=choice.name;desc.textContent=choice.description;frame.title=choice.name+'动效预览';
  frame.onload=()=>{const until=performance.now()+30000;const connect=()=>{if(dead)return;try{const win=frame.contentWindow;if(win.studioCanvas?.items?.length){const initial=new Map(win.studioCanvas.items.map(({n})=>[n,structuredClone(n.readState())]));const controller=attachComponentMotion(win,motionSelection(choice.id,'components'));entries.push({win,controller,style:choice.id,initial});resolve();return;}}catch(e){reject(e);return;}if(performance.now()>until)reject(Error(choice.name+'组件载入超时'));else later(connect,100);};connect();};
  frame.src='/component-canvas.html#'+artifact+'&compare=1';
  // Set the document before insertion: avoid an extra about:blank load and
  // duplicate connect callbacks while the real component document initializes.
  card.append(title,desc,frame);$('#columns').append(card);
 })));
 const catalog=entries[0].win.studioCanvas.items.map(i=>i.sample);
 for(const sample of catalog){if(!motionDemos[sample.type]||entries.some(e=>!e.win.studioCanvas.items.some(i=>i.n.recipe.type===sample.type)))throw Error('组件演示未适配：'+sample.type);const option=document.createElement('option');option.value=sample.type;option.textContent=sample.caseId+' '+sample.type+' · '+motionDemos[sample.type].label;$('#component').append(option);}
 $('#component').value='Dialog';$('#component').disabled=false;
 $('#component').onchange=prepare;$('#play').onclick=play;$('#enter').onclick=()=>{prepare();};$('#play').disabled=false;$('#enter').disabled=false;prepare();
 window.motionComparison={play,prepare,inspect:()=>entries.map(e=>({style:e.style,...e.controller.inspect()}))};
}catch(e){$('#status').textContent='对照页未能加载：'+e.message;console.error(e);}
window.addEventListener('pagehide',()=>{dead=true;cancel();for(const e of entries)e.controller.dispose();},{once:true});
