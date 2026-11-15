import test from 'node:test';
import assert from 'node:assert/strict';
import {replaceBridgeBandInstances,checkBridgeBandDrawOrder,checkUnchangedRear} from '../src/verified-bridge-band-variant.mjs';

test('replacement keeps editable bridge and valley instances and all terrain author data',()=>{
 const map={layers:[{layerId:'rear',zIndex:10,parallax:{x:.3,y:1}}],instances:[{instanceId:'rear.actual',assetId:'scene.rear.actual'},{instanceId:'rear.facilities.actual',assetId:'scene.rear.facilities.actual'},
   {instanceId:'tree',assetId:'scene.tree'}],instanceTransforms:[{instanceId:'rear.actual',scale:2},{instanceId:'tree',scale:3}],
   terrainRuns:[{x:2,y:5,length:4}],curveTerrains:[{curveId:'curve'}]};
 const before=structuredClone(map),layer={layerId:'rear.bridge-band',zIndex:15,parallax:{x:.3,y:1}},bridge={instanceId:'bridge.upper',assetId:'scene.bridge.upper',layerId:layer.layerId,x:4,y:8},band={instanceId:'valley.wall',assetId:'scene.valley.wall',layerId:layer.layerId,x:0,y:2};
 const out=replaceBridgeBandInstances(map,bridge,band,layer);assert.deepEqual(map,before);assert.deepEqual(out.terrainRuns,map.terrainRuns);assert.deepEqual(out.curveTerrains,map.curveTerrains);
 assert.deepEqual(out.instances,[map.instances[0],map.instances[2],bridge,band]);assert.deepEqual(out.instanceTransforms,map.instanceTransforms);
 assert.throws(()=>replaceBridgeBandInstances({...map,instances:[...map.instances,bridge]},bridge,band,layer));
 assert.throws(()=>replaceBridgeBandInstances(map,bridge,{...band,instanceId:bridge.instanceId},layer));
 assert.throws(()=>replaceBridgeBandInstances({...map,instances:map.instances.slice(1)},bridge,band,layer));
});
test('compiled order places valley in front of bridge and requires one shared layer',()=>{
 const bridge={nodeId:'visual/bridge.upper'},band={nodeId:'visual/valley.wall'},back={layerId:'rear',zIndex:10,parallax:{x:.3,y:1},nodes:[{nodeId:'visual/rear.actual'}]},front={layerId:'rear.bridge-band',zIndex:15,parallax:{x:.3,y:1},nodes:[bridge,band]};
 checkBridgeBandDrawOrder({layers:[back,front]},'bridge.upper','valley.wall');
 assert.throws(()=>checkBridgeBandDrawOrder({layers:[back,{...front,nodes:[band,bridge]}]},'bridge.upper','valley.wall'));
 assert.throws(()=>checkBridgeBandDrawOrder({layers:[back,{...front,parallax:{x:.5,y:1}}]},'bridge.upper','valley.wall'));
});
test('compiled rear node must remain byte-equivalent',()=>{
 const before={layers:[{nodes:[{nodeId:'visual/rear.actual',position:{x:3,y:9},source:{sha256:'a'}}]}]},after=structuredClone(before);
 checkUnchangedRear(before,after);after.layers[0].nodes[0].position.x++;assert.throws(()=>checkUnchangedRear(before,after));
});
