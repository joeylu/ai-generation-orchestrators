import { readFile, writeFile, mkdir, rename, open, unlink, lstat } from 'node:fs/promises';
import { join, dirname, resolve, parse } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { hash, json, readSafe, bindingsOf } from '../skins/package.mjs';
import { decodePng, encodePng, cropPng } from '../skins/png.mjs';
import { safePath } from '../skins/contract.mjs';
import { defaults } from '../contracts/build.mjs';
import { readContracts, validateContracts } from '../contracts/validate.mjs';
import { assessPilot } from './attempt.mjs';
import { normalizeSheet, validatePolicy, normalizationError as fail } from './normalize.mjs';

const root=fileURLToPath(new URL('../../',import.meta.url));
export const defaultPolicy=join(root,'configs/skin-normalization.json');
const digest=/^[a-f0-9]{64}$/, uuid=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const record=(file,bytes)=>({file,bytes:bytes.length,sha256:hash(bytes)});
async function noLinks(path){let current=parse(resolve(path)).root;for(const part of resolve(path).slice(current.length).split(/[\\/]/).filter(Boolean)){current=join(current,part);try{if((await lstat(current)).isSymbolicLink())fail('Links/junctions are forbidden.');}catch(e){if(e.code!=='ENOENT')throw e;}}}
async function policyBytes(path){await noLinks(path);const s=await lstat(path);if(!s.isFile()||s.size>65536)fail('Expected a bounded policy JSON.');const bytes=await readFile(path);validatePolicy(JSON.parse(bytes));return bytes;}
async function emit(directory,file,bytes){if(!safePath(file))fail('Unsafe artifact path.');await mkdir(dirname(join(directory,file)),{recursive:true});await writeFile(join(directory,file),bytes,{flag:'wx'});return record(file,bytes);}
async function move(from,to){for(let i=0;;i++){try{return await rename(from,to);}catch(e){if(!['EPERM','EACCES','EBUSY'].includes(e.code)||i===5)throw e;await delay(50*(i+1));}}}
async function toolIdentity(){const files=[];for(const file of ['src/skin-generation/normalize.mjs','src/skin-generation/refine.mjs','src/skin-generation/normalize-build.mjs','src/skin-generation/attempt.mjs','src/skins/png.mjs','src/skins/raster.mjs','src/skins/contract.mjs','src/skins/package.mjs','src/templates/contract.mjs','src/contracts/validate.mjs','src/contracts/props.mjs','src/contracts/bounded-validators.mjs','schemas/skin-normalization.schema.json','schemas/skin-template-set.schema.json','schemas/component-registry.schema.json','schemas/skin-usage.schema.json','package-lock.json'])files.push(record(file,await readFile(join(root,file))));return {sha256:hash(json(files)),files};}

