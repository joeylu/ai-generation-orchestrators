import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {join,dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from 'node:net';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {once} from 'node:events';
import {buildStudioFixture,readStudioFixtureConfig,fixtureWorkPath} from '../scripts/studio-fixture-build.mjs';
import {studioSnapshot} from '../src/studio/catalog.mjs';
const root=fileURLToPath(new URL('../',import.meta.url)),exec=promisify(execFile);

test('retired real-acceptance entry points cannot interpret flags or actions as compute authorization',async()=>{
 for(const script of ['studio-real-acceptance.mjs','studio-real-followthrough.mjs']){
  const help=await exec(process.execPath,[join(root,'scripts',script),'--help'],{cwd:root});
  assert.equal(JSON.parse(help.stdout).status,'retired');
  for(const action of ['--real-confirmed','panel-run-confirmed','process']){
   await assert.rejects(exec(process.execPath,[join(root,'scripts',script),action],{cwd:root}),error=>{
    const result=JSON.parse(error.stdout);assert.equal(result.code,'STUDIO_REAL_ACCEPTANCE_RETIRED');assert.equal(result.modelCalls,0);return error.code===1;
   });
  }
 }
});

test('isolated raster fixture builds and serves four/five plans without real Studio configuration or calls',async t=>{
 const work=join(root,'work'),directory=await mkdtemp(join(work,'studio-offline-test-'));
 t.after(async()=>{assert.equal(dirname(resolve(directory)),resolve(work));assert.match(directory.split(/[\\/]/).at(-1),/^studio-offline-test-/);await rm(directory,{recursive:true,force:true});});
 const result=await buildStudioFixture({output:directory}),config=await readStudioFixtureConfig(result.configPath);
 assert.equal(result.realModelCalls,0);assert.equal(config.fixture.source,'synthetic-raster');
 assert.equal((await studioSnapshot(root,config)).items.length,2);
 const manifest=JSON.parse(await readFile(join(result.consumer,'manifest.json')));assert.equal(manifest.components,16);
 assert.equal(JSON.parse(await readFile(join(result.consumer,'skin/skin-pack.json'))).sourceKind,'imported');
 assert.throws(()=>fixtureWorkPath('../private.json'),/WORK_PATH_REQUIRED/);
 const unrelated=join(directory,'not-a-fixture.json');await writeFile(unrelated,JSON.stringify({version:'0.1',name:'Unrelated Studio',artifacts:[]}));
 await assert.rejects(()=>readStudioFixtureConfig(unrelated),/OFFLINE_FIXTURE_CONFIG_REQUIRED/);
 const reserve=createServer();reserve.listen(0,'127.0.0.1');await once(reserve,'listening');const port=reserve.address().port;await new Promise(resolve=>reserve.close(resolve));
 const server=spawn(process.execPath,['scripts/studio-ux-fixture.mjs',String(port),'--fixture-config',result.configPath],{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe']});
 t.after(async()=>{if(server.exitCode===null){const ended=once(server,'exit');server.kill();await ended;}});
 await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(Error('fixture timeout')),20000);server.once('error',reject);server.once('exit',()=>reject(Error('fixture exited')));server.stdout.once('data',()=>{clearTimeout(timeout);resolve();});});
 const base='http://127.0.0.1:'+port;
 assert.deepEqual((await(await fetch(base+'/library.json')).json()).projects,[]);
 const sourceResponse=await fetch(base+'/panel-edit/source?artifact=fixture-panel');assert.equal(sourceResponse.status,200);
 const editSource=await sourceResponse.json();assert.equal(editSource.artifactId,'fixture-panel');assert.equal(editSource.variants.length,2);
 const loaded=await fetch(base+'/panel-edit/load',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify({artifactId:editSource.artifactId,variantKey:editSource.variants[0].key})});
 assert.equal(loaded.status,200);assert.equal((await loaded.json()).document.kind,'ui_panel_document');
 for(const materials of [false,true]){
  const response=await fetch(base+'/projects/plan',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify({project:{name:'Offline',description:'synthetic only',materialGeneration:materials}})});
  assert.equal(response.status,200);const plan=await response.json();assert.equal(plan.sheets.length,materials?5:4);assert.equal(plan.assets,materials?35:32);assert.equal(plan.assets,plan.sheets.reduce((sum,sheet)=>sum+sheet.assets,0));
  const {projects}=await(await fetch(base+'/library.json')).json();assert.equal(projects[0].state.nodes.length,materials?5:4);
 }
 assert.deepEqual(await(await fetch(base+'/fixture-counts.json')).json(),{fullCalls:0,panelCalls:0,localCalls:0});
});
