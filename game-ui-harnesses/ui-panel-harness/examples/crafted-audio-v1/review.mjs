import {createPanelHost} from '../../src/panel-host.mjs';
import {pixiPanelCore,mountPixiPanelInstance} from '../../src/pixi-panel-instance.mjs';
const panels=JSON.parse(document.getElementById('panels').textContent),events=[],errors=[];
const host=createPanelHost({core:pixiPanelCore,mount:mountPixiPanelInstance,onEvent:envelope=>{
  events.push(envelope);document.getElementById('status').textContent=`已触发：${envelope.event.name}`;
},onError:error=>errors.push(error.code)});
window.audioArtReview=Object.freeze({get:id=>host.get(id),events:()=>structuredClone(events),errors:()=>[...errors]});
async function start(){try{
  for(const [id,bundle] of Object.entries(panels))await host.add(id,bundle,{container:document.getElementById(id)});
  document.documentElement.dataset.ready='true';
}catch(error){errors.push(error.code??error.message);document.documentElement.dataset.ready='error';}}
void start();
window.addEventListener('pagehide',()=>host.destroy(),{once:true});
