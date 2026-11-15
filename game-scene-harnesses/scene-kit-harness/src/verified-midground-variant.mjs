// Narrow one-band replacement for a previously verified sky/foreground variant.
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
export function checkMidgroundCamera(actual,planned){check(actual?.scale===1&&same(actual.center,planned?.referenceCenterWorld)
  &&same(actual.viewport,planned?.viewportWorld),'MIDGROUND_CAMERA');}
export function checkMidgroundOutputIsolation(output,inputs){check(Array.isArray(inputs)&&inputs.length>0,'MIDGROUND_INPUTS');for(const p of inputs)
  check(!isWithin(resolve(p),resolve(output))&&!isWithin(resolve(output),resolve(p)),'OUTPUT_OVERLAP');}
export function checkMidgroundMaterial(baseline,donor,evidence,materialBytes){
  const a=baseline?.terrainAppearance?.sourceSha256,b=donor?.terrainAppearance?.sourceSha256;
  check(isDigest(a)&&isDigest(b)&&Array.isArray(evidence),'MIDGROUND_MATERIAL');
  const rows=evidence.filter(x=>x?.role==='material');
  check(rows.length===1&&typeof rows[0].assetId==='string'&&isDigest(rows[0].rawSha256)
    &&a===b&&b===rows[0].rawSha256&&hash(materialBytes)===a,'MIDGROUND_MATERIAL');
}

