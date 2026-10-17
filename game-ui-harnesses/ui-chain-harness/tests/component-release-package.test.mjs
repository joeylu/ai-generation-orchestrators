import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,mkdtemp} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {packageComponentsRelease,verifyComponentsRelease,inspectComponentsArchive} from '../scripts/package-components-release.mjs';
const exec=promisify(execFile),chain='game-ui-harnesses/ui-chain-harness';
async function fixture(){
 const root=await mkdtemp(join(tmpdir(),'ui-components-release-test-'));
 const put=async(file,bytes)=>{await mkdir(join(root,file,'..'),{recursive:true});await writeFile(join(root,file),bytes);};
 await put(chain+'/release/component-contract.json',JSON.stringify({kind:'ui_components_host_contract',version:'1.0',releaseTag:'ui-chain-components-v0.1.0-rc.1',componentCount:16})+'\n');
 await put(chain+'/configs/component-registry.draft.json',JSON.stringify({recipes:Array.from({length:16},(_,i)=>({type:'Component'+i}))}));
 await put(chain+'/package.json',JSON.stringify({engines:{node:'>=22.18.0'},dependencies:{playwright:'1.63.0'},devDependencies:{esbuild:'0.25.12','@fontsource/noto-sans-sc':'5.3.1'}}));
 await put(chain+'/package-lock.json','{"lockfileVersion":3}\n');
 await put(chain+'/src/runtime/consumer.mjs','export const committed = true;\n');
 await put(chain+'/src/runtime/'+('long-'.repeat(21))+'module.mjs','export const paxPath = true;\n');
 await put(chain+'/archive/old/previews/public.png','historical public source');
 await put(chain+'/previews/transient.png','generated preview');
 await put(chain+'/work/private.json','private work');
 await put(chain+'/generated/private.json','generated work');
 await put(chain+'/node_modules/private.json','installed dependency');
 await put('.env','private configuration');
 const git=async args=>(await exec('git',['-c','safe.directory='+root,'-C',root,...args],{windowsHide:true})).stdout.trim();
 await git(['init']);await git(['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','add','.']);await git(['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-m','fixture']);
 return {root,put,git};
}
test('release uses committed HEAD bytes, ignores dirty and untracked files, excludes private outputs',async()=>{
 const f=await fixture(),commit=await f.git(['rev-parse','HEAD']);
 await f.put(chain+'/src/runtime/consumer.mjs','dirty replacement\n');await f.put(chain+'/private-untracked.json','untracked secret');await f.put(chain+'/release/component-contract.json','dirty invalid contract');
 const result=await packageComponentsRelease({repository:f.root}),receipt=JSON.parse(await readFile(join(result.directory,'component-release.json'))),archive=await readFile(join(result.directory,result.archive)),files=inspectComponentsArchive(archive,result.tag);
 assert.equal(result.commit,commit);assert.equal(receipt.source.worktreeRead,false);assert.equal(receipt.requirements.panelSdk,false);assert.equal(receipt.requirements.python,false);assert.equal(receipt.scope.panelGeneration,false);
 assert.equal(files.get(chain+'/src/runtime/consumer.mjs').toString(),'export const committed = true;\n');assert(files.has(chain+'/archive/old/previews/public.png'));
 assert(![...files.keys()].some(path=>path.includes('/work/')||path.includes('/generated/')||path.includes('/node_modules/')||path.includes('/previews/transient')||path.endsWith('.env')||path.includes('private-untracked')));
 assert.equal((await verifyComponentsRelease(result.directory)).status,'verified');
 const second=await packageComponentsRelease({repository:f.root,commit});assert.notEqual(second.directory,result.directory);assert.equal(second.archiveSha256,result.archiveSha256);
});
test('release verification rejects mutated archive, contract and checksums without claiming success',async()=>{
 const f=await fixture();
 for(const file of ['archive','component-contract.json','SHA256SUMS']){
  const result=await packageComponentsRelease({repository:f.root}),path=join(result.directory,file==='archive'?result.archive:file),bytes=await readFile(path);await writeFile(path,Buffer.concat([bytes,Buffer.from('\ntampered')]));
  await assert.rejects(verifyComponentsRelease(result.directory),{code:'components.release-integrity'});
 }
});
test('release rejects non-work outputs, missing committed contracts, and non-version tags',async()=>{
 const f=await fixture();
 await assert.rejects(packageComponentsRelease({repository:f.root,outputRoot:join(f.root,'outside')}),{code:'components.release-path'});
 await assert.rejects(packageComponentsRelease({repository:f.root,tag:'latest'}),/immutable/);
 await assert.rejects(packageComponentsRelease({repository:f.root,tag:'ui-chain-components-v0.1.0-rc.2'}),/differs from the committed/);
 await f.git(['rm',chain+'/release/component-contract.json']);await f.git(['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-m','missing contract']);
 await f.put(chain+'/release/component-contract.json','{"kind":"only-dirty","version":"1.0"}');
 await assert.rejects(packageComponentsRelease({repository:f.root}),/Required committed release input is missing/);
});
