import {mkdirSync,writeFileSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {canonicalJson,canonicalMap,clone} from './document.mjs';
import {loadSceneKit,contextFor} from './kit.mjs';
import {compileMap} from './compile.mjs';
import {exportSceneArchive,exportScene,openSceneExport} from './persistence.mjs';
import {makeFreshDirectory,parseJson,readSelectedFile,writeFreshFile} from './files.mjs';
import {check,exact,hash,jsonBytes,seal,unseal} from './generation/common.mjs';
import {resolveTerrainMaterialAppearance} from './terrain-loop-material.mjs';
import {buildTerrainMaterialLoop} from './terrain-material-loop.mjs';
import {reviewScenePlacement} from './scene-placement-review.mjs';
import {validateSharedTerrainFieldProfile,SHARED_TERRAIN_UNION_PROFILE,supportsSharedTerrainAppearance} from './shared-terrain-field.mjs';
const unified=profile=>profile.profile===SHARED_TERRAIN_UNION_PROFILE;
const reportPath=profile=>unified(profile)?'delivery.json':'prototype.json';

export function prepareSharedTerrainLoop(kit,files,options){
  check(!kit.terrainMaterialLoop,'SHARED_FIELD_LOOP_SOURCE');
  exact(options,['usableRows','overlapRows','phaseCount']);
  const source=kit.terrainAppearance?.body?.source,outputPath='materials/body-loop.png';
  check(source&&!files.has(outputPath),'MATERIAL_LOOP_OUTPUT_PATH');
  return buildTerrainMaterialLoop(files.get(source.path),{source,outputPath,...options});
}

function prepare(options){
  exact(options,['root','document','profile','output',...['loopOptions','placement'].filter(key=>Object.hasOwn(options,key))]);
  const original=loadSceneKit(options.root),ctx=contextFor(original),before=compileMap(original,options.document),kit=clone(ctx.kit),files=new Map(ctx.files);
  check(kit.format==='ai_scene_kit_v4'&&!kit.terrainRigidRepeat&&supportsSharedTerrainAppearance(kit.terrainAppearance,options.profile),'SHARED_FIELD_UPGRADE_SOURCE');
  if(Object.hasOwn(options,'loopOptions')){
    check(unified(options.profile),'SHARED_FIELD_LOOP_SOURCE');
    const {png,record}=prepareSharedTerrainLoop(kit,files,options.loopOptions);
    files.set(record.output.source.path,png);
    kit.terrainMaterialLoop=record;
  }
  validateSharedTerrainFieldProfile(options.profile,resolveTerrainMaterialAppearance(kit.terrainAppearance,kit.terrainMaterialLoop));
  check(!options.profile.candidateReview||Array.isArray(options.placement),'SHARED_FIELD_PLACEMENT_REQUIRED');
  const analysis=ctx.model.analyzeMap(options.document);check(options.document.format==='ai_scene_document_v6'&&(unified(options.profile)||!analysis.curves.length)&&!analysis.mixed.length,'SHARED_FIELD_GEOMETRY');
  kit.revision='shared-field-'+hash(jsonBytes({parent:original.bundleSha256,profile:options.profile.sha256,
    ...(Object.hasOwn(options,'loopOptions')?{loop:kit.terrainMaterialLoop.sha256}:{})})).slice(0,16);
  for(const name of ['terrainEdges','terrainBottomEdges','terrainStepCorners'])delete kit[name];kit.terrainSharedField=clone(options.profile);
  const document=canonicalMap(options.document);document.kitRef={kitId:kit.kitId,revision:kit.revision};
  for(const [kind,ref]of Object.entries(kit.files)){
    const entries=kind==='maps'?Object.entries(ref):[[kind,ref]];
    for(const [role,entry]of entries){
      const value=kind==='maps'&&role==='default'?clone(document):parseJson(files.get(entry.path));value.kitRef=clone(document.kitRef);
      const bytes=jsonBytes(value);files.set(entry.path,bytes);entry.sha256=hash(bytes);
    }
  }
  files.set('kit.json',jsonBytes(kit));
  return {original,ctx,before,files,document,profile:options.profile,
    ...(Object.hasOwn(options,'loopOptions')?{loopSha256:kit.terrainMaterialLoop.sha256}:{}),placement:options.placement};
}
function report(data,handle,scene,zip,placement){
  check(canonicalJson(data.before.collisionSuggestions)===canonicalJson(scene.collisionSuggestions),'SHARED_FIELD_COLLISION');
  return seal({format:unified(data.profile)?'ai_scene_shared_terrain_delivery_v2':'ai_scene_shared_terrain_prototype_upgrade_v1',sourceKitSha256:data.original.bundleSha256,kitSha256:handle.bundleSha256,
    profileSha256:data.profile.sha256,authorSha256:scene.source.authorSha256,compiledSha256:scene.contentSha256,
    ...(data.loopSha256?{materialLoopSha256:data.loopSha256}:{}),
    ...(placement?{placementReviewSha256:placement.sha256}:{}),
    originalPngs:[...data.ctx.files].filter(([p])=>p.endsWith('.png')).map(([path,b])=>({path,sha256:hash(b),byteLength:b.length})),
    providedAuthorGeometryChanged:false,presentationGeometryChanged:true,collisionChanged:false,allOriginalPngBytesPreserved:true,
    historicalKitsChanged:false,nativePerimeterArtAcceptance:'not-transferred',scope:unified(data.profile)?'authored-curves-and-ordinary-grid-shared-material':'experimental-ordinary-grid-material-and-boundary',
    zip:{sha256:hash(zip),byteLength:zip.length},generationCalls:0,productionKit:false,finalHumanArtReview:'pending'});
}
function placementReview(data,scene){
  if(data.placement===undefined)return undefined;
  return reviewScenePlacement(scene,data.placement,path=>data.files.get(path));
}
export function upgradeSharedTerrainFieldKit(options){
  const data=prepare(options),out=makeFreshDirectory(options.output,data.ctx.sourceRoot),root=join(out,'kit');mkdirSync(root);
  for(const [path,bytes]of data.files){const p=join(root,...path.split('/'));mkdirSync(dirname(p),{recursive:true});writeFileSync(p,bytes,{flag:'wx'});}
  const handle=loadSceneKit(root),scene=compileMap(handle,data.document),placement=placementReview(data,scene);
  if(placement)writeFreshFile(join(out,'placement-review.json'),jsonBytes(placement),data.ctx.sourceRoot);
  check(!placement||placement.status==='pass','SHARED_FIELD_PLACEMENT_BLOCKED');
  const zip=exportSceneArchive(handle,data.document);
  exportScene(handle,data.document,join(out,'export'));writeFreshFile(join(out,'scene-kit.zip'),zip,data.ctx.sourceRoot);
  const result=report(data,handle,scene,zip,placement);writeFreshFile(join(out,reportPath(data.profile)),jsonBytes(result),data.ctx.sourceRoot);return result;
}
export function verifySharedTerrainFieldKit(options){
  const data=prepare(options),root=join(options.output,'kit');
  for(const [path,bytes]of data.files)check(readSelectedFile(join(root,path),268435456).equals(bytes),'SHARED_FIELD_UPGRADE_REPLAY');
  const handle=loadSceneKit(root),scene=compileMap(handle,data.document),zip=exportSceneArchive(handle,data.document),opened=openSceneExport(join(options.output,'export'));
  const placement=placementReview(data,scene);
  if(placement)check(placement.status==='pass'&&readSelectedFile(join(options.output,'placement-review.json')).equals(jsonBytes(placement)),'SHARED_FIELD_PLACEMENT_REPLAY');
  check(opened.compiled.contentSha256===scene.contentSha256&&canonicalJson(opened.document)===canonicalJson(data.document),'SHARED_FIELD_EXPORT_REPLAY');
  check(readSelectedFile(join(options.output,'scene-kit.zip'),268435456).equals(zip),'SHARED_FIELD_ZIP_REPLAY');
  const saved=parseJson(readSelectedFile(join(options.output,reportPath(data.profile))));unseal(saved);
  check(canonicalJson(saved)===canonicalJson(report(data,handle,scene,zip,placement)),'SHARED_FIELD_UPGRADE_REPLAY');
  return {status:'verified',reportSha256:saved.sha256,kitSha256:handle.bundleSha256,compiledSha256:scene.contentSha256,generationCalls:0,productionKit:false};
}
