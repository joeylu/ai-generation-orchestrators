import {CARD_TARGET_DEFAULT_SUITE,cardTargetDefaultFixture} from '../examples/card-target-default-v1/suite.mjs';
import {CARD_CONTENT_CLOSEOUT_SUITE,cardContentCloseoutFixture} from '../examples/card-content-closeout-v1/suite.mjs';
import {SECTION_PANEL_TEN_SUITE,sectionPanelTenFixture} from '../examples/section-panels-ten-v1/suite.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {Writable,PassThrough} from 'node:stream';
import {mkdir,mkdtemp,writeFile,readFile,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {harnessRoot,readJson} from '../src/io.mjs';
import {canonicalJson} from '../src/canonical.mjs';
import {prepareAdaptability,runAdaptability,adaptabilityDesignEvidence} from '../scripts/input-adaptability.mjs';
import {COMMON_GAME_PANEL_SUITE,commonGamePanelFixture} from '../examples/common-game-panels-v1/suite.mjs';
import {COMMON_GAME_PANEL_FIX_SUITE} from '../examples/common-game-panels-fix-v1/suite.mjs';
import {PANEL_STABILITY_SUITE} from '../examples/panel-stability-v1/suite.mjs';
import {PANEL_STABILITY_FIX_SUITE,STABILITY_FIX_SOURCE_PLAN_SHA256} from '../examples/panel-stability-fix-v1/suite.mjs';
import {PANEL_COPY_FIX_SUITE,COPY_FIX_SOURCE_PLAN_SHA256,panelCopyFixFixture} from '../examples/panel-copy-fix-v1/suite.mjs';
import {COMPACT_MESSAGE_SUITE,COMPACT_MESSAGE_SOURCE_PLAN_SHA256,compactMessageFixture} from '../examples/compact-message-v1/suite.mjs';
import {DAILY_DEFAULT_SUITE,DAILY_CHOICE_FIX_SUITE,DAILY_CHOICE_FIX_SOURCE_PLAN_SHA256,dailyDefaultFixture} from '../examples/daily-defaults-v1/suite.mjs';
import {READABLE_HEADING_SUITE,READABLE_HEADING_SOURCE_PLAN_SHA256} from '../examples/readable-heading-v1/suite.mjs';
import {referenceIntent} from '../examples/input-adaptability-v1/suite.mjs';

for(const [cohort,suite]of [['card-target-default-v1',CARD_TARGET_DEFAULT_SUITE],['card-content-closeout-v1',CARD_CONTENT_CLOSEOUT_SUITE],['section-panels-ten-v1',SECTION_PANEL_TEN_SUITE],['common-panels-v1',COMMON_GAME_PANEL_SUITE],['common-panels-fix-v1',COMMON_GAME_PANEL_FIX_SUITE],['panel-stability-v1',PANEL_STABILITY_SUITE],['panel-stability-fix-v1',PANEL_STABILITY_FIX_SUITE],['panel-copy-fix-v1',PANEL_COPY_FIX_SUITE],['panel-compact-message-v1',COMPACT_MESSAGE_SUITE],['daily-defaults-v1',DAILY_DEFAULT_SUITE],['daily-choice-fix-v1',DAILY_CHOICE_FIX_SUITE],['readable-game-v1',DAILY_DEFAULT_SUITE],['readable-heading-v1',READABLE_HEADING_SUITE],['readable-layout-v1',READABLE_HEADING_SUITE]])test(`${cohort}: complete batch writes metadata, sends exact prompts and delivers using only a fake transport`,async()=>{
  await mkdir(join(harnessRoot,'.tmp'),{recursive:true});
  const scratch=await mkdtemp(join(harnessRoot,'.tmp','common-batch-')),prepared=join(scratch,'plan'),output=join(scratch,'run');
  const executable=join(scratch,process.platform==='win32'?'codex.exe':'codex');await writeFile(executable,'Fake only: never executable');
  const plan=await prepareAdaptability(prepared,{cohort});let calls=0;
  const sent=[];
  const runProcess=()=>{
    calls++;const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();let prompt='';
    child.kill=()=>{queueMicrotask(()=>child.emit('close',null));return true;};
    child.stdin=new Writable({write(chunk,encoding,callback){prompt+=chunk.toString();callback();},final(callback){callback();
      const context=JSON.parse(prompt.split('Complete validated task data:\n')[1]).context,item=suite.find(item=>item.request.id===context.request.id);
      sent.push({id:item.id,prompt});const intent=cohort==='card-target-default-v1'?cardTargetDefaultFixture(context,item,referenceIntent):cohort==='card-content-closeout-v1'?cardContentCloseoutFixture(context,item,referenceIntent):cohort==='section-panels-ten-v1'?sectionPanelTenFixture(context,item,referenceIntent):['readable-layout-v1','readable-heading-v1','readable-game-v1','daily-defaults-v1','daily-choice-fix-v1'].includes(cohort)?dailyDefaultFixture(context,item,referenceIntent):cohort==='panel-compact-message-v1'?compactMessageFixture(context,item,referenceIntent):cohort==='panel-copy-fix-v1'?panelCopyFixFixture(context,item,referenceIntent):commonGamePanelFixture(context,item,referenceIntent);
      if(['readable-game-v1','readable-heading-v1','readable-layout-v1'].includes(cohort)){
        // This fake response exercises unspecified sizing. Historical fake cohorts
        // retain their explicit 760/824 geometry and their original evidence.
        for(const key of ['width','canvasWidth','canvasHeight','maxHeight'])intent.panel.layout[key]=null;
        const visit=node=>{if(node.kind==='section'){for(const row of node.rows)if(row.kind==='text')row.wrap='word';}else for(const child of node.children??[])visit(child);};visit(intent.panel.body);
      }
      queueMicrotask(()=>{child.stdout.write([{type:'thread.started',thread_id:'00000000-0000-4000-8000-000000000001'},{type:'turn.started'},
        {type:'item.completed',item:{type:'agent_message',text:JSON.stringify(intent)}},{type:'turn.completed',usage:{input_tokens:100,cached_input_tokens:0,output_tokens:10}}].map(event=>JSON.stringify(event)).join('\n')+'\n');child.emit('close',0);});
    }});return child;
  };
  if(['card-target-default-v1','card-content-closeout-v1','section-panels-ten-v1','readable-layout-v1','readable-heading-v1','readable-game-v1','daily-choice-fix-v1','daily-defaults-v1','panel-stability-fix-v1','panel-copy-fix-v1','panel-compact-message-v1'].includes(cohort)){
    await assert.rejects(runAdaptability({prepared,output:join(scratch,'wrong-digest'),approvedDigest:'0'.repeat(64),testTransport:{executable,runProcess}}));
    assert.equal(calls,0);
  }
  if(cohort==='panel-copy-fix-v1'){
    assert.equal(plan.policy.maxInvocations,8);assert.equal(plan.commonPanelEvaluation.commonTypes,2);
    assert.equal(plan.commonPanelEvaluation.sourcePlanSha256,COPY_FIX_SOURCE_PLAN_SHA256);assert.equal(plan.copyAcceptance.required,true);
    for(const item of suite)assert.equal((await readJson(join(prepared,item.id+'.context.json'))).assetRetrieval,null);
  }
  if(cohort==='card-target-default-v1'){assert.equal(plan.policy.maxInvocations,2);assert.equal(plan.sectionPanelEvaluation.samples,2);assert.equal(plan.commonPanelEvaluation.commonTypes,2);assert.equal(plan.cardTargetAcceptance.explicitMobileCase,'G14M');assert.equal(plan.cardTargetAcceptance.sourcePlanSha256,'71234ab2a2cfac8a3d1cfe09a2a58581e902a6d487c944981b235e736bc5d854');}
  if(cohort==='card-content-closeout-v1'){
    assert.equal(plan.policy.maxInvocations,5);assert.equal(plan.policy.automaticRetries,0);
    assert.equal(plan.dailyDefaultEvaluation.catalogThemes,16);assert.equal(plan.dailyDefaultEvaluation.builtinIcons,12);
    assert.equal(plan.sectionPanelEvaluation.samples,5);assert.equal(plan.commonPanelEvaluation.commonTypes,5);
    assert.equal(plan.cardContentAcceptance.driverSpecimens,'NEVER_SENT_TO_MODEL');
    assert.deepEqual(plan.cardContentAcceptance.wideCardCases,['G25','G14','G16']);
    assert(plan.sourceFiles.some(file=>file.path==='src/game-panel-draft-content.mjs'));
    for(const item of suite){
      const context=await readJson(join(prepared,item.id+'.context.json')),design=await readJson(join(prepared,item.id+'.design.json')),expectation=await readJson(join(prepared,item.id+'.expectation.json'));
      assert.equal(context.request.text,item.request.text);assert.equal(context.catalog.themes.length,16);
      assert.equal(design.prompt,design.basePrompt);assert.equal(expectation.expectedSpec,null);
      assert(!design.prompt.includes('示例：持续探索'));assert(!design.prompt.includes('累计探索5个区域'));
    }
  }
  if(cohort==='section-panels-ten-v1'){assert.equal(plan.policy.maxInvocations,10);assert.equal(plan.dailyDefaultEvaluation.catalogThemes,16);assert.equal(plan.dailyDefaultEvaluation.builtinIcons,12);assert.equal(plan.sectionPanelEvaluation.compiler,'0.45.0');assert.equal(plan.commonPanelEvaluation.commonTypes,10);}
  const report=await runAdaptability({prepared,output,approvedDigest:plan.sha256,testTransport:{executable,runProcess}});
  assert.equal(report.kind,'OFFLINE_BATCH_DRIVER_NOT_MODEL_RESULTS');assert.equal(report.realModelCalls,0);
  assert.equal(report.fixtureInvocations,suite.length);assert.equal(calls,suite.length);assert.equal(report.status,'PASS_BEFORE_BROWSER');assert.equal(report.notRun,0);
  if(['readable-layout-v1','readable-heading-v1','readable-game-v1','daily-defaults-v1','daily-choice-fix-v1'].includes(cohort)){
    assert.equal(plan.policy.maxInvocations,suite.length);assert.equal(plan.dailyDefaultEvaluation.catalogThemes,16);
    if(cohort==='daily-choice-fix-v1'){assert.equal(suite.length,4);assert.equal(plan.dailyDefaultEvaluation.sourcePlanSha256,DAILY_CHOICE_FIX_SOURCE_PLAN_SHA256);assert.deepEqual(plan.dailyDefaultEvaluation.sourceFailureCases,['G22']);}assert.equal(plan.dailyDefaultEvaluation.builtinIcons,12);
    assert(plan.sourceFiles.some(file=>file.path==='assets/core-v1/asset-library.json'));assert(plan.sourceFiles.some(file=>file.path==='src/game-panel-prompt.mjs'));
    for(const item of suite){const context=await readJson(join(prepared,item.id+'.context.json')),design=await readJson(join(prepared,item.id+'.design.json'));assert.equal(context.catalog.themes.length,16);assert(context.assetRetrieval);assert.equal(design.prompt,design.basePrompt);}
    if(cohort==='daily-defaults-v1')assert.equal((await readJson(join(output,'G54','panel.bundle.json'))).compilerVersion,'0.36.0');
    if(cohort==='readable-layout-v1'){
      assert.equal(suite.length,4);assert.equal(plan.policy.automaticRetries,0);assert.equal(plan.layoutEvaluation.sourcePlanSha256,'cd11d7b74a78a99da07ccbcbf6d361988bf150854ac37eb867b15a164c49e9c3');assert.deepEqual(plan.layoutEvaluation.sourceFailureCases,['G03']);
      for(const item of suite){const bundle=await readJson(join(output,item.id,'panel.bundle.json'));assert.equal(bundle.compilerVersion,'0.39.0');assert.equal(bundle.catalog.id,'modern-readable-game-layout');assert.equal(bundle.spec.layout.width,420);assert.equal(bundle.catalog.themes[0].headingStyle,'concise-v5');}
    }
    if(cohort==='readable-heading-v1'){
      assert.equal(suite.length,4);assert.equal(plan.policy.automaticRetries,0);assert.equal(plan.headingEvaluation.sourcePlanSha256,READABLE_HEADING_SOURCE_PLAN_SHA256);assert.deepEqual(plan.headingEvaluation.sourceKnownVisualFindingCases,['G22']);
      for(const item of suite){const bundle=await readJson(join(output,item.id,'panel.bundle.json'));assert.equal(bundle.compilerVersion,'0.38.0');assert.equal(bundle.catalog.id,'modern-readable-game-headings');assert.equal(bundle.spec.layout.width,420);assert.equal(bundle.catalog.themes[0].headingStyle,'concise-v5');}
    }
    if(cohort==='readable-game-v1'){
      assert.equal(suite.length,8);assert.equal(plan.policy.automaticRetries,0);
      assert(plan.sourceFiles.some(file=>file.path==='examples/modern-readable-game.catalog.json'));
      assert(plan.sourceFiles.some(file=>file.path==='scripts/check-readable-game-browser.mjs'));
      for(const item of suite){
        const bundle=await readJson(join(output,item.id,'panel.bundle.json'));
        assert.equal(bundle.compilerVersion,'0.37.0');assert.equal(bundle.catalog.id,'modern-readable-game');
        assert(sent.find(value=>value.id===item.id).prompt.includes('game-readable-v1 single-column defaults'));
      }
    }
  }
  if(cohort==='panel-copy-fix-v1')for(const id of ['S08','S16','S24','S32'])assert.equal((await readJson(join(output,id,'panel.bundle.json'))).compilerVersion,'0.35.0');
  if(cohort==='panel-compact-message-v1'){
    assert.equal(plan.policy.maxInvocations,8);assert.equal(plan.commonPanelEvaluation.commonTypes,2);
    assert.equal(plan.commonPanelEvaluation.sourcePlanSha256,COMPACT_MESSAGE_SOURCE_PLAN_SHA256);assert.equal(plan.copyAcceptance.required,true);assert(plan.copyAcceptance.compactLayout);
    for(const item of suite)assert.equal((await readJson(join(prepared,item.id+'.context.json'))).assetRetrieval,null);
    for(const id of ['S08','S16','S24','S32'])assert.equal((await readJson(join(output,id,'panel.bundle.json'))).compilerVersion,'0.36.0');
  }
  if(['panel-stability-v1','panel-stability-fix-v1'].includes(cohort)){assert.equal(plan.stabilityEvaluation.independentRounds,3);assert.equal(plan.stabilityEvaluation.colloquialCases,cohort==='panel-stability-fix-v1'?2:8);
    assert.equal(plan.commonPanelEvaluation.artwork,'NO_USER_ARTWORK_NO_TEST_IMAGE_POOL');
    for(const item of suite){const context=await readJson(join(prepared,item.id+'.context.json'));assert.equal(context.assetRetrieval,null);}}
  if(cohort==='panel-stability-fix-v1'){
    assert.equal(plan.policy.maxInvocations,8);assert.equal(plan.commonPanelEvaluation.commonTypes,2);
    assert.equal(plan.commonPanelEvaluation.sourcePlanSha256,STABILITY_FIX_SOURCE_PLAN_SHA256);
    assert.equal(plan.focusedAcceptance.required,true);assert.equal(plan.stabilityEvaluation.sameNaturalLanguageRequests,6);
    for(const path of ['examples/panel-stability-fix-v1/suite.mjs','scripts/lib/stability-fix-acceptance.mjs'])assert(plan.sourceFiles.some(item=>item.path===path));
  }
  if(['card-target-default-v1','card-content-closeout-v1','section-panels-ten-v1'].includes(cohort))for(const item of suite){const bundle=await readJson(join(output,item.id,'panel.bundle.json'));assert.equal(bundle.compilerVersion,'0.45.0');assert.equal(bundle.catalog.id,'modern-readable-game-card-layout');}
  for(const {id,prompt} of sent){
    const item=suite.find(item=>item.id===id),design=await readJson(join(prepared,id+'.design.json'));
    assert.equal(prompt,design.prompt);assert.deepEqual(await readJson(join(output,id,'design-evidence.json')),adaptabilityDesignEvidence(item,design));
    assert.equal((await readJson(join(output,id,'prompt-sent.json'))).promptSha256,design.promptSha256);
    assert((await readFile(join(output,id,'panel.zip'))).length>100);assert.equal((await readdir(join(output,id))).filter(name=>name.startsWith('codex-')).length,1);
    assert.doesNotThrow(()=>canonicalJson(adaptabilityDesignEvidence(item,design)));
  }
  // Same claimed simulation plan cannot accidentally dispatch another batch.
  await assert.rejects(runAdaptability({prepared,output:join(scratch,'repeat'),approvedDigest:plan.sha256,testTransport:{executable,runProcess}}));
  assert.equal(calls,suite.length);
});
