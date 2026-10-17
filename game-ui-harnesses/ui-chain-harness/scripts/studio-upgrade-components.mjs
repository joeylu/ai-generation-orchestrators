// Explicit, deterministic runtime rebuild from a verified completed skin.
// No generation, slicing, automatic retry, or alteration of old delivery files.
import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import {resolve,join,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs,promisify} from 'node:util';
import {execFile} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {readSafe,hash,json,verifySkinPackage} from '../src/skins/package.mjs';
import {inspectConsumer} from '../src/runtime/consumer-tools.mjs';
import {taskStatus} from '../src/skins/task-dag.mjs';
import {acquireLocalLock} from '../src/skins/local-lock.mjs';
import {upgradedConsumer,frozenUpgradeContracts} from '../src/studio/component-upgrade.mjs';
import {readContracts} from '../src/contracts/validate.mjs';
import {defaults} from '../src/contracts/build.mjs';
import {bindingsOf} from '../src/skins/package.mjs';
import {extendSkinMaterials} from '../src/skins/materials.mjs';

const {values}=parseArgs({options:{project:{type:'string'},materials:{type:'string'}}});
if(!values.project)throw Error('Use --project <work/studio/projects/UUID>');
const root=fileURLToPath(new URL('../',import.meta.url)),dir=resolve(values.project),rel=p=>relative(root,p).replaceAll('\\','/');
const workDirectory=p=>{if(typeof p!=='string')throw Error('UPGRADE_WORK_PATH');const path=resolve(root,p);if(!/^work\/[A-Za-z0-9_/-]+$/.test(rel(path)))throw Error('UPGRADE_WORK_PATH');return path;};
if(!/^work\/studio\/projects\/[a-f0-9-]{36}$/.test(rel(dir)))throw Error('UPGRADE_PROJECT_PATH');
const exec=promisify(execFile),release=await acquireLocalLock(dir,'.processing.lock');
const command=async(name,args)=>(await exec(process.execPath,[join(root,'scripts',name),...args],{cwd:root,windowsHide:true,maxBuffer:8*1024*1024,timeout:900000})).stdout.trim();
try{
  const originalFlow=await readSafe(dir,'flow.json'),flow=JSON.parse(originalFlow);
  if(!['components-ready','processing-failed'].includes(flow.phase)||flow.panels?.some(p=>p.status==='running'))throw Error('UPGRADE_PROJECT_NOT_IDLE');
  const task=await taskStatus(workDirectory(flow.taskDirectory),async files=>{for(const f of files)if(hash(await readSafe(root,f.file))!==f.sha256)throw Error('UPGRADE_SOURCE_CHANGED');});
  if(task.status!=='awaiting-visual-review')throw Error('UPGRADE_TASK_NOT_READY');
  const output=task.nodes.find(n=>n.id==='postprocess').outputs;
  const run=JSON.parse(await readSafe(workDirectory(output.directory),'run.json'));
  if(run.status!=='checked-candidate')throw Error('UPGRADE_CONSUMER_NOT_CHECKED');
  const originalDirectory=workDirectory(run.consumerDirectory),original=await inspectConsumer(originalDirectory);
  const skin=await verifySkinPackage(join(originalDirectory,'skin'));
  const currentBindings=bindingsOf(await readContracts(defaults));
  const contractArgs=Object.keys(currentBindings).some(k=>currentBindings[k]!==skin.pack.bindings[k])
    ?Object.entries(frozenUpgradeContracts(task.request.inputs,skin.pack.bindings)).flatMap(([key,file])=>['--'+key,resolve(root,file)]):[];
  const revision=join(root,'work/component-upgrades',randomUUID());await mkdir(revision,{recursive:true});
  const material=values.materials?await extendSkinMaterials({packageDirectory:join(originalDirectory,'skin'),configPath:resolve(values.materials),output:join(revision,'materials')}):null;
  const target=(await command('consumer-pack.mjs',['--package',material?.packageDirectory??join(originalDirectory,'skin'),'--out',join(revision,'consumer'),...contractArgs])).split(/\r?\n/).at(-1);
  const consumer=await inspectConsumer(target);
  const check=JSON.parse(await command('consumer-check.mjs',[target]));
  const checkFile=join(revision,'checks.json'),checkBytes=await readSafe(check.directory,'checks.json');await writeFile(checkFile,checkBytes,{flag:'wx'});
  for(const name of ['wide.png','tall.png','text-colors.json'])await writeFile(join(revision,name),await readSafe(check.directory,name),{flag:'wx'});
  const materialFile=material?join(revision,'materials/report.json'):null;
  const record={kind:'ui_component_runtime_upgrade',version:'1.0',sourceConsumerSha256:original.manifestSha256,skinSha256:material?.manifestSha256??skin.manifestSha256,...(material?{originalSkinSha256:skin.manifestSha256,materialExtension:{file:rel(materialFile),sha256:hash(await readFile(materialFile))}}:{}),consumerSha256:consumer.manifestSha256,directory:rel(target),checkFile:rel(checkFile),checkSha256:hash(checkBytes),previous:flow.componentRuntime??null,modelCalls:0,productionReady:false,visualAcceptance:'unreviewed'};
  const recordFile=join(revision,'upgrade.json'),recordBytes=Buffer.from(json(record));await writeFile(recordFile,recordBytes,{flag:'wx'});
  const selection={file:rel(recordFile),sha256:hash(recordBytes)};
  await upgradedConsumer(root,originalDirectory,selection);
  if(hash(await readFile(join(dir,'flow.json')))!==hash(originalFlow))throw Error('UPGRADE_FLOW_CHANGED');
  flow.phase='components-ready';flow.message='16 类组件已完成程序检查，等待外观验收';delete flow.errorCode;if(flow.localRecovery)flow.localRecovery.failure=null;
  flow.componentRuntime=selection;const temp=join(dir,'.flow-'+randomUUID()+'.json');await writeFile(temp,json(flow),{flag:'wx'});await rename(temp,join(dir,'flow.json'));
  console.log(json({status:'checked-candidate',directory:rel(revision),consumer:rel(target),checks:check.checks,skinSha256:record.skinSha256,consumerSha256:consumer.manifestSha256,modelCalls:0}));
}finally{await release();}