function prepare(o){
  exact(o,['skyOptions','skyDecision','candidate','sourcePlanSha256','output']);
  const c=o.candidate;exact(c,['workflow','batchSha256','candidateId','root','composition','expectedBundleSha256']);
  check(isDigest(o.sourcePlanSha256)&&isDigest(c.expectedBundleSha256),'MIDGROUND_DIGEST');
  const f=o.skyOptions.foregroundOptions;
  checkMidgroundOutputIsolation(o.output,[o.skyOptions.output,o.skyOptions.targetWorkflow,o.skyOptions.sourceWorkflow,f.baselineKitRoot,f.baselineAncestorRoot,f.candidate.root,f.candidate.workflow,c.workflow,c.root]);
  const prior=verifyVerifiedSkyVariant(o.skyOptions,o.skyDecision),baseline=loadSceneKit(join(o.skyOptions.output,'kit')),
    base=contextFor(baseline);
  check(prior.kitSha256===baseline.bundleSha256,'MIDGROUND_BASELINE');
  const verified=flow.verifyCoherentCandidate(c.workflow,c.batchSha256,c.candidateId,c.root,c.composition);
  check(verified.bundleSha256===c.expectedBundleSha256,'MIDGROUND_DONOR');
  const donor=loadSceneKit(join(c.root,'kit')),next=contextFor(donor),report=readJson(join(c.root,'readiness.json'));unseal(report);
  const plan=flow.getGenerationPlan(c.workflow,o.sourcePlanSha256),result=flow.getGenerationResult(c.workflow,o.sourcePlanSha256),
    target=readJson(join(c.root,'evidence/reference-target.json')),raw=readSelectedFile(join(c.root,'source/rear.actual.png'),16777216),
    placement=c.composition?.bandPlacements?.find(x=>x.instanceId==='rear.actual'),
    source=flow.exportCoherentRebindEvidence(c.workflow,o.sourcePlanSha256),
    sky=flow.exportCoherentRebindEvidence(o.skyOptions.sourceWorkflow,o.skyOptions.sourcePlanSha256);
  check(plan.format==='ai_scene_generation_plan_v27'&&plan.recipe.assetId==='rear.actual'&&plan.instanceBinding.role==='valley'
    &&report.batchSha256===c.batchSha256&&report.sourceEvidence.some(x=>x.assetId==='rear.actual'&&x.planSha256===plan.sha256&&x.rawSha256===hash(raw))
    &&result.result.technical.status==='pass'&&result.result.rawSha256===hash(raw)&&source.evidence.rawSha256===hash(raw), 'MIDGROUND_SOURCE');
  check(source.evidence.source.referenceRawSha256===sky.evidence.source.referenceRawSha256
    &&source.evidence.source.styleContentSha256===sky.evidence.source.styleContentSha256
    &&hash(readSelectedFile(join(c.root,'source/reference-native.png'),16777216))===source.evidence.source.referenceRawSha256
    &&same(next.kit.grid,base.kit.grid)&&same(next.kit.pixelsPerUnit,base.kit.pixelsPerUnit),'MIDGROUND_REFERENCE');
  check(Array.isArray(report.sourceEvidence),'MIDGROUND_MATERIAL');const materials=report.sourceEvidence.filter(x=>x.role==='material');
  check(materials.length===1,'MIDGROUND_MATERIAL');id(materials[0].assetId);
  checkMidgroundMaterial(base.kit,next.kit,report.sourceEvidence,readSelectedFile(join(c.root,'source',materials[0].assetId+'.png'),16777216));
  check(placement,'MIDGROUND_PLACEMENT');const placementReport=validateBackgroundBandPlacement(placement,{plan,raw,target});
  const old=base.modules.get(rear),other=base.modules.get(facilities),mod=next.modules.get(rear),map=base.maps.default,
    oldInstances=map.instances.filter(x=>x.assetId===rear),facilityInstances=map.instances.filter(x=>x.assetId===facilities),
    newInstances=next.maps.default.instances.filter(x=>x.assetId===rear),newInstance=newInstances[0];
  check(old&&other&&mod&&old.kind==='environment'&&mod.kind==='environment'&&mod.repeatAxis==='none'
    &&oldInstances.length===1&&oldInstances[0].instanceId==='rear.actual'&&facilityInstances.length===1
    &&facilityInstances[0].instanceId==='rear.facilities.actual'&&newInstances.length===1&&newInstance.instanceId==='rear.actual'
    &&old.source.path===mod.source.path&&newInstance.layerId===oldInstances[0].layerId
    &&Object.entries(base.maps).filter(([role])=>role!=='default').every(([,m])=>!m.instances.some(x=>[rear,facilities].includes(x.assetId))),'MIDGROUND_MODULE');
  const oldLayer=map.layers.find(x=>x.layerId===newInstance.layerId),newLayer=next.maps.default.layers.find(x=>x.layerId===newInstance.layerId);
  check(oldLayer&&newLayer&&same(oldLayer.parallax,newLayer.parallax)&&mod.renderStyle.tint===0xffffff&&mod.renderStyle.opacity===1,'MIDGROUND_LAYER');
  const camera=plan.sourceScope.definition.backgroundBand.camera;
  checkMidgroundCamera(map.defaultCamera,camera);
  const display=next.files.get(mod.source.path);check(display&&hash(display)===mod.source.sha256,'MIDGROUND_SOURCE');
  const proposal=seal({format:'ai_scene_verified_midground_proposal_v1',baselineKitSha256:baseline.bundleSha256,skyReportSha256:prior.reportSha256,
    donorBundleSha256:verified.bundleSha256,sourcePlanSha256:plan.sha256,sourceRawSha256:hash(raw),displaySha256:hash(display),
    referenceRawSha256:source.evidence.source.referenceRawSha256,placement:clone(placement),placementReport,
    removedInstances:['rear.actual','rear.facilities.actual'],generationCalls:0,contentContinuity:'not-assessed',finalHumanArtReview:'pending'});
  return {o,c,base,baseline,prior,next,mod,old,raw,display,newInstance,proposal,before:compileMap(baseline,readMap(baseline)),source};
}
export function previewVerifiedMidgroundVariant(options){return prepare(options).proposal;}
function decisionFor(d,p){exact(d,['proposal','receipt']);unseal(d.proposal);check(same(d.proposal,p),'MIDGROUND_PROPOSAL');checkReceipt(d.receipt,'review');check(d.receipt.decision==='accept'&&d.receipt.targetSha256===p.sha256,'MIDGROUND_REVIEW');}
// Operates only on a caller-owned clone; map semantics are checked by the kit
// loader/compiler after the complete checked variant has been materialized.
export function replaceMidgroundInstances(input,instance){const doc=clone(input);
  check(Array.isArray(doc.instances)&&doc.instances.filter(x=>x.instanceId==='rear.actual'&&x.assetId===rear).length===1
    &&doc.instances.filter(x=>x.instanceId==='rear.facilities.actual'&&x.assetId===facilities).length===1
    &&instance?.instanceId==='rear.actual'&&instance.assetId===rear,'MIDGROUND_MAP');
  const index=doc.instances.findIndex(x=>x.instanceId==='rear.actual');doc.instances[index]=clone(instance);
  doc.instances=doc.instances.filter(x=>x.instanceId!=='rear.facilities.actual');
  if(doc.instanceTransforms)doc.instanceTransforms=doc.instanceTransforms.filter(x=>!['rear.actual','rear.facilities.actual'].includes(x.instanceId));
  return doc;}
