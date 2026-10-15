import {join} from 'node:path';
import {readSafe,hash} from '../skins/package.mjs';
import {taskStatus} from '../skins/task-dag.mjs';
import {taskToolIdentity} from '../skins/task-tools.mjs';
import {consumerServer} from '../runtime/consumer-tools.mjs';
import {localFailure} from './local-recovery.mjs';
export function validateTasks(entries=[]){
 if(!Array.isArray(entries)||entries.length>30)throw Error('STUDIO_TASKS_INVALID');
 const ids=new Set();
 for(const e of entries){if(!/^[a-z][a-z0-9-]{0,48}$/.test(e.id)||ids.has(e.id)||typeof e.name!=='string'||e.name.length>100||!/^work\/skin-tasks\/[a-zA-Z0-9_-]+$/.test(e.directory))throw Error('STUDIO_TASK_INVALID');ids.add(e.id);}
 return entries;
}
export async function inspectStudioTasks(root,entries,identity=taskToolIdentity){
 validateTasks(entries);const toolSha256=entries.length?await identity(root):null;
 return Promise.all(entries.map(async entry=>{
  const base={id:entry.id,name:entry.name};
  try{
   const state=await taskStatus(join(root,entry.directory),async files=>{for(const f of files){if(!f.file.startsWith('work/')||hash(await readSafe(root,f.file))!==f.sha256)throw Error('STUDIO_TASK_ARTIFACT_CHANGED');}});
   const toolsMatch=state.request.toolSha256===toolSha256;
   const fingerprint=hash(Buffer.from(JSON.stringify({request:state.requestSha256,toolSha256,nodes:state.nodes,attempts:state.attempts})));
   return {...base,fingerprint,status:state.status,toolsMatch,nodes:state.nodes.map(n=>({id:n.id,kind:state.request.graph.nodes.find(g=>g.id===n.id)?.kind,status:n.status})),attempts:state.attempts.map(a=>({node:a.node,status:a.status,...(a.failure?{failure:localFailure(a.failure)}:{})})),
    recovery:state.status==='awaiting-visual-review'?'complete':!toolsMatch?'tools-changed':'available',productionReady:false};
  }catch{return {...base,status:'invalid',nodes:[],attempts:[],recovery:'blocked',message:'任务记录或引用产物校验失败，请检查本地原始记录。'};}
 }));
}
export function studioServer(snapshot,port,readTasks,recover,prepare,generation,history,pipeline,library){
 const server=consumerServer(snapshot,port,{allowFrames:true}),serve=server.listeners('request')[0];server.removeAllListeners('request');
 let pending;
 server.on('request',async(req,res)=>{
  if(req.url==='/library.json'){
   if(!library||req.headers.host!==`127.0.0.1:${port}`||!['GET','HEAD'].includes(req.method)){res.writeHead(404);res.end();return;}
   try{const value=await library();res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(req.method==='HEAD'?undefined:JSON.stringify(value));}catch{res.writeHead(503);res.end();}return;
  }
  if(req.url?.startsWith('/pipeline/')){
   const reply=(status,value)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
   const action=req.url.slice('/pipeline/'.length);
   if(!pipeline||!['status','process','panel-prepare','panel-start','panel-delete','panel-restore','panel-motion','component-motion'].includes(action)||req.method!=='POST'||req.headers.host!==`127.0.0.1:${port}`||req.headers.origin!==`http://127.0.0.1:${port}`||req.headers['content-type']!=='application/json')return reply(403,{message:'请求来源或格式不符合要求'});
   try{const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>20000)return reply(413,{message:'请求过大'});chunks.push(chunk);}return reply(200,await pipeline.action(action,JSON.parse(Buffer.concat(chunks).toString('utf8'))));}
   catch(e){return reply(409,{message:['panel-motion','component-motion'].includes(action)?'动效未能保存，请刷新面板后再试。':'操作未完成，请刷新项目状态。已提交的模型不会自动重试。',code:/^[A-Z0-9_-]+$/.test(e.message)?e.message:'PIPELINE_FAILED'});}
  }
  if(req.url==='/plans.json'){
   if(!history||req.headers.host!==`127.0.0.1:${port}`||!['GET','HEAD'].includes(req.method)){res.writeHead(404);res.end();return;}
   try{const data=await history();res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(req.method==='HEAD'?undefined:JSON.stringify(data));}catch{res.writeHead(503);res.end();}return;
  }
  if(req.url?.startsWith('/generation/')){
   const reply=(status,value)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
   const action=req.url.slice('/generation/'.length);
   if(!generation||!['preflight','start','status','recover','supplement-prepare','supplement-start'].includes(action)||req.method!=='POST'||req.headers.host!==`127.0.0.1:${port}`||req.headers.origin!==`http://127.0.0.1:${port}`||req.headers['content-type']!=='application/json')return reply(403,{message:'请求来源或格式不符合要求'});
   try{const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>4096)return reply(413,{message:'请求过大'});chunks.push(chunk);}return reply(200,await generation.action(action,JSON.parse(Buffer.concat(chunks).toString('utf8'))));}
   catch(e){return reply(409,e.message==='GENERATION_UNKNOWN_PLAN'?{code:'GENERATION_STATE_EXPIRED',message:'服务已重启或任务标识已更新，请刷新项目状态后重新操作。本次请求未提交生成。'}:e.message==='GENERATION_RECOVERABLE_IMAGE'?{code:'GENERATION_RECOVERABLE_IMAGE',message:'已找到可核验的历史图片，请先点击“检查并恢复已返回图片（不生成）”。本次未提交生成。'}:{message:'环境、计划或授权检查未通过。请检查状态；没有自动重试。'});}
  }
  if(req.url==='/projects/plan'){
   const reply=(status,value)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
   if(!prepare||req.method!=='POST'||req.headers.host!==`127.0.0.1:${port}`||req.headers.origin!==`http://127.0.0.1:${port}`||req.headers['content-type']!=='application/json')return reply(403,{message:'请求来源或格式不符合要求'});
   try{const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>24*1024*1024)return reply(413,{message:'项目输入过大'});chunks.push(chunk);}return reply(200,await prepare(JSON.parse(Buffer.concat(chunks).toString('utf8'))));}
   catch{return reply(409,{message:'计划未能完成，请检查参考图、模板构建或稍后重试。未提交模型。'});}
  }
  if(req.url==='/tasks/resume'){
   const reply=(status,value)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
   if(!recover||req.method!=='POST'||req.headers.host!==`127.0.0.1:${port}`||req.headers.origin!==`http://127.0.0.1:${port}`||req.headers['content-type']!=='application/json')return reply(403,{message:'请求来源或格式不符合要求'});
   try{
    let body='';for await(const chunk of req){body+=chunk;if(Buffer.byteLength(body)>4096)return reply(413,{message:'请求过大'});}
    const data=JSON.parse(body);
    if(typeof data.id!=='string'||typeof data.token!=='string'||Object.keys(data).some(k=>!['id','token'].includes(k)))throw Error('INVALID');
    const result=await recover(data.id,data.token);return reply(202,result);
   }catch{return reply(409,{message:'任务状态已变化或无法恢复，请刷新任务记录。'});}
  }
  if(req.url!=='/tasks.json')return serve(req,res);
  if(req.headers.host!==`127.0.0.1:${port}`||!['GET','HEAD'].includes(req.method)){res.writeHead(404);res.end();return;}
  try{pending??=readTasks().finally(()=>{pending=null;});const tasks=await pending;
   res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(req.method==='HEAD'?undefined:JSON.stringify({tasks}));
  }catch{res.writeHead(503,{'Content-Type':'application/json'});res.end(JSON.stringify({message:'任务记录暂时无法读取'}));}
 });return server;
}
