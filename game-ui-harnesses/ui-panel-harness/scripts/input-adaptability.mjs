#!/usr/bin/env node
/** Prepare first; real inference requires a fresh approval of this immutable finite plan. */
import assert from 'node:assert/strict';
import {readFile,writeFile,readdir,lstat,mkdir,appendFile} from 'node:fs/promises';
import {join,resolve,dirname,relative} from 'node:path';
import {pathToFileURL} from 'node:url';
import {INPUT_ADAPTABILITY_CASES,referenceIntent,duplicateIntent} from '../examples/input-adaptability-v1/suite.mjs';
import {INPUT_ADAPTABILITY_REPAIR_CASES} from '../examples/input-adaptability-v2/suite.mjs';
import {INPUT_CAPABILITY_CASES} from '../examples/input-adaptability-v3/suite.mjs';
import {CLARIFICATION_CLOSEOUT_CASES} from '../examples/input-adaptability-v4/suite.mjs';
import {REFERENCE_EIGHT_CASES} from '../examples/reference-eight-v1/suite.mjs';
import {SKILL_LAYOUT_CASES} from '../examples/skill-layout-comparison-v1/suite.mjs';
import {PROMPT_LAYOUT_CASES} from '../examples/skill-layout-comparison-v2/suite.mjs';
import {SHORT_INPUT_CASES} from '../examples/short-input-comparison-v1/suite.mjs';
import {draftReviewRecord} from './lib/open-draft-evaluation.mjs';
import {buildConciseDesignPrompt} from './lib/concise-design-prompt.mjs';
import {loadDesignRules,applyDesignRules,frozenPromptTransport} from './lib/design-comparison.mjs';
import {buildCodexPlanningPrompt} from '../src/codex-planner.mjs';
import {request as fullRequest,intent as fullIntent} from '../examples/all-components-v1/fixture.mjs';
import {imageAssetPool} from '../examples/image-slots-v1/assets.mjs';
import {harnessRoot,readJson,writeNewJson,createOutputDirectory} from '../src/io.mjs';
import {digestBytes,digestJson,canonicalJson} from '../src/canonical.mjs';
import {loadWorkspaceCore} from '../src/component-adapter.mjs';
import {createWorkbenchModel} from '../src/workbench-model.mjs';
import {materializePanelIntent,buildNativePanelIntentResponseSchema} from '../src/panel-intent.mjs';
import {materializeCodexEditDraft} from '../src/codex-edit-draft.mjs';
import {buildCodexEditResponseSchema} from '../src/codex-edit-schema.mjs';
import {checkPanelProposal,validatePanelProposal} from '../src/proposal.mjs';
import {checkPanelEditProposal,validatePanelEditProposal} from '../src/edit-planning.mjs';
import {validatePanelBundle} from '../src/panel-bundle.mjs';
import {applyPanelPatch} from '../src/patch.mjs';
import {planWithCodex,editWithCodex,validateCodexReceipt,validateCodexEditReceipt} from '../src/codex-planner.mjs';
import {checkCodexLoginVisibility} from '../src/codex-runtime-preflight.mjs';
import {checkAdaptabilityResult,businessFacts} from './lib/input-adaptability-oracle.mjs';

const policy=Object.freeze({model:'gpt-6-luna',effort:'xhigh',maxInvocations:24,attemptsPerCase:1,automaticRetries:0,concurrency:1,timeoutMs:900000,
  continueAfter:'independent-completed-semantic-or-validation-failure',stopAfter:'indeterminate-transport-or-missing-receipt',retryFailedCases:false});
