import test from 'node:test';import assert from 'node:assert/strict';
import {seal} from '../src/generation/common.mjs';
import {replaceDeepBridge,checkDeepBridgeNativePlacement} from '../src/verified-deep-bridge-variant.mjs';
test('one replacement retains rear, facility and terrain while removing old valley',()=>{
 const map={layers:[{layerId:'rear.bridge-band'}],instances:[{instanceId:'rear.actual',assetId:'scene.rear.actual'},{instanceId:'bridge.upper',assetId:'scene.bridge.upper'},
  {instanceId:'valley.wall',assetId:'scene.valley.wall'},{instanceId:'facility.lower',assetId:'scene.facility.lower'}],instanceTransforms:[{instanceId:'valley.wall',scale:2},{instanceId:'facility.lower',scale:3}],terrainRuns:[{x:1,y:2}]},original=structuredClone(map),replacement={instanceId:'bridge.upper',assetId:'scene.bridge.upper',layerId:'rear.bridge-band',x:30,y:40};
 const out=replaceDeepBridge(map,replacement);assert.deepEqual(map,original);assert.deepEqual(out.instances,[map.instances[0],map.instances[3],replacement]);assert.deepEqual(out.instanceTransforms,[map.instanceTransforms[1]]);assert.deepEqual(out.terrainRuns,map.terrainRuns);
 assert.throws(()=>replaceDeepBridge({...map,instances:map.instances.filter(x=>x.instanceId!=='facility.lower')},replacement));assert.throws(()=>replaceDeepBridge(map,{...replacement,assetId:'scene.wrong'}));
});
test('native transform accounts for crop, padding, scale and rounding tolerance',()=>{
 const evidence=seal({format:'ai_scene_coherent_asset_placement_v1',derivedSha256:'f'.repeat(64),sourceCrop:{x:10,y:20,width:80,height:60},outputSize:{width:44,height:34},transparentMarginPx:2});
 const node={position:{x:13,y:28},source:{sha256:'f'.repeat(64)},sourceToLogical:{numerator:1,denominator:1}},placement={x:10,y:20,scale:{numerator:1,denominator:2},maximumWorldError:.01};
 assert.equal(checkDeepBridgeNativePlacement(node,evidence,placement).maximumError,0);assert.throws(()=>checkDeepBridgeNativePlacement({...node,position:{x:20,y:28}},evidence,placement));
 assert.throws(()=>checkDeepBridgeNativePlacement({...node,source:{sha256:'e'.repeat(64)}},evidence,placement));
});
