import test from 'node:test';
import assert from 'node:assert/strict';
import * as edge from '../src/generation/terrain-edge-source.mjs';
import * as gutter from '../src/generation/terrain-edge-canvas-gutter.mjs';
import {encodeRgbaPng,inspectPng} from '../src/png.mjs';
import {digest,hash,seal,unseal} from '../src/generation/common.mjs';
import {sourcePng} from './helpers/coherent.mjs';
import {decision} from './helpers/generation.mjs';
import {terrainEdgesFixture} from './helpers/terrain-edges.mjs';
import {validateTerrainEdges,compileTerrainEdges} from '../src/terrain-edges.mjs';
import {compileCurveGeometry} from '../src/curves.mjs';
import {renderCoherentFrame} from '../src/coherent-render.mjs';
import {prepareTerrainBottomEdgeAssets} from '../src/terrain-bottom-edge-pipeline.mjs';
import {bottomFixture} from './helpers/terrain-bottom-delivery.mjs';
import {TERRAIN_EDGE_GUTTER_WARNING_PROFILE} from '../src/terrain-perimeter-contract.mjs';

const profiles={coverageProfile:'full-perimeter-v1',nativeSizeProfile:'bounded-native-4m-v1',
  renderEnvelopeProfile:'visible-alpha8-outward16-native-rgba-v1',naturalSurfaceProfile:'reference-defined-cover-v1'};
const rejects=(action,code)=>assert.throws(action,error=>error.errors?.some(issue=>issue.code===code));
function fixture({version=37,capMaximum=2048,gutterPolicy}={}){
  const d=n=>n.repeat(64),spec=d('a'),style=d('b'),cap=d('c'),ref=d('d'),target=d('e'),material=d('f'),raw=d('1'),base=d('2'),refRaw=d('3'),
    state={activeSpec:spec,activeStyle:style,designs:new Map([[spec,{format:'ai_scene_spec_v3'}],
      [style,{format:'ai_scene_style_v2',name:'fixture style',rules:['Preserve local color.']}]]),
      capabilities:new Map([[cap,{imageToImage:true,transparentBackground:true,maxInputImages:2,maxWidth:capMaximum,maxHeight:capMaximum}]]),
      plans:new Map([[ref,{status:'accepted',plan:{sha256:ref,recipe:{specSha256:spec,styleSha256:style},designReviews:[]},
        result:{rawSha256:refRaw,technical:{image:{sha256:refRaw,byteLength:16,pixelSize:{width:1024,height:576}}}},
        reconstructionTarget:{sha256:target,acceptedPacketSha256:d('4'),humanReceiptSha256:d('5')}}],
      [material,{status:'pending-visual-review',plan:{sha256:material,format:'ai_scene_generation_plan_v27',recipe:{targetSha256:target},
        instanceBinding:{role:'material'},referenceEvidence:[{rawSha256:refRaw}]},result:{rawSha256:raw,
        technical:{status:'pass',sha256:d('6'),image:{sha256:raw,byteLength:24,pixelSize:{width:1024,height:512}}}}}]]),
      batches:new Map([[base,{format:'ai_scene_coherent_source_batch_v1',sha256:base,referencePlanSha256:ref,planSha256s:[material]}]])},
    recipe={planId:'edge.fixture',parents:[],stage:'terrain-edge-source',specSha256:spec,styleSha256:style,capabilitiesSha256:cap,
      referencePlans:[ref],inventoryRefs:[],assetId:'edge.left',targetSha256:target,baseBatchSha256:base,materialPlanSha256:material,
      materialRawSha256:raw,edgeRole:'left-wall',subjectBrief:{content:'One compact warm painted edge.',exclusions:['Independent props']}},
    policy=version===37?edge.TERRAIN_REFERENCE_DEFINED_COVER_POLICY:version===36?edge.ENGINEERED_CITY_TERRAIN_NATIVE_SIZE_PERIMETER_POLICY:edge.TERRAIN_NATIVE_SIZE_PERIMETER_POLICY,
    selected={...profiles,...(version===36?{surfaceFamily:'engineered-city'}:{}),...(gutterPolicy?{gutterPolicy}:{})};
  if(version!==37)delete selected.naturalSurfaceProfile;
  const plans=edge.TERRAIN_PERIMETER_ROLES.map((role,index)=>{
    const plan=edge.compileTerrainEdgeSource(state,{...recipe,...selected,planId:'gutter.legacy.'+index,assetId:'gutter.legacy.'+index,
      edgeRole:role,policySha256:policy.sha256});state.plans.set(plan.sha256,{plan,status:'planned'});return plan;
  }),batch=edge.compileTerrainEdgeBatch(state,{batchId:'gutter.legacy',baseBatchSha256:base,planSha256s:plans.map(p=>p.sha256)});
  state.batches.set(batch.sha256,batch);return {state,plans,batch,policy};
}
function nativePng({width=256,height=384,tailAlpha=1,bodyMargin=20}={}){
  const rgba=Buffer.alloc(width*height*4);
  for(let y=bodyMargin;y<height-bodyMargin;y++)for(let x=bodyMargin;x<width-bodyMargin;x++)
    rgba.set([35+x%120,70+y%90,130,255],(y*width+x)*4);
  rgba.set([9,17,23,0],0);rgba.set([31,47,61,119],((bodyMargin+10)*width+bodyMargin+10)*4);
  if(tailAlpha)rgba.set([15,23,35,tailAlpha],(Math.floor(height/2)*width)*4);
  return encodeRgbaPng(width,height,rgba);
}
function failedFixture(options={}){
  const f=fixture(options),raw=nativePng(options),plan=f.plans[1],technical=edge.assessTerrainEdgeSource(plan,raw),
    result=seal({format:'ai_scene_synthetic_result_v1',rawSha256:hash(raw),technical});
  f.state.plans.set(plan.sha256,{plan,status:'rejected-technical',result});
  return {...f,raw,plan,result,store:{readBlob:sha=>{assert.equal(sha,hash(raw));return Buffer.from(raw);}}};
}
const propose=f=>gutter.compileTerrainEdgeCanvasGutterProposal(f.store,f.state,f.plan.sha256,f.batch.sha256);

