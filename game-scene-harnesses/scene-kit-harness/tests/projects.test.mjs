import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,mkdirSync,renameSync,readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadSceneKit,readMap} from '../src/kit.mjs';
import {createEditor} from '../src/editor.mjs';
import {createProjectWorkspace} from '../src/studio/projects.mjs';
import {exportSceneArchive} from '../src/persistence.mjs';
import {readStoredArchive,storeArchive} from '../src/archive.mjs';

const fixture=fileURLToPath(new URL('./fixtures/synthetic',import.meta.url)),handle=loadSceneKit(fixture);
const paint={type:'paint-cells',familyId:'terrain.stone',cells:[{x:10,y:3}]};
function workspace(t){const root=mkdtempSync(join(tmpdir(),'scene-projects-'));t.after(()=>rmSync(root,{recursive:true,force:true}));return {root,w:createProjectWorkspace({root,handle,projectName:'合成项目'})};}
function op(w,action,extra={}){return w.operate({revision:w.state().revision,action,...extra});}
function command(w,commands){return w.edit({revision:w.state().revision,action:'commands',commands});}
test('stored archive parser rejects corruption, aliases and unsupported compression',()=>{
  const archive=storeArchive(new Map([['ok.txt',Buffer.from('abc')]]));assert.equal(readStoredArchive(archive).get('ok.txt').toString(),'abc');
  const bad=Buffer.from(archive);bad[36]^=1;assert.throws(()=>readStoredArchive(bad));
  assert.throws(()=>readStoredArchive(storeArchive(new Map([['A.txt',Buffer.from('a')],['a.txt',Buffer.from('b')]]))));
  assert.throws(()=>readStoredArchive(storeArchive(new Map([['con.txt',Buffer.from('x')]]))));
  assert.throws(()=>readStoredArchive(storeArchive(new Map([['a',Buffer.from('x')],['a/b',Buffer.from('y')]]))));
  const method=Buffer.from(archive);method.writeUInt16LE(8,8);assert.throws(()=>readStoredArchive(method));
  assert.throws(()=>readStoredArchive(archive.subarray(0,-1)));assert.throws(()=>readStoredArchive(archive,{maxBytes:10}));
});
test('fork stages edits and undo without touching the original editor',()=>{
  const original=createEditor(handle),fork=original.fork();const before=original.getDocument();
  fork.execute([{...paint,familyId:before.terrainRuns[0].familyId}]);
  assert.deepEqual(original.getDocument(),before);assert.equal(original.history().undoDepth,0);assert.equal(fork.history().undoDepth,1);
  const next=fork.fork();next.undo();assert.deepEqual(next.getDocument(),before);assert.equal(fork.history().undoDepth,1);
});
test('projects isolate assets, maps and history; local restart and portable project replay',t=>{
  const {w,root}=workspace(t),initial=w.state(),family=initial.document.terrainRuns[0].familyId,project=initial.workspace.activeProjectId;
  command(w,[{...paint,familyId:family}]);const edited=w.state(),map=edited.workspace.activeMapId;
  op(w,'create-map',{name:'空白地图',template:'empty'});assert.equal(w.state().scene.counts.terrainNodes,0);assert.equal(w.state().document.instances.length,0);
  op(w,'switch-map',{mapId:map});assert.deepEqual(w.state().document,edited.document);assert.equal(w.state().history.undoDepth,1);
  const portable=w.exportProject(w.state().revision);op(w,'create-project',{name:'新主题',template:'empty'});assert.equal(w.state().scene,null);assert.equal(w.current().asset,null);
  const empty=w.state().workspace.activeProjectId;
  assert.throws(()=>command(w,[paint]),e=>e.code==='PROJECT_NEEDS_ASSETS');
  const archive=exportSceneArchive(handle,readMap(handle));w.importAssets(archive,w.state().revision);assert.equal(w.state().scene.counts.terrainNodes,99);assert.equal(w.state().history.undoDepth,0);
  assert.throws(()=>w.importAssets(archive,w.state().revision),e=>e.code==='PROJECT_ASSETS_EXIST');
  op(w,'create-project',{name:'复制项目',template:'current'});const clone=w.state().workspace.activeProjectId;command(w,[{...paint,familyId:family}]);
  op(w,'switch-project',{projectId:empty});assert.equal(w.state().scene.counts.terrainNodes,99);
  op(w,'switch-project',{projectId:project});assert.equal(w.state().scene.counts.terrainNodes,100);assert.equal(w.state().history.undoDepth,1);
  w.importProject(portable,w.state().revision);assert.equal(w.state().workspace.projects.length,4);assert.equal(w.current().project.maps.length,2);assert.deepEqual(w.state().document,edited.document);
  assert.notEqual(w.state().workspace.activeProjectId,project);assert.notEqual(w.state().workspace.activeMapId,map);
  const reopened=createProjectWorkspace({root,handle});assert.deepEqual(reopened.state().document,w.state().document);assert.equal(reopened.state().workspace.projects.length,4);assert.equal(reopened.state().history.undoDepth,0);assert.equal(reopened.state().revision,w.state().revision);
  assert.throws(()=>reopened.operate({revision:0,action:'create-map',name:'旧窗口',template:'empty'}),e=>e.code==='STALE_REVISION');
  assert.equal(reopened.current().asset.handle.bundleSha256,handle.bundleSha256);assert.ok(clone);
});
test('failed save/import and stale revision preserve author state and undo history',t=>{
  const {w,root}=workspace(t),family=w.state().document.terrainRuns[0].familyId;command(w,[{...paint,familyId:family}]);const before=w.state();
  const path=join(root,'workspace.json');renameSync(path,path+'.retained');mkdirSync(path);
  assert.throws(()=>command(w,[{type:'erase-cells',cells:[{x:10,y:3}]}]),e=>e.code==='PROJECT_SAVE_FAILED');assert.deepEqual(w.state(),before);
  rmSync(path,{recursive:true});renameSync(path+'.retained',path);
  assert.throws(()=>w.operate({revision:0,action:'create-project',name:'过时',template:'empty'}),e=>e.code==='STALE_REVISION');
  assert.throws(()=>w.importProject(Buffer.from('bad'),before.revision));assert.deepEqual(w.state(),before);
  assert.throws(()=>op(w,'create-project',{name:'bad',template:'empty',path:'../'}));assert.deepEqual(w.state(),before);
  const stored=readFileSync(path);writeFileSync(path,'{}');assert.throws(()=>createProjectWorkspace({root,handle}));writeFileSync(path,stored);
});
test('empty project portable roundtrip stays empty; imported map becomes a new map',t=>{
  const {w}=workspace(t),original=w.state().document;op(w,'import-map',{name:'导入的地图',document:original});assert.equal(w.current().project.maps.length,2);
  op(w,'create-project',{name:'空项目',template:'empty'});const buffer=w.exportProject(w.state().revision);w.importProject(buffer,w.state().revision);assert.equal(w.state().scene,null);
  assert.equal(w.current().project.maps.length,1);assert.equal(w.current().asset,null);
});
test('project hub overview and inactive download are read-only; copying an inactive project uses its own assets/maps',t=>{
 const {w}=workspace(t),source=w.state(),sourceId=source.workspace.activeProjectId;op(w,'create-project',{name:'空白前台',template:'empty'});const before=w.state();
 const overview=w.overview();assert.equal(overview.projects.length,2);assert.equal(overview.projects[0].environmentCount,2);assert.equal(overview.projects[0].brushCount,1);assert.match(overview.projects[0].coverUrl,new RegExp(sourceId));assert.equal(overview.projects[1].coverUrl,null);
 assert.equal(w.preview(sourceId).readUInt32BE(0),0x89504e47);assert.equal(w.preview(before.workspace.activeProjectId),null);assert.equal(w.preview('../'),null);assert.deepEqual(w.state(),before);
 const archive=w.exportProject(before.revision,sourceId),descriptor=JSON.parse(readStoredArchive(archive).get('project.json'));assert.equal(descriptor.project.projectId,sourceId);assert.deepEqual(w.state(),before);
 assert.throws(()=>w.exportProject(before.revision,'00000000-0000-0000-0000-000000000000'),e=>e.code==='PROJECT_NOT_FOUND');
 op(w,'copy-project',{projectId:sourceId,name:'非当前项目副本'});assert.deepEqual(w.state().document,source.document);assert.equal(w.current().asset.handle.bundleSha256,handle.bundleSha256);assert.notEqual(w.state().workspace.activeProjectId,sourceId);
 const active=w.state().workspace.activeProjectId;op(w,'switch-project',{projectId:sourceId});assert.equal(w.state().workspace.projects.find(p=>p.projectId===active).name,'非当前项目副本');assert.deepEqual(w.state().document,source.document);
});
