import test from 'node:test';
import assert from 'node:assert/strict';
import {replaceMidgroundInstances,checkMidgroundCamera,checkMidgroundOutputIsolation,checkMidgroundMaterial} from '../src/verified-midground-variant.mjs';
import {hash} from '../src/generation/common.mjs';

const map=()=>({instances:[{instanceId:'rear.actual',assetId:'scene.rear.actual',layerId:'rear',x:5,y:4},
  {instanceId:'rear.facilities.actual',assetId:'scene.rear.facilities.actual',layerId:'rear',x:6,y:7},
  {instanceId:'other',assetId:'scene.other',layerId:'front',x:1,y:2}],
  instanceTransforms:[{instanceId:'rear.actual',scale:0.75},{instanceId:'other',scale:1.1}],
  curveTerrains:[{curveId:'untouched',points:[1,2,3]}]});
const replacement={instanceId:'rear.actual',assetId:'scene.rear.actual',layerId:'rear',x:0,y:8};
test('replacing the combined layer removes the old bridge and old scale without touching terrain or other instances',()=>{
  const input=map(),saved=structuredClone(input),out=replaceMidgroundInstances(input,replacement);
  assert.deepEqual(input,saved);assert.deepEqual(out.instances,[replacement,saved.instances[2]]);
  assert.deepEqual(out.instanceTransforms,[saved.instanceTransforms[1]]);assert.deepEqual(out.curveTerrains,saved.curveTerrains);
});
test('missing or mismatched source instances are rejected',()=>{
  const input=map();input.instances.splice(1,1);assert.throws(()=>replaceMidgroundInstances(input,replacement));
  assert.throws(()=>replaceMidgroundInstances(map(),{...replacement,assetId:'scene.other'}));
});
test('background coverage is bound to the actual reference camera, including scale',()=>{
  const actual={center:{x:128,y:72},viewport:{width:256,height:144},scale:1},planned={referenceCenterWorld:{x:128,y:72},viewportWorld:{width:256,height:144}};
  checkMidgroundCamera(actual,planned);assert.throws(()=>checkMidgroundCamera({...actual,scale:2},planned));
  assert.throws(()=>checkMidgroundCamera({...actual,center:{x:129,y:72}},planned));assert.throws(()=>checkMidgroundCamera({...actual,viewport:{width:512,height:144}},planned));
});
test('output cannot contain or be contained by any checked input',()=>{
  checkMidgroundOutputIsolation('fixture/output',['fixture/input','fixture/workflow']);
  assert.throws(()=>checkMidgroundOutputIsolation('fixture/input/output',['fixture/input']));
  assert.throws(()=>checkMidgroundOutputIsolation('fixture',['fixture/input']));
});
test('material binding requires both digests, one evidence entry and matching source bytes',()=>{
  const raw=Buffer.from('synthetic material'),sha=hash(raw),kit={terrainAppearance:{sourceSha256:sha}},evidence=[{role:'material',assetId:'coherent.material',rawSha256:sha}];
  checkMidgroundMaterial(kit,kit,evidence,raw);
  assert.throws(()=>checkMidgroundMaterial({}, {},evidence,raw));
  assert.throws(()=>checkMidgroundMaterial(kit,{},evidence,raw));
  assert.throws(()=>checkMidgroundMaterial(kit,kit,[],raw));
  assert.throws(()=>checkMidgroundMaterial(kit,kit,[...evidence,...evidence],raw));
  assert.throws(()=>checkMidgroundMaterial(kit,kit,[{...evidence[0],rawSha256:'0'.repeat(64)}],raw));
  assert.throws(()=>checkMidgroundMaterial(kit,kit,evidence,Buffer.from('different')));
});
