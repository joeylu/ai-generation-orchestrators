const $=id=>document.getElementById(id);
const el=(tag,text,cls)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;};
let state,busy=false,dialogAction;
function message(text,error=false){for(const id of ['hub-message','hub-dialog-message']){$(id).textContent=text;$(id).dataset.error=String(error);}}
function setBusy(value){busy=value;document.body.dataset.busy=String(value);document.querySelectorAll('button,input').forEach(e=>e.disabled=value);}
function failure(result){if(result.code==='STALE_REVISION')return '另一个窗口已修改项目，请点击“重新加载”后继续。';return result.message??({BODY_LIMIT:'项目文件超过128 MiB上限。',EDIT_REJECTED:'项目文件校验未通过，已有项目保持不变。'}[result.code]??'操作未完成，已有项目保持不变。');}
async function load(){
  if(busy)return;setBusy(true);
  try{const response=await fetch('/api/projects');if(!response.ok)throw Error('无法读取本机项目。');state=await response.json();document.body.dataset.revision=String(state.revision);render();document.body.dataset.ready='true';message('');}
  catch(error){message(error.message,true);if(!state)$('project-grid').replaceChildren(el('p','项目暂时无法载入，请重新加载。','hub-loading'));}
  finally{setBusy(false);}
}
async function perform(action,extra={},destination='/'){
  if(busy)return;setBusy(true);message('正在保存项目…');
  try{const response=await fetch('/api/projects',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({revision:state.revision,action,...extra})}),result=await response.json();if(!response.ok)throw Error(failure(result));location.assign(destination);}
  catch(error){message(error.message,true);setBusy(false);}
}
function openProject(project){return perform('switch-project',{projectId:project.projectId},'/editor');}
function showDialog(action,project){
  if(busy||!state)return;dialogAction={action,project};$('hub-dialog-message').textContent='';
  const copy=action==='copy-project',create=action==='create-project';$('hub-dialog-title').textContent=create?'新建场景项目':copy?'复制项目':'重命名项目';
  $('hub-dialog-description').textContent=create?'从空白项目开始，导入场景资产包后即可编辑地图。':copy?'复制本项目的素材和全部地图，之后可以独立编辑。':'名称会用于项目列表，不会改变素材与地图。';
  $('hub-project-name').value=create?'未命名项目':copy?project.name.slice(0,55)+' 副本':project.name;
  $('hub-dialog-submit').textContent=create?'创建并进入':copy?'复制项目':'保存名称';$('hub-dialog').showModal();$('hub-project-name').select();
}
async function download(project){
  if(busy)return;setBusy(true);message('正在打包项目…');
  try{const response=await fetch(`/api/projects/${project.projectId}/export?revision=${state.revision}`);if(!response.ok)throw Error(failure(await response.json()));const url=URL.createObjectURL(await response.blob()),a=el('a');a.href=url;a.download='scene-project.zip';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);message(`“${project.name}”项目已交给浏览器下载。`);}
  catch(error){message(error.message,true);}finally{setBusy(false);}
}
function addButton(parent,text,callback,cls){const b=el('button',text,cls);b.type='button';b.onclick=callback;parent.append(b);return b;}
function card(project){
  const item=el('article',undefined,'hub-card');item.dataset.projectId=project.projectId;
  const open=el('button',undefined,'hub-card-open');open.type='button';open.setAttribute('aria-label',`打开项目 ${project.name}`);open.onclick=()=>void openProject(project);
  const cover=el('div',undefined,'hub-cover');
  if(project.coverUrl){const image=el('img');image.src=project.coverUrl;image.alt='';image.loading='lazy';cover.append(image,el('span','素材预览','hub-cover-label'));}
  else{const symbol=el('div','◇','hub-empty-symbol');symbol.setAttribute('aria-hidden','true');cover.classList.add('hub-cover-empty');cover.append(symbol,el('span','等待你的第一个场景','hub-empty-caption'));}
  const info=el('div',undefined,'hub-card-info');info.append(el('h3',project.name),el('p',`${project.mapCount} 张地图${project.hasAssets?` · ${project.environmentCount} 个环境素材 · ${project.brushCount} 个画刷`:' · 尚未导入素材'}`));open.append(cover,info);item.append(open);
  const footer=el('div',undefined,'hub-card-footer');footer.append(el('span',project.projectId===state.workspace.activeProjectId?'当前项目':project.hasAssets?'已就绪':'空白项目',project.hasAssets?'hub-project-state':'hub-project-state empty'));
  const menu=el('details',undefined,'hub-card-menu'),summary=el('summary','•••');summary.setAttribute('aria-label',`管理项目 ${project.name}`);menu.append(summary);const actions=el('div',undefined,'hub-card-menu-items');
  addButton(actions,'重命名',()=>showDialog('rename-project',project));addButton(actions,'复制项目',()=>showDialog('copy-project',project));addButton(actions,'下载项目',()=>void download(project));menu.append(actions);
  const footerActions=el('div',undefined,'hub-card-footer-actions');const enter=addButton(footerActions,'进入项目 →',()=>void openProject(project),'hub-card-enter');enter.setAttribute('aria-label',`进入项目 ${project.name}`);footerActions.append(menu);footer.append(footerActions);item.append(footer);return item;
}
function render(){
  const query=$('project-search').value.trim().toLocaleLowerCase(),projects=state.projects.filter(p=>p.name.toLocaleLowerCase().includes(query));$('project-total').textContent=String(state.projects.length);$('project-grid').replaceChildren(...projects.map(card));
  if(!query){const create=el('button',undefined,'hub-create-card');create.type='button';create.append(el('span','＋'),el('strong','新建一个场景项目'),el('small','独立的素材库与地图'));create.onclick=()=>showDialog('create-project');$('project-grid').append(create);}
  $('hub-no-results').hidden=projects.length>0||!query;
}
$('new-project').onclick=()=>showDialog('create-project');$('import-project').onclick=()=>{if(!busy)$('hub-project-file').click();};
$('project-search').oninput=()=>{if(state)render();};$('clear-search').onclick=()=>{$('project-search').value='';render();};$('refresh-projects').onclick=()=>void load();
for(const id of ['hub-dialog-close','hub-dialog-cancel'])$(id).onclick=()=>{if(!busy)$('hub-dialog').close();};
$('hub-dialog').addEventListener('cancel',e=>{if(busy)e.preventDefault();});$('hub-dialog').addEventListener('click',e=>{if(e.target===$('hub-dialog')&&!busy)$('hub-dialog').close();});
$('hub-project-form').onsubmit=e=>{e.preventDefault();const name=$('hub-project-name').value.trim();if(!name||busy)return;const {action,project}=dialogAction;void perform(action,action==='create-project'?{name,template:'empty'}:{projectId:project.projectId,name},action==='create-project'?'/editor':'/');};
$('hub-project-file').onchange=async()=>{const file=$('hub-project-file').files?.[0];$('hub-project-file').value='';if(!file||busy)return;if(file.size>128*1024*1024)return message('项目文件超过128 MiB上限。',true);setBusy(true);message('正在校验项目…');
  try{const response=await fetch(`/api/projects/import?revision=${state.revision}`,{method:'POST',headers:{'Content-Type':'application/zip'},body:file});if(!response.ok)throw Error(failure(await response.json()));location.assign('/');}catch(error){message(error.message,true);setBusy(false);}
};
document.addEventListener('click',e=>{for(const menu of document.querySelectorAll('.hub-card-menu[open]'))if(!menu.contains(e.target))menu.open=false;});
window.addEventListener('pageshow',e=>{if(e.persisted){setBusy(false);void load();}});await load();
