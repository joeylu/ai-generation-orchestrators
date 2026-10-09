#!/usr/bin/env node
/** Read/freeze only. This program never imports or invokes a model transport. */
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {loadWorkspaceCore} from '../src/component-adapter.mjs';
import {validatePanelBundle} from '../src/panel-bundle.mjs';
import {canonicalJson,digestBytes,digestJson} from '../src/canonical.mjs';
import {createOutputDirectory,harnessRoot,readJson,writeNewJson} from '../src/io.mjs';
import {ART_SKILL_CONDITIONS,ART_SKILL_BRIEF,artSkillResponseSchema,materializeArtSkillResponse} from '../examples/crafted-audio-v1/skill-comparison.mjs';

assert(process.argv.length===8&&process.argv[2]==='--source'&&process.argv[4]==='--references'&&process.argv[6]==='--output');
const source=resolve(process.argv[3]),references=resolve(process.argv[5]),output=await createOutputDirectory(process.argv[7]);
const core=await loadWorkspaceCore(),baselines={},files=[],steps=[];
async function save(name,bytes){await writeFile(resolve(output,name),bytes,{flag:'wx'});const fact={file:name,bytes:bytes.length,sha256:await digestBytes(bytes)};files.push(fact);return fact;}
const sourceReport=await readJson(resolve(source,'review-report.json'));assert.equal(sourceReport.status,'PASS');assert.equal(sourceReport.modelCalls,0);
for(const mode of ['dark','light']){
  const bytes=await readFile(resolve(source,`after-${mode}.panel.bundle.json`));
  baselines[mode]=await validatePanelBundle(JSON.parse(bytes),core);
  await save(`baseline-${mode}.panel.bundle.json`,bytes);await save(`baseline-${mode}.png`,await readFile(resolve(source,`audio-${mode}.png`)));
}
const schema=artSkillResponseSchema(baselines.dark);await save('response-schema.json',Buffer.from(JSON.stringify(schema)+'\n'));
const originals=await readJson(resolve(references,'sources.json')),referenceFacts=[];
for(const record of originals){
  assert(/^[A-Za-z.-]+\.md$/.test(record.file));
  const fact=await save(record.file,await readFile(resolve(references,record.file)));referenceFacts.push({...record,...fact});
}
const scene=Object.fromEntries(['dark','light'].map(mode=>[mode,{spec:baselines[mode].spec,
  theme:baselines[mode].catalog.themes.find(t=>t.id===baselines[mode].spec.theme.id),
  recipeMinimums:baselines[mode].catalog.recipes.map(({id,minWidth,minHeight})=>({id,minWidth,minHeight}))}]));
const geometryFacts={compiler:'0.20.0',surfaceStyle:'crafted-v1',font:'existing family only; normal body, bold title',
  title:'panel padding*2 + titleHeight + gap contributes chrome height; title line height is ceil(fontSize*1.3)',
  settings:'sliders are stacked, min row height 68, switch min 56, inter-row gap fixed 16; unique section titles are shown',
  sections:'each min width 280 and min height 80; footer min height 80',
  footer:'auto footer keeps reset at leading edge and others trailing when they fit; explicit actionLayouts take precedence',
  scope:'No row regrouping or new assets; both existing sections must occur exactly once in body. No arbitrary CSS, scripts, raster generation, weights, letter spacing or motion changes.'};