const designCohort=cohort=>['skill-layout-v1','skill-layout-v2','short-input-v1'].includes(cohort);
const casesFor=cohort=>{assert(['baseline','repair-v1','capability-v1','closeout-v1','reference-eight-v1','skill-layout-v1','skill-layout-v2','short-input-v1'].includes(cohort),'ADAPT_COHORT');return cohort==='short-input-v1'?SHORT_INPUT_CASES:cohort==='baseline'?INPUT_ADAPTABILITY_CASES:cohort==='repair-v1'?INPUT_ADAPTABILITY_REPAIR_CASES:cohort==='capability-v1'?INPUT_CAPABILITY_CASES:cohort==='closeout-v1'?CLARIFICATION_CLOSEOUT_CASES:cohort==='reference-eight-v1'?REFERENCE_EIGHT_CASES:cohort==='skill-layout-v2'?PROMPT_LAYOUT_CASES:SKILL_LAYOUT_CASES;};
const policyFor=cohort=>({...policy,maxInvocations:casesFor(cohort).length});
function cohortCatalog(cohort,catalog){
  if(!designCohort(cohort))return catalog;
  const themes=catalog.themes.filter(theme=>theme.id==='modern-mint-light'&&theme.version==='0.21.0');assert.equal(themes.length,1,'ADAPT_DESIGN_THEME');
  return {...catalog,themes};
}
const safeCode=error=>/^ADAPT_[A-Z0-9_]+$/.test(String(error?.message??'').split('\n')[0])?String(error.message).split('\n')[0]
  : /^[A-Z][A-Z0-9_]{1,100}$/.test(error?.code??'')?error.code:'ADAPT_CHECK_FAILED';
const scoped=path=>{const rel=relative(harnessRoot,resolve(path));assert(rel&&!rel.startsWith('..')&&!/^(?:[A-Za-z]:|[/\\])/.test(rel),'ADAPT_PATH');return resolve(path);};
const fileHashes=async()=>{
  const paths=['scripts/input-adaptability.mjs','scripts/lib/input-adaptability-oracle.mjs','scripts/build-delivery-runtime.mjs','scripts/lib/concise-design-prompt.mjs','examples/skill-layout-comparison-v2/suite.mjs','examples/short-input-comparison-v1/suite.mjs','scripts/lib/open-draft-evaluation.mjs',
    'scripts/lib/workspace-tools.mjs','scripts/lib/design-comparison.mjs','scripts/review-skill-layout.mjs','scripts/check-input-adaptability-browser.mjs','scripts/summarize-input-adaptability.mjs',
    'examples/input-adaptability-v1/suite.mjs','examples/input-adaptability-v2/suite.mjs','examples/input-adaptability-v3/suite.mjs','examples/input-adaptability-v4/suite.mjs','examples/reference-eight-v1/suite.mjs','examples/skill-layout-comparison-v1/suite.mjs','examples/all-components-v1/fixture.mjs','examples/image-slots-v1/assets.mjs',
    '../ui-reference-harness/web/template-previews.mjs','../ui-reference-harness/web/examples/sdk-panels.mjs','../ui-reference-harness/web/examples/sdk-fixed-panels.mjs','../ui-reference-harness/web/examples/presentation-layouts.mjs',
    'examples/modern-all-components.catalog.json','../ui-component-harness/package.json','../ui-component-harness/package-lock.json'];
  for(const directory of ['src','schemas','prompts','adapters/unity','../ui-component-harness/src','../ui-component-harness/lib']){
    for(const item of await readdir(resolve(harnessRoot,directory),{recursive:true,withFileTypes:true}))
      if(item.isFile()&&/\.(mjs|js|ts|cs|json|md|meta)$/.test(item.name))paths.push(relative(harnessRoot,join(item.parentPath??item.path,item.name)).replaceAll('\\','/'));
  }
  return Promise.all([...new Set(paths)].sort().map(async path=>({path,sha256:await digestBytes(await readFile(resolve(harnessRoot,path)))})));
};

export function editReference(context,item) {
  const clarification=item.clarification;
  return {codexEditDraftVersion:'0.3',contextSha256:context.sha256,noChange:null,
    patch:clarification?null:{patchVersion:'0.1',baseSpecSha256:context.baseSpecSha256,reason:item.request.text,operations:item.operations},
    bases:clarification?null:item.operations.map(()=>({kind:'request-interpretation',quote:item.request.text})),
    unresolved:clarification?[{id:'q0',question:clarification.question}]:[]};
}

