import {createPanelHost} from '../../src/panel-host.mjs';
import {pixiPanelCore,mountPixiPanelInstance} from '../../src/pixi-panel-instance.mjs';
const seed=JSON.parse(document.getElementById('review-seed').textContent),events=[],errors=[];
const name=new URL(location.href).searchParams.get('panel')??'form',entry=seed[name];
const host=createPanelHost({core:pixiPanelCore,mount:mountPixiPanelInstance,onEvent:event=>{events.push(event);document.getElementById('feedback').textContent=`已触发：${event.event.name}`;},onError:error=>errors.push(error.code)});
async function start(){
 if(!entry)throw Error('REVIEW_CASE');document.getElementById('name').textContent=entry.title;
 for(const id of ['before','after']){const card=document.getElementById(id+'-card');if(!entry[id]){card.hidden=true;continue;}
  const container=document.getElementById(id);container.style.maxWidth=entry[id].spec.canvas.width+'px';await host.add(id,entry[id],{container});}
 document.getElementById('download').href=`delivery/${name}.panel-delivery.zip`;
 document.documentElement.dataset.ready='true';
}
window.focusedReview=Object.freeze({get:id=>host.get(id),source:id=>structuredClone(entry[id]),events:()=>structuredClone(events),errors:()=>structuredClone(errors)});
window.addEventListener('pagehide',()=>host.destroy(),{once:true});
start().catch(error=>{errors.push(error.message);document.documentElement.dataset.ready='error';});
