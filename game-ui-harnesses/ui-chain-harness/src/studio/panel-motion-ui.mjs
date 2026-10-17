import {attachPanelMotion,attachComponentMotion} from '../panel/motion-runtime.mjs';
import {motionChoices,motionSelection} from '../panel/motion-profile.mjs';

export const mountPanelMotion=options=>mountMotionEditor({...options,scope:'panel'});
export const mountComponentMotion=options=>mountMotionEditor({...options,scope:'components'});
function mountMotionEditor({host,frame,post,notice,scope}){
 const components=scope==='components',prefix=components?'component-motion':'panel-motion',name=components?'组件':'面板';
 let controller=null,epoch=0,current=null;
 function dispose(){epoch++;controller?.dispose();controller=null;current=null;host.replaceChildren();}
 function open(owner,job,artifactId){
  dispose();if(components&&owner?.skin)job={id:owner.id,status:'ready',motion:owner.skin.motion};if(!owner||!job||job.status!=='ready')return;
  current={owner,job,artifactId};const ticket=epoch;
  const label=document.createElement('label');label.textContent=components?'全部组件动效':'面板动效';
  const select=document.createElement('select');select.id=prefix+'-style';select.setAttribute('aria-label',components?'全部组件动效':'面板动效');
  for(const choice of motionChoices){const o=document.createElement('option');o.value=choice.id;o.textContent=choice.name;select.append(o);}
  let saved=job.motion??motionSelection('original',scope);select.value=saved.style;select.disabled=true;label.append(select);
  const replay=document.createElement('button');replay.id=prefix+'-replay';replay.textContent=components?'重播全部入场':'重播入场';replay.disabled=true;
  const download=document.createElement('button');download.id=prefix+'-export';download.textContent='导出动效配置';download.disabled=true;
  const status=document.createElement('p');status.className='muted';status.setAttribute('role','status');status.textContent='正在连接'+name+'预览…';
  const row=document.createElement('div');row.className='button-row';row.append(label,replay,download);host.append(row,status);
  function message(){const choice=motionChoices.find(c=>c.id===saved.style),info=controller?.inspect();status.textContent=(info?.reducedMotion?'系统已启用减少动态效果，播放已停用。':'当前：'+choice.name+' · '+choice.description+'。切换即预览，无需重新生成。')+(components?' 统一应用于本套 16 类组件；已有面板的动效保持独立。':'')+(info?.legacyInternal?.length?' 此作品使用旧运行时，'+[...new Set(info.legacyInternal)].join('、')+' 内部开关动效需升级运行时后使用。':'')+' 动效配置独立导出，原始交付包保持不变。';}
  select.onchange=async()=>{
   const style=select.value;select.disabled=true;replay.disabled=true;download.disabled=true;
   let persisted=false;try{const result=await post('/pipeline/'+(components?'component-motion':'panel-motion'),components?{id:owner.generationId,expectedSkinSha256:owner.skin.version,style}:{id:owner.generationId,panelId:job.id,expectedSha256:job.sha256,style});if(ticket!==epoch)return;saved=result.motion;persisted=true;job.motion=saved;if(components)owner.skin.motion=saved;controller.set(saved);message();}
   catch(e){if(ticket===epoch){select.value=saved.style;status.textContent=(persisted?'已保存，预览应用失败：':'未保存：')+e.message;notice(status.textContent);}}
   finally{if(ticket===epoch){select.disabled=false;replay.disabled=false;download.disabled=false;}}
  };
  replay.onclick=()=>{controller.replay();message();};
  download.onclick=()=>{const value={...controller.export(),...(components?{projectId:owner.id,skinSha256:owner.skin.version}:{panelId:job.id,planSha256:job.sha256}),artifactId};const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=artifactId+'.motion.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),0);};
  const deadline=performance.now()+20000;
  function connect(){
   if(ticket!==epoch)return;
   try{const win=frame.contentWindow;if(components?win?.studioCanvas?.items?.length:win?.actionPreview?.scene||win?.settingsPreview?.scene){controller=(components?attachComponentMotion:attachPanelMotion)(win,saved);select.disabled=false;replay.disabled=false;download.disabled=false;message();return;}}
   catch(e){status.textContent='该预览暂不支持动效：'+e.message;return;}
   if(performance.now()<deadline)setTimeout(connect,100);else status.textContent=name+'仍未加载完成，请重新打开。';
  }
  frame.addEventListener('load',()=>{if(ticket===epoch)connect();},{once:true});
 }
 return {open,dispose,inspect:()=>controller?.inspect(),get artifactId(){return current?.artifactId;}};
}
