import {mkdirSync,writeFileSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {canonicalJson,clone} from './document.mjs';
import {loadSceneKit,contextFor,readMap} from './kit.mjs';
import {compileMap} from './compile.mjs';
import {exportScene,exportSceneArchive,openSceneExport} from './persistence.mjs';
import {makeFreshDirectory,parseJson,readSelectedFile,writeFreshFile} from './files.mjs';
import {check,exact,hash,jsonBytes,seal,unseal} from './generation/common.mjs';
import {buildTerrainStepCornerProfile} from './terrain-step-corners.mjs';

const profile='concave-source-surface-ramp-v1';
function configuration(options){
  exact(options,['widthWorld','heightWorld']);
  return buildTerrainStepCornerProfile(options);
}

// Explicit presentation-only revision. The native PNGs, prior kit and author
// topology remain independent; no generation or per-map hand-patching occurs.
function prepared(options){
  exact(options,['root','document','output','cornerOptions']);
  const handle=loadSceneKit(options.root),context=contextFor(handle),before=options.document??readMap(handle);
  check(context.kit.terrainEdges?.format==='ai_scene_terrain_edges_v6'
    &&!Object.hasOwn(context.kit,'terrainStepCorners'),'TERRAIN_STEP_CORNER_UPGRADE_SOURCE');
  const config=configuration(options.cornerOptions),previous=compileMap(handle,before),
    files=new Map([...context.files].map(([path,bytes])=>[path,Buffer.from(bytes)])),kit=clone(context.kit),
    stepCornersSha256=hash(canonicalJson(config));
  kit.terrainStepCorners=config;
  kit.revision='step-corner-'+hash(canonicalJson({sourceKitSha256:handle.bundleSha256,stepCornersSha256})).slice(0,16);
  const kitRef={kitId:kit.kitId,revision:kit.revision};
  for(const [kind,ref]of Object.entries(kit.files))for(const entry of kind==='maps'?Object.values(ref):[ref]){
    const value=parseJson(files.get(entry.path));value.kitRef=kitRef;
    const bytes=jsonBytes(value);files.set(entry.path,bytes);entry.sha256=hash(bytes);
  }
  files.set('kit.json',jsonBytes(kit));const document=clone(before);document.kitRef=kitRef;
  const plain=value=>{const author=clone(value);delete author.kitRef;return canonicalJson(author);};
  check(plain(before)===plain(document),'TERRAIN_STEP_CORNER_AUTHOR_GEOMETRY');
  const originalPngs=[...files].filter(([path])=>path.endsWith('.png')).map(([path,bytes])=>{
    check(bytes.equals(context.files.get(path)),'TERRAIN_STEP_CORNER_SOURCE_BYTES');
    return {path,sha256:hash(bytes),byteLength:bytes.length};
  });
  return {handle,context,previous,files,document,originalPngs,config,stepCornersSha256};
}

function receipt(data,handle,scene,zip){
  check(canonicalJson(data.previous.collisionSuggestions)===canonicalJson(scene.collisionSuggestions),'TERRAIN_STEP_CORNER_COLLISION');
  return seal({format:'ai_scene_terrain_step_corner_upgrade_v1',profile,
    sourceKitSha256:data.handle.bundleSha256,kitSha256:handle.bundleSha256,previousAuthorSha256:data.previous.source.authorSha256,
    authorSha256:scene.source.authorSha256,compiledSha256:scene.contentSha256,stepCornersSha256:data.stepCornersSha256,
    cornerConfiguration:clone(data.config),originalPngs:data.originalPngs,allOriginalPngBytesPreserved:true,addedPngFiles:0,
    geometryChanged:false,authorGeometryChanged:false,visualBoundaryChanged:true,collisionChanged:false,
    zip:{sha256:hash(zip),byteLength:zip.length},generationCalls:0,artAcceptance:'not-assessed'});
}

export function upgradeTerrainStepCornerKit(options){
  const data=prepared(options),out=makeFreshDirectory(options.output,data.context.sourceRoot),kitRoot=join(out,'kit');mkdirSync(kitRoot);
  for(const [path,bytes]of data.files){const file=join(kitRoot,...path.split('/'));mkdirSync(dirname(file),{recursive:true});writeFileSync(file,bytes,{flag:'wx'});}
  const handle=loadSceneKit(kitRoot),scene=compileMap(handle,data.document),zip=exportSceneArchive(handle,data.document);
  exportScene(handle,data.document,join(out,'export'));
  writeFreshFile(join(out,'scene-kit.zip'),zip,data.context.sourceRoot);
  writeFreshFile(join(out,'step-corners.json'),jsonBytes(data.config),data.context.sourceRoot);
  const result=receipt(data,handle,scene,zip);writeFreshFile(join(out,'upgrade.json'),jsonBytes(result),data.context.sourceRoot);return result;
}

export function verifyTerrainStepCornerKit(options){
  const data=prepared(options),handle=loadSceneKit(join(options.output,'kit')),context=contextFor(handle);
  check(context.files.size===data.files.size&&[...data.files].every(([path,bytes])=>context.files.get(path)?.equals(bytes)),'TERRAIN_STEP_CORNER_KIT_REPLAY');
  const reopened=openSceneExport(join(options.output,'export')),scene=compileMap(handle,data.document),zip=exportSceneArchive(handle,data.document);
  check(canonicalJson(reopened.document)===canonicalJson(data.document)&&reopened.compiled.contentSha256===scene.contentSha256,'TERRAIN_STEP_CORNER_EXPORT_REPLAY');
  check(readSelectedFile(join(options.output,'scene-kit.zip'),268435456).equals(zip),'TERRAIN_STEP_CORNER_ZIP_REPLAY');
  check(readSelectedFile(join(options.output,'step-corners.json'),2097152).equals(jsonBytes(data.config)),'TERRAIN_STEP_CORNER_CONFIG_REPLAY');
  const saved=parseJson(readSelectedFile(join(options.output,'upgrade.json'),2097152));unseal(saved);
  check(canonicalJson(saved)===canonicalJson(receipt(data,handle,scene,zip)),'TERRAIN_STEP_CORNER_RECEIPT_REPLAY');
  return {status:'verified',receiptSha256:saved.sha256,kitSha256:handle.bundleSha256,authorSha256:scene.source.authorSha256,
    compiledSha256:scene.contentSha256,stepCornersSha256:data.stepCornersSha256,profile,generationCalls:0,artAcceptance:'not-assessed'};
}
