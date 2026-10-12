import {createPanelHost} from '../../src/panel-host.mjs';
import {pixiPanelCore,mountPixiPanelInstance} from '../../src/pixi-panel-instance.mjs';
const panels=JSON.parse(document.getElementById('panels').textContent),events=[],errors=[];
let kind='roles',mode='light',variant='after';
const host=createPanelHost({core:pixiPanelCore,mount:mountPixiPanelInstance,onEvent:event=>{
  events.push(event);const section=panels[event.instanceId].spec.sections.find(section=>section.rows.some(row=>row.event===event.event.name));
  document.getElementById('status').textContent=kind==='roles'?'已选择'+section.title:'已触发'+event.event.name;
},onError:error=>errors.push(error.code)});
function show(){
  const id=`${kind}-${mode}-${variant}`;
  for(const pane of document.querySelectorAll('[data-panel]'))pane.hidden=pane.dataset.panel!==id;
  for(const [key,value]of Object.entries({kind,mode,variant}))for(const button of document.querySelectorAll(`[data-${key}]`))button.setAttribute('aria-pressed',String(button.dataset[key]===value));
  document.documentElement.dataset.active=id;document.getElementById('download').href=id+'.zip';
  document.getElementById('status').textContent=kind==='roles'?(variant==='after'?'卡片名称、图片提示和按钮共用中心线。':'旧规则：名称及图片提示靠左。'):'设置字段保持左对齐，支持原有试玩交互。';
}
for(const key of ['kind','mode','variant'])for(const button of document.querySelectorAll(`[data-${key}]`))button.addEventListener('click',()=>{
  if(key==='kind')kind=button.dataset.kind;else if(key==='mode')mode=button.dataset.mode;else variant=button.dataset.variant;show();
});
window.cardAlignmentReview=Object.freeze({get:id=>host.get(id),source:id=>structuredClone(panels[id]),events:()=>structuredClone(events),errors:()=>[...errors]});
async function start(){try{
  await document.fonts.ready;
  for(const [id,bundle]of Object.entries(panels)){const pane=document.querySelector(`[data-panel="${id}"]`);pane.hidden=false;await host.add(id,bundle,{container:document.getElementById(id)});pane.hidden=true;}
  show();document.documentElement.dataset.ready='true';
}catch(error){errors.push(error.code??error.message);document.documentElement.dataset.ready='error';}}
void start();window.addEventListener('pagehide',()=>host.destroy(),{once:true});
