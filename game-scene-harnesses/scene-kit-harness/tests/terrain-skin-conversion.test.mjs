import test from 'node:test';
import assert from 'node:assert/strict';
import {createEditor} from '../src/editor.mjs';
import {canonicalJson} from '../src/document.mjs';
import {sha256} from '../src/validate.mjs';
import {prepareTerrainSkinConversion} from './helpers/terrain-skin-conversion.mjs';

const rejects=(fn,code)=>assert.throws(fn,e=>e.errors?.some(i=>i.code===code));
const command=instanceId=>({type:'convert-terrain-skin',instanceId});
test('explicit rigid-skin conversion preserves cells, collisions, other visuals, PNG bytes and single-undo recovery',{timeout:900000},async t=>{
  const f=prepareTerrainSkinConversion(t),pngs=new Map([...f.context.files].filter(([p])=>p.endsWith('.png')).map(([p,b])=>[p,sha256(b)]));
  await t.test('the default stays isolated; an assembly converts with its other visuals and full-perimeter brush compilation',()=>{
    const editor=createEditor(f.handle,f.map),before=editor.getDocument(),scene=editor.getScene(),history=editor.history();
    const left={x:5,y:3};rejects(()=>editor.execute([{type:'paint-cells',familyId:'terrain.primary',cells:[left]}]),'TERRAIN_SKIN_ISOLATION');
    assert.deepEqual(editor.history(),history);assert.deepEqual(editor.getDocument(),before);
    editor.execute([command('conversion.platform')]);const doc=editor.getDocument(),converted=editor.getScene();
    assert.equal(converted.terrainSkins.length,0);assert.equal(doc.assemblyInstances.length,0);
    assert.equal(converted.counts.terrainNodes,scene.counts.terrainNodes);assert.deepEqual(converted.collisionSuggestions,scene.collisionSuggestions);
    assert.deepEqual(doc.instances.find(i=>i.instanceId==='preserved.visual'),before.instances[0]);
    assert.equal(doc.instances.filter(i=>i.assetId===f.marker.assetId).length,2,'an ornament inside the source assembly must survive expansion');
    assert.equal(converted.counts.visualNodes,scene.counts.visualNodes-1);assert.equal(editor.history().undoDepth,1);
    assert(converted.gridTerrains.length>0);assert(converted.terrainBottomEdgePlacement.placed.length>0);
    const convertedHash=canonicalJson(doc);editor.undo();assert.deepEqual(editor.getDocument(),before);assert.deepEqual(editor.getScene(),scene);
    editor.redo();assert.equal(canonicalJson(editor.getDocument()),convertedHash);
    editor.execute([{type:'paint-cells',familyId:'terrain.primary',cells:[left,{x:6+f.width,y:3},{x:6,y:2},{x:6,y:3+f.height}]}]);
    assert.equal(editor.getScene().counts.terrainNodes,scene.counts.terrainNodes+4);assert.equal(editor.getScene().terrainSkins.length,0);
    assert(editor.getScene().terrainBottomEdgePlacement.placed.length>0);assert.equal(editor.history().undoDepth,2);
    editor.undo();assert.equal(canonicalJson(editor.getDocument()),convertedHash);editor.undo();assert.deepEqual(editor.getDocument(),before);
  });
  await t.test('a direct skin conversion removes only its image, leaving the previously expanded author cells',()=>{
    const editor=createEditor(f.handle,f.map);editor.execute([{type:'expand-assembly',instanceId:'conversion.platform'}]);
    const before=editor.getDocument(),scene=editor.getScene(),skin=before.instances.find(i=>i.assetId===f.skin.assetId),history=editor.history();
    editor.execute([command(skin.instanceId)]);const after=editor.getDocument();
    assert.deepEqual(after.terrainRuns,before.terrainRuns);assert.equal(after.instances.length,before.instances.length-1);
    assert.deepEqual(after.instances,before.instances.filter(i=>i.instanceId!==skin.instanceId));
    assert.deepEqual(editor.getScene().collisionSuggestions,scene.collisionSuggestions);assert.equal(editor.history().undoDepth,history.undoDepth+1);
    editor.undo();assert.deepEqual(editor.getDocument(),before);
  });
  await t.test('invalid/non-skin/multiple-skin targets and later failing commands preserve the entire transaction',()=>{
    const editor=createEditor(f.handle,f.map),before=editor.serialize(),history=editor.history();
    for(const id of ['missing','preserved.visual']){rejects(()=>editor.execute([command(id)]),'TERRAIN_SKIN_CONVERSION_TARGET');assert.equal(editor.serialize(),before);assert.deepEqual(editor.history(),history);}
    rejects(()=>editor.execute([{...command('conversion.platform'),force:true}]),'COMMAND_SHAPE');
    rejects(()=>editor.execute([command('conversion.platform'),{type:'paint-cells',familyId:'terrain.primary',cells:[{x:1000000,y:0}]}]),'TERRAIN_OUT_OF_BOUNDS');
    assert.equal(editor.serialize(),before);assert.deepEqual(editor.history(),history);
    const multiple=structuredClone(f.map);multiple.assemblyInstances[0]={...multiple.assemblyInstances[0],column:1,row:1,presetId:'platform.conversion.multiple'};
    const multi=createEditor(f.handle,multiple),serialized=multi.serialize();assert.equal(multi.getScene().terrainSkins.length,2);
    rejects(()=>multi.execute([command('conversion.platform')]),'TERRAIN_SKIN_CONVERSION_TARGET');assert.equal(multi.serialize(),serialized);assert.equal(multi.history().undoDepth,0);
  });
  for(const [path,digest]of pngs)assert.equal(sha256(f.context.files.get(path)),digest,path);
});
