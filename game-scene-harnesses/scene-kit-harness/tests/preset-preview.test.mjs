import test from 'node:test';import assert from 'node:assert/strict';import {fileURLToPath} from 'node:url';
import {loadSceneKit,readMap,contextFor} from '../src/kit.mjs';import {compileMap} from '../src/compile.mjs';import {createEditor} from '../src/editor.mjs';
import {compilePresetPreview} from '../src/studio/preset-preview.mjs';import {studioKitSnapshot} from '../src/studio/kit-snapshot.mjs';
const root=fileURLToPath(new URL('./fixtures/synthetic',import.meta.url));
test('assembly thumbnails retain real terrain, nested visuals and immutable author/source data',()=>{
 const handle=loadSceneKit(root),context=contextFor(handle),before=readMap(handle),editor=createEditor(handle),author=editor.getDocument(),history=editor.history(),originals=new Map([...context.files].map(([k,v])=>[k,Buffer.from(v)]));
 for(const preset of context.library.presets){
   const thumbnail=compilePresetPreview(handle,preset),expanded=context.model.getPreset(preset.presetId);
   assert.equal(thumbnail.nodes.filter(n=>n.cell).length,expanded.cells.size);assert.equal(thumbnail.nodes.filter(n=>!n.cell).length,expanded.visuals.length);
   const document=readMap(handle);document.terrainRuns=[];document.instances=[];document.inspectionCases=[];document.assemblyInstances=[{instanceId:'comparison',presetId:preset.presetId,column:0,row:0,layerId:'environment'}];
   const nodes=compileMap(handle,document).layers.flatMap(l=>l.nodes);assert.deepEqual(thumbnail.nodes.map(n=>[n.assetId,n.position,n.size,n.signature]),nodes.map(n=>[n.assetId,n.position,n.size,n.signature]));
   assert.ok(thumbnail.bounds.width>=preset.sizeCells.width*64);assert.ok(thumbnail.bounds.height>=preset.sizeCells.height*64);
 }
 assert.deepEqual(readMap(handle),before);assert.deepEqual(editor.history(),history);assert.deepEqual(editor.getDocument(),author);for(const [path,bytes]of originals)assert.deepEqual(context.files.get(path),bytes);
});
test('kit metadata namespaces each thumbnail image and retains per-cell study identity',()=>{
 const handle=loadSceneKit(root),{metadata,assets}=studioKitSnapshot(handle,{assetPrefix:'/assets/project-one'});
 for(const preset of metadata.presets)for(const node of preset.thumbnail.nodes){const module=metadata.modules.find(m=>m.assetId===node.assetId);assert.ok(module);assert.ok(module.url.startsWith('/assets/project-one/'));assert.ok(assets.has(module.url));
   if(node.cell){assert.ok(Number.isInteger(node.signature));assert.deepEqual(node.sourceToLogical,{numerator:1,denominator:1});}
 }
 assert.equal(metadata.presets[0].thumbnail.nodes.filter(n=>!n.cell).length,1);assert.equal(metadata.presets[1].thumbnail.nodes.filter(n=>!n.cell).length,2);
});
