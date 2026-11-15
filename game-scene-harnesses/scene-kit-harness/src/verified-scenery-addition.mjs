// Add one separately reviewed scenery source to an already verified bridge-band
// variant. This path does not generate media or certify visual acceptance.
import {mkdirSync,readdirSync,lstatSync,writeFileSync} from 'node:fs';
import {join,dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {canonicalJson,clone} from './document.mjs';
import {isWithin,makeFreshDirectory,parseJson,readSelectedFile,writeFreshFile} from './files.mjs';
import {check,exact,hash,id,isDigest,jsonBytes,seal,unseal,receipt} from './generation/common.mjs';
import * as flow from './generation/index.mjs';
import {verifyVerifiedBridgeBandVariant} from './verified-bridge-band-variant.mjs';
import {checkMidgroundMaterial} from './verified-midground-variant.mjs';
import {loadSceneKit,contextFor,readMap} from './kit.mjs';
import {compileMap} from './compile.mjs';
import {exportScene,exportSceneArchive,openSceneExport} from './persistence.mjs';
const root=fileURLToPath(new URL('../',import.meta.url)),same=(a,b)=>canonicalJson(a)===canonicalJson(b),read=p=>parseJson(readSelectedFile(p));
export function addSceneryInstance(map,instance){const doc=clone(map);check(Array.isArray(doc.instances)&&instance&&!doc.instances.some(x=>x.instanceId===instance.instanceId)
  &&doc.layers.some(l=>l.layerId===instance.layerId),'SCENERY_ADDITION_MAP');doc.instances.push(clone(instance));return doc;}
export function createSceneryAdditionLayer(map,layerId,spec){exact(spec,['copyFromLayerId','zIndex']);id(layerId);id(spec.copyFromLayerId);
  const source=map.layers.find(l=>l.layerId===spec.copyFromLayerId);check(source&&Number.isSafeInteger(spec.zIndex)&&spec.zIndex>=-10000&&spec.zIndex<=10000
    &&!map.layers.some(l=>l.layerId===layerId||l.zIndex===spec.zIndex),'SCENERY_ADDITION_LAYER');return {...clone(source),layerId,zIndex:spec.zIndex};}
export function checkSceneryOrder(scene,instanceId,behind,ahead){
  const ordered=[...scene.layers].sort((a,b)=>a.zIndex-b.zIndex).flatMap(l=>l.nodes.map(n=>n.nodeId));
  const current=ordered.indexOf('visual/'+instanceId);check(current>=0&&new Set(ordered).size===ordered.length,'SCENERY_ADDITION_ORDER');
  for(const x of behind){const i=ordered.indexOf('visual/'+x);check(i>=0&&i<current,'SCENERY_ADDITION_ORDER');}
  for(const x of ahead){const i=ordered.indexOf('visual/'+x);check(i>current,'SCENERY_ADDITION_ORDER');}
}
function prepare(o){exact(o,['baseOptions','baseDecision','candidate','sourcePlanSha256','layerId','position','behind','ahead',...(Object.hasOwn(o,'newLayer')?['newLayer']:[]),'output']);
  const c=o.candidate;exact(c,['workflow','batchSha256','candidateId','root','composition','expectedBundleSha256']);id(o.layerId);exact(o.position,['x','y']);
  check([o.sourcePlanSha256,c.expectedBundleSha256].every(isDigest)&&[o.position.x,o.position.y].every(x=>Number.isSafeInteger(x)&&Math.abs(x)<=65536)
    &&Array.isArray(o.behind)&&Array.isArray(o.ahead)&&o.behind.length+o.ahead.length<=24,'SCENERY_ADDITION_OPTIONS');
  for(const x of [...o.behind,...o.ahead])id(x);check(new Set([...o.behind,...o.ahead]).size===o.behind.length+o.ahead.length,'SCENERY_ADDITION_ORDER');
  const b=o.baseOptions,s=b.skyOptions,f=s.foregroundOptions;for(const p of [b.output,b.candidate.workflow,b.candidate.root,s.output,s.targetWorkflow,s.sourceWorkflow,f.baselineKitRoot,f.baselineAncestorRoot,f.candidate.root,f.candidate.workflow,c.workflow,c.root])
    check(!isWithin(resolve(p),resolve(o.output))&&!isWithin(resolve(o.output),resolve(p)),'OUTPUT_OVERLAP');
  const verifiedBase=verifyVerifiedBridgeBandVariant(b,o.baseDecision),baseline=loadSceneKit(join(b.output,'kit')),base=contextFor(baseline);check(verifiedBase.kitSha256===baseline.bundleSha256,'SCENERY_ADDITION_BASE');
  const donorVerification=flow.verifyCoherentCandidate(c.workflow,c.batchSha256,c.candidateId,c.root,c.composition);check(donorVerification.bundleSha256===c.expectedBundleSha256,'SCENERY_ADDITION_DONOR');
  const donor=loadSceneKit(join(c.root,'kit')),dc=contextFor(donor),report=read(join(c.root,'readiness.json'));unseal(report);
  const plan=flow.getGenerationPlan(c.workflow,o.sourcePlanSha256),result=flow.getGenerationResult(c.workflow,o.sourcePlanSha256),asset=plan.recipe.assetId;id(asset);
  check(['ai_scene_generation_plan_v27','ai_scene_coherent_rebind_v1'].includes(plan.format)&&['scenery','landmark'].includes(plan.instanceBinding.role)
    &&result.status==='accepted'&&result.result.technical.status==='pass'&&report.batchSha256===c.batchSha256
    &&report.sourceEvidence.some(x=>x.assetId===asset&&x.planSha256===plan.sha256&&x.rawSha256===hash(result.bytes)),'SCENERY_ADDITION_SOURCE');
  const evidence=plan.format==='ai_scene_coherent_rebind_v1'?plan.sourceEvidence:flow.exportCoherentRebindEvidence(c.workflow,plan.sha256).evidence,sky=flow.exportCoherentRebindEvidence(s.sourceWorkflow,s.sourcePlanSha256);unseal(evidence);
  check(evidence.source.assetId===asset&&evidence.source.role===plan.instanceBinding.role&&evidence.rawSha256===hash(result.bytes)
    &&evidence.source.referenceRawSha256===sky.evidence.source.referenceRawSha256&&evidence.source.styleContentSha256===sky.evidence.source.styleContentSha256
    &&hash(readSelectedFile(join(c.root,'source/reference-native.png'),16777216))===evidence.source.referenceRawSha256
    &&same(dc.kit.grid,base.kit.grid)&&same(dc.kit.pixelsPerUnit,base.kit.pixelsPerUnit)&&same(dc.maps.default.defaultCamera,base.maps.default.defaultCamera),'SCENERY_ADDITION_REFERENCE');
  const materials=report.sourceEvidence.filter(x=>x.role==='material');check(materials.length===1,'SCENERY_ADDITION_MATERIAL');id(materials[0].assetId);
  checkMidgroundMaterial(base.kit,dc.kit,report.sourceEvidence,readSelectedFile(join(c.root,'source',materials[0].assetId+'.png'),16777216));
  const raw=readSelectedFile(join(c.root,'source',asset+'.png'),16777216);check(raw.equals(result.bytes),'SCENERY_ADDITION_SOURCE');
  const newLayer=Object.hasOwn(o,'newLayer')?createSceneryAdditionLayer(base.maps.default,o.layerId,o.newLayer):null;
  const moduleId='scene.'+asset,mod=clone(dc.modules.get(moduleId)),rows=dc.maps.default.instances.filter(x=>x.instanceId===asset&&x.assetId===moduleId),layer=newLayer??base.maps.default.layers.find(l=>l.layerId===o.layerId),donorLayer=dc.maps.default.layers.find(l=>l.layerId===rows[0]?.layerId);
  check(mod?.kind==='environment'&&mod.repeatAxis==='none'&&mod.renderStyle?.tint===0xffffff&&mod.renderStyle?.opacity===1&&rows.length===1
    &&layer&&donorLayer&&same(layer.parallax,donorLayer.parallax)&&!base.modules.has(moduleId)&&!base.files.has(mod.source.path)
    &&!base.maps.default.instances.some(x=>x.instanceId===asset),'SCENERY_ADDITION_MODULE');
  const display=dc.files.get(mod.source.path);check(display&&hash(display)===mod.source.sha256,'SCENERY_ADDITION_SOURCE');mod.preferredLayerId=o.layerId;
  const instance={...clone(rows[0]),layerId:o.layerId,x:o.position.x,y:o.position.y};
  const proposal=seal({format:'ai_scene_verified_scenery_addition_proposal_v1',baselineKitSha256:baseline.bundleSha256,donorBundleSha256:donorVerification.bundleSha256,
    sourcePlanSha256:plan.sha256,sourceRawSha256:hash(raw),displaySha256:hash(display),referenceRawSha256:evidence.source.referenceRawSha256,
    instance,behind:o.behind,ahead:o.ahead,...(newLayer?{addedLayer:newLayer}:{}),generationCalls:0,contactAndArt:'not-assessed',finalHumanArtReview:'pending'});
  return {o,base,baseline,plan,evidence,raw,display,mod,instance,newLayer,proposal,before:compileMap(baseline,readMap(baseline))};
}
export function previewVerifiedSceneryAddition(options){return prepare(options).proposal;}
function decide(d,p){exact(d,['proposal','receipt']);unseal(d.proposal);check(same(d.proposal,p),'SCENERY_ADDITION_PROPOSAL');receipt(d.receipt,'review');check(d.receipt.decision==='accept'&&d.receipt.targetSha256===p.sha256,'SCENERY_ADDITION_REVIEW');}
function buildData(d){const files=new Map([...d.base.files].map(([p,b])=>['kit/'+p,Buffer.from(b)])),kit=clone(d.base.kit),catalog=clone(d.base.catalog);
  kit.revision='scenery-add-'+hash(jsonBytes(d.proposal)).slice(0,20);const kitRef={kitId:kit.kitId,revision:kit.revision};catalog.modules.push(d.mod);files.set('kit/'+d.mod.source.path,Buffer.from(d.display));
  const docs=new Map([[kit.files.catalog.path,catalog],[kit.files.rules.path,clone(d.base.rules)],[kit.files.presets.path,clone(d.base.library)]]);
  for(const [role,r]of Object.entries(kit.files.maps)){let doc=clone(d.base.maps[role]);if(d.newLayer){check(!doc.layers.some(l=>l.layerId===d.newLayer.layerId||l.zIndex===d.newLayer.zIndex),'SCENERY_ADDITION_LAYER');doc.layers.push(clone(d.newLayer));}
    if(role==='default')doc=addSceneryInstance(doc,d.instance);docs.set(r.path,doc);}
  for(const [path,doc]of docs){doc.kitRef=kitRef;files.set('kit/'+path,jsonBytes(doc));}for(const [kind,r]of Object.entries(kit.files))for(const entry of kind==='maps'?Object.values(r):[r])entry.sha256=hash(files.get('kit/'+entry.path));
  files.set('kit/kit.json',jsonBytes(kit));files.set('source/scenery-original.png',Buffer.from(d.raw));files.set('evidence/source.json',jsonBytes(d.evidence));files.set('evidence/proposal.json',jsonBytes(d.proposal));return files;}
function reportFor(d,h,scene,zip,decision){for(const k of ['collisionSuggestions','standingSurfaces','boundarySegments','gridTerrains','curveTerrains','mixedTerrains','terrainUnionMaterial','terrainEdgePlacement','terrainBottomEdgePlacement'])check(same(d.before[k]??null,scene[k]??null),'SCENERY_ADDITION_TERRAIN_CHANGED');
  const now=contextFor(h);check(same(now.kit.terrainAppearance,d.base.kit.terrainAppearance)&&same(now.kit.terrainEdges,d.base.kit.terrainEdges)&&same(now.kit.terrainBottomEdges,d.base.kit.terrainBottomEdges),'SCENERY_ADDITION_TERRAIN_CHANGED');
  for(const m of d.base.catalog.modules)check(same(now.modules.get(m.assetId),m)&&now.files.get(m.source.path)?.equals(d.base.files.get(m.source.path)),'SCENERY_ADDITION_UNRELATED_SOURCE');
  const all=s=>s.layers.flatMap(l=>l.nodes),nodes=new Map(all(scene).map(n=>[n.nodeId,n]));for(const n of all(d.before))check(nodes.has(n.nodeId)&&same(nodes.get(n.nodeId),n),'SCENERY_ADDITION_UNRELATED_NODE');
  checkSceneryOrder(scene,d.instance.instanceId,d.o.behind,d.o.ahead);
  return seal({format:'ai_scene_verified_scenery_addition_v1',proposalSha256:d.proposal.sha256,reviewReceiptSha256:hash(jsonBytes(decision.receipt)),baselineKitSha256:d.baseline.bundleSha256,kitSha256:h.bundleSha256,compiledSha256:scene.contentSha256,
    addition:d.proposal.instance,generationCalls:0,contactAndArt:'not-assessed',finalHumanArtReview:'pending',productionKit:false,zip:{sha256:hash(zip),byteLength:zip.length}});}
function inventory(files,out,report,zip){const all=new Map(files);all.set('addition.json',jsonBytes(report));all.set('scene-kit.zip',zip);const manifest=readSelectedFile(join(out,'export/manifest.json'));all.set('export/manifest.json',manifest);
  for(const item of parseJson(manifest).files)all.set('export/'+item.path,readSelectedFile(join(out,'export',...item.path.split('/')),67108864));return seal({format:'ai_scene_scenery_addition_inventory_v1',reportSha256:report.sha256,artifacts:[...all].map(([path,b])=>({path,sha256:hash(b),byteLength:b.length}))});}
function checkInventory(out,m){const expected=new Set(m.artifacts.map(x=>x.path).concat('addition-manifest.json')),names=[];function walk(dir,prefix=''){for(const e of readdirSync(dir,{withFileTypes:true})){const p=prefix+e.name;check(!lstatSync(join(dir,e.name)).isSymbolicLink(),'SCENERY_ADDITION_INVENTORY');if(e.isDirectory()){check([...expected].some(x=>x.startsWith(p+'/')),'SCENERY_ADDITION_INVENTORY');walk(join(dir,e.name),p+'/');}else{check(e.isFile()&&expected.has(p),'SCENERY_ADDITION_INVENTORY');names.push(p);}}}walk(out);check(names.length===expected.size,'SCENERY_ADDITION_INVENTORY');}
export function buildVerifiedSceneryAddition(options,decision){const d=prepare(options);decide(decision,d.proposal);const files=buildData(d),out=makeFreshDirectory(options.output,root);
  for(const [p,b]of files){const f=join(out,p);mkdirSync(dirname(f),{recursive:true});writeFileSync(f,b,{flag:'wx'});}const h=loadSceneKit(join(out,'kit')),scene=compileMap(h,readMap(h)),zip=exportSceneArchive(h,readMap(h));exportScene(h,readMap(h),join(out,'export'));openSceneExport(join(out,'export'));
  writeFreshFile(join(out,'scene-kit.zip'),zip,root);const report=reportFor(d,h,scene,zip,decision);writeFreshFile(join(out,'addition.json'),jsonBytes(report),root);writeFreshFile(join(out,'addition-manifest.json'),jsonBytes(inventory(files,out,report,zip)),root);return report;}
export function verifyVerifiedSceneryAddition(options,decision){const d=prepare(options);decide(decision,d.proposal);const files=buildData(d),out=options.output,h=loadSceneKit(join(out,'kit')),ctx=contextFor(h);
  check(ctx.files.size===[...files.keys()].filter(p=>p.startsWith('kit/')).length&&[...ctx.files].every(([p,b])=>files.get('kit/'+p)?.equals(b)),'SCENERY_ADDITION_REPLAY');
  for(const [p,b]of files)check(readSelectedFile(join(out,p),16777216).equals(b),'SCENERY_ADDITION_REPLAY');const scene=compileMap(h,readMap(h)),reopened=openSceneExport(join(out,'export')),zip=exportSceneArchive(h,readMap(h));
  check(reopened.handle.bundleSha256===h.bundleSha256&&reopened.compiled.contentSha256===scene.contentSha256&&readSelectedFile(join(out,'scene-kit.zip'),268435456).equals(zip),'SCENERY_ADDITION_EXPORT');
  const report=read(join(out,'addition.json'));unseal(report);check(same(report,reportFor(d,h,scene,zip,decision)),'SCENERY_ADDITION_REPORT');const m=read(join(out,'addition-manifest.json'));unseal(m);check(same(m,inventory(files,out,report,zip)),'SCENERY_ADDITION_INVENTORY');checkInventory(out,m);
  return {status:'verified',reportSha256:report.sha256,kitSha256:h.bundleSha256,generationCalls:0,finalHumanArtReview:'pending'};}