async function sourcesFor(seed,core) {
  const model=await createWorkbenchModel(seed,core);
  try{
    const context=(await model.prepare(fullRequest)).context;
    await model.acceptProposal(await materializePanelIntent(context,fullIntent(context)));
    const bundle=await model.exportPanel();
    const trial={...bundle.state,row0:13,row8:false,row9:'option0',row10:'option5',row11:false,navigation:'page1'};
    await model.importPanel(bundle,trial);const full=await model.exportPanel();
    const duplicateRequest={requestVersion:'0.1',id:'duplicate-checkboxes',target:'pixi',text:'左侧和右侧两个分组，各有一个名为提示的 CheckBox。左侧默认不勾选，右侧默认勾选，全部启用。'};
    const duplicateContext=(await model.prepare(duplicateRequest)).context;
    await model.acceptProposal(await materializePanelIntent(duplicateContext,duplicateIntent(duplicateContext)));
    return {full,duplicates:await model.exportPanel()};
  }finally{model.dispose();}
}

/** All answers below are offline driver fixtures, labelled as such, never model success. */
async function designPayload(context,item,designs){
  const rules=designs.arms[item.ruleArm??item.designArm];assert(rules,'ADAPT_DESIGN_ARM');
  const basePrompt=await buildCodexPlanningPrompt(context),selectedBase=['concise','draft-first'].includes(item.promptProfile)?buildConciseDesignPrompt(context,{draftFirst:item.promptProfile==='draft-first'}):basePrompt,prompt=applyDesignRules(selectedBase,rules.text);
  return {kind:'EXPERIMENTAL_DESIGN_EXCERPTS_NOT_COMPLETE_SKILL',arm:item.designArm,panelCaseId:item.panelCaseId,
    ...(item.promptProfile?{promptProfile:item.promptProfile,ruleArm:item.ruleArm,selectedBasePromptSha256:await digestBytes(new TextEncoder().encode(selectedBase)),selectedBaseCharacters:selectedBase.length}:{}),
    basePrompt,prompt,basePromptSha256:await digestBytes(new TextEncoder().encode(basePrompt)),promptSha256:await digestBytes(new TextEncoder().encode(prompt)),
    guidanceSha256:await digestBytes(new TextEncoder().encode(rules.text)),guidanceCharacters:rules.text.length,
    estimatedGuidanceTokens:Math.ceil(rules.text.length/4),estimateMethod:'characters-divided-by-4-not-provider-tokenizer',selections:rules.selections};
}

