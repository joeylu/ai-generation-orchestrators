import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import * as flow from '../src/generation/index.mjs';
import * as pipeline from '../src/coherent-pipeline.mjs';
import {backgroundBandCoverage,validateBackgroundBand} from '../src/generation/background-band.mjs';
import {createLayerSourceScopes,withBackgroundBandScopes,withSourceVisualGuideScopes,withScopeOwnedGroundingScopes} from '../src/generation/layer-source.mjs';
import {createMeasuredCoherentComposition} from '../src/coherent-composition.mjs';
import {createBackgroundBandPlacement,validateBackgroundBandPlacement} from '../src/background-band-placement.mjs';
import {compileMeasuredSurfaceMapping} from '../src/terrain-proof/measured-field.mjs';
import {loadSceneKit,contextFor,readMap} from '../src/kit.mjs';
import {exportScene,openSceneExport} from '../src/persistence.mjs';
import {compileMap} from '../src/compile.mjs';
import {buildTerrainEdgeDelivery,verifyTerrainEdgeDelivery} from '../src/terrain-edge-pipeline.mjs';
import {nativeFixtures,receiveEdgeFixture} from './helpers/terrain-edge-delivery.mjs';
import {bottomFixture,bottomSideControls} from './helpers/terrain-bottom-delivery.mjs';
import {assessCoherentSource} from '../src/generation/coherent-source.mjs';
import {createVisualCoherence} from '../src/generation/visual-coherence.mjs';
import {encodeRgbaPng,inspectPng} from '../src/png.mjs';
import {seal,unseal,digest,hash} from '../src/generation/common.mjs';
import {setupCoherent,coherentBrief,coherentAnalysis,referencePng,sourcePng,coherentSurfaceObservations} from './helpers/coherent.mjs';
import {decision} from './helpers/generation.mjs';
const reject=(f,code)=>assert.throws(f,e=>e.errors?.some(i=>i.code===code));
const band=()=>({format:'ai_scene_background_band_v1',profile:'background-band-v1',
  camera:{referenceCenterWorld:{x:128,y:72},centerDomainWorld:{minX:96,maxX:160,minY:56,maxY:88},viewportWorld:{width:256,height:144},modes:['editor-unparallax','play-parallax']},
  parallax:{x:.3,y:1},coverageFrameWorld:{x:-48,y:8,width:352,height:176},canvasAspect:{numerator:2,denominator:1},
  edges:{top:{purpose:'transparent-silhouette'},left:{purpose:'camera-overdraw'},right:{purpose:'camera-overdraw'},bottom:{purpose:'camera-overdraw'}}});
const requirements=brief=>seal({...unseal(brief.requirements),subjects:[...brief.requirements.subjects,
  {subjectId:'ridges',role:'backdrop',layerId:'landmark',content:'Distant bare snow peaks only, excluding the separately planned forest valley.',count:{min:1,max:1},placementHint:'wide'},
  {subjectId:'valley',role:'valley',layerId:'landmark',content:'Rear forest valley and its own snow rock walls, excluding the separately planned distant snow peaks.',count:{min:1,max:1},placementHint:'wide'}]});
function bandPng(seed=0){const width=512,height=256,rgba=Buffer.alloc(width*height*4);
  for(let y=2;y<254;y++)for(let x=2;x<510;x++)if(y>=20+Math.floor(x/30)%10)rgba.set([40+(x+seed)%130,75+(y+seed)%90,110+seed,255],(y*width+x)*4);
  rgba.set([19,23,29,0],0);rgba.set([30,40,50,1],(10*width+1)*4);return encodeRgbaPng(width,height,rgba);}
function receive(root,plan,bytes){const {request,...ticket}=flow.reservePlan(root,plan.sha256);flow.recordSubmission(root,ticket);flow.receiveResult(root,ticket,bytes);}
const withBands=a=>seal({...unseal(a),instances:[...a.instances,...['ridges','valley'].map((subjectId,i)=>({instanceId:subjectId+'.actual',subjectId,layerId:'landmark',
  visibleEnvelope:[{x:20+i*60,y:10},{x:90+i*60,y:10},{x:90+i*60,y:60},{x:20+i*60,y:60}],anchor:{x:55+i*60,y:35},visibility:'visible',anchorEvidence:'observed',notes:'Synthetic coarse envelope.'}))]});

