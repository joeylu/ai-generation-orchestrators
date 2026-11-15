// Independently editable bridge and full-native-frame valley band, composed
// only from an already verified candidate and a verified terrain baseline.
import {mkdirSync,readdirSync,lstatSync,writeFileSync} from 'node:fs';
import {join,dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {canonicalJson,clone} from './document.mjs';
import {isWithin,makeFreshDirectory,parseJson,readSelectedFile,writeFreshFile} from './files.mjs';
import {check,exact,hash,id,isDigest,jsonBytes,seal,unseal,receipt} from './generation/common.mjs';
import * as flow from './generation/index.mjs';
import {verifyVerifiedSkyVariant} from './verified-sky-variant.mjs';
import {checkMidgroundCamera,checkMidgroundMaterial} from './verified-midground-variant.mjs';
import {validateBackgroundBandPlacement} from './background-band-placement.mjs';
import {loadSceneKit,contextFor,readMap} from './kit.mjs';
import {compileMap} from './compile.mjs';
import {exportScene,exportSceneArchive,openSceneExport} from './persistence.mjs';
const root=fileURLToPath(new URL('../',import.meta.url)),same=(a,b)=>canonicalJson(a)===canonicalJson(b),read=p=>parseJson(readSelectedFile(p));
const removed=['rear.facilities.actual'], addedLayer='rear.bridge-band';

// Strict map transformation is independently testable without media or host.
export function replaceBridgeBandInstances(map,bridge,band,layer){
  const doc=clone(map);check(Array.isArray(doc.instances)&&removed.every(id=>doc.instances.filter(x=>x.instanceId===id).length===1)
    &&doc.instances.some(x=>x.instanceId==='rear.actual'&&x.assetId==='scene.rear.actual')
    &&doc.instances.some(x=>x.instanceId==='rear.facilities.actual'&&x.assetId==='scene.rear.facilities.actual')
    &&layer?.layerId===addedLayer&&Array.isArray(doc.layers)&&!doc.layers.some(x=>x.layerId===addedLayer||x.zIndex===layer.zIndex)
    &&bridge&&band&&bridge.layerId===addedLayer&&band.layerId===addedLayer&&bridge.instanceId!==band.instanceId&&!removed.includes(bridge.instanceId)&&!removed.includes(band.instanceId)
    &&![bridge,band].some(n=>doc.instances.some(x=>x.instanceId===n.instanceId)),'BRIDGE_BAND_MAP');
  doc.layers.push(clone(layer));doc.instances=doc.instances.filter(x=>!removed.includes(x.instanceId));doc.instances.push(clone(bridge),clone(band));
  if(doc.instanceTransforms)doc.instanceTransforms=doc.instanceTransforms.filter(x=>!removed.includes(x.instanceId));return doc;
}
export function checkBridgeBandDrawOrder(compiled,bridgeId,bandId){
  const back=compiled.layers.find(l=>l.nodes.some(n=>n.nodeId==='visual/rear.actual'));
  const layer=compiled.layers.find(l=>l.nodes.some(n=>n.nodeId==='visual/'+bridgeId));
  check(back&&layer&&back.layerId!==layer.layerId&&back.zIndex<layer.zIndex&&same(back.parallax,layer.parallax),'BRIDGE_BAND_LAYER');
  const nodes=layer.nodes,bridge=nodes.findIndex(n=>n.nodeId==='visual/'+bridgeId),band=nodes.findIndex(n=>n.nodeId==='visual/'+bandId);
  check(bridge>=0&&band>bridge,'BRIDGE_BAND_ORDER');
}
export function checkUnchangedRear(before,after){const node=s=>s.layers.flatMap(l=>l.nodes).find(n=>n.nodeId==='visual/rear.actual');
  check(node(before)&&same(node(before),node(after)),'BRIDGE_BAND_REAR_CHANGED');}
function prepare(o){
  exact(o,['skyOptions','skyDecision','candidate','sourcePlans','output']);exact(o.sourcePlans,['bridge','band']);
  const c=o.candidate;exact(c,['workflow','batchSha256','candidateId','root','composition','expectedBundleSha256']);
  check([o.sourcePlans.bridge,o.sourcePlans.band,c.expectedBundleSha256].every(isDigest)&&o.sourcePlans.bridge!==o.sourcePlans.band,'BRIDGE_BAND_DIGEST');
  const f=o.skyOptions.foregroundOptions;for(const p of [o.skyOptions.output,o.skyOptions.targetWorkflow,o.skyOptions.sourceWorkflow,f.baselineKitRoot,f.baselineAncestorRoot,f.candidate.root,f.candidate.workflow,c.workflow,c.root])
    check(!isWithin(resolve(p),resolve(o.output))&&!isWithin(resolve(o.output),resolve(p)),'OUTPUT_OVERLAP');
  const prior=verifyVerifiedSkyVariant(o.skyOptions,o.skyDecision),baseline=loadSceneKit(join(o.skyOptions.output,'kit')),base=contextFor(baseline);
  check(prior.kitSha256===baseline.bundleSha256,'BRIDGE_BAND_BASELINE');
  const verified=flow.verifyCoherentCandidate(c.workflow,c.batchSha256,c.candidateId,c.root,c.composition);
  check(verified.bundleSha256===c.expectedBundleSha256,'BRIDGE_BAND_DONOR');
  const donor=loadSceneKit(join(c.root,'kit')),dc=contextFor(donor),report=read(join(c.root,'readiness.json'));unseal(report);
  const target=read(join(c.root,'evidence/reference-target.json')),sky=flow.exportCoherentRebindEvidence(o.skyOptions.sourceWorkflow,o.skyOptions.sourcePlanSha256);
  check(hash(readSelectedFile(join(c.root,'source/reference-native.png'),16777216))===sky.evidence.source.referenceRawSha256
    &&same(dc.kit.grid,base.kit.grid)&&same(dc.kit.pixelsPerUnit,base.kit.pixelsPerUnit),'BRIDGE_BAND_REFERENCE');
  const materials=report.sourceEvidence.filter(x=>x.role==='material');check(materials.length===1,'BRIDGE_BAND_MATERIAL');id(materials[0].assetId);
  checkMidgroundMaterial(base.kit,dc.kit,report.sourceEvidence,readSelectedFile(join(c.root,'source',materials[0].assetId+'.png'),16777216));
  const additions=[];
  for(const [key,sha] of [['bridge',o.sourcePlans.bridge],['band',o.sourcePlans.band]]){
    const plan=flow.getGenerationPlan(c.workflow,sha),result=flow.getGenerationResult(c.workflow,sha),asset=plan.recipe.assetId;id(asset);
    check((key==='bridge'?['landmark','scenery'].includes(plan.instanceBinding.role):plan.instanceBinding.role==='valley')
      &&['ai_scene_generation_plan_v27','ai_scene_coherent_rebind_v1'].includes(plan.format)&&result.status==='accepted'&&result.result.technical.status==='pass'
      &&report.batchSha256===c.batchSha256&&report.sourceEvidence.some(x=>x.assetId===asset&&x.planSha256===sha&&x.rawSha256===hash(result.bytes)),'BRIDGE_BAND_SOURCE');
    const evidence=plan.format==='ai_scene_coherent_rebind_v1'?plan.sourceEvidence:flow.exportCoherentRebindEvidence(c.workflow,sha).evidence;
    unseal(evidence);check(evidence.source.assetId===asset&&evidence.source.role===plan.instanceBinding.role&&evidence.source.referenceRawSha256===sky.evidence.source.referenceRawSha256&&evidence.source.styleContentSha256===sky.evidence.source.styleContentSha256
      &&evidence.rawSha256===hash(result.bytes),'BRIDGE_BAND_REFERENCE');
    const raw=readSelectedFile(join(c.root,'source',asset+'.png'),16777216);check(raw.equals(result.bytes),'BRIDGE_BAND_SOURCE');
    const moduleId='scene.'+asset,mod=dc.modules.get(moduleId),instances=dc.maps.default.instances.filter(x=>x.instanceId===asset&&x.assetId===moduleId);
    check(mod?.kind==='environment'&&mod.repeatAxis==='none'&&mod.renderStyle?.tint===0xffffff&&mod.renderStyle?.opacity===1&&instances.length===1
      &&!base.modules.has(moduleId)&&!base.files.has(mod.source.path),'BRIDGE_BAND_MODULE');
    const instance=instances[0],layer=dc.maps.default.layers.find(l=>l.layerId===instance.layerId),baseLayer=base.maps.default.layers.find(l=>l.layerId===instance.layerId),display=dc.files.get(mod.source.path);
    check(layer&&baseLayer&&same(layer.parallax,baseLayer.parallax)&&display&&hash(display)===mod.source.sha256,'BRIDGE_BAND_LAYER');
    let placement=null;if(key==='band'){placement=c.composition?.bandPlacements?.find(x=>x.instanceId===asset);check(placement,'BRIDGE_BAND_PLACEMENT');
      validateBackgroundBandPlacement(placement,{plan,raw,target});checkMidgroundCamera(base.maps.default.defaultCamera,plan.sourceScope.definition.backgroundBand.camera);
      check(same(layer.parallax,plan.sourceScope.definition.backgroundBand.parallax),'BRIDGE_BAND_LAYER');}
    additions.push({key,asset,plan,raw,evidence,mod,instance,display,layer,placement});
  }
  check(additions[0].instance.layerId===additions[1].instance.layerId&&hash(additions[0].raw)!==hash(additions[1].raw),'BRIDGE_BAND_LAYER');
  const rear=base.maps.default.layers.find(l=>l.layerId===additions[0].instance.layerId),nextZ=Math.min(...base.maps.default.layers.filter(l=>l.zIndex>rear.zIndex).map(l=>l.zIndex));
  const zIndex=Number.isFinite(nextZ)?Math.floor((rear.zIndex+nextZ)/2):rear.zIndex+1;
  check(zIndex>rear.zIndex&&zIndex<nextZ&&!base.maps.default.layers.some(l=>l.layerId===addedLayer||l.zIndex===zIndex),'BRIDGE_BAND_LAYER');
  const newLayer={...clone(rear),layerId:addedLayer,zIndex};
  for(const item of additions){item.mod=clone(item.mod);item.mod.preferredLayerId=addedLayer;item.instance={...clone(item.instance),layerId:addedLayer};}
  const proposal=seal({format:'ai_scene_verified_bridge_band_proposal_v1',baselineKitSha256:baseline.bundleSha256,skyReportSha256:prior.reportSha256,
    donorBundleSha256:verified.bundleSha256,referenceRawSha256:sky.evidence.source.referenceRawSha256,
    additions:additions.map(x=>({assetId:x.asset,planSha256:x.plan.sha256,rawSha256:hash(x.raw),displaySha256:hash(x.display),instance:clone(x.instance),placement:x.placement})),
    removedInstances:removed,addedLayer:newLayer,generationCalls:0,contactAndArt:'not-assessed',finalHumanArtReview:'pending'});
  return {o,base,baseline,prior,additions,newLayer,proposal,before:compileMap(baseline,readMap(baseline))};
}
export function previewVerifiedBridgeBandVariant(options){return prepare(options).proposal;}
function decide(d,p){exact(d,['proposal','receipt']);unseal(d.proposal);check(same(d.proposal,p),'BRIDGE_BAND_PROPOSAL');receipt(d.receipt,'review');check(d.receipt.decision==='accept'&&d.receipt.targetSha256===p.sha256,'BRIDGE_BAND_REVIEW');}
function buildData(d){const files=new Map([...d.base.files].map(([p,b])=>['kit/'+p,Buffer.from(b)])),kit=clone(d.base.kit),catalog=clone(d.base.catalog);
  kit.revision='bridge-band-'+hash(jsonBytes(d.proposal)).slice(0,20);const kitRef={kitId:kit.kitId,revision:kit.revision};
  for(const a of d.additions){catalog.modules.push(clone(a.mod));files.set('kit/'+a.mod.source.path,Buffer.from(a.display));files.set('source/'+a.key+'-original.png',Buffer.from(a.raw));files.set('evidence/'+a.key+'-source.json',jsonBytes(a.evidence));}
  const docs=new Map([[kit.files.catalog.path,catalog],[kit.files.rules.path,clone(d.base.rules)],[kit.files.presets.path,clone(d.base.library)]]);
  for(const [role,r]of Object.entries(kit.files.maps)){const doc=role==='default'?replaceBridgeBandInstances(d.base.maps[role],d.additions.find(x=>x.key==='bridge').instance,d.additions.find(x=>x.key==='band').instance,d.newLayer):clone(d.base.maps[role]);
    if(role!=='default'){check(!doc.layers.some(l=>l.layerId===d.newLayer.layerId||l.zIndex===d.newLayer.zIndex),'BRIDGE_BAND_LAYER');doc.layers.push(clone(d.newLayer));}docs.set(r.path,doc);}
  for(const [path,doc]of docs){doc.kitRef=kitRef;files.set('kit/'+path,jsonBytes(doc));}for(const [kind,r]of Object.entries(kit.files))for(const entry of kind==='maps'?Object.values(r):[r])entry.sha256=hash(files.get('kit/'+entry.path));
  files.set('kit/kit.json',jsonBytes(kit));files.set('evidence/proposal.json',jsonBytes(d.proposal));return files;
}
function reportFor(d,h,scene,zip,decision){for(const k of ['collisionSuggestions','standingSurfaces','boundarySegments','gridTerrains','curveTerrains','mixedTerrains','terrainUnionMaterial','terrainEdgePlacement','terrainBottomEdgePlacement'])check(same(d.before[k]??null,scene[k]??null),'BRIDGE_BAND_TERRAIN_CHANGED');
  checkUnchangedRear(d.before,scene);
  const now=contextFor(h);check(same(now.kit.terrainAppearance,d.base.kit.terrainAppearance)&&same(now.kit.terrainEdges,d.base.kit.terrainEdges)&&same(now.kit.terrainBottomEdges,d.base.kit.terrainBottomEdges),'BRIDGE_BAND_TERRAIN_CHANGED');
  for(const m of d.base.catalog.modules)check(same(now.modules.get(m.assetId),m)&&now.files.get(m.source.path)?.equals(d.base.files.get(m.source.path)),'BRIDGE_BAND_UNRELATED_SOURCE');
  checkBridgeBandDrawOrder(scene,d.additions.find(x=>x.key==='bridge').asset,d.additions.find(x=>x.key==='band').asset);
  return seal({format:'ai_scene_verified_bridge_band_variant_v1',proposalSha256:d.proposal.sha256,reviewReceiptSha256:hash(jsonBytes(decision.receipt)),baselineKitSha256:d.baseline.bundleSha256,kitSha256:h.bundleSha256,compiledSha256:scene.contentSha256,
    additions:d.proposal.additions,generationCalls:0,contactAndArt:'not-assessed',finalHumanArtReview:'pending',productionKit:false,zip:{sha256:hash(zip),byteLength:zip.length}});}
function inventory(files,out,report,zip){const all=new Map(files);all.set('variant.json',jsonBytes(report));all.set('scene-kit.zip',zip);const manifest=readSelectedFile(join(out,'export/manifest.json'));all.set('export/manifest.json',manifest);
  for(const item of parseJson(manifest).files)all.set('export/'+item.path,readSelectedFile(join(out,'export',...item.path.split('/')),67108864));return seal({format:'ai_scene_bridge_band_inventory_v1',reportSha256:report.sha256,artifacts:[...all].map(([path,b])=>({path,sha256:hash(b),byteLength:b.length}))});}
function checkInventory(out,m){const expected=new Set(m.artifacts.map(x=>x.path).concat('variant-manifest.json')),names=[];function walk(dir,prefix=''){for(const e of readdirSync(dir,{withFileTypes:true})){const p=prefix+e.name;check(!lstatSync(join(dir,e.name)).isSymbolicLink(),'BRIDGE_BAND_INVENTORY');if(e.isDirectory()){check([...expected].some(x=>x.startsWith(p+'/')),'BRIDGE_BAND_INVENTORY');walk(join(dir,e.name),p+'/');}else{check(e.isFile()&&expected.has(p),'BRIDGE_BAND_INVENTORY');names.push(p);}}}walk(out);check(names.length===expected.size,'BRIDGE_BAND_INVENTORY');}
export function buildVerifiedBridgeBandVariant(options,decision){const d=prepare(options);decide(decision,d.proposal);const files=buildData(d),out=makeFreshDirectory(options.output,root);
  for(const [p,b]of files){const f=join(out,p);mkdirSync(dirname(f),{recursive:true});writeFileSync(f,b,{flag:'wx'});}const h=loadSceneKit(join(out,'kit')),scene=compileMap(h,readMap(h)),zip=exportSceneArchive(h,readMap(h));exportScene(h,readMap(h),join(out,'export'));openSceneExport(join(out,'export'));
  writeFreshFile(join(out,'scene-kit.zip'),zip,root);const report=reportFor(d,h,scene,zip,decision);writeFreshFile(join(out,'variant.json'),jsonBytes(report),root);writeFreshFile(join(out,'variant-manifest.json'),jsonBytes(inventory(files,out,report,zip)),root);return report;}
export function verifyVerifiedBridgeBandVariant(options,decision){const d=prepare(options);decide(decision,d.proposal);const files=buildData(d),out=options.output,h=loadSceneKit(join(out,'kit')),ctx=contextFor(h);
  check(ctx.files.size===[...files.keys()].filter(p=>p.startsWith('kit/')).length&&[...ctx.files].every(([p,b])=>files.get('kit/'+p)?.equals(b)),'BRIDGE_BAND_REPLAY');
  for(const [p,b]of files)check(readSelectedFile(join(out,p),16777216).equals(b),'BRIDGE_BAND_REPLAY');const scene=compileMap(h,readMap(h)),reopened=openSceneExport(join(out,'export')),zip=exportSceneArchive(h,readMap(h));
  check(reopened.handle.bundleSha256===h.bundleSha256&&reopened.compiled.contentSha256===scene.contentSha256&&readSelectedFile(join(out,'scene-kit.zip'),268435456).equals(zip),'BRIDGE_BAND_EXPORT');
  const report=read(join(out,'variant.json'));unseal(report);check(same(report,reportFor(d,h,scene,zip,decision)),'BRIDGE_BAND_REPORT');const m=read(join(out,'variant-manifest.json'));unseal(m);check(same(m,inventory(files,out,report,zip)),'BRIDGE_BAND_INVENTORY');checkInventory(out,m);
  return {status:'verified',reportSha256:report.sha256,kitSha256:h.bundleSha256,generationCalls:0,finalHumanArtReview:'pending'};}
