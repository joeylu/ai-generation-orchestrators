import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join,relative,isAbsolute,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import {prepareGenerationPlan,verifyGenerationPlan} from '../src/skin-generation/plan.mjs';
import {readContracts} from '../src/contracts/validate.mjs';
import {defaults} from '../src/contracts/build.mjs';
import {json,hash,readSafe} from '../src/skins/package.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const {positionals,values:v}=parseArgs({allowPositionals:true,options:{reference:{type:'string'},style:{type:'string'},out:{type:'string'},batch:{type:'string'},sha256:{type:'string'}}});
const local=value=>{const path=resolve(value),r=relative(join(root,'work'),path);if(isAbsolute(r)||r==='..'||r.startsWith('..'+sep))throw Error('Output must be in Harness work/');return path;};
async function verify(dir,digest){
  const bytes=await readSafe(dir,'batch.json');if(hash(bytes)!==digest)throw Error('Batch changed');
  const batch=JSON.parse(bytes),source=await readContracts(defaults);
  if(batch.kind!=='ui_skin_generation_batch'||batch.version!=='0.1'||batch.computeAuthorized!==false||batch.plans.length!==source.template.sheets.length)throw Error('Invalid batch');
  const ids=new Set();let total=0;
  for(const entry of batch.plans){
    if(!/^[a-f0-9]{64}$/.test(entry.sha256)||ids.has(entry.sheetId))throw Error('Invalid plan reference');
    ids.add(entry.sheetId);const expected=source.template.sheets.find(s=>s.id===entry.sheetId);if(!expected)throw Error('Unknown sheet');
    const planDir=join(dir,'../../plans',entry.sha256);
    const check=await verifyGenerationPlan({directory:planDir,planSha256:entry.sha256});
    const plan=JSON.parse(await readSafe(planDir,'plan.json'));
    if(check.sheetId!==entry.sheetId||check.assets!==entry.assets||entry.assets!==expected.parts.length||plan.resources.find(f=>f.file==='reference.png').sha256!==batch.referenceSha256||plan.resources.find(f=>f.file==='inputs/style.json').sha256!==batch.styleSha256)throw Error('Batch inputs differ');
    total+=entry.assets;
  }
  if(total!==batch.assetCount)throw Error('Asset count differs');
  return {status:'verified-awaiting-batch-confirmation',batchSha256:digest,sheets:ids.size,assets:total,computeAuthorized:false};
}
if(positionals.length!==1)throw Error('Use prepare or verify');
if(positionals[0]==='prepare'){
  if(!v.reference||!v.style||!v.out)throw Error('Use prepare --reference --style --out');
  const out=local(v.out),source=await readContracts(defaults),plans=[];
  for(const sheet of source.template.sheets){const p=await prepareGenerationPlan({reference:resolve(v.reference),style:resolve(v.style),sheetId:sheet.id,output:join(out,'plans')});plans.push({sheetId:p.sheetId,assets:p.assets,sha256:p.planSha256});}
  const first=JSON.parse(await readSafe(join(out,'plans',plans[0].sha256),'plan.json'));
  const batch={kind:'ui_skin_generation_batch',version:'0.1',computeAuthorized:false,style:first.style,referenceSha256:first.resources.find(f=>f.file==='reference.png').sha256,styleSha256:first.resources.find(f=>f.file==='inputs/style.json').sha256,assetCount:plans.reduce((n,p)=>n+p.assets,0),plans,policy:{callsPerPlan:1,automaticRetry:false,review:'whole-batch',productionReady:false}};
  const bytes=json(batch),digest=hash(Buffer.from(bytes)),dir=join(out,'batches',digest);await mkdir(dir,{recursive:true});await writeFile(join(dir,'batch.json'),bytes,{flag:'wx'});
  const result=await verify(dir,digest);
  await writeFile(join(dir,'review.md'),`# ${first.style.id}：整套皮肤生成批次\n\n四张独立正方形图集，共 ${batch.assetCount} 件。一次确认覆盖下列每份计划各一次调用，中间不逐张等待确认。不自动重试；原始输出与失败记录保留。\n\n批次摘要：\`${digest}\`\n\n| 图集 | 部件数 | 核对计划 |\n| --- | --- | --- |\n${plans.map(p=>`| ${p.sheetId} | ${p.assets} | [${p.sha256.slice(0,12)}](../../plans/${p.sha256}/review.md) |`).join('\n')}\n\n本批只准备计划，尚未调用模型。生成后统一检查、拆分和组包，未通过项不能冒充完整成功。\n`,{flag:'wx'});
  console.log(json({...result,directory:dir}));
}else if(positionals[0]==='verify')console.log(json(await verify(local(v.batch),v.sha256)));
else throw Error('Use prepare or verify');
