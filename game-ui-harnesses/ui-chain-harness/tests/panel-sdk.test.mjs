import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {archiveFiles} from '../src/studio/archive.mjs';
import {hash,json} from '../src/skins/package.mjs';
import {parseSdkZip,verifySdkArchive} from '../src/panel/sdk-archive.mjs';
import {readPanelSdkLock,panelSdkDirectory,installPanelSdk,verifyPanelSdkInstall,createPanelSdkLoader} from '../src/panel/sdk.mjs';

function releaseFixture(){
 const repository='https://github.com/joeylu/ai-generation-orchestrators',commit='a'.repeat(40),version='0.1.0-rc.8',tag='ui-panel-harness-v'+version;
 const files=new Map(Object.entries({
  'package.json':json({name:'ai-ui-panel-harness',version,type:'module',exports:{'.':'./src/index.mjs','./sdk':'./src/sdk.mjs','./planning/v1':'./src/planning-api-v1.mjs','./planning/codex/v1':'./src/planning-codex-v1.mjs'}}),
  'src/index.mjs':'export const fixture=true;',
  'src/sdk.mjs':'export const fixtureSdk=true;',
  'src/planning-api-v1.mjs':'export const PLANNING_API_VERSION="1.0"; export const calls=0;',
  'src/planning-codex-v1.mjs':'export const CODEX_PLANNING_API_VERSION="1.0"; export const calls=0;',
  'examples/catalog.json':json({id:'synthetic-catalog',contextVersion:'fixture'})
 }).map(([name,value])=>[name,Buffer.from(value)]));
 const manifest={releaseManifestVersion:'0.1',package:{name:'ai-ui-panel-harness',version,tag},source:{repository,commit,dirty:false},modelCalls:0,files:[...files].map(([path,b])=>({path,bytes:b.length,sha256:hash(b)}))};
 const manifestBytes=Buffer.from(json(manifest));files.set('release-manifest.json',manifestBytes);files.set('SHA256SUMS',Buffer.from([...files].map(([name,b])=>hash(b)+'  '+name+'\n').join('')));
 const archive=archiveFiles(new Map([...files].map(([name,b])=>['package/'+name,b]))),archiveRecord={file:'ai-ui-panel-harness-'+version+'.zip',bytes:archive.length,sha256:hash(archive)},receipt=Buffer.from(json({version,tag,source:{repository,commit,dirty:false},archive:archiveRecord})),checksums=Buffer.from(hash(archive)+'  '+archiveRecord.file+'\n'+hash(receipt)+'  release-receipt.json\n');
 const base=repository+'/releases/download/'+tag+'/',lock={kind:'ui_panel_sdk_lock',version:'1.0',name:'ai-ui-panel-harness',packageVersion:version,tag,repository,commit,
  archive:{...archiveRecord,url:base+archiveRecord.file},receipt:{file:'release-receipt.json',bytes:receipt.length,sha256:hash(receipt),url:base+'release-receipt.json'},checksums:{file:'SHA256SUMS',bytes:checksums.length,sha256:hash(checksums),url:base+'SHA256SUMS'},manifest:{file:'release-manifest.json',bytes:manifestBytes.length,sha256:hash(manifestBytes),files:manifest.files.length},packageFiles:files.size};
 return {archive,receipt,checksums,lock};
}
async function fixture(t){
 const root=await mkdtemp(join(tmpdir(),'chain-panel-sdk-'));t.after(()=>rm(root,{recursive:true,force:true}));const release=releaseFixture();await mkdir(join(root,'configs'));await writeFile(join(root,'configs/panel-sdk-lock.json'),json(release.lock));return {root,...release};
}
test('offline SDK install binds archive, publication receipt, both checksum inventories and all installed bytes',async t=>{
 const f=await fixture(t);assert.deepEqual(await readPanelSdkLock(f.root),f.lock);
 const sdk=await installPanelSdk(f);assert.equal(sdk.mode,'locked');assert.equal(sdk.files.size,f.lock.packageFiles);assert.equal(sdk.sourceCommit,f.lock.commit);
 const again=await installPanelSdk(f);assert.equal(again.packageDirectory,sdk.packageDirectory);assert.deepEqual(await readFile(join(sdk.directory,f.lock.archive.file)),f.archive);
 assert.equal((await verifyPanelSdkInstall({root:f.root})).manifestSha256,f.lock.manifest.sha256);
 const loader=createPanelSdkLoader({root:f.root});assert.equal((await loader.api('planning/v1')).PLANNING_API_VERSION,'1.0');assert.equal((await loader.api('planning/codex/v1')).calls,0);assert.equal((await loader.identity()).mode,'locked');assert.equal((await loader.json('examples/catalog.json')).id,'synthetic-catalog');
});
test('default missing dependency fails closed; development requires an explicit mode and stays marked development',async t=>{
 const f=await fixture(t),loader=createPanelSdkLoader({root:f.root,mode:'locked'});
 await assert.rejects(loader.api('planning/v1'),{code:'panel.sdk-not-installed'});await assert.rejects(loader.json('examples/catalog.json'),{code:'panel.sdk-not-installed'});
 assert.equal((await createPanelSdkLoader({root:f.root,mode:'development'}).identity()).mode,'development');
 assert.throws(()=>createPanelSdkLoader({root:f.root,mode:'auto'}),{code:'panel.sdk-mode'});
 await assert.rejects(loader.api('src/compiler.mjs'),{code:'panel.sdk-export'});await assert.rejects(loader.json('../ui-panel-harness/package.json'),{code:'panel.sdk-resource'});
});
test('an altered archive, official receipt, manifest inventory or checksum file cannot be installed',async t=>{
 const f=await fixture(t);
 for(const key of ['archive','receipt','checksums'])await assert.rejects(installPanelSdk({...f,[key]:Buffer.concat([f[key],Buffer.from('changed')])}),{code:'panel.sdk-integrity'});
 const other={...f.lock,commit:'b'.repeat(40)};assert.throws(()=>verifySdkArchive({...f,lock:other}),{code:'panel.sdk-integrity'});
 assert.throws(()=>verifySdkArchive({...f,lock:{...f.lock,manifest:{...f.lock.manifest,files:999}}}),{code:'panel.sdk-integrity'});
 await assert.rejects(access(panelSdkDirectory(f.root,f.lock)),{code:'ENOENT'});
});
test('ZIP extraction rejects traversal, case collisions, symbolic links and inconsistent central records',()=>{
 const good=archiveFiles(new Map([['package/a.json',Buffer.from('{}')]])),bad=Buffer.from(good),needle=Buffer.from('package/a.json'),escape=Buffer.from('package/../bad');
 assert.equal(needle.length,escape.length);for(let at=bad.indexOf(needle);at>=0;at=bad.indexOf(needle,at+needle.length))escape.copy(bad,at);
 assert.throws(()=>parseSdkZip(bad),{code:'panel.sdk-integrity'});
 assert.throws(()=>parseSdkZip(archiveFiles(new Map([['package/a.json','1'],['package/A.json','2']]))),{code:'panel.sdk-integrity'});
 const central=good.readUInt32LE(good.length-6),link=Buffer.from(good);link.writeUInt32LE((0xa1ff<<16)>>>0,central+38);assert.throws(()=>parseSdkZip(link),{code:'panel.sdk-integrity'});
 const mismatch=Buffer.from(good);mismatch[central+46+8]=98;assert.throws(()=>parseSdkZip(mismatch),{code:'panel.sdk-integrity'});
});
test('changed installed code/data or extra files are rejected rather than falling back to workspace source',async t=>{
 const f=await fixture(t),sdk=await installPanelSdk(f),loader=createPanelSdkLoader({root:f.root});await loader.identity();
 const code=join(sdk.packageDirectory,'src/index.mjs'),before=await readFile(code);await writeFile(code,'export const compromised=true;');
 await assert.rejects(loader.api('planning/v1'),{code:'panel.sdk-integrity'});await assert.rejects(verifyPanelSdkInstall({root:f.root}),{code:'panel.sdk-integrity'});await writeFile(code,before);
 const data=join(sdk.packageDirectory,'examples/catalog.json');await loader.json('examples/catalog.json');await writeFile(data,'{}');await assert.rejects(loader.json('examples/catalog.json'),{code:'panel.sdk-integrity'});
 await writeFile(data,Buffer.from(json({id:'synthetic-catalog',contextVersion:'fixture'})));await writeFile(join(sdk.packageDirectory,'extra.mjs'),'');await assert.rejects(verifyPanelSdkInstall({root:f.root}),{code:'panel.sdk-integrity'});
});
