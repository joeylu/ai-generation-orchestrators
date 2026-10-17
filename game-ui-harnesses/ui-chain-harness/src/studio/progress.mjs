// Read-only UI projections. Counts are verified outputs/steps, never model percentages.
const localGroups=[
 {id:'source',label:'核对组件原图',hint:'校验收到的组件图片与来源记录'},
 {id:'locate',label:'定位部件',hint:'识别图集中的独立部件'},
 {id:'metadata',label:'拆分与切线',hint:'准备部件裁切、九宫格与尺寸配置'},
 {id:'content-insets',label:'内容安全区',hint:'检查文字与控件的内边距'},
 {id:'postprocess',label:'组包与组件检查',hint:'打包素材并验证 16 类组件的显示与交互'}
];
const kind=n=>['assemble','material-bind','consumer-build'].includes(n.id)?'postprocess':n.kind??(n.id.startsWith('source-')?'source':n.id);
export function batchPresentation(plan={}){
 const hasMaterials=(plan.sheets??[]).some(s=>(s.sheetId??s.id??s)==='S05')||(plan.state?.nodes??[]).some(n=>n.sheetId==='S05');
 const componentSheets=(plan.sheets??[]).filter(s=>(s.sheetId??s.id??s)!=='S05'),materialSheet=(plan.sheets??[]).find(s=>(s.sheetId??s.id??s)==='S05');
 const materialCount=Number.isSafeInteger(materialSheet?.assets)&&materialSheet.assets>0?materialSheet.assets:3;
 const componentCount=componentSheets.length===4&&componentSheets.every(s=>Number.isSafeInteger(s.assets)&&s.assets>0)?componentSheets.reduce((sum,s)=>sum+s.assets,0):Number.isSafeInteger(plan.assets)&&plan.assets>(hasMaterials?materialCount:0)?plan.assets-(hasMaterials?materialCount:0):30;
 return {hasMaterials,sheetTotal:hasMaterials?5:4,sheetIds:['S01','S02','S03','S04',...(hasMaterials?['S05']:[])],
  sheetLabel:hasMaterials?'五张图集':'四张图集',sheetDescription:hasMaterials?'4 张组件图集 + 1 张材质图集':'4 张透明组件图集',
  assetDescription:hasMaterials?`${componentCount} 个基础部件 + ${materialCount} 个材质，组装为 16 类组件`:`${componentCount} 个通用部件，组装为 16 类组件`};
}
export function sheetProgress(node={},state={}){
 const s=node.status,running=state.operation==='running';
 if(s==='received')return {state:'done',label:node.recovered?'已恢复接收':'已收到',detail:(node.recovered?'已恢复原图；':'')+(node.inspection==='rejected'?'原始检查有偏差，将保留候选处理记录':'原图已保存'),startedAt:node.submittedAt,finishedAt:node.receivedAt??node.finishedAt};
 if(['indeterminate','failed'].includes(s)&&node.outcomeRecorded&&node.diagnostic)return {state:'blocked',label:node.diagnostic.label,detail:node.diagnostic.detail,startedAt:node.submittedAt,finishedAt:node.finishedAt??node.diagnostic.finishedAt};
 if(s==='failed')return {state:'blocked',label:'调用失败',detail:'已保留记录，可单独补这张图集',startedAt:node.submittedAt,finishedAt:node.finishedAt};
 if(s==='indeterminate'&&running&&!node.outcomeRecorded)return {state:'active',label:'生成中',detail:'请求已提交，等待模型返回',startedAt:node.submittedAt};
 if(['indeterminate','reserved-outcome-unknown','authorization-incomplete'].includes(s))return {state:'blocked',label:'结果待确认',detail:'不会自动重新提交',startedAt:node.submittedAt,finishedAt:node.finishedAt};
 if(s==='supplement-awaiting-confirmation')return {state:'waiting',label:'补图待确认',detail:'确认后仅生成本张图集'};
 if(running||s==='authorized-awaiting-external-submission')return {state:'waiting',label:'等待提交',detail:'同一批次按任务状态推进'};
 return {state:'waiting',label:'待确认生成',detail:'确认后开始本次调用'};
}

