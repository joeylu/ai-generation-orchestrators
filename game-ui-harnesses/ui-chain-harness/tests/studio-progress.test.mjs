import test from 'node:test';
import assert from 'node:assert/strict';
import {sheetProgress,projectProgress,panelProgress,elapsedText,batchPresentation,needsSheetSupplement} from '../src/studio/progress.mjs';

test('rejected received images permit an explicit supplement while passing images do not',()=>{
 for(const status of ['failed','indeterminate','supplement-awaiting-confirmation'])assert.equal(needsSheetSupplement({status}),true);
 assert.equal(needsSheetSupplement({status:'received',inspection:'rejected'}),true);
 assert.equal(needsSheetSupplement({status:'received',inspection:'pixel-gates-passed-awaiting-visual-review'}),false);
 assert.equal(needsSheetSupplement({status:'submitted'}),false);
});
test('diagnosis explains a terminal connection failure without changing status or stale-running indicators',()=>{
 const n={status:'indeterminate',outcomeRecorded:true,submittedAt:'2026-10-14T11:49:16Z',diagnostic:{label:'生图连接失败',detail:'请检查连接后仅补本张',finishedAt:'2026-10-14T11:49:42Z'}};
 assert.equal(sheetProgress(n).label,'生图连接失败');assert.equal(sheetProgress(n).finishedAt,n.diagnostic.finishedAt);assert.equal(n.status,'indeterminate');
 assert.equal(sheetProgress({...n,outcomeRecorded:false},{operation:'running'}).label,'生成中');
 assert.equal(sheetProgress({...n,status:'received'}).label,'已收到');
});
test('sheet progress distinguishes submitted waits from terminal unknown outcomes and retained failures',()=>{
 assert.equal(sheetProgress({status:'indeterminate',outcomeRecorded:false},{operation:'running'}).state,'active');
 assert.equal(sheetProgress({status:'indeterminate',outcomeRecorded:true},{operation:'running'}).state,'blocked');
 assert.equal(sheetProgress({status:'indeterminate'},{}).state,'blocked');
 assert.equal(sheetProgress({status:'failed'},{operation:'running'}).state,'blocked');
 assert.equal(sheetProgress({status:'authorized-awaiting-external-submission'},{operation:'running'}).label,'等待提交');
 assert.equal(sheetProgress({status:'received',inspection:'rejected'}).state,'done');
 assert.match(sheetProgress({status:'received',inspection:'rejected'}).detail,/偏差/);
});
test('local progress counts only completed groups and distinguishes recovery, pause and publication',()=>{
 const nodes=[...['source-s01','source-s02','source-s03','source-s04'].map(id=>({id,kind:'source',status:'passed'})),{id:'locate',kind:'locate',status:'passed'},{id:'metadata',kind:'metadata',status:'incomplete'},{id:'content-insets',status:'waiting'},{id:'postprocess',status:'waiting'}];
 const p={batchReady:true,busy:true,phase:'processing',state:{nodes:Array.from({length:4},()=>({status:'received'}))},task:{nodes}};
 const current=projectProgress(p);assert.equal(current.passed,2);assert.equal(current.total,5);assert.equal(current.stages[2].state,'active');assert.equal(current.flow[3].state,'waiting');
 assert.equal(projectProgress({...p,busy:false,recovering:true}).stages[2].state,'recovering');
 assert.equal(projectProgress({...p,busy:false,phase:'processing-failed'}).stages[2].state,'blocked');
 assert.equal(projectProgress({...p,busy:false,skin:{version:'fixture'}}).passed,5);
 assert.equal(projectProgress({...p,task:{nodes:[...nodes,{id:'extension',kind:'future-stage',status:'waiting'}]}}).total,6);
});
test('pending or failed projects never show completed delivery and panel stages reflect real boundaries',()=>{
 assert.equal(projectProgress({state:{fresh:true,nodes:[]}}).received,0);
 assert.equal(projectProgress({state:{fresh:false,nodes:[{status:'failed'}]}}).current,'图集需要处理');
 assert.deepEqual(panelProgress({status:'running',stage:'rendering'}).map(s=>s.state),['done','active','waiting']);
 assert.deepEqual(panelProgress({status:'interrupted-no-retry',stage:'rendering'}).map(s=>s.state),['done','blocked','waiting']);
 assert.deepEqual(panelProgress({status:'ready'}).map(s=>s.state),['done','done','done']);
});
test('elapsed time uses actual timestamps and freezes at a recorded end',()=>{
 const start='2026-10-14T01:00:00Z';assert.equal(elapsedText(start,'2026-10-14T01:01:05Z'), '1 分 5 秒');
 assert.equal(elapsedText(start,undefined,Date.parse(start)+3500),'3 秒');
 assert.equal(elapsedText(null), '');assert.equal(elapsedText('bad'), '');assert.equal(elapsedText(start,'2026-10-13T01:00:00Z'),'');
});

test('material batch progress waits for S05 and labels 30 components separately from 3 materials',()=>{
 const sheets=['S01','S02','S03','S04','S05'].map(sheetId=>({sheetId}));
 const nodes=sheets.map((n,i)=>({...n,status:i===4?'indeterminate':'received'}));
 const plan={sheets,state:{fresh:false,nodes}};
 const progress=projectProgress(plan),batch=batchPresentation(plan);
 assert.equal(progress.received,4);assert.equal(progress.sheetTotal,5);assert.equal(progress.flow[1].state,'blocked');
 assert.match(batch.sheetDescription,/4 张组件图集 \+ 1 张材质图集/);assert.match(batch.assetDescription,/30 个基础部件 \+ 3 个材质/);
 assert.equal(progress.stages.at(-1).label,'材质绑定与组件检查');
 const ready=projectProgress({...plan,state:{nodes:nodes.map(n=>({...n,status:'received'}))}});
 assert.equal(ready.flow[1].state,'done');assert.equal(ready.current,'等待本地处理');
 assert.equal(batchPresentation({}).sheetTotal,4);assert.equal(batchPresentation({materialGeneration:true}).sheetTotal,4);
 assert.deepEqual(batch.sheetIds,['S01','S02','S03','S04','S05']);
});

test('batch descriptions derive square-slot and material counts from frozen plans while legacy counts stay unchanged',()=>{
 const sheets=[4,10,9,9,3].map((assets,index)=>({sheetId:'S0'+(index+1),assets}));
 assert.match(batchPresentation({sheets,assets:35}).assetDescription,/32 个基础部件 \+ 3 个材质/);
 assert.match(batchPresentation({sheets:sheets.slice(0,4),assets:32}).assetDescription,/32 个通用部件/);
 assert.match(batchPresentation({assets:35,state:{nodes:[{sheetId:'S05'}]}}).assetDescription,/32 个基础部件 \+ 3 个材质/);
 assert.match(batchPresentation({}).assetDescription,/30 个通用部件/);
 assert.match(batchPresentation({sheets:[4,10,9,7,3].map((assets,index)=>({sheetId:'S0'+(index+1),assets}))}).assetDescription,/30 个基础部件 \+ 3 个材质/);
});