async function loadInputs({planDirectory,planSha256,attemptDirectory,contracts}){
  const planBytes=await readSafe(planDirectory,'plan.json'),plan=JSON.parse(planBytes);
  // Historical result processing uses its frozen inputs, not authorization to
  // execute an old generation plan against a changed component registry.
  if(hash(planBytes)!==planSha256||plan.kind!=='ui_skin_generation_plan'||plan.version!=='0.1')fail('Selected frozen plan changed.');
  const receiptBytes=await readSafe(attemptDirectory,'receipt.json'),receipt=JSON.parse(receiptBytes);
  const reservation=await readSafe(attemptDirectory,'reservation.json');
  if(receipt.kind!=='ui_skin_external_attempt_receipt'||receipt.state!=='received'||receipt.planSha256!==planSha256||receipt.reservationSha256!==hash(reservation)||JSON.parse(reservation).planSha256!==planSha256)fail('Source attempt does not match the selected plan.');
  const raw=await readSafe(attemptDirectory,receipt.raw.file),inspection=await readSafe(attemptDirectory,receipt.inspection.file);
  if(hash(raw)!==receipt.raw.sha256||raw.length!==receipt.raw.bytes||hash(inspection)!==receipt.inspection.sha256)fail('Source result changed.');
  const resources=new Map([['inputs/plan/plan.json',planBytes],['inputs/receipt.json',receiptBytes],['inputs/reservation.json',reservation],['inputs/raw.png',raw],['inputs/original-inspection.json',inspection]]);
  for(const f of plan.resources){const b=await readSafe(planDirectory,f.file);if(hash(b)!==f.sha256||b.length!==f.bytes)fail('Frozen input changed.');resources.set('inputs/plan/'+f.file,b);}
  const frozen={};for(const key of ['template','registry','usage']){const b=resources.get(`inputs/plan/inputs/${key}.json`);if(!b||hash(b)!==plan.bindings[key+'Sha256'])fail('Frozen contract binding mismatch.');frozen[key]=JSON.parse(b);}
  if(validateContracts(frozen).issues.length)fail('Frozen source contracts are invalid.');
  const activeBindings=bindingsOf(await readContracts(contracts));
  if(activeBindings.templateSha256!==plan.bindings.templateSha256)fail('Active template changed; review geometry before normalization.');
  const changed=Object.keys(activeBindings).filter(k=>activeBindings[k]!==plan.bindings[k]);
  return {plan,raw,receipt,resources,geometry:JSON.parse(resources.get('inputs/plan/geometry.json')),template:frozen.template,
    consumerCompatibility:{status:changed.length?'requires-rebind':'bindings-match',changedBindings:changed}};
}
const esc=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
function cautionsPlaceholder(report){
  return `<section><h2>仍需核对</h2><ul><li>语义身份按槽位给出候选；颜色/状态是否对应，需结合下面的逐件对照判断。</li>${report.stateComparisons.map(s=>`<li>${esc(s.id)}：状态轮廓边缘最大相差 ${s.maxEdgeDriftPixels} 像素（alpha ≥ 128）。</li>`).join('')}<li>${report.refinement?.enabled?'已按明确策略对齐两态共同 alpha，并处理限定色相的边缘；逐件基线及操作参数保留，需观察材质效果。':'仅清理与主体断开的弱透明碎点；主体相连软边保留，局部彩色毛边可能仍在。'}</li>${report.consumerCompatibility.status==='requires-rebind'?'<li>组件注册合同已更新。候选仍绑定原始生成合同，正式装配前须重新核对绑定。</li>':''}</ul></section>`;
}
function reviewHtml(result,raw,sheetBytes){
  const png=b=>'data:image/png;base64,'+b.toString('base64');
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>部件规范化核对</title><style>body{margin:0;background:#111721;color:#e6ecf5;font:16px/1.5 system-ui,sans-serif}main{max-width:1120px;margin:auto;padding:32px}h1{font-size:28px}p{color:#bbc9da}.notice{border-left:4px solid #efb85c;padding:12px 18px;background:#262524}section{margin:24px 0;padding:20px;background:#1c2532;border:1px solid #364355;border-radius:10px}.pair{display:grid;grid-template-columns:1fr 1fr;gap:20px}.check{display:flex;justify-content:center;align-items:center;min-height:160px;background:repeating-conic-gradient(#27313e 0 25%,#354253 0 50%) 0/20px 20px;padding:16px;overflow:auto}.check img{max-width:100%;height:auto;max-height:520px}.small img{max-height:210px}code{font-size:14px}h2{font-size:18px}figcaption{margin:8px 0;color:#c3d0df}figure{margin:0}a{color:#9cceff}@media(max-width:700px){.pair{grid-template-columns:1fr}}</style><main><h1>${esc(result.report.sheetId)} · 部件规范化核对</h1><p class="notice">这是后处理候选，不是已接受的资产包。身份依据是模板槽位；请核对部件语义、状态切换、描边和拉伸。原生成结果的 rejected 记录保持不变。</p><div class="pair"><figure><div class="check"><img alt="原始生成图" src="${png(raw)}"></div><figcaption>原图：${result.report.imageSize.join(' × ')}</figcaption></figure><figure><div class="check"><img alt="标准模板板候选" src="${png(sheetBytes)}"></div><figcaption>规范化：${result.sheet.width} × ${result.sheet.height}；${result.assets.length} 个部件</figcaption></figure></div>${result.assets.map(a=>`<section><h2>${esc(a.part.code)} · ${esc(a.part.assetId)} <small>(${esc(a.part.state)})</small></h2><p>候选来源：${a.match.sourceRect.join(', ')} → ${a.image.width} × ${a.image.height}；${a.operation.method==='preserve-caps'?'两端保持比例，中段伸缩':'等比缩放，居中留透明边'}</p><div class="pair"><figure><div class="check small"><img alt="定位出的原部件" src="${png(encodePng(a.source))}"></div><figcaption>原部件（保留相连的软边）</figcaption></figure><figure><div class="check small"><img alt="规范化候选" src="${png(encodePng(a.image))}"></div><figcaption>规范化独立 PNG</figcaption></figure></div></section>`).join('')}<p>核对文件：<a href="manifest.json">资产映射与操作参数</a> · <a href="report.json">诊断与像素检查</a></p></main></html>`;
}
function stateEdges(assets,template){
  const bounds=a=>{
    let x0=a.image.width,y0=a.image.height,x1=-1,y1=-1;
    for(let y=0;y<a.image.height;y++)for(let x=0;x<a.image.width;x++)if(a.image.pixels[(y*a.image.width+x)*4+3]>=128){x0=Math.min(x0,x);y0=Math.min(y0,y);x1=Math.max(x1,x);y1=Math.max(y1,y);}
    return [x0,y0,x1+1,y1+1];
  };
  return template.stateGroups.filter(g=>g.assetIds.every(id=>assets.some(a=>a.part.assetId===id))).map(g=>{
    const states=g.assetIds.map(id=>({assetId:id,visibleEdgesAtAlpha128:bounds(assets.find(a=>a.part.assetId===id))}));
    const edgeDrift=Math.max(...[0,1,2,3].map(k=>Math.max(...states.map(s=>s.visibleEdgesAtAlpha128[k]))-Math.min(...states.map(s=>s.visibleEdgesAtAlpha128[k]))));
    return {id:g.id,states,maxEdgeDriftPixels:edgeDrift,review:edgeDrift?'state-silhouette-review-required':'still-requires-visual-review'};
  });
}

export async function buildNormalization({planDirectory,planSha256,attemptDirectory,output,policy=defaultPolicy,contracts=defaults}){
  if(!digest.test(planSha256))fail('Expected selected plan SHA-256.');
  const input=await loadInputs({planDirectory,planSha256,attemptDirectory,contracts}),pBytes=await policyBytes(policy),p=JSON.parse(pBytes),tool=await toolIdentity();
  await noLinks(output);await mkdir(output,{recursive:true});
  const lockPath=join(output,'.build.lock');let lock;
  try{lock=await open(lockPath,'wx');}catch(e){if(e.code==='EEXIST')fail('Normalization is already running.');throw e;}
  const buildId=randomUUID(),candidate=join(output,'.staging',buildId);
  try{
    await noLinks(candidate);await noLinks(join(output,'builds'));await mkdir(candidate,{recursive:true});
    const files=[];
    input.resources.set('inputs/policy.json',pBytes);
    for(const [file,b] of input.resources)files.push(await emit(candidate,file,b));
    const result=normalizeSheet(decodePng(input.raw),input.geometry,p,input.template.stateGroups);
    if(!result.sheet){await emit(candidate,'blocked-report.json',Buffer.from(json(result.report)));fail(`Normalization blocked; retained candidate ${buildId}.`);}
    const normalizedBytes=encodePng(result.sheet);
    const pixelCheck=assessPilot(normalizedBytes,{...input.plan,outputScale:input.geometry.coordinates.outputScale});
    if(pixelCheck.status!=='pixel-gates-passed-awaiting-visual-review')fail('Normalized sheet failed fixed-template pixel checks.');
    const assets=[];
    for(const a of result.assets){
      const source=await emit(candidate,`source-parts/${a.part.assetId}.png`,encodePng(a.source));
      const target=await emit(candidate,`assets/${a.part.assetId}.png`,encodePng(a.image));files.push(source,target);
      const baseline=a.baselineImage?await emit(candidate,`baseline-assets/${a.part.assetId}.png`,encodePng(a.baselineImage)):null;
      if(baseline)files.push(baseline);
      assets.push({assetId:a.part.assetId,code:a.part.code,state:a.part.state,stretch:a.part.stretch,sourceRect:a.match.sourceRect,
        crop:a.part.bodyRect.map(v=>v*input.geometry.coordinates.outputScale),source,target,baseline,operation:a.operation,
        identityEvidence:result.report.identityEvidence,semanticReview:'required'});
    }
    files.push(await emit(candidate,'normalized-sheet.png',normalizedBytes));
    const report={kind:'ui_skin_normalization_report',version:'0.1',planSha256,rawSha256:hash(input.raw),policySha256:hash(pBytes),
      originalInspectionStatus:input.receipt.inspection.status,...result.report,pixelCheck,stateComparisons:stateEdges(result.assets,input.template),consumerCompatibility:input.consumerCompatibility,productionReady:false};
    files.push(await emit(candidate,'report.json',Buffer.from(json(report))));
    files.push(await emit(candidate,'review.html',Buffer.from(reviewHtml(result,input.raw,normalizedBytes).replace('<div class="pair">',cautionsPlaceholder(report)+'<div class="pair">'))));
    files.push(await emit(candidate,'overview.md',Buffer.from(`# ${input.plan.sheetId} 规范化候选\n\n原图检查仍为 ${input.receipt.inspection.status}；本次产生独立后处理候选，身份与美术待核对，非正式皮肤包。\n\n[前后逐件核对](review.html) · [清单](manifest.json) · [报告](report.json) · [保留原图](inputs/raw.png)\n\n![标准模板板候选](normalized-sheet.png)\n\n| 部件 | 源区域 x,y,w,h | 输出尺寸 | 方法 |\n| --- | --- | --- | --- |\n${assets.map(a=>`| [${a.assetId}](${a.target.file}) | ${a.sourceRect.join(', ')} | ${a.crop.slice(2).join(' × ')} | ${a.operation.method} |`).join('\n')}\n`)));
    const manifest={kind:'ui_skin_normalization_candidates',version:'0.1',buildId,status:'review-required',planSha256,rawSha256:hash(input.raw),
      policySha256:hash(pBytes),bindings:input.plan.bindings,sheetId:input.plan.sheetId,sheet:{file:'normalized-sheet.png',width:result.sheet.width,height:result.sheet.height},
      assets,files,tool,semanticReview:'required',visualAcceptance:'unreviewed',productionReady:false};
    const mBytes=Buffer.from(json(manifest));await emit(candidate,'manifest.json',mBytes);
    await verifyNormalization({directory:candidate,manifestSha256:hash(mBytes)});
    if(hash(await policyBytes(policy))!==hash(pBytes)||(await toolIdentity()).sha256!==tool.sha256)fail('Policy or tools changed during normalization.');
    const after=await loadInputs({planDirectory,planSha256,attemptDirectory,contracts});
    if(hash(after.raw)!==hash(input.raw)||hash(after.resources.get('inputs/receipt.json'))!==hash(input.resources.get('inputs/receipt.json')))fail('Source changed during normalization.');
    await mkdir(join(output,'builds'),{recursive:true});await move(candidate,join(output,'builds',buildId));
    const pending=join(output,`${buildId}.tmp`);await emit(output,`${buildId}.tmp`,Buffer.from(json({kind:'ui_skin_normalization_current',buildId,manifestSha256:hash(mBytes)})));await move(pending,join(output,'current.json'));
    return {status:'candidates-built-review-required',buildId,assets:assets.length,manifestSha256:hash(mBytes),overview:`builds/${buildId}/overview.md`,discardedPixels:result.report.cleanup.discardedPixels,productionReady:false};
  }finally{await lock.close();await unlink(lockPath);}
}

export async function verifyNormalization({directory,manifestSha256}){
  if(!digest.test(manifestSha256??''))fail('Expected selected manifest SHA-256.');
  const mBytes=await readSafe(directory,'manifest.json',2*1024*1024);
  if(hash(mBytes)!==manifestSha256)fail('Manifest changed.');
  const m=JSON.parse(mBytes);
  if(m.kind!=='ui_skin_normalization_candidates'||m.version!=='0.1'||m.productionReady!==false)fail('Invalid candidate manifest.');
  let total=0;const seen=new Set();
  for(const f of m.files){if(seen.has(f.file))fail('Duplicate resource.');seen.add(f.file);const b=await readSafe(directory,f.file);total+=b.length;if(total>96*1024*1024||b.length!==f.bytes||hash(b)!==f.sha256)fail('Candidate resource changed or exceeded limit.');}
  const raw=await readSafe(directory,'inputs/raw.png'),planBytes=await readSafe(directory,'inputs/plan/plan.json'),p=await readSafe(directory,'inputs/policy.json');
  if(hash(raw)!==m.rawSha256||hash(planBytes)!==m.planSha256||hash(p)!==m.policySha256)fail('Source bindings changed.');
  const plan=JSON.parse(planBytes);
  for(const f of plan.resources){const b=await readSafe(directory,'inputs/plan/'+f.file);if(hash(b)!==f.sha256||b.length!==f.bytes)fail('Frozen plan resource changed.');}
  const geometry=JSON.parse(await readSafe(directory,'inputs/plan/geometry.json'));
  const expected=geometry.sheets[0].parts;
  if(m.assets.length!==expected.length||new Set(m.assets.map(a=>a.assetId)).size!==expected.length)fail('Candidate coverage mismatch.');
  const sheet=decodePng(await readSafe(directory,m.sheet.file));
  const check=assessPilot(encodePng(sheet),{...plan,outputScale:geometry.coordinates.outputScale});
  if(check.status!=='pixel-gates-passed-awaiting-visual-review')fail('Candidate no longer fits the template.');
  for(const a of m.assets){
    const part=expected.find(p=>p.assetId===a.assetId);if(!part||json(a.crop)!==json(part.bodyRect.map(v=>v*geometry.coordinates.outputScale)))fail('Candidate identity/geometry mismatch.');
    const crop=cropPng(sheet,a.crop),asset=decodePng(await readSafe(directory,a.target.file));
    if(asset.width!==crop.width||asset.height!==crop.height||!asset.pixels.equals(crop.pixels)||asset.transparentRgbPixels)fail('Independent asset differs from normalized sheet.');
  }
  const sameTool=(await toolIdentity()).sha256===m.tool.sha256;
  if(sameTool){
    const template=JSON.parse(await readSafe(directory,'inputs/plan/inputs/template.json'));
    const replay=normalizeSheet(decodePng(raw),geometry,JSON.parse(p),template.stateGroups);
    if(!replay.sheet||!replay.sheet.pixels.equals(sheet.pixels))fail('Normalized pixels do not reproduce from the bound original.');
    for(const a of m.assets){
      const original=replay.assets.find(item=>item.part.assetId===a.assetId),cropped=decodePng(await readSafe(directory,a.source.file));
      if(!cropped.pixels.equals(original.source.pixels)||cropped.width!==original.source.width||cropped.height!==original.source.height||json(a.sourceRect)!==json(original.match.sourceRect)||json(a.operation)!==json(original.operation))fail('Source crop/operation does not reproduce from original.');
      if(a.baseline){const baseline=decodePng(await readSafe(directory,a.baseline.file));if(!original.baselineImage||baseline.width!==original.baselineImage.width||baseline.height!==original.baselineImage.height||!baseline.pixels.equals(original.baselineImage.pixels))fail('Refinement baseline does not reproduce from original.');}
    }
  }
  return {status:'integrity-verified-review-required',assets:m.assets.length,replay:sameTool?'passed':'tool-version-unavailable',manifest:m};
}
export async function normalizationStatus(output,policy=defaultPolicy,contracts=defaults){
  try{
    const c=JSON.parse(await readSafe(output,'current.json',4096));
    if(c.kind!=='ui_skin_normalization_current'||!uuid.test(c.buildId)||!digest.test(c.manifestSha256))fail('Invalid pointer.');
    const {manifest:m}=await verifyNormalization({directory:join(output,'builds',c.buildId),manifestSha256:c.manifestSha256});
    const bindings=bindingsOf(await readContracts(contracts));
    const changed=Object.keys(bindings).filter(k=>bindings[k]!==m.bindings[k]);
    return {status:(await toolIdentity()).sha256===m.tool.sha256&&hash(await policyBytes(policy))===m.policySha256&&bindings.templateSha256===m.bindings.templateSha256?'current':'stale',
      buildId:c.buildId,assets:m.assets.length,consumerCompatibility:changed.length?'requires-rebind':'bindings-match',changedBindings:changed,review:'required',productionReady:false};
  }catch(e){return {status:e.code==='ENOENT'?'missing':'corrupt',code:e.code??'skin.normalize'};}
}
