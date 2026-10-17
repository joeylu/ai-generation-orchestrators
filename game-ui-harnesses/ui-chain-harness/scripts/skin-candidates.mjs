import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {join,resolve,relative,dirname,isAbsolute,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs,promisify} from 'node:util';
import {execFile,spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {hash,json,readSafe} from '../src/skins/package.mjs';
import {inventory} from '../src/skins/workflow.mjs';
import {validateCandidateConfig,buildCandidate} from '../src/skins/candidate-pipeline.mjs';
const root=fileURLToPath(new URL('../',import.meta.url)),exec=promisify(execFile);
const {positionals,values:v}=parseArgs({allowPositionals:true,options:{config:{type:'string',default:'configs/skin-candidate-pipeline.json'},directory:{type:'string'},port:{type:'string'}}});
const rel=p=>relative(root,p).replaceAll('\\','/');
const local=(p,base=root)=>{if(!p)throw Error('pipeline.path-required');const q=resolve(root,p),r=relative(base,q);if(isAbsolute(r)||r==='..'||r.startsWith('..'+sep))throw Error('pipeline.path');return q;};
const work=p=>local(p,join(root,'work'));
async function identity(){const files=[];for(const dir of ['src','scripts','configs','schemas','tests/runtime','fixtures','tools/panel-slicer/src'])for(const f of await inventory(join(root,dir)))files.push({...f,file:dir+'/'+f.file});files.push({file:'package-lock.json',sha256:hash(await readFile(join(root,'package-lock.json')))});return hash(Buffer.from(json(files)));}
let directory,report,active;
try{
  const action=positionals[0];if(positionals.length!==1||!['build','status','preview'].includes(action))throw Error('Use skins:candidates build [--config configs/...json] | status|preview --directory work/skin-candidates/<id> [--port 4196]');
  if(action!=='build'){
    directory=work(v.directory);const bytes=await readSafe(directory,'run.json'),state=JSON.parse(bytes);
    for(const f of state.evidence??[])if(hash(await readSafe(root,f.file))!==f.sha256)throw Error('pipeline.evidence-changed');
    if(action==='status'){console.log(json(state));}
    else{
      if(state.status!=='awaiting-visual-review'||!state.preview)throw Error('pipeline.not-previewable');
      const port=Number(v.port??state.port);if(!Number.isInteger(port)||port<1024||port>65535)throw Error('pipeline.port');
      const child=spawn(process.execPath,[join(root,'scripts/localization-trial-preview.mjs'),'--runs',work(state.preview),'--port',String(port)],{cwd:root,windowsHide:true,stdio:'inherit'});
      const code=await new Promise((yes,no)=>{child.on('error',no);child.on('exit',yes);});process.exitCode=code??1;
    }
  }else{
    const configBytes=await readFile(local(v.config)),config=validateCandidateConfig(JSON.parse(configBytes));
    directory=join(root,'work/skin-candidates',randomUUID());await mkdir(directory,{recursive:true});
    report={kind:'ui_skin_candidate_pipeline',version:'1.0',status:'running',port:config.port,stages:[],skins:[],evidence:[],productionReady:false,visualAcceptance:'unreviewed',generation:'not-invoked'};
    await writeFile(join(directory,'started.json'),json({status:'started',configSha256:hash(configBytes)}),{flag:'wx'});
    await writeFile(join(directory,'config.json'),configBytes,{flag:'wx'});
    const inputs=[];
    for(const s of config.skins)for(const key of ['input',s.profile?'profile':'baseline']){
      const path=work(s[key]),raw=await readFile(path),doc=JSON.parse(raw);inputs.push({file:rel(path),sha256:hash(raw)});
      const refs=key==='input'?doc.sheets:key==='baseline'?Object.values(doc.parts):[];
      for(const f of refs){const bytes=await readSafe(dirname(path),f.file);if(hash(bytes)!==f.sha256)throw Error('pipeline.source-digest');inputs.push({file:rel(join(dirname(path),f.file)),sha256:f.sha256});}
    }
    const toolSha256=await identity();
    await writeFile(join(directory,'request.json'),json({configSha256:hash(configBytes),toolSha256,inputs}),{flag:'wx'});
    const unchanged=async()=>{for(const f of inputs)if(hash(await readSafe(root,f.file))!==f.sha256)throw Error('pipeline.inputs-changed');if(await identity()!==toolSha256)throw Error('pipeline.tools-changed');};
    const evidence=async path=>{const file=rel(work(path));report.evidence.push({file,sha256:hash(await readSafe(root,file))});};
    for(const skin of config.skins){
      const result=await buildCandidate(skin,async(stage,script,args)=>{
        active={skin:skin.id,stage};await unchanged();
        const label=skin.id+'-'+stage;
        await writeFile(join(directory,label+'-started.json'),json(active),{flag:'wx'});
        const output=await exec(process.execPath,[join(root,'scripts',script),...args],{cwd:root,windowsHide:true,maxBuffer:8*1024*1024,timeout:300000});
        const parsed=JSON.parse(output.stdout);await unchanged();
        await writeFile(join(directory,label+'-result.json'),json(parsed),{flag:'wx'});
        report.stages.push({...active,status:'passed',result:rel(join(directory,label+'-result.json'))});
        return parsed;
      });
      for(const key of ['location','trial','assembly','directory','consumer'])result[key]=rel(work(result[key]));
      report.skins.push(result);
      for(const path of [result.location+'/report.json',result.trial+'/assembly.json',result.trial+'/trial.json',result.assembly,result.assembly+'.insets.json',result.directory+'/run.json',result.directory+'/evidence/checks.json',result.consumer+'/manifest.json'])await evidence(path);
    }
    await unchanged();
    const preview='preview-runs.json';await writeFile(join(directory,preview),json(report.skins.map(({id,label,directory})=>({id,label,directory}))),{flag:'wx'});
    report.preview=rel(join(directory,preview));await evidence(report.preview);report.status='awaiting-visual-review';
    await writeFile(join(directory,'run.json'),json(report),{flag:'wx'});
    console.log(json({directory:rel(directory),status:report.status,skins:report.skins.map(s=>s.id),previewCommand:'npm run skins:candidates -- preview --directory '+rel(directory)}));
  }
}catch(e){
  if(directory&&report){report.status='failed';report.failure={...active,code:typeof e.code==='string'?e.code:e.message};
    if(e.stderr)await writeFile(join(directory,'failure-stderr.log'),e.stderr,{flag:'wx'});
    await writeFile(join(directory,'run.json'),json(report),{flag:'wx'});
  }
  console.error(json({status:'failed',directory:directory?rel(directory):null,stage:active??null,message:e.code?'Child command failed; see retained failure log.':e.message}));process.exitCode=1;
}
