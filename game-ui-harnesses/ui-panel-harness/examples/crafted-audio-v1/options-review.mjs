import {createPanelHost} from '../../src/panel-host.mjs';
import {pixiPanelCore,mountPixiPanelInstance} from '../../src/pixi-panel-instance.mjs';
import {AUDIO_ART_OPTIONS} from './options.mjs';

const panels=JSON.parse(document.getElementById('panels').textContent),events=[],errors=[];
let selected='a',mode='dark';
const messages={'audio.volumeChanged':'已调整主音量','audio.musicChanged':'已调整音乐音量','audio.muteChanged':'已切换静音','settings.resetRequested':'已恢复默认设置','settings.close':'已触发关闭','settings.save':'已触发保存设置'};
const host=createPanelHost({core:pixiPanelCore,mount:mountPixiPanelInstance,onEvent:envelope=>{
  events.push(envelope);document.getElementById('status').textContent=messages[envelope.event.name]??'已触发操作';
},onError:error=>errors.push(error.code)});
function show() {
  for(const card of document.querySelectorAll('[data-panel]'))card.hidden=card.dataset.panel!==`${selected}-${mode}`;
  for(const button of document.querySelectorAll('[data-option]'))button.setAttribute('aria-pressed',String(button.dataset.option===selected));
  for(const button of document.querySelectorAll('[data-mode]'))button.setAttribute('aria-pressed',String(button.dataset.mode===mode));
  document.getElementById('description').textContent=AUDIO_ART_OPTIONS.find(option=>option.id===selected).description;
  document.documentElement.dataset.active=`${selected}-${mode}`;
}
for(const button of document.querySelectorAll('[data-option]'))button.addEventListener('click',()=>{selected=button.dataset.option;show();});
for(const button of document.querySelectorAll('[data-mode]'))button.addEventListener('click',()=>{mode=button.dataset.mode;show();});
window.audioArtReview=Object.freeze({get:id=>host.get(id),events:()=>structuredClone(events),errors:()=>[...errors]});
async function start(){try{
  for(const [id,bundle] of Object.entries(panels)){
    const card=document.querySelector(`[data-panel="${id}"]`);card.hidden=false;
    await host.add(id,bundle,{container:document.getElementById(id)});card.hidden=true;
  }
  show();document.documentElement.dataset.ready='true';
}catch(error){errors.push(error.code??error.message);document.documentElement.dataset.ready='error';}}
void start();
window.addEventListener('pagehide',()=>host.destroy(),{once:true});
