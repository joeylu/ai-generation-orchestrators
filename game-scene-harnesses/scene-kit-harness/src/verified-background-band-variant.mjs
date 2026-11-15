import {mkdirSync,readdirSync,lstatSync,writeFileSync} from 'node:fs';
import {join,dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {canonicalJson,clone} from './document.mjs';
import {portableReader,isWithin,makeFreshDirectory,parseJson,readSelectedFile,writeFreshFile} from './files.mjs';
import {check,exact,hash,isDigest,jsonBytes,seal,unseal} from './generation/common.mjs';
import * as flow from './generation/index.mjs';
import {loadSceneKit,contextFor,readMap} from './kit.mjs';
import {compileMap} from './compile.mjs';
import {exportScene,exportSceneArchive,openSceneExport} from './persistence.mjs';
import {validateBackgroundBandPlacement} from './background-band-placement.mjs';

const sourceRoot=fileURLToPath(new URL('../',import.meta.url));
const scope='retained-validated-terrain-snapshot-with-checked-band-replacements';
const same=(a,b)=>canonicalJson(a)===canonicalJson(b);
const readJson=path=>parseJson(readSelectedFile(path));
const withoutRef=value=>{const v=clone(value);delete v.kitRef;return v;};

// A sealed inventory is checked as data, never executed. The baseline remains
// a validated asset snapshot; this does not replay or rebind its generation.
function frozenBundle(root){
  const reader=portableReader(root),bundle=parseJson(reader.read('proof-bundle.json'));unseal(bundle);
  check(Array.isArray(bundle.artifacts)&&bundle.artifacts.length>0&&bundle.artifacts.length<=16384,'BAND_VARIANT_ANCESTOR');
  const files=new Map();let total=0;
  for(const entry of bundle.artifacts){
    exact(entry,['path','sha256','byteLength']);
    check(entry.path!=='proof-bundle.json'&&!files.has(entry.path)&&isDigest(entry.sha256)
      &&Number.isSafeInteger(entry.byteLength)&&entry.byteLength>=0,'BAND_VARIANT_ANCESTOR');
    total+=entry.byteLength;check(total<=268435456,'BAND_VARIANT_ANCESTOR_BUDGET');
    const bytes=reader.read(entry.path,16777216);
    check(bytes.length===entry.byteLength&&hash(bytes)===entry.sha256,'BAND_VARIANT_ANCESTOR_BYTES');files.set(entry.path,bytes);
  }
  const names=[];
  function walk(folder,prefix=''){
    for(const entry of readdirSync(folder,{withFileTypes:true})){
      check(names.length<16385&&!lstatSync(join(folder,entry.name)).isSymbolicLink(),'BAND_VARIANT_ANCESTOR_PATH');
      const name=prefix+entry.name;
      if(entry.isDirectory()){check([...files.keys()].some(p=>p.startsWith(name+'/')),'BAND_VARIANT_ANCESTOR_INVENTORY');walk(join(folder,entry.name),name+'/');}
      else{check(entry.isFile(),'BAND_VARIANT_ANCESTOR_PATH');names.push(name);}
    }
  }
  walk(reader.root);check(names.length===files.size+1&&names.every(p=>p==='proof-bundle.json'||files.has(p)),'BAND_VARIANT_ANCESTOR_INVENTORY');
  files.set('proof-bundle.json',reader.read('proof-bundle.json'));return {bundle,files};
}

function prepare(options){
  exact(options,['baselineKitRoot','expectedBaselineKitSha256','baselineAncestorRoot','expectedBaselineAncestorBundleSha256','candidate','assetIds','output']);
  const c=options.candidate;
  exact(c,['workflow','batchSha256','candidateId','root','composition','expectedBundleSha256']);
  check(isDigest(options.expectedBaselineKitSha256)&&isDigest(options.expectedBaselineAncestorBundleSha256)
    &&isDigest(c.expectedBundleSha256),'BAND_VARIANT_DIGEST');
  check(Array.isArray(options.assetIds)&&options.assetIds.length===2&&new Set(options.assetIds).size===2,'BAND_VARIANT_ASSETS');
  const assetIds=[...options.assetIds].sort();
  for(const input of [options.baselineKitRoot,options.baselineAncestorRoot,c.root,c.workflow])
    check(!isWithin(resolve(input),resolve(options.output))&&!isWithin(resolve(options.output),resolve(input)),'OUTPUT_OVERLAP');
  const baseline=loadSceneKit(options.baselineKitRoot),base=contextFor(baseline);
  check(baseline.bundleSha256===options.expectedBaselineKitSha256,'BAND_VARIANT_BASELINE_SHA');
  check(base.kit.format==='ai_scene_kit_v4'&&base.kit.terrainEdges?.format==='ai_scene_terrain_edges_v6'
    &&base.kit.terrainBottomEdges,'BAND_VARIANT_COMPLETE_TERRAIN');
  // loadSceneKit validates both author maps. Like the existing delivery/export
  // helpers, this bounded variant compiles and exports the default author map;
  // it does not certify that every diagnostic inspection brush fits a budget.
  const before=compileMap(baseline,readMap(baseline));
  const ancestor=frozenBundle(options.baselineAncestorRoot),ancestorReport=parseJson(ancestor.files.get('readiness.json'));
  check(ancestor.bundle.sha256===options.expectedBaselineAncestorBundleSha256,'BAND_VARIANT_ANCESTOR_SHA');
  unseal(ancestorReport);
  check(ancestor.bundle.format==='ai_scene_terrain_edge_candidate_bundle_v1'
    &&ancestor.bundle.reportSha256===ancestorReport.sha256&&ancestorReport.format==='ai_scene_terrain_edge_candidate_v1'
    &&ancestorReport.kitSha256===baseline.bundleSha256,'BAND_VARIANT_ANCESTOR');
  check([...base.files].every(([p,b])=>ancestor.files.get('kit/'+p)?.equals(b)),'BAND_VARIANT_ANCESTOR_BYTES');
  const edgeBatch=parseJson(ancestor.files.get('evidence/edge-batch.json'));
  unseal(edgeBatch);
  check(edgeBatch.sha256===ancestorReport.edgeBatchSha256&&edgeBatch.baseBatchSha256===ancestorReport.baseBatchSha256
    &&same(flow.getTerrainEdgeSourceBatch(c.workflow,edgeBatch.sha256),edgeBatch),'BAND_VARIANT_ANCESTOR');
  const verified=flow.verifyCoherentCandidate(c.workflow,c.batchSha256,c.candidateId,c.root,c.composition);
  check(verified.bundleSha256===c.expectedBundleSha256,'BAND_VARIANT_CANDIDATE_SHA');
  const incoming=loadSceneKit(join(c.root,'kit')),next=contextFor(incoming),bundle=readJson(join(c.root,'proof-bundle.json'));
  unseal(bundle);check(bundle.sha256===verified.bundleSha256,'BAND_VARIANT_CANDIDATE_SHA');
  const report=readJson(join(c.root,'readiness.json'));unseal(report);
  const view=flow.readCoherentWorkflowView(c.workflow),oldBatch=view.batches.find(b=>b.sha256===edgeBatch.baseBatchSha256),newBatch=view.batches.find(b=>b.sha256===c.batchSha256);
  check(oldBatch&&newBatch&&newBatch.parentBatchSha256===oldBatch.sha256
    &&newBatch.referencePlanSha256===oldBatch.referencePlanSha256&&newBatch.targetSha256===oldBatch.targetSha256
    &&report.batchSha256===newBatch.sha256&&report.targetSha256===oldBatch.targetSha256,'BAND_VARIANT_SOURCE_LINEAGE');
  const plans=new Map(view.plans.map(p=>[p.sha256,p])),states=new Map(view.inspection.plans.map(p=>[p.planSha256,p]));
  const oldPlans=oldBatch.planSha256s.map(s=>plans.get(s)),newPlans=newBatch.planSha256s.map(s=>plans.get(s));
  check(oldPlans.every(Boolean)&&newPlans.every(Boolean)&&oldPlans.length===newPlans.length,'BAND_VARIANT_SOURCE_LINEAGE');
  const selected=new Set(assetIds),replacements=[];
  for(const oldPlan of oldPlans){
    const plan=newPlans.find(p=>p.recipe.assetId===oldPlan.recipe.assetId),assetId='scene.'+oldPlan.recipe.assetId;
    check(plan,'BAND_VARIANT_SOURCE_LINEAGE');
    if(!selected.has(assetId)){
      check(plan.sha256===oldPlan.sha256&&states.get(plan.sha256)?.rawSha256===states.get(oldPlan.sha256)?.rawSha256,'BAND_VARIANT_UNRELATED_SOURCE');continue;
    }
    check(plan.sha256!==oldPlan.sha256&&plan.recipe.parents?.length===1&&plan.recipe.parents[0]===oldPlan.sha256
      &&['backdrop','valley'].includes(plan.instanceBinding.role),'BAND_VARIANT_SOURCE_LINEAGE');
    const sourceEvidence=report.sourceEvidence.find(e=>e.assetId===plan.recipe.assetId),placement=c.composition?.bandPlacements?.find(p=>p.instanceId===plan.recipe.assetId),
      raw=readSelectedFile(join(c.root,'source',plan.recipe.assetId+'.png'),16777216),target=readJson(join(c.root,'evidence/reference-target.json'));
    check(sourceEvidence?.planSha256===plan.sha256&&sourceEvidence.rawSha256===hash(raw)&&placement,'BAND_VARIANT_BAND_EVIDENCE');
    const placementReport=validateBackgroundBandPlacement(placement,{plan,raw,target}),mod=next.modules.get(assetId),oldMod=base.modules.get(assetId),
      instance=next.maps.default.instances.find(i=>i.assetId===assetId&&i.instanceId===plan.recipe.assetId),
      oldInstance=base.maps.default.instances.find(i=>i.assetId===assetId&&i.instanceId===plan.recipe.assetId);
    check(mod&&oldMod&&instance&&oldInstance&&mod.kind==='environment'&&oldMod.kind==='environment'
      &&mod.repeatAxis==='none'&&oldMod.source.path===mod.source.path&&instance.layerId===oldInstance.layerId
      &&mod.renderStyle?.tint===0xffffff&&mod.renderStyle?.opacity===1
      &&base.maps.default.instances.filter(i=>i.assetId===assetId).length===1
      &&next.maps.default.instances.filter(i=>i.assetId===assetId).length===1
      &&!base.maps.inspection.instances.some(i=>i.assetId===assetId)
      &&!next.maps.inspection.instances.some(i=>i.assetId===assetId),'BAND_VARIANT_BAND_EVIDENCE');
    replacements.push({assetId,instanceId:plan.recipe.assetId,sourcePlanSha256:plan.sha256,sourceRawSha256:hash(raw),
      oldSourcePlanSha256:oldPlan.sha256,oldSourceRawSha256:states.get(oldPlan.sha256)?.rawSha256,
      backgroundBandSha256:placement.backgroundBandSha256,placement:clone(placement),placementReport,mod,instance,oldMod});
  }
  check(replacements.length===2&&newBatch.planSha256s.filter(s=>!oldBatch.planSha256s.includes(s)).length===2,'BAND_VARIANT_ASSETS');
  const material=newPlans.find(p=>p.instanceBinding.role==='material');
  check(material&&states.get(material.sha256)?.rawSha256===base.kit.terrainAppearance.sourceSha256
    &&report.surfaceMappingSha256===base.kit.terrainAppearance.surfaceMappingSha256
    &&hash(readSelectedFile(join(c.root,'source/reference-native.png'),16777216))===ancestorReport.referenceRawSha256,
    'BAND_VARIANT_MATERIAL_REFERENCE');
  check(next.kit.terrainAppearance.sourceSha256===base.kit.terrainAppearance.sourceSha256
    &&next.kit.terrainAppearance.surfaceMappingSha256===base.kit.terrainAppearance.surfaceMappingSha256
    &&same(next.kit.grid,base.kit.grid)&&same(next.kit.pixelsPerUnit,base.kit.pixelsPerUnit),'BAND_VARIANT_MATERIAL_REFERENCE');
  check(next.catalog.modules.length===base.catalog.modules.length&&next.catalog.modules.every(m=>selected.has(m.assetId)||same(m,base.modules.get(m.assetId))),'BAND_VARIANT_UNRELATED_MODULE');
  for(const mod of next.catalog.modules.filter(m=>!selected.has(m.assetId)))
    check(next.files.get(mod.source.path)?.equals(base.files.get(mod.source.path)),'BAND_VARIANT_UNRELATED_PNG');
  for(const role of ['default','inspection']){
    const old=withoutRef(base.maps[role]),donor=withoutRef(next.maps[role]);delete old.mapId;delete donor.mapId;
    // Coherent candidates derive their map seed from candidateId. The donor's
    // seed is never adopted: retain the baseline seed and all terrain phases.
    check(donor.seed===c.candidateId,'BAND_VARIANT_UNRELATED_AUTHOR');delete old.seed;delete donor.seed;
    old.instances=old.instances.filter(i=>!selected.has(i.assetId));donor.instances=donor.instances.filter(i=>!selected.has(i.assetId));
    check(same(old,donor),'BAND_VARIANT_UNRELATED_AUTHOR');
  }
  const files=new Map([...base.files].map(([p,b])=>['kit/'+p,Buffer.from(b)])),kit=clone(base.kit),catalog=clone(base.catalog);
  kit.revision='background-bands-'+hash(jsonBytes({baseline:baseline.bundleSha256,candidate:bundle.sha256,assetIds})).slice(0,20);
  const kitRef={kitId:kit.kitId,revision:kit.revision};
  for(const r of replacements){catalog.modules[catalog.modules.findIndex(m=>m.assetId===r.assetId)]=clone(r.mod);files.set('kit/'+r.mod.source.path,Buffer.from(next.files.get(r.mod.source.path)));}
  const documents=new Map([[kit.files.catalog.path,catalog],[kit.files.rules.path,clone(base.rules)],[kit.files.presets.path,clone(base.library)]]);
  for(const [role,ref]of Object.entries(kit.files.maps)){
    const doc=clone(base.maps[role]);if(role==='default')for(const r of replacements)doc.instances[doc.instances.findIndex(i=>i.instanceId===r.instanceId)]=clone(r.instance);
    documents.set(ref.path,doc);
  }
  for(const [path,doc]of documents){doc.kitRef=kitRef;files.set('kit/'+path,jsonBytes(doc));}
  for(const [kind,ref]of Object.entries(kit.files))for(const entry of kind==='maps'?Object.values(ref):[ref])entry.sha256=hash(files.get('kit/'+entry.path));
  files.set('kit/kit.json',jsonBytes(kit));
  const retainedPngs=[...base.files].filter(([p])=>p.endsWith('.png')&&!replacements.some(r=>r.mod.source.path===p)).map(([path,bytes])=>{
    check(files.get('kit/'+path)?.equals(bytes),'BAND_VARIANT_UNRELATED_PNG');return {path,sha256:hash(bytes),byteLength:bytes.length};
  });
  // Retain the overwritten display PNGs, their original raw evidence and both
  // sealed parent inventories outside the new runtime kit.
  for(const r of replacements){
    files.set('ancestor/previous-assets/'+r.oldMod.source.path,base.files.get(r.oldMod.source.path));
    const oldResult=flow.getGenerationResult(c.workflow,r.oldSourcePlanSha256);
    check(hash(oldResult.bytes)===r.oldSourceRawSha256,'BAND_VARIANT_SOURCE_LINEAGE');
    files.set('ancestor/source/'+r.instanceId+'.png',oldResult.bytes);
    files.set('ancestor/evidence/'+r.instanceId+'-plan.json',jsonBytes(plans.get(r.oldSourcePlanSha256)));
    files.set('ancestor/evidence/'+r.instanceId+'-result.json',jsonBytes(oldResult.result));
    for(const name of ['source/'+r.instanceId+'.png',...['plan','result','scope','placement'].map(s=>'evidence/'+r.instanceId+'-'+s+'.json')])
      files.set('replacement/'+name,readSelectedFile(join(c.root,...name.split('/')),16777216));
  }
  for(const [path,bytes]of [['ancestor/kit.json',base.files.get('kit.json')],['ancestor/proof-bundle.json',ancestor.files.get('proof-bundle.json')],
    ['ancestor/readiness.json',ancestor.files.get('readiness.json')],['ancestor/edge-batch.json',ancestor.files.get('evidence/edge-batch.json')],
    ['replacement/proof-bundle.json',jsonBytes(bundle)],['replacement/readiness.json',jsonBytes(report)],['replacement/composition-profile.json',jsonBytes(c.composition)]])files.set(path,bytes);
  return {files,baseline,before,base,kit,ancestor,donorBundle:bundle,replacements,retainedPngs};
}

function reportFor(data,handle,scene,zip){
  for(const key of ['collisionSuggestions','standingSurfaces','boundarySegments','gridTerrains','curveTerrains','mixedTerrains','terrainUnionMaterial','terrainEdgePlacement','terrainBottomEdgePlacement'])
    check(same(data.before[key]??null,scene[key]??null),'BAND_VARIANT_TERRAIN_CHANGED');
  return seal({format:'ai_scene_verified_background_band_variant_v1',scope,baselineKitSha256:data.baseline.bundleSha256,
    baselineCandidateBundleSha256:data.ancestor.bundle.sha256,candidateBundleSha256:data.donorBundle.sha256,kitSha256:handle.bundleSha256,
    compiledSha256:scene.contentSha256,replacements:data.replacements.map(({mod,instance,oldMod,...r})=>r),retainedPngs:data.retainedPngs,
    terrainSnapshotRebound:false,oldGenerationReplayed:false,oldAuthorTerrainChanged:false,collisionChanged:false,
    sourceArtAcceptance:'not-inherited',contentContinuity:'not-assessed',finalHumanArtReview:'pending',
    zip:{sha256:hash(zip),byteLength:zip.length},generationCalls:0,productionKit:false});
}

function inventory(data,out,report,zip){
  const files=new Map(data.files);files.set('variant.json',jsonBytes(report));files.set('scene-kit.zip',zip);
  const manifestBytes=readSelectedFile(join(out,'export/manifest.json')),manifest=parseJson(manifestBytes);
  files.set('export/manifest.json',manifestBytes);
  for(const item of manifest.files)files.set('export/'+item.path,readSelectedFile(join(out,'export',...item.path.split('/')),67108864));
  return seal({format:'ai_scene_background_band_variant_inventory_v1',reportSha256:report.sha256,generationCalls:0,
    artifacts:[...files].map(([path,bytes])=>({path,sha256:hash(bytes),byteLength:bytes.length}))});
}

function checkInventory(out,manifest){
  const expected=new Set(manifest.artifacts.map(e=>e.path).concat('variant-manifest.json')),names=[];
  function walk(folder,prefix=''){
    for(const entry of readdirSync(folder,{withFileTypes:true})){
      const path=prefix+entry.name;check(!lstatSync(join(folder,entry.name)).isSymbolicLink(),'BAND_VARIANT_OUTPUT_INVENTORY');
      if(entry.isDirectory()){check([...expected].some(n=>n.startsWith(path+'/')),'BAND_VARIANT_OUTPUT_INVENTORY');walk(join(folder,entry.name),path+'/');}
      else{check(entry.isFile()&&expected.has(path),'BAND_VARIANT_OUTPUT_INVENTORY');names.push(path);}
    }
  }
  walk(out);check(names.length===expected.size,'BAND_VARIANT_OUTPUT_INVENTORY');
}

export function buildVerifiedBackgroundBandVariant(options){
  const data=prepare(options),out=makeFreshDirectory(options.output,sourceRoot);
  for(const [path,bytes]of data.files){const target=join(out,path);mkdirSync(dirname(target),{recursive:true});writeFileSync(target,bytes,{flag:'wx'});}
  const handle=loadSceneKit(join(out,'kit')),scene=compileMap(handle,readMap(handle)),zip=exportSceneArchive(handle,readMap(handle));
  exportScene(handle,readMap(handle),join(out,'export'));openSceneExport(join(out,'export'));
  writeFreshFile(join(out,'scene-kit.zip'),zip,sourceRoot);
  const report=reportFor(data,handle,scene,zip);writeFreshFile(join(out,'variant.json'),jsonBytes(report),sourceRoot);
  writeFreshFile(join(out,'variant-manifest.json'),jsonBytes(inventory(data,out,report,zip)),sourceRoot);return report;
}

export function verifyVerifiedBackgroundBandVariant(options){
  const data=prepare(options),out=options.output,handle=loadSceneKit(join(out,'kit')),ctx=contextFor(handle);
  check(ctx.files.size===data.base.files.size&&[...ctx.files].every(([p,b])=>data.files.get('kit/'+p)?.equals(b)),'BAND_VARIANT_KIT_REPLAY');
  for(const [path,bytes]of data.files)check(readSelectedFile(join(out,path),16777216).equals(bytes),'BAND_VARIANT_FILE_REPLAY');
  const scene=compileMap(handle,readMap(handle)),reopened=openSceneExport(join(out,'export')),zip=exportSceneArchive(handle,readMap(handle));
  check(reopened.handle.bundleSha256===handle.bundleSha256&&reopened.compiled.contentSha256===scene.contentSha256
    &&readSelectedFile(join(out,'scene-kit.zip'),268435456).equals(zip),'BAND_VARIANT_EXPORT_REPLAY');
  const report=readJson(join(out,'variant.json'));unseal(report);check(same(report,reportFor(data,handle,scene,zip)),'BAND_VARIANT_REPORT_REPLAY');
  const manifest=readJson(join(out,'variant-manifest.json'));unseal(manifest);
  check(same(manifest,inventory(data,out,report,zip)),'BAND_VARIANT_OUTPUT_INVENTORY');checkInventory(out,manifest);
  return {status:'verified',reportSha256:report.sha256,kitSha256:handle.bundleSha256,scope,generationCalls:0,finalHumanArtReview:'pending'};
}
