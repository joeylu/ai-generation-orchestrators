import assert from 'node:assert/strict';
import {audioFlowStudy} from '../../examples/audio-flow-v1/fixture.mjs';
/** Accept only the declared local regrouping; business, typography and all resource bytes stay exact. */
export function assertAudioFlowStudy(before,after,core) {
  assert.equal(after.compilerVersion,before.compilerVersion);
  for(const key of ['state','bindings','actions','assetClosure'])assert.deepEqual(after[key],before[key]);
  assert.deepEqual(after.spec.sections.flatMap(section=>section.rows),before.spec.sections.flatMap(section=>section.rows));
  const expected=audioFlowStudy(before);assert.deepEqual(after.spec,expected.spec);assert.deepEqual(after.catalog,expected.catalog);
  assert.deepEqual(after.catalog.themes,before.catalog.themes);
  assert.deepEqual(core.bundleResources(after.componentBundle),core.bundleResources(before.componentBundle));
}