export async function prepareAdaptability(output,{cohort='baseline',designSources}={}) {
  const suite=casesFor(cohort),batchPolicy=policyFor(cohort);
  assert(designCohort(cohort)===Boolean(designSources),'ADAPT_DESIGN_SOURCES');
  const designs=designSources?await loadDesignRules(scoped(designSources)):null;
  const seed={catalog:cohortCatalog(cohort,await readJson(resolve(harnessRoot,'examples/modern-all-components.catalog.json'))),pool:await imageAssetPool()};
  const core=await loadWorkspaceCore(),sources=suite.some(item=>item.operation==='edit')?await sourcesFor(seed,core):null,prepared=[];
  for(const item of suite){
    const model=await createWorkbenchModel(seed,core);
    try{
      let context,schema,source,expectedSpec,proposal;
      if(item.operation==='generate'){
        context=(await model.prepare(item.request)).context;schema=buildNativePanelIntentResponseSchema(context);
        proposal=await materializePanelIntent(context,referenceIntent(context,item));expectedSpec=proposal.spec;
        const report=await checkPanelProposal(context,proposal);
        await model.acceptProposal(proposal);const after=model.getSnapshot().panel;
        checkAdaptabilityResult(item,{proposal,report},{expectedSpec,after});
        if(after)await validatePanelBundle(after,core);
      }else{
        source=sources[item.source??'full'];await model.importPanel(source);
        context=(await model.prepareEdit(item.request,item.selection??null)).context;
        schema=await buildCodexEditResponseSchema({draft:true,context});
        proposal=await materializeCodexEditDraft(context,editReference(context,item));
        const report=await checkPanelEditProposal(context,proposal);
        expectedSpec=item.clarification?null:(await applyPanelPatch(source.spec,proposal.patch)).spec;
        await model.acceptEditProposal(proposal);
        const after=await model.exportPanel();checkAdaptabilityResult(item,{proposal,report},{expectedSpec,before:source,after});
        if(!item.clarification){await model.undo();assert.deepEqual(await model.exportPanel(),source,'ADAPT_UNDO');}
      }
      prepared.push({item,context,schema,source:source??null,expectedSpec});
    }finally{model.dispose();}
  }
  const directory=await createOutputDirectory(output),cases=[];
  if(designs){await mkdir(join(directory,'design-sources'));for(const file of ['sources.json',...designs.manifest.files.map(file=>file.name)])await writeFile(join(directory,'design-sources',file),await readFile(join(scoped(designSources),file)),{flag:'wx'});}
  for(const entry of prepared){
    const {item,context,schema,source,expectedSpec}=entry,prefix=item.id;
    const files=[{name:prefix+'.context.json',value:context},{name:prefix+'.schema.json',value:schema},
      {name:prefix+'.expectation.json',value:{kind:item.evaluation?'OPEN_CONSTRAINTS_NOT_UNIQUE_ANSWER':'HUMAN_AUTHORED_REFERENCE_NOT_MODEL_OUTPUT',case:item,expectedSpec:item.evaluation?null:expectedSpec}}];
    if(designs)files.push({name:prefix+'.design.json',value:await designPayload(context,item,designs)});
    if(source)files.push({name:prefix+'.source.panel.bundle.json',value:source});
    for(const file of files)await writeNewJson(directory,file.name,file.value);
    cases.push({id:prefix,operation:item.operation,category:item.category,contextSha256:context.sha256,
      expectedOutcome:item.evaluation?'DRAFT_OR_CLARIFICATION_REVIEW_REQUIRED':item.clarification?'NEEDS_INPUT':item.operation==='edit'?'READY_TO_APPLY':'READY_TO_COMPILE',...(designs?{designArm:item.designArm,panelCaseId:item.panelCaseId}:{}),
      files:await Promise.all(files.map(async file=>({name:file.name,sha256:await digestBytes(await readFile(join(directory,file.name)))})))});
  }
  const payload={inputAdaptabilityPlanVersion:cohort==='baseline'?'0.1':'0.2',cohort,authorization:'REQUIRED_NOT_GRANTED',policy:batchPolicy,sourceFiles:await fileHashes(),
    ...(designs?{designComparison:{sourceManifestSha256:designs.manifestSha256,sourceFiles:designs.manifest.files,
      mode:cohort==='short-input-v1'?'SHORT_REQUEST_DRAFT_POLICY_AND_SKILL_REVIEW':cohort==='skill-layout-v2'?'PRODUCTION_CONTROL_VS_CONCISE_WITH_SELECTED_EXCERPTS':'SELECTED_EXCERPTS_COMMON_PRODUCTION_BASE_AND_ENVELOPE',compiler:'0.32.0',theme:'modern-mint-light@0.21.0',casesPerArm:new Set(suite.map(item=>item.panelCaseId)).size,arms:[...new Set(suite.map(item=>item.designArm))],
      visualReview:'BLINDED_HUMAN_REVIEW_PENDING',repetitionsPerCase:1,populationRanking:'NOT_ESTABLISHED'}}:{}),
    ...(cohort==='short-input-v1'?{evaluation:'TECHNICAL_AND_EXPLICIT_CONSTRAINTS_ONLY_HUMAN_REVIEW_REQUIRED'}:{}),
    catalogSha256:await digestJson(seed.catalog),poolSha256:seed.pool.sha256,sourceKind:sources?'PROGRAMMATIC_EDIT_BASES':'NO_EDIT_BASES',
    casePolicy:'Each case independently starts from its exact frozen context and, for editing, the declared fixture source. Expectations are never sent to the model.',
    cases,driverSimulation:{status:'PASS',cases:prepared.length,realModelCalls:0},
    acceptance:['independent-business-facts','literal-copy-and-defaults','correct-specific-clarification','preserve-edit-identities-and-live-state','compile-and-export-reopen','undo-edit'],
    browser:'SEPARATE_REQUIRED_FOR_SUCCESSFUL_PANELS',unityNative:'NOT_RUN_THIS_COHORT',repeatedInputStability:'NOT_MEASURED'};
  const plan={...payload,sha256:await digestJson(payload)};await writeNewJson(directory,'input-adaptability-plan.json',plan);
  const escape=value=>value.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
  const review=cohort==='short-input-v1'?[
    '# 简短自然输入对照计划','',`计划 SHA-256：${plan.sha256}`,
    '12条输入 × 3组，共36次：严格精简提示、允许先出草稿、允许先出草稿加game-ui-design摘录。当前真实调用0。',
    '8条开放需求没有唯一标准面板；4条明确约束只核对明确内容。出草稿、澄清、技术失败分别记录。内容合理性、澄清必要性和视觉质量等待人工审阅。',
    '没有往用户输入追加主题、尺寸、控件清单或默认值。系统提示、固定目录和schema属于单独的运行环境。驱动夹具仅验证程序链路，不作为模型答案。',
    ...prepared.flatMap(({item})=>[`## ${item.id} · ${item.designArm}`,item.request.text,JSON.stringify(item.evaluation,null,2),''])
  ].join('\n\n'):['# 输入适应性固定验收批次','',`计划 SHA-256：${plan.sha256}`,'',
    `${suite.filter(item=>item.operation==='generate').length} 项生成、${suite.filter(item=>item.operation==='edit').length} 项编辑；${suite.filter(item=>!item.clarification).length} 项应生成/修改成功、${suite.filter(item=>item.clarification).length} 项应具体澄清。`,
    `模型 gpt-6-luna / xhigh，最多${suite.length}次，每项一次、串行、自动重试0次。传输不确定立即停止；已完成的独立失败保留并继续其他案例。`,
    sources?'编辑起点是明确标记的程序夹具，当前试玩值与创作初值分开；不是重新生成或伪装的真实样本。':'本批仅生成，不包含编辑起点；旧失败与旧授权不复用。',
    '准备阶段真实模型调用0；当前计划尚未获计算批准。','',
    ...prepared.flatMap(({item,context,expectedSpec})=>[`## ${item.id} · ${item.category}`,`预期：${item.clarification?'针对本项的具体澄清':item.operation==='edit'?'精确修改并保持其他属性与试玩值':'生成并匹配业务事实'}`,`上下文：${context.sha256}`,'',item.request.text,'',
      '```json',JSON.stringify(item.clarification??(item.operation==='edit'?{selection:item.selection??null,operations:item.operations}:businessFacts(expectedSpec)),null,2),'```',''])].join('\n');
  await writeFile(join(directory,'review.md'),review+'\n',{flag:'wx'});
  await writeFile(join(directory,'index.html'),'<!doctype html><meta charset="utf-8"><title>输入适应性验收计划</title><pre style="white-space:pre-wrap;max-width:1100px;margin:30px auto;font:15px/1.6 system-ui">'+escape(review)+'</pre>',{flag:'wx'});
  return plan;
}

