import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,existsSync,readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import * as pipeline from '../src/coherent-pipeline.mjs';
import * as flow from '../src/generation/index.mjs';
import {validateTerrainIntent,assertTerrainIntentRendering} from '../src/terrain-intent.mjs';
import {COMPLETE_TERRAIN_ROLES,TERRAIN_COMPLETION_POLICY,NATIVE_TERRAIN_RENDERING,TERRAIN_REFERENCE_DEFINED_MANUFACTURED_PROFILE,TERRAIN_EDGE_GUTTER_WARNING_PROFILE,assertTerrainPerimeterInputs} from '../src/terrain-perimeter-contract.mjs';
import {coherentBrief,coherentAnalysis,sourcePng,referencePng,coherentSurfaceObservations} from './helpers/coherent.mjs';
import {nativeFixtures,receiveEdgeFixture} from './helpers/terrain-edge-delivery.mjs';
import {bottomFixture} from './helpers/terrain-bottom-delivery.mjs';
import {decision} from './helpers/generation.mjs';
import {digest,hash,unseal,seal,jsonBytes} from '../src/generation/common.mjs';
import {deriveMeasuredFieldDensity2} from '../src/terrain-proof/measured-field-density.mjs';
import {loadSceneKit,contextFor,readMap} from '../src/kit.mjs';
import {compileMap} from '../src/compile.mjs';
import {createEditor} from '../src/editor.mjs';
import {EXPOSED_SIDE_TERMINATION_PROFILE} from '../src/terrain-edges.mjs';
import {encodeRgbaPng,inspectPng} from '../src/png.mjs';
import {runTerrainEdgeExchange} from '../src/terrain-edge-exchange.mjs';

const rejects=(fn,code)=>assert.throws(fn,e=>e.errors?.some(v=>v.code===code));
const cli=fileURLToPath(new URL('../scripts/coherent.mjs',import.meta.url));
function coherentCommand(command,root,delivery,...args){
  const result=spawnSync(process.execPath,[cli,command,'--root',root,'--delivery',delivery,...args],{encoding:'utf8',timeout:300000,windowsHide:true});
  assert.ifError(result.error);
  assert.equal(result.status,0,result.stderr||result.stdout);
  return JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1));
}
const appearance=family=>({format:'ai_scene_source_appearance_v1',profile:'source-owned-appearance-v1',rules:[family==='natural'?'Pale bare sandstone; no vegetation cover.':'Porcelain panels with a narrow teal trim and original left light.']});
const intent=family=>({profile:'reference-terrain-intent-v2',contour:family==='natural'?'irregular-natural':'rigid-manufactured',notes:'Synthetic explicit perimeter judgment.',usage:'complete-brush',perimeter:{surfaceFamily:family,items:COMPLETE_TERRAIN_ROLES.map(role=>({role,content:family==='natural'?`One bare sandstone ${role}; only the reference-owned mineral cover.`:`One porcelain panel ${role} with a bounded local bevel.`,exclusions:['Independent objects','Complete platforms'],sourceAppearance:appearance(family)}))}});
const scope=i=>({subjectId:'ground',parentRole:'main',content:'Continuous source material for the planned complete brush.',exclusions:['Complete platforms'],terrainIntent:i});
const rendering=i=>({profile:NATIVE_TERRAIN_RENDERING,terrainIntentSha256:digest(i)});
test('seven explicit roles are mandatory for full brushes; limited studies remain explicit and historical intents unchanged',()=>{
  assert.deepEqual(COMPLETE_TERRAIN_ROLES,flow.TERRAIN_PERIMETER_ROLES);
  for(const family of ['natural','engineered-city']){const i=intent(family);validateTerrainIntent(i);assertTerrainIntentRendering(i,rendering(i));
    rejects(()=>validateTerrainIntent({...i,perimeter:{...i.perimeter,items:i.perimeter.items.slice(0,4)}}),'TERRAIN_PERIMETER_COVERAGE');
    rejects(()=>validateTerrainIntent({...i,perimeter:{...i.perimeter,items:[...i.perimeter.items.slice(0,6),i.perimeter.items[0]]}}),'TERRAIN_PERIMETER_COVERAGE');
    rejects(()=>assertTerrainIntentRendering(i,{profile:'intent-bound-shared-terrain-v1',terrainIntentSha256:digest(i),outline:{maximumInsetWorld:0,sampleStepWorld:8,wavelengthWorld:64,seed:1},capEndRow:16,fadeRows:0}),'TERRAIN_PERIMETER_RENDERING_REQUIRED');
  }
  validateTerrainIntent({profile:'reference-terrain-intent-v2',contour:'authored',notes:'Limited material study only.',usage:'material-study'});
  validateTerrainIntent({profile:'reference-terrain-intent-v1',contour:'authored',notes:'Historical contract.'});
});

