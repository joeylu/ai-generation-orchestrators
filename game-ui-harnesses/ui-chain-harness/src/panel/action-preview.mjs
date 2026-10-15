import '@pixi/layout';
import {Application} from 'pixi.js';
import {loadPngSkin} from '../runtime/png-skin.mjs';
import {compilePanel} from './compiler.mjs';
import {applyPresetAction,initialFieldState} from './action-behavior.mjs';
import {mountPreviewTheme} from './preview-theme.mjs';
export async function initializeActions(data){
  const palette=mountPreviewTheme(data.ctx.profile);
  const app=new Application();
  await app.init({width:1280,height:720,background:palette.canvas,antialias:true,preference:'webgl',preserveDrawingBuffer:true,layout:{autoUpdate:true,throttle:0},eventFeatures:{globalMove:true}});
  document.getElementById('stage').append(app.canvas);
  const bytes=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
  const skin=await loadPngSkin({manifestBytes:bytes(data.pack.manifest),manifestSha256:data.pack.manifestSha256,expectedBindings:data.pack.bindings,read:f=>bytes(data.pack.resources[f])});
  const states=data.presets.map(p=>Object.fromEntries(p.behavior.fields.map(f=>[f.id,initialFieldState(f)]).filter(([,state])=>state)));
  let scene,index=0,orientation=Object.keys(data.presets[0].documents)[0],closed=false,lastResult=null;
  const status=document.getElementById('status');
  function render(next=index,canvas=orientation){
    if(!data.presets[next]?.documents[canvas])throw Error('PANEL_ORIENTATION_UNAVAILABLE');
    scene?.dispose();index=next;orientation=canvas;closed=false;lastResult=null;
    const size=data.ctx.canvases.presets[canvas];app.renderer.resize(size.width,size.height);
    const preset=data.presets[index];
    scene=compilePanel(preset.documents[canvas],data.ctx,{app,skin,onEvent:e=>{
      const value=scene.runtime.handles.get(e.nodeId)?.readState();
      if(value&&Object.keys(value).length)states[index][e.nodeId]=value;
      if(e.event==='activate'&&preset.behavior.actions.some(a=>a.id===e.nodeId)){
        lastResult=applyPresetAction(preset.behavior,e.nodeId,states[index]);states[index]=lastResult.state;
        for(const[id,value]of Object.entries(states[index]))scene.runtime.handles.get(id).setState(value);
        status.textContent=lastResult.errors.length?lastResult.errors.map(e=>{const f=preset.behavior.fields.find(f=>f.id===e.id);return e.label+'：'+(f.required?'必填，':'')+'长度需为 '+f.minLength+'～'+f.maxLength+' 个字符';}).join('；'):lastResult.event.action==='submit'?'校验通过，已发出本地提交事件':lastResult.event.action==='reset-initial'?'已恢复初始值':'已发出本地按钮事件';
        if(lastResult.dismiss){closed=true;scene.runtime.handles.get('surface').setState({open:false});}
      }
    }});
    for(const[id,value]of Object.entries(states[index]))scene.runtime.handles.get(id).setState(value);
    scene.runtime.setMode('play');scene.runtime.flush();app.render();status.textContent=preset.content.title+(data.source==='model-response'?' · 模型候选':' · 离线示例');
  }
  render();
  for(const id of ['confirmation','form']){const button=document.getElementById(id),i=data.presets.findIndex(p=>p.content.presetId===id);button.hidden=i<0;button.onclick=()=>render(i);}
  document.getElementById('wide').hidden=!data.presets[0].documents.landscape;
  document.getElementById('tall').hidden=!data.presets[0].documents.portrait;
  document.getElementById('wide').onclick=()=>render(index,'landscape');
  document.getElementById('tall').onclick=()=>render(index,'portrait');
  document.getElementById('reopen').onclick=()=>render();
  const exportValue=()=>({kind:'ui_action_preview_bundle',version:'1.0',document:data.presets[index].documents[orientation],behavior:data.presets[index].behavior});
  document.getElementById('export').onclick=()=>{const url=URL.createObjectURL(new Blob([JSON.stringify(exportValue(),null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download=data.presets[index].content.id+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),0);};
  window.actionPreview={app,get scene(){return scene;},get state(){return structuredClone(states[index]);},get closed(){return closed;},get lastResult(){return lastResult;},render,exportValue};
}
