import test from 'node:test';
import assert from 'node:assert/strict';
import {mergeNativeCoveragePartitions} from '../src/terrain-coverage-mesh.mjs';

const source={path:'native.png',sha256:'a'.repeat(64),byteLength:12};
function rectangle(left,right,origin,opacity=.5){return {part:'bottom',bottomPart:'edge',materialKey:'bottom.edge',source,
  nativeRepeatWindow:{from:1,to:3,interval:'half-open-source-pixels'},nativeSourceOriginWorld:{x:origin,y:0},
  unionBottom:{fromX:0,toX:2,y:1},coverageOpacity:opacity,
  positions:[left,0,right,0,right,1,left,1],uvs:[left-origin,0,right-origin,0,right-origin,1,left-origin,1],indices:[0,1,2,0,2,3]};}
function triangles(meshes){return meshes.flatMap(m=>Array.from({length:m.indices.length/3},(_,i)=>JSON.stringify({source:m.source,opacity:m.coverageOpacity??1,
  points:m.indices.slice(i*3,i*3+3).map(n=>[...m.positions.slice(n*2,n*2+2),...m.uvs.slice(n*2,n*2+2)])}))).sort();}
test('half-open native windows merge only their draw state while retaining every original triangle and source phase range',()=>{
  const before=[rectangle(0,1,0),rectangle(1,2,1)],after=mergeNativeCoveragePartitions(before,()=>true);
  assert.equal(after.length,1);assert.deepEqual(triangles(after),triangles(before));
  assert(!Object.hasOwn(after[0],'nativeSourceOriginWorld'),'a merged phase cannot claim one old origin for the entire geometry');
  assert.deepEqual(after[0].coverageGeometryParts.map(p=>p.nativeSourceOriginWorld),[{x:0,y:0},{x:1,y:0}]);
  for(const part of after[0].coverageGeometryParts){
    assert(part.firstIndex+part.indexCount<=after[0].indices.length);
    assert(part.firstVertex+part.vertexCount<=after[0].positions.length/2);
  }
  assert.equal(mergeNativeCoveragePartitions([before[0],{...before[1],coverageOpacity:.25}],()=>true).length,2);
  assert.equal(mergeNativeCoveragePartitions(before.map(m=>({...m,nativeRepeatWindow:undefined})),()=>true).length,2,
    'complete possibly-overlapping native repeats may not commute across their original placement');
});