for(const family of ['engineered-city','natural'])test(`${family}: main pipeline rejects incomplete delivery and verifies seven native roles against declared responsibilities`,{timeout:900000},async t=>{
  const evidenceRoot=process.env.SCENE_KIT_TEST_EVIDENCE,parent=mkdtempSync(join(evidenceRoot??tmpdir(),'terrain-completion-'));if(!evidenceRoot)t.after(()=>rmSync(parent,{recursive:true,force:true}));
  const root=join(parent,'project'),workflow=join(root,'workflow'),i=intent(family),brief=coherentBrief(family==='natural'?'Bare mineral canyon':'Manufactured port');brief.sourceScopes=[scope(i)];
  const incomplete=structuredClone(brief);incomplete.sourceScopes[0].terrainIntent.perimeter.items.pop();
  rejects(()=>pipeline.initCoherentPipeline(join(parent,'bad'),incomplete,{purpose:'synthetic-simulation',terrainIntentPolicy:TERRAIN_COMPLETION_POLICY}),'TERRAIN_PERIMETER_COVERAGE');assert(!existsSync(join(parent,'bad')));
  pipeline.initCoherentPipeline(root,brief,{purpose:'synthetic-simulation',terrainIntentPolicy:TERRAIN_COMPLETION_POLICY});
  const obs=coherentSurfaceObservations();obs.rockFeaturePairs[0].source.toX=160;let calls=0;
  const pending=await pipeline.driveCoherentPipeline(root,{delivery:join(parent,'blocked'),
    imageAdapter:{preflight:async()=>{},generate:async input=>{calls++;return input.request.task==='reference'?referencePng():sourcePng(input.request.output.alpha==='transparent',17);}},
    planner:{analyze:async({request})=>{const a=coherentAnalysis({sha256:request.planSha256},request.rawSha256,request.requirements);return family==='natural'?seal({...unseal(a),surfaces:a.surfaces.map(s=>s.surfaceId==='ground.surface'?{...s,points:[{x:0,y:95},{x:35,y:105},{x:70,y:95}]}:s)}):a;}},
    operator:{reviewDesign:async s=>({spec:decision('spec',s.design.specSha256),style:decision('style',s.design.styleSha256)}),approveCompute:async s=>decision('compute.'+calls,s.targetSha256,'approve-compute'),reviewReference:async s=>decision('ref',s.packet.packetSha256),calibrateSurface:async()=>({observations:obs,options:{terrainRendering:rendering(i)}})}});
  assert.equal(pending.stage,'awaiting-terrain-perimeter');assert.equal(calls,7);assert(!existsSync(join(parent,'blocked')));assert(!existsSync(join(parent,'blocked.base')));
  const state=flow.inspectWorkflow(workflow),legacy=pipeline.previewCoherentTerrainSources(root,'perimeter.first');
  const profile=TERRAIN_REFERENCE_DEFINED_MANUFACTURED_PROFILE;
  const engineered=family==='engineered-city';
  const proposal=engineered?pipeline.previewCoherentTerrainSources(root,'perimeter.first',profile):legacy;
  assert.equal(proposal.plans.length,7);
  if(engineered){
    assert.notEqual(proposal.sha256,legacy.sha256);
    for(const [index,p] of proposal.plans.entries()){
      const old=legacy.plans[index];
      assert.match(old.request.prompt,/concrete and metal-panel/);
      assert.match(p.request.prompt,/porcelain panel/i);
      assert.match(p.request.prompt,/REFERENCE-DEFINED MANUFACTURED MATERIAL/);
      assert.doesNotMatch(p.request.prompt,/concrete|metal-panel/);
      assert.doesNotMatch(p.visualReviewChecklist.requiredChecks.join(' '),/concrete/);
      assert.equal(p.recipe.manufacturedMaterialProfile,profile);
      assert.equal(p.sourceScope.manufacturedMaterialProfile,profile);
      assert.deepEqual(p.request.images,old.request.images);
      assert.deepEqual(p.request.output,old.request.output);
    }
    rejects(()=>pipeline.freezeCoherentTerrainSources(root,'perimeter.first',proposal.sha256),'TERRAIN_PERIMETER_PROPOSAL_CHANGED');
    assert.deepEqual(pipeline.previewCoherentTerrainSources(root,'perimeter.first'),legacy);
  }else{
    rejects(()=>pipeline.previewCoherentTerrainSources(root,'perimeter.first',profile),'TERRAIN_EDGE_MANUFACTURED_MATERIAL_PROFILE');
  }
  for(const p of proposal.plans){assert.deepEqual(p.recipe.sourceAppearance,appearance(family));assert.equal(p.recipe.coverageProfile,'full-perimeter-v1');assert.equal(p.recipe.nativeSizeProfile,'bounded-native-4m-v1');
    assert.equal(p.recipe.gutterPolicy,TERRAIN_EDGE_GUTTER_WARNING_PROFILE);
    if(family==='natural')assert.equal(p.recipe.naturalSurfaceProfile,'reference-defined-cover-v1');else assert.equal(p.recipe.surfaceFamily,'engineered-city');}
  rejects(()=>pipeline.freezeCoherentTerrainSources(root,'perimeter.first','f'.repeat(64),engineered?profile:undefined),'TERRAIN_PERIMETER_PROPOSAL_CHANGED');
  assert.deepEqual(flow.inspectWorkflow(workflow),state);
  const batch=pipeline.freezeCoherentTerrainSources(root,'perimeter.first',proposal.sha256,engineered?profile:undefined);assert.equal(batch.fullPerimeterComplete,true);
  const review=join(parent,'surface');pipeline.prepareCoherentSurfaceReview(root,obs,review,{terrainRendering:rendering(i)});const composition=JSON.parse(readFileSync(join(review,'composition-profile.json')));
  const native=nativeFixtures(family==='natural'?'snow':'autumn',252),bottom=bottomFixture(),raws=new Map([...native.raws,...bottom.raws]);
  const weakRoles=['left-wall','bottom-edge'];
  for(const role of weakRoles){
    const png=inspectPng(raws.get(role),{includePixels:true,allowHiddenRgb:true});
    png.rgba[3]=1;
    raws.set(role,encodeRgbaPng(png.width,png.height,png.rgba));
  }
  flow.authorizeReferenceAssetBatch(workflow,batch.sha256,decision('perimeter.compute',batch.sha256,'approve-compute'));
  for(const p of proposal.plans){
    const role=p.recipe.edgeRole,raw=raws.get(role);
    if(weakRoles.includes(role)){
      const r=await runTerrainEdgeExchange(workflow,batch.sha256,join(parent,'warning-'+role),{
        async preflight(){},
        async generate(ticket){assert.equal(ticket.planSha256,p.sha256);return raw;},
      },{autoWeakGutter:true});
      assert.equal(r.technicalStatus,'pass');assert.deepEqual(r.warnings,['TERRAIN_EDGE_ALPHA_ONE_GUTTER']);
      assert.equal(r.rawSha256,hash(raw));assert(!Object.hasOwn(r,'automaticGutter'));
    }else{
      const r=receiveEdgeFixture(workflow,p.sha256,raw);assert.equal(r.technical.status,'pass',JSON.stringify(r.technical.issues));
    }
  }
  const inputs=pipeline.coherentSurfaceInputs(root),density=deriveMeasuredFieldDensity2(inputs.material.raw,composition.surfaceMapping),controls={...native.controls,
    joinProfile:'native-near-opaque-underlap-v1',materialDensityProfile:'reference-native-2x-v1',gridProfile:'grid-solid-union-native-v1',junctions:{},materialProfile:'union-world-body-local-surface-v1',
    sideTerminationProfile:EXPOSED_SIDE_TERMINATION_PROFILE,surfaceInterface:{profile:'world-body-native-lip-v1',capSourceSha256:hash(density.files.get('materials/cap-field.png')),capEndRow:20,fadeRows:4},
    bottom:{...bottom.controls,nativeSizeProfile:'bounded-native-4m-v1',renderEnvelopeProfile:'visible-alpha8-outward16-native-rgba-v1'}};
  for(const side of ['left','right'])for(const part of ['wall','corner'])controls[side][part].inboardBlend={fromX:controls[side][part].innerX,toX:side==='left'?264:24};
  const checked=flow.getTerrainEdgeInputs(workflow,batch.sha256);
  for(const item of checked.sources.filter(source=>weakRoles.includes(source.plan.recipe.edgeRole))){
    assert.deepEqual(item.raw,raws.get(item.plan.recipe.edgeRole));
    assert(!item.preparation);
  }
  rejects(()=>assertTerrainPerimeterInputs(i,inputs.batch.sha256,{...checked,sources:checked.sources.slice(0,4)},controls),'TERRAIN_PERIMETER_BATCH_BINDING');
  const wrong=structuredClone(i);wrong.perimeter.items[0].content='A foreign role brief';rejects(()=>assertTerrainPerimeterInputs(wrong,inputs.batch.sha256,checked,controls),'TERRAIN_PERIMETER_SOURCE_BINDING');
  const {bottom:omitted,...sidesOnly}=controls;rejects(()=>pipeline.deliverCoherentPipeline(root,join(parent,'sides-only'),{composition,terrain:{batchSha256:batch.sha256,controls:sidesOnly}}),'TERRAIN_PERIMETER_RENDERING_REQUIRED');assert(!existsSync(join(parent,'sides-only.base')));
  rejects(()=>pipeline.deliverCoherentPipeline(root,join(parent,'legacy-controls'),{composition,terrain:{batchSha256:batch.sha256,controls:{...controls,bottom:bottom.controls}}}),'TERRAIN_PERIMETER_RENDERING_REQUIRED');assert(!existsSync(join(parent,'legacy-controls.base')));
  const out=join(parent,'delivery'),before=flow.inspectWorkflow(workflow);
  const terrainPath=join(parent,'terrain.json');
  writeFileSync(terrainPath,jsonBytes({batchSha256:batch.sha256,controls}));
  const resumeArgs=family==='natural'
    ?['--surface-observations',join(review,'surface-observations.json'),'--terrain-rendering',join(parent,'terrain-rendering.json')]
    :['--composition',join(review,'composition-profile.json')];
  writeFileSync(join(parent,'terrain-rendering.json'),jsonBytes(rendering(i)));
  if(family==='natural'){
    assert.equal(coherentCommand('continue',root,out).stage,'awaiting-surface-mapping');
    assert.equal(coherentCommand('continue',root,out,...resumeArgs).stage,'awaiting-terrain-perimeter');
    assert.equal(existsSync(out),false);
  }
  const resumed=coherentCommand('continue',root,out,...resumeArgs,'--terrain',terrainPath);
  assert.equal(resumed.stage,'ready-to-deliver');
  const delivery=resumed.delivery;
  assert.equal(delivery.format,'ai_scene_terrain_edge_delivery_v1');
  const verified=coherentCommand('verify',root,out);
  assert.equal(verified.perimeterComplete,true);
  assert.equal(verified.zipSha256,delivery.zip.sha256);
  assert.deepEqual(coherentCommand('continue',root,out).delivery,verified);
  assert.deepEqual(flow.inspectWorkflow(workflow),before);
  // Deliberately incomplete synthetic report: replay must reject a full brush
  // downgraded to the old material-only format before reading its artifacts.
  const downgraded=join(parent,'material-only-replay');mkdirSync(downgraded);
  writeFileSync(join(downgraded,'delivery.json'),jsonBytes(seal({format:'ai_scene_coherent_delivery_v1',projectId:'coherent.fixture',sourceBatchSha256:inputs.batch.sha256})));
  rejects(()=>pipeline.verifyCoherentDelivery(root,downgraded),'TERRAIN_PERIMETER_DELIVERY_REQUIRED');
  const h=loadSceneKit(join(out,'candidate/kit')),ctx=contextFor(h),doc=readMap(h);assert(ctx.kit.terrainEdges);assert(ctx.kit.terrainBottomEdges);assert.equal(ctx.kit.terrainSharedField,undefined);
  assert.equal(compileMap(h,doc).terrainMaterial.edges.materialProfile,'union-world-body-local-surface-v1');
  const editor=createEditor(h,{...doc,assemblyInstances:[]}),old=editor.getScene();editor.execute([{type:'paint-cells',familyId:ctx.rules.familyId,cells:[{x:1,y:0},{x:2,y:0},{x:3,y:0}]}]);const painted=editor.getScene();assert(painted.terrainBottomEdgePlacement);assert(painted.terrainEdgePlacement);editor.undo();assert.equal(editor.getScene().contentSha256,old.contentSha256);
  assert.equal(delivery.finalHumanArtReview,'pending');assert.equal(calls,7);
});
