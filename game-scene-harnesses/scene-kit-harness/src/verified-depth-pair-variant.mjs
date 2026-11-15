// Narrow two-band replacement for a previously verified sky/foreground variant.
// No image generation, source acceptance or human art acceptance happens here.
import {mkdirSync,readdirSync,lstatSync,writeFileSync} from 'node:fs';
import {join,dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {canonicalJson,clone} from './document.mjs';
import {isWithin,makeFreshDirectory,parseJson,readSelectedFile,writeFreshFile} from './files.mjs';
import {check,exact,hash,id,isDigest,jsonBytes,seal,unseal,receipt as checkReceipt} from './generation/common.mjs';
import {verifyVerifiedSkyVariant} from './verified-sky-variant.mjs';
import {validateBackgroundBandPlacement} from './background-band-placement.mjs';
import * as flow from './generation/index.mjs';
import {loadSceneKit,contextFor,readMap} from './kit.mjs';
import {compileMap} from './compile.mjs';
import {exportScene,exportSceneArchive,openSceneExport} from './persistence.mjs';

const sourceRoot=fileURLToPath(new URL('../',import.meta.url));
const same=(a,b)=>canonicalJson(a)===canonicalJson(b);
const readJson=p=>parseJson(readSelectedFile(p));
const rear='scene.rear.actual',facilities='scene.rear.facilities.actual';
import {checkMidgroundCamera,checkMidgroundOutputIsolation,checkMidgroundMaterial} from './verified-midground-variant.mjs';
export function checkDistinctDepthSources(far,mid){check(hash(far)!==hash(mid),'DEPTH_DUPLICATE_SOURCE');}
// Candidate verification must already have replayed the source workflow. This
// checks the per-band projection; seals alone are not provider attestations.
export function checkDepthBandEvidence({plan,result,report,evidence,sky,raw,batchSha256,asset,role}){
  unseal(plan);unseal(evidence);check(Array.isArray(report.sourceEvidence),'DEPTH_SOURCE');
  check(['ai_scene_generation_plan_v27','ai_scene_coherent_rebind_v1'].includes(plan.format)&&plan.recipe.assetId===asset&&plan.instanceBinding.role===role
    &&report.batchSha256===batchSha256&&report.sourceEvidence.some(x=>x.assetId===asset&&x.planSha256===plan.sha256&&x.rawSha256===hash(raw))
    &&result.technical.status==='pass'&&result.rawSha256===hash(raw)&&evidence.rawSha256===hash(raw)
    &&evidence.source.assetId===asset&&evidence.source.role===role
    &&evidence.source.referenceRawSha256===sky.source.referenceRawSha256&&evidence.source.styleContentSha256===sky.source.styleContentSha256,'DEPTH_SOURCE');
}

function prepare(o){
  exact(o,['skyOptions','skyDecision','candidate','sourcePlans','farZIndex','output']);exact(o.sourcePlans,['far','mid']);
  const c=o.candidate;exact(c,['workflow','batchSha256','candidateId','root','composition','expectedBundleSha256']);
  check(isDigest(o.sourcePlans.far)&&isDigest(o.sourcePlans.mid)&&o.sourcePlans.far!==o.sourcePlans.mid&&isDigest(c.expectedBundleSha256),'DEPTH_DIGEST');
  const f=o.skyOptions.foregroundOptions;
  checkMidgroundOutputIsolation(o.output,[o.skyOptions.output,o.skyOptions.targetWorkflow,o.skyOptions.sourceWorkflow,f.baselineKitRoot,f.baselineAncestorRoot,f.candidate.root,f.candidate.workflow,c.workflow,c.root]);
  const prior=verifyVerifiedSkyVariant(o.skyOptions,o.skyDecision),baseline=loadSceneKit(join(o.skyOptions.output,'kit')),
    base=contextFor(baseline);
  check(prior.kitSha256===baseline.bundleSha256,'MIDGROUND_BASELINE');
  const verified=flow.verifyCoherentCandidate(c.workflow,c.batchSha256,c.candidateId,c.root,c.composition);
  check(verified.bundleSha256===c.expectedBundleSha256,'MIDGROUND_DONOR');
  const donor=loadSceneKit(join(c.root,'kit')),next=contextFor(donor),report=readJson(join(c.root,'readiness.json'));unseal(report);
  const target=readJson(join(c.root,'evidence/reference-target.json')),
    sky=flow.exportCoherentRebindEvidence(o.skyOptions.sourceWorkflow,o.skyOptions.sourcePlanSha256);
  check(hash(readSelectedFile(join(c.root,'source/reference-native.png'),16777216))===sky.evidence.source.referenceRawSha256
    &&same(next.kit.grid,base.kit.grid)&&same(next.kit.pixelsPerUnit,base.kit.pixelsPerUnit),'MIDGROUND_REFERENCE');
  check(Array.isArray(report.sourceEvidence),'MIDGROUND_MATERIAL');const materials=report.sourceEvidence.filter(x=>x.role==='material');
  check(materials.length===1,'MIDGROUND_MATERIAL');id(materials[0].assetId);
  checkMidgroundMaterial(base.kit,next.kit,report.sourceEvidence,readSelectedFile(join(c.root,'source',materials[0].assetId+'.png'),16777216));
  const map=base.maps.default,old=base.modules.get(rear),other=base.modules.get(facilities),
    oldInstances=map.instances.filter(x=>x.assetId===rear),facilityInstances=map.instances.filter(x=>x.assetId===facilities),
    skyLayer=map.layers.find(x=>x.layerId==='sky'),rearLayer=map.layers.find(x=>x.layerId==='rear');
  check(old&&other&&old.kind==='environment'
    &&oldInstances.length===1&&oldInstances[0].instanceId==='rear.actual'&&oldInstances[0].layerId==='rear'&&facilityInstances.length===1
    &&facilityInstances[0].instanceId==='rear.facilities.actual'&&facilityInstances[0].layerId==='rear'
    &&Object.entries(base.maps).filter(([role])=>role!=='default').every(([,m])=>!m.instances.some(x=>[rear,facilities].includes(x.assetId))),'MIDGROUND_MODULE');
  check(skyLayer&&rearLayer&&Number.isSafeInteger(o.farZIndex)&&o.farZIndex>skyLayer.zIndex&&o.farZIndex<rearLayer.zIndex
    &&!map.layers.some(x=>x.zIndex===o.farZIndex||x.layerId==='far')&&!base.modules.has('scene.far.actual'),'DEPTH_LAYER');
  const bands=[];
  for(const [key,asset,role,layerId] of [['far','far.actual','backdrop','far'],['mid','rear.actual','valley','rear']]){
    const plan=flow.getGenerationPlan(c.workflow,o.sourcePlans[key]),result=flow.getGenerationResult(c.workflow,o.sourcePlans[key]),
      raw=readSelectedFile(join(c.root,'source',asset+'.png'),16777216),placement=c.composition?.bandPlacements?.find(x=>x.instanceId===asset),
      evidence=plan.format==='ai_scene_coherent_rebind_v1'?plan.sourceEvidence:flow.exportCoherentRebindEvidence(c.workflow,plan.sha256).evidence;
    checkDepthBandEvidence({plan,result:result.result,report,evidence,sky:sky.evidence,raw,batchSha256:c.batchSha256,asset,role});
    check(placement,'DEPTH_PLACEMENT');const placementReport=validateBackgroundBandPlacement(placement,{plan,raw,target});checkMidgroundCamera(map.defaultCamera,plan.sourceScope.definition.backgroundBand.camera);
    const moduleId='scene.'+asset,mod=next.modules.get(moduleId),instances=next.maps.default.instances.filter(i=>i.instanceId===asset&&i.assetId===moduleId),instance=instances[0],layer=next.maps.default.layers.find(l=>l.layerId===layerId);
    check(mod&&mod.kind==='environment'&&mod.repeatAxis==='none'&&mod.renderStyle.tint===0xffffff&&mod.renderStyle.opacity===1&&instances.length===1&&instance.layerId===layerId&&layer&&['environment',...(key==='far'?['background']:[])].includes(layer.kind)&&same(layer.parallax,plan.sourceScope.definition.backgroundBand.parallax),'DEPTH_MODULE');
    if(key==='mid')check(mod.source.path===old.source.path&&same(layer.parallax,rearLayer.parallax),'DEPTH_LAYER');
    else check(!base.files.has(mod.source.path),'DEPTH_SOURCE');
    const display=next.files.get(mod.source.path);check(display&&hash(display)===mod.source.sha256,'DEPTH_SOURCE');
    bands.push({key,asset,plan,raw,placement,placementReport,evidence,mod,instance,layer,display});
  }
  checkDistinctDepthSources(bands[0].raw,bands[1].raw);
  const proposal=seal({format:'ai_scene_verified_depth_pair_proposal_v1',baselineKitSha256:baseline.bundleSha256,skyReportSha256:prior.reportSha256,
    donorBundleSha256:verified.bundleSha256,referenceRawSha256:sky.evidence.source.referenceRawSha256,farZIndex:o.farZIndex,
    bands:bands.map(x=>({assetId:x.asset,planSha256:x.plan.sha256,rawSha256:hash(x.raw),displaySha256:hash(x.display),placement:clone(x.placement),placementReport:x.placementReport})),
    removedInstances:['rear.actual','rear.facilities.actual'],generationCalls:0,contentContinuity:'not-assessed',finalHumanArtReview:'pending'});
  return {o,c,base,baseline,prior,next,old,bands,proposal,before:compileMap(baseline,readMap(baseline))};
}
export function previewVerifiedDepthPairVariant(options){return prepare(options).proposal;}
function decisionFor(d,p){exact(d,['proposal','receipt']);unseal(d.proposal);check(same(d.proposal,p),'MIDGROUND_PROPOSAL');checkReceipt(d.receipt,'review');check(d.receipt.decision==='accept'&&d.receipt.targetSha256===p.sha256,'MIDGROUND_REVIEW');}
// Operates only on a caller-owned clone; map semantics are checked by the kit
// loader/compiler after the complete checked variant has been materialized.
export function replaceDepthPairInstances(input,instance,farInstance){const doc=clone(input);
  check(Array.isArray(doc.instances)&&doc.instances.filter(x=>x.instanceId==='rear.actual'&&x.assetId===rear).length===1
    &&doc.instances.filter(x=>x.instanceId==='rear.facilities.actual'&&x.assetId===facilities).length===1
    &&instance?.instanceId==='rear.actual'&&instance.assetId===rear&&farInstance?.instanceId==='far.actual'&&farInstance.assetId==='scene.far.actual'
    &&!doc.instances.some(x=>x.instanceId==='far.actual'||x.assetId==='scene.far.actual'),'MIDGROUND_MAP');
  const index=doc.instances.findIndex(x=>x.instanceId==='rear.actual');doc.instances[index]=clone(instance);
  doc.instances=doc.instances.filter(x=>x.instanceId!=='rear.facilities.actual');doc.instances.push(clone(farInstance));
  if(doc.instanceTransforms)doc.instanceTransforms=doc.instanceTransforms.filter(x=>!['rear.actual','rear.facilities.actual'].includes(x.instanceId));
  return doc;}
function buildData(d){const files=new Map([...d.base.files].map(([p,b])=>['kit/'+p,Buffer.from(b)])),kit=clone(d.base.kit),catalog=clone(d.base.catalog);
  kit.revision='depth-pair-'+hash(jsonBytes(d.proposal)).slice(0,20);const ref={kitId:kit.kitId,revision:kit.revision};
  const far=d.bands.find(x=>x.key==='far'),mid=d.bands.find(x=>x.key==='mid');
  catalog.modules[catalog.modules.findIndex(x=>x.assetId===rear)]=clone(mid.mod);catalog.modules.push(clone(far.mod));
  for(const b of d.bands)files.set('kit/'+b.mod.source.path,Buffer.from(b.display));
  const docs=new Map([[kit.files.catalog.path,catalog],[kit.files.rules.path,clone(d.base.rules)],[kit.files.presets.path,clone(d.base.library)]]);
  for(const [role,r] of Object.entries(kit.files.maps)){const doc=role==='default'?replaceDepthPairInstances(d.base.maps[role],mid.instance,far.instance):clone(d.base.maps[role]);
    check(!doc.layers.some(x=>x.layerId==='far'||x.zIndex===d.o.farZIndex),'DEPTH_LAYER');doc.layers.push({...clone(far.layer),zIndex:d.o.farZIndex});docs.set(r.path,doc);}
  for(const [path,doc]of docs){doc.kitRef=ref;files.set('kit/'+path,jsonBytes(doc));}
  for(const [kind,r]of Object.entries(kit.files))for(const entry of kind==='maps'?Object.values(r):[r])entry.sha256=hash(files.get('kit/'+entry.path));
  files.set('kit/kit.json',jsonBytes(kit));for(const b of d.bands){files.set('source/'+b.key+'-original.png',Buffer.from(b.raw));files.set('evidence/'+b.key+'-source.json',jsonBytes(b.evidence));}
  files.set('ancestor/previous-rear.png',Buffer.from(d.base.files.get(d.old.source.path)));files.set('ancestor/sky-variant.json',readSelectedFile(join(d.o.skyOptions.output,'variant.json')));
  return files;}
function reportFor(d,h,scene,zip,decision){const now=contextFor(h);for(const k of ['collisionSuggestions','standingSurfaces','boundarySegments','gridTerrains','curveTerrains','mixedTerrains','terrainUnionMaterial','terrainEdgePlacement','terrainBottomEdgePlacement'])check(same(d.before[k]??null,scene[k]??null),'MIDGROUND_TERRAIN_CHANGED');
  check(same(now.kit.terrainAppearance,d.base.kit.terrainAppearance)&&same(now.kit.terrainEdges,d.base.kit.terrainEdges)&&same(now.kit.terrainBottomEdges,d.base.kit.terrainBottomEdges),'MIDGROUND_TERRAIN_CHANGED');
  for(const m of d.base.catalog.modules)if(m.assetId!==rear)check(same(now.modules.get(m.assetId),m)&&now.files.get(m.source.path)?.equals(d.base.files.get(m.source.path)),'MIDGROUND_UNRELATED_SOURCE');
  return seal({format:'ai_scene_verified_depth_pair_variant_v1',proposalSha256:d.proposal.sha256,reviewReceiptSha256:hash(jsonBytes(decision.receipt)),baselineKitSha256:d.baseline.bundleSha256,kitSha256:h.bundleSha256,compiledSha256:scene.contentSha256,
    bands:d.proposal.bands,generationCalls:0,contentContinuity:'not-assessed',sourceArtAcceptance:'not-granted',finalHumanArtReview:'pending',productionKit:false,zip:{sha256:hash(zip),byteLength:zip.length}});}
function inventory(files,report,zip,out){const all=new Map(files);all.set('variant.json',jsonBytes(report));all.set('scene-kit.zip',zip);const manifest=readSelectedFile(join(out,'export/manifest.json'));all.set('export/manifest.json',manifest);
  for(const item of parseJson(manifest).files)all.set('export/'+item.path,readSelectedFile(join(out,'export',...item.path.split('/')),67108864));return seal({format:'ai_scene_depth_pair_variant_inventory_v1',reportSha256:report.sha256,artifacts:[...all].map(([path,b])=>({path,sha256:hash(b),byteLength:b.length}))});}
function checkInventory(out,m){const expected=new Set(m.artifacts.map(x=>x.path).concat('variant-manifest.json')),names=[];function walk(dir,prefix=''){for(const e of readdirSync(dir,{withFileTypes:true})){const p=prefix+e.name;check(!lstatSync(join(dir,e.name)).isSymbolicLink(),'MIDGROUND_INVENTORY');if(e.isDirectory()){check([...expected].some(x=>x.startsWith(p+'/')),'MIDGROUND_INVENTORY');walk(join(dir,e.name),p+'/');}else{check(e.isFile()&&expected.has(p),'MIDGROUND_INVENTORY');names.push(p);}}}walk(out);check(names.length===expected.size,'MIDGROUND_INVENTORY');}
export function buildVerifiedDepthPairVariant(options,decision){const d=prepare(options);decisionFor(decision,d.proposal);const files=buildData(d),out=makeFreshDirectory(options.output,sourceRoot);
  for(const [p,b]of files){const f=join(out,p);mkdirSync(dirname(f),{recursive:true});writeFileSync(f,b,{flag:'wx'});}const h=loadSceneKit(join(out,'kit')),scene=compileMap(h,readMap(h)),zip=exportSceneArchive(h,readMap(h));exportScene(h,readMap(h),join(out,'export'));openSceneExport(join(out,'export'));
  writeFreshFile(join(out,'scene-kit.zip'),zip,sourceRoot);const report=reportFor(d,h,scene,zip,decision);writeFreshFile(join(out,'variant.json'),jsonBytes(report),sourceRoot);writeFreshFile(join(out,'variant-manifest.json'),jsonBytes(inventory(files,report,zip,out)),sourceRoot);return report;}
export function verifyVerifiedDepthPairVariant(options,decision){const d=prepare(options);decisionFor(decision,d.proposal);const files=buildData(d),out=options.output,h=loadSceneKit(join(out,'kit')),ctx=contextFor(h);
  check(ctx.files.size===[...files.keys()].filter(p=>p.startsWith('kit/')).length&&[...ctx.files].every(([p,b])=>files.get('kit/'+p)?.equals(b)),'MIDGROUND_REPLAY');
  for(const [p,b]of files)check(readSelectedFile(join(out,p),16777216).equals(b),'MIDGROUND_REPLAY');const scene=compileMap(h,readMap(h)),reopened=openSceneExport(join(out,'export')),zip=exportSceneArchive(h,readMap(h));
  check(reopened.handle.bundleSha256===h.bundleSha256&&reopened.compiled.contentSha256===scene.contentSha256&&readSelectedFile(join(out,'scene-kit.zip'),268435456).equals(zip),'MIDGROUND_EXPORT');
  const report=readJson(join(out,'variant.json'));unseal(report);check(same(report,reportFor(d,h,scene,zip,decision)),'MIDGROUND_REPORT');const m=readJson(join(out,'variant-manifest.json'));unseal(m);check(same(m,inventory(files,report,zip,out)),'MIDGROUND_INVENTORY');checkInventory(out,m);
  return {status:'verified',reportSha256:report.sha256,kitSha256:h.bundleSha256,generationCalls:0,finalHumanArtReview:'pending'};}