const common=`You are designing one existing game settings panel under one supplied design-guidance condition. Return exactly ONE JSON object conforming to the supplied native response schema. Do not use tools, execute code, read files, call services, install anything, generate images, or output Markdown. No repair or retry follows. You receive the same baseline screenshots, business facts, renderer, constraints and brief as the other isolated conditions. You will not see their results. Plan and review internally before answering. All output must be supported by the existing Harness; the program owns business rows, state, assets, receipts and rendering. Do not invent a successful test or approval.\n\nCommon client brief:\n${ART_SKILL_BRIEF}\n\nRuntime constraints and geometry:\n${canonicalJson(geometryFacts)}\n\nBaseline task data (identity and behavior immutable):\n${canonicalJson(scene)}\n\nResponse rules: artStudyVersion is 0.1. designNote is a short explanation in Chinese. light and dark each contain only tokens, canvas, layout, titleBar, buttonStyles and actionLayouts. Copy the full existing font family exactly. Use full existing layout keys and stable body ID; reference each original section exactly once. Title style is null or the complete seven fields. Button styles and action layouts follow the exact schema. Avoid a circle unless dimensions and text fit. Keep a single muted mint accent, readable 16px+ body, and all content inside the declared canvas without scroll. Distinctness is not required if it harms the task. Both modes must be fully usable. If a source guide suggests tools/frameworks/fonts outside these constraints, preserve its design intent using permitted values; do not pretend to have run its commands. Impeccable launcher/detector are unavailable: use the provided project truth, not invented context. This is an instruction-guidance comparison inside a fixed renderer, not a complete workflow benchmark.\n\nOne condition's design guidance follows. Read it fully, apply relevant principles, and treat the client's brief and common constraints above as authoritative.\n`;
await save('common-brief.txt',Buffer.from(common));
for(const [index,condition] of ART_SKILL_CONDITIONS.entries()){
  const guidance=[];for(const file of condition.files)guidance.push(`--- ${file} ---\n${await readFile(resolve(output,file),'utf8')}`);
  const prompt=await save(`step-${index+1}.prompt.txt`,Buffer.from(common+'\n'+guidance.join('\n')));
  const step={number:index+1,condition:condition.id,label:condition.label,prompt:prompt.file,promptSha256:prompt.sha256,
    inputImages:['baseline-dark.png','baseline-light.png'],responseSchema:'response-schema.json',maxInvocations:1,automaticRetries:0};
  steps.push({...step,sha256:await digestJson(step)});
}
// A clearly marked local simulation verifies only lowering/old-source replay, never a Skill result.
const fixture={artStudyVersion:'0.1',designNote:'Preparation simulation copies baseline visuals; not a model or Skill result.'};
for(const mode of ['light','dark']){
  const base=baselines[mode];fixture[mode]={tokens:structuredClone(scene[mode].theme.tokens),canvas:base.spec.canvas,layout:base.spec.layout,titleBar:null,
    buttonStyles:base.spec.buttonStyles,actionLayouts:base.spec.actionLayouts};
}
for(const condition of ART_SKILL_CONDITIONS){
  const simulated=await materializeArtSkillResponse(fixture,baselines,core,{conditionId:condition.id,fixture:true});
  for(const mode of ['light','dark'])await validatePanelBundle(simulated[mode],core);
}
const fingerprints=[];
for(const path of ['examples/crafted-audio-v1/skill-comparison.mjs','scripts/prepare-audio-skill-comparison.mjs',
  'src/compiler.mjs','src/crafted-presentation.mjs','src/panel-presentation.mjs','src/minimal-skin.mjs','src/panel-bundle.mjs','src/spec.mjs','src/catalog.mjs'])
  fingerprints.push({path,sha256:await digestBytes(await readFile(resolve(harnessRoot,path)))});
const settings=['approval_policy="never"','project_doc_max_bytes=0','web_search="disabled"','suppress_unstable_features_warning=true',
  'model_reasoning_effort="xhigh"','skills.config=[]'];
for(const feature of ['shell_tool','unified_exec','multi_agent','apps','plugins','hooks','browser_use','browser_use_external','browser_use_full_cdp_access',
  'computer_use','in_app_browser','image_generation','memories','skill_search','view_image','shell_snapshot','unbounded_connection_retries'])settings.push(`features.${feature}=false`);
settings.push('features.skip_host_skill_discovery=true');
const argumentTemplate=['exec','--strict-config','--ignore-user-config','--ephemeral','--skip-git-repo-check','--sandbox','read-only','--cd','<step-directory>',
  '--model','gpt-6-luna','--json','--color','never','--output-schema','<plan-directory>/response-schema.json',
  '--image','<plan-directory>/baseline-dark.png','--image','<plan-directory>/baseline-light.png'];
