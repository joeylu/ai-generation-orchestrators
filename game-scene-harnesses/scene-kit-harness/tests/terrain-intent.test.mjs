import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,existsSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import * as flow from '../src/generation/index.mjs';
import * as pipeline from '../src/coherent-pipeline.mjs';
import {TERRAIN_INTENT_POLICY,validateTerrainIntent,assertTerrainIntentRendering,assertTerrainIntentScopes} from '../src/terrain-intent.mjs';
import {coherentBrief,coherentAnalysis,coherentSurfaceObservations,sourcePng,referencePng,setupCoherent} from './helpers/coherent.mjs';
import {decision} from './helpers/generation.mjs';
import {digest,hash,seal,unseal,jsonBytes} from '../src/generation/common.mjs';
import {loadSceneKit,readMap,contextFor} from '../src/kit.mjs';
import {compileMap} from '../src/compile.mjs';
import {createEditor} from '../src/editor.mjs';
import {studioKitSnapshot} from '../src/studio/kit-snapshot.mjs';
import {inspectPng} from '../src/png.mjs';

const intent=contour=>({profile:'reference-terrain-intent-v1',contour,notes:contour==='irregular-natural'?'Observed broken stone bank; preserve broad flats and the open channel.':'Observed manufactured straight ledge; panel seams do not bend the silhouette.'});
const rendering=i=>({profile:'intent-bound-shared-terrain-v1',terrainIntentSha256:digest(i),outline:{maximumInsetWorld:i.contour==='irregular-natural'?6:0,sampleStepWorld:8,wavelengthWorld:64,seed:731},capEndRow:16,fadeRows:0});
const scope=i=>({subjectId:'ground',content:'Continuous checked surface and body material.',exclusions:['Complete scenery and independently editable objects'],parentRole:'main',terrainIntent:i});
const rejects=(f,code)=>assert.throws(f,e=>e.errors?.some(v=>v.code===code));
const temporary=t=>{const p=mkdtempSync(join(tmpdir(),'terrain-intent-'));t.after(()=>rmSync(p,{recursive:true,force:true}));return p;};

test('intent and rendering require explicit compatible contour judgments, without a material-name heuristic',()=>{
  for(const contour of ['rigid-manufactured','irregular-natural','authored']){const i=intent(contour);assert.deepEqual(validateTerrainIntent(i),i);assertTerrainIntentRendering(i,rendering(i));}
  const i=intent('rigid-manufactured'),r=rendering(i);
  rejects(()=>assertTerrainIntentRendering(i,undefined),'TERRAIN_RENDERING_REQUIRED');
  rejects(()=>assertTerrainIntentRendering(undefined,r),'TERRAIN_INTENT_REQUIRED');
  rejects(()=>assertTerrainIntentRendering(i,{...r,terrainIntentSha256:'f'.repeat(64)}),'TERRAIN_RENDERING_INTENT_BINDING');
  rejects(()=>assertTerrainIntentRendering(i,{...r,outline:{...r.outline,maximumInsetWorld:2}}),'TERRAIN_RENDERING_CONTOUR');
  rejects(()=>assertTerrainIntentRendering(intent('irregular-natural'),{...rendering(intent('irregular-natural')),outline:r.outline}),'TERRAIN_RENDERING_CONTOUR');
  for(const invalid of [{...i,contour:'guess-from-metal'}, {...i,notes:''},{...i,autoRepair:true}])assert.throws(()=>validateTerrainIntent(invalid));
  const brief=coherentBrief(),old=flow.createLayerSourceScopes(brief.requirements);
  rejects(()=>assertTerrainIntentScopes(old),'TERRAIN_INTENT_REQUIRED');
  assert.throws(()=>flow.createLayerSourceScopes(brief.requirements,[{...scope(i),subjectId:'foreground',parentRole:'foreground'}]));
  const scopes=flow.createLayerSourceScopes(brief.requirements,[scope(i)]);
  rejects(()=>assertTerrainIntentScopes({subjects:[...scopes.subjects,{...scopes.subjects.find(s=>s.role==='ground'),terrainIntent:intent('authored')}]}),'TERRAIN_INTENT_MATERIAL_AMBIGUOUS');
  assert.equal(Object.hasOwn(flow.createLayerSourceScopes(brief.requirements).subjects.find(s=>s.role==='ground'),'terrainIntent'),false);
  assert.deepEqual(flow.createLayerSourceScopes(brief.requirements),old);
});