export function needsSheetSupplement(node={}){
 return ['indeterminate','failed','supplement-awaiting-confirmation'].includes(node.status)||node.status==='received'&&node.inspection==='rejected';
}
export function projectProgress(project){
 const batch=batchPresentation(project);
 const sheets=project.state?.nodes??[],received=sheets.filter(n=>n.status==='received').length,nodes=project.task?.nodes??[];
 const complete=Boolean(project.skin)&&!project.componentReplacement,blocked=!complete&&!project.busy&&!project.recovering&&(project.phase==='processing-failed'||project.phase==='invalid'||project.task?.status==='invalid');
 const stages=localGroups.map(group=>{const members=nodes.filter(n=>kind(n)===group.id);return {...group,...(batch.hasMaterials&&group.id==='postprocess'?{label:'材质绑定与组件检查',hint:'提取标题和面板材质、自动绑定并验证 16 类组件'}:{}),state:complete||members.length&&members.every(n=>n.status==='passed')?'done':'waiting'};});
 // Preserve visibility of future DAG extensions instead of claiming all steps passed.
 for(const n of nodes.filter(n=>!localGroups.some(g=>g.id===kind(n))))stages.push({id:n.id,label:'其他处理步骤',hint:'保留扩展步骤的实际状态',state:n.status==='passed'?'done':'waiting'});
 const next=stages.find(s=>s.state!=='done');if(next){if(project.recovering)next.state='recovering';else if(blocked)next.state='blocked';else if(project.busy&&project.batchReady)next.state='active';}
 const passed=stages.filter(s=>s.state==='done').length;
 const current=complete?'组件已入库':project.recovering?'等待自动恢复':blocked?'本地处理已暂停':project.generationRunning?'正在生成图集':project.busy?(next?.label??'正在整理组件结果'):received===batch.sheetTotal?'等待本地处理':sheets.some(n=>sheetProgress(n,project.state).state==='blocked')?'图集需要处理':project.state?.fresh===false?'生成尚未完成':'等待生成确认';
 return {received,sheetTotal:batch.sheetTotal,stages,passed,total:stages.length,current,blocked,complete,
  flow:[{label:'保存风格',state:'done'},{label:'生成图集',state:received===batch.sheetTotal?'done':project.generationRunning?'active':sheets.some(n=>sheetProgress(n,project.state).state==='blocked')?'blocked':'waiting'},
   {label:'拆分与检查',state:complete?'done':blocked?'blocked':project.recovering?'recovering':project.busy?'active':'waiting'},{label:'组件入库',state:complete?'done':'waiting'}]};
}
export function panelProgress(job){
 const labels=[job.builder==='deterministic-inventory'?'读取仓库预设与组件':'理解需求与组装',job.canvasSelection?'生成所选比例预览':'生成横竖预览','整理交付文件'];
 const index={planning:0,rendering:1,publishing:2}[job.stage]??0,done=job.status==='ready',running=job.status==='running';
 return labels.map((label,i)=>({label,state:done?'done':i<index?'done':i===index?(running?'active':['failed-no-retry','interrupted-no-retry','invalid','needs-input'].includes(job.status)?'blocked':'waiting'):'waiting'}));
}
export function elapsedText(start,end,now=Date.now()){
 const from=Date.parse(start),to=end?Date.parse(end):now;if(!Number.isFinite(from)||!Number.isFinite(to)||from>to)return '';
 const seconds=Math.floor((to-from)/1000);return seconds<60?seconds+' 秒':seconds<3600?Math.floor(seconds/60)+' 分 '+seconds%60+' 秒':Math.floor(seconds/3600)+' 小时 '+Math.floor(seconds%3600/60)+' 分';
}
