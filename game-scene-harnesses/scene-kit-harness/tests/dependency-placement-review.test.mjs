import test from 'node:test';
import assert from 'node:assert/strict';
import {digest,hash,seal} from '../src/generation/common.mjs';
import {reviewDependencyPlacement} from '../src/generation/dependency-placement-review.mjs';

function fixture(){
 const raw=Buffer.from('synthetic source bytes'),source=seal({recipe:{assetId:'bridge'}});
 const dependent=seal({recipe:{assetId:'occluder',sourceDependency:{format:'ai_scene_source_dependency_v1',sourcePlanSha256:source.sha256,
   placement:{x:10,y:20,scale:{numerator:1,denominator:2}},observations:[{observationId:'foot',native:{x:30,y:50}}]}},
   sourceDependencyEvidence:{sourcePlanSha256:source.sha256,sourceRawSha256:hash(raw)}});
 const evidence=seal({format:'ai_scene_coherent_asset_placement_v1',sourceSha256:hash(raw),derivedSha256:'f'.repeat(64),
   sourceCrop:{x:10,y:20,width:80,height:60},outputSize:{width:44,height:34},transparentMarginPx:2});
 const node={nodeId:'visual/bridge',assetId:'scene.bridge',layerId:'rear',position:{x:13,y:28},source:{sha256:'f'.repeat(64)},
   sourceToLogical:{numerator:1,denominator:1},renderStyle:{tint:0xffffff,opacity:1}};
 const scene={layers:[{layerId:'rear',parallax:{x:.3,y:1},nodes:[node,{nodeId:'visual/occluder',layerId:'rear'}]}]};
 return {dependentPlan:dependent,sourcePlan:source,sourceRaw:raw,placementEvidence:evidence,compiled:{...scene,contentSha256:digest(scene)}};
}
test('native observed point maps through crop, padding and compiled node',{timeout:5000},()=>{
 const f=fixture(),r=reviewDependencyPlacement(f);assert.equal(r.status,'pass');assert.deepEqual(r.points[0].actual,{x:25,y:45});assert.equal(r.contact,'not-assessed');
});
test('drift blocks, stale artifacts and differing parallax fail closed',()=>{
 const f=fixture(),scene=structuredClone(f.compiled);delete scene.contentSha256;scene.layers[0].nodes[0].position.x+=3;
 assert.equal(reviewDependencyPlacement({...f,compiled:{...scene,contentSha256:digest(scene)}}).status,'blocked');
 assert.throws(()=>reviewDependencyPlacement({...f,sourceRaw:Buffer.from('changed')}));
 assert.throws(()=>reviewDependencyPlacement({...f,compiled:{...f.compiled,contentSha256:'0'.repeat(64)}}));
 const separated=structuredClone(scene);separated.layers[0].nodes.pop();separated.layers.push({layerId:'other',parallax:{x:.5,y:1},nodes:[{nodeId:'visual/occluder',layerId:'other'}]});
 assert.throws(()=>reviewDependencyPlacement({...f,compiled:{...separated,contentSha256:digest(separated)}}));
});