function buildData(d){const files=new Map([...d.base.files].map(([p,b])=>['kit/'+p,Buffer.from(b)])),kit=clone(d.base.kit),catalog=clone(d.base.catalog);
  kit.revision='midground-'+hash(jsonBytes(d.proposal)).slice(0,20);const ref={kitId:kit.kitId,revision:kit.revision};
  catalog.modules[catalog.modules.findIndex(x=>x.assetId===rear)]=clone(d.mod);files.set('kit/'+d.mod.source.path,Buffer.from(d.display));
  const docs=new Map([[kit.files.catalog.path,catalog],[kit.files.rules.path,clone(d.base.rules)],[kit.files.presets.path,clone(d.base.library)]]);
  for(const [role,r] of Object.entries(kit.files.maps))docs.set(r.path,role==='default'?replaceMidgroundInstances(d.base.maps[role],d.newInstance):clone(d.base.maps[role]));
  for(const [path,doc]of docs){doc.kitRef=ref;files.set('kit/'+path,jsonBytes(doc));}
  for(const [kind,r]of Object.entries(kit.files))for(const entry of kind==='maps'?Object.values(r):[r])entry.sha256=hash(files.get('kit/'+entry.path));
  files.set('kit/kit.json',jsonBytes(kit));files.set('source/midground-original.png',Buffer.from(d.raw));files.set('evidence/midground-source.json',jsonBytes(d.source.evidence));
  files.set('ancestor/previous-rear.png',Buffer.from(d.base.files.get(d.old.source.path)));files.set('ancestor/sky-variant.json',readSelectedFile(join(d.o.skyOptions.output,'variant.json')));
  return files;}
function reportFor(d,h,scene,zip,decision){const now=contextFor(h);for(const k of ['collisionSuggestions','standingSurfaces','boundarySegments','gridTerrains','curveTerrains','mixedTerrains','terrainUnionMaterial','terrainEdgePlacement','terrainBottomEdgePlacement'])check(same(d.before[k]??null,scene[k]??null),'MIDGROUND_TERRAIN_CHANGED');
  check(same(now.kit.terrainAppearance,d.base.kit.terrainAppearance)&&same(now.kit.terrainEdges,d.base.kit.terrainEdges)&&same(now.kit.terrainBottomEdges,d.base.kit.terrainBottomEdges),'MIDGROUND_TERRAIN_CHANGED');
  for(const m of d.base.catalog.modules)if(m.assetId!==rear)check(same(now.modules.get(m.assetId),m)&&now.files.get(m.source.path)?.equals(d.base.files.get(m.source.path)),'MIDGROUND_UNRELATED_SOURCE');
  return seal({format:'ai_scene_verified_midground_variant_v1',proposalSha256:d.proposal.sha256,reviewReceiptSha256:hash(jsonBytes(decision.receipt)),baselineKitSha256:d.baseline.bundleSha256,kitSha256:h.bundleSha256,compiledSha256:scene.contentSha256,
    sourceRawSha256:hash(d.raw),displaySha256:hash(d.display),generationCalls:0,contentContinuity:'not-assessed',sourceArtAcceptance:'not-granted',finalHumanArtReview:'pending',productionKit:false,zip:{sha256:hash(zip),byteLength:zip.length}});}
