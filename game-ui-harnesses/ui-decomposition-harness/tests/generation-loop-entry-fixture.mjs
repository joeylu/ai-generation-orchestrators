/** Run the exact exported entry with only provider/file-tool test doubles. */
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync,mkdirSync,realpathSync} from 'node:fs';
import {dirname,join} from 'node:path';
const [script,raw,output]=process.argv.slice(2).map(path=>realpathSync(path));
let calls=0;
const tools={
  exec_command:async ({cmd})=>{
    try{return {exit_code:0,output:execFileSync('powershell',['-NoProfile','-NonInteractive','-Command',cmd],{encoding:'utf8',maxBuffer:8*1024*1024})};}
    catch(error){return {exit_code:error.status,output:String(error.stdout)};}
  },
  apply_patch:async patch=>{
    const match=patch.match(/^\*\*\* Begin Patch\n\*\*\* Add File: ([^\n]+)\n\+([^\n]*)\n\*\*\* End Patch$/);
    if(!match)throw Error('fixture patch format');
    mkdirSync(dirname(match[1]),{recursive:true});writeFileSync(match[1],match[2]+'\n',{flag:'wx'});return {};
  },
  image_gen__imagegen:async()=>{calls++;return {image_url:'data:image/png;base64,'+readFileSync(raw).toString('base64'),output_hint:`Fixture saved as ${raw} by default.`};}
};
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
const result=await new AsyncFunction('tools','notify','generatedImage','setTimeout','clearTimeout',readFileSync(script,'utf8'))(tools,()=>{},()=>{},setTimeout,clearTimeout);
writeFileSync(join(output,'entry-result.json'),JSON.stringify({result,simulatedCalls:calls,providerCalls:0}),{flag:'wx'});
