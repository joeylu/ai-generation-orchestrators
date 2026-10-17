import {suspendPreview} from './project-ui.mjs';
const labels={passed:'检查通过',ready:'等待执行',waiting:'等待前置步骤','failed-retryable':'失败，可确定性重试',incomplete:'上次执行未完成','awaiting-visual-review':'处理完成 · 待外观确认','ready-to-resume':'可继续处理',invalid:'记录校验失败','node-completed':'该步骤已有完成记录',failed:'执行失败'};
const names={'source-s01':'图集 S01','source-s02':'图集 S02','source-s03':'图集 S03','source-s04':'图集 S04','source-s05':'材质图集 S05',locate:'部件定位',metadata:'皮肤参数','content-insets':'内容安全区',assemble:'基础组包','material-bind':'纹理提取与绑定','consumer-build':'消费包构建',postprocess:'组件最终检查'};
const $=s=>document.querySelector(s);
export async function refreshTasks(){
 const button=$('#refresh-tasks');button.disabled=true;$('#task-message').textContent='正在核对任务记录与产物…';
 try{
  const response=await fetch('/tasks.json');if(!response.ok)throw Error('任务记录暂时无法读取');const data=await response.json();
  $('#task-list').replaceChildren();
  for(const task of data.tasks){const card=document.createElement('section'),title=document.createElement('h3'),state=document.createElement('p'),list=document.createElement('ol'),note=document.createElement('p');
   title.textContent=task.name;state.textContent=labels[task.status]||task.status;
   for(const n of task.nodes){const li=document.createElement('li');li.textContent=`${names[n.id]||n.id}：${labels[n.status]||n.status}`;list.append(li);}
   note.textContent=task.recovery==='complete'?'全部处理步骤已有校验回执，无需恢复。':task.recovery==='tools-changed'?'工具版本已经变化，旧任务不能直接恢复，需按当前版本新建任务。':task.recovery==='blocked'?task.message:'仅继续未完成的确定性步骤，不会提交模型生成。';
   card.append(title,state,list,note);
   if(task.operation){const operation=document.createElement('p');operation.textContent=task.operation==='running'?'正在继续处理，可稍后刷新查看进度。':task.operation==='failed'?'本次执行未正常结束，未自动重试；请结合步骤记录检查结果。':'本次执行已结束，最终结果以步骤回执为准。';card.append(operation);}
   if(task.resumeToken){const resume=document.createElement('button');resume.textContent='继续处理';resume.onclick=async()=>{
    resume.disabled=true;
    try{const response=await fetch('/tasks/resume',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:task.id,token:task.resumeToken})});const result=await response.json();if(!response.ok)throw Error(result.message);await refreshTasks();}
    catch(e){$('#task-message').textContent=e.message;resume.textContent='请刷新后重试';}
   };card.append(resume);}
   if(task.attempts.length){const details=document.createElement('details'),summary=document.createElement('summary');summary.textContent='查看执行历史';details.append(summary);for(const a of task.attempts){const p=document.createElement('p');p.textContent=`${names[a.node]||a.node}：${labels[a.status]||a.status}`;details.append(p);}card.append(details);}
   $('#task-list').append(card);
  }
  $('#task-message').textContent=data.tasks.length?'已重新读取本地记录。程序完成不代表外观验收。':'当前尚未登记任务。';
 }catch(e){$('#task-list').replaceChildren();$('#task-message').textContent=e.message;}finally{button.disabled=false;}
}
$('#refresh-tasks').onclick=refreshTasks;
$('#view-tasks').onclick=()=>{suspendPreview();$('#project-editor').hidden=true;$('#artifact-browser').hidden=true;$('#task-view').hidden=false;refreshTasks();};
for(const id of ['view-artifacts','new-project'])$('#'+id).addEventListener('click',()=>{$('#task-view').hidden=true;});
