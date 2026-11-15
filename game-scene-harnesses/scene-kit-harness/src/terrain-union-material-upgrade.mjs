import {mkdirSync,writeFileSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {canonicalJson,clone} from './document.mjs';
import {loadSceneKit,contextFor,readMap} from './kit.mjs';
import {compileMap} from './compile.mjs';
import {exportScene,exportSceneArchive,openSceneExport} from './persistence.mjs';
import {makeFreshDirectory,parseJson,readSelectedFile,writeFreshFile} from './files.mjs';
import {check,exact,hash,jsonBytes,seal,unseal} from './generation/common.mjs';
import {TERRAIN_UNION_MATERIAL_PROFILE} from './terrain-union-material.mjs';

// This explicit revision changes material coordinates and exposed-surface
// presentation only. The original sources, author solids and older packages
// retain their independent identities; no image adapter is involved.
function prepared(options){
  exact(options,['root','document','output']);
  const handle=loadSceneKit(options.root),context=contextFor(handle),before=options.document??readMap(handle);
  check(context.kit.terrainEdges?.format==='ai_scene_terrain_edges_v5','TERRAIN_UNION_UPGRADE_SOURCE');
  const previous=compileMap(handle,before),files=new Map([...context.files].map(([path,bytes])=>[path,Buffer.from(bytes)])),kit=clone(context.kit);
  kit.terrainEdges={...kit.terrainEdges,format:'ai_scene_terrain_edges_v6',materialProfile:TERRAIN_UNION_MATERIAL_PROFILE};
  kit.revision='union-material-'+hash(canonicalJson({sourceKitSha256:handle.bundleSha256,materialProfile:TERRAIN_UNION_MATERIAL_PROFILE})).slice(0,16);
  const kitRef={kitId:kit.kitId,revision:kit.revision};
  for(const [kind,ref]of Object.entries(kit.files))for(const entry of kind==='maps'?Object.values(ref):[ref]){
    const value=parseJson(files.get(entry.path));value.kitRef=kitRef;
    const bytes=jsonBytes(value);files.set(entry.path,bytes);entry.sha256=hash(bytes);
  }
  files.set('kit.json',jsonBytes(kit));const document=clone(before);document.kitRef=kitRef;
  const plain=value=>{const author=clone(value);delete author.kitRef;return canonicalJson(author);};
  check(plain(before)===plain(document),'TERRAIN_UNION_AUTHOR_GEOMETRY');
  const originalPngs=[...files].filter(([path])=>path.endsWith('.png')).map(([path,bytes])=>{
    check(context.files.get(path)?.equals(bytes),'TERRAIN_UNION_SOURCE_BYTES');
    return {path,sha256:hash(bytes),byteLength:bytes.length};
  });
  return {handle,context,previous,files,document,originalPngs};
}

function receipt(data,handle,scene,zip){
  check(canonicalJson(data.previous.collisionSuggestions)===canonicalJson(scene.collisionSuggestions),'TERRAIN_UNION_COLLISION');
  return seal({format:'ai_scene_terrain_union_material_upgrade_v1',profile:TERRAIN_UNION_MATERIAL_PROFILE,
    sourceKitSha256:data.handle.bundleSha256,kitSha256:handle.bundleSha256,previousAuthorSha256:data.previous.source.authorSha256,
    authorSha256:scene.source.authorSha256,compiledSha256:scene.contentSha256,
    originalPngs:data.originalPngs,allOriginalPngBytesPreserved:true,geometryChanged:false,collisionChanged:false,
    zip:{sha256:hash(zip),byteLength:zip.length},generationCalls:0,artAcceptance:'not-assessed'});
}

export function upgradeTerrainUnionMaterialKit(options){
  const data=prepared(options),out=makeFreshDirectory(options.output,data.context.sourceRoot),kitRoot=join(out,'kit');mkdirSync(kitRoot);
  for(const [path,bytes]of data.files){const file=join(kitRoot,...path.split('/'));mkdirSync(dirname(file),{recursive:true});writeFileSync(file,bytes,{flag:'wx'});}
  const handle=loadSceneKit(kitRoot),scene=compileMap(handle,data.document),zip=exportSceneArchive(handle,data.document);
  exportScene(handle,data.document,join(out,'export'));
  writeFreshFile(join(out,'scene-kit.zip'),zip,data.context.sourceRoot);
  const result=receipt(data,handle,scene,zip);writeFreshFile(join(out,'upgrade.json'),jsonBytes(result),data.context.sourceRoot);return result;
}

export function verifyTerrainUnionMaterialKit(options){
  const data=prepared(options),handle=loadSceneKit(join(options.output,'kit')),context=contextFor(handle);
  check(context.files.size===data.files.size&&[...data.files].every(([path,bytes])=>context.files.get(path)?.equals(bytes)),'TERRAIN_UNION_KIT_REPLAY');
  const reopened=openSceneExport(join(options.output,'export')),scene=compileMap(handle,data.document),zip=exportSceneArchive(handle,data.document);
  check(canonicalJson(reopened.document)===canonicalJson(data.document)&&reopened.compiled.contentSha256===scene.contentSha256,'TERRAIN_UNION_EXPORT_REPLAY');
  check(readSelectedFile(join(options.output,'scene-kit.zip'),268435456).equals(zip),'TERRAIN_UNION_ZIP_REPLAY');
  const saved=parseJson(readSelectedFile(join(options.output,'upgrade.json')));unseal(saved);
  check(canonicalJson(saved)===canonicalJson(receipt(data,handle,scene,zip)),'TERRAIN_UNION_RECEIPT_REPLAY');
  return {status:'verified',receiptSha256:saved.sha256,kitSha256:handle.bundleSha256,authorSha256:scene.source.authorSha256,
    compiledSha256:scene.contentSha256,profile:TERRAIN_UNION_MATERIAL_PROFILE,generationCalls:0,artAcceptance:'not-assessed'};
}
