// Replace two prior middle-ground instances with one independently reviewed,
// native-referenced bridge and wall. No generation or art approval occurs here.
import {mkdirSync,readdirSync,lstatSync,writeFileSync} from 'node:fs';
import {join,dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {canonicalJson,clone} from './document.mjs';
import {isWithin,makeFreshDirectory,parseJson,readSelectedFile,writeFreshFile} from './files.mjs';
import {check,exact,hash,id,isDigest,jsonBytes,seal,unseal,receipt} from './generation/common.mjs';
import * as flow from './generation/index.mjs';
import {verifyVerifiedSceneryAddition,checkSceneryOrder} from './verified-scenery-addition.mjs';
import {checkMidgroundMaterial} from './verified-midground-variant.mjs';
import {loadSceneKit,contextFor,readMap} from './kit.mjs';
import {compileMap} from './compile.mjs';
import {exportScene,exportSceneArchive,openSceneExport} from './persistence.mjs';
const root=fileURLToPath(new URL('../',import.meta.url)),same=(a,b)=>canonicalJson(a)===canonicalJson(b),read=p=>parseJson(readSelectedFile(p));
const removed=['bridge.upper','valley.wall'];
export function replaceDeepBridge(map,instance){const doc=clone(map);check(Array.isArray(doc.instances)&&removed.every(id=>doc.instances.filter(x=>x.instanceId===id&&x.assetId==='scene.'+id).length===1)
  &&doc.instances.some(x=>x.instanceId==='rear.actual'&&x.assetId==='scene.rear.actual')&&doc.instances.some(x=>x.instanceId==='facility.lower'&&x.assetId==='scene.facility.lower')
  &&instance?.instanceId==='bridge.upper'&&instance.assetId==='scene.bridge.upper'&&doc.layers.some(l=>l.layerId===instance.layerId),'DEEP_BRIDGE_MAP');
  doc.instances=doc.instances.filter(x=>!removed.includes(x.instanceId));doc.instances.push(clone(instance));
  if(doc.instanceTransforms)doc.instanceTransforms=doc.instanceTransforms.filter(x=>!removed.includes(x.instanceId));return doc;}

// Compare the actual compiled crop/padding/resampling map with the proposed
// native-frame placement at four crop-boundary points; no visual judgment.
export function checkDeepBridgeNativePlacement(node,evidence,placement){unseal(evidence);exact(placement,['x','y','scale','maximumWorldError']);exact(placement.scale,['numerator','denominator']);
  const {sourceCrop:c,outputSize:s,transparentMarginPx:m}=evidence,k=node?.sourceToLogical?.numerator/node?.sourceToLogical?.denominator,q=placement.scale.numerator/placement.scale.denominator;
  check(evidence.format==='ai_scene_coherent_asset_placement_v1'&&node?.source?.sha256===evidence.derivedSha256&&c?.width>0&&c?.height>0
    &&Number.isInteger(m)&&m>=0&&s?.width>2*m&&s?.height>2*m&&Number.isFinite(k)&&k>0&&Number.isFinite(q)&&q>0
    &&[placement.x,placement.y,placement.maximumWorldError,node.position?.x,node.position?.y].every(Number.isFinite)
    &&placement.maximumWorldError>=0&&placement.maximumWorldError<=2,'DEEP_BRIDGE_NATIVE_PLACEMENT');
  const points=[[0,0],[c.width,0],[0,c.height],[c.width,c.height]].map(([x,y])=>({actual:{x:node.position.x+(m+x*(s.width-2*m)/c.width)*k,y:node.position.y+(m+y*(s.height-2*m)/c.height)*k},
    expected:{x:placement.x+(c.x+x)*q,y:placement.y+(c.y+y)*q}}));
  const error=Math.max(...points.map(p=>Math.hypot(p.actual.x-p.expected.x,p.actual.y-p.expected.y)));check(error<=placement.maximumWorldError,'DEEP_BRIDGE_NATIVE_PLACEMENT');return {points,maximumError:error};}
function prepare(o){exact(o,['baseOptions','baseDecision','candidate','sourcePlanSha256','layerId','nativePlacement','output']);
  const c=o.candidate;exact(c,['workflow','batchSha256','candidateId','root','composition','expectedBundleSha256']);id(o.layerId);check([o.sourcePlanSha256,c.expectedBundleSha256].every(isDigest),'DEEP_BRIDGE_DIGEST');
  const b=o.baseOptions,bb=b.baseOptions,s=bb.skyOptions,f=s.foregroundOptions;for(const p of [b.output,b.candidate.workflow,b.candidate.root,bb.output,bb.candidate.workflow,bb.candidate.root,s.output,s.targetWorkflow,s.sourceWorkflow,f.baselineKitRoot,f.baselineAncestorRoot,f.candidate.root,f.candidate.workflow,c.workflow,c.root])
    check(!isWithin(resolve(p),resolve(o.output))&&!isWithin(resolve(o.output),resolve(p)),'OUTPUT_OVERLAP');
  const verifiedBase=verifyVerifiedSceneryAddition(b,o.baseDecision),baseline=loadSceneKit(join(b.output,'kit')),base=contextFor(baseline);check(verifiedBase.kitSha256===baseline.bundleSha256,'DEEP_BRIDGE_BASE');
  const verified=flow.verifyCoherentCandidate(c.workflow,c.batchSha256,c.candidateId,c.root,c.composition);check(verified.bundleSha256===c.expectedBundleSha256,'DEEP_BRIDGE_DONOR');
  const donor=loadSceneKit(join(c.root,'kit')),dc=contextFor(donor),report=read(join(c.root,'readiness.json'));unseal(report);
  const plan=flow.getGenerationPlan(c.workflow,o.sourcePlanSha256),result=flow.getGenerationResult(c.workflow,o.sourcePlanSha256),asset=plan.recipe.assetId;
  check(asset==='bridge.upper'&&['ai_scene_generation_plan_v27','ai_scene_coherent_rebind_v1'].includes(plan.format)&&['scenery','landmark'].includes(plan.instanceBinding.role)
    &&result.status==='accepted'&&result.result.technical.status==='pass'&&report.batchSha256===c.batchSha256
    &&report.sourceEvidence.some(x=>x.assetId===asset&&x.planSha256===plan.sha256&&x.rawSha256===hash(result.bytes)),'DEEP_BRIDGE_SOURCE');
  const evidence=plan.format==='ai_scene_coherent_rebind_v1'?plan.sourceEvidence:flow.exportCoherentRebindEvidence(c.workflow,plan.sha256).evidence,sky=flow.exportCoherentRebindEvidence(s.sourceWorkflow,s.sourcePlanSha256);unseal(evidence);
  check(evidence.source.assetId===asset&&evidence.source.role===plan.instanceBinding.role&&evidence.rawSha256===hash(result.bytes)
    &&evidence.source.referenceRawSha256===sky.evidence.source.referenceRawSha256&&evidence.source.styleContentSha256===sky.evidence.source.styleContentSha256
    &&hash(readSelectedFile(join(c.root,'source/reference-native.png'),16777216))===evidence.source.referenceRawSha256
    &&same(dc.kit.grid,base.kit.grid)&&same(dc.kit.pixelsPerUnit,base.kit.pixelsPerUnit)&&same(dc.maps.default.defaultCamera,base.maps.default.defaultCamera),'DEEP_BRIDGE_REFERENCE');
  const materials=report.sourceEvidence.filter(x=>x.role==='material');check(materials.length===1,'DEEP_BRIDGE_MATERIAL');id(materials[0].assetId);
  checkMidgroundMaterial(base.kit,dc.kit,report.sourceEvidence,readSelectedFile(join(c.root,'source',materials[0].assetId+'.png'),16777216));
  const raw=readSelectedFile(join(c.root,'source',asset+'.png'),16777216);check(raw.equals(result.bytes),'DEEP_BRIDGE_SOURCE');
  const old=base.modules.get('scene.bridge.upper'),wall=base.modules.get('scene.valley.wall'),mod=clone(dc.modules.get('scene.bridge.upper')),rows=dc.maps.default.instances.filter(x=>x.instanceId==='bridge.upper'&&x.assetId==='scene.bridge.upper'),layer=base.maps.default.layers.find(l=>l.layerId===o.layerId),donorLayer=dc.maps.default.layers.find(l=>l.layerId===rows[0]?.layerId);
  check(old&&wall&&mod?.kind==='environment'&&mod.repeatAxis==='none'&&mod.renderStyle?.tint===0xffffff&&mod.renderStyle?.opacity===1&&rows.length===1
    &&old.source.path===mod.source.path&&layer&&donorLayer&&same(layer.parallax,donorLayer.parallax)
    &&Object.entries(base.maps).filter(([r])=>r!=='default').every(([,m])=>!m.instances.some(x=>removed.includes(x.instanceId))),'DEEP_BRIDGE_MODULE');
  const display=dc.files.get(mod.source.path);check(display&&hash(display)===mod.source.sha256,'DEEP_BRIDGE_SOURCE');
  const placementEvidence=read(join(c.root,'evidence/bridge.upper-placement.json'));check(placementEvidence.sourceSha256===hash(raw),'DEEP_BRIDGE_SOURCE');
  const node=compileMap(donor,readMap(donor)).layers.flatMap(l=>l.nodes).find(n=>n.nodeId==='visual/bridge.upper'),placementCheck=checkDeepBridgeNativePlacement(node,placementEvidence,o.nativePlacement);
  mod.preferredLayerId=o.layerId;const instance={...clone(rows[0]),layerId:o.layerId};
  const proposal=seal({format:'ai_scene_verified_deep_bridge_proposal_v1',baselineKitSha256:baseline.bundleSha256,donorBundleSha256:verified.bundleSha256,
    sourcePlanSha256:plan.sha256,sourceRawSha256:hash(raw),displaySha256:hash(display),referenceRawSha256:evidence.source.referenceRawSha256,
    instance,nativePlacement:o.nativePlacement,placementEvidenceSha256:placementEvidence.sha256,placementCheck,removedInstances:removed,generationCalls:0,contactAndArt:'not-assessed',finalHumanArtReview:'pending'});
  return {o,base,baseline,plan,evidence,raw,display,mod,old,instance,proposal,before:compileMap(baseline,readMap(baseline))};
}
export function previewVerifiedDeepBridgeVariant(options){return prepare(options).proposal;}
function decide(d,p){exact(d,['proposal','receipt']);unseal(d.proposal);check(same(d.proposal,p),'DEEP_BRIDGE_PROPOSAL');receipt(d.receipt,'review');check(d.receipt.decision==='accept'&&d.receipt.targetSha256===p.sha256,'DEEP_BRIDGE_REVIEW');}
function buildData(d){const files=new Map([...d.base.files].map(([p,b])=>['kit/'+p,Buffer.from(b)])),kit=clone(d.base.kit),catalog=clone(d.base.catalog);
  kit.revision='deep-bridge-'+hash(jsonBytes(d.proposal)).slice(0,20);const kitRef={kitId:kit.kitId,revision:kit.revision},idx=catalog.modules.findIndex(m=>m.assetId==='scene.bridge.upper');check(idx>=0,'DEEP_BRIDGE_MODULE');catalog.modules[idx]=d.mod;
  files.set('ancestor/old-bridge-display.png',Buffer.from(d.base.files.get(d.old.source.path)));files.set('kit/'+d.mod.source.path,Buffer.from(d.display));
  const docs=new Map([[kit.files.catalog.path,catalog],[kit.files.rules.path,clone(d.base.rules)],[kit.files.presets.path,clone(d.base.library)]]);
  for(const [role,r]of Object.entries(kit.files.maps))docs.set(r.path,role==='default'?replaceDeepBridge(d.base.maps[role],d.instance):clone(d.base.maps[role]));
  for(const [path,doc]of docs){doc.kitRef=kitRef;files.set('kit/'+path,jsonBytes(doc));}for(const [kind,r]of Object.entries(kit.files))for(const entry of kind==='maps'?Object.values(r):[r])entry.sha256=hash(files.get('kit/'+entry.path));
  files.set('kit/kit.json',jsonBytes(kit));files.set('source/deep-bridge-original.png',Buffer.from(d.raw));files.set('evidence/source.json',jsonBytes(d.evidence));files.set('evidence/proposal.json',jsonBytes(d.proposal));return files;}
function reportFor(d,h,scene,zip,decision){for(const k of ['collisionSuggestions','standingSurfaces','boundarySegments','gridTerrains','curveTerrains','mixedTerrains','terrainUnionMaterial','terrainEdgePlacement','terrainBottomEdgePlacement'])check(same(d.before[k]??null,scene[k]??null),'DEEP_BRIDGE_TERRAIN_CHANGED');
  const now=contextFor(h);check(same(now.kit.terrainAppearance,d.base.kit.terrainAppearance)&&same(now.kit.terrainEdges,d.base.kit.terrainEdges)&&same(now.kit.terrainBottomEdges,d.base.kit.terrainBottomEdges),'DEEP_BRIDGE_TERRAIN_CHANGED');
  for(const m of d.base.catalog.modules)if(m.assetId!=='scene.bridge.upper')check(same(now.modules.get(m.assetId),m)&&now.files.get(m.source.path)?.equals(d.base.files.get(m.source.path)),'DEEP_BRIDGE_UNRELATED_SOURCE');
  const all=s=>s.layers.flatMap(l=>l.nodes),nodes=new Map(all(scene).map(n=>[n.nodeId,n]));for(const n of all(d.before))if(!removed.some(x=>n.nodeId==='visual/'+x))check(nodes.has(n.nodeId)&&same(nodes.get(n.nodeId),n),'DEEP_BRIDGE_UNRELATED_NODE');
  check(!nodes.has('visual/valley.wall'),'DEEP_BRIDGE_MAP');checkSceneryOrder(scene,'bridge.upper',['rear.actual'],['facility.lower']);
  return seal({format:'ai_scene_verified_deep_bridge_variant_v1',proposalSha256:d.proposal.sha256,reviewReceiptSha256:hash(jsonBytes(decision.receipt)),baselineKitSha256:d.baseline.bundleSha256,kitSha256:h.bundleSha256,compiledSha256:scene.contentSha256,
    replacement:d.proposal.instance,generationCalls:0,contactAndArt:'not-assessed',finalHumanArtReview:'pending',productionKit:false,zip:{sha256:hash(zip),byteLength:zip.length}});}
function inventory(files,out,report,zip){const all=new Map(files);all.set('variant.json',jsonBytes(report));all.set('scene-kit.zip',zip);const manifest=readSelectedFile(join(out,'export/manifest.json'));all.set('export/manifest.json',manifest);
  for(const item of parseJson(manifest).files)all.set('export/'+item.path,readSelectedFile(join(out,'export',...item.path.split('/')),67108864));return seal({format:'ai_scene_deep_bridge_inventory_v1',reportSha256:report.sha256,artifacts:[...all].map(([path,b])=>({path,sha256:hash(b),byteLength:b.length}))});}
function checkInventory(out,m){const expected=new Set(m.artifacts.map(x=>x.path).concat('variant-manifest.json')),names=[];function walk(dir,prefix=''){for(const e of readdirSync(dir,{withFileTypes:true})){const p=prefix+e.name;check(!lstatSync(join(dir,e.name)).isSymbolicLink(),'DEEP_BRIDGE_INVENTORY');if(e.isDirectory()){check([...expected].some(x=>x.startsWith(p+'/')),'DEEP_BRIDGE_INVENTORY');walk(join(dir,e.name),p+'/');}else{check(e.isFile()&&expected.has(p),'DEEP_BRIDGE_INVENTORY');names.push(p);}}}walk(out);check(names.length===expected.size,'DEEP_BRIDGE_INVENTORY');}
export function buildVerifiedDeepBridgeVariant(options,decision){const d=prepare(options);decide(decision,d.proposal);const files=buildData(d),out=makeFreshDirectory(options.output,root);
  for(const [p,b]of files){const f=join(out,p);mkdirSync(dirname(f),{recursive:true});writeFileSync(f,b,{flag:'wx'});}const h=loadSceneKit(join(out,'kit')),scene=compileMap(h,readMap(h)),zip=exportSceneArchive(h,readMap(h));exportScene(h,readMap(h),join(out,'export'));openSceneExport(join(out,'export'));
  writeFreshFile(join(out,'scene-kit.zip'),zip,root);const report=reportFor(d,h,scene,zip,decision);writeFreshFile(join(out,'variant.json'),jsonBytes(report),root);writeFreshFile(join(out,'variant-manifest.json'),jsonBytes(inventory(files,out,report,zip)),root);return report;}
export function verifyVerifiedDeepBridgeVariant(options,decision){const d=prepare(options);decide(decision,d.proposal);const files=buildData(d),out=options.output,h=loadSceneKit(join(out,'kit')),ctx=contextFor(h);
  check(ctx.files.size===[...files.keys()].filter(p=>p.startsWith('kit/')).length&&[...ctx.files].every(([p,b])=>files.get('kit/'+p)?.equals(b)),'DEEP_BRIDGE_REPLAY');
  for(const [p,b]of files)check(readSelectedFile(join(out,p),16777216).equals(b),'DEEP_BRIDGE_REPLAY');const scene=compileMap(h,readMap(h)),reopened=openSceneExport(join(out,'export')),zip=exportSceneArchive(h,readMap(h));
  check(reopened.handle.bundleSha256===h.bundleSha256&&reopened.compiled.contentSha256===scene.contentSha256&&readSelectedFile(join(out,'scene-kit.zip'),268435456).equals(zip),'DEEP_BRIDGE_EXPORT');
  const report=read(join(out,'variant.json'));unseal(report);check(same(report,reportFor(d,h,scene,zip,decision)),'DEEP_BRIDGE_REPORT');const m=read(join(out,'variant-manifest.json'));unseal(m);check(same(m,inventory(files,out,report,zip)),'DEEP_BRIDGE_INVENTORY');checkInventory(out,m);
  return {status:'verified',reportSha256:report.sha256,kitSha256:h.bundleSha256,generationCalls:0,finalHumanArtReview:'pending'};}
