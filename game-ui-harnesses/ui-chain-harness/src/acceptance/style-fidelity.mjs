import {join,resolve,relative,isAbsolute,sep} from 'node:path';
import {isDeepStrictEqual} from 'node:util';
import {hash,readSafe,verifySkinPackage} from '../skins/package.mjs';
import {taskStatus} from '../skins/task-dag.mjs';
import {inspectGenerationBatch} from '../skin-generation/batch-intake.mjs';
import {readMaterialAtlasInput} from '../skins/material-atlas-input.mjs';
import {verifyMaterialAtlas,extractMaterialAtlas} from '../skins/material-atlas.mjs';
import {verifyMaterialExtension} from '../skins/materials.mjs';
import {upgradedConsumer} from '../studio/component-upgrade.mjs';
import {inspectConsumer} from '../runtime/consumer-tools.mjs';

const fail=code=>{throw Object.assign(Error(code),{code});};
const digest=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const styleIds=['concept-art','pixel-cartoon','anime-cel','western-cartoon','fantasy-handpainted','chinese-fantasy'];
const surfaces={title:'material.title-band',section:'material.section-band',panel:'material.panel-fill'};
function workPath(root,file){const path=resolve(root,file),r=relative(join(resolve(root),'work'),path);if(isAbsolute(r)||r==='..'||r.startsWith('..'+sep))fail('ACCEPTANCE_STYLE_PROVENANCE_PATH');return path;}

export function acceptanceMode(value){
 const mode=value??'compatibility';if(!['compatibility','style-fidelity'].includes(mode))fail('ACCEPTANCE_MODE_INVALID');return mode;
}
export function acceptanceAssessment(batch,technicalStatus='pending'){
 const mode=acceptanceMode(batch.acceptanceMode);
 return {acceptanceMode:mode,technicalAcceptance:{status:technicalStatus},styleFidelity:{status:mode==='compatibility'?'not-assessed':technicalStatus==='passed'?'awaiting-visual-review':'incomplete',sourceEvidence:mode==='compatibility'?'not-required':'verified',visualAcceptance:'unreviewed',productionReady:false},visualAcceptance:'unreviewed',productionReady:false};
}
export async function canonicalStyleReferences(root){
 const config=JSON.parse(await readSafe(root,'configs/studio-styles.json'));
 if(config.version!=='1.0'||config.entries?.length!==styleIds.length||new Set(config.entries.map(s=>s.id)).size!==styleIds.length||config.entries.some(s=>!styleIds.includes(s.id)||!digest(s.sha256)))fail('ACCEPTANCE_STYLE_CATALOG_INVALID');
 for(const style of config.entries)if(hash(await readSafe(root,style.image))!==style.sha256)fail('ACCEPTANCE_STYLE_CHANGED');
 return config.entries;
}

/** The inputs here are results of the read-only archival and pixel verifiers below. */
export function validateStyleFidelityBindings({verified,reference,intake,material,extraction}){
 const summary=intake.summary,s05=summary?.nodes?.find(n=>n.sheetId==='S05');
 if(summary?.referenceSha256!==reference.sha256)fail('ACCEPTANCE_STYLE_REFERENCE_MISMATCH');
 if(summary?.status!=='received-awaiting-localization'||summary.nodes.length!==5||new Set(summary.nodes.map(n=>n.sheetId)).size!==5||!['S01','S02','S03','S04','S05'].every(id=>summary.nodes.some(n=>n.sheetId===id&&n.status==='received'&&digest(n.planSha256)&&digest(n.rawSha256))))fail('ACCEPTANCE_STYLE_S05_REQUIRED');
 const source=intake.materialSources?.find(s=>s.sheetId==='S05');
 if(intake.materialSources?.length!==1||!source||source.sha256!==s05.rawSha256||source.planSha256!==s05.planSha256||material.input?.planSha256!==s05.planSha256||material.input?.raw?.sha256!==s05.rawSha256||material.template?.sha256!==source.template?.sha256||extraction.report?.source?.sha256!==s05.rawSha256||extraction.report.templateSha256!==material.template.sha256)fail('ACCEPTANCE_STYLE_PROVENANCE_INVALID');
 const bindings=[];
 for(const [key,assetId]of Object.entries(surfaces)){
  const expected=extraction.spec?.materials?.find(m=>m.assetId===assetId),asset=verified.pack.materialAssets?.find(a=>a.assetId===assetId),style=verified.pack.surfaceStyles?.[key];
  if(!expected||!asset||!style||!isDeepStrictEqual(style,extraction.spec.surfaceStyles?.[key])||!style.layers?.some(l=>l.assetId===assetId)||asset.source?.sha256!==expected.sha256||!isDeepStrictEqual(asset.source?.crop,expected.crop)||!digest(asset.sha256))fail('ACCEPTANCE_STYLE_BINDINGS_INVALID');
  bindings.push({surface:key,assetId,sha256:asset.sha256,sourceSha256:asset.source.sha256,crop:asset.source.crop});
 }
 return bindings;
}


