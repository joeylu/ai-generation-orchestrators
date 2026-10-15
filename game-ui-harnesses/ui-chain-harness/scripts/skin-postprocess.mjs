import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join,relative,isAbsolute,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs,promisify} from 'node:util';
import {execFile} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {readContracts} from '../src/contracts/validate.mjs';
import {defaults} from '../src/contracts/build.mjs';
import {inspectAssembly} from '../src/skins/postprocess.mjs';
import {hash,json} from '../src/skins/package.mjs';
const root=fileURLToPath(new URL('../',import.meta.url)),run=promisify(execFile);
const {positionals,values:v}=parseArgs({allowPositionals:true,options:{config:{type:'string'},out:{type:'string'}}});
const local=p=>{const q=resolve(root,p),r=relative(join(root,'work'),q);if(isAbsolute(r)||r==='..'||r.startsWith('..'+sep))throw Error('Use a path below work/');return q;};
let dir,report;
try{
  const action=positionals[0];if(!['inspect','build'].includes(action)||positionals.length!==1||!v.config)throw Error('Use: npm run skins:postprocess -- inspect|build --config work/.../assembly.json [--out work/skin-postprocess]');
  const config=local(v.config);dir=join(local(v.out??'work/skin-postprocess'),randomUUID());await mkdir(dir,{recursive:true});
  report={kind:'ui_skin_postprocess_run',version:'1.0',action,status:'running',stages:[],productionReady:false};
  const inspection=await inspectAssembly(config,await readContracts(defaults));
  await writeFile(join(dir,'inspection.json'),json(inspection),{flag:'wx'});
  const rows=inspection.sheets.flatMap(s=>s.parts.map(p=>`| ${s.sheetId} | ${p.assetId} | ${p.suggestion.status} | ${p.warnings.join(' ')||'核对实际显示'} |`));
  await writeFile(join(dir,'review.md'),'# 四板后处理核对\n\n切线分析复用 tools/panel-slicer，建议基于实际交付像素；不会覆盖现有配置，也不代表视觉接受。详情见 inspection.json。\n\n| 图集 | 部件 | 自动建议 | 核对事项 |\n| --- | --- | --- | --- |\n'+rows.join('\n')+'\n');
  report.stages.push({stage:'inspect',status:'passed',inputSha256:inspection.inputSha256});
  const command=async(script,args)=>(await run(process.execPath,[join(root,'scripts',script),...args],{cwd:root,windowsHide:true,maxBuffer:8*1024*1024,timeout:180000})).stdout.trim();
  if(action==='build'){
    if(hash(await readFile(config))!==inspection.inputSha256)throw Error('Assembly config changed after inspection');
    const assembled=JSON.parse(await command('skin-assemble.mjs',['--config',config,'--out',join(dir,'assembled')]));
    const snapshot=await readFile(join(assembled.assemblyDirectory,'assembly-input.json'));
    if(hash(snapshot)!==inspection.inputSha256)throw Error('Assembly input differs from inspection');
    report.stages.push({stage:'assemble',status:'passed',result:assembled});
    const consumer=await command('consumer-pack.mjs',['--package',join(assembled.directory,'pack'),'--out',join(dir,'consumer')]);
    report.stages.push({stage:'consumer-build',status:'passed',directory:consumer});
    const checked=JSON.parse(await command('consumer-check.mjs',[consumer]));
    if(checked.status!=='passed')throw Error('Consumer check did not pass');
    await mkdir(join(dir,'evidence'));
    for(const name of ['checks.json','wide.png','tall.png'])await writeFile(join(dir,'evidence',name),await readFile(join(checked.directory,name)),{flag:'wx'});
    report.stages.push({stage:'consumer-check',status:'passed',checks:checked.checks});
    report.consumerDirectory=consumer;
  }
  report.status=action==='inspect'?'inspected':'checked-candidate';
  await writeFile(join(dir,'run.json'),json(report),{flag:'wx'});
  console.log(json({directory:dir,status:report.status,assets:inspection.assets,consumerDirectory:report.consumerDirectory,selected:false}));
}catch(e){
  if(dir)await writeFile(join(dir,'run.json'),json({...report,status:'failed',error:{code:e.code??'postprocess.failed',message:e.message}}));
  console.error('后处理失败；未切换当前验收包。'+(dir?' 报告：'+dir:'')+' '+e.message);process.exitCode=1;
}