// Snapshot binds every historical v37 plan, request, QA and batch before this
// independent preparation exists. Preparation must never rewrite those bytes.
test('v37 seven-role plans, requests, policy, batch and QA retain their original hashes',()=>{
  const f=fixture(),raw=sourcePng(true,683),actual={plans:digest(f.plans),requests:digest(f.plans.map(p=>p.request)),
    qa:digest(f.plans.map(p=>edge.assessTerrainEdgeSource(p,raw))),batch:f.batch.sha256,policy:f.policy.sha256};
  assert.deepEqual(actual,{
    plans:'12f5d9e5dff965d5dea98a888e76c37be9a9208405f1497b3390a8cbd3928e24',
    requests:'266621e8588356c5ae4fba99c1842abc34aea5add8aba4e8e36689ec2cd5bb7e',
    qa:'315ae6ffe26961356c810d8e1833ef387e39810f8b8ec1ec585296bdc5b9d36a',
    batch:'5624bce53f61de46343ec18c39aaa594ade093c42f8a5c4c71d78f61f8b55664',
    policy:'d95e4fe80581454c31fef200ca6e5d711e63f945776eae92912518ebc8d527e8'
  });
});

test('new native QA preserves lone Alpha=1 border tails as warnings',()=>{
  const warning=['TERRAIN_EDGE_ALPHA_ONE_GUTTER'];
  for(const version of [35,36,37]){
    const historical=fixture({version}),current=fixture({version,gutterPolicy:TERRAIN_EDGE_GUTTER_WARNING_PROFILE});
    const [plan]=current.plans,raw=nativePng();
    assert.notEqual(current.batch.sha256,historical.batch.sha256);
    assert.deepEqual(plan.request,historical.plans[0].request);
    assert.equal(edge.assessTerrainEdgeSource(historical.plans[0],raw).status,'fail');
    const qa=edge.assessTerrainEdgeSource(plan,raw);
    assert.deepEqual(qa.issues,[]);assert.deepEqual(qa.warnings,warning);assert.equal(qa.status,'pass');
    assert.equal(qa.actualPaddingPixels.left,0);assert.equal(qa.rawSha256,hash(raw));
    assert.equal(qa.sourcePngModified,false);assert.equal(qa.semanticArtAcceptance,'not-assessed');
    assert.deepEqual(edge.assessTerrainEdgeSource(plan,nativePng({tailAlpha:0})).warnings,[]);
    for(const input of [{tailAlpha:2},{bodyMargin:1}]){
      const rejected=edge.assessTerrainEdgeSource(plan,nativePng(input));
      assert.equal(rejected.status,'fail');assert.deepEqual(rejected.warnings,[]);
    }
    const undersized=edge.assessTerrainEdgeSource(plan,nativePng({width:240}));
    assert.equal(undersized.status,'fail');assert.deepEqual(undersized.issues,['OUTPUT_SIZE']);
    assert.deepEqual(undersized.warnings,warning);
    const p=inspectPng(raw,{includePixels:true,allowHiddenRgb:true});
    for(let i=3;i<p.rgba.length;i+=4)p.rgba[i]=Math.min(1,p.rgba[i]);
    const noVisibleBody=edge.assessTerrainEdgeSource(plan,encodeRgbaPng(p.width,p.height,p.rgba));
    assert.equal(noVisibleBody.status,'fail');assert.deepEqual(noVisibleBody.warnings,[]);
  }
});

