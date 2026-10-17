import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm,readFile} from 'node:fs/promises';
import {join,relative} from 'node:path';
import {tmpdir} from 'node:os';
import {hash,json} from '../src/skins/package.mjs';
import {continueWorkflow,workflowStatus} from '../src/skins/workflow.mjs';
test('checkpoint resumes only missing stages, retains failed attempt, detects changed artifacts and tools',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'skin-flow-'));try{
    await mkdir(join(dir,'receipts'));await writeFile(join(dir,'input.json'),'{}');
    await writeFile(join(dir,'request.json'),json({id:'fixture',toolSha256:'tool-v1',inputs:[{file:'input.json',sha256:hash(Buffer.from('{}'))}]}));
    const calls=[];let fail=true;
    const execute=async(stage,out)=>{calls.push(stage);if(stage==='assemble'&&fail)throw Error('fixture failure');await writeFile(join(out,'result.json'),'{}');return{result:relative(dir,join(out,'result.json')).replaceAll('\\','/')};};
    await continueWorkflow(dir,{toolSha256:'tool-v1',until:'inspect',execute});
    const receipt=await readFile(join(dir,'receipts/inspect.json'));
    await assert.rejects(continueWorkflow(dir,{toolSha256:'tool-v1',execute}),/fixture failure/);
    assert.equal((await workflowStatus(dir)).status,'failed-retryable');fail=false;
    const final=await continueWorkflow(dir,{toolSha256:'tool-v1',execute});assert.equal(final.status,'awaiting-visual-review');assert.equal(final.productionReady,false);assert.equal(final.visualReview.status,'pending');
    assert.deepEqual(calls,['inspect','assemble','assemble','consumer','check']);assert.deepEqual(await readFile(join(dir,'receipts/inspect.json')),receipt);
    await continueWorkflow(dir,{toolSha256:'tool-v1',execute});assert.equal(calls.length,5);
    await assert.rejects(continueWorkflow(dir,{toolSha256:'tool-v2',execute}),/tools-changed/);
    await writeFile(join(dir,final.stages[0].outputs.result),'changed');await assert.rejects(workflowStatus(dir),/artifact-changed/);
  }finally{await rm(dir,{recursive:true,force:true});}
});
test('lock and input fingerprints block continuation',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'skin-flow-'));try{
    await mkdir(join(dir,'receipts'));await writeFile(join(dir,'input.json'),'{}');await writeFile(join(dir,'request.json'),json({id:'fixture',toolSha256:'x',inputs:[{file:'input.json',sha256:hash(Buffer.from('{}'))}]}));await writeFile(join(dir,'.run.lock'),'');
    await assert.rejects(continueWorkflow(dir,{toolSha256:'x',execute:()=>assert.fail('must not run')}),/lock/);await rm(join(dir,'.run.lock'));await writeFile(join(dir,'input.json'),'changed');await assert.rejects(workflowStatus(dir),/artifact-changed/);
  }finally{await rm(dir,{recursive:true,force:true});}
});
