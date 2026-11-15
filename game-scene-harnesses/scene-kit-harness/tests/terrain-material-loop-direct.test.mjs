import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {buildTerrainEdgeDelivery,verifyTerrainEdgeDelivery} from '../src/terrain-edge-pipeline.mjs';
import {loadSceneKit,readMap,contextFor} from '../src/kit.mjs';
import {compileMap} from '../src/compile.mjs';
import {exportSceneArchive,openSceneExport} from '../src/persistence.mjs';
import {canonicalMap} from '../src/document.mjs';
import {TERRAIN_UNION_MATERIAL_PROFILE} from '../src/terrain-union-material.mjs';
import {NEAR_OPAQUE_JOIN_PROFILE} from '../src/terrain-edges.mjs';
import * as flow from '../src/generation/index.mjs';
import {setupTerrainEdgeDelivery} from './helpers/terrain-edge-delivery.mjs';
import {coherentSurfaceObservations} from './helpers/coherent.mjs';

test('a future checked source batch derives its loop from its own density evidence without an upgrade or supplied usable-row count',
  {timeout:900000},t=>{
    const observations=coherentSurfaceObservations();observations.rockFeaturePairs[0].source.toX=160;
    const f=setupTerrainEdgeDelivery(t,{sourceAlpha:252,surfaceObservations:observations}),controls={...structuredClone(f.controls),
      joinProfile:NEAR_OPAQUE_JOIN_PROFILE,materialDensityProfile:'reference-native-2x-v1',gridProfile:'grid-solid-union-native-v1',junctions:{},
      materialProfile:TERRAIN_UNION_MATERIAL_PROFILE,materialLoop:{overlapRows:64,phaseCount:3}};
    for(const side of ['left','right'])for(const part of ['wall','corner'])controls[side][part].inboardBlend={
      fromX:controls[side][part].innerX,toX:side==='left'?264:24};
    const options={...f.deliveryOptions,controls,output:join(f.parent,'direct-loop')},workflowBefore=flow.inspectWorkflow(f.workflow),
      delivery=buildTerrainEdgeDelivery(options),root=join(options.output,'candidate/kit'),handle=loadSceneKit(root),context=contextFor(handle),
      loop=context.kit.terrainMaterialLoop,density=JSON.parse(readFileSync(join(options.output,'candidate/evidence/terrain-density2/density-derivation.json'),'utf8')),
      document=canonicalMap(readMap(handle)),scene=compileMap(handle,document);
    assert.equal(context.kit.terrainEdges.format,'ai_scene_terrain_edges_v6');
    assert.equal(loop.options.usableRows,density.bodySampleHeight);assert.notEqual(loop.options.usableRows,452,'synthetic evidence is not the watermill theme count');
    assert.equal(loop.options.overlapRows,controls.materialLoop.overlapRows);assert.equal(loop.options.phaseCount,3);
    assert.equal(scene.terrainMaterial.body.source.sha256,loop.output.source.sha256);
    assert.equal(context.files.get(context.kit.terrainAppearance.body.source.path).length,context.kit.terrainAppearance.body.source.byteLength);
    assert.equal(delivery.generationCalls,0);assert.equal(delivery.finalHumanArtReview,'pending');
    const reopened=openSceneExport(join(options.output,'export'));assert.deepEqual(reopened.document,document);assert.deepEqual(reopened.compiled,scene);
    assert.deepEqual(readFileSync(join(options.output,'scene-kit.zip')),exportSceneArchive(handle,document));
    assert.equal(verifyTerrainEdgeDelivery(options).reportSha256,delivery.sha256);
    assert.deepEqual(flow.inspectWorkflow(f.workflow),workflowBefore);
    assert.throws(()=>buildTerrainEdgeDelivery({...options,controls:{...controls,materialLoop:{...controls.materialLoop,usableRows:452}},output:join(f.parent,'user-selected-native-row-count')}),
      error=>error.errors?.some(issue=>issue.code==='WORKFLOW_SHAPE'));
  });
