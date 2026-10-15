import {generationControls} from './generation-ui.mjs';
import {suspendPreview} from './project-ui.mjs';
const $=s=>document.querySelector(s);
async function refresh(){
 const button=$('#refresh-plans');button.disabled=true;$('#history-message').textContent='正在核对本机计划与逐板记录…';
 try{
  const response=await fetch('/plans.json');if(!response.ok)throw Error('历史计划暂时无法读取');const data=await response.json();$('#history-list').replaceChildren();
  for(const plan of data.plans){const card=document.createElement('details'),title=document.createElement('summary'),info=document.createElement('p');title.textContent=plan.name;card.append(title,info);
   if(plan.status==='readable'){
    info.textContent=`${plan.sheets.length} 张图集 · ${plan.assets} 个部件 · ${plan.batchSha256}`;info.style.overflowWrap='anywhere';
    if(!plan.current){const warning=document.createElement('p');warning.textContent='计划工具或契约已更新：可查看记录，但须重新准备计划才能进行新生成。';card.append(warning);}
    card.append(generationControls({...plan,readOnly:!plan.current},plan.state));
   }else info.textContent=plan.status==='incomplete'?'该目录没有已完成批次，不能生成。':'记录或引用文件校验失败，不能生成；原始资料仍保留。';
   $('#history-list').append(card);
  }
  $('#history-message').textContent=`找到 ${data.plans.length} 条本机计划记录。打开记录不会提交模型。${data.truncated?'仅展示前100个项目目录。':''}`;
 }catch(e){$('#history-list').replaceChildren();$('#history-message').textContent=e.message;}finally{button.disabled=false;}
}
$('#view-plans').onclick=()=>{suspendPreview();for(const id of ['project-editor','artifact-browser','task-view'])$('#'+id).hidden=true;$('#history-view').hidden=false;refresh();};
$('#refresh-plans').onclick=refresh;
for(const id of ['new-project','view-artifacts','view-tasks'])$('#'+id).addEventListener('click',()=>$('#history-view').hidden=true);
