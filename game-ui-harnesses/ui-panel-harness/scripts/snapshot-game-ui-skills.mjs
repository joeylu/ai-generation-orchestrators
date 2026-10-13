/** Read-only upstream/local source capture. Never installs or executes a skill. */
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createOutputDirectory,writeNewJson} from '../src/io.mjs';
import {digestBytes} from '../src/canonical.mjs';
import {execFileSync} from 'node:child_process';
const args=process.argv.slice(2);assert(args.length===4&&args[0]==='--output'&&args[2]==='--ui-ux-root');
const output=await createOutputDirectory(args[1]),files=[];
const get=async url=>{
  assert(/^https:\/\/(?:api\.github\.com|raw\.githubusercontent\.com)\/[A-Za-z0-9_./?=-]+$/.test(url));
  if(process.platform==='win32'){
    // Use the configured Windows HTTP stack; Node TLS may not inherit its proxy.
    const command=`$ErrorActionPreference='Stop'; $r = Invoke-WebRequest -UseBasicParsing -Uri '${url}' -Headers @{ 'User-Agent'='ui-panel-harness-source-review' } -TimeoutSec 30; [Convert]::ToBase64String($r.RawContentStream.ToArray())`;
    return new Uint8Array(Buffer.from(execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',command],{encoding:'utf8',timeout:40000,maxBuffer:2*1024*1024}).trim(),'base64'));
  }
  const response=await fetch(url,{headers:{'User-Agent':'ui-panel-harness-source-review'},signal:AbortSignal.timeout(30000)});assert(response.ok,'SOURCE_HTTP_'+response.status);return new Uint8Array(await response.arrayBuffer());
};
async function save(name,bytes,origin){await writeFile(join(output,name),bytes,{flag:'wx'});files.push({name,bytes:bytes.length,sha256:await digestBytes(bytes),...origin});}
for(const source of [
  {id:'game-ui-design',repo:'jeremylongworth-source/AgentSkills',paths:['skills/game-ui-design/SKILL.md','skills/game-ui-design/references/game-ui-checklist.md','LICENSE']},
  {id:'game-ui-ux',repo:'gamedev-skills/awesome-gamedev-agent-skills',paths:['skills/disciplines/game-ui-ux/SKILL.md','skills/disciplines/game-ui-ux/references/layout-and-flow.md','LICENSE','NOTICE']},
]){
  const commit=JSON.parse(new TextDecoder().decode(await get('https://api.github.com/repos/'+source.repo+'/commits/main'))).sha;
  assert(/^[a-f0-9]{40}$/.test(commit));
  for(const path of source.paths){const url=`https://api.github.com/repos/${source.repo}/contents/${path}?ref=${commit}`;
    const content=JSON.parse(new TextDecoder().decode(await get(url)));assert.equal(content.encoding,'base64');
    await save(source.id+'--'+path.replaceAll('/','__'),new Uint8Array(Buffer.from(content.content,'base64')),{id:source.id,repo:source.repo,commit,path,url,gitBlobSha:content.sha});}
}
for(const path of ['SKILL.md','references/quick-reference.md','references/pro-rules.md'])await save('ui-ux-pro-max--'+path.replaceAll('/','__'),await readFile(resolve(args[3],path)),{id:'ui-ux-pro-max',origin:'installed-local-snapshot',path});
await writeNewJson(output,'sources.json',{version:'0.1',status:'SNAPSHOTTED_NOT_INSTALLED',files,realModelCalls:0});
console.log(JSON.stringify({status:'SNAPSHOTTED',files:files.length,realModelCalls:0}));