export async function verifyAdaptability(prepared,{checkLogin=true}={}) {
  const directory=scoped(prepared),plan=await readJson(join(directory,'input-adaptability-plan.json')),{sha256,...payload}=plan;
  const cohort=plan.cohort??'baseline',suite=casesFor(cohort);
  assert.equal(await digestJson(payload),sha256,'ADAPT_PLAN_DIGEST');assert.deepEqual(plan.policy,policyFor(cohort),'ADAPT_POLICY');
  assert.equal(plan.inputAdaptabilityPlanVersion,cohort==='baseline'?'0.1':'0.2','ADAPT_PLAN_VERSION');
  assert.equal(plan.authorization,'REQUIRED_NOT_GRANTED','ADAPT_APPROVAL_STATE');
  assert.deepEqual(plan.sourceFiles,await fileHashes(),'ADAPT_SOURCE_CHANGED');assert.equal(plan.cases.length,suite.length,'ADAPT_CASE_COUNT');
  const designs=designCohort(cohort)?await loadDesignRules(join(directory,'design-sources')):null;
  if(designs){assert.equal(designs.manifestSha256,plan.designComparison.sourceManifestSha256);assert.deepEqual(designs.manifest.files,plan.designComparison.sourceFiles);}
  for(let i=0;i<plan.cases.length;i++){
    const entry=plan.cases[i];assert.equal(entry.id,suite[i].id,'ADAPT_CASE_ORDER');
    for(const file of entry.files){assert(/^[A-Za-z0-9._-]+$/.test(file.name),'ADAPT_FILE_PATH');assert.equal(await digestBytes(await readFile(join(directory,file.name))),file.sha256,'ADAPT_FILE_CHANGED');}
    const expectation=await readJson(join(directory,entry.id+'.expectation.json'));
    assert.deepEqual(expectation.case,suite[i],'ADAPT_CASE_CHANGED');
    const context=await readJson(join(directory,entry.id+'.context.json'));assert.equal(context.sha256,entry.contextSha256,'ADAPT_CONTEXT_CHANGED');
    const schema=entry.operation==='edit'?await buildCodexEditResponseSchema({draft:true,context}):buildNativePanelIntentResponseSchema(context);
    assert.deepEqual(schema,await readJson(join(directory,entry.id+'.schema.json')),'ADAPT_SCHEMA_CHANGED');
    if(designs)assert.deepEqual(await readJson(join(directory,entry.id+'.design.json')),await designPayload(context,suite[i],designs),'ADAPT_DESIGN_PROMPT_CHANGED');
  }
  await assert.rejects(lstat(join(directory,'dispatch-claim.json')),{code:'ENOENT'});
  if(checkLogin){const preflight=checkCodexLoginVisibility({cwd:harnessRoot});assert.equal(preflight.status,'PASS',preflight.code);}
  return plan;
}

