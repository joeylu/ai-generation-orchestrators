/** Local simulated game host. No model, backend, storage or game-project writes. */
import {createPanelHost} from './panel-host.mjs';
import {pixiPanelCore,mountPixiPanelInstance} from './pixi-panel-instance.mjs';
const seed=JSON.parse(document.getElementById('host-seed').textContent),root=document.getElementById('panels'),status=document.getElementById('status'),gameOutput=document.getElementById('game-state'),eventOutput=document.getElementById('events');
let host,busy=false,destroyed=false;const events=[],errors=[],cards=new Map();
const game={volume:null,muted:null,lastSubmission:null,progress:{}};
const rows=bundle=>bundle.spec.sections.flatMap(section=>section.rows);
function render(){
 for(const source of seed.instances){const card=cards.get(source.id),instance=host?.inspect().alive?host.get(source.id):undefined;card.status.textContent=instance?.status??'DESTROYED';card.container.hidden=!instance||instance.status!=='OPEN';card.placeholder.hidden=instance?.status==='OPEN';card.placeholder.textContent=instance?.status==='CLOSED'?'面板已关闭，当前值保留。':'面板已销毁。';card.open.textContent=instance?.status==='OPEN'?'关闭':'打开';card.remount.textContent=instance?'销毁':'重新挂载';}
 gameOutput.textContent=JSON.stringify(game,null,2);eventOutput.textContent=events.length?JSON.stringify(events.at(-1),null,2):'尚未收到玩家事件';
 for(const button of document.querySelectorAll('button'))button.disabled=busy;
 status.textContent=errors.length?'接入失败，请查看验收结果':busy?'正在处理…':'宿主已就绪';status.dataset.state=errors.length?'error':busy?'busy':'ready';
}
function gameFromValues(){for(const source of seed.instances){const instance=host?.inspect().alive?host.get(source.id):undefined;if(!instance||!['OPEN','CLOSED'].includes(instance.status))continue;const values=instance.getState(),master=rows(source.bundle).find(row=>row.label==='主音量'),muted=rows(source.bundle).find(row=>row.label==='静音');if(master){game.volume=values[master.bind];game.muted=values[muted.bind];}const bar=rows(source.bundle).find(row=>row.kind==='progress');if(bar)game.progress[source.id]=values[bar.bind];}}
function makeHost(){return createPanelHost({core:pixiPanelCore,mount:mountPixiPanelInstance,onEvent:envelope=>{events.push(envelope);if(events.length>100)events.shift();if(envelope.event.action==='submit')game.lastSubmission={instanceId:envelope.instanceId,values:envelope.event.values};gameFromValues();render();},onError:error=>{errors.push(error);render();}});}
async function add(source){const card=cards.get(source.id);card.container.hidden=false;return host.add(source.id,source.bundle,{container:card.container});}
async function action(operation){if(busy||destroyed)return;busy=true;render();try{await operation();gameFromValues();}catch(error){errors.push({code:error.message});}finally{busy=false;render();}}
for(const source of seed.instances){
 const card=document.createElement('article');card.dataset.instance=source.id;card.className='panel-card';const header=document.createElement('header'),title=document.createElement('h2'),tag=document.createElement('span'),open=document.createElement('button'),remount=document.createElement('button'),container=document.createElement('div'),placeholder=document.createElement('p');
 title.textContent=source.title;tag.className='instance-status';container.className='panel-container';container.dataset.panelContainer=source.id;placeholder.className='placeholder';open.dataset.action='toggle';remount.dataset.action='destroy';header.append(title,tag,open,remount);card.append(header,container,placeholder);root.append(card);cards.set(source.id,{container,placeholder,status:tag,open,remount});
 open.addEventListener('click',()=>action(async()=>{const instance=host.get(source.id);if(!instance)await add(source);else if(instance.status==='OPEN')instance.close();else{container.hidden=false;await instance.open();}}));
 remount.addEventListener('click',()=>action(async()=>{const instance=host.get(source.id);if(instance)instance.destroy();else await add(source);}));
}
document.getElementById('close-all').addEventListener('click',()=>action(()=>{for(const source of seed.instances)host.get(source.id)?.close();}));
document.getElementById('open-all').addEventListener('click',()=>action(async()=>{if(!host.inspect().alive)host=makeHost();for(const source of seed.instances){const instance=host.get(source.id);if(instance){cards.get(source.id).container.hidden=false;await instance.open();}else await add(source);}}));
document.getElementById('destroy-all').addEventListener('click',()=>action(()=>host.destroy()));
document.getElementById('advance-loading').addEventListener('click',()=>action(()=>{let index=0;for(const source of seed.instances){const bar=rows(source.bundle).find(row=>row.kind==='progress'),instance=host.get(source.id);if(!bar||!instance)continue;const field=source.bundle.spec.state.find(field=>field.id===bar.bind),step=++index===1?20:10;instance.setProgress(bar.bind,Math.min(field.max,instance.getState()[bar.bind]+step));}}));
window.panelHostDemo=Object.freeze({inspect:()=>({host:host?.inspect(),game:structuredClone(game),events:structuredClone(events),errors:structuredClone(errors),busy}),get:id=>host.get(id),bundle:id=>structuredClone(seed.instances.find(source=>source.id===id)?.bundle),destroy(){if(destroyed)return;destroyed=true;host?.destroy();}});
window.addEventListener('pagehide',()=>window.panelHostDemo.destroy(),{once:true});
host=makeHost();action(async()=>{for(const source of seed.instances)await add(source);});
