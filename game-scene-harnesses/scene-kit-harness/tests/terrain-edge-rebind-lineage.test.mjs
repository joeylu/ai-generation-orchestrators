import test from 'node:test';
import assert from 'node:assert/strict';
import {terrainEdgePreparationBound} from '../src/terrain-edge-preparation-evidence.mjs';

test('immutable rebind child retains preparations only through its exact replayed parent',()=>{
  const parent={sha256:'parent',preparationSha256s:['gutter','native-size'],planSha256s:['gutter','native-size','replaced']};
  const child={format:'ai_scene_terrain_edge_rebind_batch_v1',parentBatchSha256:'parent',planSha256s:['gutter','native-size','rebound']};
  assert.equal(terrainEdgePreparationBound(child,parent,'gutter'),true);
  assert.equal(terrainEdgePreparationBound(child,parent,'native-size'),true);
  assert.equal(terrainEdgePreparationBound(child,{...parent,sha256:'other'},'gutter'),false);
  assert.equal(terrainEdgePreparationBound(child,{...parent,preparationSha256s:['native-size']},'gutter'),false);
  assert.equal(terrainEdgePreparationBound(child,{...parent,planSha256s:['native-size']},'gutter'),false);
  assert.equal(terrainEdgePreparationBound({...child,planSha256s:['native-size']},parent,'gutter'),false);
  assert.equal(terrainEdgePreparationBound({format:'legacy',preparationSha256s:['gutter']},null,'gutter'),true);
  assert.equal(terrainEdgePreparationBound({format:'legacy',planSha256s:['gutter']},parent,'gutter'),false);
});
