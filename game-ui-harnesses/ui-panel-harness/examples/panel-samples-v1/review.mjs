import {createPanelHost} from '../../src/panel-host.mjs';
import {pixiPanelCore,mountPixiPanelInstance} from '../../src/pixi-panel-instance.mjs';
const panels=JSON.parse(document.getElementById('panels').textContent),events=[],errors=[];
const query=new URLSearchParams(location.search),ids=['audio','form','roles','progress','tabs'];
let selected=ids.includes(query.get('panel'))?query.get('panel'):'audio',mode=query.get('mode')==='light'?'light':'dark';
const status=document.getElementById('status');
const host=createPanelHost({core:pixiPanelCore,mount:mountPixiPanelInstance,onEvent:envelope=>{
  events.push(envelope);const bundle=panels[envelope.instanceId],event=envelope.event;
  if(event.action==='submit')status.textContent='已提交角色名：'+Object.values(event.values).join('、');
  else if(event.action==='reset-initial')status.textContent='已恢复初始设置';
  else if(event.action==='emit'){
    const section=bundle.spec.sections.find(section=>section.rows.some(row=>row.id===event.rowId));
    const row=section?.rows.find(row=>row.id===event.rowId);
    status.textContent=selected==='roles'?'已选择'+section.title:'已触发“'+row.buttonLabel+'”操作';
  }else status.textContent='当前试玩值已更新';
},onError:error=>errors.push(error.code)});
function show(){
  const active=selected+'-'+mode;
  for(const card of document.querySelectorAll('[data-panel]'))card.hidden=card.dataset.panel!==active;
  for(const button of document.querySelectorAll('[data-option]'))button.setAttribute('aria-pressed',String(button.dataset.option===selected));
  for(const button of document.querySelectorAll('[data-mode]'))button.setAttribute('aria-pressed',String(button.dataset.mode===mode));
  document.documentElement.dataset.active=active;document.documentElement.dataset.mode=mode;
  document.getElementById('download').href=active+'.zip';
  document.getElementById('advance').hidden=!panels[active].spec.state.some(field=>field.type==='progress');
  status.textContent=selected==='tabs'?'内容可滚动；切换页签会保留当前试玩值。':'可直接试玩；切换样本会保留当前试玩值。';
  history.replaceState(null,'','?panel='+selected+'&mode='+mode);
}
for(const button of document.querySelectorAll('[data-option]'))button.addEventListener('click',()=>{selected=button.dataset.option;show();});
for(const button of document.querySelectorAll('[data-mode]'))button.addEventListener('click',()=>{mode=button.dataset.mode;show();});
document.getElementById('reset').addEventListener('click',()=>{const id=selected+'-'+mode;host.get(id).setState(panels[id].state);status.textContent='已恢复当前样本初始状态';});
document.getElementById('advance').addEventListener('click',()=>{
  const id=selected+'-'+mode,field=panels[id].spec.state.find(field=>field.type==='progress'),instance=host.get(id),current=instance.getState()[field.id];
  const value=current===0?57:current===57?100:0;instance.setProgress(field.id,value);status.textContent='演示进度：'+value+'%';
});
window.panelSamples=Object.freeze({get:id=>host.get(id),events:()=>structuredClone(events),errors:()=>[...errors],destroy:()=>host.destroy()});
async function start(){try{
  for(const [id,bundle]of Object.entries(panels)){const card=document.querySelector(`[data-panel="${id}"]`);card.hidden=false;await host.add(id,bundle,{container:document.getElementById(id)});card.hidden=true;}
  show();document.documentElement.dataset.ready='true';
}catch(error){errors.push(error.code??error.message);document.documentElement.dataset.ready='error';status.textContent='预览失败';}}
void start();window.addEventListener('pagehide',()=>host.destroy(),{once:true});
