#!/usr/bin/env node
/** Local schema repair/freeze only. No model transport is imported or called. */
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve,basename} from 'node:path';
import {canonicalJson,digestBytes,digestJson} from '../src/canonical.mjs';
import {createOutputDirectory,harnessRoot,readJson,writeNewJson} from '../src/io.mjs';
import {loadWorkspaceCore} from '../src/component-adapter.mjs';
import {validatePanelBundle} from '../src/panel-bundle.mjs';
import {ART_SKILL_CONDITIONS,ART_SKILL_BRIEF,materializeArtSkillResponse} from '../examples/crafted-audio-v1/skill-comparison.mjs';
import {lowerArtNativeSchema,validateArtResponseConstraints,auditArtNativeSchema} from './lib/art-skill-native-schema.mjs';

const args=process.argv.slice(2);
assert(args.length===6&&args[0]==='--source-plan'&&args[2]==='--failure'&&args[4]==='--output');
const source=resolve(args[1]),failureDirectory=resolve(args[3]);
const {sha256:sourceDigest,...sourcePlan}=await readJson(resolve(source,'plan.json'));
assert.equal(await digestJson(sourcePlan),sourceDigest);
for(const fact of sourcePlan.files){
  assert.equal(basename(fact.file),fact.file);
  const bytes=await readFile(resolve(source,fact.file));
  assert.equal(bytes.length,fact.bytes);assert.equal(await digestBytes(bytes),fact.sha256);
}
for(const fact of sourcePlan.sourceFingerprints)assert.equal(await digestBytes(await readFile(resolve(harnessRoot,fact.path))),fact.sha256);
const failureBytes=await readFile(resolve(failureDirectory,'batch-report.json')),failure=JSON.parse(failureBytes);
assert.equal(failure.planSha256,sourceDigest);assert.equal(failure.status,'FAIL');assert.equal(failure.modelCalls,1);
assert.equal(failure.steps.length,1);assert.equal(failure.steps[0].condition,'frontend-design');assert.equal(failure.steps[0].status,'FAIL');
const consumed=await readJson(resolve(source,'authorization-consumed.json'));assert.equal(consumed.planSha256,sourceDigest);
const events=await readFile(resolve(failureDirectory,'step-1','cli.stdout.ndjson'),'utf8');
assert(events.includes('invalid_json_schema')); // Exact raw log remains untouched and local.
const originalSchema=await readJson(resolve(source,'response-schema.json')),nativeSchema=lowerArtNativeSchema(originalSchema);
const originalProblems=auditArtNativeSchema(originalSchema);assert(originalProblems.length>0);assert.deepEqual(auditArtNativeSchema(nativeSchema),[]);
const core=await loadWorkspaceCore(),baselines={},fixture={artStudyVersion:'0.1',designNote:'Local schema revision fixture; no real Skill result.'};
for(const mode of ['light','dark']){
  const baseline=await validatePanelBundle(await readJson(resolve(source,`baseline-${mode}.panel.bundle.json`)),core);
  baselines[mode]=baseline;fixture[mode]={tokens:baseline.catalog.themes.find(theme=>theme.id===baseline.spec.theme.id).tokens,
    canvas:baseline.spec.canvas,layout:baseline.spec.layout,titleBar:null,buttonStyles:baseline.spec.buttonStyles,actionLayouts:baseline.spec.actionLayouts};
}
validateArtResponseConstraints(fixture,originalSchema);validateArtResponseConstraints(fixture,nativeSchema);
for(const condition of ART_SKILL_CONDITIONS){
  const bundles=await materializeArtSkillResponse(fixture,baselines,core,{conditionId:condition.id,fixture:true});
  for(const mode of ['light','dark'])await validatePanelBundle(bundles[mode],core);
}
const output=await createOutputDirectory(args[5]),files=[];
async function save(name,bytes){
  await writeFile(resolve(output,name),bytes,{flag:'wx'});
  const fact={file:name,bytes:bytes.length,sha256:await digestBytes(bytes)};files.push(fact);return fact;
}
const oldCommon=await readFile(resolve(source,'common-brief.txt'),'utf8');
const common=oldCommon+'\nShared response constraints (authoritative for every condition):\n'+
  'The native schema describes only output shape. The following full constraint schema is checked locally without repair, clamping or fallback. '+
  'Follow every bound, enum, text pattern, required field and exact section identity here. A violation stops the entire batch.\n'+canonicalJson(originalSchema)+'\n';
