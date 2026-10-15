#!/usr/bin/env node
import {INVENTORY_GRID_SUITE,inventoryGridFixture} from '../examples/inventory-grid-v1/suite.mjs';
import {CARD_TARGET_DEFAULT_SUITE,cardTargetDefaultFixture} from '../examples/card-target-default-v1/suite.mjs';
import {CARD_CONTENT_CLOSEOUT_SUITE,cardContentCloseoutFixture} from '../examples/card-content-closeout-v1/suite.mjs';
import {SECTION_PANEL_TEN_SUITE,sectionPanelTenFixture} from '../examples/section-panels-ten-v1/suite.mjs';
import {DEFAULT_PANEL_CATALOG} from '../src/default-catalog.mjs';
import {READABLE_HEADING_SUITE,READABLE_HEADING_SOURCE_PLAN_SHA256} from '../examples/readable-heading-v1/suite.mjs';
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
import {COMMON_GAME_PANEL_SUITE,commonGamePanelFixture} from '../examples/common-game-panels-v1/suite.mjs';
import {COMMON_GAME_PANEL_FIX_SUITE,SOURCE_COMMON_PLAN_SHA256} from '../examples/common-game-panels-fix-v1/suite.mjs';
import {PANEL_STABILITY_SUITE,STABILITY_SOURCE_PLAN_SHA256} from '../examples/panel-stability-v1/suite.mjs';
import {PANEL_STABILITY_FIX_SUITE,STABILITY_FIX_SOURCE_PLAN_SHA256} from '../examples/panel-stability-fix-v1/suite.mjs';
import {COMPACT_MESSAGE_SUITE,COMPACT_MESSAGE_SOURCE_PLAN_SHA256,compactMessageFixture} from '../examples/compact-message-v1/suite.mjs';
import {PANEL_COPY_FIX_SUITE,COPY_FIX_SOURCE_PLAN_SHA256,panelCopyFixFixture} from '../examples/panel-copy-fix-v1/suite.mjs';
import {buildCommonGamePanelPrompt} from './lib/common-game-panel-prompt.mjs';
import {DAILY_DEFAULT_SUITE,DAILY_CHOICE_FIX_SUITE,DAILY_CHOICE_FIX_SOURCE_PLAN_SHA256,dailyDefaultFixture} from '../examples/daily-defaults-v1/suite.mjs';
import {loadBundledCoreAssets} from '../src/bundled-core-assets.mjs';
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
const currentGamePanelCohort=cohort=>['inventory-grid-v1','card-target-default-v1','card-content-closeout-v1','section-panels-ten-v1'].includes(cohort);
const dailyCohort=cohort=>['inventory-grid-v1','card-target-default-v1','card-content-closeout-v1','section-panels-ten-v1','readable-layout-v1','readable-heading-v1','readable-game-v1','daily-defaults-v1','daily-choice-fix-v1'].includes(cohort);
const designCohort=cohort=>['skill-layout-v1','skill-layout-v2','short-input-v1'].includes(cohort);
const stabilityCohort=cohort=>['panel-stability-v1','panel-stability-fix-v1','panel-copy-fix-v1','panel-compact-message-v1'].includes(cohort);
const commonCohort=cohort=>['inventory-grid-v1','card-target-default-v1','card-content-closeout-v1','section-panels-ten-v1','readable-layout-v1','readable-heading-v1','readable-game-v1','daily-choice-fix-v1','daily-defaults-v1','common-panels-v1','common-panels-fix-v1','panel-stability-v1','panel-stability-fix-v1','panel-copy-fix-v1','panel-compact-message-v1'].includes(cohort);
const currentCommonCohort=cohort=>['inventory-grid-v1','card-target-default-v1','card-content-closeout-v1','section-panels-ten-v1','readable-layout-v1','readable-heading-v1','readable-game-v1','daily-choice-fix-v1','daily-defaults-v1','common-panels-fix-v1','panel-stability-v1','panel-stability-fix-v1','panel-copy-fix-v1','panel-compact-message-v1'].includes(cohort);
const casesFor=cohort=>{assert(['inventory-grid-v1','card-target-default-v1','card-content-closeout-v1','section-panels-ten-v1','readable-layout-v1','readable-heading-v1','readable-game-v1','daily-choice-fix-v1','daily-defaults-v1','baseline','repair-v1','capability-v1','closeout-v1','reference-eight-v1','skill-layout-v1','skill-layout-v2','short-input-v1','common-panels-v1','common-panels-fix-v1','panel-stability-v1','panel-stability-fix-v1','panel-copy-fix-v1','panel-compact-message-v1'].includes(cohort),'ADAPT_COHORT');return cohort==='inventory-grid-v1'?INVENTORY_GRID_SUITE:cohort==='card-target-default-v1'?CARD_TARGET_DEFAULT_SUITE:cohort==='card-content-closeout-v1'?CARD_CONTENT_CLOSEOUT_SUITE:currentGamePanelCohort(cohort)?SECTION_PANEL_TEN_SUITE:['readable-layout-v1','readable-heading-v1'].includes(cohort)?READABLE_HEADING_SUITE:cohort==='daily-choice-fix-v1'?DAILY_CHOICE_FIX_SUITE:['readable-layout-v1','readable-heading-v1','readable-game-v1','daily-defaults-v1'].includes(cohort)?DAILY_DEFAULT_SUITE:cohort==='panel-compact-message-v1'?COMPACT_MESSAGE_SUITE:cohort==='panel-copy-fix-v1'?PANEL_COPY_FIX_SUITE:['panel-stability-fix-v1','panel-copy-fix-v1','panel-compact-message-v1'].includes(cohort)?PANEL_STABILITY_FIX_SUITE:cohort==='panel-stability-v1'?PANEL_STABILITY_SUITE:cohort==='common-panels-fix-v1'?COMMON_GAME_PANEL_FIX_SUITE: commonCohort(cohort)?COMMON_GAME_PANEL_SUITE:cohort==='short-input-v1'?SHORT_INPUT_CASES:cohort==='baseline'?INPUT_ADAPTABILITY_CASES:cohort==='repair-v1'?INPUT_ADAPTABILITY_REPAIR_CASES:cohort==='capability-v1'?INPUT_CAPABILITY_CASES:cohort==='closeout-v1'?CLARIFICATION_CLOSEOUT_CASES:cohort==='reference-eight-v1'?REFERENCE_EIGHT_CASES:cohort==='skill-layout-v2'?PROMPT_LAYOUT_CASES:SKILL_LAYOUT_CASES;};
const policyFor=cohort=>({...policy,maxInvocations:casesFor(cohort).length});
function cohortCatalog(cohort,catalog){
  if(dailyCohort(cohort))return catalog;
  if(commonCohort(cohort))return {...catalog,themes:catalog.themes.filter(theme=>theme.id==='modern-mint-light')};
  if(!designCohort(cohort))return catalog;
  const themes=catalog.themes.filter(theme=>theme.id==='modern-mint-light'&&theme.version==='0.21.0');assert.equal(themes.length,1,'ADAPT_DESIGN_THEME');
  return {...catalog,themes};
}
const catalogFile=cohort=>currentGamePanelCohort(cohort)?DEFAULT_PANEL_CATALOG:cohort==='readable-layout-v1'?'examples/modern-readable-game-layout.catalog.json':cohort==='readable-heading-v1'?'examples/modern-readable-game-headings.catalog.json':cohort==='readable-game-v1'?'examples/modern-readable-game.catalog.json':['readable-layout-v1','readable-heading-v1','readable-game-v1','daily-choice-fix-v1','daily-defaults-v1','panel-compact-message-v1'].includes(cohort)?'examples/modern-compact-message.catalog.json':cohort==='panel-copy-fix-v1'?'examples/modern-message-copy.catalog.json':currentCommonCohort(cohort)?'examples/modern-tab-headings.catalog.json':commonCohort(cohort)?'examples/modern-action-headings.catalog.json':'examples/modern-all-components.catalog.json';
const cohortPool=async cohort=>dailyCohort(cohort)?loadBundledCoreAssets():stabilityCohort(cohort)?null:imageAssetPool();
const safeCode=error=>/^ADAPT_[A-Z0-9_]+$/.test(String(error?.message??'').split('\n')[0])?String(error.message).split('\n')[0]
  : /^[A-Z][A-Z0-9_]{1,100}$/.test(error?.code??'')?error.code:'ADAPT_CHECK_FAILED';