test('background band bounds use the union of explicitly selected camera modes, not only Play or a centered travel width',()=>{
  for(const p of [0,.12,1,1.5]){
    const b=band();b.camera={referenceCenterWorld:{x:512,y:288},centerDomainWorld:{minX:256,maxX:768,minY:160,maxY:416},viewportWorld:{width:1024,height:576},modes:['editor-unparallax','play-parallax']};
    b.parallax.x=p;b.coverageFrameWorld={x:-500,y:64,width:2024,height:704};
    const c=backgroundBandCoverage(b);assert.equal(c.union.left,p<=1?-256:512-256*p-512);assert.equal(c.union.right,p<=1?1280:512+256*p+512);
    assert.equal(c.union.top,-128);assert.equal(c.union.bottom,704);
  }
  const b=band();b.coverageFrameWorld={x:-15,y:8,width:286,height:176};reject(()=>validateBackgroundBand(b,{role:'backdrop'}),'BACKGROUND_BAND_FRAME_COVERAGE');
  b.camera.modes=['play-parallax'];validateBackgroundBand(b,{role:'backdrop'});
  b.edges.left.purpose='occlusion-overlap';assert.throws(()=>validateBackgroundBand(b,{role:'backdrop'}));
  const shifted=band();shifted.camera.referenceCenterWorld.x++;reject(()=>validateBackgroundBand(shifted,{role:'backdrop'}),'BACKGROUND_BAND_CAMERA_BINDING');
});

test('background planning never weakens the original v27 two-pixel alpha or real-transparency gates',()=>{
  const plan={sha256:'b'.repeat(64),referenceEvidence:[{rawSha256:'a'.repeat(64)}],instanceBinding:{role:'backdrop'},
    target:{alpha:'transparent',sourcePolicy:{minimumWidth:256,minimumHeight:256,maximumWidth:4096,maximumHeight:4096}}},
    raw=bandPng(),image=inspectPng(raw,{includePixels:true,allowHiddenRgb:true});
  assert.equal(assessCoherentSource(plan,raw).status,'pass');
  const clipped=Buffer.from(image.rgba);clipped[3]=2;
  assert(assessCoherentSource(plan,encodeRgbaPng(512,256,clipped)).issues.includes('COHERENT_CLIPPED_SILHOUETTE'));
  const solid=Buffer.from(image.rgba);for(let y=0;y<256;y++)for(let x=0;x<512;x++)solid[(y*512+x)*4+3]=x<2||x>=510||y<2||y>=254?1:255;
  assert(assessCoherentSource(plan,encodeRgbaPng(512,256,solid)).issues.includes('COHERENT_NO_TRANSPARENCY'));
});