/** Strict metadata-only upgrade of results already bound to a verified S05. */
export function validateStyleFidelityInkUpgrade({original,verified,extension,previousExtraction,currentExtraction}){
 if(currentExtraction.report?.version!=='1.2'||!isDeepStrictEqual(previousExtraction.spec.materials,currentExtraction.spec.materials)||!isDeepStrictEqual(original.pack.materialAssets,verified.pack.materialAssets))fail('ACCEPTANCE_STYLE_INK_UPGRADE_INVALID');
 verifyMaterialExtension(original,verified,extension);
 const expected=structuredClone(original.pack.surfaceStyles);
 for(const key of ['title','section'])expected[key].textColor=currentExtraction.spec.surfaceStyles[key].textColor;
 expected.panel.layers[0].mode=currentExtraction.spec.surfaceStyles.panel.layers[0].mode;
 if(!isDeepStrictEqual(verified.pack.surfaceStyles,expected)||!isDeepStrictEqual(expected,currentExtraction.spec.surfaceStyles))fail('ACCEPTANCE_STYLE_INK_UPGRADE_INVALID');
 return {kind:'ui_style_material_ink_upgrade',version:'1.0',extractionVersion:'1.2',sourceSkinSha256:original.manifestSha256,skinSha256:verified.manifestSha256,allowedChanges:['title.textColor','section.textColor','panel.layers[0].mode'],sourceSamplingStatus:currentExtraction.report.textReadability.sourceSamplingStatus,visualAcceptance:'unreviewed',modelCalls:0};
}

/** Official runtime/check chain plus exact derived inks; no arbitrary recipes. */
export async function verifyStyleFidelityRuntimeUpgrade({root,selection,originalDirectory,original,verified,previousExtraction,currentExtraction,record}){
 if(!selection||typeof selection!=='object'||Array.isArray(selection)||Object.keys(selection).length!==2||!Object.hasOwn(selection,'file')||!Object.hasOwn(selection,'sha256')||typeof selection.file!=='string'||!/^work\/(?:[A-Za-z0-9_-]+\/)+[A-Za-z0-9_.-]+$/.test(selection.file)||!digest(selection.sha256))fail('ACCEPTANCE_STYLE_INK_UPGRADE_REFERENCE');
 const upgradeBytes=await record(selection.file,undefined,selection.sha256),upgrade=JSON.parse(upgradeBytes);
 if(upgrade.originalSkinSha256!==original.manifestSha256||upgrade.skinSha256!==verified.manifestSha256||!upgrade.materialExtension)fail('ACCEPTANCE_STYLE_INK_UPGRADE_INVALID');
 const selected=await upgradedConsumer(root,workPath(root,originalDirectory),selection);
 const upgraded=await verifySkinPackage(join(selected.directory,'skin'));
 if(upgraded.manifestSha256!==verified.manifestSha256)fail('ACCEPTANCE_STYLE_INK_UPGRADE_INVALID');
 const extensionBytes=await record(upgrade.materialExtension.file,undefined,upgrade.materialExtension.sha256),extension=JSON.parse(extensionBytes);
 const proof=validateStyleFidelityInkUpgrade({original,verified,extension,previousExtraction,currentExtraction});
 await record(upgrade.checkFile,undefined,upgrade.checkSha256);
 const consumer=await inspectConsumer(selected.directory,upgrade.consumerSha256);
 await record(join(selected.directory,'manifest.json'),undefined,consumer.manifestSha256);
 for(const [file,bytes]of consumer.files)await record(join(selected.directory,file),bytes);
 await record(join(selected.directory,'skin','skin-pack.json'),undefined,verified.manifestSha256);
 for(const [file,bytes]of verified.resources)await record(join(selected.directory,'skin',file),bytes);
 // Recheck exact record binding after gathering every derived fingerprint.
 await record(selection.file,undefined,selection.sha256);
 return {...proof,selection:{...selection},consumerSha256:consumer.manifestSha256,extensionSha256:upgrade.materialExtension.sha256};
}

