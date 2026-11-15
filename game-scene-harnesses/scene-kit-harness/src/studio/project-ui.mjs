const $=id=>document.getElementById(id);
const el=(tag,text,cls)=>{const e=document.createElement(tag);if(text)e.textContent=text;if(cls)e.className=cls;return e;};
export function mountProjectUI({getState,canOperate,setBusy,status}){
  if(!getState().workspace)return null;
  document.body.classList.add('project-mode');
  const context=el('nav',null,'project-context');context.setAttribute('aria-label','当前项目和地图');
  const projectButton=el('button',null,'project-switch'),mapButton=el('button',null,'map-switch');projectButton.id='project-switch';mapButton.id='map-switch';context.append(projectButton,mapButton);
  const home=el('a','‹ 项目','project-home');home.href='/';home.id='project-home';home.title='返回项目管理页';context.prepend(home);document.querySelector('.brand').after(context);
  const dialog=el('dialog',null,'project-dialog');dialog.id='project-dialog';document.body.append(dialog);
  const projectFile=el('input'),assetFile=el('input');
  for(const [input,id]of [[projectFile,'project-file'],[assetFile,'project-assets-file']]){input.type='file';input.accept='.zip,application/zip';input.hidden=true;input.id=id;document.body.append(input);}
  let working=false;
  function feedback(message,error=false){status(message,error);const output=dialog.querySelector('[role=status]');if(dialog.open&&output)output.textContent=message;}
  function setWorking(value){working=value;setBusy(value);dialog.querySelectorAll('button,input').forEach(e=>e.disabled=value);}
  const active=()=>{const s=getState(),p=s.workspace.projects.find(p=>p.projectId===s.workspace.activeProjectId);return {s,p,map:p.maps.find(m=>m.mapId===s.workspace.activeMapId)};};
  function refresh(){const {p,map}=active();projectButton.textContent=`${p.name} ▾`;mapButton.textContent=`${map.name} ▾`;projectButton.title='管理项目与素材库';mapButton.title='管理当前项目的地图';document.title=`${p.name} / ${map.name} · Scene Kit Studio`;}
  function errorMessage(result){return result.message??({STALE_REVISION:'另一个窗口已更新项目，请刷新后继续。',BODY_LIMIT:'文件超过导入容量限制。',EDIT_REJECTED:'地图或素材包校验失败，现有内容已保留。'}[result.code]??'操作失败，现有内容已保留。');}
  async function request(url,options){
    if(working||!canOperate())return status('请先结束当前操作或退出 Play Mode。',true);
    setWorking(true);feedback('正在保存项目…');
    try{const response=await fetch(url,options),result=await response.json();if(!response.ok)throw new Error(errorMessage(result));location.reload();}
    catch(error){feedback(error instanceof TypeError?'与本机编辑器的连接已中断，操作结果尚未确认。恢复服务后刷新核对。':error.message,true);setWorking(false);}
  }
  function action(action,extra={}){return request('/api/projects',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({revision:getState().revision,action,...extra})});}
  function addButton(parent,text,callback,cls){const b=el('button',text,cls);b.type='button';b.onclick=callback;parent.append(b);return b;}
  function form(parent,label,value,submitText,callback){const f=el('form',null,'project-form'),input=el('input'),submit=el('button',submitText);input.value=value;input.maxLength=60;input.required=true;input.setAttribute('aria-label',label);submit.type='submit';
    f.append(input,submit);f.onsubmit=e=>{e.preventDefault();if(input.value.trim())void callback(input.value.trim());};parent.append(f);return f;
  }
  function show(mode){
    if(working||!canOperate())return status('请先结束当前操作或退出 Play Mode。',true);dialog.setAttribute('aria-label',mode==='projects'?'项目管理':'地图管理');dialog.replaceChildren();const {s,p,map}=active();
    const heading=el('div',null,'project-dialog-heading');heading.append(el('h2',mode==='projects'?'项目':'地图'));addButton(heading,'关闭',()=>dialog.close());dialog.append(heading);
    dialog.append(el('p',mode==='projects'?'每个项目拥有自己的素材库，地图共用本项目素材。':'每张地图独立保存布局，切换后可继续编辑。','project-explanation'));
    const list=el('div',null,'project-list');
    for(const item of mode==='projects'?s.workspace.projects:p.maps){const selected=mode==='projects'?item.projectId===p.projectId:item.mapId===map.mapId;
      const b=addButton(list,'',()=>{if(selected)return;void action(mode==='projects'?'switch-project':'switch-map',mode==='projects'?{projectId:item.projectId}:{mapId:item.mapId});},'project-row');
      b.setAttribute('aria-current',selected?'true':'false');b.append(el('strong',item.name),el('span',mode==='projects'?`${item.maps.length} 张地图 · ${item.hasAssets?'已有素材':'待导入素材'}`:selected?'当前地图':'打开地图'));}
    dialog.append(list);const tasks=el('div',null,'project-tasks');
    form(tasks,mode==='projects'?'新项目名称':'新地图名称',mode==='projects'?'未命名项目':`地图 ${p.maps.length+1}`,mode==='projects'?'新建空白项目':'新建空白地图',n=>action(mode==='projects'?'create-project':'create-map',{name:n,template:'empty'}));
    addButton(tasks,mode==='projects'?'复制当前项目':'复制当前地图',()=>action(mode==='projects'?'create-project':'create-map',{name:(mode==='projects'?p.name:map.name).slice(0,55)+' 副本',template:'current'}));
    const rename=el('details');rename.append(el('summary','重命名当前'+(mode==='projects'?'项目':'地图')));form(rename,'新名称',mode==='projects'?p.name:map.name,'保存名称',n=>action(mode==='projects'?'rename-project':'rename-map',mode==='projects'?{projectId:p.projectId,name:n}:{mapId:map.mapId,name:n}));tasks.append(rename);
    if(mode==='projects'){
      const files=el('div',null,'project-file-actions');addButton(files,'打开项目 ZIP',()=>projectFile.click());addButton(files,'下载当前项目',()=>void download());
      if(!p.hasAssets)addButton(files,'导入资产包',()=>assetFile.click(),'primary');tasks.append(files);
    }
    const output=el('p',null,'project-message');output.setAttribute('role','status');tasks.append(output);dialog.append(tasks);if(!dialog.open)dialog.showModal();
  }
  async function upload(input,type){const file=input.files?.[0];input.value='';if(!file)return;const limit=type==='assets'?64:128;if(file.size>limit*1024*1024)return feedback(`文件超过${limit} MiB上限。`,true);
    await request(`/api/projects/${type}?revision=${getState().revision}`,{method:'POST',headers:{'Content-Type':'application/zip'},body:file});
  }
  async function download(){if(working||!canOperate())return;setWorking(true);feedback('正在打包项目…');
    try{const response=await fetch(`/api/projects/export?revision=${getState().revision}`);if(!response.ok)throw new Error(errorMessage(await response.json()));const url=URL.createObjectURL(await response.blob()),a=el('a');a.href=url;a.download='scene-project.zip';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);feedback('项目 ZIP 已交给浏览器下载，包含本项目素材和全部地图。');}
    catch(error){feedback(error instanceof TypeError?'项目下载连接中断，请恢复本机服务后再下载。':error.message,true);}finally{setWorking(false);}
  }
  addButton($('download-menu').lastElementChild,'整个项目 ZIP',()=>void download());
  projectFile.onchange=()=>void upload(projectFile,'import');assetFile.onchange=()=>void upload(assetFile,'assets');
  projectButton.onclick=()=>show('projects');mapButton.onclick=()=>show('maps');dialog.addEventListener('click',e=>{if(e.target===dialog&&!working)dialog.close();});dialog.addEventListener('cancel',e=>{if(working)e.preventDefault();});refresh();
  return {
    importMap(document,fileName){return action('import-map',{document,name:(fileName.replace(/\.json$/i,'').slice(0,60)||'导入地图')});},
    showEmpty(){
      $('loading').hidden=true;document.body.classList.add('empty-project');$('module-count').textContent='0';$('palette').replaceChildren();
      const empty=el('section',null,'project-empty');empty.id='project-empty';empty.append(el('h1','从这个项目开始'),el('p','先导入一个场景资产包，就能获得素材库和已搭好的初始地图。'));
      addButton(empty,'导入资产包',()=>assetFile.click(),'primary');addButton(empty,'切换项目',()=>show('projects'));$('canvas-host').append(empty);
      document.querySelectorAll('.canvas-toolbar button,.view-controls button,.palette-tabs button,.file-actions #save,.file-actions #open,.file-actions #preview,.file-actions #export-pack').forEach(b=>b.disabled=true);
      $('map-name').textContent=active().map.name;$('save-state').textContent='已保存到本机';$('mode-label').textContent='项目尚未绑定素材';status('空白项目已保存。可导入 Studio 导出的场景资产 ZIP，或切换已有项目。');
    },
  };
}