test('first-project overrides and selected v5 helpers preserve unchanged rows and legacy plan bytes',t=>{
  const brief=coherentBrief();brief.requirements=requirements(brief);const base=createLayerSourceScopes(brief.requirements),before=structuredClone(base),
    overrides=[{subjectId:'ridges',content:brief.requirements.subjects.find(s=>s.subjectId==='ridges').content,exclusions:[],parentRole:'far',backgroundBand:band()}],
    first=createLayerSourceScopes(brief.requirements,overrides),selected=withBackgroundBandScopes(brief.requirements,base,[{subjectId:'ridges',backgroundBand:band()}]);
  assert.equal(first.format,'ai_scene_layer_source_scopes_v5');assert.equal(selected.format,'ai_scene_layer_source_scopes_v5');assert.deepEqual(base,before);
  for(const row of selected.subjects.filter(s=>s.subjectId!=='ridges'))assert.deepEqual(row,base.subjects.find(s=>s.subjectId===row.subjectId));
  const a=withScopeOwnedGroundingScopes(brief.requirements,withSourceVisualGuideScopes(brief.requirements,selected,['foreground']),['foreground']),
    b=withBackgroundBandScopes(brief.requirements,withSourceVisualGuideScopes(brief.requirements,withScopeOwnedGroundingScopes(brief.requirements,base,['foreground']),['foreground']),[{subjectId:'ridges',backgroundBand:band()}]);
  assert.deepEqual(a,b);
  reject(()=>withBackgroundBandScopes(brief.requirements,base,[{subjectId:'foreground',backgroundBand:band()}]),'BACKGROUND_BAND_ROLE');
  const bad=band();bad.parallax.x=.12;reject(()=>withBackgroundBandScopes(brief.requirements,base,[{subjectId:'ridges',backgroundBand:bad}]),'BACKGROUND_BAND_PARALLAX');
  const temp=mkdtempSync(join(tmpdir(),'background-band-init-'));t.after(()=>rmSync(temp,{recursive:true,force:true}));
  const root=join(temp,'project'),status=pipeline.initCoherentPipeline(root,{...brief,sourceScopes:overrides},{purpose:'synthetic-simulation'});
  assert.equal(status.stage,'awaiting-design-review');assert.equal(JSON.parse(readFileSync(join(root,'source-scopes.json'))).format,'ai_scene_layer_source_scopes_v5');
  assert.equal(flow.inspectWorkflow(join(root,'workflow')).plans.length,0);
  pipeline.reviewCoherentDesign(root,{spec:decision('band.init.spec',status.design.specSha256),style:decision('band.init.style',status.design.styleSha256)});
  const ready=pipeline.advanceCoherentPipeline(root),workflow=join(root,'workflow'),plan=flow.getGenerationPlan(workflow,ready.reference.planSha256),raw=referencePng();
  pipeline.authorizeCoherentStage(root,decision('band.init.reference',plan.sha256,'approve-compute'));receive(workflow,plan,raw);
  const analysis=withBands(coherentAnalysis(plan,hash(raw),brief.requirements)),packet=pipeline.prepareCoherentReferenceReview(root,analysis,join(temp,'reference-review'));
  const sources=pipeline.reviewCoherentReference(root,analysis,decision('band.init.accept',packet.packetSha256));assert.equal(sources.stage,'awaiting-source-compute');
  const beforeExport=flow.inspectWorkflow(workflow),reviewRoot=join(temp,'source-review');pipeline.exportCoherentComputeReview(root,reviewRoot);
  const review=JSON.parse(readFileSync(join(reviewRoot,'source-scope-review.json'))),reviewed=review.sources.find(s=>s.role==='backdrop');
  assert.equal(reviewed.scope.format,'ai_scene_layer_source_scope_v5');assert.equal(reviewed.backgroundBandCoverage.calibration,'required-before-derive');
  assert.equal(reviewed.coverageAcceptance,'uncalibrated-no-derived-coverage-claim');assert.deepEqual(flow.inspectWorkflow(workflow),beforeExport);
});

