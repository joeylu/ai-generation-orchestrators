import test from 'node:test';
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {setupTerrainEdgeDelivery} from './helpers/terrain-edge-delivery.mjs';
import {buildTerrainEdgeDelivery} from '../src/terrain-edge-pipeline.mjs';
import {loadSceneKit,readMap,contextFor} from '../src/kit.mjs';
import {renderTerrainBrushExamples} from '../src/studio/terrain-brush-preview.mjs';
import {studioKitSnapshot} from '../src/studio/kit-snapshot.mjs';
import {inspectPng} from '../src/png.mjs';

test('native union brushes publish compiled examples instead of falling back to legacy tile art',{timeout:240000},t=>{
  const f=setupTerrainEdgeDelivery(t),base=loadSceneKit(f.baseKitRoot);
  assert.deepEqual(renderTerrainBrushExamples(base),[],'legacy tile kits keep their existing previews');
  const controls=structuredClone(f.controls);
  Object.assign(controls,{joinProfile:'native-near-opaque-underlap-v1',gridProfile:'grid-solid-union-native-v1'});
  for(const side of ['left','right'])for(const part of ['wall','corner']){
    const item=controls[side][part];item.inboardBlend={fromX:item.innerX,toX:item.innerX+(side==='left'?24:-24)};
  }
  buildTerrainEdgeDelivery({...f.deliveryOptions,controls});
  const handle=loadSceneKit(join(f.deliveryOptions.output,'candidate/kit')),before=readMap(handle),identity=handle.bundleSha256;
  assert.equal(contextFor(handle).kit.terrainSharedField,undefined,'exercise the native-only branch');
  const {metadata,assets}=studioKitSnapshot(handle,{assetPrefix:'/checked'}),brush=metadata.brushes[0];
  assert.equal(brush.previewUrl,'/checked/_terrain-brush-flat.png');
  assert.deepEqual(brush.previewExamples.map(e=>e.id),['flat','steps','gap','concave']);
  for(const example of brush.previewExamples){
    const png=inspectPng(assets.get(example.url));assert.equal(png.width,384);assert.equal(png.height,320);
    assert.notDeepEqual(assets.get(example.url),assets.get(metadata.modules.find(m=>m.assetId===brush.previewAssetId).url));
  }
  assert.deepEqual(readMap(handle),before,'preview rendering must not change authoring');assert.equal(handle.bundleSha256,identity);
});