function inventory(files,report,zip,out){const all=new Map(files);all.set('variant.json',jsonBytes(report));all.set('scene-kit.zip',zip);const manifest=readSelectedFile(join(out,'export/manifest.json'));all.set('export/manifest.json',manifest);
  for(const item of parseJson(manifest).files)all.set('export/'+item.path,readSelectedFile(join(out,'export',...item.path.split('/')),67108864));return seal({format:'ai_scene_midground_variant_inventory_v1',reportSha256:report.sha256,artifacts:[...all].map(([path,b])=>({path,sha256:hash(b),byteLength:b.length}))});}
function checkInventory(out,m){const expected=new Set(m.artifacts.map(x=>x.path).concat('variant-manifest.json')),names=[];function walk(dir,prefix=''){for(const e of readdirSync(dir,{withFileTypes:true})){const p=prefix+e.name;check(!lstatSync(join(dir,e.name)).isSymbolicLink(),'MIDGROUND_INVENTORY');if(e.isDirectory()){check([...expected].some(x=>x.startsWith(p+'/')),'MIDGROUND_INVENTORY');walk(join(dir,e.name),p+'/');}else{check(e.isFile()&&expected.has(p),'MIDGROUND_INVENTORY');names.push(p);}}}walk(out);check(names.length===expected.size,'MIDGROUND_INVENTORY');}
export function buildVerifiedMidgroundVariant(options,decision){const d=prepare(options);decisionFor(decision,d.proposal);const files=buildData(d),out=makeFreshDirectory(options.output,sourceRoot);
  for(const [p,b]of files){const f=join(out,p);mkdirSync(dirname(f),{recursive:true});writeFileSync(f,b,{flag:'wx'});}const h=loadSceneKit(join(out,'kit')),scene=compileMap(h,readMap(h)),zip=exportSceneArchive(h,readMap(h));exportScene(h,readMap(h),join(out,'export'));openSceneExport(join(out,'export'));
  writeFreshFile(join(out,'scene-kit.zip'),zip,sourceRoot);const report=reportFor(d,h,scene,zip,decision);writeFreshFile(join(out,'variant.json'),jsonBytes(report),sourceRoot);writeFreshFile(join(out,'variant-manifest.json'),jsonBytes(inventory(files,report,zip,out)),sourceRoot);return report;}
export function verifyVerifiedMidgroundVariant(options,decision){const d=prepare(options);decisionFor(decision,d.proposal);const files=buildData(d),out=options.output,h=loadSceneKit(join(out,'kit')),ctx=contextFor(h);
  check(ctx.files.size===[...files.keys()].filter(p=>p.startsWith('kit/')).length&&[...ctx.files].every(([p,b])=>files.get('kit/'+p)?.equals(b)),'MIDGROUND_REPLAY');
  for(const [p,b]of files)check(readSelectedFile(join(out,p),16777216).equals(b),'MIDGROUND_REPLAY');const scene=compileMap(h,readMap(h)),reopened=openSceneExport(join(out,'export')),zip=exportSceneArchive(h,readMap(h));
  check(reopened.handle.bundleSha256===h.bundleSha256&&reopened.compiled.contentSha256===scene.contentSha256&&readSelectedFile(join(out,'scene-kit.zip'),268435456).equals(zip),'MIDGROUND_EXPORT');
  const report=readJson(join(out,'variant.json'));unseal(report);check(same(report,reportFor(d,h,scene,zip,decision)),'MIDGROUND_REPORT');const m=readJson(join(out,'variant-manifest.json'));unseal(m);check(same(m,inventory(files,report,zip,out)),'MIDGROUND_INVENTORY');checkInventory(out,m);
  return {status:'verified',reportSha256:report.sha256,kitSha256:h.bundleSha256,generationCalls:0,finalHumanArtReview:'pending'};}
