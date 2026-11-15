import {join} from 'node:path';
import {existsSync} from 'node:fs';
import {check,digest,exact,seal,unseal,jsonBytes} from './generation/common.mjs';
import {readSelectedFile,parseJson,writeFreshFile} from './files.mjs';
import * as flow from './generation/index.mjs';
import {buildTerrainEdgeDelivery,verifyTerrainEdgeDelivery} from './terrain-edge-pipeline.mjs';
import {assertTerrainPerimeterInputs} from './terrain-perimeter-contract.mjs';

const read=path=>parseJson(readSelectedFile(path));
function checkedTerrain(context,terrain){
  check(terrain,'TERRAIN_PERIMETER_DELIVERY_REQUIRED','Complete brushes require seven checked native perimeter sources and measured controls');
  exact(terrain,['batchSha256','controls',...(Object.hasOwn(terrain,'footprintPolicy')?['footprintPolicy']:[])]);
  const inputs=flow.getTerrainEdgeInputs(context.workflow,terrain.batchSha256);
  assertTerrainPerimeterInputs(context.intent,context.batchSha256,inputs,terrain.controls);return inputs;
}
// The base is a separate, replayable material candidate. It is never published
// as the complete brush. Existing deterministic edge delivery owns final files.
export function deliverCompleteCoherentTerrain(context,output,{composition,relationReviews,guideReviews,terrain}){
  checkedTerrain(context,terrain);check(!existsSync(output)&&!existsSync(output+'.base'),'OUTPUT_EXISTS');
  const candidateId=context.projectId+'.terrain.base';
  flow.checkCoherentCandidateRelations(context.workflow,context.batchSha256,relationReviews,guideReviews,composition);
  const base=flow.buildCoherentCandidate(context.workflow,context.batchSha256,candidateId,output+'.base',composition,relationReviews,guideReviews);
  const options={workflow:context.workflow,baseKitRoot:join(output+'.base','kit'),batchSha256:terrain.batchSha256,controls:terrain.controls,output,
    ...(terrain.footprintPolicy?{footprintPolicy:terrain.footprintPolicy}:{})};
  const delivery=buildTerrainEdgeDelivery(options);verifyTerrainEdgeDelivery(options);
  const binding=seal({format:'ai_scene_coherent_brush_binding_v1',projectId:context.projectId,sourceBatchSha256:context.batchSha256,terrainIntentSha256:digest(context.intent),
    candidateId,baseBundleSha256:base.sha256,compositionSha256:composition.sha256,terrain,deliverySha256:delivery.sha256,perimeterComplete:true,artAcceptance:'not-assessed',generationCalls:0});
  writeFreshFile(join(output,'coherent-brush.json'),jsonBytes(binding),context.workflow);return delivery;
}
export function verifyCompleteCoherentTerrain(context,output){
  const binding=read(join(output,'coherent-brush.json'));unseal(binding);
  exact(unseal(binding),['format','projectId','sourceBatchSha256','terrainIntentSha256','candidateId','baseBundleSha256','compositionSha256','terrain','deliverySha256','perimeterComplete','artAcceptance','generationCalls']);
  check(binding.format==='ai_scene_coherent_brush_binding_v1'&&binding.projectId===context.projectId&&binding.sourceBatchSha256===context.batchSha256
    &&binding.terrainIntentSha256===digest(context.intent)&&binding.perimeterComplete===true&&binding.artAcceptance==='not-assessed'&&binding.generationCalls===0,'TERRAIN_COMPLETION_BINDING');
  checkedTerrain(context,binding.terrain);
  const composition=read(join(output+'.base','evidence/composition-profile.json'));check(composition.sha256===binding.compositionSha256,'TERRAIN_COMPLETION_BINDING');
  const base=flow.verifyCoherentCandidate(context.workflow,context.batchSha256,binding.candidateId,output+'.base',composition);check(base.bundleSha256===binding.baseBundleSha256,'TERRAIN_COMPLETION_BINDING');
  const {terrain}=binding,result=verifyTerrainEdgeDelivery({workflow:context.workflow,baseKitRoot:join(output+'.base','kit'),batchSha256:terrain.batchSha256,controls:terrain.controls,output,
    ...(terrain.footprintPolicy?{footprintPolicy:terrain.footprintPolicy}:{})});
  check(result.reportSha256===binding.deliverySha256,'TERRAIN_COMPLETION_BINDING');return {...result,perimeterComplete:true};
}