test('explicit native gutter preparation adds only zero canvas and preserves every original RGBA sample',()=>{
  for(const version of [35,36,37]){
    const f=failedFixture({version});assert.deepEqual(f.result.technical.issues,['TERRAIN_EDGE_NATIVE_GUTTER']);
    const before=digest({plans:[...f.state.plans],batches:[...f.state.batches]}),a=propose(f),b=propose(f),p=a.proposal;
    assert.equal(a.proposal.sha256,b.proposal.sha256);assert.deepEqual(a.bytes,b.bytes);
    assert.equal(p.format,'ai_scene_terrain_edge_canvas_gutter_proposal_v1');assert.equal(p.maximumNewImageCalls,0);
    assert.deepEqual(p.originalPixelSize,{width:256,height:384});assert.deepEqual(p.paddedPixelSize,{width:260,height:388});
    assert.deepEqual(p.nativeFrame,{x:2,y:2,width:256,height:384});assert.deepEqual(p.contentOffset,{x:2,y:2});
    assert.equal(p.originalRawSha256,hash(f.raw));assert.equal(p.originalTechnicalSha256,f.result.technical.sha256);
    assert.deepEqual(p.originalTechnical,f.result.technical);assert.equal(p.originalTechnical.status,'fail');
    assert.equal(p.originalBorder.maximumAlpha,1);assert.equal(p.technical.status,'pass');
    assert.equal(p.hiddenGeometry,'not-recovered');assert.equal(p.sourceArtAcceptance,'not-granted');
    const original=inspectPng(f.raw,{includePixels:true,allowHiddenRgb:true}),prepared=inspectPng(a.bytes,{includePixels:true,allowHiddenRgb:true});
    assert.equal(p.originalRgbaSha256,hash(original.rgba));assert.equal(p.paddedRgbaSha256,hash(prepared.rgba));
    for(let y=0;y<prepared.height;y++)for(let x=0;x<prepared.width;x++){
      const actual=prepared.rgba.subarray((y*prepared.width+x)*4,(y*prepared.width+x+1)*4);
      if(x>=2&&x<258&&y>=2&&y<386)assert.deepEqual(actual,original.rgba.subarray(((y-2)*original.width+x-2)*4,((y-2)*original.width+x-1)*4));
      else assert.deepEqual(actual,Buffer.alloc(4));
    }
    assert.deepEqual(prepared.rgba.subarray((2*prepared.width+2)*4,(2*prepared.width+3)*4),Buffer.from([9,17,23,0]));
    assert.equal(hash(a.previews.original),p.diagnosticPreviews.originalSha256);assert.equal(hash(a.previews.padded),p.diagnosticPreviews.paddedSha256);
    const args={preparationId:'gutter.accepted',proposal:p,receipt:decision('gutter.accept',p.sha256)},accepted=gutter.compileTerrainEdgeCanvasGutterPreparation(f.store,f.state,args);
    assert.equal(accepted.record.request.maximumCalls,0);assert.equal(accepted.record.rawSha256,hash(a.bytes));
    assert.equal(accepted.record.originalRawSha256,hash(f.raw));assert.deepEqual(accepted.record.target,f.plan.target);
    assert.deepEqual(accepted.record.nativeFrame,p.nativeFrame);assert.equal(accepted.record.sourceArtAcceptance,'not-granted');
    assert.deepEqual(accepted.bytes,a.bytes);
    assert.equal(gutter.assessTerrainEdgeCanvasGutterPreparation(accepted.record,a.bytes).sha256,p.technical.sha256);
    const altered=Buffer.from(prepared.rgba);altered[0]=97;
    rejects(()=>gutter.assessTerrainEdgeCanvasGutterPreparation(accepted.record,encodeRgbaPng(prepared.width,prepared.height,altered)),
      'TERRAIN_EDGE_CANVAS_GUTTER_PREPARED_QA');
    const wrongFrame=seal({...unseal(accepted.record),nativeFrame:{...accepted.record.nativeFrame,x:3}});
    rejects(()=>gutter.assessTerrainEdgeCanvasGutterPreparation(wrongFrame,a.bytes),'TERRAIN_EDGE_CANVAS_GUTTER_PREPARED_QA');
    assert.equal(digest({plans:[...f.state.plans],batches:[...f.state.batches]}),before);
  }
});

