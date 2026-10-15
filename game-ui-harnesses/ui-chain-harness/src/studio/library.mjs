import {dirname,join} from 'node:path';
import {readSafe,hash} from '../skins/package.mjs';
import {discoverPlans} from './history.mjs';
export function studioLibrary(root,generation,pipeline,snapshot){
 let pending=null;
 return ()=>pending??=(async()=>{
  const history=await discoverPlans(root,generation),projects=[];
  for(const plan of history.plans){
   if(plan.status!=='readable'){projects.push({...plan,id:plan.projectId,phase:'invalid',message:'项目记录未通过校验；原文件已保留。'});continue;}
   const dir=dirname(dirname(plan.directory)),id=dir.split(/[\\/]/).at(-1);
   const project=JSON.parse(await readSafe(root,dir+'/project.json'));
   const ref=await readSafe(root,dir+'/reference.png'),reference='/references/'+hash(ref)+'.png';snapshot.files.set(reference.slice(1),ref);
   let flow;
   try{flow=await pipeline.action('status',{id:plan.generationId});}catch{flow={phase:'invalid',message:'处理记录或产物未通过校验；原文件已保留。',panels:[]};}
   projects.push({...plan,...flow,id,reference,description:project.description,style:project.style??null,automaticProcessing:project.automaticProcessing===true});
  }
  return {projects,truncated:history.truncated};
 })().finally(()=>pending=null);
}
