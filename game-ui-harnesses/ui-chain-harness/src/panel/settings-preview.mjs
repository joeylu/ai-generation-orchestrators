import '@pixi/layout';
import { Application } from 'pixi.js';
import { loadPngSkin } from '../runtime/png-skin.mjs';
import { compilePanel } from './compiler.mjs';

export async function initializeSettings(data) {
  const app = new Application();
  await app.init({width:1280,height:720,background:'#233a30',antialias:true,preference:'webgl',preserveDrawingBuffer:true,layout:{autoUpdate:true,throttle:0},eventFeatures:{globalMove:true}});
  document.getElementById('stage').append(app.canvas);
  const bytes = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
  const skin = await loadPngSkin({manifestBytes:bytes(data.pack.manifest),manifestSha256:data.pack.manifestSha256,expectedBindings:data.pack.bindings,read:f=>bytes(data.pack.resources[f])});
  const state = Object.fromEntries(data.content.fields.map(f=>[f.id, f.type==='switch'?{checked:f.value}:f.type==='select'?{selectedId:f.value}:{value:f.value}]));
  const events=[];
  let scene, orientation=Object.keys(data.documents)[0], closed=false;
  const status=document.getElementById('status');
  function render(next=orientation) {
    if(!data.documents[next])throw Error('PANEL_ORIENTATION_UNAVAILABLE');
    scene?.dispose(); orientation=next; closed=false;
    const size=data.ctx.canvases.presets[next];app.renderer.resize(size.width,size.height);
    scene=compilePanel(data.documents[next],data.ctx,{app,skin,onEvent:e=>{
      events.push(e);if(events.length>100)events.shift();
      if(state[e.nodeId]) state[e.nodeId]=scene.runtime.handles.get(e.nodeId).readState();
      if(e.nodeId==='close'&&e.event==='activate') {closed=true;scene.runtime.setMode('edit');scene.root.root.visible=false;status.textContent='设置已关闭，可点击「重新打开」';}
      else status.textContent='修改已保留在本次预览中';
    }});
    for(const [id,value] of Object.entries(state))scene.runtime.handles.get(id).setState(value);
    scene.runtime.setMode('play');scene.runtime.flush();app.render();
    status.textContent=next==='landscape'?'横版设置面板':'竖版设置面板';
  }
  render();
  document.getElementById('wide').hidden=!data.documents.landscape;
  document.getElementById('tall').hidden=!data.documents.portrait;
  document.getElementById('wide').onclick=()=>render('landscape');
  document.getElementById('tall').onclick=()=>render('portrait');
  document.getElementById('reopen').onclick=()=>render();
  document.getElementById('export').onclick=()=>{
    const url=URL.createObjectURL(new Blob([JSON.stringify(data.documents[orientation],null,2)],{type:'application/json'}));
    const a=document.createElement('a');a.href=url;a.download=data.documents[orientation].id+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),0);
  };
  window.settingsPreview={app,skin,events,get scene(){return scene;},get state(){return structuredClone(state);},get closed(){return closed;},get orientation(){return orientation;},documents:data.documents,render};
}