/** Eligibility only: this verifies retained producer evidence and never invokes a model. */
export async function verifyStyleFidelitySkin({root,selected,verified,contracts,references,styleId}){
 const mapping=selected.styleReference,reference=references.find(s=>s.id===mapping?.id);
 if(!mapping||!reference||mapping.sha256!==reference.sha256||styleId&&styleId!==reference.id)fail('ACCEPTANCE_STYLE_REFERENCE_REQUIRED');
 if(!selected.skinTaskDirectory)fail('ACCEPTANCE_STYLE_PROVENANCE_REQUIRED');
 if(Object.entries(surfaces).some(([key,id])=>!verified.pack.surfaceStyles?.[key]?.layers?.some(l=>l.assetId===id)||!verified.pack.materialAssets?.some(a=>a.assetId===id)))fail('ACCEPTANCE_STYLE_S05_REQUIRED');
 const taskDirectory=workPath(root,selected.skinTaskDirectory),evidence=new Map();
 const record=async(file,bytes,expected)=>{const path=workPath(root,file),name=relative(resolve(root),path).split(sep).join('/'),raw=bytes??await readSafe(root,name),sha256=hash(raw);if(expected!==undefined&&sha256!==expected||evidence.has(name)&&evidence.get(name)!==sha256)fail('ACCEPTANCE_STYLE_PROVENANCE_CHANGED');evidence.set(name,sha256);return raw;};
 try{
  const state=await taskStatus(taskDirectory,async files=>{for(const f of files)await record(f.file,undefined,f.sha256);});
  await record(join(taskDirectory,'request.json'),undefined,state.requestSha256);
  for(const [id,receipt]of state.receipts)await record(join(taskDirectory,'receipts',id+'.json'),undefined,receipt.sha256);
  if(state.request.kind!=='ui_skin_task'||state.request.version!=='1.0'||state.request.entry!=='received-generation-batch'||state.status!=='awaiting-visual-review'||!state.request.batch||!state.request.materialAtlas)fail('ACCEPTANCE_STYLE_PROVENANCE_INVALID');
  const archive=join(taskDirectory,'input/generation'),intake=await inspectGenerationBatch({skinDirectory:archive,batchSha256:state.request.batch.sha256,templateSha256:hash(contracts.bytes.template),sheets:contracts.template.sheets});
  for(const f of intake.evidence)await record(join(archive,f.file),f.bytes,f.sha256);
  const material=await readMaterialAtlasInput(workPath(root,state.request.materialAtlas)),post=state.receipts.get('postprocess'),runDirectory=post?.outputs?.directory;
  if(!runDirectory)fail('ACCEPTANCE_STYLE_PROVENANCE_INVALID');
  const run=JSON.parse(await record(join(workPath(root,runDirectory),'run.json'))),assemble=run.stages?.find(s=>s.stage==='assemble'&&s.status==='passed'),bound=run.stages?.find(s=>s.stage==='material-extract-and-bind'&&s.status==='passed');
  if(!assemble?.result?.directory||!bound?.extractionDirectory||bound.inputSha256!==material.inputSha256||bound.rawSha256!==material.input.raw.sha256||bound.templateSha256!==material.template.sha256||bound.planSha256!==material.input.planSha256)fail('ACCEPTANCE_STYLE_PROVENANCE_INVALID');
  const original=selected.componentRuntime!==undefined?await verifySkinPackage(workPath(root,join(run.consumerDirectory,'skin'))):verified;
  if(bound.manifestSha256!==original.manifestSha256)fail('ACCEPTANCE_STYLE_PROVENANCE_INVALID');
  const base=await verifySkinPackage(workPath(root,join(assemble.result.directory,'pack')));
  if(base.manifestSha256!==assemble.result.manifestSha256)fail('ACCEPTANCE_STYLE_PROVENANCE_INVALID');
  const extraction=await verifyMaterialAtlas({directory:workPath(root,bound.extractionDirectory),template:material.template,sourceSkinSha256:base.manifestSha256,rawSha256:material.input.raw.sha256,pack:base.pack});
  let bindings=validateStyleFidelityBindings({verified:original,reference,intake,material,extraction}),materialUpgrade;
  if(selected.componentRuntime!==undefined){
   const currentExtraction=extractMaterialAtlas({raw:material.raw,template:material.template,sourceSkinSha256:base.manifestSha256,rawSha256:material.input.raw.sha256,pack:base.pack,extractionVersion:'1.2'});
   materialUpgrade=await verifyStyleFidelityRuntimeUpgrade({root,selection:selected.componentRuntime,originalDirectory:run.consumerDirectory,original,verified,previousExtraction:extraction,currentExtraction,record});
   bindings=validateStyleFidelityBindings({verified,reference,intake,material,extraction:currentExtraction});
  }
  // The whole completed DAG inventory includes localization, source recovery,
  // material extraction and the final consumer package. Retain its fingerprints.
  return {kind:'ui_panel_style_fidelity_evidence',version:'1.0',reference:{id:reference.id,sha256:reference.sha256},skinSha256:verified.manifestSha256,taskRequestSha256:state.requestSha256,batchSha256:intake.summary.batchSha256,styleSha256:intake.summary.styleSha256,originalChecksPassed:intake.summary.originalChecksPassed,sheets:intake.summary.nodes.map(n=>({sheetId:n.sheetId,planSha256:n.planSha256,rawSha256:n.rawSha256,inspection:n.inspection})),material:{planSha256:material.input.planSha256,rawSha256:material.input.raw.sha256,templateSha256:material.template.sha256,sourceSkinSha256:base.manifestSha256,...(extraction.report.derivedSource?{derivedSourceSha256:extraction.report.derivedSource.sha256}:{})},bindings,...(materialUpgrade?{materialUpgrade}:{}),files:[...evidence].sort(([a],[b])=>a.localeCompare(b)).map(([file,sha256])=>({file,sha256})),modelCalls:0,visualAcceptance:'unreviewed',productionReady:false};
 }catch(e){if(e.code?.startsWith('ACCEPTANCE_'))throw e;fail('ACCEPTANCE_STYLE_PROVENANCE_INVALID');}
}

