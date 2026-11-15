import test from 'node:test';
import assert from 'node:assert/strict';
import { createEditor } from '../src/editor.mjs';
import { loadSceneKit } from '../src/kit.mjs';
import { DEFAULT_APPEARANCE } from '../src/instance-appearance.mjs';
import { renderCoherentFrame } from '../src/coherent-render.mjs';
import { encodeRgbaPng, inspectPng } from '../src/png.mjs';
import { exportSceneArchive } from '../src/persistence.mjs';
import { unpackStored } from './helpers/archive.mjs';
import { fixtureRoot } from './helpers/generation.mjs';

test('appearance edits are atomic, per-instance, and preserved with the original assets in exports', () => {
  const kit = loadSceneKit(fixtureRoot), editor = createEditor(kit);
  const original = editor.getDocument(), scene = editor.getScene();
  const instanceId = 'marker.main';
  const target = scene.layers.flatMap(layer => layer.nodes).find(node => node.nodeId === `visual/${instanceId}`);
  const appearance = {...DEFAULT_APPEARANCE, opacity: 68, contrast: -24, fog: 30};
  const command = {type:'set-instance-appearance', instanceId, appearance};
  assert.throws(() => editor.execute([{type:'enable-layered-terrain'}, {...command, appearance:{...appearance, opacity:101}}]));
  assert.deepEqual(editor.getDocument(), original);
  assert.equal(editor.history().undoDepth, 0);
  editor.execute([{type:'enable-layered-terrain'}, command]);
  const edited = editor.getScene(), doc = editor.getDocument();
  assert.deepEqual(doc.instanceAppearances, [{instanceId, appearance}]);
  assert.deepEqual(edited.layers, scene.layers.map(layer => ({...layer, nodes:layer.nodes.map(node => node===target ? {...node,appearance} : node)})));
  assert.deepEqual(edited.collisionSuggestions.boundarySegments, scene.collisionSuggestions.boundarySegments);
  assert.deepEqual(edited.collisionSuggestions.standingSurfaces, scene.collisionSuggestions.standingSurfaces);
  for (const id of ['strip.main','pair.main','unknown']) assert.throws(() => editor.execute([{...command, instanceId:id}]));
  for (const rows of [[...doc.instanceAppearances, ...doc.instanceAppearances], [{instanceId:'unknown', appearance}]]) {
    assert.throws(() => createEditor(kit, {...doc,instanceAppearances:rows}));
  }
  editor.undo(); assert.deepEqual(editor.getDocument(), original);
  editor.redo(); assert.deepEqual(editor.getDocument(), doc);
  const before = unpackStored(exportSceneArchive(kit, original)), after = unpackStored(exportSceneArchive(kit,doc));
  assert.deepEqual(after.get(`kit/${target.source.path}`), before.get(`kit/${target.source.path}`));
  assert.deepEqual(JSON.parse(after.get('scene.document.json')).instanceAppearances, doc.instanceAppearances);
  editor.execute([{...command, appearance:null}]);
  assert.equal(Object.hasOwn(editor.getDocument(),'instanceAppearances'),false);
  editor.undo();
  editor.execute([{type:'remove-instance',instanceId}]);
  assert.equal(Object.hasOwn(editor.getDocument(),'instanceAppearances'),false);
});

test('fog blends color while opacity separately preserves transparent and soft edges', () => {
  const source = encodeRgbaPng(3,1,Buffer.from([80,60,40,255, 80,60,40,128, 0,0,0,0]));
  const node = {kind:'sprite', position:{x:0,y:0}, size:{width:3,height:1}, source:{sha256:'sample',path:'sample.png'},
    appearance:{...DEFAULT_APPEARANCE, opacity:50, fog:100, fogColor:0xa0c8ff}};
  const scene = {defaultCamera:{viewport:{width:3,height:1},center:{x:1.5,y:.5}}, layers:[{visible:true,nodes:[node]}]};
  const {rgba} = inspectPng(renderCoherentFrame(scene,()=>source),{includePixels:true});
  assert.deepEqual([...rgba], [95,122,157,255, 62,82,108,255, 29,43,59,255]);
});
