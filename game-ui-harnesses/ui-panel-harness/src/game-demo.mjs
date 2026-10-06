/** Reference game application attached through explicit mappings, independent of Studio. */
import {createPanelHost} from './panel-host.mjs';
import {attachPanelGameBinding} from './game-binding.mjs';
import {pixiPanelCore,mountPixiPanelInstance} from './pixi-panel-instance.mjs';
import {createBrowserAudioGamePort,createCharacterGamePort,createLocalLoadingGamePort} from './browser-game-ports.mjs';
const seed=JSON.parse(document.getElementById('game-seed').textContent),cards=new Map(),bridges=new Map(),ports=new Map(),history=[],errors=[],detaches=[];
let busy=false,destroyed=false;
const host=createPanelHost({core:pixiPanelCore,mount:mountPixiPanelInstance,onEvent:event=>{history.push(event);if(history.length>100)history.shift();render();},onError:problem=>{errors.push(problem);render();}});
const audio=createBrowserAudioGamePort({volume:70,musicVolume:30,effectsVolume:40,muted:false});
const friendly={ROLE_NAME_EXISTS:'角色名已存在，请更换后再次确认。',ROLE_FIELDS_INVALID:'请检查角色名和宣言。',LOAD_RESOURCE_INTEGRITY:'本地资源校验失败，未完成加载。'};
const readPort=id=>ports.get(id).getSnapshot();
function render(){
 if(destroyed)return;
 for(const source of seed.instances){const card=cards.get(source.id);if(!card)continue;const panel=host.get(source.id);card.status.textContent=panel?.status??'DESTROYED';card.container.hidden=panel?.status!=='OPEN';card.placeholder.hidden=panel?.status==='OPEN';card.placeholder.textContent=panel?'面板已关闭，游戏数据仍保留。':'面板已销毁，可重新挂载。';card.toggle.textContent=panel?.status==='OPEN'?'关闭':'打开';card.destroy.textContent=panel?'销毁':'重新挂载';const state=readPort(source.id);card.output.textContent=JSON.stringify(state,null,2);card.message.textContent=state.error?friendly[state.error]??state.error:source.kind==='role'?state.status==='SAVED'?`已保存：${state.savedName}，累计提交 ${state.commits} 次。`:state.status==='SUBMITTING'?'正在提交…':'输入保留在游戏草稿中，确认后才创建角色。':source.kind==='loading'?state.status==='COMPLETE'?`已校验并解码 ${state.loadedResources} 张本地纹理。`:state.status==='CANCELLED'?'加载已取消，进度保留。':state.status==='LOADING'?'正在校验并解码本地纹理…':'点击开始加载，或用面板里的重新开始/取消。':'已绑定主音量、音乐、音效和静音；其他控件沿用面板行为。';}
 const a=audio.inspect();document.getElementById('audio-state').textContent=a.contextState==='running'?'音频接口已启用':'音频接口未启用';document.getElementById('summary').textContent=JSON.stringify({audio:a,bindings:[...bridges].map(([id,b])=>({id,...b.inspect()}))},null,2);
 document.getElementById('event').textContent=history.length?JSON.stringify(history.at(-1),null,2):'尚未收到玩家事件';document.getElementById('status').textContent=errors.length?'发生接入异常':busy?'正在处理…':'游戏接口已就绪';document.getElementById('status').dataset.state=errors.length?'error':busy?'busy':'ready';
 for(const button of document.querySelectorAll('button'))button.disabled=busy;
}
async function action(operation){if(busy||destroyed)return;busy=true;render();try{await operation();}catch(cause){errors.push({code:cause.code??cause.message});}finally{busy=false;render();}}
async function add(source){const container=cards.get(source.id).container;container.hidden=false;await host.add(source.id,source.bundle,{container});const bridge=attachPanelGameBinding({host,instanceId:source.id,bundle:source.bundle,binding:source.binding,port:ports.get(source.id),onChange:render,onError:problem=>{if(problem.code==='ROLE_NAME_EXISTS')return;errors.push(problem);render();}});bridges.set(source.id,bridge);}
function remove(id){bridges.get(id)?.destroy();bridges.delete(id);host.get(id)?.destroy();}
for(const source of seed.instances){
 const port=source.kind==='settings'?audio.port:source.kind==='role'?createCharacterGamePort({delayMs:350}):createLocalLoadingGamePort(seed.resources,{stepMs:700});ports.set(source.id,port);detaches.push(port.subscribe(render));
 const card=document.createElement('article'),header=document.createElement('header'),title=document.createElement('h2'),status=document.createElement('span'),toggle=document.createElement('button'),destroy=document.createElement('button'),container=document.createElement('div'),placeholder=document.createElement('p'),message=document.createElement('p'),details=document.createElement('details'),summary=document.createElement('summary'),output=document.createElement('pre');
 card.className='game-card';card.dataset.instance=source.id;title.textContent=source.title;status.className='tag';toggle.dataset.action='toggle';destroy.dataset.action='destroy';container.className='panel-container';container.dataset.panelContainer=source.id;placeholder.className='placeholder';message.className='message';message.dataset.message=source.id;summary.textContent='游戏数据';details.append(summary,output);header.append(title,status,toggle,destroy);
 if(source.kind==='loading'){const start=document.createElement('button');start.textContent='开始加载';start.dataset.action='start';start.addEventListener('click',()=>{const bridge=bridges.get(source.id);if(bridge)void bridge.run('row4');});header.append(start);}
 card.append(header,container,placeholder,message,details);document.getElementById('panels').append(card);cards.set(source.id,{status,toggle,destroy,container,placeholder,message,output});
 toggle.addEventListener('click',()=>action(async()=>{const panel=host.get(source.id);if(!panel)await add(source);else if(panel.status==='OPEN')panel.close();else{container.hidden=false;await panel.open();}}));destroy.addEventListener('click',()=>action(async()=>{if(host.get(source.id))remove(source.id);else await add(source);}));
}
document.getElementById('audio-open').addEventListener('click',()=>action(()=>audio.open()));
document.getElementById('external-audio').addEventListener('click',()=>action(()=>audio.port.update({volume:40,muted:false})));
document.getElementById('destroy-all').addEventListener('click',()=>action(()=>{for(const source of seed.instances)remove(source.id);}));
document.getElementById('open-all').addEventListener('click',()=>action(async()=>{for(const source of seed.instances){const panel=host.get(source.id);if(panel){cards.get(source.id).container.hidden=false;await panel.open();}else await add(source);}}));
window.panelGameDemo=Object.freeze({inspect(){return{busy,destroyed,host:host.inspect(),audio:audio.inspect(),ports:Object.fromEntries([...ports].map(([id,port])=>[id,{state:port.inspect().alive?port.getSnapshot():null,...port.inspect()}])),bindings:Object.fromEntries([...bridges].map(([id,bridge])=>[id,bridge.inspect()])),events:structuredClone(history),errors:structuredClone(errors)};},get:id=>host.get(id),bundle:id=>structuredClone(seed.instances.find(source=>source.id===id)?.bundle),async destroy(){if(destroyed)return;for(const source of seed.instances)remove(source.id);destroyed=true;for(const detach of detaches)detach();host.destroy();for(const [id,port]of ports)if(id!=='settings')port.destroy();await audio.destroy();}});
window.addEventListener('pagehide',()=>{void window.panelGameDemo.destroy();},{once:true});
action(async()=>{for(const source of seed.instances)await add(source);});