async function saveDelivery(directory,bundle,core,runtime,sources) {
  const {createUnityKitFiles}=await import('../src/unity-kit.mjs'),{createPanelDelivery}=await import('../src/panel-delivery.mjs'),{createStoredZip}=await import('../src/zip-store.mjs');
  const {readStoredZip}=await import('../tests/unity-kit-helpers.mjs');
  const kit=await createUnityKitFiles(bundle,core,sources),delivery=await createPanelDelivery(bundle,core,{runtime,unityKit:kit});
  const bytes=createStoredZip(delivery.contents),files=readStoredZip(bytes);
  for(const file of delivery.manifest.files){assert.equal(files.get(file.path).length,file.bytes,'ADAPT_ZIP_BYTES');assert.equal(await digestBytes(files.get(file.path)),file.sha256,'ADAPT_ZIP_HASH');}
  await writeFile(join(directory,'panel.zip'),bytes,{flag:'wx'});
  for(const [name,content]of files){assert(/^[A-Za-z0-9_.@/-]+$/.test(name)&&name.split('/').every(part=>part&&!['.','..'].includes(part)),'ADAPT_ZIP_PATH');
    const destination=join(directory,'delivery',name);await mkdir(dirname(destination),{recursive:true});await writeFile(destination,content,{flag:'wx'});}
  return {path:'panel.zip',bytes:bytes.length,sha256:await digestBytes(bytes)};
}

