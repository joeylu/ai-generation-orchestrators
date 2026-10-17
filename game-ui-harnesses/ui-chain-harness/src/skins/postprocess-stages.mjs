import {mkdir,writeFile} from 'node:fs/promises';
import {join,resolve,relative,isAbsolute,sep} from 'node:path';
import {randomUUID} from 'node:crypto';
import {hash,json,readSafe,noLinks} from './package.mjs';
import {inventory} from './workflow.mjs';
import {inspectAssembly} from './postprocess.mjs';
import {readContracts} from '../contracts/validate.mjs';
import {defaults} from '../contracts/build.mjs';
import {buildMaterialAtlasPackage} from './material-atlas-input.mjs';

// Each directory becomes immutable only when the owning DAG receipt is published.
// Later stages write elsewhere, so their failure cannot invalidate earlier receipts.
export async function executePostprocessStage({root,node,prior,request,command}){
 const local=value=>{const p=resolve(root,value),r=relative(join(root,'work'),p);if(!r||isAbsolute(r)||r==='..'||r.startsWith('..'+sep))throw Error('postprocess.work-path');return p;};
 const rel=p=>relative(root,p).replaceAll('\\','/');
 const directory=local(join(root,'work/skin-postprocess',randomUUID()));await noLinks(directory);await mkdir(directory,{recursive:true});
 let result;
 if(node.kind==='assemble'){
  const config=local(prior['content-insets'].assembly),inspection=await inspectAssembly(config,await readContracts(defaults));
  await writeFile(join(directory,'inspection.json'),json(inspection),{flag:'wx'});
  const rows=inspection.sheets.flatMap(s=>s.parts.map(p=>`| ${s.sheetId} | ${p.assetId} | ${p.suggestion.status} | ${p.warnings.join(' ')||'核对实际显示'} |`));
  await writeFile(join(directory,'review.md'),'# 四板后处理核对\n\n详情见 inspection.json；程序检查不代表视觉接受。\n\n| 图集 | 部件 | 自动建议 | 核对事项 |\n| --- | --- | --- | --- |\n'+rows.join('\n')+'\n',{flag:'wx'});
  const assembled=await command('skin-assemble.mjs',['--config',config,'--out',join(directory,'assembled')]);
  if(hash(await readSafe(local(assembled.assemblyDirectory),'assembly-input.json'))!==inspection.inputSha256)throw Error('postprocess.assembly-changed');
  result={assets:inspection.assets,packageDirectory:join(local(assembled.directory),'pack'),stages:[{stage:'inspect',status:'passed',inputSha256:inspection.inputSha256},{stage:'assemble',status:'passed',result:assembled}]};
 }else if(node.kind==='materials'){
  const previous=prior.assemble;result={assets:previous.assets,packageDirectory:previous.packageDirectory,stages:[...previous.stages]};
  if(request.materialAtlas){const material=await buildMaterialAtlasPackage({packageDirectory:local(previous.packageDirectory),inputPath:local(request.materialAtlas),output:join(directory,'materials')});result.packageDirectory=material.packageDirectory;result.stages.push({stage:'material-extract-and-bind',status:'passed',...material});}
 }else if(node.kind==='consumer'){
  const previous=prior['material-bind'],consumer=await command('consumer-pack.mjs',['--package',local(previous.packageDirectory),'--out',join(directory,'consumer')],true);
  local(consumer);result={assets:previous.assets,consumerDirectory:consumer,stages:[...previous.stages,{stage:'consumer-build',status:'passed',directory:consumer}]};
 }else if(node.kind==='postprocess'){
  const previous=prior['consumer-build'],consumer=local(previous.consumerDirectory),checked=await command('consumer-check.mjs',[consumer]);
  if(checked.status!=='passed')throw Error('task.check-failed');
  // The checker deliberately relocates the package outside work/ to verify portability.
  await mkdir(join(directory,'evidence'));for(const file of ['checks.json','wide.png','tall.png'])await writeFile(join(directory,'evidence',file),await readSafe(checked.directory,file),{flag:'wx'});
  const report={kind:'ui_skin_postprocess_run',version:'1.0',action:'build',status:'checked-candidate',stages:[...previous.stages,{stage:'consumer-check',status:'passed',checks:checked.checks}],consumerDirectory:consumer,productionReady:false};
  // Keep the established final report and evidence paths consumed by Studio.
  await writeFile(join(directory,'inspection.json'),await readSafe(local(prior.assemble.directory),'inspection.json'),{flag:'wx'});
  await writeFile(join(directory,'review.md'),await readSafe(local(prior.assemble.directory),'review.md'),{flag:'wx'});
  await writeFile(join(directory,'run.json'),json(report),{flag:'wx'});
  result={status:'checked-candidate',assets:previous.assets,consumerDirectory:consumer,selected:false};
 }else throw Error('postprocess.unknown-stage');
 await writeFile(join(directory,'stage-result.json'),json(result),{flag:'wx'});
 return {outputs:{...result,directory:rel(directory)},files:(await inventory(directory)).map(f=>({...f,file:rel(join(directory,f.file))}))};
}
