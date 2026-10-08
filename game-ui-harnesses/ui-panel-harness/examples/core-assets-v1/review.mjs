import {createPanelHost} from '../../src/panel-host.mjs';
import {pixiPanelCore,mountPixiPanelInstance} from '../../src/pixi-panel-instance.mjs';
const seed=JSON.parse(document.getElementById('review-seed').textContent),events=[],errors=[];
const name=new URL(location.href).searchParams.get('panel')??'settings-light',entry=seed[name];
const host=createPanelHost({core:pixiPanelCore,mount:mountPixiPanelInstance,onEvent:e=>{
  events.push(e);document.getElementById('feedback').textContent=`已触发 ${e.event.name}`;
},onError:e=>errors.push(e.code)});
window.assetReview=Object.freeze({get:id=>host.get(id),source:id=>structuredClone(entry[id]),events:()=>structuredClone(events),errors:()=>structuredClone(errors)});
async function start(){
  document.getElementById('name').textContent=entry.title;
  document.getElementById('assets').textContent=entry.assetNames.join(' · ');
  for(const id of ['before','after'])await host.add(id,entry[id],{container:document.getElementById(id)});
  document.getElementById('download').href=`delivery/${name}.panel-delivery.zip`;
  document.documentElement.dataset.ready='true';
}
window.addEventListener('pagehide',()=>host.destroy(),{once:true});
start().catch(()=>{errors.push('CORE_ASSET_REVIEW_MOUNT');document.documentElement.dataset.ready='error';});
