import {panelCompletion} from './panel-completion.mjs';
import {confirmAction} from './confirm-ui.mjs';
import {panelProgress} from './progress.mjs';
import {stepsList,elapsed} from './progress-ui.mjs';
export function mountPanelEditor({$,el,get,post,notice,projects,reload,projectCard,link,button,empty,preview}){
 let selected=null,preparing=false,presets=[];
 const pendingJobs=new Set(),answers=new Map();let editVersion=0;
 let storage;try{storage=window.sessionStorage;}catch{}const completion=panelCompletion(storage);
 window.addEventListener('hashchange',()=>completion.leave(location.hash));
 $('#panel-editor').addEventListener('input',()=>{editVersion++;completion.editing();});
 function checkCompletion(){const result=completion.observe(projects(),location.hash,Boolean(document.querySelector('#confirm-dialog')));if(!result)return false;notice('「'+result.name+'」面板生成完成'+(result.autoOpen?'，正在打开预览。':'，可在面板作品库查看。'));if(result.autoOpen)preview(result.artifactId);return result.autoOpen;}

 function presetSelection(){const p=presets.find(p=>p.id===$('#panel-kind').value),custom=p?.id==='custom';$('#panel-preset-description').textContent=p?p.description+(custom?'':' 具体文案和初始值可在下方补充。'):'';$('#panel-state-field').hidden=custom;$('#panel-request-hint').textContent=custom?'必填':'可选';$('#panel-request').required=custom;$('#panel-request').placeholder=custom?'例如：创建玩家资料面板，包含昵称输入框、公开资料开关和保存按钮。请说明标题、控件、默认值与按钮用途。':'可修改标题、按钮文案或初始值；留空使用所选预设的默认内容。';selection();}
 function renderVariants(){const group=$('#panel-group').value;$('#panel-kind').replaceChildren(...presets.filter(p=>p.group===group).map(p=>{const o=el('option',p.variant);o.value=p.id;return o;}));presetSelection();}
 get('/panel-presets.json').then(data=>{presets=[...data.presets,...(data.custom?[data.custom]:[])];const groups=[...new Map(presets.map(p=>[p.group,p.groupName])).entries()];$('#panel-group').replaceChildren(...groups.map(([id,name])=>{const o=el('option',name);o.value=id;return o;}));renderVariants();}).catch(e=>{$('#panel-message').textContent='预设加载失败，请刷新页面。';notice(e.message);});
 $('#panel-group').onchange=renderVariants;$('#panel-kind').onchange=presetSelection;
 const labels={prepared:'待确认生成',running:'正在生成面板',ready:'面板已可预览','needs-input':'需要补充需求','failed-no-retry':'本次未完成 · 未自动重试','interrupted-no-retry':'执行中断 · 未自动重试',invalid:'产物检查未通过'};
 function selection(){const p=projects().find(p=>p.id===selected&&p.skin);$('#selected-project').textContent=p?'已选：'+p.name+' · 组件版本 '+p.skin.version.slice(0,12):'请先选择一套已完成的组件。';$('#panel-prepare').disabled=!p||p.busy||preparing||!$('#panel-orientation').value||!presets.some(p=>p.id===$('#panel-kind').value)||($('#panel-kind').value==='custom'&&!$('#panel-request').value.trim());for(const c of $('#panel-projects').children)c.classList.toggle('selected',c.dataset.project===selected);return p;}
 $('#panel-request').addEventListener('input',selection);$('#panel-orientation').addEventListener('change',selection);
 function select(id){if(selected!==id){editVersion++;completion.editing();}selected=id;selection();renderJobs();}
 function card(p,job,{allowDelete=false}={}){const c=el('article',undefined,'project-card'),body=el('div',undefined,'card-body');body.append(el('span',job.deletedAt?'已移入回收站':labels[job.status]??job.status,'badge '+(job.status==='ready'?'':'pending')),el('h3',(job.presetName??presets.find(p=>p.id===job.kind)?.name??{settings:'设置面板',confirmation:'确认弹窗',form:'简单表单'}[job.kind]??'面板')+' · '+p.name),el('p',job.text,'muted'),el('p',job.canvasSelection?'画布比例：'+(job.orientation==='portrait'?'竖版 9:16':'横版 16:9'):'历史任务 · 横竖两版','muted'),el('p','组件版本：'+(job.skinVersion?.slice(0,12)??'已绑定原始计划'),'muted'));
  if(job.deletedAt){body.append(button('恢复面板',()=>visibility(p,job,false)));c.append(body);return c;}
  if(allowDelete){const remove=button('删除面板',()=>visibility(p,job,true),'panel-delete');remove.disabled=p.busy||job.status==='running'||pendingJobs.has(job.id);if(job.status==='running')remove.title='正在生成，完成后可以删除';body.append(remove);}
  if(job.status!=='prepared'){body.append(stepsList(panelProgress(job),true));if(job.status==='running'||job.finishedAt)body.append(elapsed(job.startedAt,job.finishedAt));}
  if(job.status==='prepared'){const approve=button('确认生成这份面板',async()=>{try{await start(p,job);await reload();renderJobs();}catch(e){notice(e.message);}});approve.disabled=pendingJobs.has(job.id);body.append(approve);}
  if(job.revision)body.append(el('p','本任务第 '+job.revision+' 版 · 已保留 '+(job.history?.length??0)+' 次历史计划与结果','muted'));
  if(job.status==='needs-input'&&job.questions){
   body.append(el('p',job.questions.map(q=>q.question??String(q)).join('\n'),'muted'));
   const key=p.id+'/'+job.id+'/'+job.sha256,form=el('div',undefined,'panel-clarification');form.hidden=!answers.has(key);
   const label=el('label','补充回答（必填）'),answer=el('textarea');answer.rows=4;answer.maxLength=4000;answer.placeholder='请回答上方问题，例如：接受现有预设布局，由程序分别生成横竖两版。';answer.value=answers.get(key)??'';answer.setAttribute('aria-label','补充回答');label.append(answer);
   const submit=button('保存补充并继续',async()=>{
    const text=answer.value.trim();if(!job.orientation&&!$('#panel-orientation').value){feedback.textContent='请先在上方选择画布比例，再继续。';return;}if(!text||pendingJobs.has(job.id))return;
    pendingJobs.add(job.id);submit.disabled=true;feedback.textContent='正在将回答关联到原任务…';
    try{
     const next=await post('/pipeline/panel-prepare',{id:p.generationId,panelId:job.id,parentSha256:job.sha256,kind:job.kind,text,orientation:job.orientation??$('#panel-orientation').value});
     answers.delete(key);pendingJobs.delete(job.id);await start(p,next);await reload();if(form.contains(document.activeElement))document.activeElement.blur();renderJobs();
    }catch(e){feedback.textContent=e.message;}finally{pendingJobs.delete(job.id);submit.disabled=!answer.value.trim();}
   });submit.disabled=!answer.value.trim()||pendingJobs.has(job.id);
   const feedback=el('p','保留原需求、问题和组件版本；继续同一任务。确认后才会调用一次模型。','muted');feedback.setAttribute('role','status');
   answer.addEventListener('input',()=>{answers.set(key,answer.value);submit.disabled=!answer.value.trim()||pendingJobs.has(job.id);});
   form.append(label,feedback,submit);
   const open=button('补充需求',()=>{
    if(!answers.has(key)){const draft=$('#panel-request').value.trim();answer.value=draft&&draft!==job.text.trim()?draft:'';answers.set(key,answer.value);}
    form.hidden=false;submit.disabled=!answer.value.trim()||pendingJobs.has(job.id);answer.focus();
   });body.append(open,form);
  }
  if(job.status==='ready'&&job.artifact)body.append(link('打开面板','#panel/'+job.artifact.id,'button primary'),link('选择动效','#panel/'+job.artifact.id,'button'));
  if(job.message)body.append(el('p',job.message,'muted'));c.append(body);return c;
 }
 async function visibility(p,job,deleted){
  if(pendingJobs.has(job.id))return;pendingJobs.add(job.id);
  try{
   if(deleted&&!await confirmAction({title:'删除这份面板？',description:'移入回收站后不再显示于作品库和生成台，随时可以恢复。不会删除组件项目、原文件或生成记录。',facts:[['组件项目',p.name],['面板',job.presetName??job.kind]],confirmLabel:'移入回收站'}))return;
   await post('/pipeline/'+(deleted?'panel-delete':'panel-restore'),{id:p.generationId,panelId:job.id,expectedSha256:job.sha256});
   notice(deleted?'面板已移入回收站，可随时恢复。':'面板已恢复到作品库。');window.dispatchEvent(new Event('studio-status-changed'));
  }catch(e){notice(e.message);}finally{pendingJobs.delete(job.id);}
 }
 function renderJobs(){if(checkCompletion())return;const target=$('#panel-jobs');if(target.contains(document.activeElement)&&document.activeElement.closest('.panel-clarification')){selection();return;}target.replaceChildren();const p=projects().find(p=>p.id===selected);for(const job of p?.panels??[])if(!job.deletedAt)target.append(card(p,job));selection();}
 function render(){const target=$('#panel-projects');target.replaceChildren();for(const p of projects().filter(p=>p.skin))target.append(projectCard(p,x=>select(x.id)));if(!target.children.length){empty(target,'还没有可用组件','先在组件项目库完成一套组件。');target.append(link('新建组件项目','#new','button primary'));}selection();renderJobs();}
 async function start(p,job){if(pendingJobs.has(job.id))return;pendingJobs.add(job.id);try{if(!await confirmAction({title:job.revision?'按补充回答继续生成？':'生成这份面板？',description:job.revision?'继续同一个面板任务，使用原需求、澄清问题和本轮回答；旧计划与结果保留。':'使用已保存的需求和组件版本组装面板，完成后可在面板作品库查看。',facts:[['组件项目',p.name],['组件版本',job.skinVersion?.slice(0,12)??'已冻结'],['本次调用','1 次模型调用，不自动重试'],['画布比例',job.canvasSelection?(job.orientation==='portrait'?'竖版 9:16':'横版 16:9'):'历史任务 · 横竖两版']],details:job.sha256,confirmLabel:'确认生成面板'})){$('#panel-message').textContent='计划已保存，尚未调用模型，可在下方确认生成。';return;}const origin=location.hash,version=editVersion;$('#panel-message').textContent='正在提交面板生成…';await post('/pipeline/panel-start',{id:p.generationId,panelId:job.id,confirmed:job.sha256});completion.watch(p.id,job,origin,location.hash===origin&&editVersion===version);$('#panel-message').textContent='面板开始生成，下方将显示组装、预览和交付进度。';}finally{pendingJobs.delete(job.id);}}
 $('#panel-prepare').onclick=async()=>{if(preparing)return;const p=selection(),text=$('#panel-request').value.trim();if(!p||!presets.some(p=>p.id===$('#panel-kind').value)||($('#panel-kind').value==='custom'&&!text))return;preparing=true;selection();$('#panel-prepare').textContent='正在准备面板计划…';$('#panel-prepare').setAttribute('aria-busy','true');try{$('#panel-message').textContent='正在固定需求与组件版本并准备面板计划…';const job=await post('/pipeline/panel-prepare',{id:p.generationId,kind:$('#panel-kind').value,text,orientation:$('#panel-orientation').value});await start(p,job);await reload();renderJobs();}catch(e){$('#panel-message').textContent=e.message;}finally{preparing=false;$('#panel-prepare').textContent='生成面板';$('#panel-prepare').removeAttribute('aria-busy');selection();}};
 return {render,renderJobs,select,card,checkCompletion};
}
