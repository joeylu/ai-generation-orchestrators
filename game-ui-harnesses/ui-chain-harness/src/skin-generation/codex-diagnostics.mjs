import {join} from 'node:path';
import {readSafe} from '../skins/package.mjs';
import {exactRelay} from '../../../ui-reference-harness/web/adapters/codex-relay-contract.mjs';
import {findRelayLog,readRelayWindow,relayOutputs} from '../../../ui-reference-harness/web/adapters/codex-relay-session.mjs';

const connectionFailure=text=>/connection failed:\s*error sending request/i.test(text);
const outputText=output=>typeof output==='string'?output:Array.isArray(output)?output.filter(p=>p?.type==='input_text'&&typeof p.text==='string').map(p=>p.text).join('\n'):'';
const timestamp=value=>typeof value==='string'&&Number.isFinite(Date.parse(value))?value:undefined;

/** Diagnostics never confer success, authorize retries or expose transcript text. */
export function classifyCodexFailure({entries,image,session,outputCount}){
 if(outputCount>0)return {code:'returned-image-needs-check',label:'有图片待核验',detail:'已找到返回图片，请先检查并恢复，避免重复生成。'};
 const imageEvent=image&&entries.find(e=>e.type==='event_msg'&&e.payload?.type==='item_completed'&&e.payload.item?.type==='Extension'&&e.payload.item.kind==='image_gen.generation'&&e.payload.item.id===image.toolUseId);
 const calls=new Set(entries.filter(e=>e.type==='response_item'&&e.payload?.type==='custom_tool_call'&&['exec','functions.exec'].includes(e.payload.name)&&exactRelay(e.payload.input)).map(e=>e.payload.call_id));
 const toolErrors=entries.filter(e=>e.type==='response_item'&&e.payload?.type==='custom_tool_call_output'&&calls.has(e.payload.call_id));
 if(imageEvent?.payload.item.status==='failed'&&toolErrors.some(e=>connectionFailure(outputText(e.payload.output))))return {
  code:'image-request-connection-failed',label:'生图连接失败',
  detail:'生图请求连接失败，未返回图片。请检查网络或代理，稍后仅补本张；不会自动重投。',
  finishedAt:timestamp(imageEvent.timestamp)
 };
 if(imageEvent?.payload.item.status==='failed')return {code:'image-tool-failed',label:'生图未完成',detail:'图像工具报告失败，未返回图片。保留原记录，稍后可仅补本张。',finishedAt:timestamp(imageEvent.timestamp)};
 const end=entries.findLast(e=>e.type==='event_msg'&&e.payload?.type==='task_complete');
 if(connectionFailure(typeof end?.payload.error?.message==='string'?end.payload.error.message:''))return {code:'model-request-connection-failed',label:'模型连接失败',detail:'调用模型时连接失败，未返回图片。请检查网络或代理，稍后仅补本张；不会自动重投。',finishedAt:timestamp(end.timestamp)};
 if(session.exitCode!==0||session.completed!==true||session.failure)return {code:'session-not-completed',label:'调用未完成',detail:'调用会话未完成，未找到返回图片。请检查连接后仅补本张；不会自动重投。',finishedAt:timestamp(end?.timestamp)};
 return {code:'image-output-missing',label:'未返回图片',detail:'调用结束但未找到图片，无法进入拆分。保留原记录，可单独补本张。'};
}

/** Read-only adapter evidence projection; no writes, provider calls or recovery. */
export function codexFailureReader({relayRoot,home}){
 const cache=new Map();
 return async ({planSha256,requestSha256,status,outcomeRecorded})=>{
  if(!['indeterminate','failed'].includes(status)||!outcomeRecorded||!/^[a-f0-9]{64}$/.test(planSha256??'')||!/^[a-f0-9]{64}$/.test(requestSha256??''))return undefined;
  const key=planSha256+requestSha256,prior=cache.get(key);
  if(prior&&Date.now()-prior.at<30000)return prior.value;
  let value;
  try{
   const job=join(relayRoot,planSha256),read=async name=>JSON.parse(await readSafe(job,name));
   const dispatch=await read('dispatch.json'),session=await read('session-result.json');
   if(dispatch.attemptSha256!==planSha256||dispatch.requestSha256!==requestSha256||dispatch.resumingSession!==false||dispatch.automaticResubmissions!==0||session.automaticResubmissions!==0)throw Error('binding');
   let image;try{image=await read('image-call.json');}catch(e){if(e.code!=='ENOENT')throw e;}
   if(image&&(image.attemptSha256!==planSha256||image.requestSha256!==requestSha256||image.sessionId!==session.sessionId))throw Error('binding');
   const entries=readRelayWindow(findRelayLog(home,session.sessionId)),outputs=relayOutputs(home,session.sessionId);
   let outputCount=outputs.size;
   if(!outputCount)try{await readSafe(job,'original-output-1.png');outputCount=1;}catch(e){if(e.code!=='ENOENT')throw e;}
   value=classifyCodexFailure({entries,image,session,outputCount});
  }catch{/* Missing or inconsistent optional diagnostics cannot break project status. */}
  if(cache.size>=128)cache.delete(cache.keys().next().value);
  cache.set(key,{at:Date.now(),value});return value;
 };
}
