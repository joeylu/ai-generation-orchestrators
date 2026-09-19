/** Local bridge entry point. Payloads arrive as files, never shell arguments. */
import {readFileSync,mkdirSync,openSync,writeFileSync,fsyncSync,closeSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {verifyBuiltinResult} from './generation-loop-node.mjs';
const [action,directory,input,rootMode='direct']=process.argv.slice(2);
if(action==='init') {
  mkdirSync(directory);
  console.log(JSON.stringify({ready:true}));
} else if(action==='persist') {
  const event=JSON.parse(readFileSync(input,'utf8'));
  const name=input.replaceAll('\\','/').split('/').at(-1);
  if(!/^\d{4}\.json$/.test(name)) throw new Error('BRIDGE_EVENT_NAME');
  const fd=openSync(join(directory,name),'wx');
  try {writeFileSync(fd,JSON.stringify(event));fsyncSync(fd);} finally {closeSync(fd);}
  // A compact discoverable handoff, derived only after the full journal is durable.
  // It is a notification, not a replacement for official batch/receipt validation.
  const last=event.kind==='ui_generation_loop_events_v1'?event.events.at(-1):event;
  if(last?.event==='execution-summary') {
    const report=last.report;
    if(report?.kind!=='ui_generation_loop_execution_v1'||!report.result?.status)
      throw new Error('BRIDGE_COMPLETION_REPORT');
    const status=report.result.status;
    const completion={kind:'ui_generation_loop_completion_v1',journal:name,
      journalSha256:createHash('sha256').update(readFileSync(join(directory,name))).digest('hex'),
      status:status.status,nextNode:status.nextNode,planDigest:status.planDigest,
      jobDigest:status.jobDigest,assignedCalls:status.assignedCalls,
      startedAt:report.startedAt,finishedAt:report.finishedAt,elapsedMs:report.elapsedMs,
      generationMs:report.timings.filter(t=>t.phase==='generation').reduce((n,t)=>n+t.ms,0),
      automaticRetries:report.automaticRetries,requiresOfficialStatusCheck:true};
    const summaryFd=openSync(join(dirname(directory),'completion.json'),'wx');
    try {writeFileSync(summaryFd,JSON.stringify(completion));fsyncSync(summaryFd);} finally {closeSync(summaryFd);}
  }
  console.log(JSON.stringify({persisted:true}));
} else if(action==='resolve') {
  const payload=JSON.parse(readFileSync(input,'utf8'));
  const event=payload.kind==='ui_generation_loop_events_v1'?payload.events.at(-1):payload;
  if(event?.event!=='tool-returned') throw new Error('BRIDGE_RESPONSE_EVENT_REQUIRED');
  console.log(JSON.stringify({source:verifyBuiltinResult(event.response,directory,rootMode),requestDigest:event.requestDigest,
    responseSha256:createHash('sha256').update(readFileSync(input)).digest('hex')}));
} else throw new Error('BRIDGE_ACTION');
