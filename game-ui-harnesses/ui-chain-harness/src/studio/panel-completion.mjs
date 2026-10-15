// Per-tab navigation intent; never persisted in a generation plan or sent to a model.
export function panelCompletion(storage){
 const key='ui-studio-panel-completion';let pending;
 try{const p=JSON.parse(storage?.getItem(key)??'null');if(p&&typeof p.projectId==='string'&&typeof p.panelId==='string'&&typeof p.sha256==='string'&&['#generate-panel','#panels'].includes(p.route))pending=p;}catch{}
 const save=()=>{try{if(pending)storage?.setItem(key,JSON.stringify(pending));else storage?.removeItem(key);}catch{}};
 return {
  watch(projectId,job,route,eligible=true){pending={projectId,panelId:job.id,sha256:job.sha256,route,autoOpen:eligible&&['#generate-panel','#panels'].includes(route)};save();},
  leave(route){if(pending&&route!==pending.route){pending.autoOpen=false;save();}},
  editing(){if(pending){pending.autoOpen=false;save();}},
  observe(projects,route,modal=false){
   if(!pending)return null;this.leave(route);
   const p=projects.find(p=>p.id===pending.projectId),job=p?.panels?.find(j=>j.id===pending.panelId);
   if(!job)return null;
   if(job.deletedAt||job.sha256!==pending.sha256||['needs-input','failed-no-retry','interrupted-no-retry','invalid'].includes(job.status)){pending=null;save();return null;}
   if(job.status!=='ready'||!job.artifact?.id||modal)return null;
   const result={artifactId:job.artifact.id,name:p.name,autoOpen:pending.autoOpen===true&&route===pending.route};pending=null;save();return result;
  }
 };
}
