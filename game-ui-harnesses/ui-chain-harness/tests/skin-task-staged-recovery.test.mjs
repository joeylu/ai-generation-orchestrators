import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {resumeTask} from '../src/skins/task-dag.mjs';
import {hash} from '../src/skins/package.mjs';
import {projectProgress} from '../src/studio/progress.mjs';
const graph=JSON.parse(await readFile(new URL('../configs/skin-task-dag.json',import.meta.url)));
for(const failedNode of ['material-bind','consumer-build','postprocess'])test(`staged recovery preserves completed receipts after ${failedNode} failure`,async()=>{
 const dir=await mkdtemp(join(tmpdir(),'staged-recovery-'));try{
  await mkdir(join(dir,'receipts'));await writeFile(join(dir,'request.json'),JSON.stringify({graph,inputs:[]}));
  const calls=[];let fail=true;
  const options={assertTools:async()=>{},verify:async files=>{for(const f of files)assert.equal(hash(await readFile(join(dir,f.file))),f.sha256);},execute:async node=>{
   calls.push(node.id);if(node.id===failedNode&&fail)throw Error('injected failure');
   const file=node.id+'.txt',bytes=Buffer.from(node.id);await writeFile(join(dir,file),bytes,{flag:'wx'});return {outputs:{id:node.id},files:[{file,sha256:hash(bytes)}]};
  }};
  await assert.rejects(resumeTask(dir,options),/injected failure/);
  const completed=graph.nodes.slice(0,graph.nodes.findIndex(n=>n.id===failedNode));
  const receipts=await Promise.all(completed.map(n=>readFile(join(dir,'receipts',n.id+'.json'))));
  fail=false;assert.equal((await resumeTask(dir,options)).status,'awaiting-visual-review');
  for(let i=0;i<completed.length;i++){assert.deepEqual(await readFile(join(dir,'receipts',completed[i].id+'.json')),receipts[i]);assert.equal(calls.filter(id=>id===completed[i].id).length,1);}
  assert.equal(calls.filter(id=>id===failedNode).length,2);const count=calls.length;await resumeTask(dir,options);assert.equal(calls.length,count);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('Studio keeps staged postprocessing in one unfinished group until final check passes',()=>{
 const nodes=graph.nodes.map(n=>({id:n.id,status:n.id==='postprocess'?'failed-retryable':'passed'}));
 const p=projectProgress({task:{nodes},phase:'processing-failed'});assert.equal(p.total,5);assert.equal(p.passed,4);assert.equal(p.stages.at(-1).state,'blocked');
});

test('final stage accepts relocated checker evidence and preserves consumer and assembly inputs',async()=>{
 const {executePostprocessStage}=await import('../src/skins/postprocess-stages.mjs');
 const root=await mkdtemp(join(tmpdir(),'postprocess-root-')),external=await mkdtemp(join(tmpdir(),'relocated-check-'));
 try{
  await mkdir(join(root,'work/assembly'),{recursive:true});await mkdir(join(root,'work/consumer'));
  await writeFile(join(root,'work/assembly/inspection.json'),'{}');await writeFile(join(root,'work/assembly/review.md'),'review');
  for(const file of ['checks.json','wide.png','tall.png'])await writeFile(join(external,file),file);
  const result=await executePostprocessStage({root,node:{kind:'postprocess'},prior:{assemble:{directory:'work/assembly'},'consumer-build':{consumerDirectory:'work/consumer',assets:32,stages:[]}},request:{},command:async(script,args)=>{assert.equal(script,'consumer-check.mjs');assert.equal(args[0],join(root,'work/consumer'));return {status:'passed',checks:64,directory:external};}});
  assert.equal(result.outputs.status,'checked-candidate');assert.equal(await readFile(join(root,result.outputs.directory,'evidence/wide.png'),'utf8'),'wide.png');
  assert.equal(await readFile(join(root,result.outputs.directory,'review.md'),'utf8'),'review');
  for(const f of result.files)assert.equal(hash(await readFile(join(root,f.file))),f.sha256);
 }finally{await rm(root,{recursive:true,force:true});await rm(external,{recursive:true,force:true});}
});