test('gutter eligibility keeps the original QA strict across Alpha 0, 1, 7, 8 and body margin 1/2 boundaries',()=>{
  const zero=failedFixture({tailAlpha:0});assert.equal(zero.result.technical.status,'pass');rejects(()=>propose(zero),'TERRAIN_EDGE_CANVAS_GUTTER_SOURCE');
  assert.equal(propose(failedFixture({tailAlpha:1,bodyMargin:2})).proposal.technical.status,'pass');
  for(const alpha of [7,8]){
    const f=failedFixture({tailAlpha:alpha});assert(f.result.technical.issues.includes('COHERENT_CLIPPED_SILHOUETTE'));
    rejects(()=>propose(f),'TERRAIN_EDGE_CANVAS_GUTTER_ORIGINAL_QA');
  }
  const tight=failedFixture({bodyMargin:1});assert(tight.result.technical.issues.includes('COHERENT_CLIPPED_SILHOUETTE'));
  rejects(()=>propose(tight),'TERRAIN_EDGE_CANVAS_GUTTER_ORIGINAL_QA');
  const f=failedFixture(),changed={...f,state:{...f.state,plans:new Map(f.state.plans)}};
  changed.state.plans.set(f.plan.sha256,{...f.state.plans.get(f.plan.sha256),result:seal({...unseal(f.result),technical:seal({...unseal(f.result.technical),issues:['TERRAIN_EDGE_NATIVE_GUTTER','OUTPUT_SIZE']})})});
  rejects(()=>propose(changed),'TERRAIN_EDGE_CANVAS_GUTTER_ORIGINAL_QA');
  const weak=inspectPng(f.raw,{includePixels:true,allowHiddenRgb:true});
  for(let i=3;i<weak.rgba.length;i+=4)if(weak.rgba[i])weak.rgba[i]=1;
  const raw=encodeRgbaPng(weak.width,weak.height,weak.rgba),technical=edge.assessTerrainEdgeSource(f.plan,raw),state={...f.state,plans:new Map(f.state.plans)};
  assert.deepEqual(technical.issues,['TERRAIN_EDGE_NATIVE_GUTTER']);
  state.plans.set(f.plan.sha256,{plan:f.plan,status:'rejected-technical',result:seal({rawSha256:hash(raw),technical})});
  rejects(()=>gutter.compileTerrainEdgeCanvasGutterProposal({readBlob:()=>raw},state,f.plan.sha256,f.batch.sha256),'TERRAIN_EDGE_CANVAS_GUTTER_EMPTY');
});

