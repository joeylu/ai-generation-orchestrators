/** Run the exact exported entry with only provider/file-tool test doubles. */
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync,mkdirSync,realpathSync} from 'node:fs';
import {dirname,join} from 'node:path';
const [script,raw,output]=process.argv.slice(2).map(path=>realpathSync(path));
let calls=0;
let pending;
const tools={
  exec_command:async ({cmd})=>{
    try{
      const output=execFileSync('powershell',['-NoProfile','-NonInteractive','-Command',cmd],{encoding:'utf8',maxBuffer:8*1024*1024});
      const split=Math.floor(output.length/2);
      pending={exit_code:0,output:output.slice(split)};
      return {session_id:123,output:output.slice(0,split)};
    }
    catch(error){return {exit_code:error.status,output:String(error.stdout)};}
  },
  write_stdin:async ({session_id,chars})=>{
    if(session_id!==123||chars!==''||!pending)throw Error('fixture unexpected session poll');
    const result=pending;pending=null;return result;
  },
  apply_patch:async patch=>{
    const match=patch.match(/^\*\*\* Begin Patch\n\*\*\* Add File: ([^\n]+)\n\+([^\n]*)\n\*\*\* End Patch$/);
    if(!match)throw Error('fixture patch format');
    mkdirSync(dirname(match[1]),{recursive:true});writeFileSync(match[1],match[2]+'\n',{flag:'wx'});return {};
  },
  image_gen__imagegen:async()=>{calls++;return {image_url:'data:image/png;base64,'+readFileSync(raw).toString('base64'),output_hint:`Fixture saved as ${raw} by default.`};}
};
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
let completionSeen=false;
const notify=event=>{
  if(event.event==='completion-ready') {
    const summary=JSON.parse(readFileSync(event.completion,'utf8'));
    if(summary.status!==event.status||!summary.requiresOfficialStatusCheck)throw Error('completion mismatch');
    completionSeen=true;
  }
};
const result=await new AsyncFunction('tools','notify','generatedImage','setTimeout','clearTimeout',readFileSync(script,'utf8'))(tools,notify,()=>{},setTimeout,clearTimeout);
if(!completionSeen)throw Error('missing durable completion notification');
writeFileSync(join(output,'entry-result.json'),JSON.stringify({result,simulatedCalls:calls,providerCalls:0}),{flag:'wx'});