export function validateBatchStyleScope(batch){
 if(acceptanceMode(batch.acceptanceMode)!=='style-fidelity')return;
 if(!Array.isArray(batch.styleSkins)||!batch.styleSkins.length||new Set(batch.styleSkins.map(s=>s.skin)).size!==batch.styleSkins.length)fail('ACCEPTANCE_STYLE_PROVENANCE_REQUIRED');
 for(const entry of batch.cases){const skin=batch.styleSkins.find(s=>s.skin===entry.skin);if(!skin||skin.skinSha256!==entry.skinSha256||!batch.files.some(f=>f.file===skin.file)||!batch.styleReferences?.some(r=>r.id===skin.reference?.id&&r.sha256===skin.reference.sha256))fail('ACCEPTANCE_STYLE_PROVENANCE_INVALID');}
}
export async function verifyBatchStyleEvidence({root,directory,batch}){
 validateBatchStyleScope(batch);if(acceptanceMode(batch.acceptanceMode)!=='style-fidelity')return;
 for(const skin of batch.styleSkins){const proof=JSON.parse(await readSafe(directory,skin.file));
  if(proof.kind!=='ui_panel_style_fidelity_evidence'||proof.version!=='1.0'||proof.skinSha256!==skin.skinSha256||!isDeepStrictEqual(proof.reference,skin.reference)||proof.bindings?.length!==3||!Array.isArray(proof.files)||!proof.files.length)fail('ACCEPTANCE_STYLE_PROVENANCE_INVALID');
  for(const f of proof.files){const path=workPath(root,f.file);if(hash(await readSafe(root,relative(resolve(root),path).split(sep).join('/')))!==f.sha256)fail('ACCEPTANCE_STYLE_PROVENANCE_CHANGED');}
 }
}
