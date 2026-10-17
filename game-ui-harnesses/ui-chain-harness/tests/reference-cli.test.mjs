import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir,writeFile,readFile,lstat} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
const exec=promisify(execFile),root=fileURLToPath(new URL('../',import.meta.url)),cli=join(root,'scripts/reference-generation.mjs');
const run=args=>exec(process.execPath,[cli,...args],{cwd:root,windowsHide:true});
const rejected=async(args,code)=>assert.rejects(run(args),error=>{
 assert.equal(error.code,1);const result=JSON.parse(error.stderr);assert.equal(result.modelCalls,0);assert.equal(result.modelMayHaveBeenSubmitted,false);if(code)assert.equal(result.code,code);return true;
});
test('reference CLI describes distinct confirmations and rejects ambiguous or missing options without compute',async()=>{
 const {stdout}=await run(['--help']),help=JSON.parse(stdout);
 assert.equal(help.modelCalls,0);assert.equal(Object.keys(help.commands).length,8);
 await rejected([],'reference-cli.usage');
 await rejected(['prepare','--out','work/unused'],'reference-cli.missing-description');
 await rejected(['status','--directory','work/unused','--plan-sha256','a'.repeat(64),'--adapter','never-import.mjs'],'reference-cli.usage');
});
test('reference CLI freezes and verifies a text plan; mismatched confirmation never imports host adapter',async()=>{
 const output=join(root,'work','reference-cli-test-'+randomUUID());
 const {stdout}=await run(['prepare','--description','青绿国风幻想，金色云纹，清晰的游戏设置界面','--out',output,'--width','512','--height','512','--resolution','exact']);
 const plan=JSON.parse(stdout);assert.match(plan.planSha256,/^[a-f0-9]{64}$/);
 const bytes=await readFile(join(plan.directory,'plan.json'));
 await run(['verify','--directory',plan.directory,'--plan-sha256',plan.planSha256]);
 await run(['status','--directory',plan.directory,'--plan-sha256',plan.planSha256]);
 const sentinel=join(output,'adapter-imported'),adapter=join(output,'host-adapter.mjs');
 await mkdir(output,{recursive:true});
 await writeFile(adapter,`import {writeFileSync} from 'node:fs';writeFileSync(${JSON.stringify(sentinel)},'unexpected');export const generate=()=>{throw Error('unexpected');};`);
 await rejected(['execute','--directory',plan.directory,'--plan-sha256',plan.planSha256,'--confirm-reference','0'.repeat(64),'--adapter',adapter],'reference-cli.confirmation-mismatch');
 await assert.rejects(lstat(sentinel),{code:'ENOENT'});
 assert.deepEqual(await readFile(join(plan.directory,'plan.json')),bytes);
});
