import {SIGNATURES,NEIGHBORS,PROFILE} from './topology.mjs';
import {createSceneSemantics} from './semantics.mjs';
import {inspectPng,encodeRgbaPng} from './png.mjs';
import {deriveReferenceField,REFERENCE_FIELD_SHA256} from './terrain-proof/reference-field.mjs';
import {deriveJoinedField,JOINED_FIELD_SHA256} from './terrain-proof/joined-field.mjs';
import {compileMeasuredSurfaceMapping,deriveMeasuredField,MEASURED_FIELD_SHA256} from './terrain-proof/measured-field.mjs';
import {resampleEnvironmentAlpha} from './environment-proof.mjs';
import {measurePlatformSurface,TERRAIN_SKIN_PROFILE} from './terrain-skins.mjs';
import {COHERENT_POLICY,coherentRole,envelopeBounds} from './generation/coherent-source.mjs';
import {check,contract,digest,hash,id,jsonBytes,seal,unseal} from './generation/common.mjs';
import {validateCoherentComposition,coherentDisplayPlacement,coherentCompositionContacts} from './coherent-composition.mjs';
import {coherentTerrainLayout,coherentContactPlacement,calibratedCoherentTarget} from './coherent-layout.mjs';
import {COHERENT_SAMPLING,coherentSamplingSize,coherentSamplingStyle} from './coherent-sampling.mjs';
import {backgroundBandDefinition,validateBackgroundBandPlacement} from './background-band-placement.mjs';
import {assertCandidateBandRelationReviews,assertCandidateBandGuideReviews,assertBandReviewObservationsAgree,assertBandGuideWorldPlacement} from './generation/band-feature-relation-gate.mjs';
import {assertCompositionStructureCoversSources,reviewReferenceFeatureLayout} from './reference-feature-layout.mjs';
import {assertTerrainIntentRendering,createIntentTerrainProfile} from './terrain-intent.mjs';
import {needsCompleteTerrain} from './terrain-perimeter-contract.mjs';
const gcd=(a,b)=>b?gcd(b,a%b):a;
// Assemble only the current reference batch. No old kit, theme-specific placements,
// reference appearance pixels, accepted contour mask or implicit human art decisions.
export function coherentSceneFiles({candidateId,batch,sources,reference,spec,style,composition=null,relationReviews=null,guideReviews=null}){
  id(candidateId);check(candidateId.length<=60,'CANDIDATE_ID');
  const checkedRelations=assertCandidateBandRelationReviews(sources,relationReviews);
  const checkedGuides=assertCandidateBandGuideReviews(sources,guideReviews,reference.raw);
  assertBandReviewObservationsAgree(checkedRelations,checkedGuides);
  assertBandGuideWorldPlacement(sources,checkedGuides,composition,reference.target);
  const target=reference.target,W=target.mapping.viewport.width,H=target.mapping.viewport.height,cols=Math.ceil(W/64),rows=Math.ceil(H/64);
  const compositionRows=validateCoherentComposition(composition,batch,target),joined=composition?.format==='ai_scene_coherent_composition_v3';
  const layoutTarget=calibratedCoherentTarget(target,composition?.surfaceCalibration);
  const featured=composition?.format==='ai_scene_coherent_composition_v6',measured=['ai_scene_coherent_composition_v4','ai_scene_coherent_composition_v5','ai_scene_coherent_composition_v6'].includes(composition?.format),curved=joined||measured;
  const sampled=curved||composition?.format==='ai_scene_coherent_composition_v2',contacts=coherentCompositionContacts(composition);
  const bandSources=sources.filter(s=>backgroundBandDefinition(s.plan)),bandRows=new Map((composition?.bandPlacements??[]).map(row=>[row.instanceId,row]));
  check(!bandSources.length||['ai_scene_coherent_composition_v5','ai_scene_coherent_composition_v6'].includes(composition?.format)&&bandSources.every(s=>bandRows.has(s.plan.recipe.assetId)),
    'COHERENT_BACKGROUND_BAND_CALIBRATION_REQUIRED','Background bands require explicit full-native-frame placement; observed-envelope contain is forbidden');
  check([...bandRows.keys()].every(id=>bandSources.some(s=>s.plan.recipe.assetId===id)),'BACKGROUND_BAND_PLACEMENT_BINDING');
  assertCompositionStructureCoversSources(composition,sources);
  const featureReview=featured?reviewReferenceFeatureLayout({structure:composition.referenceStructure,sources,measurements:composition.featureMeasurements,bandPlacements:composition.bandPlacements,correction:composition.featureCorrection,supplement:composition.featureSupplement,intentReview:composition.referenceIntentReview}):null;
  check(!featureReview||featureReview.status==='reviewed','REFERENCE_FEATURE_LAYOUT_BLOCKED',featureReview?.rows.flatMap(r=>r.issues).join(', '));
  const featureRows=new Map((featureReview?.rows??[]).map(r=>[r.instanceId,r]));
  const material=sources.find(s=>s.plan.instanceBinding.role==='material');check(material,'COHERENT_MATERIAL_REQUIRED');
  const terrainIntent=material.plan.recipe.sourceScope?.terrainIntent,terrainRendering=composition?.terrainRendering;
  assertTerrainIntentRendering(terrainIntent,terrainRendering);
  check(!terrainIntent||measured,'TERRAIN_RENDERING_MEASURED_REQUIRED');
  check(batch.planSha256s.length===sources.length&&sources.every(s=>batch.planSha256s.includes(s.plan.sha256)
    &&s.plan.referenceEvidence[0].rawSha256===target.rawSha256&&s.result.technical.status==='pass'
    &&['pending-visual-review','accepted'].includes(s.status)),'COHERENT_SOURCES_INCOMPLETE');
  if(measured)check(compileMeasuredSurfaceMapping({reference:reference.raw,target,material:material.raw,
    observations:composition.surfaceMapping.observations}).sha256===composition.surfaceMapping.sha256,'COHERENT_MEASURED_MATERIAL_BINDING');
  const files=new Map(),terrain=measured?deriveMeasuredField(material.raw,composition.surfaceMapping):joined?deriveJoinedField(material.raw):deriveReferenceField(material.raw),kitRef={kitId:candidateId,revision:composition?'coherent-composition-'+composition.sha256.slice(0,12):'coherent-scene-v1'},modules=[],variants=new Map();
  if(featureReview){files.set('evidence/reference-structure.json',jsonBytes(composition.referenceStructure));files.set('evidence/reference-feature-review.json',jsonBytes(featureReview));}
  if(composition?.featureCorrection)files.set('evidence/reference-feature-correction.json',jsonBytes(composition.featureCorrection));
  if(composition?.featureSupplement)files.set('evidence/reference-feature-supplement.json',jsonBytes(composition.featureSupplement));
  if(composition?.referenceIntentReview)files.set('evidence/reference-intent-review.json',jsonBytes(composition.referenceIntentReview));
  const moduleFor=(assetId,path,bytes,width,height,kind='environment')=>({assetId,kind,source:{path,sha256:hash(bytes),byteLength:bytes.length},
    pixelSize:{width,height},footprint:{columns:Math.ceil(width/64),rows:Math.ceil(height/64)},anchorPx:{x:0,y:0},visualOffset:{x:0,y:0},allowedTransforms:['identity'],repeatAxis:'none'});
  for(const [path,bytes]of terrain.files){if(path.startsWith('tiles/'))files.set('kit/assets/'+path.slice(6),bytes);
    else if(path.startsWith('materials/'))files.set('kit/'+path,bytes);else files.set('terrain-proof/'+path,bytes);}
  for(const signature of SIGNATURES){const ids=[];for(let phase=0;phase<32;phase++){
    const assetId=`r${phase}-blob-${String(signature).padStart(3,'0')}`,path=`assets/${assetId}.png`,bytes=files.get('kit/'+path);
    modules.push(moduleFor(assetId,path,bytes,64,64,'terrain'));ids.push(assetId);}variants.set(signature,ids);}
  const groundLayers=new Set(target.instances.filter(i=>coherentRole(i.role)==='ground').map(i=>i.layerId));
  check(groundLayers.size===1,'COHERENT_ONE_GROUND_LAYER');const terrainLayer=[...groundLayers][0];
  const layers=target.layers.map(l=>({layerId:l.layerId,kind:l.layerId===terrainLayer?'terrain':l.kind==='background'?'background':'environment',
    zIndex:composition?.layerOrder?composition.layerOrder.indexOf(l.layerId)*10:l.zIndex,parallax:{x:l.parallaxX,y:1},visible:true})).sort((a,b)=>a.zIndex-b.zIndex);
  let sharedPlatformLayer;
  if(target.instances.some(i=>coherentRole(i.role)==='platform'&&i.layerId===terrainLayer)){
    // A fixed platform's assembly carries grid cells and a separate visual. Keep
    // its visual above terrain at unit parallax, even when the reference groups
    // both play surfaces in one layer.
    const layerIds=new Set(layers.map(layer=>layer.layerId));
    sharedPlatformLayer='platform.skin';
    for(let suffix=2;layerIds.has(sharedPlatformLayer);suffix++)sharedPlatformLayer=`platform.skin.${suffix}`;
    const afterTerrain=layers.findIndex(layer=>layer.layerId===terrainLayer)+1;
    layers.splice(afterTerrain,0,{layerId:sharedPlatformLayer,kind:'environment',zIndex:0,parallax:{x:1,y:1},visible:true});
    layers.forEach((layer,index)=>{layer.zIndex=index*10;});
  }
  const rules={format:'ai_scene_terrain_rules_v1',kitRef,rulesId:'terrain.primary',revision:'coherent-grid-v1',profile:PROFILE,familyId:'terrain.primary',
    entries:SIGNATURES.map(signature=>({signature,variantAssetIds:variants.get(signature)}))};
  const mapBase=(mapId,width,height)=>({format:curved?'ai_scene_document_v6':'ai_scene_document_v3',mapId,kitRef,rulesRef:{rulesId:rules.rulesId,revision:rules.revision},
    bounds:{x:0,y:0,width,height},seed:candidateId,layers,terrainRuns:[],instances:[],assemblyInstances:[],curveTerrains:[],terrainConnections:[],inspectionCases:[],
    defaultCamera:{center:{x:W/2,y:H/2},viewport:{width:W,height:H},scale:1},...(curved?{instanceTransforms:[]}:{})});
  const map=mapBase(candidateId+'.default',cols,rows),cells=new Set(),sourceEvidence=[],platformPresets=[];
  const run=(x,y,length)=>({x,y,length,familyId:rules.familyId});
  for(const instance of target.instances.filter(i=>coherentRole(i.role)==='ground')){
    const surfaces=layoutTarget.surfaces.filter(s=>s.instanceId===instance.instanceId);check(surfaces.length>0,'COHERENT_GROUND_SURFACE');
    for(const s of surfaces)for(let x=Math.max(0,Math.floor(s.points[0].x/64));x<Math.min(cols,Math.ceil(s.points.at(-1).x/64));x++){
      const cx=Math.max(s.points[0].x,Math.min(s.points.at(-1).x,x*64+32));let py=s.points[0].y;
      for(let j=1;j<s.points.length;j++){const a=s.points[j-1],b=s.points[j];if(cx>=a.x&&cx<=b.x&&b.x>a.x){py=a.y+(b.y-a.y)*(cx-a.x)/(b.x-a.x);break;}if(cx>=b.x)py=b.y;}
      const top=Math.max(0,Math.min(rows-1,Math.round(py/64)));for(let y=top;y<rows;y++)cells.add(`${x},${y}`);
    }
  }
  const authoredTerrain=composition?.terrainLayout;
  if(authoredTerrain){
    cells.clear();
    for(const row of authoredTerrain.terrainRuns)for(let x=row.x;x<row.x+row.length;x++)cells.add(`${x},${row.y}`);
  }
  const surfaceLayout=curved&&!authoredTerrain?coherentTerrainLayout(target,rules.familyId,composition?.surfaceCalibration):null;
  if(authoredTerrain){
    const {terrainRuns,curveTerrains,terrainConnections}=authoredTerrain;
    Object.assign(map,{terrainRuns,curveTerrains,terrainConnections});
    files.set('evidence/terrain-layout.json',jsonBytes(seal({format:'ai_scene_coherent_authored_terrain_layout_v1',
      targetSha256:target.sha256,layoutSha256:digest(authoredTerrain),generationCalls:0,visualAcceptance:'not-assessed'})));
  }else if(curved){map.curveTerrains=surfaceLayout.curveTerrains;files.set('evidence/terrain-layout.json',jsonBytes(surfaceLayout.report));}
  else map.terrainRuns=[...cells].map(s=>s.split(',').map(Number)).sort((a,b)=>a[1]-b[1]||a[0]-b[0]).map(([x,y])=>run(x,y,1));
  const occupied=new Set(cells),platformAdjustments=[];
  for(const item of sources){
    const {plan,raw,result}=item,role=plan.instanceBinding.role,assetId='scene.'+plan.recipe.assetId;
    if(item.preparation){const p=item.preparation;
      const canvas=['ai_scene_coherent_canvas_gutter_preparation_v1','ai_scene_coherent_canvas_gutter_preparation_v2'].includes(plan.format);
      const nativeFrame=plan.format==='ai_scene_coherent_native_frame_preparation_v1';
      check((canvas||nativeFrame||plan.format==='ai_scene_coherent_border_preparation_v1')&&p.record.sha256===plan.sha256&&plan.sourcePlanSha256===p.originalPlan.sha256
        &&plan.originalRawSha256===hash(p.originalRaw)&&p.originalResult.rawSha256===plan.originalRawSha256&&p.originalResult.technical.status===(plan.format==='ai_scene_coherent_canvas_gutter_preparation_v1'?'pass':'fail')
        &&plan.request.maximumCalls===0&&result.rawSha256===hash(raw),'COHERENT_PREPARATION_EVIDENCE');
      files.set(`source/original/${plan.recipe.assetId}.png`,p.originalRaw);
      files.set(`evidence/${plan.recipe.assetId}-original-plan.json`,jsonBytes(p.originalPlan));
      files.set(`evidence/${plan.recipe.assetId}-original-result.json`,jsonBytes(p.originalResult));
      files.set(`evidence/${plan.recipe.assetId}-preparation.json`,jsonBytes(p.record));
    }
    const rebound=plan.format==='ai_scene_coherent_rebind_v1';
    files.set(`source/${plan.recipe.assetId}.png`,raw);
    if(rebound){
      const source=unseal(plan.sourceEvidence),proposal=unseal(plan.proposal);
      check(item.kind==='coherent-rebind'&&plan.request.maximumCalls===0&&plan.receipt?.decision==='accept'
        &&plan.receipt.targetSha256===plan.proposal.sha256&&proposal.sourceEvidenceSha256===plan.sourceEvidence.sha256
        &&proposal.target.planSha256===plan.targetPlanSha256&&proposal.target.targetSha256===plan.recipe.targetSha256
        &&source.rawSha256===hash(raw)&&plan.rawSha256===source.rawSha256&&result.rawSha256===source.rawSha256
        &&result.format==='ai_scene_coherent_rebind_result_v1'&&result.rebindSha256===plan.sha256
        &&result.targetPlanSha256===plan.targetPlanSha256&&result.maximumCalls===0
        &&result.technical.sha256===plan.technical.sha256&&plan.technical.planSha256===plan.targetPlanSha256,'COHERENT_REBIND_EVIDENCE');
      // The full rebind record contains a private review receipt.  Export only
      // the path-free identities needed for content tracing, never old attempts,
      // authorizations, source workflow paths or operator notes.
      files.set(`evidence/${plan.recipe.assetId}-rebind.json`,jsonBytes(seal({format:'ai_scene_coherent_rebind_public_evidence_v1',
        rebindSha256:plan.sha256,targetPlanSha256:plan.targetPlanSha256,targetSha256:plan.recipe.targetSha256,
        sourceEvidenceSha256:plan.sourceEvidence.sha256,sourcePlanSha256:source.source.planSha256,
        sourceTargetSha256:source.source.targetSha256,sourceReferenceRawSha256:source.source.referenceRawSha256,
        sourceTechnicalSha256:source.technicalSha256,rawSha256:source.rawSha256,byteLength:source.byteLength,
        targetTechnicalSha256:result.technical.sha256,proposalSha256:plan.proposal.sha256,receiptSha256:digest(plan.receipt),
        generationCalls:0,sourceVisualAcceptance:'not-transferred',finalArtAcceptance:'not-assessed',
        provenance:'local-export-not-a-provider-attestation'})));
    }else{
      files.set(`evidence/${plan.recipe.assetId}-plan.json`,jsonBytes(plan));
      files.set(`evidence/${plan.recipe.assetId}-result.json`,jsonBytes(result));
    }
    sourceEvidence.push({assetId:plan.recipe.assetId,role,planSha256:plan.sha256,rawSha256:hash(raw),technicalSha256:result.technical.sha256,artAcceptance:rebound?'not-assessed':item.review?.receipt.decision==='accept'?'accepted':'not-assessed',
      ...(rebound?{origin:'checked-zero-call-source-rebind',sourceEvidenceSha256:plan.sourceEvidence.sha256,
        targetPlanSha256:plan.targetPlanSha256,maximumNewImageCalls:0,sourceVisualAcceptance:'not-transferred'}:{}),
      ...(plan.sourceScope?.profile==='isolated-layer-v4'?{parentRole:plan.sourceScope.parentRole,scopeSha256:plan.sourceScope.definition.sha256,semanticIsolation:'not-assessed'}:{}),
      ...(item.preparation?{origin:plan.format==='ai_scene_coherent_native_frame_preparation_v1'?'explicit-zero-generation-native-frame-preparation':['ai_scene_coherent_canvas_gutter_preparation_v1','ai_scene_coherent_canvas_gutter_preparation_v2'].includes(plan.format)?'explicit-zero-generation-canvas-gutter-preparation':'explicit-zero-generation-border-preparation',preparationSha256:plan.sha256,originalPlanSha256:item.preparation.originalPlan.sha256,
        originalRawSha256:hash(item.preparation.originalRaw),originalTechnicalSha256:item.preparation.originalResult.technical.sha256,originalTechnicalStatus:item.preparation.originalResult.technical.status,
        preparedTechnicalStatus:'pass',maximumNewImageCalls:0,allOriginalRgbaPreserved:true,hiddenGeometryRestored:false}:{})});
    if(plan.format==='ai_scene_coherent_canvas_gutter_preparation_v2')Object.assign(sourceEvidence.at(-1),{
      preparationFormat:plan.format,preparationProfile:plan.proposal.rule.profile});
    if(plan.sourceScope?.profile==='isolated-layer-v4')files.set(`evidence/${plan.recipe.assetId}-scope.json`,jsonBytes(plan.sourceScope.definition));
    if(role==='material')continue;
    const instance=target.instances.find(i=>i.instanceId===plan.recipe.assetId);check(instance,'COHERENT_INSTANCE');
    if(featureRows.has(instance.instanceId)&&!backgroundBandDefinition(plan)){
      const reviewed=featureRows.get(instance.instanceId),{placement}=reviewed,png=inspectPng(raw,{includePixels:true,allowCabx:true,allowHiddenRgb:true}),rgba=Buffer.from(png.rgba);
      for(let i=0;i<rgba.length;i+=4)if(!rgba[i+3])rgba.fill(0,i,i+3);
      const bytes=encodeRgbaPng(png.width,png.height,rgba),path=`assets/${assetId}.png`,mod=moduleFor(assetId,path,bytes,png.width,png.height),p=placement.positionWorld;
      const x=Math.max(0,Math.min(W-1,Math.floor(p.x))),y=Math.max(0,Math.min(H-1,Math.floor(p.y)));
      mod.visualOffset={x:p.x-x,y:p.y-y};mod.renderStyle={scale:placement.sourceToWorld,tint:0xffffff,opacity:1};mod.preferredLayerId=instance.layerId;
      modules.push(mod);files.set('kit/'+path,bytes);map.instances.push({instanceId:instance.instanceId,assetId,layerId:instance.layerId,x,y});
      files.set(`evidence/${plan.recipe.assetId}-placement.json`,jsonBytes(seal({format:'ai_scene_reference_feature_placement_v1',structureSha256:composition.referenceStructure.sha256,reviewSha256:featureReview.sha256,
        sourcePlanSha256:plan.sha256,sourceSha256:hash(raw),derivedSha256:hash(bytes),nativeFrame:{x:0,y:0,width:png.width,height:png.height},placement,points:reviewed.points,
        sourceSampling:'full-native-frame-no-resampling-v1',zeroRgbAtZeroAlpha:true,sourcePngModified:false,nonzeroAlphaRgbaChanged:false,artAcceptance:'not-assessed'})));
      continue;
    }
    if(backgroundBandDefinition(plan)){
      const placement=bandRows.get(instance.instanceId),evidence=validateBackgroundBandPlacement(placement,{plan,raw,target}),
        png=inspectPng(raw,{includePixels:true,allowCabx:true,allowHiddenRgb:true}),rgba=Buffer.from(png.rgba);
      // Keep the complete native frame at 1:1 storage resolution. Only the
      // established zero-alpha hidden-RGB normalization is permitted.
      for(let i=0;i<rgba.length;i+=4)if(rgba[i+3]===0)rgba.fill(0,i,i+3);
      const bytes=encodeRgbaPng(png.width,png.height,rgba),path=`assets/${assetId}.png`,
        mod=moduleFor(assetId,path,bytes,png.width,png.height),position=coherentDisplayPlacement({...placement.positionWorld,
          scale:placement.sourceToWorld,tint:0xffffff,opacity:1},mod,{width:W,height:H});
      mod.preferredLayerId=instance.layerId;files.set('kit/'+path,bytes);modules.push(mod);
      map.instances.push({instanceId:instance.instanceId,assetId,layerId:instance.layerId,...position});
      files.set(`evidence/${plan.recipe.assetId}-placement.json`,jsonBytes(seal({format:'ai_scene_background_band_asset_placement_v1',
        ...evidence,sourceSha256:hash(raw),derivedSha256:hash(bytes),outputSize:{width:png.width,height:png.height},
        sourceCrop:placement.nativeFrame,mode:'explicit-full-native-frame-background-band-v1',zeroRgbAtZeroAlpha:true,originalPngModified:false,
        repeatAxis:'none',compositionSha256:composition.sha256})));
      Object.assign(sourceEvidence.at(-1),{backgroundBandSha256:placement.backgroundBandSha256,backgroundBandPlacement:placement,
        coverageGeometry:evidence.geometry,contentContinuity:'not-assessed',styleAndArtAcceptance:'not-assessed',repeatAxis:'none'});
      continue;
    }
    const box=role==='sky'?{x:0,y:0,width:W,height:H}:envelopeBounds(instance.visibleEnvelope);
    const png=inspectPng(raw,{includePixels:true,allowCabx:true,allowHiddenRgb:true}),crop=role==='sky'?{x:0,y:0,width:png.width,height:png.height}:result.technical.contentBounds;
    check(crop,'COHERENT_CONTENT_BOUNDS');
    const scale=role==='sky'?null:Math.min(1,box.width/crop.width,box.height/crop.height);
    const width=role==='sky'?W:Math.max(1,Math.round(crop.width*scale)),height=role==='sky'?H:Math.max(1,Math.round(crop.height*scale));
    const margin=role==='sky'?0:COHERENT_POLICY.derivedTransparentMarginPx,transform=compositionRows.get(instance.instanceId);
    const surface=role==='platform'?target.surfaces.find(s=>s.instanceId===instance.instanceId):null;
    if(role==='platform')check(surface,'COHERENT_PLATFORM_SURFACE');
    const columns=surface?Math.max(1,Math.min(cols,Math.round((surface.points.at(-1).x-surface.points[0].x)/64))):null;
    const nativeSurface=sampled&&surface?measurePlatformSurface(png):null;
    const sampling=sampled?coherentSamplingSize(crop,{width,height},transform?transform.scale.numerator/transform.scale.denominator:1,
      {margin,...(surface?{platformSpan:columns*64,nativePlatformSpan:nativeSurface.right-nativeSurface.left}:{})}):null;
    let image=resampleEnvironmentAlpha(png,crop,sampling?.width??width,sampling?.height??height);
    if(margin){const iw=image.width,ih=image.height,padded={width:iw+margin*2,height:ih+margin*2,rgba:Buffer.alloc((iw+margin*2)*(ih+margin*2)*4)};
      for(let y=0;y<ih;y++)image.rgba.copy(padded.rgba,((y+margin)*padded.width+margin)*4,y*iw*4,(y+1)*iw*4);image=padded;}
    const bytes=encodeRgbaPng(image.width,image.height,image.rgba),path=`assets/${assetId}.png`;
    files.set('kit/'+path,bytes);const mod=moduleFor(assetId,path,bytes,image.width,image.height,role==='sky'?'background':'environment');mod.preferredLayerId=instance.layerId;mod.anchorPx={x:margin,y:margin};
    if(role==='platform'){
      const surface=target.surfaces.find(s=>s.instanceId===instance.instanceId);check(surface,'COHERENT_PLATFORM_SURFACE');
      const layerId=instance.layerId===terrainLayer?sharedPlatformLayer:instance.layerId;
      const measured=measurePlatformSurface(image),n=columns*64,d=measured.right-measured.left,g=gcd(n,d);
      mod.terrainSkin={profile:TERRAIN_SKIN_PROFILE,columns,rows:1,surfacePx:measured};mod.footprint={columns,rows:1};mod.anchorPx={x:measured.left,y:measured.y};mod.preferredLayerId=layerId;
      mod.renderStyle={scale:{numerator:n/g,denominator:d/g},tint:0xffffff,opacity:1};
      const presetId='platform.'+instance.instanceId;platformPresets.push({presetId,sizeCells:{width:columns,height:1},terrainRuns:[run(0,0,columns)],
        instances:[{instanceId:'skin',assetId,x:0,y:0}],assemblies:[]});
      const initialColumn=Math.max(0,Math.min(cols-columns,Math.round(surface.points[0].x/64))),initialRow=Math.max(0,Math.min(rows-1,Math.round(surface.points[0].y/64)));
      const candidates=[];
      for(let row=0;row<rows;row++)for(let column=0;column<=cols-columns;column++){
        if(Math.abs(column-initialColumn)+Math.abs(row-initialRow)>COHERENT_POLICY.maximumPlatformGridShift)continue;
        let free=true;for(let dx=0;dx<columns;dx++)for(const [ox,oy]of [[0,0],[-1,0],[1,0],[0,-1],[0,1]])if(occupied.has(`${column+dx+ox},${row+oy}`))free=false;
        if(free)candidates.push({column,row,distance:(column*64-surface.points[0].x)**2+(row*64-surface.points[0].y)**2});
      }
      candidates.sort((a,b)=>a.distance-b.distance||a.row-b.row||a.column-b.column);check(candidates.length,'COHERENT_PLATFORM_LAYOUT');
      const {column,row}=candidates[0];for(let dx=0;dx<columns;dx++)occupied.add(`${column+dx},${row}`);
      platformAdjustments.push({instanceId:instance.instanceId,requested:{column:initialColumn,row:initialRow},placed:{column,row},maximumGridShift:COHERENT_POLICY.maximumPlatformGridShift,
        ...(curved?{referenceSurface:{left:surface.points[0].x,top:surface.points[0].y,right:surface.points.at(-1).x},
          worldDelta:{x:column*64-surface.points[0].x,y:row*64-surface.points[0].y},physics:'grid-preserved'}:{})});
      map.assemblyInstances.push({instanceId:instance.instanceId,presetId,layerId,column,row});
    }else{
      const contact=contacts.has(instance.instanceId)?coherentContactPlacement(contacts.get(instance.instanceId),layoutTarget,{width,height}):null;
      const position=transform?coherentDisplayPlacement(transform,mod,{width:W,height:H})
        :contact?coherentDisplayPlacement({...contact.position,scale:{numerator:1,denominator:1},tint:0xffffff,opacity:1},mod,{width:W,height:H})
          :{x:Math.round(box.x+(box.width-width)/2),y:Math.round(box.y+(box.height-height)/2)};
      if(contact)files.set(`evidence/${plan.recipe.assetId}-contact.json`,jsonBytes(contact.evidence));
      if(sampling)mod.renderStyle=coherentSamplingStyle(mod.renderStyle,sampling.factor);
      map.instances.push({instanceId:instance.instanceId,assetId,layerId:instance.layerId,...position});
    }
    modules.push(mod);
    files.set(`evidence/${plan.recipe.assetId}-placement.json`,jsonBytes(seal({format:'ai_scene_coherent_asset_placement_v1',sourceSha256:hash(raw),derivedSha256:hash(bytes),
      observedEnvelope:box,sourceCrop:crop,outputSize:{width:image.width,height:image.height},transparentMarginPx:margin,mode:sampled?'display-density-direct-from-native':role==='sky'?'whole-canvas-fill':'alpha-envelope-uniform-contain',referenceFallbackPixels:0,
      continuousAlphaPreserved:true,zeroRgbAtZeroAlpha:true,originalPngModified:false,artAcceptance:'not-assessed',
      ...(item.preparation?{sourcePreparationSha256:plan.sha256,originalSourceRawSha256:hash(item.preparation.originalRaw),sourceOrigin:plan.format==='ai_scene_coherent_native_frame_preparation_v1'?'explicit-zero-generation-native-frame-preparation':['ai_scene_coherent_canvas_gutter_preparation_v1','ai_scene_coherent_canvas_gutter_preparation_v2'].includes(plan.format)?'explicit-zero-generation-canvas-gutter-preparation':'explicit-zero-generation-border-preparation'}:{}),
      ...(sampled?{sourceSampling:{profile:COHERENT_SAMPLING,logicalFitSize:{width,height},nativeUpscale:false,targetPixelsPerWorldPixel:2,
        pixelsPerWorldPixel:mod.renderStyle.scale.denominator/mod.renderStyle.scale.numerator}}:{}),
      ...(compositionRows.has(instance.instanceId)?{displayTransform:compositionRows.get(instance.instanceId),compositionSha256:composition.sha256}:{})})));
  }
  const preset=(presetId,width,height,terrainRuns)=>({presetId,sizeCells:{width,height},terrainRuns,instances:[],assemblies:[]});
  const library={format:'ai_scene_assembly_presets_v1',kitRef,presets:[preset('ground.flat',8,2,[run(0,0,8),run(0,1,8)]),
    preset('ground.steps',6,3,[run(0,2,6),run(2,1,4),run(4,0,2)]),preset('ground.gap',8,2,[run(0,0,3),run(5,0,3),run(0,1,3),run(5,1,3)]),...platformPresets]};
  const inspection=mapBase(candidateId+'.inspection',40,30),testCells=new Set();
  SIGNATURES.forEach((signature,index)=>{const x=index%8*5+2,y=Math.floor(index/8)*5+2;testCells.add(`${x},${y}`);
    for(const [dx,dy,bit]of NEIGHBORS)if(signature&bit)testCells.add(`${x+dx},${y+dy}`);
    inspection.inspectionCases.push({caseId:'role-'+signature,cell:{x,y},expectedSignature:signature});});
  inspection.terrainRuns=[...testCells].map(s=>s.split(',').map(Number)).map(([x,y])=>run(x,y,1));
  const catalog={format:'ai_scene_module_catalog_v4',kitRef,modules};
  for(const [path,value]of [['catalog.json',catalog],['rules.json',rules],['presets.json',library],['maps/default.scene.json',map],['maps/inspection.scene.json',inspection]])files.set('kit/'+path,jsonBytes(value));
  const ref=path=>({path,sha256:hash(files.get('kit/'+path))}),field=(kind,height)=>{const path=`materials/${kind}-field.png`,bytes=files.get('kit/'+path);
    return {source:{path,sha256:hash(bytes),byteLength:bytes.length},pixelSize:{width:505,height}};};
  const kit={format:'ai_scene_kit_v4',...kitRef,profile:PROFILE,purpose:'art-candidate',grid:{width:64,height:64},pixelsPerUnit:{numerator:1,denominator:1},
    terrainAppearance:{format:measured?'ai_scene_continuous_terrain_appearance_v5':joined?'ai_scene_continuous_terrain_appearance_v4':'ai_scene_continuous_terrain_appearance_v2',selection:'world-cell-8x4-phase-order-v1',profileSha256:measured?MEASURED_FIELD_SHA256:joined?JOINED_FIELD_SHA256:REFERENCE_FIELD_SHA256,
      sourceSha256:hash(material.raw),studySha256:terrain.report.sha256,body:field('body',253),cap:field('cap',measured?terrain.report.field.capHeight:joined?32:8),visualAcceptance:'not-assessed',
      ...(curved?{surfaceOriginInBodyPixels:terrain.report.surfaceOriginInBodyPixels}:{}),
      ...(measured?{surfaceMappingSha256:composition.surfaceMapping.sha256,capDepth:terrain.report.capDepth,capUvEnd:terrain.report.capUvEnd}:{})},
    files:{catalog:ref('catalog.json'),rules:ref('rules.json'),presets:ref('presets.json'),maps:{default:ref('maps/default.scene.json'),inspection:ref('maps/inspection.scene.json')}}};
  if(needsCompleteTerrain(terrainIntent)){
    files.set('evidence/terrain-intent.json',jsonBytes(seal({format:'ai_scene_terrain_intent_binding_v2',terrainIntent,terrainRendering,materialPlanSha256:material.plan.sha256,stage:'base-material-only',perimeterComplete:false,generationCalls:0,visualAcceptance:'not-assessed'})));
  }else if(terrainIntent){
    kit.terrainSharedField=createIntentTerrainProfile(terrainIntent,terrainRendering,kit.terrainAppearance);
    files.set('evidence/terrain-intent.json',jsonBytes(seal({format:'ai_scene_terrain_intent_binding_v1',terrainIntent,terrainRendering,materialPlanSha256:material.plan.sha256,profileSha256:kit.terrainSharedField.sha256,legacyTileFallback:false,generationCalls:0,visualAcceptance:'not-assessed'})));
  }
  for(const doc of [kit,catalog,rules,library,map,inspection])contract(doc);
  const model=createSceneSemantics({kit,catalog,rules,library,artifacts:{presets:'presets.json'}});model.analyzeMap(map,{role:'default',allowEmpty:false});model.analyzeMap(inspection,{role:'inspection',allowEmpty:false});
  files.set('kit/kit.json',jsonBytes(kit));files.set('source/reference-native.png',reference.raw);files.set('evidence/reference-target.json',jsonBytes(target));
  files.set('evidence/policy.json',jsonBytes(COHERENT_POLICY));files.set('evidence/source-batch.json',jsonBytes(batch));
  if(checkedRelations)files.set('evidence/band-relations-reviews.json',jsonBytes(checkedRelations));
  if(checkedGuides)files.set('evidence/band-guide-reviews.json',jsonBytes(checkedGuides));
  if(composition)files.set('evidence/composition-profile.json',jsonBytes(composition));
  const report=seal({format:'ai_scene_coherent_candidate_v1',candidateId,batchSha256:batch.sha256,targetSha256:target.sha256,policySha256:COHERENT_POLICY.sha256,
    sourceEvidence,moduleCount:modules.length,terrainRoles:47,phases:32,layerCount:layers.length,layout:curved?'reviewed-surfaces-exact-span-and-declared-contacts-v1':'reviewed-actual-envelopes-and-surfaces-grid-snap',
    approximatePlacement:true,platformAdjustments,pixelIdentityRequired:false,referenceFallbackPixels:0,allSourcesFromSameReference:true,artAcceptance:'not-assessed',walkability:'not-assessed',
    repeatSeams:'not-certified',productionKit:false,generationCalls:0,
    ...(checkedRelations?{bandRelationsReviewsSha256:digest(checkedRelations),bandRelationsObservationAccuracy:'not-verified'}:{}),
    ...(checkedGuides?{bandGuideReviewsSha256:digest(checkedGuides),bandGuideObservationAccuracy:'not-verified'}:{}),
    ...(curved?{terrainLayoutSha256:surfaceLayout?.report.sha256??digest(authoredTerrain),terrainMaterialProfileSha256:measured?MEASURED_FIELD_SHA256:JOINED_FIELD_SHA256,
      grounding:'declared-bottom-center-convention-not-semantic-detection',contactCount:contacts.size,wholeSceneReview:'pending'}:{}),
    ...(measured?{surfaceMappingSha256:composition.surfaceMapping.sha256,surfaceMeasurements:'explicit-human-approximate-not-pixel-reconstruction',referencePixelsCopied:0}:{}),
    ...(sources.some(s=>s.preparation)?{sourcePreparations:{count:sources.filter(s=>s.preparation).length,maximumNewImageCalls:0,
      ...(sources.some(s=>['ai_scene_coherent_canvas_gutter_preparation_v1','ai_scene_coherent_canvas_gutter_preparation_v2'].includes(s.plan.format))?{originalPngsAndResultsPreserved:true}:{originalPngsAndFailuresPreserved:true}),hiddenGeometryRestored:false}}:{}),
    ...(composition?{compositionSha256:composition.sha256,displayTransform:'explicit-authoring-data-v1',derivedSourcePixelsChanged:sampled,
      ...(sampled?{sourceSampling:COHERENT_SAMPLING}:{} )}:{})});
  files.set('readiness.json',jsonBytes(report));
  const bundle=seal({format:'ai_scene_coherent_candidate_bundle_v1',reportSha256:report.sha256,batchSha256:batch.sha256,
    artifacts:[...files].map(([path,bytes])=>({path,sha256:hash(bytes),byteLength:bytes.length})),productionKit:false,generationCalls:0});
  files.set('proof-bundle.json',jsonBytes(bundle));return {files,report,bundle};
}