const replaced=new Set(['response-schema.json','common-brief.txt',...sourcePlan.steps.map(step=>step.prompt)]);
for(const fact of sourcePlan.files)if(!replaced.has(fact.file))await save(fact.file,await readFile(resolve(source,fact.file)));
await save('response-schema.json',Buffer.from(canonicalJson(nativeSchema)+'\n'));
await save('response-constraints.json',await readFile(resolve(source,'response-schema.json')));
await save('common-brief.txt',Buffer.from(common));
const steps=[];
for(const oldStep of sourcePlan.steps){
  const oldPrompt=await readFile(resolve(source,oldStep.prompt),'utf8');assert(oldPrompt.startsWith(oldCommon));
  const prompt=await save(oldStep.prompt,Buffer.from(common+oldPrompt.slice(oldCommon.length)));
  const {sha256,...step}=oldStep;step.promptSha256=prompt.sha256;
  steps.push({...step,sha256:await digestJson(step)});
}
const sourceFingerprints=[...sourcePlan.sourceFingerprints];
for(const path of ['scripts/prepare-audio-skill-schema-revision.mjs','scripts/lib/art-skill-native-schema.mjs',
  'scripts/run-audio-skill-comparison.mjs','scripts/lib/art-skill-transport.mjs','scripts/lib/art-skill-review.mjs','examples/crafted-audio-v1/skill-review.mjs'])
  sourceFingerprints.push({path,sha256:await digestBytes(await readFile(resolve(harnessRoot,path)))});
const payload={...sourcePlan,planVersion:'0.2',status:'AWAITING_FRESH_AUTHORIZATION',files,steps,sourceFingerprints,
  supersedesPlanSha256:sourceDigest,localResponseSchema:'response-constraints.json',
  revision:{reason:'Native output schema was rejected with invalid_json_schema before any design was returned.',
    previousBatch:{status:'FAIL',modelCalls:1,realSkillResults:0,reportSha256:await digestBytes(failureBytes),remainingStepsRun:false,authorizationReusable:false},
    changes:['explicit enum types','exact object choices represented by strict anyOf branches',
      'conservative native shape schema; original full constraints remain authoritative locally and are shared in every prompt',
      'freeze executor and schema revision source fingerprints'],
    exactRejectedKeyword:'NOT_IDENTIFIED_BY_SERVER',serverAcceptance:'NOT_RUN'},
};
const plan={...payload,sha256:await digestJson(payload)};
await writeNewJson(output,'plan.json',plan);
await writeNewJson(output,'preparation-report.json',{status:'PASS',kind:'LOCAL_SCHEMA_REVISION_ONLY',modelCalls:0,realSkillResults:0,
  planSha256:plan.sha256,originalNativeAudit:originalProblems,nativeAudit:[],serverAcceptance:'NOT_RUN',authorization:'NOT_GRANTED',
  checks:['original plan and all source/input fingerprints verified','original failed batch and consumed authorization retained',
    'baseline packages, screenshots and seven guidance snapshots copied byte-for-byte',
    'same full constraints shared in all three prompts and enforced before materialization',
    'baseline fixture satisfies both schemas; six strict materializations passed']});
await writeFile(resolve(output,'plan.md'),`# 三个 Skill 的独立美术对照 · schema 修正版\n\n状态：等待新的明确授权。本次准备调用0次；仍无真实 Skill 设计结果。\n\n新计划摘要：\`${plan.sha256}\`（去除根 sha256 后的 canonical JSON 正文摘要）。\n\n上一份计划 \`${sourceDigest}\` 已获授权并调用第1步一次，原生输出 schema 被拒绝；未返回设计。第2、3步未调用，旧批次已经停止，授权不可继续使用。原方案、失败事件、回执和执行源码快照保留。\n\n修正仅涉及响应 schema 兼容表达和共同约束提示。原业务、素材、两份基线截图和7份 Skill 指导快照保持原字节。服务端未指出具体字段；本地修正与检查通过不代表远端接受已验证。完整约束仍在 response-constraints.json，模型结果违规即停，不修补输出。\n\n共同任务：${ART_SKILL_BRIEF}\n\n| 步骤 | Skill | 新调用上限 |\n| --- | --- | --- |\n${steps.map(step=>`| ${step.number} | ${step.label} | 1 |`).join('\n')}\n\n固定 Codex CLI / gpt-6-luna / xhigh。最多3次，各一步一次，自动重试0；任一步失败、结果不明、非法响应、编译/业务/Pixi/ZIP门禁失败即停止整批。各 Skill 独立上下文，使用共同起点，只改变指导文本，先匿名展示。\n\n比较局限：一个声音设置案例、每个 Skill 一个样本、固定 Harness 渲染能力；基线曾参考 Impeccable。这是设计指导对照，不能认定普遍排名或完整 Skill 工作流通过。Unity 原生与游戏接入均 NOT_RUN。\n`,{flag:'wx'});
process.stdout.write(JSON.stringify({status:'PASS',planSha256:plan.sha256,maxInvocations:3,modelCalls:0,realSkillResults:0,serverAcceptance:'NOT_RUN'})+'\n');