test('padding refuses to exceed the original 4096 dimension or four-million-pixel envelope',()=>{
  for(const size of [{width:4093,height:512},{width:2048,height:2044}]){
    const f=failedFixture({...size,capMaximum:4096});assert.deepEqual(f.result.technical.issues,['TERRAIN_EDGE_NATIVE_GUTTER']);
    rejects(()=>propose(f),'TERRAIN_EDGE_CANVAS_GUTTER_SIZE');
  }
});

test('exact acceptance binds current proposal, original raw, original QA and native pixel frame',()=>{
  const f=failedFixture(),{proposal:p}=propose(f),args={preparationId:'gutter.exact',proposal:p,receipt:decision('gutter.accept',p.sha256)};
  rejects(()=>gutter.compileTerrainEdgeCanvasGutterPreparation(f.store,f.state,{...args,receipt:decision('wrong.target',f.result.rawSha256)}),'TERRAIN_EDGE_CANVAS_GUTTER_APPROVAL');
  for(const change of [{nativeFrame:{...p.nativeFrame,width:255}},{contentOffset:{x:3,y:2}},{originalRawSha256:'9'.repeat(64)}]){
    const altered=seal({...unseal(p),...change});
    rejects(()=>gutter.compileTerrainEdgeCanvasGutterPreparation(f.store,f.state,{...args,proposal:altered,receipt:decision('tampered.target',altered.sha256)}),'TERRAIN_EDGE_CANVAS_GUTTER_PROPOSAL_CHANGED');
  }
  rejects(()=>gutter.compileTerrainEdgeCanvasGutterProposal({readBlob:()=>nativePng({tailAlpha:0})},f.state,f.plan.sha256,f.batch.sha256),'TERRAIN_EDGE_CANVAS_GUTTER_RAW');
});

test('zero-call child batch keeps received first source and the five exact original unused authorizations',()=>{
  const f=failedFixture(),{proposal}=propose(f),{record}=gutter.compileTerrainEdgeCanvasGutterPreparation(f.store,f.state,
    {preparationId:'gutter.child',proposal,receipt:decision('gutter.accept',proposal.sha256)}),first=f.plans[0],firstRaw=nativePng({tailAlpha:0}),
    firstEntry={plan:first,status:'pending-visual-review',result:seal({rawSha256:hash(firstRaw),technical:edge.assessTerrainEdgeSource(first,firstRaw)})};
  f.state.plans.set(first.sha256,firstEntry);
  const expected=f.plans.slice(2).map((plan,index)=>{
    const authorization=seal({receipt:decision('source.compute.'+index,f.batch.sha256,'approve-compute'),planSha256:plan.sha256});
    f.state.plans.set(plan.sha256,{plan,status:'authorized',authorization});return {planSha256:plan.sha256,authorizationSha256:authorization.sha256,requestSha256:digest(plan.request)};
  });
  f.state.plans.set(record.sha256,{kind:'terrain-edge-canvas-gutter-preparation',plan:record,status:'pending-visual-review',result:seal({rawSha256:record.rawSha256,technical:record.technical})});
  const child=gutter.compileTerrainEdgeCanvasGutterBatch(f.state,{batchId:'gutter.child',parentBatchSha256:f.batch.sha256,preparationSha256:record.sha256});
  assert.equal(child.format,'ai_scene_terrain_edge_canvas_gutter_batch_v1');assert.equal(child.maximumCalls,0);assert.equal(child.newImageRequests,0);
  assert.equal(child.remainingAuthorizedCalls,5);assert.equal(child.fullPerimeterComplete,true);assert.deepEqual(child.reusedAuthorizations,expected);
  assert.deepEqual(child.planSha256s,[first.sha256,record.sha256,...f.plans.slice(2).map(p=>p.sha256)]);
  assert.strictEqual(f.state.plans.get(first.sha256),firstEntry);assert.deepEqual(f.state.batches.get(f.batch.sha256),f.batch);
  const newer=seal({...unseal(f.batch),batchId:'newer.parent'});
  f.state.batches.set(newer.sha256,newer);
  rejects(()=>gutter.compileTerrainEdgeCanvasGutterBatch(f.state,{batchId:'stale.child',parentBatchSha256:f.batch.sha256,preparationSha256:record.sha256}),'TERRAIN_EDGE_CANVAS_GUTTER_PARENT_STALE');
});