/** A consumed plan cannot be rerun. This runner does not grant its own authorization. */
export async function runAdaptability({prepared,approvedDigest,output}) {
  const plan=await verifyAdaptability(prepared);assert.equal(approvedDigest,plan.sha256,'ADAPT_APPROVAL_DIGEST');
  const {buildDeliveryRuntime}=await import('./build-delivery-runtime.mjs'),{readUnityAdapterSources}=await import('../src/unity-export-io.mjs');
  const runtime=await buildDeliveryRuntime(),unitySources=await readUnityAdapterSources(),core=await loadWorkspaceCore();
  const seed={catalog:cohortCatalog(plan.cohort,await readJson(resolve(harnessRoot,'examples/modern-all-components.catalog.json'))),pool:await imageAssetPool()};
  assert.equal(await digestJson(seed.catalog),plan.catalogSha256,'ADAPT_CATALOG_CHANGED');assert.equal(seed.pool.sha256,plan.poolSha256,'ADAPT_POOL_CHANGED');
  const directory=await createOutputDirectory(output),consumption={planSha256:plan.sha256,caseBindings:plan.cases.map(({id,contextSha256})=>({id,contextSha256})),maxInvocations:plan.policy.maxInvocations,automaticRetries:0};
  await writeNewJson(resolve(prepared),'dispatch-claim.json',consumption);await writeNewJson(directory,'approved-plan.json',plan);
  const results=[];let stopped=false;
  for(const item of casesFor(plan.cohort??'baseline')){
    if(stopped){results.push({id:item.id,status:'NOT_RUN',reason:'STOPPED_AFTER_INDETERMINATE_TRANSPORT'});continue;}
    const model=await createWorkbenchModel(seed,core),caseDirectory=await createOutputDirectory(join(directory,item.id));
    let context,before,receipt,diagnostic,result,after;
    try{
      if(item.operation==='edit'){before=await readJson(join(prepared,item.id+'.source.panel.bundle.json'));await model.importPanel(before);
        context=(await model.prepareEdit(item.request,item.selection??null)).context;
      }else context=(await model.prepare(item.request)).context;
      assert.deepEqual(context,await readJson(join(prepared,item.id+'.context.json')),'ADAPT_CONTEXT_CHANGED');
      let designOptions={};
      if(item.designArm){const design=await readJson(join(prepared,item.id+'.design.json'));
        assert.equal(await buildCodexPlanningPrompt(context),design.basePrompt,'ADAPT_DESIGN_PROMPT_CHANGED');
        await writeNewJson(caseDirectory,'design-evidence.json',{arm:item.designArm,panelCaseId:item.panelCaseId,basePromptSha256:design.basePromptSha256,promptSha256:design.promptSha256,guidanceSha256:design.guidanceSha256});
        designOptions={runProcess:frozenPromptTransport(design.basePrompt,design.prompt,undefined,async prompt=>writeNewJson(caseDirectory,'prompt-sent.json',{
          promptSha256:await digestBytes(new TextEncoder().encode(prompt)),bytes:Buffer.byteLength(prompt),arm:item.designArm,panelCaseId:item.panelCaseId}))};
      }
      result=await(item.operation==='edit'?editWithCodex:planWithCodex)(context,{outputRoot:caseDirectory,timeoutMs:plan.policy.timeoutMs,...designOptions});
      receipt=(item.operation==='edit'?validateCodexEditReceipt:validateCodexReceipt)(result.receipt,{contextSha256:context.sha256,proposalSha256:result.report.proposalSha256});
      const validate=item.operation==='edit'?validatePanelEditProposal:validatePanelProposal,check=item.operation==='edit'?checkPanelEditProposal:checkPanelProposal;
      assert.deepEqual(await validate(context,result.proposal),result.proposal,'ADAPT_PROPOSAL');assert.deepEqual(await check(context,result.proposal),result.report,'ADAPT_REPORT');
      assert.equal(receipt.invocationCount,1,'ADAPT_INVOCATIONS');assert.equal(receipt.automaticRetries,0,'ADAPT_RETRY');
      if(item.operation==='edit'){await model.acceptEditProposal(result.proposal);after=await model.exportPanel();}
      else {await model.acceptProposal(result.proposal);after=model.getSnapshot().panel;}
      if(after)await writeNewJson(caseDirectory,'candidate.panel.bundle.json',after);
      const expectation=await readJson(join(prepared,item.id+'.expectation.json'));
      checkAdaptabilityResult(item,result,{expectedSpec:expectation.expectedSpec,before,after});
      let delivery=null;
      if(item.evaluation)await writeNewJson(caseDirectory,'draft-review.json',draftReviewRecord(item,result,result.proposal.spec?businessFacts(result.proposal.spec):null));
      if(result.report.status!=='NEEDS_INPUT'){await validatePanelBundle(after,core);await writeNewJson(caseDirectory,'panel.bundle.json',after);
        const reopen=await createWorkbenchModel({catalog:seed.catalog,pool:null},core);try{await reopen.importPanel(after);assert.deepEqual(await reopen.exportPanel(),after,'ADAPT_REOPEN');}finally{reopen.dispose();}
        if(item.operation==='edit'){await model.undo();assert.deepEqual(await model.exportPanel(),before,'ADAPT_UNDO');}
        delivery=await saveDelivery(caseDirectory,after,core,runtime,unitySources);
      }
      results.push({id:item.id,status:'PASS',outcome:result.report.status,receipt,delivery,browser:delivery?'NOT_RUN':'NOT_APPLICABLE',...(item.evaluation?{review:'HUMAN_REVIEW_REQUIRED'}:{})});
    }catch(error){
      receipt??=error.receipt;diagnostic=error.diagnostic??null;
      // Completed invalid output is a failed independent case. Transport uncertainty stops the cohort.
      stopped=!receipt||/_NO_RETRY$/.test(receipt.failureCode??'');
      results.push({id:item.id,status:'FAIL',code:safeCode(error),receipt:receipt??null,diagnostic,indeterminate:stopped});
    }finally{model.dispose();}
    const latest=results.at(-1);await writeNewJson(caseDirectory,'acceptance.json',latest);
    await appendFile(join(directory,'progress.ndjson'),canonicalJson({id:latest.id,status:latest.status,code:latest.code??null})+'\n');
    process.stdout.write(JSON.stringify({id:latest.id,status:latest.status,code:latest.code??null})+'\n');
  }
  const report={inputAdaptabilityReportVersion:'0.1',cohort:plan.cohort??'baseline',expectedCases:plan.cases.length,maxInvocations:plan.policy.maxInvocations,
    status:results.every(item=>item.status==='PASS')?'PASS_BEFORE_BROWSER':'FAIL',...(plan.evaluation?{evaluation:plan.evaluation,humanReview:'NOT_RECORDED',passMeaning:'Protocol and explicit constraints only; not content quality or clarification necessity.',
      outcomes:{draft:results.filter(item=>item.status==='PASS'&&item.outcome==='READY_TO_COMPILE').length,clarification:results.filter(item=>item.status==='PASS'&&item.outcome==='NEEDS_INPUT').length,failed:results.filter(item=>item.status==='FAIL').length,notRun:results.filter(item=>item.status==='NOT_RUN').length}}:{}),planSha256:plan.sha256,
    realModelCalls:results.reduce((sum,item)=>sum+(item.receipt?.invocationCount??0),0),automaticRetries:0,
    pass:results.filter(item=>item.status==='PASS').length,fail:results.filter(item=>item.status==='FAIL').length,notRun:results.filter(item=>item.status==='NOT_RUN').length,
    results,browser:'NOT_RUN',unityNative:'NOT_RUN_THIS_COHORT',repeatedInputStability:'NOT_MEASURED'};
  await writeNewJson(directory,'input-adaptability-report.json',report);return report;
}

