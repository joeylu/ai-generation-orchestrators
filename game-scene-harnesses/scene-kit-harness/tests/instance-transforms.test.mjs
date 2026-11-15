import test from 'node:test';import assert from 'node:assert/strict';
import{mkdtempSync,rmSync}from'node:fs';import{join,resolve,dirname,basename}from'node:path';import{tmpdir}from'node:os';
import{loadSceneKit,readMap,contextFor}from'../src/kit.mjs';import{createEditor}from'../src/editor.mjs';
import{validateDocument}from'../src/schema.mjs';import{exportScene,openSceneExport}from'../src/persistence.mjs';
import{resizeFromCorner}from'../src/studio/transform-tools.mjs';
const handle=loadSceneKit(new URL('./fixtures/synthetic/',import.meta.url).pathname.replace(/^\/([A-Z]:)/,'$1'));
const map=readMap(handle),item=map.instances.find(i=>contextFor(handle).modules.get(i.assetId).kind==='environment');
test('v4 scaling is one atomic upgrade/transform, preserves texture/color and round trips',()=>{
 const editor=createEditor(handle),before=editor.getDocument(),old=editor.getScene().layers.flatMap(l=>l.nodes).find(n=>n.nodeId==='visual/'+item.instanceId);
 assert(validateDocument(map.format,{...map,instanceTransforms:[]}).length>0);
 editor.execute([{type:'enable-instance-transforms'},{type:'transform-instance',instanceId:item.instanceId,x:item.x,y:item.y,scale:2}]);
 const doc=editor.getDocument(),next=editor.getScene().layers.flatMap(l=>l.nodes).find(n=>n.nodeId===old.nodeId);
 assert.equal(doc.format,'ai_scene_document_v4');assert.equal(next.size.width,old.size.width*2);assert.deepEqual(next.source,old.source);assert.equal(next.renderStyle?.tint,old.renderStyle?.tint);
 const base=resolve(tmpdir()),dir=mkdtempSync(join(base,'scene-transform-'));
 try{exportScene(handle,doc,join(dir,'export'));assert.deepEqual(openSceneExport(join(dir,'export')).document,doc);}
 finally{assert.equal(dirname(dir),base);assert(basename(dir).startsWith('scene-transform-'));rmSync(dir,{recursive:true,force:true});}
 editor.undo();assert.deepEqual(editor.getDocument(),before);editor.redo();assert.equal(editor.getDocument().instanceTransforms[0].scale,2);
 editor.execute([{type:'remove-instance',instanceId:item.instanceId}]);assert.equal(editor.getDocument().instanceTransforms.length,0);
});
test('invalid scale and missing targets reject the full gesture without author/history change',()=>{
 const editor=createEditor(handle),before=editor.getDocument();
 for(const [instanceId,scale]of [[item.instanceId,9],[item.instanceId,NaN],['missing',2]])assert.throws(()=>editor.execute([{type:'enable-instance-transforms'},{type:'transform-instance',instanceId,x:0,y:0,scale}]));
 assert.deepEqual(editor.getDocument(),before);assert.equal(editor.history().undoDepth,0);
});
test('corner resizing keeps its opposite corner, uniform aspect and bounded scale',()=>{
 const box={x:100,y:100,width:200,height:100},r=resizeFromCorner(box,'nw',{x:-100,y:0},1);
 assert.equal(r.x+r.width,300);assert.equal(r.y+r.height,200);assert.equal(r.width/r.height,2);assert.equal(r.scale,2);
 assert.equal(resizeFromCorner(box,'se',{x:100000,y:100000},1).scale,8);
});

test('free placement explicitly upgrades once, preserves terrain bounds and exports staged sprites',()=>{
 const editor=createEditor(handle),before=editor.getDocument(),oldScene=editor.getScene();
 const added={...item,instanceId:'staged.marker',x:-320,y:-180};
 assert.throws(()=>editor.execute([{type:'add-instance',instance:added}]));
 editor.execute([{type:'enable-free-placement'},{type:'add-instance',instance:added}]);
 assert.equal(editor.getDocument().format,'ai_scene_document_v5');assert.equal(editor.history().undoDepth,1);
 assert.deepEqual(editor.getScene().worldBounds,oldScene.worldBounds);
 assert.deepEqual(editor.getScene().collisionSuggestions.boundarySegments,oldScene.collisionSuggestions.boundarySegments);
 assert(editor.getScene().layers.flatMap(l=>l.nodes).some(n=>n.nodeId==='visual/staged.marker'&&n.logicalAnchor.x===-320));
 editor.undo();assert.deepEqual(editor.getDocument(),before);editor.redo();
 editor.execute([{type:'transform-instance',instanceId:added.instanceId,x:-640,y:800,scale:1.5}]);
 const staged=editor.getDocument(),history=editor.history();
 assert.throws(()=>editor.execute([{type:'paint-cells',familyId:before.terrainRuns[0].familyId,cells:[{x:-1,y:-1}]}]));
 assert.deepEqual(editor.getDocument(),staged);assert.deepEqual(editor.history(),history);
 const base=resolve(tmpdir()),dir=mkdtempSync(join(base,'scene-free-placement-'));
 try{exportScene(handle,staged,join(dir,'export'));const reopened=openSceneExport(join(dir,'export'));assert.deepEqual(reopened.document,staged);assert.deepEqual(createEditor(handle,reopened.document).getScene().worldBounds,oldScene.worldBounds);}
 finally{assert.equal(dirname(dir),base);assert(basename(dir).startsWith('scene-free-placement-'));rmSync(dir,{recursive:true,force:true});}
});

test('free placement keeps schema coordinate limits and retains existing v4 transforms',()=>{
 const editor=createEditor(handle);editor.execute([{type:'enable-instance-transforms'},{type:'transform-instance',instanceId:item.instanceId,x:item.x,y:item.y,scale:2}]);
 editor.execute([{type:'enable-free-placement'},{type:'move-instance',instanceId:item.instanceId,x:-64,y:-64}]);
 const before=editor.getDocument();assert.equal(before.instanceTransforms[0].scale,2);
 for(const x of [NaN,Infinity,100000001])assert.throws(()=>editor.execute([{type:'move-instance',instanceId:item.instanceId,x,y:0}]));
 assert.deepEqual(editor.getDocument(),before);
});
