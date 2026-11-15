import test from 'node:test';
import assert from 'node:assert/strict';
import {replaceDepthPairInstances,checkDistinctDepthSources} from '../src/verified-depth-pair-variant.mjs';

const old=()=>({instances:[{instanceId:'rear.actual',assetId:'scene.rear.actual',layerId:'rear',x:5,y:4},{instanceId:'rear.facilities.actual',assetId:'scene.rear.facilities.actual',layerId:'rear',x:6,y:7},{instanceId:'other',assetId:'scene.other',layerId:'front',x:1,y:2}],instanceTransforms:[{instanceId:'rear.actual',scale:0.75},{instanceId:'other',scale:1.1}],curveTerrains:[{curveId:'untouched',points:[1,2,3]}]});
const mid={instanceId:'rear.actual',assetId:'scene.rear.actual',layerId:'rear',x:0,y:8},far={instanceId:'far.actual',assetId:'scene.far.actual',layerId:'far',x:0,y:3};
test('the separate depth instances replace prior canyon and bridge without moving playable terrain',()=>{
  const input=old(),before=structuredClone(input),out=replaceDepthPairInstances(input,mid,far);assert.deepEqual(input,before);
  assert.deepEqual(out.instances,[mid,before.instances[2],far]);assert.deepEqual(out.instanceTransforms,[before.instanceTransforms[1]]);assert.deepEqual(out.curveTerrains,before.curveTerrains);
});
test('missing or conflicting depth identities block replacement',()=>{
  const m=old();m.instances.push(far);assert.throws(()=>replaceDepthPairInstances(m,mid,far));
  assert.throws(()=>replaceDepthPairInstances(old(),mid,{...far,assetId:'scene.other'}));
  const n=old();n.instances.splice(1,1);assert.throws(()=>replaceDepthPairInstances(n,mid,far));
});
test('one image cannot stand in for both distinct planned depth sources',()=>{
  checkDistinctDepthSources(Buffer.from('far'),Buffer.from('mid'));
  assert.throws(()=>checkDistinctDepthSources(Buffer.from('same'),Buffer.from('same')));
});