test('new CLI init refuses an omitted terrain decision before creating a project; strict API freezes the same policy',t=>{
  const parent=temporary(t),brief=coherentBrief(),path=join(parent,'brief.json');writeFileSync(path,jsonBytes(brief));
  const result=spawnSync(process.execPath,['scripts/coherent.mjs','init','--brief',path,'--out',join(parent,'cli')],{cwd:fileURLToPath(new URL('..',import.meta.url)),encoding:'utf8'});
  assert.equal(result.status,1);assert.equal(JSON.parse(result.stderr).code,'TERRAIN_INTENT_REQUIRED');assert.equal(existsSync(join(parent,'cli')),false);
  brief.sourceScopes=[scope(intent('rigid-manufactured'))];
  const status=pipeline.initCoherentPipeline(join(parent,'strict'),brief,{purpose:'synthetic-simulation',terrainIntentPolicy:TERRAIN_INTENT_POLICY});
  assert.equal(status.terrainIntentPolicy,TERRAIN_INTENT_POLICY);assert.deepEqual(status.sourcePlanning.subjects.find(s=>s.role==='ground').terrainIntent,brief.sourceScopes[0].terrainIntent);
});

test('source freeze binds terrain intent to material request only and revision cannot discard it',t=>{
  const f=setupCoherent(t),i=intent('rigid-manufactured'),old=flow.previewCoherentSources(f.workflow,f.options),scopes=flow.createLayerSourceScopes(f.brief.requirements,[scope(i)]);
  const batch=flow.freezeCoherentSources(f.workflow,{...f.options,sourceScopes:scopes}),plans=batch.planSha256s.map(sha=>flow.getGenerationPlan(f.workflow,sha)),material=plans.find(p=>p.instanceBinding.role==='material');
  assert.deepEqual(material.recipe.sourceScope.terrainIntent,i);assert.equal(material.sourceScope.terrainIntentSha256,digest(i));assert.match(material.request.prompt,/TERRAIN CONTOUR INTENT: rigid-manufactured/);
  assert(plans.filter(p=>p!==material).every(p=>!p.request.prompt.includes('TERRAIN CONTOUR INTENT')));
  const {terrainIntent:removed,...base}=unseal(material.recipe.sourceScope),replacement={assetId:material.recipe.assetId,planId:'material.revision',intent:'isolated-layer-v4',sourceScope:seal(base)};
  rejects(()=>flow.reviseCoherentSources(f.workflow,batch.sha256,{batchId:'revision',replacements:[replacement]}),'TERRAIN_INTENT_REVISION_REQUIRED');
  assert.deepEqual(flow.previewCoherentSources(f.workflow,{...f.options,batchId:f.options.batchId+'.old'}).plans.map(p=>p.request),old.plans.map(p=>p.request));
});