test('public first plans and received-source replacements need new exact authorization, preserve full PNGs and derive only through calibrated v5',{timeout:900000},t=>{
  const f=setupCoherent(t,'Snow band',undefined,{transformBrief:b=>({...b,requirements:requirements(b)}),transformAnalysis:withBands}),
    visual=createVisualCoherence(JSON.parse(readFileSync(join(f.root,'spec-draft.json'))),JSON.parse(readFileSync(join(f.root,'style-draft.json'))),f.target),
    scopes=createLayerSourceScopes(f.brief.requirements,[],visual),legacy=flow.previewCoherentSources(f.workflow,{...f.options,sourceScopes:scopes}),
    firstScopes=withBackgroundBandScopes(f.brief.requirements,scopes,['ridges','valley'].map(subjectId=>({subjectId,backgroundBand:band()}))),
    first=flow.previewCoherentSources(f.workflow,{...f.options,batchId:'band.first',sourceScopes:firstScopes});
  for(const plan of first.plans){const old=legacy.plans.find(p=>p.recipe.assetId===plan.recipe.assetId);
    if(['backdrop','valley'].includes(plan.instanceBinding.role)){
      assert.equal(plan.sourceScope.definition.format,'ai_scene_layer_source_scope_v5');assert.match(plan.compiler,/background-band-v1$/);
      assert.match(plan.request.prompt,/TWO native pixels/);assert.doesNotMatch(plan.request.prompt,/at least 12 percent|Center the one group|observed reference envelope|"minX"|"coverageFrameWorld"/);
      assert(!plan.request.prompt.includes(JSON.stringify(plan.instanceBinding.observedEnvelope)));assert.equal(plan.sourceScope.backgroundBandCoverage.calibration,'required-before-derive');
    }else assert.deepEqual(plan.recipe.sourceScope,old.recipe.sourceScope);
  }
  assert.deepEqual(flow.previewCoherentSources(f.workflow,{...f.options,sourceScopes:scopes}),legacy);
  const oldBatch=flow.freezeCoherentSources(f.workflow,{...f.options,sourceScopes:scopes});flow.authorizeReferenceAssetBatch(f.workflow,oldBatch.sha256,decision('old.batch.compute',oldBatch.sha256,'approve-compute'));
  for(const [i,sha]of oldBatch.planSha256s.entries()){const p=flow.getGenerationPlan(f.workflow,sha);receive(f.workflow,p,sourcePng(p.target.alpha==='transparent',i));}
  const parents=oldBatch.planSha256s.map(sha=>flow.getGenerationPlan(f.workflow,sha)).filter(p=>['backdrop','valley'].includes(p.instanceBinding.role)),
    oldBytes=parents.map(p=>flow.getGenerationResult(f.workflow,p.sha256).bytes),
    revised=flow.reviseCoherentSources(f.workflow,oldBatch.sha256,{batchId:'band.revision',replacements:parents.map((p,i)=>({assetId:p.recipe.assetId,planId:'band.replacement.'+i,intent:'isolated-layer-v4',sourceScope:flow.withBackgroundBand(p.recipe.sourceScope,band())}))});
  assert.equal(revised.newImageRequests,2);const changed=revised.planSha256s.filter(sha=>!oldBatch.planSha256s.includes(sha));assert.equal(changed.length,2);
  reject(()=>flow.reservePlan(f.workflow,changed[0]),'AUTHORIZATION_REQUIRED');
  flow.authorizeReferenceAssetBatch(f.workflow,revised.sha256,decision('new.band.compute',revised.sha256,'approve-compute'));
  for(const [i,sha]of changed.entries())receive(f.workflow,flow.getGenerationPlan(f.workflow,sha),bandPng(i));
  const plans=changed.map(sha=>flow.getGenerationPlan(f.workflow,sha)),raws=changed.map(sha=>flow.getGenerationResult(f.workflow,sha).bytes),
    placements=plans.map((plan,i)=>createBackgroundBandPlacement({plan,raw:raws[i],sourceToWorld:{numerator:1,denominator:1},positionWorld:{x:-64,y:0}})),
    materialPlan=revised.planSha256s.map(sha=>flow.getGenerationPlan(f.workflow,sha)).find(p=>p.instanceBinding.role==='material'),
    observations=coherentSurfaceObservations();observations.rockFeaturePairs[0].source.toX=160;
  const mapping=compileMeasuredSurfaceMapping({reference:{raw:f.raw},material:{raw:flow.getGenerationResult(f.workflow,materialPlan.sha256).bytes},target:f.target,observations}),
    composition=createMeasuredCoherentComposition(revised,f.target,mapping,{bandPlacements:placements,contacts:[]}),before=flow.inspectWorkflow(f.workflow);
  assert.equal(composition.format,'ai_scene_coherent_composition_v5');
  const output=join(f.parent,'band-candidate'),legacyComposition=createMeasuredCoherentComposition(revised,f.target,mapping,{contacts:[]});
  reject(()=>flow.buildCoherentCandidate(f.workflow,revised.sha256,'band.missing',join(f.parent,'missing'),legacyComposition),'COHERENT_BACKGROUND_BAND_CALIBRATION_REQUIRED');assert(!existsSync(join(f.parent,'missing')));
  const transformed={instanceId:placements[0].instanceId,x:1,y:1,scale:{numerator:1,denominator:1},tint:0xffffff,opacity:1};
  reject(()=>createMeasuredCoherentComposition(revised,f.target,mapping,{bandPlacements:placements,transforms:[transformed],contacts:[]}),'BACKGROUND_BAND_PLACEMENT_CONFLICT');
  const oldTransform=createMeasuredCoherentComposition(revised,f.target,mapping,{transforms:[transformed],contacts:[]});
  reject(()=>flow.buildCoherentCandidate(f.workflow,revised.sha256,'band.old.transform',join(f.parent,'old-transform'),oldTransform),'COHERENT_BACKGROUND_BAND_CALIBRATION_REQUIRED');
  const incomplete=createMeasuredCoherentComposition(revised,f.target,mapping,{bandPlacements:placements.slice(0,1),contacts:[]});
  reject(()=>flow.buildCoherentCandidate(f.workflow,revised.sha256,'band.incomplete',join(f.parent,'incomplete'),incomplete),'COHERENT_BACKGROUND_BAND_CALIBRATION_REQUIRED');
  reject(()=>createMeasuredCoherentComposition(revised,f.target,mapping,{bandPlacements:[...placements,placements[0]],contacts:[]}),'BACKGROUND_BAND_PLACEMENT_BINDING');
  assert.throws(()=>createMeasuredCoherentComposition(revised,f.target,mapping,{bandPlacements:placements,contacts:[{instanceId:placements[0].instanceId,surfaceId:'ground.surface',atX:10,sourceAnchor:'content-bottom-center'}]}));
  for(const field of ['sourcePlanSha256','sourceRawSha256','backgroundBandSha256'])reject(()=>validateBackgroundBandPlacement({...placements[0],[field]:'0'.repeat(64)},{plan:plans[0],raw:raws[0],target:f.target}),'BACKGROUND_BAND_PLACEMENT_BINDING');
  reject(()=>validateBackgroundBandPlacement({...placements[0],nativeFrame:{...placements[0].nativeFrame,width:511}},{plan:plans[0],raw:raws[0]}),'BACKGROUND_BAND_NATIVE_FRAME');
  for(const mutate of [target=>target.layers.find(l=>l.layerId==='landmark').parallaxX=.12,target=>target.mapping.viewport.width++]){
    const target=structuredClone(f.target);mutate(target);assert.throws(()=>validateBackgroundBandPlacement(placements[0],{plan:plans[0],raw:raws[0],target}));
  }
  const originalBand=inspectPng(raws[0],{includePixels:true,allowHiddenRgb:true}),badBorder=Buffer.from(originalBand.rgba);badBorder[3]=2;
  assert(assessCoherentSource(plans[0],encodeRgbaPng(512,256,badBorder)).issues.includes('COHERENT_CLIPPED_SILHOUETTE'));
  assert.equal(assessCoherentSource(plans[0],raws[0]).status,'pass');
  for(const boundary of ['left','right','bottom']){
    const rgba=Buffer.from(originalBand.rgba);for(let y=0;y<256;y++)for(let x=0;x<512;x++)
      if(boundary==='left'&&x<32||boundary==='right'&&x>=352||boundary==='bottom'&&y>=160)rgba.fill(0,(y*512+x)*4,(y*512+x)*4+4);
    reject(()=>createBackgroundBandPlacement({plan:plans[0],raw:encodeRgbaPng(512,256,rgba),sourceToWorld:{numerator:1,denominator:1},positionWorld:{x:-64,y:0}}),'BACKGROUND_BAND_TERMINATION_COVERAGE');
  }
  const dots=Buffer.alloc(512*256*4);for(const[x,y]of [[2,30],[509,30],[2,253],[509,253]])dots.set([40+x%20,70+y%20,120,255],(y*512+x)*4);
  const dottedRaw=encodeRgbaPng(512,256,dots),dotted=createBackgroundBandPlacement({plan:plans[0],raw:dottedRaw,sourceToWorld:{numerator:1,denominator:1},positionWorld:{x:-64,y:0}});
  assert.equal(validateBackgroundBandPlacement(dotted,{plan:plans[0],raw:dottedRaw}).contentContinuity,'not-assessed','a wide bbox is never evidence of complete painted continuity');
  const enlarged=createBackgroundBandPlacement({plan:plans[0],raw:raws[0],sourceToWorld:{numerator:2,denominator:1},positionWorld:{x:-64,y:0}});
  assert.equal(validateBackgroundBandPlacement(enlarged,{plan:plans[0],raw:raws[0]}).sourceSampling.pixelsPerWorldPixel,.5);
  flow.buildCoherentCandidate(f.workflow,revised.sha256,'band.candidate',output,composition);assert.equal(flow.verifyCoherentCandidate(f.workflow,revised.sha256,'band.candidate',output,composition).status,'deterministic-proof-valid');
  const handle=loadSceneKit(join(output,'kit')),context=contextFor(handle);
  for(const [i,p]of plans.entries()){
    assert.deepEqual(readFileSync(join(output,'source',p.recipe.assetId+'.png')),raws[i]);
    const original=inspectPng(raws[i],{includePixels:true,allowHiddenRgb:true}),derived=inspectPng(context.files.get('assets/scene.'+p.recipe.assetId+'.png'),{includePixels:true});
    assert.equal(derived.width,original.width);assert.equal(derived.height,original.height);
    for(let n=0;n<original.rgba.length;n+=4)assert.deepEqual(derived.rgba.subarray(n,n+4),original.rgba[n+3]?original.rgba.subarray(n,n+4):Buffer.alloc(4));
    const evidence=JSON.parse(readFileSync(join(output,'evidence',p.recipe.assetId+'-placement.json')));assert.equal(evidence.contentContinuity,'not-assessed');assert.equal(evidence.sourceSampling.targetReached,false);
    assert.equal(context.catalog.modules.find(m=>m.assetId==='scene.'+p.recipe.assetId).repeatAxis,'none');
  }
  const exported=join(f.parent,'band-export');exportScene(handle,readMap(handle),exported);assert.equal(openSceneExport(exported).compiled.contentSha256,compileMap(handle,readMap(handle)).contentSha256);
  parents.forEach((p,i)=>assert.deepEqual(flow.getGenerationResult(f.workflow,p.sha256).bytes,oldBytes[i]));assert.deepEqual(flow.inspectWorkflow(f.workflow),before);
  // A new theme may freeze its own seven roles against this real v5 base. This
  // does not rebind a historical edge batch to a changed environmental kit.
  const native=nativeFixtures('snow',252),bottom=bottomFixture(),nativeRaws=new Map([...native.raws,...bottom.raws]),
    edgeBatch=flow.freezeTerrainEdgeSources(f.workflow,{batchId:'band.new.theme.perimeter',baseBatchSha256:revised.sha256,capabilitiesSha256:f.options.capabilitiesSha256,
      coverageProfile:'full-perimeter-v1',items:flow.TERRAIN_PERIMETER_ROLES.map((role,i)=>({assetId:'band.perimeter.'+i,role,content:'One independent synthetic native '+role+'.',exclusions:['Independent scenery']}))});
  flow.authorizeReferenceAssetBatch(f.workflow,edgeBatch.sha256,decision('band.new.edges',edgeBatch.sha256,'approve-compute'));
  for(const sha of edgeBatch.planSha256s)receiveEdgeFixture(f.workflow,sha,nativeRaws.get(flow.getGenerationPlan(f.workflow,sha).recipe.edgeRole));
  const controls={...bottomSideControls({...f,base:revised,baseCandidateRoot:output,controls:native.controls}),bottom:bottom.controls},
    options={workflow:f.workflow,baseKitRoot:join(output,'kit'),batchSha256:edgeBatch.sha256,controls,output:join(f.parent,'band-new-perimeter')},
    edgeDelivery=buildTerrainEdgeDelivery(options);
  assert.equal(verifyTerrainEdgeDelivery(options).reportSha256,edgeDelivery.sha256);
  const extended=contextFor(loadSceneKit(join(options.output,'candidate/kit')));
  for(const p of plans)assert.deepEqual(extended.files.get('assets/scene.'+p.recipe.assetId+'.png'),context.files.get('assets/scene.'+p.recipe.assetId+'.png'));
});
