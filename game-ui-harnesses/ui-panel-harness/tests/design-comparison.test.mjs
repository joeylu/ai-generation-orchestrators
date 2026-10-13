import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {Writable,PassThrough} from 'node:stream';
import {mkdtemp,writeFile,mkdir,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {harnessRoot,readJson,writeNewJson} from '../src/io.mjs';
import {digestBytes} from '../src/canonical.mjs';
import {EXCERPT_RULES,loadDesignRules,applyDesignRules,frozenPromptTransport} from '../scripts/lib/design-comparison.mjs';
import {DESIGN_ARMS,SKILL_LAYOUT_CASES} from '../examples/skill-layout-comparison-v1/suite.mjs';
import {PROMPT_LAYOUT_CASES,PROMPT_ARMS} from '../examples/skill-layout-comparison-v2/suite.mjs';
import {SHORT_INPUT_CASES,SHORT_INPUT_REQUESTS} from '../examples/short-input-comparison-v1/suite.mjs';
import {checkOpenDraft,draftReviewRecord} from '../scripts/lib/open-draft-evaluation.mjs';
import {buildConciseDesignPrompt} from '../scripts/lib/concise-design-prompt.mjs';
import {materializePanelIntent,buildNativePanelIntentResponseSchema} from '../src/panel-intent.mjs';
import {businessFacts} from '../scripts/lib/input-adaptability-oracle.mjs';
import {REFERENCE_EIGHT_CASES} from '../examples/reference-eight-v1/suite.mjs';
import {createPlanningContext} from '../src/planning-context.mjs';
import {referenceIntent} from '../examples/input-adaptability-v1/suite.mjs';
import {buildCodexPlanningPrompt,planWithCodex} from '../src/codex-planner.mjs';
await mkdir(join(harnessRoot,'.tmp'),{recursive:true});
const scratch=await mkdtemp(join(harnessRoot,'.tmp','design-comparison-')),sources=join(scratch,'sources');await mkdir(sources);
const files=[];
for(const [id,rules]of Object.entries(EXCERPT_RULES))for(const rule of rules){
  const text=rule.contains.map(fragment=>fragment+' fixture design consideration.\n  continuation retained verbatim.').join('\n\n'),bytes=Buffer.from(text);
  await writeFile(join(sources,rule.file),bytes);files.push({id,name:rule.file,bytes:bytes.length,sha256:await digestBytes(bytes)});
}
await writeNewJson(sources,'sources.json',{version:'0.1',status:'SNAPSHOTTED_NOT_INSTALLED',files,realModelCalls:0});
const designs=await loadDesignRules(sources),catalog=await readJson(new URL('../examples/modern-all-components.catalog.json',import.meta.url));
catalog.themes=catalog.themes.filter(theme=>theme.id==='modern-mint-light'&&theme.version==='0.21.0');
const executable=join(scratch,process.platform==='win32'?'codex.exe':'codex');await writeFile(executable,'non-executable fixture; only fake transport is used');
test('32 interleaved cases preserve identical eight requests and reference facts across four arms',()=>{
  assert.equal(SKILL_LAYOUT_CASES.length,32);assert.equal(new Set(SKILL_LAYOUT_CASES.map(item=>item.id)).size,32);
  for(const source of REFERENCE_EIGHT_CASES){const cases=SKILL_LAYOUT_CASES.filter(item=>item.panelCaseId===source.id);assert.equal(cases.length,4);
    assert.deepEqual(cases.map(item=>item.designArm).sort(),[...DESIGN_ARMS].sort());
    for(const item of cases){assert.deepEqual(item.request,source.request);assert.deepEqual(item.reference,source.reference);}}
  assert.equal(SKILL_LAYOUT_CASES[0].designArm,'baseline');assert.equal(SKILL_LAYOUT_CASES[4].designArm,'ui-ux-pro-max');
});
test('selected rules remain exact source spans including continuation lines',async()=>{
  for(const arm of DESIGN_ARMS.filter(arm=>arm!=='baseline'))for(const selection of designs.arms[arm].selections){
    const text=await readFile(join(sources,selection.file),'utf8');assert(text.includes(selection.text));assert(selection.text.includes('continuation retained verbatim.'));}
});
test('all arms share the capability envelope; only selected guidance differs',()=>{
  const base='common instructions\n### Native CLI output schema\nfixed schema and request';
  const baseline=applyDesignRules(base,''),variant=applyDesignRules(base,'UNIQUE_GUIDANCE');
  assert.equal(variant.replace('UNIQUE_GUIDANCE',''),baseline);assert(baseline.endsWith('fixed schema and request'));
  assert.throws(()=>applyDesignRules('no marker','x'),/DESIGN_PROMPT_MARKER/);
});
for(const item of [...SKILL_LAYOUT_CASES,...PROMPT_LAYOUT_CASES,...SHORT_INPUT_CASES])test(`${item.id}: frozen prompt crosses the real CLI boundary exactly once using a test double`,async()=>{
  const context=await createPlanningContext(item.request,catalog),base=await buildCodexPlanningPrompt(context),selected=['concise','draft-first'].includes(item.promptProfile)?buildConciseDesignPrompt(context,{draftFirst:item.promptProfile==='draft-first'}):base,prompt=applyDesignRules(selected,designs.arms[item.ruleArm??item.designArm].text),intent=referenceIntent(context,item);
  let calls=0,sent=null,proof=null;
  const fake=()=>{calls++;const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();
    child.kill=()=>{queueMicrotask(()=>child.emit('close',null));return true;};
    child.stdin=new Writable({write(chunk,encoding,callback){sent=(sent??'')+chunk.toString();callback();},final(callback){callback();queueMicrotask(()=>{
      child.stdout.write([{type:'thread.started',thread_id:'00000000-0000-4000-8000-000000000001'},{type:'turn.started'},
        {type:'item.completed',item:{type:'agent_message',text:JSON.stringify(intent)}},{type:'turn.completed',usage:{input_tokens:100,cached_input_tokens:0,output_tokens:10}}].map(value=>JSON.stringify(value)).join('\n')+'\n');child.emit('close',0);
    });}});return child;};
  const result=await planWithCodex(context,{outputRoot:join(scratch,item.id),executable,runProcess:frozenPromptTransport(base,prompt,fake,value=>{proof=value;})});
  assert.equal(calls,1);assert.equal(sent,prompt);assert.equal(proof,prompt);assert.equal(result.report.status,'READY_TO_COMPILE');assert.equal(result.receipt.invocationCount,1);assert.equal(result.receipt.automaticRetries,0);
});

test('short user requests stay short and identical across arms; no technical appendix',()=>{
  assert.equal(SHORT_INPUT_CASES.length,36);
  for(const source of SHORT_INPUT_REQUESTS){
    assert(source.request.text.length<60);assert(!/960|640|schema|默认视觉|逻辑画布/.test(source.request.text));
    const arms=SHORT_INPUT_CASES.filter(item=>item.panelCaseId===source.id);assert.equal(arms.length,3);
    for(const item of arms)assert.deepEqual(item.request,source.request);
  }
  assert.equal(SHORT_INPUT_REQUESTS[1].request.text,'帮我做一个设置面板');
});

test('open review accepts different draft choices and questions without certifying either as sensible',async()=>{
  const item=SHORT_INPUT_REQUESTS[1],context=await createPlanningContext(item.request,catalog);
  const first=referenceIntent(context,item),second=structuredClone(first);
  second.panel.body.children[0].rows=second.panel.body.children[0].rows.slice(0,2);
  for(const intent of [first,second]){
    const proposal=await materializePanelIntent(context,intent),result={proposal,report:{status:'READY_TO_COMPILE'}};
    checkOpenDraft(item,result);assert.equal(draftReviewRecord(item,result,businessFacts(proposal.spec)).contentReasonableness,'HUMAN_REVIEW_REQUIRED');
  }
  const clarification={proposal:{spec:null,unresolved:[{id:'q0',question:'需要哪些设置？'}]},report:{status:'NEEDS_INPUT'}};
  checkOpenDraft(item,clarification);assert.equal(draftReviewRecord(item,clarification).clarificationNecessity,'HUMAN_REVIEW_REQUIRED');
  assert.throws(()=>checkOpenDraft(item,{proposal:{spec:null,unresolved:[]},report:{status:'NEEDS_INPUT'}}),/DRAFT_EMPTY_QUESTION/);
});

test('explicit short requests reject extra controls, renamed labels, wrong defaults and wrong values',async()=>{
  for(const item of SHORT_INPUT_REQUESTS.filter(item=>item.evaluation.explicit)){
    const context=await createPlanningContext(item.request,catalog),proposal=await materializePanelIntent(context,referenceIntent(context,item));
    const result={proposal,report:{status:'READY_TO_COMPILE'}};checkOpenDraft(item,result);
    const extra=structuredClone(result);extra.proposal.spec.sections[0].rows.push(extra.proposal.spec.sections[0].rows[0]);
    assert.throws(()=>checkOpenDraft(item,extra),/DRAFT_EXPLICIT_KINDS/);
    const wrong=structuredClone(result),rows=wrong.proposal.spec.sections[0].rows;
    if(rows[0].kind==='switch')wrong.proposal.spec.state.find(field=>field.id===rows[0].bind).initial=false;
    else if(rows[0].kind==='text')rows[0].text='错误内容';else rows[0].buttonLabel='退出';
    assert.throws(()=>checkOpenDraft(item,wrong),/DRAFT_EXPLICIT_/);
  }
});

test('v2 isolates prompt profile from skill on five fresh arms and retains all business reference facts',async()=>{
  assert.equal(PROMPT_LAYOUT_CASES.length,40);
  for(const original of REFERENCE_EIGHT_CASES){
    const group=PROMPT_LAYOUT_CASES.filter(item=>item.panelCaseId===original.id);assert.equal(group.length,5);
    assert.equal(new Set(group.map(item=>JSON.stringify(item.request))).size,1);
    for(const item of group)assert.deepEqual(item.reference,original.reference);
    assert(!group[0].request.text.includes('面板自动测量'));
  }
  assert.equal(PROMPT_ARMS.filter(arm=>arm.ruleArm==='baseline').length,2);
  const context=await createPlanningContext(PROMPT_LAYOUT_CASES[0].request,catalog);
  const prompt=buildConciseDesignPrompt(context),base=await buildCodexPlanningPrompt(context);
  assert(prompt.length<base.length);
  const schema=JSON.parse(prompt.split('### Native CLI output schema\n')[1].split('\n\nComplete validated task data:')[0]);
  assert.deepEqual(schema,buildNativePanelIntentResponseSchema(context));
  assert.deepEqual(JSON.parse(prompt.split('Complete validated task data:\n')[1]).context,context);
  assert(prompt.includes('even when the user has not specified them'));
});

test('design freedom really reaches the compiler without altering business: width and horizontal actions',async()=>{
  const item=PROMPT_LAYOUT_CASES.find(item=>item.panelCaseId==='P04');
  const context=await createPlanningContext(item.request,catalog),original=referenceIntent(context,item);
  const modified=structuredClone(original);modified.panel.layout.width=640;
  modified.panel.body.children[0].actionLayout={direction:'row',align:'center',gap:24,buttonWidth:160,buttonHeight:56,shape:'default',sourceRef:'request'};
  const before=await materializePanelIntent(context,original),after=await materializePanelIntent(context,modified);
  assert.deepEqual(businessFacts(after.spec),businessFacts(before.spec));
  assert.equal(after.spec.layout.width,640);assert.equal(after.spec.actionLayouts[0].direction,'row');
  assert.notDeepEqual(after.spec.layout,before.spec.layout);
});
test('modified frozen source content is rejected',async()=>{
  await writeFile(join(sources,files[0].name),'tampered');await assert.rejects(loadDesignRules(sources),/DESIGN_SOURCE_HASH|strictly equal/);
});
test('prompt drift is rejected before any text reaches the child stdin',async()=>{
  let received=false;
  const fake=()=>{const child=new EventEmitter();child.stdin=new Writable({write(chunk,encoding,callback){received=true;callback();}});return child;};
  const child=frozenPromptTransport('expected','new',fake)();
  const error=new Promise(resolve=>child.stdin.once('error',resolve));child.stdin.end('different');assert.match((await error).message,/DESIGN_PROMPT_CHANGED/);assert.equal(received,false);
});
