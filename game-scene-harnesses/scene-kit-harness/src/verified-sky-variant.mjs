import {mkdirSync,readdirSync,lstatSync,writeFileSync} from 'node:fs';
import {join,dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {canonicalJson,clone} from './document.mjs';
import {isWithin,makeFreshDirectory,parseJson,readSelectedFile,writeFreshFile} from './files.mjs';
import {check,exact,hash,isDigest,jsonBytes,seal,unseal,receipt as checkReceipt} from './generation/common.mjs';
import {verifyVerifiedForegroundAddition} from './verified-foreground-addition.mjs';
import * as flow from './generation/index.mjs';
import {loadSceneKit,contextFor,readMap} from './kit.mjs';
import {inspectPng,encodeRgbaPng} from './png.mjs';
import {resampleEnvironmentAlpha} from './environment-proof.mjs';
import {compileMap} from './compile.mjs';
import {exportScene,exportSceneArchive,openSceneExport} from './persistence.mjs';
const sourceRoot=fileURLToPath(new URL('../',import.meta.url));
const same=(a,b)=>canonicalJson(a)===canonicalJson(b),readJson=p=>parseJson(readSelectedFile(p));

function prepare(o){
  exact(o,['foregroundOptions','foregroundDecision','targetWorkflow','oldSkyPlanSha256','sourceWorkflow','sourcePlanSha256','output']);
  check(isDigest(o.oldSkyPlanSha256)&&isDigest(o.sourcePlanSha256),'SKY_VARIANT_PLAN');
  for(const p of [o.foregroundOptions.output,o.targetWorkflow,o.sourceWorkflow])check(!isWithin(resolve(p),resolve(o.output))&&!isWithin(resolve(o.output),resolve(p)),'OUTPUT_OVERLAP');
  const verified=verifyVerifiedForegroundAddition(o.foregroundOptions,o.foregroundDecision),baseline=loadSceneKit(join(o.foregroundOptions.output,'kit'));
  check(verified.kitSha256===baseline.bundleSha256,'SKY_VARIANT_BASE');
  const base=contextFor(baseline),ancestor=readJson(join(o.foregroundOptions.baselineAncestorRoot,'readiness.json'));unseal(ancestor);
  const oldBatch=flow.getCoherentSourceBatch(o.targetWorkflow,ancestor.baseBatchSha256),old=flow.getGenerationPlan(o.targetWorkflow,o.oldSkyPlanSha256);
  check(oldBatch.planSha256s.includes(o.oldSkyPlanSha256)&&['ai_scene_coherent_rebind_v1','ai_scene_generation_plan_v27'].includes(old.format)&&old.instanceBinding.role==='sky'&&old.recipe.assetId==='sky.actual','SKY_VARIANT_TARGET');
  const source=flow.exportCoherentRebindEvidence(o.sourceWorkflow,o.sourcePlanSha256),e=source.evidence,s=e.source,
    t=old.format==='ai_scene_coherent_rebind_v1'?old.proposal.target:flow.exportCoherentRebindEvidence(o.targetWorkflow,o.oldSkyPlanSha256).evidence.source;
  check(s.role==='sky'&&s.assetId==='sky.actual'&&s.referenceRawSha256===ancestor.referenceRawSha256&&s.referenceRawSha256===t.referenceRawSha256
    &&s.styleContentSha256===t.styleContentSha256&&e.technicalStatus==='pass'&&e.visualAcceptance==='not-transferred'&&hash(source.bytes)===e.rawSha256,'SKY_VARIANT_SOURCE');
  const moduleId='scene.sky.actual',mod=base.modules.get(moduleId),instances=base.maps.default.instances.filter(i=>i.assetId===moduleId);
  check(mod?.kind==='background'&&mod.repeatAxis==='none'&&instances.length===1&&mod.anchorPx.x===0&&mod.anchorPx.y===0&&mod.visualOffset.x===0&&mod.visualOffset.y===0
    &&instances[0].x===0&&instances[0].y===0,'SKY_VARIANT_MODULE');
  const {width,height}=base.maps.default.defaultCamera.viewport,ppm=base.kit.pixelsPerUnit;
  check(ppm.numerator===ppm.denominator&&width>0&&height>0,'SKY_VARIANT_VIEWPORT');
  const png=inspectPng(source.bytes,{includePixels:true,allowCabx:true,allowHiddenRgb:true});
  check(png.width>=width&&png.height>=height&&png.transparentPixels===0,'SKY_VARIANT_SAMPLING');
  const image=resampleEnvironmentAlpha(png,{x:0,y:0,width:png.width,height:png.height},width,height),display=encodeRgbaPng(width,height,image.rgba);
  const updated=clone(mod);updated.pixelSize={width,height};updated.footprint={columns:Math.ceil(width/base.kit.grid.width),rows:Math.ceil(height/base.kit.grid.height)};updated.renderStyle={scale:{numerator:1,denominator:1},tint:0xffffff,opacity:1};updated.source={...updated.source,sha256:hash(display),byteLength:display.length};
  const proposal=seal({format:'ai_scene_verified_sky_variant_proposal_v1',foregroundReportSha256:verified.reportSha256,baselineKitSha256:baseline.bundleSha256,
    ancestorReportSha256:ancestor.sha256,oldPlanSha256:old.sha256,sourceEvidence:e,rawSha256:hash(source.bytes),displaySha256:hash(display),
    inputSize:{width:png.width,height:png.height},outputSize:{width,height},sampling:'entire-native-frame-area-resample-to-viewport-nonuniform-if-aspects-differ',generationCalls:0,visualAcceptance:'not-transferred',finalHumanArtReview:'pending'});
  return {base,baseline,before:compileMap(baseline,readMap(baseline)),ancestor,verified,source,mod,updated,display,proposal,
    foregroundReport:readJson(join(o.foregroundOptions.output,'addition.json'))};
}
export function previewVerifiedSkyVariant(options){return prepare(options).proposal;}
function decisionFor(d,proposal){exact(d,['proposal','receipt']);unseal(d.proposal);check(same(d.proposal,proposal),'SKY_VARIANT_PROPOSAL');checkReceipt(d.receipt,'review');check(d.receipt.decision==='accept'&&d.receipt.targetSha256===proposal.sha256,'SKY_VARIANT_REVIEW');}
function buildData(d){const files=new Map([...d.base.files].map(([p,b])=>['kit/'+p,Buffer.from(b)])),kit=clone(d.base.kit),catalog=clone(d.base.catalog);
  kit.revision='sky-variant-'+hash(jsonBytes(d.proposal)).slice(0,20);const kitRef={kitId:kit.kitId,revision:kit.revision};
  catalog.modules[catalog.modules.findIndex(m=>m.assetId===d.mod.assetId)]=clone(d.updated);files.set('kit/'+d.mod.source.path,d.display);
  const docs=new Map([[kit.files.catalog.path,catalog],[kit.files.rules.path,clone(d.base.rules)],[kit.files.presets.path,clone(d.base.library)]]);
  for(const [role,ref]of Object.entries(kit.files.maps))docs.set(ref.path,clone(d.base.maps[role]));
  for(const [path,doc]of docs){doc.kitRef=kitRef;files.set('kit/'+path,jsonBytes(doc));}
  for(const [kind,ref]of Object.entries(kit.files))for(const entry of kind==='maps'?Object.values(ref):[ref])entry.sha256=hash(files.get('kit/'+entry.path));
  files.set('kit/kit.json',jsonBytes(kit));files.set('source/sky-original.png',Buffer.from(d.source.bytes));files.set('evidence/sky-source.json',jsonBytes(d.source.evidence));
  files.set('ancestor/foreground-addition.json',jsonBytes(d.foregroundReport));files.set('ancestor/previous-sky.png',Buffer.from(d.base.files.get(d.mod.source.path)));
  return files;
}
function reportFor(d,handle,scene,zip){for(const k of ['collisionSuggestions','standingSurfaces','boundarySegments','gridTerrains','curveTerrains','mixedTerrains','terrainUnionMaterial','terrainEdgePlacement','terrainBottomEdgePlacement'])
  check(same(d.before[k]??null,scene[k]??null),'SKY_VARIANT_TERRAIN_CHANGED');const now=contextFor(handle);
  check(same(now.kit.terrainAppearance,d.base.kit.terrainAppearance)&&same(now.kit.terrainEdges,d.base.kit.terrainEdges)&&same(now.kit.terrainBottomEdges,d.base.kit.terrainBottomEdges),'SKY_VARIANT_TERRAIN_CHANGED');
  for(const m of d.base.catalog.modules)if(m.assetId!==d.mod.assetId)check(same(now.modules.get(m.assetId),m)&&now.files.get(m.source.path)?.equals(d.base.files.get(m.source.path)),'SKY_VARIANT_UNRELATED_SOURCE');
  return seal({format:'ai_scene_verified_sky_variant_v1',proposalSha256:d.proposal.sha256,foregroundReportSha256:d.verified.reportSha256,baselineKitSha256:d.baseline.bundleSha256,kitSha256:handle.bundleSha256,
    compiledSha256:scene.contentSha256,sourceEvidenceSha256:d.source.evidence.sha256,sourceRawSha256:d.source.evidence.rawSha256,displaySha256:hash(d.display),sampling:d.proposal.sampling,
    generationCalls:0,sourceArtAcceptance:'not-granted',finalHumanArtReview:'pending',productionKit:false,zip:{sha256:hash(zip),byteLength:zip.length}});}
function manifestFor(files,report,zip,out){const all=new Map(files);all.set('variant.json',jsonBytes(report));all.set('scene-kit.zip',zip);const manifest=readSelectedFile(join(out,'export/manifest.json'));all.set('export/manifest.json',manifest);
  for(const entry of parseJson(manifest).files)all.set('export/'+entry.path,readSelectedFile(join(out,'export',...entry.path.split('/')),67108864));
  return seal({format:'ai_scene_verified_sky_variant_inventory_v1',reportSha256:report.sha256,generationCalls:0,artifacts:[...all].map(([path,bytes])=>({path,sha256:hash(bytes),byteLength:bytes.length}))});}
function verifyInventory(out,m){const expected=new Set(m.artifacts.map(x=>x.path).concat('variant-manifest.json')),names=[];
  function walk(dir,prefix=''){for(const e of readdirSync(dir,{withFileTypes:true})){const path=prefix+e.name;check(!lstatSync(join(dir,e.name)).isSymbolicLink(),'SKY_VARIANT_INVENTORY');if(e.isDirectory()){check([...expected].some(x=>x.startsWith(path+'/')),'SKY_VARIANT_INVENTORY');walk(join(dir,e.name),path+'/');}else{check(e.isFile()&&expected.has(path),'SKY_VARIANT_INVENTORY');names.push(path);}}}walk(out);check(names.length===expected.size,'SKY_VARIANT_INVENTORY');}
export function buildVerifiedSkyVariant(options,decision){const d=prepare(options);decisionFor(decision,d.proposal);const files=buildData(d),out=makeFreshDirectory(options.output,sourceRoot);
  for(const [path,bytes]of files){const target=join(out,path);mkdirSync(dirname(target),{recursive:true});writeFileSync(target,bytes,{flag:'wx'});}
  const handle=loadSceneKit(join(out,'kit')),scene=compileMap(handle,readMap(handle)),zip=exportSceneArchive(handle,readMap(handle));exportScene(handle,readMap(handle),join(out,'export'));openSceneExport(join(out,'export'));
  writeFreshFile(join(out,'scene-kit.zip'),zip,sourceRoot);const report=reportFor(d,handle,scene,zip);writeFreshFile(join(out,'variant.json'),jsonBytes(report),sourceRoot);writeFreshFile(join(out,'variant-manifest.json'),jsonBytes(manifestFor(files,report,zip,out)),sourceRoot);return report;}
export function verifyVerifiedSkyVariant(options,decision){const d=prepare(options);decisionFor(decision,d.proposal);const files=buildData(d),out=options.output,handle=loadSceneKit(join(out,'kit')),ctx=contextFor(handle);
  check(ctx.files.size===[...files.keys()].filter(p=>p.startsWith('kit/')).length&&[...ctx.files].every(([path,bytes])=>files.get('kit/'+path)?.equals(bytes)),'SKY_VARIANT_REPLAY');
  for(const [path,bytes]of files)check(readSelectedFile(join(out,path),16777216).equals(bytes),'SKY_VARIANT_REPLAY');const scene=compileMap(handle,readMap(handle)),reopened=openSceneExport(join(out,'export')),zip=exportSceneArchive(handle,readMap(handle));
  check(reopened.handle.bundleSha256===handle.bundleSha256&&reopened.compiled.contentSha256===scene.contentSha256&&readSelectedFile(join(out,'scene-kit.zip'),268435456).equals(zip),'SKY_VARIANT_EXPORT');
  const report=readJson(join(out,'variant.json'));unseal(report);check(same(report,reportFor(d,handle,scene,zip)),'SKY_VARIANT_REPORT');const manifest=readJson(join(out,'variant-manifest.json'));unseal(manifest);
  check(same(manifest,manifestFor(files,report,zip,out)),'SKY_VARIANT_INVENTORY');verifyInventory(out,manifest);return {status:'verified',reportSha256:report.sha256,kitSha256:handle.bundleSha256,generationCalls:0,finalHumanArtReview:'pending'};}