test('1024px original frame at quarter scale remains 256world with identical anchors, repeats and rendered pixels after padding',()=>{
  const f=failedFixture({width:1024,height:384,capMaximum:4096}),{proposal,bytes}=propose(f),
    {record}=gutter.compileTerrainEdgeCanvasGutterPreparation(f.store,f.state,{preparationId:'gutter.frame',proposal,receipt:decision('gutter.frame.accept',proposal.sha256)}),
    item={plan:record,result:seal({rawSha256:record.rawSha256,technical:record.technical}),raw:bytes,
      preparation:{record,originalPlan:f.plan,originalResult:f.result,originalRaw:f.raw}},
    view=gutter.terrainEdgeCanvasGutterView(item),original=inspectPng(f.raw,{includePixels:true,allowHiddenRgb:true}),fixture=terrainEdgesFixture();
  assert.equal(original.width/4,256);assert.equal(inspectPng(bytes,{allowHiddenRgb:true}).width/4,257);assert.equal(view.width/4,256);
  const normalized=png=>{const rgba=Buffer.from(png.rgba);for(let i=0;i<rgba.length;i+=4)if(rgba[i+3]===0)rgba.fill(0,i,i+3);
    return encodeRgbaPng(png.width,png.height,rgba);},beforeBytes=normalized(original),afterBytes=normalized(view);
  assert.deepEqual(afterBytes,beforeBytes);
  const path='edges/large-right-wall.png',makeEdges=bytes=>{
    const edges=structuredClone(fixture.edges);edges.right.wall={source:{path,sha256:hash(bytes),byteLength:bytes.length},pixelSize:{width:1024,height:384},
      scale:{numerator:1,denominator:4},boundaryX:800,innerX:768,repeatY:{from:40,to:300}};return edges;
  },beforeEdges=makeEdges(beforeBytes),afterEdges=makeEdges(afterBytes),beforeFiles=new Map([...fixture.files,[path,beforeBytes]]),afterFiles=new Map([...fixture.files,[path,afterBytes]]);
  validateTerrainEdges(beforeEdges,fixture.appearance,{readAsset:path=>beforeFiles.get(path)});
  validateTerrainEdges(afterEdges,fixture.appearance,{readAsset:path=>afterFiles.get(path)});
  const incorrectlyPadded=structuredClone(afterEdges);incorrectlyPadded.right.wall.pixelSize.width=1028;
  rejects(()=>validateTerrainEdges(incorrectlyPadded,fixture.appearance),'TERRAIN_EDGE_JOIN');
  const world={x:0,y:0,width:1024,height:640},curve={...compileCurveGeometry({curveId:'frame.stress',familyId:'terrain.primary',
    points:[{x:320,y:64,slope:0},{x:760,y:64,slope:0}],baseY:600},16),layerId:'terrain'},
    before=compileTerrainEdges([curve],beforeEdges,{world}),after=compileTerrainEdges([curve],afterEdges,{world});
  assert.deepEqual(after,before);assert(after.curves[0].edgeMeshes.filter(mesh=>mesh.side==='right'&&mesh.part==='wall').length>2);
  const scene=result=>({defaultCamera:{center:{x:512,y:320},viewport:{width:1024,height:640}},layers:[{layerId:'terrain',visible:true,nodes:[]}],
    terrainMaterial:{body:{source:{path:'body.png',sha256:'4'.repeat(64)}},cap:{source:{path:'cap.png',sha256:'5'.repeat(64)}}},curveTerrains:result.curves});
  for(const files of [beforeFiles,afterFiles]){files.set('body.png',encodeRgbaPng(1,1,Buffer.from([120,90,70,255])));files.set('cap.png',encodeRgbaPng(1,1,Buffer.from([150,110,80,255])));}
  assert.deepEqual(renderCoherentFrame(scene(after),path=>afterFiles.get(path)),renderCoherentFrame(scene(before),path=>beforeFiles.get(path)));
});

