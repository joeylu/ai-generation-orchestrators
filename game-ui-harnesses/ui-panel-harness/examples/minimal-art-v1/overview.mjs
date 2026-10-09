import { createPanelHost } from '../../src/panel-host.mjs';
import { pixiPanelCore, mountPixiPanelInstance } from '../../src/pixi-panel-instance.mjs';
const seed=JSON.parse(document.getElementById('panels').textContent),errors=[];
const host=createPanelHost({core:pixiPanelCore,mount:mountPixiPanelInstance,
  onEvent:({event})=>{document.getElementById('status').textContent=`已触发 ${event.name}`;},onError:error=>errors.push(error.code)});
window.minimalArtReview=Object.freeze({get:id=>host.get(id),errors:()=>[...errors]});
async function start(){try {
  for(const [id,bundle] of Object.entries(seed))await host.add(id,bundle,{container:document.getElementById(id)});
  document.documentElement.dataset.ready='true';
} catch {document.documentElement.dataset.ready='error';}}
void start();
window.addEventListener('pagehide',()=>{void host.destroy().catch(()=>{});},{once:true});
