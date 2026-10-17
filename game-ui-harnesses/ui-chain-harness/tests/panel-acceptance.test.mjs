import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,mkdtemp} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {materialSkinFixture} from '../fixtures/material-skin.mjs';
import {buildSkinPackage,verifySkinPackage,json,hash} from '../src/skins/package.mjs';
import {readContracts} from '../src/contracts/validate.mjs';
import {defaults} from '../src/contracts/build.mjs';
import {prepareAcceptance,runAcceptance,expandCases,acceptanceRequestId} from '../src/acceptance/batch.mjs';
import {rawEvidence,verifyBatch} from '../src/acceptance/evidence.mjs';
import {semanticIssues} from '../src/acceptance/semantics.mjs';
import {replayCase} from '../src/acceptance/replay.mjs';
import {actionConsumer,prepareActionPlan} from '../src/panel/action-model.mjs';
import {customActionConfig} from '../src/panel/custom-panel.mjs';
import {readPanelSdkJson} from '../src/panel/sdk.mjs';
import {actionFixture} from '../src/panel/action-fixtures.mjs';
const root=fileURLToPath(new URL('../',import.meta.url)),read=async p=>JSON.parse(await readFile(join(root,p))),sdk={mode:'locked',archiveSha256:'a'.repeat(64),manifestSha256:'b'.repeat(64),sourceCommit:'c'.repeat(40)};
const spec={version:'1.0',presets:[],custom:[{id:'C01',orientation:'portrait',text:'公告正文Hello',expected:{literals:['Hello']}}]};
async function fixture(){
 const parent=join(root,'work/tests');await mkdir(parent,{recursive:true});const directory=await mkdtemp(join(parent,'acceptance-'));
 for(const dir of ['src','scripts','configs','prompts','schemas','fixtures','work'])await mkdir(join(directory,dir));
 for(const file of ['package.json','package-lock.json'])await writeFile(join(directory,file),'{}');
 const raster=await materialSkinFixture(join(directory,'skin-input'));await writeFile(raster.input,json({...raster.spec,sourceKind:'imported'}));const built=await buildSkinPackage({input:raster.input,output:join(directory,'imported')});
 const packageDirectory=join(built.directory,'pack'),verified=await verifySkinPackage(packageDirectory),contracts=await readContracts(defaults),contractsDirectory=join(directory,'contracts');await mkdir(contractsDirectory);for(const key of ['registry','usage','template'])await writeFile(join(contractsDirectory,key+'.json'),contracts.bytes[key]);
 const config=customActionConfig(await read('configs/action-presets.json')),instructions=await readFile(join(root,'prompts/custom-panel-planner.md'),'utf8'),catalog=await readPanelSdkJson('examples/modern-all-components.catalog.json');await writeFile(join(directory,'prompts/custom-panel-planner.md'),instructions);
 const plans=new Map(),transport=async(_root,script,args)=>{
  const option=key=>args[args.indexOf('--'+key)+1];assert.equal(args[0],'prepare');assert.equal(script,'action-model.mjs');
  const request=JSON.parse(await readFile(option('request'))),aliases=JSON.parse(await readFile(option('aliases'))),consumer=actionConsumer(config,'custom',verified.pack,verified.manifestSha256,aliases,option('orientation')),{plan}=await prepareActionPlan({request,catalog,instructions,consumer});
  const path=join(directory,'work',plan.sha256+'.json');await writeFile(path,json({plan,consumer}),{flag:'wx'});plans.set(plan.sha256,{plan,consumer});return {exitCode:0,stdout:JSON.stringify({status:'PREPARED',plan:path,sha256:plan.sha256})};
 };
 const prepared=await prepareAcceptance({root:directory,spec,packageDirectory,contractsDirectory,referenceImages:[],evidenceDirectory:join(tmpdir(),'ui-chain-acceptance-test-'+directory.split(/[\\/]/).at(-1)),runCommand:transport,sdkIdentity:async()=>sdk});
 return {root:directory,prepared,plans,verified,config,catalog};
}
test('the authored matrix contains 18 current preset orientations and 30 independent custom cases',async()=>{
 const cases=expandCases(await read('configs/panel-acceptance-cases.json'));assert.equal(cases.length,48);assert.equal(new Set(cases.map(c=>c.id)).size,48);assert.equal(cases.filter(c=>c.kind!=='custom').length,18);assert.deepEqual(Object.fromEntries(['pixel','woodland','bakery'].map(s=>[s,cases.filter(c=>c.skin===s).length])),{pixel:28,woodland:10,bakery:10});
});
test('all 48 frozen request identifiers fit the public 64-character bound including the longest preset',async()=>{
 const cases=expandCases(await read('configs/panel-acceptance-cases.json')),ids=cases.map(c=>acceptanceRequestId('8f654e7f-cacf-4080-ab25-e3215c2a4411',c.id));
 assert.equal(new Set(ids).size,48);for(const id of ids){assert.match(id,/^[A-Za-z][A-Za-z0-9_.-]{0,63}$/);assert(id.length<=64);assert(id.startsWith('acceptance-8f654e7f-'));}
 assert(ids.some(id=>id.endsWith('sdk-result-complete-landscape')));assert.throws(()=>acceptanceRequestId('8f654e7f-cacf-4080-ab25-e3215c2a4411','a'.repeat(64)),{code:'ACCEPTANCE_REQUEST_ID'});
});
test('frozen batch identity rejects changed inputs; dispatch authorization is exact and concurrent reruns cannot submit twice',async()=>{
 const f=await fixture(),batch=await verifyBatch(f.prepared.directory),args={root:f.root,directory:f.prepared.directory,sdkIdentity:async()=>sdk};let calls=0;
 await assert.rejects(runAcceptance({...args,authorizationSha256:'0'.repeat(64)}),{code:'ACCEPTANCE_AUTHORIZATION_REQUIRED'});
 const runCommand=async()=>{calls++;await new Promise(r=>setTimeout(r,10));return {exitCode:1,stderr:JSON.stringify({status:'FAILED',code:'CODEX_CONNECTION_FAILED_NO_RETRY'})};};
 await Promise.all([runAcceptance({...args,authorizationSha256:batch.sha256,runCommand}),runAcceptance({...args,authorizationSha256:batch.sha256,runCommand})]);assert.equal(calls,1);
 await runAcceptance({...args,authorizationSha256:batch.sha256,runCommand});assert.equal(calls,1);
 await writeFile(join(f.root,'src/changed.mjs'),'// changed source');await assert.rejects(runAcceptance({...args,authorizationSha256:batch.sha256,runCommand}),{code:'ACCEPTANCE_SOURCE_CHANGED'});assert.equal(calls,1);
 await writeFile(join(f.prepared.directory,batch.cases[0].directory,'expected.json'),'{}');await assert.rejects(verifyBatch(f.prepared.directory),{code:'ACCEPTANCE_INPUT_CHANGED'});
});
test('a pre-existing SDK directory without a local result is terminal and never resubmitted',async()=>{
 const f=await fixture(),batch=await verifyBatch(f.prepared.directory),entry=batch.cases[0];await mkdir(join(f.root,'work/panels/action-model-runs','intent-'+entry.planSha256),{recursive:true});let calls=0;
 const result=await runAcceptance({root:f.root,directory:f.prepared.directory,authorizationSha256:batch.sha256,sdkIdentity:async()=>sdk,runCommand:async()=>{calls++;throw Error('must not invoke');}});assert.equal(calls,0);assert.equal(result.results[0].status,'EXISTING_NO_RETRY');
});
test('raw replay preserves source evidence, rejects digest/plan/receipt/parsed-intent tampering, and performs zero transport calls',async()=>{
 const f=await fixture(),batch=await verifyBatch(f.prepared.directory),entry=batch.cases[0],bundle=f.plans.get(entry.planSha256),directory=join(f.root,'work/panels/action-model-runs','intent-'+entry.planSha256);await mkdir(directory,{recursive:true});
 const example={id:bundle.plan.session.context.request.id,title:'Notice',sectionTitle:'Content',request:'Hello',rows:[{kind:'text',recipeKey:'settings.text@0.1.0',label:'Hello',text:'Hello',wrap:'word'}]},sample=await actionFixture(example,f.catalog,f.config),intent={...sample.intent,contextSha256:bundle.plan.session.context.sha256};
 const raw=Buffer.from(json(intent)),receipt={status:'RESPONSE_RECEIVED',planSha256:entry.planSha256,contextSha256:bundle.plan.session.context.sha256,model:bundle.plan.model,effort:bundle.plan.effort,responseSha256:hash(raw),failureCode:null,invocationCount:1,automaticRetries:0};
 const originals={'plan.json':Buffer.from(json(bundle.plan)),'response.txt':raw,'intent.json':Buffer.from(json(intent)),'receipt.json':Buffer.from(json(receipt)),'dispatch.json':Buffer.from(json({kind:'ui_panel_intent_dispatch',version:'1.0',planSha256:entry.planSha256,automaticRetries:0}))};for(const [file,bytes]of Object.entries(originals))await writeFile(join(directory,file),bytes,{flag:'wx'});
 const replay=await replayCase({root:f.root,directory:f.prepared.directory,entry});assert.equal(replay.origin.modelCalls,0);assert.equal(replay.compiled.content.fields[0].text,'Hello');for(const [file,bytes]of Object.entries(originals)){assert.deepEqual(await readFile(join(directory,file)),bytes);assert.deepEqual(await readFile(join(replay.directory,file)),bytes);}
 for(const [file,changed]of Object.entries({'response.txt':Buffer.concat([raw,Buffer.from(' ')]),'plan.json':Buffer.from(json({...bundle.plan,prompt:'changed'})),'receipt.json':Buffer.from(json({...receipt,invocationCount:2})),'dispatch.json':Buffer.from(json({kind:'ui_panel_intent_dispatch',version:'1.0',planSha256:'0'.repeat(64),automaticRetries:0})),'intent.json':Buffer.from(json({...intent,unresolved:[{question:'changed'}]}))})){
  await writeFile(join(directory,file),changed);await assert.rejects(rawEvidence(directory,bundle.plan));await writeFile(join(directory,file),originals[file]);
 }
});
test('semantic acceptance uses authored copy, exact defaults, local targets and explicit geometry',()=>{
 const expected={literals:['<A> & B'],fields:[{type:'input',label:'昵称',value:'阿青',required:true}],actions:[{label:'提交',action:'submit',targets:['昵称']}],maxHeight:600,rowChildren:3},content={title:'Test',fields:[{id:'x',type:'input',label:'昵称',value:'阿青',required:true},{id:'t',type:'text',text:'<A> & B'}],actions:[{label:'提交',action:'submit',targets:['x']}],layoutBody:{kind:'row',children:[{kind:'section'},{kind:'section'},{kind:'section'}]}},documents={landscape:{nodes:[{id:'surface',size:{height:600,width:900}}]}};
 assert.deepEqual(semanticIssues(expected,content,documents),[]);const bad=structuredClone(content);bad.fields[0].value='wrong';bad.actions[0].targets=[];bad.fields[1].text='&lt;A&gt; & B';assert.equal(semanticIssues(expected,bad,documents).length,3);
 const grouping={...content,layoutBody:{kind:'column',children:[{kind:'section',title:'移动',rowIds:['x']},{kind:'section',title:'交互',rowIds:['t']}]}};assert.deepEqual(semanticIssues({literals:['移动','交互'],sectionTitles:['移动','交互']},grouping,{}),[]);grouping.layoutBody.children.pop();grouping.fields.push({type:'text',text:'交互'});assert.equal(semanticIssues({literals:['移动','交互'],sectionTitles:['移动','交互']},grouping,{}).filter(i=>i.code==='section-titles').length,1);
});
test('read-only data pairs require exact values in the named field or its unique explicit section owner',()=>{
 const expected={textPairs:[{label:'生命',value:120},{label:'攻击',value:35},{label:'防御',value:18}]},content={fields:expected.textPairs.map((pair,index)=>({id:'n'+index,type:'text',label:'数值',text:String(pair.value)})),layoutBody:{kind:'grid',children:expected.textPairs.map((pair,index)=>({kind:'section',title:pair.label,rowIds:['n'+index]}))}};
 assert.deepEqual(semanticIssues(expected,content,{}),[]);
 const direct={fields:content.fields.map((field,index)=>({...field,label:expected.textPairs[index].label}))};assert.deepEqual(semanticIssues(expected,direct,{}),[]);
 const swapped=structuredClone(content);[swapped.fields[0].text,swapped.fields[1].text]=[swapped.fields[1].text,swapped.fields[0].text];assert.equal(semanticIssues(expected,swapped,{}).filter(i=>i.code==='data-pair-missing').length,2);
 for(const corrupt of [
  c=>{c.layoutBody.children[0].title='法力';},
  c=>{c.layoutBody.children[0].rowIds=['n1'];},
  c=>{c.layoutBody.children[0].rowIds=[];c.fields.push({id:'unowned',type:'text',label:'数值',text:'120'});},
  c=>{c.layoutBody.children.push({kind:'section',title:'生命',rowIds:['n0']});},
  c=>{c.fields[0].text='1200';},
 ]){const bad=structuredClone(content);corrupt(bad);assert(semanticIssues(expected,bad,{}).some(i=>i.code==='data-pair-missing'));}
 const duplicate=structuredClone(direct);duplicate.fields.push({...duplicate.fields[0],id:'duplicate'});assert(semanticIssues(expected,duplicate,{}).some(i=>i.code==='data-pair-missing'));
});
test('control names use one type-specific suffix only, unique candidates, and retain exact values and target identity',()=>{
 const expected={fields:[{type:'slider',label:'音乐',value:70,min:0,max:100,step:1},{type:'slider',label:'音效',value:40,min:0,max:100,step:1},{type:'switch',label:'公开',value:true}],actions:[{label:'提交',action:'submit',targets:['音乐','音效','公开']}]},content={fields:[{id:'m',type:'slider',label:'音乐音量',value:70,min:0,max:100,step:1},{id:'s',type:'slider',label:'音效滑块',value:40,min:0,max:100,step:1},{id:'p',type:'switch',label:'公开开关',value:true}],actions:[{id:'submit',label:'提交',action:'submit',targets:['m','s','p']}]} ;
 assert.deepEqual(semanticIssues(expected,content,{}),[]);
 assert.deepEqual(semanticIssues({fields:[{type:'switch',label:'音乐',value:true}]},{fields:[{id:'m',type:'switch',label:'音乐开关',value:true}]},{}),[]);
 for(const label of ['关闭音乐','关闭音乐音量','音乐设置','音乐音量滑块']){const bad=structuredClone(content);bad.fields[0].label=label;assert(semanticIssues(expected,bad,{}).some(i=>i.code==='field-missing'));}
 const wrongType=structuredClone(content);wrongType.fields[0].type='switch';assert(semanticIssues(expected,wrongType,{}).some(i=>i.code==='field-missing'));
 const ambiguous=structuredClone(content);ambiguous.fields.push({...ambiguous.fields[0],id:'m2',label:'音乐'});assert(semanticIssues(expected,ambiguous,{}).some(i=>i.code==='field-ambiguous'));
 const duplicate=structuredClone(content);duplicate.fields.push({...duplicate.fields[0],id:'m2'});assert(semanticIssues(expected,duplicate,{}).some(i=>i.code==='field-ambiguous'));
 const swapped=structuredClone(content);[swapped.fields[0].value,swapped.fields[1].value]=[40,70];assert.equal(semanticIssues(expected,swapped,{}).filter(i=>i.code==='field-value').length,2);
 const exact=structuredClone(expected);exact.fields[0].labelExact=true;assert(semanticIssues(exact,content,{}).some(i=>i.code==='field-missing'));const literal=structuredClone(content);literal.fields[0].label='音乐';assert.deepEqual(semanticIssues(exact,literal,{}),[]);
 assert(semanticIssues({fields:[{type:'input',label:'音乐',value:'x'}]},{fields:[{id:'i',type:'input',label:'音乐开关',value:'x'}]},{}).some(i=>i.code==='field-missing'));
 assert(semanticIssues({fields:[{type:'slider',label:'音乐设置',value:70}]},content,{}).some(i=>i.code==='field-missing'));
});
test('section titles allow a grammatical group suffix while exact, ownership and nonempty-content checks remain strict',()=>{
 const expected={sectionTitles:['探索','对话','背包']},content={fields:[{id:'a',type:'text',text:'拖动摇杆移动。'},{id:'b',type:'text',text:'点击对话继续。'},{id:'c',type:'text',text:'点击物品查看。'}],layoutBody:{kind:'column',children:[{kind:'section',title:'探索组',rowIds:['a']},{kind:'section',title:'对话组',rowIds:['b']},{kind:'section',title:'背包组',rowIds:['c']}]}};
 assert.deepEqual(semanticIssues(expected,content,{}),[]);assert(semanticIssues({...expected,sectionTitlesExact:true},content,{}).some(i=>i.code==='section-titles'));
 for(const corrupt of [
  c=>{c.layoutBody.children[0].title='探索活动组';},
  c=>{c.layoutBody.children[0].title='关闭探索组';},
  c=>{c.layoutBody.children[0].title='探索组组';},
  c=>{c.layoutBody.children.push({kind:'section',title:'探索',rowIds:['a']});},
  c=>{c.layoutBody.children[1].rowIds=['a'];},
  c=>{c.layoutBody.children[0].rowIds=[];},
  c=>{c.layoutBody.children[0].rowIds=['missing'];},
  c=>{c.layoutBody.children=[];c.fields.push({id:'names',type:'text',text:'探索 对话 背包'});},
 ]){const bad=structuredClone(content);corrupt(bad);assert(semanticIssues(expected,bad,{}).some(i=>i.code==='section-titles'));}
 const exact=structuredClone(content);for(const section of exact.layoutBody.children)section.title=section.title.slice(0,-1);assert.deepEqual(semanticIssues({...expected,sectionTitlesExact:true},exact,{}),[]);
});
test('progress pairs bind values to their owner, catching swaps that a percentage multiset cannot detect',()=>{
 const expected={progressValues:[60,30,80],progressPairs:[{label:'森林巡逻',percent:60},{label:'古塔探索',percent:30},{label:'采集药草',percent:80}]},content={fields:expected.progressPairs.map((pair,index)=>({id:'p'+index,type:'progress-bar',label:'进度',value:pair.percent,max:100,display:'percent'})),layoutBody:{kind:'grid',children:expected.progressPairs.map((pair,index)=>({kind:'section',title:pair.label,rowIds:['p'+index]}))}};
 assert.deepEqual(semanticIssues(expected,content,{}),[]);
 const swapped=structuredClone(content);[swapped.fields[0].value,swapped.fields[1].value]=[30,60];assert.deepEqual(semanticIssues({progressValues:expected.progressValues},swapped,{}),[]);assert.equal(semanticIssues(expected,swapped,{}).filter(i=>i.code==='progress-pair-missing').length,2);
 for(const corrupt of [c=>{c.layoutBody.children[0].title='其他任务';},c=>{c.layoutBody.children[0].rowIds=[];c.fields.push({id:'elsewhere',type:'progress-bar',label:'进度',value:60,max:100});},c=>{c.layoutBody.children[1].rowIds=['p0'];},c=>{c.fields[0].max=0;}]){const bad=structuredClone(content);corrupt(bad);assert(semanticIssues(expected,bad,{}).some(i=>i.code==='progress-pair-missing'));}
 const ratio=structuredClone(content);ratio.fields[0].value=30;ratio.fields[0].max=50;assert.deepEqual(semanticIssues(expected,ratio,{}),[]);
 const exact={progressPairs:[{label:'生命',value:80,max:100,display:'percent'}]},direct={fields:[{id:'life',type:'progress-bar',label:'生命',value:80,max:100,display:'percent'}]};assert.deepEqual(semanticIssues(exact,direct,{}),[]);direct.fields[0].value=8;direct.fields[0].max=10;assert(semanticIssues(exact,direct,{}).some(i=>i.code==='progress-pair-missing'));
});
test('semantic compatibility never turns missing form targets or an emit masquerading as submit into success',()=>{
 const expected={fields:[{type:'input',label:'昵称',value:'阿青'},{type:'select',label:'语言',options:['中文','英文'],selectedLabel:'中文'},{type:'check-box',label:'公开资料',checked:false}],actions:[{label:'提交',action:'submit',targets:['昵称','语言','公开资料']}]},content={fields:[{id:'n',type:'input',label:'昵称',value:'阿青'},{id:'l',type:'select',label:'语言',options:[{id:'cn',label:'中文'},{id:'en',label:'英文'}],value:'cn'},{id:'p',type:'check-box',label:'公开资料',checked:false}],actions:[{id:'submit',label:'提交',action:'submit',targets:['n']}]};
 assert(semanticIssues(expected,content,{}).some(i=>i.code==='action-targets'));content.actions[0].action='emit';content.actions[0].targets=[];const issues=semanticIssues(expected,content,{});assert(issues.some(i=>i.code==='action-value'));assert(issues.some(i=>i.code==='action-targets'));
});
test('future default progress-owner expectations are authored from the request instead of a model response',async()=>{
 const cases=(await read('configs/panel-acceptance-cases.json')).custom;
 assert.deepEqual(cases.find(c=>c.id==='C21').expected.progressPairs,[{label:'生命',value:80,max:100,display:'percent'},{label:'体力',value:30,max:60,display:'percent'},{label:'经验',value:50,max:100,display:'percent'}]);
 assert.deepEqual(cases.find(c=>c.id==='C22').expected.progressPairs,[{label:'森林巡逻',percent:60},{label:'古塔探索',percent:30},{label:'采集药草',percent:80}]);
});
