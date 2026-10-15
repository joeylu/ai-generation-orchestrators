import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {join,resolve,relative,isAbsolute,sep,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {parseArgs,promisify} from 'node:util';
import {execFile} from 'node:child_process';
import {readSafe,hash,json} from '../src/skins/package.mjs';
import {inventory,workflowStatus,continueWorkflow} from '../src/skins/workflow.mjs';
import {inspectAssembly} from '../src/skins/postprocess.mjs';
import {readContracts} from '../src/contracts/validate.mjs';
import {defaults} from '../src/contracts/build.mjs';
const root=fileURLToPath(new URL('../',import.meta.url)),run=promisify(execFile);
const {positionals,values:v}=parseArgs({allowPositionals:true,options:{config:{type:'string'},directory:{type:'string'},until:{type:'string'}}});
const local=p=>{const q=resolve(root,p),r=relative(join(root,'work'),q);if(isAbsolute(r)||r==='..'||r.startsWith('..'+sep))throw Error('workflow.work-path-required');return q;};
const portable=p=>relative(root,p).replaceAll('\\','/');
const summary=s=>({...s,stages:s.stages.map(({stage,status,outputs})=>({stage,status,outputs}))});
async function identity(){const files=[];for(const dir of ['src','scripts','schemas','configs','tests/runtime','tools/panel-slicer/src'])for(const f of await inventory(join(root,dir)))files.push({...f,file:dir+'/'+f.file});for(const f of ['package.json','package-lock.json'])files.push({file:f,sha256:hash(await readFile(join(root,f)))});return hash(Buffer.from(json(files)));}
let directory;
try{
  const action=positionals[0];if(positionals.length!==1||!['create','resume','status'].includes(action))throw Error('Use skins:workflow create --config work/.../assembly.json | resume --directory work/... [--until inspect|assemble|consumer|check] | status --directory work/...');
  if(action==='create'){
    const input=local(v.config),bytes=await readFile(input),config=JSON.parse(bytes),id=randomUUID();directory=join(root,'work/skin-workflow',id);await mkdir(join(directory,'input'),{recursive:true});await mkdir(join(directory,'receipts'));
    for(const file of new Set(Object.values(config.parts).map(p=>p.file))){const b=await readSafe(dirname(input),file);await mkdir(dirname(join(directory,'input',file)),{recursive:true});await writeFile(join(directory,'input',file),b,{flag:'wx'});}
    await writeFile(join(directory,'input/assembly.json'),bytes,{flag:'wx'});
    await inspectAssembly(join(directory,'input/assembly.json'),await readContracts(defaults));
    const inputs=(await inventory(join(directory,'input'))).map(f=>({...f,file:'input/'+f.file}));
    await writeFile(join(directory,'request.json'),json({kind:'ui_skin_workflow_request',version:'1.0',id,mode:'existing-assets',assembly:'input/assembly.json',toolSha256:await identity(),inputs}),{flag:'wx'});
    console.log(json({directory:portable(directory),...summary(await workflowStatus(directory))}));
  }else{
    directory=local(v.directory);
    if(action==='status'){const status=await workflowStatus(directory),request=JSON.parse(await readSafe(directory,'request.json'));console.log(json({directory:portable(directory),...summary(status),toolsMatch:request.toolSha256===await identity()}));}
    else{
      const rel=p=>relative(directory,p).replaceAll('\\','/');
      const command=async(name,args)=> (await run(process.execPath,[join(root,'scripts',name),...args],{cwd:root,windowsHide:true,maxBuffer:8*1024*1024,timeout:240000})).stdout.trim();
      const toolSha256=await identity();
      const result=await continueWorkflow(directory,{toolSha256,assertTools:async()=>{if(await identity()!==toolSha256)throw Error('workflow.tools-changed');},until:v.until,execute:async(stage,out,stages)=>{
        const output=s=>stages.find(r=>r.stage===s).outputs;
        if(stage==='inspect'){const report=await inspectAssembly(join(directory,'input/assembly.json'),await readContracts(defaults));await writeFile(join(out,'inspection.json'),json(report));return{inspection:rel(join(out,'inspection.json'))};}
        if(stage==='assemble'){const result=JSON.parse(await command('skin-assemble.mjs',['--config',join(directory,'input/assembly.json'),'--out',out]));return{pack:rel(join(result.directory,'pack'))};}
        if(stage==='consumer'){const consumer=await command('consumer-pack.mjs',['--package',join(directory,output('assemble').pack),'--out',out]);return{consumer:rel(consumer)};}
        const result=JSON.parse(await command('consumer-check.mjs',[join(directory,output('consumer').consumer)]));if(result.status!=='passed')throw Error('workflow.check-failed');
        for(const name of ['checks.json','wide.png','tall.png'])await writeFile(join(out,name),await readSafe(result.directory,name),{flag:'wx'});
        return{checks:rel(join(out,'checks.json')),wide:rel(join(out,'wide.png')),tall:rel(join(out,'tall.png'))};
      }});
      // Status is a query result, not an editable success/delivery manifest.
      console.log(json({directory:portable(directory),...summary(result)}));
    }
  }
}catch(e){console.error(json({status:'failed',directory:directory?portable(directory):null,code:typeof e.code==='string'?e.code:'workflow.failed',message:e.code?'Stage failed; retained attempts and receipts.':e.message}));process.exitCode=1;}