for(const contour of ['rigid-manufactured','irregular-natural'])test(`${contour}: complete offline production keeps the decision through delivery, new brush strokes and previews`,{timeout:240000},async t=>{
  const parent=temporary(t),root=join(parent,'project'),i=intent(contour),r=rendering(i),brief=coherentBrief(contour==='rigid-manufactured'?'Industrial loading shelf':'Natural stepped canyon');brief.sourceScopes=[scope(i)];
  pipeline.initCoherentPipeline(root,brief,{purpose:'synthetic-simulation',terrainIntentPolicy:TERRAIN_INTENT_POLICY});
  const calls=[],approvals=[];
  const pending=await pipeline.driveCoherentPipeline(root,{
    imageAdapter:{preflight:async()=>{},generate:async input=>{calls.push(input);return input.request.task==='reference'?referencePng():sourcePng(input.request.output.alpha==='transparent',17);}},
    planner:{analyze:async({request})=>{
      const base=coherentAnalysis({sha256:request.planSha256},request.rawSha256,request.requirements);
      return contour==='rigid-manufactured'?base:seal({...unseal(base),surfaces:base.surfaces.map(s=>s.surfaceId==='ground.surface'?{...s,points:[{x:0,y:95},{x:35,y:110},{x:70,y:95}]}:s)});
    }},
    operator:{reviewDesign:async s=>({spec:decision('spec',s.design.specSha256),style:decision('style',s.design.styleSha256)}),
      approveCompute:async s=>{approvals.push(s);return decision('compute.'+approvals.length,s.targetSha256,'approve-compute');},reviewReference:async s=>decision('ref',s.packet.packetSha256)}});
  assert.equal(pending.stage,'awaiting-surface-mapping');const workflow=join(root,'workflow'),before=flow.inspectWorkflow(workflow),observations=coherentSurfaceObservations();
  rejects(()=>pipeline.prepareCoherentSurfaceReview(root,observations,join(parent,'missing')),'TERRAIN_RENDERING_REQUIRED');assert.equal(existsSync(join(parent,'missing')),false);
  rejects(()=>pipeline.prepareCoherentSurfaceReview(root,observations,join(parent,'wrong'),{terrainRendering:{...r,terrainIntentSha256:'f'.repeat(64)}}),'TERRAIN_RENDERING_INTENT_BINDING');
  rejects(()=>pipeline.prepareCoherentSurfaceReview(root,observations,join(parent,'too-deep'),{terrainRendering:{...r,capEndRow:4096}}),'TERRAIN_RENDERING_SURFACE');
  const reviewDir=join(parent,'review');pipeline.prepareCoherentSurfaceReview(root,observations,reviewDir,{terrainRendering:r});
  const composition=JSON.parse(readFileSync(join(reviewDir,'composition-profile.json')));assert.deepEqual(composition.terrainRendering,r);
  const out=join(parent,'delivery');pipeline.deliverCoherentPipeline(root,out,{composition});assert.equal(pipeline.verifyCoherentDelivery(root,out).status,'verified');
  const kit=loadSceneKit(join(out,'candidate/kit')),ctx=contextFor(kit),doc=readMap(kit),original=structuredClone(doc),profile=ctx.kit.terrainSharedField;
  assert.equal(profile.outline.maximumInsetWorld,r.outline.maximumInsetWorld);assert.equal(profile.profile,'world-material-grid-curve-boundary-v2');
  assert.equal(JSON.parse(readFileSync(join(out,'candidate/evidence/terrain-intent.json'))).legacyTileFallback,false);
  assert.equal(ctx.kit.terrainAppearance.sourceSha256,hash(sourcePng(false,17)));
  const editingDoc={...doc,assemblyInstances:[]},editor=createEditor(kit,editingDoc),beforePaint=editor.getDocument();editor.execute([{type:'paint-cells',familyId:ctx.rules.familyId,cells:[{x:1,y:0},{x:2,y:0},{x:3,y:0}]}]);
  const painted=editor.getScene();assert(painted.gridTerrains.length>0);assert.equal(painted.terrainSharedField.profileSha256,profile.sha256);
  editor.undo();assert.deepEqual(editor.getDocument(),beforePaint);editor.redo();assert.equal(editor.getScene().contentSha256,painted.contentSha256);
  const snapshot=studioKitSnapshot(kit),brush=snapshot.metadata.brushes[0];assert.equal(brush.previewExamples.length,4);assert.equal(brush.previewUrl,brush.previewExamples[0].url);
  const png=inspectPng(snapshot.assets.get(brush.previewUrl),{includePixels:true}),top=[];
  for(let x=80;x<304;x++){let found=-1;for(let y=60;y<82;y++){const n=(y*png.width+x)*4;if(png.rgba[n]!==29||png.rgba[n+1]!==43||png.rgba[n+2]!==59){found=y;break;}}top.push(found);}
  if(contour==='rigid-manufactured')assert.deepEqual([...new Set(top)],[64],'flat run must not inherit the old 0/1/2 pixel ripple');
  else assert(new Set(top).size>1&&top.every(y=>y>=64&&y<=70),'natural irregularity stays inside the explicit six-world-unit bound');
  assert.deepEqual(readMap(kit),original,'preview never edits the author document');assert.deepEqual(flow.inspectWorkflow(workflow),before,'deterministic review/delivery never submits images');assert.equal(calls.length,7);
  assert.equal(compileMap(kit,doc).terrainSharedField.profileSha256,profile.sha256);
});
