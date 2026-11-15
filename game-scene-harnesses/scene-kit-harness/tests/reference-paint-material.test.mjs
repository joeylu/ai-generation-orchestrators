import test from 'node:test';
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {readFileSync,existsSync,writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import * as flow from '../src/generation/index.mjs';
import * as pipeline from '../src/reference-paint-pipeline.mjs';
import {renderMaterialGuide,MATERIAL_DESIGN_FILES} from '../src/generation/reference-paint-material.mjs';
import {seal,unseal,hash,jsonBytes} from '../src/generation/common.mjs';
import {fixture,generated} from './helpers/reference-paint.mjs';
import {decision} from './helpers/generation.mjs';
const rejects=(fn,code)=>assert.throws(fn,e=>e.errors?.some(v=>v.code===code));
function setup(t,{accept=true}={}) {
  const f=fixture(t),labels=Buffer.alloc(128*100);
  for(let i=0;i<labels.length;i++)if(f.mask.rgba[i*4+3])labels[i]=i%128<40?2:i%128<55?3:1;
  const vectors=seal({format:'synthetic-reviewed-components',components:[{id:'wood.part'},{id:'snow.part'},{id:'body.part'}]});
  const recipe=seal({format:'ai_scene_material_alignment_zone_recipe_v1',geometryAlphaSha256:hash(f.alpha),vectorDraftSha256:vectors.sha256,
    canvas:{width:128,height:100},paintBleedPx:8,deliveryAlphaUnchanged:true,opticalAlphaMeasured:false,
    corePriority:['body-appearance','snow','wood'],bleedPriority:'protect-core-then-snow-before-wood-before-body-guide-only',
    assignments:[{componentId:'wood.part',materialRole:'wood'},{componentId:'snow.part',materialRole:'snow'},{componentId:'body.part',materialRole:'body-appearance'}]});
  const guide=renderMaterialGuide(labels,128,100),probes=seal({format:'ai_scene_material_coverage_probe_plan_v1',recipeSha256:recipe.sha256,
    opacityAloneCertifiesCoverage:false,colorThresholdAloneCertifiesCoverage:false,automaticGrayRemoval:false,
    probes:[{probeId:'A1',componentId:'wood.part',expectedMaterial:'wood',x:10,y:30},
      {probeId:'A2',componentId:'snow.part',expectedMaterial:'snow',x:45,y:30},
      {probeId:'F1',componentId:'known-failure-site',expectedMaterial:'wood',x:11,y:30}]});
  const proposal=seal({format:'ai_scene_material_alignment_design_proposal_v1',previousSourceDesignSha256:f.design.sha256,
    zoneRecipeSha256:recipe.sha256,probePlanSha256:probes.sha256,computeAuthorized:false,
    inputRoles:[{sha256:hash(f.guide)},{sha256:hash(guide)},{sha256:hash(f.raw)}]});
  const artifacts=new Map([['next-step-proposal.json',jsonBytes(proposal)],['zone-recipe.json',jsonBytes(recipe)],
    ['vector-draft.json',jsonBytes(vectors)],['material-core-labels.bin',labels],['material-zone-guide.png',guide],['probe-plan.json',jsonBytes(probes)]]);
  const packet=seal({format:'ai_scene_material_design_control_packet_v1',sourceReviewPacketSha256:hash(Buffer.from('synthetic material design review')),
    proposalSha256:proposal.sha256,artifacts:MATERIAL_DESIGN_FILES.map(path=>({path,sha256:hash(artifacts.get(path)),byteLength:artifacts.get(path).length})),computeAuthorized:false});
  const importOptions={controlId:'material.synthetic',basePaintControlsSha256:f.c.sha256,reviewPacket:packet};
  const m=flow.importMaterialPaintControls(f.workflow,importOptions,artifacts);
  if(accept)flow.reviewMaterialPaintControls(f.workflow,m.sha256,decision('material.design',proposal.sha256));
  return {...f,materialGuide:guide,labels,materialProposal:proposal,materialArtifacts:artifacts,materialPacket:packet,materialImportOptions:importOptions,m,
    materialOptions:{planId:'material.paint.first',parents:[],capabilitiesSha256:f.cap.sha256,materialControlsSha256:m.sha256}};
}
async function receive(f,{unknown=false}={}) {
  const p=flow.freezeMaterialPaintPlan(f.workflow,f.materialOptions); let calls=0;
  flow.authorizePlan(f.workflow,p.sha256,decision('material.compute',p.sha256,'approve-compute'));
  const adapter={preflight:async()=>{},generate:async input=>{
    calls++; assert.equal(pipeline.inspectPaintSource(f.workflow,p.sha256).status,'submitted');
    assert.deepEqual(input.images.map(i=>hash(i.bytes)),[hash(f.guide),hash(f.materialGuide),hash(f.raw)]);
    if(unknown)throw Error('synthetic unknown'); return generated();
  }};
  await pipeline.runPaintSource(f.workflow,p.sha256,adapter);return {p,adapter,calls};
}
const observation=(p,verdict='pass')=>({probes:p.probes.map(v=>({probeId:v.probeId,verdict,notes:'Synthetic semantic review, not a classifier.'})),
  regions:p.regions.map(region=>({region,verdict,notes:'Synthetic complete region, transition and footprint review.'}))});
test('material plans freeze exactly three images while v25 output remains unchanged and neither plan authorizes compute',t=>{
  const f=setup(t),old=flow.previewPaintSourcePlan(f.workflow,f.options),before=flow.inspectWorkflow(f.workflow),out=join(f.parent,'material-proposal');
  pipeline.buildMaterialPaintProposal(f.workflow,f.materialOptions,out);pipeline.verifyMaterialPaintProposal(f.workflow,f.materialOptions,out);
  assert.deepEqual(flow.inspectWorkflow(f.workflow),before);assert.deepEqual(flow.previewPaintSourcePlan(f.workflow,f.options),old);
  const p=flow.freezeMaterialPaintPlan(f.workflow,f.materialOptions);assert.equal(p.format,'ai_scene_generation_plan_v26');
  assert.deepEqual(p.request.images.map(i=>i.artifact.sha256),[hash(f.guide),hash(f.materialGuide),hash(f.raw)]);
  assert.equal(p.request.maximumCalls,1);assert.equal(p.request.output.alpha,'opaque');assert(p.request.prompt.includes('输入3'));
  assert.deepEqual(readFileSync(join(out,'reference-native.png')),f.raw);assert(!existsSync(join(out,'context-native.png')));
  rejects(()=>flow.reservePlan(f.workflow,p.sha256),'AUTHORIZATION_REQUIRED');
});
test('material design needs its own exact human decision, separate from base geometry/source design',t=>{
  const f=setup(t,{accept:false});rejects(()=>flow.freezeMaterialPaintPlan(f.workflow,f.materialOptions),'MATERIAL_DESIGN_REVIEW_REQUIRED');
  rejects(()=>flow.reviewMaterialPaintControls(f.workflow,f.m.sha256,decision('material.wrong',f.materialPacket.sha256)),'MATERIAL_CONTROL_REVIEW_STATE');
});
test('guide pixels must replay reviewed labels and paint halo, and labels must preserve accepted Alpha support',t=>{
  const f=setup(t),before=flow.inspectWorkflow(f.workflow);
  for(const mode of ['guide','labels']) {
    const artifacts=new Map(f.materialArtifacts),packet=unseal(f.materialPacket);
    if(mode==='guide') artifacts.set('material-zone-guide.png',generated({width:128,height:100}));
    else {const labels=Buffer.from(f.labels);labels[0]=2;artifacts.set('material-core-labels.bin',labels);}
    packet.artifacts=packet.artifacts.map(a=>({...a,sha256:hash(artifacts.get(a.path)),byteLength:artifacts.get(a.path).length}));
    if(mode==='guide') {
      const p=unseal(f.materialProposal);p.inputRoles[1].sha256=hash(artifacts.get('material-zone-guide.png'));
      const v=seal(p);packet.proposalSha256=v.sha256;artifacts.set('next-step-proposal.json',jsonBytes(v));
      packet.artifacts=packet.artifacts.map(a=>({...a,sha256:hash(artifacts.get(a.path)),byteLength:artifacts.get(a.path).length}));
    }
    rejects(()=>flow.importMaterialPaintControls(f.workflow,{...f.materialImportOptions,controlId:'material.tampered',reviewPacket:seal(packet)},artifacts),
      mode==='guide'?'MATERIAL_GUIDE_REPLAY':'MATERIAL_LABELS');
  }
  assert.deepEqual(flow.inspectWorkflow(f.workflow),before);
});
test('opaque pixels and all sampled RGBA cannot bypass pre-Alpha material coverage review',async t=>{
  const f=setup(t),{p}=await receive(f),raw=flow.getGenerationResult(f.workflow,p.sha256).result.rawSha256;
  rejects(()=>flow.reviewResult(f.workflow,p.sha256,decision('material.art.early',raw)),'MATERIAL_COVERAGE_REVIEW_REQUIRED');
  rejects(()=>flow.getPaintApplicationProposal(f.workflow,p.sha256),'MATERIAL_COVERAGE_REVIEW_REQUIRED');
  const coverage=flow.getMaterialCoverageProposal(f.workflow,p.sha256),out=join(f.parent,'coverage-review');
  assert(coverage.probes.every(v=>v.rgba[3]===255));flow.buildPaintSourceReview(f.workflow,p.sha256,out);flow.verifyPaintSourceReview(f.workflow,p.sha256,out);
  const template=JSON.parse(readFileSync(join(out,'coverage-observation-template.json')));assert(template.probes.every(v=>v.verdict==='uncertain'));
  rejects(()=>flow.reviewMaterialCoverage(f.workflow,p.sha256,template,decision('material.uncertain',coverage.sha256)),'MATERIAL_COVERAGE_NOT_PASSED');
  const missing=observation(coverage);missing.probes.pop();
  rejects(()=>flow.reviewMaterialCoverage(f.workflow,p.sha256,missing,decision('material.incomplete',coverage.sha256)),'MATERIAL_COVERAGE_INCOMPLETE');
  const partial=observation(coverage);partial.regions[3].verdict='fail';
  rejects(()=>flow.reviewMaterialCoverage(f.workflow,p.sha256,partial,decision('material.boundary.failed',coverage.sha256)),'MATERIAL_COVERAGE_NOT_PASSED');
  const failed=observation(coverage);failed.probes[2].verdict='fail';
  flow.reviewMaterialCoverage(f.workflow,p.sha256,failed,decision('material.coverage.reject',coverage.sha256,'reject'));
  rejects(()=>flow.reviewResult(f.workflow,p.sha256,decision('material.art.blocked',raw)),'MATERIAL_COVERAGE_REVIEW_REQUIRED');
  flow.reviewResult(f.workflow,p.sha256,decision('material.art.reject',raw,'reject'));
  assert.equal(pipeline.inspectPaintSource(f.workflow,p.sha256).status,'rejected-visual');
});
test('coverage, source appearance and exact Alpha application are three independent decisions',async t=>{
  const f=setup(t),{p}=await receive(f),coverage=flow.getMaterialCoverageProposal(f.workflow,p.sha256),o=observation(coverage);
  const c=flow.reviewMaterialCoverage(f.workflow,p.sha256,o,decision('material.coverage.accept',coverage.sha256));
  rejects(()=>flow.getPaintApplicationProposal(f.workflow,p.sha256),'PAINT_SOURCE_ART_REVIEW_REQUIRED');
  rejects(()=>flow.reviewMaterialCoverage(f.workflow,p.sha256,o,decision('material.coverage.twice',coverage.sha256)),'MATERIAL_COVERAGE_REVIEW_STATE');
  flow.reviewResult(f.workflow,p.sha256,decision('material.art.accept',coverage.rawSha256));
  const proposal=flow.getPaintApplicationProposal(f.workflow,p.sha256),out=join(f.parent,'derived');
  assert.equal(proposal.format,'ai_scene_paint_application_proposal_v2');assert.equal(proposal.materialCoverageReviewSha256,c.sha256);
  rejects(()=>flow.buildPaintLayer(f.workflow,p.sha256,out),'PAINT_APPLICATION_REVIEW_REQUIRED');
  flow.reviewPaintApplication(f.workflow,p.sha256,decision('material.apply',proposal.sha256));
  flow.buildPaintLayer(f.workflow,p.sha256,out);flow.verifyPaintLayer(f.workflow,p.sha256,out);
  assert.deepEqual(readFileSync(join(out,'geometry-alpha.png')),f.alpha);assert.deepEqual(readFileSync(join(out,'source-native.png')),generated());
  const report=JSON.parse(readFileSync(join(out,'report.json')));assert.equal(report.artAcceptance,'not-assessed');assert.equal(report.originalReferenceAppearancePixelsUsed,0);
});
test('an unknown material-source submission is terminal and any revision needs fresh authorization',async t=>{
  const f=setup(t),{p,adapter,calls}=await receive(f,{unknown:true});assert.equal(calls,1);
  assert.equal(pipeline.inspectPaintSource(f.workflow,p.sha256).status,'indeterminate');await assert.rejects(pipeline.runPaintSource(f.workflow,p.sha256,adapter));
  const next=flow.reviseGenerationPlan(f.workflow,p.sha256,{planId:'material.revision',capabilitiesSha256:f.cap.sha256,intent:''});
  assert.equal(next.format,'ai_scene_generation_plan_v26');assert.equal(next.request.prompt,p.request.prompt);
  rejects(()=>flow.reservePlan(f.workflow,next.sha256),'AUTHORIZATION_REQUIRED');
});
test('material planning CLI produces a verified offline review and grants no implicit compute',t=>{
  const f=setup(t),config=join(f.parent,'material-options.json'),out=join(f.parent,'material-cli-review');
  writeFileSync(config,jsonBytes(f.materialOptions));
  const cli=spawnSync(process.execPath,['scripts/paint-source.mjs','material-plan','--workflow',f.workflow,'--options',config,'--out',out],
    {cwd:fileURLToPath(new URL('..',import.meta.url)),encoding:'utf8'});
  assert.equal(cli.status,0,cli.stderr);const p=JSON.parse(cli.stdout);assert.equal(p.format,'ai_scene_generation_plan_v26');
  assert.equal(p.request.images.length,3);pipeline.verifyMaterialPaintProposal(f.workflow,f.materialOptions,out);
  assert.equal(pipeline.inspectPaintSource(f.workflow,p.sha256).status,'planned');
  rejects(()=>flow.reservePlan(f.workflow,p.sha256),'AUTHORIZATION_REQUIRED');
});