const scoped=path=>{const rel=relative(harnessRoot,resolve(path));assert(rel&&!rel.startsWith('..')&&!/^(?:[A-Za-z]:|[/\\])/.test(rel),'ADAPT_PATH');return resolve(path);};
const fileHashes=async()=>{
  const paths=['examples/inventory-grid-v1/fixture.mjs','examples/inventory-grid-v1/suite.mjs','examples/modern-readable-game-grid-layout.catalog.json','examples/card-target-default-v1/suite.mjs','examples/card-content-closeout-v1/suite.mjs','examples/modern-readable-game-card-layout.catalog.json','examples/modern-readable-game-item-groups.catalog.json','examples/modern-readable-game-data-panels.catalog.json','examples/modern-readable-game-data-layout.catalog.json','examples/modern-readable-game-grouped-layout.catalog.json','examples/section-panels-ten-v1/suite.mjs','examples/modern-readable-game-section-panels.catalog.json','examples/modern-readable-game-heading-panels.catalog.json','examples/modern-readable-game-layout.catalog.json','scripts/check-content-headings-browser.mjs','examples/readable-heading-v1/suite.mjs','examples/modern-readable-game-headings.catalog.json','examples/modern-readable-game.catalog.json','scripts/check-readable-game-browser.mjs','examples/daily-defaults-v1/suite.mjs','scripts/lib/studio-launcher.mjs','release/contract.json','examples/compact-message-v1/suite.mjs','examples/modern-compact-message.catalog.json','scripts/lib/compact-message-acceptance.mjs','scripts/input-adaptability.mjs','examples/panel-copy-fix-v1/suite.mjs','examples/modern-message-copy.catalog.json','scripts/lib/panel-copy-acceptance.mjs','examples/panel-stability-fix-v1/suite.mjs','scripts/lib/stability-fix-acceptance.mjs','examples/panel-stability-v1/suite.mjs','scripts/lib/panel-stability-review.mjs','scripts/lib/stability-interactions.mjs','examples/common-game-panels-fix-v1/suite.mjs','examples/modern-tab-headings.catalog.json','scripts/lib/acceptance-input.mjs','examples/common-game-panels-v1/suite.mjs','scripts/review-common-game-panels.mjs','scripts/lib/initial-panel-observation.mjs','scripts/lib/common-game-panel-prompt.mjs','scripts/lib/input-adaptability-oracle.mjs','scripts/build-delivery-runtime.mjs','scripts/lib/concise-design-prompt.mjs','examples/skill-layout-comparison-v2/suite.mjs','examples/short-input-comparison-v1/suite.mjs','scripts/lib/open-draft-evaluation.mjs',
    'scripts/lib/workspace-tools.mjs','scripts/lib/design-comparison.mjs','scripts/review-skill-layout.mjs','scripts/check-input-adaptability-browser.mjs','scripts/summarize-input-adaptability.mjs',
    'examples/input-adaptability-v1/suite.mjs','examples/input-adaptability-v2/suite.mjs','examples/input-adaptability-v3/suite.mjs','examples/input-adaptability-v4/suite.mjs','examples/reference-eight-v1/suite.mjs','examples/skill-layout-comparison-v1/suite.mjs','examples/all-components-v1/fixture.mjs','examples/image-slots-v1/assets.mjs',
    '../ui-reference-harness/web/template-previews.mjs','../ui-reference-harness/web/examples/sdk-panels.mjs','../ui-reference-harness/web/examples/sdk-fixed-panels.mjs','../ui-reference-harness/web/examples/presentation-layouts.mjs',
    'examples/modern-all-components.catalog.json','examples/modern-action-headings.catalog.json','../ui-component-harness/package.json','../ui-component-harness/package-lock.json'];
  for(const directory of ['assets/core-v1','src','schemas','prompts','adapters/unity','../ui-component-harness/src','../ui-component-harness/lib']){
    for(const item of await readdir(resolve(harnessRoot,directory),{recursive:true,withFileTypes:true}))
      if(item.isFile()&&/\.(mjs|js|ts|cs|json|md|meta|png|svg)$/.test(item.name))paths.push(relative(harnessRoot,join(item.parentPath??item.path,item.name)).replaceAll('\\','/'));
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
  if(item.designArm==='common-draft'){
    const basePrompt=await buildCodexPlanningPrompt(context),prompt=buildCommonGamePanelPrompt(context);
    return {kind:'COMMON_GAME_DRAFT_NO_SKILL',arm:item.designArm,promptProfile:'draft-first-measured-defaults',basePrompt,prompt,
      basePromptSha256:await digestBytes(new TextEncoder().encode(basePrompt)),promptSha256:await digestBytes(new TextEncoder().encode(prompt)),guidanceCharacters:0,selections:[]};
  }
  const rules=designs.arms[item.ruleArm??item.designArm];assert(rules,'ADAPT_DESIGN_ARM');
  const basePrompt=await buildCodexPlanningPrompt(context),selectedBase=['concise','draft-first'].includes(item.promptProfile)?buildConciseDesignPrompt(context,{draftFirst:item.promptProfile==='draft-first'}):basePrompt,prompt=applyDesignRules(selectedBase,rules.text);
  return {kind:'EXPERIMENTAL_DESIGN_EXCERPTS_NOT_COMPLETE_SKILL',arm:item.designArm,panelCaseId:item.panelCaseId,
    ...(item.promptProfile?{promptProfile:item.promptProfile,ruleArm:item.ruleArm,selectedBasePromptSha256:await digestBytes(new TextEncoder().encode(selectedBase)),selectedBaseCharacters:selectedBase.length}:{}),
    basePrompt,prompt,basePromptSha256:await digestBytes(new TextEncoder().encode(basePrompt)),promptSha256:await digestBytes(new TextEncoder().encode(prompt)),
    guidanceSha256:await digestBytes(new TextEncoder().encode(rules.text)),guidanceCharacters:rules.text.length,
    estimatedGuidanceTokens:Math.ceil(rules.text.length/4),estimateMethod:'characters-divided-by-4-not-provider-tokenizer',selections:rules.selections};
}

/** Evidence is strict JSON for both skill comparisons and a plain draft cohort. */
export function adaptabilityDesignEvidence(item,design){
  return {arm:item.designArm,...(item.panelCaseId?{panelCaseId:item.panelCaseId}:{}),
    basePromptSha256:design.basePromptSha256,promptSha256:design.promptSha256,
    ...(design.guidanceSha256?{guidanceSha256:design.guidanceSha256}:{})};
}
export async function adaptabilityPromptEvidence(item,prompt){
  return {promptSha256:await digestBytes(new TextEncoder().encode(prompt)),bytes:Buffer.byteLength(prompt),arm:item.designArm,
    ...(item.panelCaseId?{panelCaseId:item.panelCaseId}:{})};
}

export async function prepareAdaptability(output,{cohort='baseline',designSources}={}) {
  const suite=casesFor(cohort),batchPolicy=policyFor(cohort);
  assert(designCohort(cohort)===Boolean(designSources),'ADAPT_DESIGN_SOURCES');
  const designs=designSources?await loadDesignRules(scoped(designSources)):null;
  const seed={catalog:cohortCatalog(cohort,await readJson(resolve(harnessRoot,catalogFile(cohort)))),pool:await cohortPool(cohort)};
  const core=await loadWorkspaceCore(),sources=suite.some(item=>item.operation==='edit')?await sourcesFor(seed,core):null,prepared=[];
  for(const item of suite){
    const model=await createWorkbenchModel(seed,core);
    try{
      let context,schema,source,expectedSpec,proposal;
      if(item.operation==='generate'){
        context=(await model.prepare(item.request)).context;schema=buildNativePanelIntentResponseSchema(context);
        proposal=await materializePanelIntent(context,cohort==='inventory-grid-v1'?inventoryGridFixture(context,item):cohort==='card-target-default-v1'?cardTargetDefaultFixture(context,item,referenceIntent):cohort==='card-content-closeout-v1'?cardContentCloseoutFixture(context,item,referenceIntent):currentGamePanelCohort(cohort)?sectionPanelTenFixture(context,item,referenceIntent):dailyCohort(cohort)?dailyDefaultFixture(context,item,referenceIntent):cohort==='panel-compact-message-v1'?compactMessageFixture(context,item,referenceIntent):cohort==='panel-copy-fix-v1'?panelCopyFixFixture(context,item,referenceIntent):commonCohort(cohort)?commonGamePanelFixture(context,item,referenceIntent):referenceIntent(context,item));expectedSpec=proposal.spec;
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
    if(designs||commonCohort(cohort))files.push({name:prefix+'.design.json',value:await designPayload(context,item,designs)});
    if(source)files.push({name:prefix+'.source.panel.bundle.json',value:source});
    for(const file of files)await writeNewJson(directory,file.name,file.value);
    cases.push({id:prefix,operation:item.operation,category:item.category,contextSha256:context.sha256,...(item.stability?{stability:item.stability}:{}),
      expectedOutcome:item.evaluation?'DRAFT_OR_CLARIFICATION_REVIEW_REQUIRED':item.clarification?'NEEDS_INPUT':item.operation==='edit'?'READY_TO_APPLY':'READY_TO_COMPILE',...(designs||commonCohort(cohort)?{designArm:item.designArm,...(item.panelCaseId?{panelCaseId:item.panelCaseId}:{})}:{}),
      files:await Promise.all(files.map(async file=>({name:file.name,sha256:await digestBytes(await readFile(join(directory,file.name)))})))});
  }
  const payload={inputAdaptabilityPlanVersion:cohort==='baseline'?'0.1':'0.2',cohort,authorization:'REQUIRED_NOT_GRANTED',policy:batchPolicy,sourceFiles:await fileHashes(),
    ...(designs?{designComparison:{sourceManifestSha256:designs.manifestSha256,sourceFiles:designs.manifest.files,
      mode:cohort==='short-input-v1'?'SHORT_REQUEST_DRAFT_POLICY_AND_SKILL_REVIEW':cohort==='skill-layout-v2'?'PRODUCTION_CONTROL_VS_CONCISE_WITH_SELECTED_EXCERPTS':'SELECTED_EXCERPTS_COMMON_PRODUCTION_BASE_AND_ENVELOPE',compiler:'0.32.0',theme:'modern-mint-light@0.21.0',casesPerArm:new Set(suite.map(item=>item.panelCaseId)).size,arms:[...new Set(suite.map(item=>item.designArm))],
      visualReview:'BLINDED_HUMAN_REVIEW_PENDING',repetitionsPerCase:1,populationRanking:'NOT_ESTABLISHED'}}:{}),
    ...((cohort==='short-input-v1'||commonCohort(cohort))?{evaluation:'TECHNICAL_AND_EXPLICIT_CONSTRAINTS_ONLY_HUMAN_REVIEW_REQUIRED'}:{}),
    ...(currentGamePanelCohort(cohort)?{sectionPanelEvaluation:{scope:'REAL_CURRENT_DEFAULT_SHORT_INPUT_SAMPLES',catalogFile:DEFAULT_PANEL_CATALOG,compiler:cohort==='inventory-grid-v1'?'0.46.0':'0.45.0',headingSurface:'panel-v1',sectionSurface:'panel-v2',bodyFontSize:24,titleFontSize:32,prompt:'EXACT_SHARED_PRODUCTION_PROMPT',runtimeSkillInjection:'NONE',samples:suite.length,repetitionsPerCase:1,modelOutputs:'ORIGINAL_UNMODIFIED',humanVisualReview:'REQUIRED'}}:{}),
    ...(cohort==='card-target-default-v1'?{cardTargetAcceptance:{sourcePlanSha256:'71234ab2a2cfac8a3d1cfe09a2a58581e902a6d487c944981b235e736bc5d854',sourceFindingCases:['G14'],samples:2,defaultTarget:'UNSPECIFIED_REPEATED_WHOLE_ITEMS_DEFAULT_DESKTOP_LANDSCAPE',defaultCase:'G14',explicitMobileCase:'G14M',explicitMobilePriority:'COLUMN_REMAINS_BINDING',driverSpecimens:'NEVER_SENT_TO_MODEL',humanSemanticReview:'REQUIRED'}}:{}),
    ...(cohort==='card-content-closeout-v1'?{cardContentAcceptance:{sourcePlanSha256:'f3a162899af7643073f0f3ad0d0e55ef77832af497196156a4d363ac1e7cc90f',sourceFindingCases:['G25','G16'],samples:5,wideCardCases:['G25','G14','G16'],compactRegressionCases:['G03','G54'],viewportPolicy:'TARGETED_DESKTOP_FOR_WHOLE_ITEM_CARDS_COMPACT_PHONE_REGRESSIONS',achievement:'IDENTIFIABLE_ENTRIES_WITH_CONDITION_AND_PROGRESS_OR_STATE_NOT_NAMES_ONLY',sampleHonesty:'PROPOSED_CONTENT_AND_PROGRESS_VISIBLY_SAMPLE',layout:'NATIVE_ROW_GRID_COLUMN_NO_MANUAL_REGROUPING_OF_ORIGINAL_RESULTS',humanSemanticReview:'REQUIRED',driverSpecimens:'NEVER_SENT_TO_MODEL'}}:{}),
    ...(cohort==='readable-layout-v1'?{layoutEvaluation:{sourcePlanSha256:'cd11d7b74a78a99da07ccbcbf6d361988bf150854ac37eb867b15a164c49e9c3',sourceFailureCases:['G03'],scope:'VERSIONED_MIXED_CONTROL_LAYOUT_AND_MEASURED_HEIGHT',originalOutputs:'UNCHANGED'}}:{}),
    ...(['readable-layout-v1','readable-heading-v1'].includes(cohort)?{headingEvaluation:{sourcePlanSha256:READABLE_HEADING_SOURCE_PLAN_SHA256,sourceKnownVisualFindingCases:['G22'],headingPolicy:'concise-v5 / visible-v5',scope:'CONTENT_GROUP_COUNT_EXCLUDES_BUTTON_ONLY_SECTIONS',explicitHeadings:'PRESERVED',originalOutputs:'UNCHANGED'}}:{}),
    ...(dailyCohort(cohort)?{dailyDefaultEvaluation:{scope:currentGamePanelCohort(cohort)?'CURRENT_DEFAULT_SHORT_REQUEST_GROUP_SURFACES':cohort==='daily-choice-fix-v1'?'SINGLE_SELECTION_DEFAULT_CONSTRAINT_AND_DAILY_REGRESSIONS':'FULL_DAILY_STUDIO_SDK_CATALOG_AND_SHARED_RUNTIME_PROMPT',...(cohort==='daily-choice-fix-v1'?{sourcePlanSha256:DAILY_CHOICE_FIX_SOURCE_PLAN_SHA256,sourceFailureCases:['G22'],rawFailedIntent:'NOT_RETAINED_NO_AUTOMATIC_REPAIR'}:{}),purposes:suite.length,catalogThemes:seed.catalog.themes.length,builtinIcons:seed.pool.index.records.length,promptReplacement:'IDENTICAL_BYTE_STREAM',sourcePackage:'WORKSPACE_RUNTIME_WITH_SEPARATE_INSTALLED_SDK_ACCEPTANCE',artwork:'NO_GENERATED_ARTWORK',compiler:currentGamePanelCohort(cohort)?cohort==='inventory-grid-v1'?'0.46.0':'0.45.0':cohort==='readable-layout-v1'?'0.39.0':cohort==='readable-heading-v1'?'0.38.0':cohort==='readable-game-v1'?'0.37.0':'0.34.0_OR_0.36.0_FOR_COMPACT_MESSAGES',populationReliability:'NOT_ESTABLISHED'}}:{}),
    ...(commonCohort(cohort)?{commonPanelEvaluation:{...(stabilityCohort(cohort)?{scope:cohort==='panel-compact-message-v1'?'INTRINSIC_MESSAGE_HEIGHT_AND_CENTERED_SHORT_PROSE_ACTIONS':cohort==='panel-copy-fix-v1'?'UNLABELED_MESSAGE_AND_NEUTRAL_STATIC_PLACEHOLDER':['panel-stability-fix-v1','panel-copy-fix-v1','panel-compact-message-v1'].includes(cohort)?'FOCUSED_ARTWORK_FIT_AND_CONFIRMATION_OPERABILITY':'THREE_EXACT_TEXT_REPEATS_AND_ONE_COLLOQUIAL_VARIANT',sourcePlanSha256:cohort==='panel-compact-message-v1'?COMPACT_MESSAGE_SOURCE_PLAN_SHA256:cohort==='panel-copy-fix-v1'?COPY_FIX_SOURCE_PLAN_SHA256:['panel-stability-fix-v1','panel-copy-fix-v1','panel-compact-message-v1'].includes(cohort)?STABILITY_FIX_SOURCE_PLAN_SHA256:STABILITY_SOURCE_PLAN_SHA256,commonTypes:['panel-stability-fix-v1','panel-copy-fix-v1','panel-compact-message-v1'].includes(cohort)?2:8,repetitionsPerPurpose:3,colloquialVariants:['panel-stability-fix-v1','panel-copy-fix-v1','panel-compact-message-v1'].includes(cohort)?2:8,artwork:'NO_USER_ARTWORK_NO_TEST_IMAGE_POOL'}:dailyCohort(cohort)?{scope:currentGamePanelCohort(cohort)?'CURRENT_DEFAULT_SHORT_REQUEST_PURPOSES':cohort==='daily-choice-fix-v1'?'FOUR_SINGLE_SELECTION_DEFAULT_REGRESSIONS':'EIGHT_DAILY_DEFAULT_PURPOSES',commonTypes:suite.length,colloquialVariants:0,explicitConstraints:0}:cohort==='common-panels-fix-v1'?{scope:'PREVIOUS_FAILURES_AND_REVIEWED_REGRESSIONS',sourcePlanSha256:SOURCE_COMMON_PLAN_SHA256,previousFailures:23,layoutCases:8,contentCases:5,explicitRegressionCases:1}:{commonTypes:56,colloquialVariants:4,explicitConstraints:4}),modelConditions:1,compiler:currentGamePanelCohort(cohort)?cohort==='inventory-grid-v1'?'0.46.0':'0.45.0':cohort==='readable-layout-v1'?'0.39.0':cohort==='readable-heading-v1'?'0.38.0':cohort==='readable-game-v1'?'0.37.0':['daily-defaults-v1','panel-compact-message-v1'].includes(cohort)?'0.36.0_FOR_COMPACT_MESSAGE_OTHER_ROWS_0.34.0':cohort==='panel-copy-fix-v1'?'0.35.0_FOR_MESSAGE_TEXT_OTHER_ROWS_0.34.0':currentCommonCohort(cohort)?'0.34.0':'0.33.0',defaultTheme:currentGamePanelCohort(cohort)?'modern-mint-light@0.33.0':cohort==='readable-layout-v1'?'modern-mint-light@0.26.0':cohort==='readable-heading-v1'?'modern-mint-light@0.25.0':cohort==='readable-game-v1'?'modern-mint-light@0.24.0':currentCommonCohort(cohort)?'modern-mint-light@0.23.0':'modern-mint-light@0.22.0',skills:'NONE',groups:[...new Set(suite.map(item=>item.category))]}}:{}),
    ...(stabilityCohort(cohort)?{stabilityEvaluation:{sameNaturalLanguageRequests:['panel-stability-fix-v1','panel-copy-fix-v1','panel-compact-message-v1'].includes(cohort)?6:24,distinctCaseIds:true,fullPromptIdentity:'CONTEXT_REQUEST_ID_AND_DIGEST_DIFFER',independentRounds:3,colloquialCases:['panel-stability-fix-v1','panel-copy-fix-v1','panel-compact-message-v1'].includes(cohort)?2:8,interpretation:'FINITE_SAMPLE_NOT_POPULATION_RELIABILITY',knownDefects:'SEPARATE_OBSERVATIONS_NOT_TECHNICAL_PASS',semanticReview:'HUMAN_REQUIRED'}}:{}),
    ...(['panel-stability-fix-v1','panel-copy-fix-v1','panel-compact-message-v1'].includes(cohort)?{focusedAcceptance:{required:true,sourceFailureCases:['S08','S16','S24','S29','S32'],checks:['validated-delivery-and-browser','unprovided-artwork-placeholder-and-compiler-label-fit','character-selection-present','distinct-confirmation-choice-events','each-choice-pointer-operable-from-fresh-initial-state'],noDelivery:'FAIL_FOCUSED_ACCEPTANCE_WITH_CLARIFICATION_RECORDED_SEPARATELY',humanCopyAndVisualReview:'REQUIRED'}}:{}),
    ...(cohort==='inventory-grid-v1'?{inventoryEvaluation:{samples:4,expectedDeliveries:3,expectedCapacityClarifications:1,nativeIntent:'0.13',panelSpec:'0.17',compiler:'0.46.0',defaultCells:30,maximumCells:144,emptyWhenUnprovided:true,prompt:'EXACT_SHARED_PRODUCTION_PROMPT',fixtures:'NEVER_SENT_TO_MODEL'}}:{}),
    catalogSha256:await digestJson(seed.catalog),poolSha256:seed.pool?.sha256??await digestJson(null),sourceKind:sources?'PROGRAMMATIC_EDIT_BASES':'NO_EDIT_BASES',
    casePolicy:'Each case independently starts from its exact frozen context and, for editing, the declared fixture source. Expectations are never sent to the model.',
    ...(['panel-copy-fix-v1','panel-compact-message-v1'].includes(cohort)?{copyAcceptance:{required:true,unlabeledMessage:'EXPLICIT_RECIPE_PRESERVE_SEMANTIC_LABEL',...(cohort==='panel-compact-message-v1'?{compactLayout:'REQUIRE_NATIVE_SHORT_CENTER_LONG_PARAGRAPHS_LEFT_AND_ACTION_GROUP_CENTER_WITH_BOUNDED_GAP'}:{}),staticPlaceholder:'NEUTRAL_COPY_NOT_CURRENT_SELECTION',heuristics:'CHARACTER_NAME_MATCHES_REQUIRE_REVIEW',humanReview:'REQUIRED'}}:{}),
    cases,driverSimulation:{status:'PASS',cases:prepared.length,realModelCalls:0},
    acceptance:['independent-business-facts','literal-copy-and-defaults','correct-specific-clarification','preserve-edit-identities-and-live-state','compile-and-export-reopen','undo-edit'],
    browser:'SEPARATE_REQUIRED_FOR_SUCCESSFUL_PANELS',unityNative:'NOT_RUN_THIS_COHORT',repeatedInputStability:stabilityCohort(cohort)?'PLANNED_NOT_RUN':'NOT_MEASURED'};
  const plan={...payload,sha256:await digestJson(payload)};await writeNewJson(directory,'input-adaptability-plan.json',plan);
  const escape=value=>value.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
  const review=commonCohort(cohort)?[
    '# 游戏通用面板短口令测试','',`计划 SHA-256：${plan.sha256}`,
    cohort==='inventory-grid-v1'?'仓库网格专项：10×10、8行6列、未指定容量默认5×6，以及20×20超限澄清，共4条原短口令。共享生产提示、完整默认主题和图标；最多4次，各一次、串行、零自动重试。前三项必须保留容量并生成全部空格，超限项应具体澄清。当前真实模型调用0。':cohort==='card-target-default-v1'?'任务构图缺省目标专项：做个任务列表面板、做个手机任务列表面板。原短口令不追加组件清单；默认多条目按桌面横屏分列，明确手机请求保留单列。最多2次，各一次、串行、零自动重试；完整16主题／12图标、共享生产提示、Compiler0.45，当前新增模型调用0。':cohort==='card-content-closeout-v1'?'多卡片与成就内容收尾复测：商店、任务、成就，另含设置和退出确认回归。原短口令不追加要求；当前生产默认提示、完整16主题与12图标，Compiler0.45，各一次、最多5次、串行、零自动重试。多卡片按桌面目标，紧凑面板保留手机检查；成就逐项审阅名称、条件、进度或状态及示例诚实性。当前新增模型调用0。':currentGamePanelCohort(cohort)?'10类原短口令真实测试：设置、背包、角色、商店、任务、成就、签到、通关、暂停、退出确认。使用Studio／SDK当前默认目录、完整16主题和12图标，Compiler0.45，同类内容共用分组Panel，主标题保留底板，大字号和宽度规则保持。各一次、最多10次、串行、零自动重试；不改写原始答案，澄清和失败分别保留，当前新增模型调用0。':cohort==='readable-layout-v1'?'4条原短口令复测混合设置布局、内容自动撑高与标题回归。采用新game-readable-v2／Compiler0.39，背包、设置、角色、退出确认原文不变。完整16主题、12图标、生产共享提示，各一次、最多4次、串行、零重试；旧失败保留，当前新增真实调用0。':cohort==='readable-heading-v1'?'4条原短口令复测内容分组标题：背包、设置、角色、退出确认。新concise-v5按有效内容组计数，独立按钮组不再触发额外小标题；明确要求的标题保留，字体和宽度规则不变。完整16主题、12图标、生产共享提示，各一次、最多4次、零重试，当前真实调用0。':cohort==='readable-game-v1'?'8条原短口令复测新可读性默认：正文24、标题32、普通单列宽约420。使用生产共享提示、完整16主题和12自有图标，字号和宽度按实际390窄屏验收；明确尺寸、字号和不换行约束优先。最多8次，各一次，0自动重试，当前真实调用0。':cohort==='daily-choice-fix-v1'?'复测背包失败口令和设置、角色、商店3条原短口令。补齐每组选择控件恰有一个默认选项的内部约束；最多4次，逐项一次，0自动重试，用户短口令不改。完整默认目录和12个图标，不注入skill，当前真实调用0。':dailyCohort(cohort)?'日常默认8类短口令：完整16套主题、12个自有图标、共享生产规划提示；每项一次，最多8次，0自动重试。未注入skill，当前真实调用0。':cohort==='panel-compact-message-v1'?'紧凑确认正文与角色回归各3次原短口令和1条改写，共8次上限。显式message.text@0.2.0采用正文实际高度、短问句及按钮组居中；长正文保持左对齐。原口令不改，无图片库、不注入skill，0自动重试，当前真实调用0。':cohort==='panel-copy-fix-v1'?'两类各3次原短口令和1次改写，共8次上限。采用message.text正文排版和中性静态占位文案，保留明确数据标签；新独立计划、每项一次，无自动重试，当前真实调用0。':['panel-stability-fix-v1','panel-copy-fix-v1','panel-compact-message-v1'].includes(cohort)?'角色选择、退出确认各3次原短口令和1次口语改写，共8次上限。保留旧案例ID和输入，使用新计划与新授权。验证占位文字尺寸及两个选择初始可操作；技术PASS与专项验收分别记录。采用当前修正提示、0.34标题规则，无图片库，不注入skill。当前真实调用0。':cohort==='panel-stability-v1'?'8类面板，每类同一句短口令独立生成3次，再加1条口语改写，共32次上限。独立案例ID及上下文摘要不同，用户原文相同；不是失败后自动重试。使用后续修正提示和0.34标题规则，无测试图片库，不注入skill。当前真实调用0。':cohort==='common-panels-fix-v1'?'旧失败23项 + 尺寸回归8项 + 内容观察5项 + 明确设置要求1项，共37次上限。新标题规则0.34，原短口令不改；新的独立计划，无自动重试，当前真实调用0。':'56类常见面板 + 4条口语变体 + 4条明确约束，共64次上限。统一草稿优先、新标题规则0.33、程序测量默认尺寸；不加入skill摘录。当前真实调用0。',
    '用户输入没有追加组件清单、主题或尺寸。开放需求没有唯一标准答案；驱动夹具不发送给模型。内容适合程度、未指定选项、示例诚实性和澄清必要性需逐项审阅。',
    '每项一次、串行、无自动重试；连接不确定停止剩余项。游戏业务只提供宿主事件，不认证真实服务已执行。一次样本不证明稳定性，也不穷尽所有游戏或品类。',
    ...prepared.flatMap(({item})=>[`## ${item.id} · ${item.category}`,item.request.text,JSON.stringify(item.evaluation,null,2),''])
  ].join('\n\n'):cohort==='short-input-v1'?[
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
    if(suite[i].stability)assert.deepEqual(entry.stability,suite[i].stability,'ADAPT_STABILITY_CASE_CHANGED');
    for(const file of entry.files){assert(/^[A-Za-z0-9._-]+$/.test(file.name),'ADAPT_FILE_PATH');assert.equal(await digestBytes(await readFile(join(directory,file.name))),file.sha256,'ADAPT_FILE_CHANGED');}
    const expectation=await readJson(join(directory,entry.id+'.expectation.json'));
    assert.deepEqual(expectation.case,suite[i],'ADAPT_CASE_CHANGED');
    const context=await readJson(join(directory,entry.id+'.context.json'));assert.equal(context.sha256,entry.contextSha256,'ADAPT_CONTEXT_CHANGED');
    const schema=entry.operation==='edit'?await buildCodexEditResponseSchema({draft:true,context}):buildNativePanelIntentResponseSchema(context);
    assert.deepEqual(schema,await readJson(join(directory,entry.id+'.schema.json')),'ADAPT_SCHEMA_CHANGED');
    if(designs||commonCohort(cohort)){
      const design=await readJson(join(directory,entry.id+'.design.json'));
      assert.deepEqual(design,await designPayload(context,suite[i],designs),'ADAPT_DESIGN_PROMPT_CHANGED');
      canonicalJson(adaptabilityDesignEvidence(suite[i],design));
      canonicalJson(await adaptabilityPromptEvidence(suite[i],design.prompt));
    }
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
export async function runAdaptability({prepared,approvedDigest,output,testTransport}) {
  if(testTransport)assert(typeof testTransport.runProcess==='function'&&typeof testTransport.executable==='string','ADAPT_TEST_TRANSPORT');
  const plan=await verifyAdaptability(prepared,{checkLogin:!testTransport});assert.equal(approvedDigest,plan.sha256,'ADAPT_APPROVAL_DIGEST');
  const {buildDeliveryRuntime}=await import('./build-delivery-runtime.mjs'),{readUnityAdapterSources}=await import('../src/unity-export-io.mjs');
  const runtime=await buildDeliveryRuntime(),unitySources=await readUnityAdapterSources(),core=await loadWorkspaceCore();
  const seed={catalog:cohortCatalog(plan.cohort,await readJson(resolve(harnessRoot,catalogFile(plan.cohort)))),pool:await cohortPool(plan.cohort)};
  assert.equal(await digestJson(seed.catalog),plan.catalogSha256,'ADAPT_CATALOG_CHANGED');assert.equal(seed.pool?.sha256??await digestJson(null),plan.poolSha256,'ADAPT_POOL_CHANGED');
  const directory=await createOutputDirectory(output),consumption={planSha256:plan.sha256,caseBindings:plan.cases.map(({id,contextSha256})=>({id,contextSha256})),maxInvocations:plan.policy.maxInvocations,automaticRetries:0};
  await writeNewJson(resolve(prepared),'dispatch-claim.json',consumption);await writeNewJson(directory,'approved-plan.json',plan);
  const results=[];let stopped=false,stopReason='STOPPED_AFTER_INDETERMINATE_TRANSPORT';
  for(const item of casesFor(plan.cohort??'baseline')){
    if(stopped){results.push({id:item.id,status:'NOT_RUN',reason:stopReason});continue;}
    const model=await createWorkbenchModel(seed,core),caseDirectory=await createOutputDirectory(join(directory,item.id));
    let context,before,receipt,diagnostic,result,after,dispatchStarted=false;
    try{
      if(item.operation==='edit'){before=await readJson(join(prepared,item.id+'.source.panel.bundle.json'));await model.importPanel(before);
        context=(await model.prepareEdit(item.request,item.selection??null)).context;
      }else context=(await model.prepare(item.request)).context;
      assert.deepEqual(context,await readJson(join(prepared,item.id+'.context.json')),'ADAPT_CONTEXT_CHANGED');
      let designOptions={};
      if(item.designArm){const design=await readJson(join(prepared,item.id+'.design.json'));
        assert.equal(await buildCodexPlanningPrompt(context),design.basePrompt,'ADAPT_DESIGN_PROMPT_CHANGED');
        await writeNewJson(caseDirectory,'design-evidence.json',adaptabilityDesignEvidence(item,design));
        designOptions={runProcess:frozenPromptTransport(design.basePrompt,design.prompt,testTransport?.runProcess,async prompt=>writeNewJson(caseDirectory,'prompt-sent.json',await adaptabilityPromptEvidence(item,prompt)))};
      }
      dispatchStarted=true;
      result=await(item.operation==='edit'?editWithCodex:planWithCodex)(context,{outputRoot:caseDirectory,timeoutMs:plan.policy.timeoutMs,...(testTransport?{executable:testTransport.executable,runProcess:testTransport.runProcess}:{}),...designOptions});
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
      if(!dispatchStarted)stopReason='STOPPED_BEFORE_MODEL_DISPATCH';
      results.push({id:item.id,status:'FAIL',code:safeCode(error),receipt:receipt??null,diagnostic,indeterminate:stopped&&dispatchStarted,
        ...(dispatchStarted?{}:{dispatch:'NOT_STARTED'})});
    }finally{model.dispose();}
    const latest=results.at(-1);await writeNewJson(caseDirectory,'acceptance.json',latest);
    await appendFile(join(directory,'progress.ndjson'),canonicalJson({id:latest.id,status:latest.status,code:latest.code??null})+'\n');
    process.stdout.write(JSON.stringify({id:latest.id,status:latest.status,code:latest.code??null})+'\n');
  }
  const report={inputAdaptabilityReportVersion:'0.1',cohort:plan.cohort??'baseline',expectedCases:plan.cases.length,maxInvocations:plan.policy.maxInvocations,
    status:results.every(item=>item.status==='PASS')?'PASS_BEFORE_BROWSER':'FAIL',...(plan.evaluation?{evaluation:plan.evaluation,humanReview:'NOT_RECORDED',passMeaning:'Protocol and explicit constraints only; not content quality or clarification necessity.',
      outcomes:{draft:results.filter(item=>item.status==='PASS'&&item.outcome==='READY_TO_COMPILE').length,clarification:results.filter(item=>item.status==='PASS'&&item.outcome==='NEEDS_INPUT').length,failed:results.filter(item=>item.status==='FAIL').length,notRun:results.filter(item=>item.status==='NOT_RUN').length}}:{}),planSha256:plan.sha256,
    realModelCalls:testTransport?0:results.reduce((sum,item)=>sum+(item.receipt?.invocationCount??0),0),automaticRetries:0,
    ...(testTransport?{kind:'OFFLINE_BATCH_DRIVER_NOT_MODEL_RESULTS',fixtureInvocations:results.reduce((sum,item)=>sum+(item.receipt?.invocationCount??0),0)}:{}),
    pass:results.filter(item=>item.status==='PASS').length,fail:results.filter(item=>item.status==='FAIL').length,notRun:results.filter(item=>item.status==='NOT_RUN').length,
    results,browser:'NOT_RUN',unityNative:'NOT_RUN_THIS_COHORT',repeatedInputStability:plan.stabilityEvaluation?(testTransport?'NOT_MEASURED_USING_FIXTURES':'FINITE_SAMPLE_REVIEW_REQUIRED'):'NOT_MEASURED'};
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
