import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {createEditor} from '../src/editor.mjs';
import {compileMap} from '../src/compile.mjs';
import {contextFor,readMap} from '../src/kit.mjs';
import {startStudio} from '../src/studio/host.mjs';
import {readStoredArchive,storeArchive} from '../src/archive.mjs';
import {sha256} from '../src/validate.mjs';
import {adaptiveEditorKit} from './helpers/adaptive-editor-kit.mjs';

const budget=error=>error.errors?.some(e=>e.code==='TERRAIN_BOTTOM_BUDGET');
test('compile-budget rejection is atomic across core history, plain HTTP replacement and persistent project imports',{timeout:900000},async t=>{
  const f=adaptiveEditorKit(t),familyId=contextFor(f.handle).rules.familyId,blank=readMap(f.handle);
  Object.assign(blank,{mapId:'atomic.budget.seed',bounds:{x:0,y:0,width:32,height:16},terrainRuns:[],curveTerrains:[],instances:[],assemblyInstances:[],
    terrainConnections:[],instanceTransforms:[],inspectionCases:[],defaultCamera:{center:{x:512,y:288},viewport:{width:1024,height:576},scale:1}});
  const cells=[];for(let y=2;y<12;y++)for(let x=2;x<22;x++)if((x+y)%2===0)cells.push({x,y});
  const invalid={...structuredClone(blank),terrainRuns:cells.map(c=>({...c,length:1,familyId}))},
    command={type:'paint-cells',familyId,cells},good={type:'paint-cells',familyId,cells:[{x:1,y:1}]};
  assert.doesNotThrow(()=>contextFor(f.handle).model.analyzeMap(invalid),'the witness must pass author structural analysis');
  assert.throws(()=>compileMap(f.handle,invalid),budget,'the current public renderer must reject actual native work, not a fake validation error');

  await t.test('core execute and constructor reject before changing document, undo or redo',()=>{
    const editor=createEditor(f.handle,blank);editor.execute([good]);editor.undo();
    const before={document:editor.getDocument(),history:editor.history(),scene:editor.getScene()};
    assert.throws(()=>editor.execute([command]),budget);
    assert.deepEqual({document:editor.getDocument(),history:editor.history(),scene:editor.getScene()},before);
    assert.throws(()=>createEditor(f.handle,invalid),budget);
    assert.equal(editor.redo().changed,true);assert.equal(editor.undo().changed,true);
    assert.deepEqual(editor.getDocument(),before.document);
  });

  const staticRoot=join(f.parent,'atomic-static');mkdirSync(staticRoot);
  for(const file of ['index.html','app.js','style.css','projects.html','projects.js','projects.css'])writeFileSync(join(staticRoot,file),'synthetic');
  const post=(host,path,body,type='application/json')=>fetch(host.url+path,{method:'POST',headers:{Origin:host.url,'Content-Type':type},
    body:type==='application/json'?JSON.stringify(body):body});
  const state=async host=>{const result=await fetch(host.url+'/api/state');assert.equal(result.status,200);return result.json();};
  const reject=async response=>{assert.equal(response.status,422);assert((await response.json()).errors.some(e=>e.code==='TERRAIN_BOTTOM_BUDGET'));};

  await t.test('plain HTTP keeps revision, readable scene and redo after failed gesture and import',async()=>{
    const host=await startStudio({root:f.root,staticRoot,initialDocument:blank});
    try{
      await post(host,'/api/edit',{revision:0,action:'commands',commands:[good]});
      await post(host,'/api/edit',{revision:1,action:'undo'});const before=await state(host);
      await reject(await post(host,'/api/edit',{revision:before.revision,action:'commands',commands:[command]}));
      assert.deepEqual(await state(host),before);
      await reject(await post(host,'/api/edit',{revision:before.revision,action:'import',document:invalid}));
      assert.deepEqual(await state(host),before);
      const redone=await post(host,'/api/edit',{revision:before.revision,action:'redo'});assert.equal(redone.status,200);
      assert.equal((await redone.json()).history.undoDepth,1);
    }finally{await host.close();}
  });

  await t.test('project gesture, map import and project ZIP rejection preserve disk snapshot and active state',async()=>{
    const workspaceRoot=join(f.parent,'atomic-workspace'),host=await startStudio({root:f.root,staticRoot,initialDocument:blank,workspaceRoot});
    try{
      await post(host,'/api/edit',{revision:0,action:'commands',commands:[good]});
      await post(host,'/api/edit',{revision:1,action:'undo'});const before=await state(host),snapshot=readFileSync(join(workspaceRoot,'workspace.json'));
      await reject(await post(host,'/api/edit',{revision:before.revision,action:'commands',commands:[command]}));
      await reject(await post(host,'/api/projects',{revision:before.revision,action:'import-map',name:'Rejected',document:invalid}));
      const exported=await fetch(host.url+`/api/projects/export?revision=${before.revision}`);assert.equal(exported.status,200);
      const files=readStoredArchive(Buffer.from(await exported.arrayBuffer())),descriptor=JSON.parse(files.get('project.json')),
        manifest=JSON.parse(files.get('manifest.json'));
      descriptor.project.maps[0].document=invalid;files.set('project.json',Buffer.from(JSON.stringify(descriptor)+'\n'));
      // This synthetic producer updates only its own archive inventory. No
      // production source, accepted result or delivery manifest is rewritten.
      manifest.files=manifest.files.map(item=>({...item,byteLength:files.get(item.path).length,sha256:sha256(files.get(item.path))}));
      files.set('manifest.json',Buffer.from(JSON.stringify(manifest)+'\n'));
      await reject(await post(host,`/api/projects/import?revision=${before.revision}`,storeArchive(files),'application/zip'));
      assert.deepEqual(await state(host),before);assert.deepEqual(readFileSync(join(workspaceRoot,'workspace.json')),snapshot);
      const redone=await post(host,'/api/edit',{revision:before.revision,action:'redo'});assert.equal(redone.status,200);
      assert.equal((await redone.json()).history.undoDepth,1);
    }finally{await host.close();}
    const reopened=await startStudio({root:f.root,staticRoot,initialDocument:blank,workspaceRoot});
    try{assert.equal((await state(reopened)).revision,3);}finally{await reopened.close();}
  });
});
