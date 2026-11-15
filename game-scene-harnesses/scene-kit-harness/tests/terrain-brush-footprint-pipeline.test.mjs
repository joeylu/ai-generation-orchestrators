import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {setupTerrainEdgeDelivery} from './helpers/terrain-edge-delivery.mjs';
import {buildTerrainEdgeDelivery,verifyTerrainEdgeDelivery} from '../src/terrain-edge-pipeline.mjs';
import {inspectWorkflow} from '../src/generation/index.mjs';
const policy={minimumSpanCells:{width:1,height:1},maximumCornerTransitionCells:1,minimumInteriorWidthCells:.25,minimumBottomRepeatCells:1,requireFullPerimeter:false};
test('explicit footprint failure stops delivery before creating output and leaves workflow unchanged',{timeout:240000},t=>{
  const f=setupTerrainEdgeDelivery(t),before=inspectWorkflow(f.workflow),options={...f.deliveryOptions,footprintPolicy:{...policy,maximumCornerTransitionCells:.1}};
  assert.throws(()=>buildTerrainEdgeDelivery(options),e=>e.errors?.some(i=>i.code==='TERRAIN_BRUSH_FOOTPRINT'));
  assert.equal(existsSync(options.output),false);assert.deepEqual(inspectWorkflow(f.workflow),before);
});
test('passing explicit footprint is included in deterministic delivery evidence and replay',{timeout:240000},t=>{
  const f=setupTerrainEdgeDelivery(t),before=inspectWorkflow(f.workflow),options={...f.deliveryOptions,footprintPolicy:policy},built=buildTerrainEdgeDelivery(options),
    report=JSON.parse(readFileSync(join(options.output,'candidate/evidence/terrain-brush-footprint.json'))),candidate=JSON.parse(readFileSync(join(options.output,'candidate/readiness.json')));
  assert.equal(report.status,'pass');assert.equal(report.artAcceptance,'not-assessed');assert.equal(candidate.brushFootprintReviewSha256,report.sha256);
  assert.equal(verifyTerrainEdgeDelivery(options).reportSha256,built.sha256);assert.deepEqual(inspectWorkflow(f.workflow),before);
  assert.throws(()=>verifyTerrainEdgeDelivery({...options,footprintPolicy:{...policy,maximumCornerTransitionCells:.1}}),e=>e.errors?.some(i=>i.code==='TERRAIN_BRUSH_FOOTPRINT'));
});