test('all three native-v2 bottom roles derive from the unchanged original frame and retain original failure evidence',()=>{
  for(const [preparedIndex,role]of edge.TERRAIN_BOTTOM_EDGE_ROLES.entries()){
    const f=fixture(),bottom=bottomFixture(),plan=f.plans[preparedIndex+4],old=inspectPng(bottom.raws.get(role),{includePixels:true,allowHiddenRgb:true});
    old.rgba.set([31,47,61,1],(20*old.width)*4);
    const raw=encodeRgbaPng(old.width,old.height,old.rgba),technical=edge.assessTerrainEdgeSource(plan,raw),result=seal({rawSha256:hash(raw),technical});
    assert.deepEqual(technical.issues,['TERRAIN_EDGE_NATIVE_GUTTER']);f.state.plans.set(plan.sha256,{plan,status:'rejected-technical',result});
    const store={readBlob:sha=>{assert.equal(sha,hash(raw));return raw;}},
      {proposal,bytes}=gutter.compileTerrainEdgeCanvasGutterProposal(store,f.state,plan.sha256,f.batch.sha256),
      {record}=gutter.compileTerrainEdgeCanvasGutterPreparation(store,f.state,{preparationId:'bottom.gutter.'+preparedIndex,proposal,receipt:decision('bottom.gutter.accept',proposal.sha256)}),
      source={plan:record,result:seal({rawSha256:record.rawSha256,technical:record.technical}),raw:bytes,
        preparation:{record,originalPlan:plan,originalResult:result,originalRaw:raw}},
      sources=edge.TERRAIN_BOTTOM_EDGE_ROLES.map((name,index)=>{
        if(name===role)return source;
        const native=bottom.raws.get(name),p=f.plans[index+4];return {plan:p,raw:native,result:seal({rawSha256:hash(native),technical:edge.assessTerrainEdgeSource(p,native)})};
      }),batch=seal({...unseal(f.batch),format:gutter.TERRAIN_EDGE_CANVAS_GUTTER_BATCH_FORMAT,
        preparationSha256s:[record.sha256],planSha256s:f.batch.planSha256s.map(sha=>sha===plan.sha256?record.sha256:sha)}),
      side=terrainEdgesFixture(),files=new Map(),kit={terrainAppearance:side.appearance,
        terrainEdges:{...side.edges,format:'ai_scene_terrain_edges_v6',materialProfile:'union-world-body-local-surface-v1'}},
      built=prepareTerrainBottomEdgeAssets({files,kit,inputs:{batch,sources},controls:{...bottom.controls,
        nativeSizeProfile:profiles.nativeSizeProfile,renderEnvelopeProfile:profiles.renderEnvelopeProfile}}),key=['edge','leftCorner','rightCorner'][preparedIndex];
    assert.equal(built.edges.format,'ai_scene_terrain_bottom_edges_v2');assert.deepEqual(built.edges[key].pixelSize,{width:384,height:384});
    assert.deepEqual(built.edges[key].scale,bottom.controls[key].scale);assert.equal(built.edges[key].boundaryY,bottom.controls[key].boundaryY);
    const normalized=Buffer.from(old.rgba);for(let i=0;i<normalized.length;i+=4)if(normalized[i+3]===0)normalized.fill(0,i,i+3);
    assert.deepEqual(files.get('kit/'+built.edges[key].source.path),encodeRgbaPng(384,384,normalized));
    assert.deepEqual(files.get('source/'+role+'-native.png'),bytes);assert.deepEqual(files.get('source/'+role+'-original-native.png'),raw);
    assert.deepEqual(JSON.parse(files.get('evidence/'+role+'-original-technical-qa.json')),technical);
    assert.equal(built.evidence[preparedIndex].nativeCanvasGutterPreparation.originalTechnicalSha256,technical.sha256);
    assert.equal(built.evidence[preparedIndex].nativeCanvasGutterPreparation.maximumNewImageCalls,0);
    assert.equal(built.validation.nativeScalePreserved,true);
  }
});
