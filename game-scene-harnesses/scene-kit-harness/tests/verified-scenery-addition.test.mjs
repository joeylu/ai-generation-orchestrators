import test from 'node:test';
import assert from 'node:assert/strict';
import {addSceneryInstance,checkSceneryOrder,createSceneryAdditionLayer} from '../src/verified-scenery-addition.mjs';
test('adds an independently editable scenery instance without changing existing author data',()=>{
 const map={layers:[{layerId:'rear.bridge-band'}],instances:[{instanceId:'bridge.upper',x:10,y:20}],curveTerrains:[{curveId:'ground'}]},before=structuredClone(map);
 const facility={instanceId:'facility.lower',assetId:'scene.facility.lower',layerId:'rear.bridge-band',x:30,y:40},next=addSceneryInstance(map,facility);
 assert.deepEqual(map,before);assert.deepEqual(next.instances,[...map.instances,facility]);assert.deepEqual(next.curveTerrains,map.curveTerrains);
 assert.throws(()=>addSceneryInstance(next,facility));assert.throws(()=>addSceneryInstance(map,{...facility,layerId:'missing'}));
});
test('an explicitly added layer copies parallax and rejects identifier and depth collisions',()=>{
 const map={layers:[{layerId:'rear.bridge-band',kind:'environment',zIndex:15,parallax:{x:.3,y:1},visible:true},{layerId:'next',zIndex:20}]};
 const layer=createSceneryAdditionLayer(map,'rear.facility',{copyFromLayerId:'rear.bridge-band',zIndex:16});assert.deepEqual(layer,{...map.layers[0],layerId:'rear.facility',zIndex:16});
 assert.throws(()=>createSceneryAdditionLayer(map,'rear.facility',{copyFromLayerId:'rear.bridge-band',zIndex:20}));
 assert.throws(()=>createSceneryAdditionLayer(map,'next',{copyFromLayerId:'rear.bridge-band',zIndex:16}));
 assert.throws(()=>createSceneryAdditionLayer(map,'rear.facility',{copyFromLayerId:'missing',zIndex:16}));
});
test('rejects missing and incorrectly ordered scenery relations',()=>{
 const scene={layers:[{zIndex:10,nodes:[{nodeId:'visual/rear.actual'}]},{zIndex:15,nodes:[{nodeId:'visual/bridge.upper'},{nodeId:'visual/facility.lower'},{nodeId:'visual/valley.wall'}]}]};
 checkSceneryOrder(scene,'facility.lower',['rear.actual','bridge.upper'],['valley.wall']);
 assert.throws(()=>checkSceneryOrder(scene,'facility.lower',['valley.wall'],[]));
 assert.throws(()=>checkSceneryOrder(scene,'facility.lower',[],['missing']));
});