for(const setting of settings)argumentTemplate.push('-c',setting);
argumentTemplate.push('-');
const payload={planVersion:'0.1',purpose:'Isolated design-guidance comparison inside existing UI Panel Harness',status:'AWAITING_FRESH_AUTHORIZATION',
  model:'gpt-6-luna',effort:'xhigh',maxInvocations:3,automaticRetries:0,steps,files,references:referenceFacts,sourceFingerprints:fingerprints,
  transport:{kind:'CODEX_CLI',shell:false,timeoutMs:900000,argumentTemplate,promptFrom:'frozen step prompt over stdin',
    rawLogs:'local ignored output only; never public artifacts'},
  rules:{independentContexts:true,inheritPriorResults:false,perStepOneUseAuthorization:true,
    stopOn:['failure','indeterminate result','invalid response','unsupported design','compile failure','business drift','browser/packaging gate failure'],
    repairModelOutput:false,skipFailedCondition:false,showAnonymousResultsFirst:true,
    productionDefaultChanged:false,nativeUnity:'NOT_RUN',gameIntegration:'NOT_RUN',installSkill:false},
  limitations:['One authored audio baseline and one sample per Skill cannot establish a general winner.',
    'Baseline was previously refined with Impeccable guidance; this tests further improvement from that common starting point.',
    'Typography/skin/layout are bounded by the shared renderer; this is not a complete Skill workflow comparison.',
    'Source snapshots are complete web-extracted line text normalized to LF, not claimed raw repository bytes.',
    'No true Skill/model results exist yet. Prior A/B/C are visual variants under shared guidance, not Skill results.']};
const plan={...payload,sha256:await digestJson(payload)};
await writeNewJson(output,'plan.json',plan);
await writeNewJson(output,'preparation-report.json',{status:'PASS',kind:'LOCAL_PREPARATION_ONLY',modelCalls:0,realSkillResults:0,
  planSha256:plan.sha256,checks:['two accepted baseline bundles strictly recompiled','baseline screenshots and bundle bytes copied and hashed',
    'three isolated frozen prompts, shared native schema and common task','seven complete guidance text snapshots hashed',
    'six programmatic materialization simulations passed; not Skill outputs'],authorization:'NOT_GRANTED'});
await writeFile(resolve(output,'plan.md'),`# 三个 Skill 的独立美术对照计划\n\n状态：等待新授权。准备阶段真实模型调用0次；没有 Skill 结果。\n\n计划摘要：\`${plan.sha256}\`（对不含 sha256 字段的计划正文按 canonical JSON 计算）。\n\n共同任务：${ART_SKILL_BRIEF}\n\n| 步骤 | Skill | 调用上限 |\n| --- | --- | --- |\n${steps.map(s=>`| ${s.number} | ${s.label} | 1 |`).join('\n')}\n\n固定 Codex CLI / gpt-6-luna / xhigh。三者从相同声音设置基线、素材、截图、业务和渲染约束开始，独立上下文，不继承前者结果。先匿名展示。最多3次，每步一次，自动重试0；任一步失败、结果不明、需要修补、编译/业务/浏览器门禁失败即停止，不能跳过继续。\n\n只比较既有 Harness 能力内的设计指导效果，不安装 Skill，不冒称完整工作流或统计胜负。每份结果需通过 Pixi 交互、素材/状态保留、实际 ZIP 离线和无图库重导入。Unity 原生未验收。\n\n完整输入、7份指导文本、schema、逐步 prompt 和摘要见同目录 plan.json。以前 A/B/C 不是不同 Skill 的结果；本计划不会借用它们冒充新调用。\n`,{flag:'wx'});
process.stdout.write(JSON.stringify({status:'PASS',planSha256:plan.sha256,maxInvocations:3,modelCalls:0,realSkillResults:0})+'\n');