if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
  try{
    const args=process.argv.slice(2),mode=args.shift(),options={};
    assert(['prepare','preflight','run'].includes(mode),'ADAPT_ARGUMENTS');
    for(let i=0;i<args.length;i+=2){assert(['--output','--prepared','--approve-plan','--cohort','--design-sources'].includes(args[i])&&args[i+1]&&!options[args[i]],'ADAPT_ARGUMENTS');options[args[i]]=args[i+1];}
    let result;
    if(mode==='prepare'){assert(options['--output']&&Object.keys(options).every(key=>['--output','--cohort','--design-sources'].includes(key)),'ADAPT_ARGUMENTS');const plan=await prepareAdaptability(options['--output'],{cohort:options['--cohort']??'baseline',designSources:options['--design-sources']});result={status:'PREPARED',planSha256:plan.sha256,cases:plan.cases.length,maxInvocations:plan.policy.maxInvocations,realModelCalls:0};}
    else if(mode==='preflight'){assert.deepEqual(Object.keys(options),['--prepared']);const plan=await verifyAdaptability(options['--prepared']);result={status:'PREFLIGHT_PASS',planSha256:plan.sha256,cases:plan.cases.length,realModelCalls:0,claim:'UNCONSUMED'};}
    else {assert.deepEqual(Object.keys(options).sort(),['--approve-plan','--output','--prepared'],'ADAPT_ARGUMENTS');result=await runAdaptability({prepared:options['--prepared'],approvedDigest:options['--approve-plan'],output:options['--output']});if(result.status!=='PASS_BEFORE_BROWSER')process.exitCode=1;}
    process.stdout.write(JSON.stringify(result)+'\n');
  }catch(error){process.stderr.write(JSON.stringify({status:'FAIL',code:safeCode(error),detail:error.code==='ERR_ASSERTION'?String(error.message).split('\n')[0]:undefined})+'\n');process.exitCode=1;}
}
