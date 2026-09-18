/** Local bridge entry point. Payloads arrive as files, never shell arguments. */
import {readFileSync,mkdirSync,openSync,writeFileSync,fsyncSync,closeSync} from 'node:fs';
import {join} from 'node:path';
import {verifyBuiltinResult} from './generation-loop-node.mjs';
const [action,directory,input]=process.argv.slice(2);
if(action==='init') {
  mkdirSync(directory);
  console.log(JSON.stringify({ready:true}));
} else if(action==='persist') {
  const event=JSON.parse(readFileSync(input,'utf8'));
  const name=input.replaceAll('\\','/').split('/').at(-1);
  if(!/^\d{4}\.json$/.test(name)) throw new Error('BRIDGE_EVENT_NAME');
  const fd=openSync(join(directory,name),'wx');
  try {writeFileSync(fd,JSON.stringify(event));fsyncSync(fd);} finally {closeSync(fd);}
  console.log(JSON.stringify({persisted:true}));
} else if(action==='resolve') {
  const payload=JSON.parse(readFileSync(input,'utf8'));
  const event=payload.kind==='ui_generation_loop_events_v1'?payload.events.at(-1):payload;
  if(event?.event!=='tool-returned') throw new Error('BRIDGE_RESPONSE_EVENT_REQUIRED');
  console.log(JSON.stringify({source:verifyBuiltinResult(event.response,directory)}));
} else throw new Error('BRIDGE_ACTION');
