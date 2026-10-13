import {createPanelHost} from '../../src/panel-host.mjs';
import {pixiPanelCore,mountPixiPanelInstance} from '../../src/pixi-panel-instance.mjs';
const panels=JSON.parse(document.getElementById('panels').textContent),events=[],errors=[];
let selected='slots',mode='dark';
const host=createPanelHost({core:pixiPanelCore,mount:mountPixiPanelInstance,onEvent:event=>{
  events.push(event);
  const section=panels[event.instanceId]?.spec.sections.find(section=>section.rows.some(row=>row.event===event.event.name));
  document.getElementById('status').textContent=section?'已选择'+section.title:'已选择';
},onError:error=>errors.push(error.code)});
function show(){
  const active=selected+'-'+mode;
  for(const card of document.querySelectorAll('[data-panel]'))card.hidden=card.dataset.panel!==active;
  for(const button of document.querySelectorAll('[data-option]'))button.setAttribute('aria-pressed',String(button.dataset.option===selected));
  for(const button of document.querySelectorAll('[data-mode]'))button.setAttribute('aria-pressed',String(button.dataset.mode===mode));
  document.documentElement.dataset.active=active;
  document.getElementById('download').href=active+'.zip';
}
for(const button of document.querySelectorAll('[data-option]'))button.addEventListener('click',()=>{selected=button.dataset.option;show();});
for(const button of document.querySelectorAll('[data-mode]'))button.addEventListener('click',()=>{mode=button.dataset.mode;show();});
window.imageSlotReview=Object.freeze({get:id=>host.get(id),events:()=>structuredClone(events),errors:()=>[...errors],destroy:()=>host.destroy()});
async function start(){try{
  for(const [id,bundle] of Object.entries(panels)){const card=document.querySelector(`[data-panel="${id}"]`);card.hidden=false;await host.add(id,bundle,{container:document.getElementById(id)});card.hidden=true;}
  show();document.documentElement.dataset.ready='true';
}catch(error){errors.push(error.code??error.message);document.documentElement.dataset.ready='error';document.getElementById('status').textContent='预览失败';}}
void start();window.addEventListener('pagehide',()=>host.destroy(),{once:true});
