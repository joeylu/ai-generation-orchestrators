import {mkdirSync,writeFileSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {canonicalJson,clone} from './document.mjs';
import {loadSceneKit,contextFor,readMap} from './kit.mjs';
import {compileMap} from './compile.mjs';
import {exportScene,exportSceneArchive,openSceneExport} from './persistence.mjs';
import {makeFreshDirectory,parseJson,readSelectedFile,writeFreshFile} from './files.mjs';
import {check,exact,hash,jsonBytes,seal,unseal} from './generation/common.mjs';

export const GRID_BRUSH_PROFILE='grid-solid-union-native-v1';

// A zero-generation, explicit kit revision. Existing v1-v3 packages retain their
// original rendering and compiled replay; no historical source PNG is replaced.
function prepared({root,document}){
  const handle=loadSceneKit(root),context=contextFor(handle),before=document??readMap(handle);
  check(context.kit.terrainEdges?.format==='ai_scene_terrain_edges_v3','GRID_BRUSH_UPGRADE_SOURCE');
  const previous=compileMap(handle,before),files=new Map([...context.files].map(([p,b])=>[p,Buffer.from(b)])),kit=clone(context.kit);
  kit.terrainEdges.format='ai_scene_terrain_edges_v4';kit.terrainEdges.gridProfile=GRID_BRUSH_PROFILE;
  kit.revision='grid-brush-'+hash(canonicalJson({sourceKitSha256:handle.bundleSha256,gridProfile:GRID_BRUSH_PROFILE})).slice(0,16);
  const kitRef={kitId:kit.kitId,revision:kit.revision};
  for(const [kind,ref]of Object.entries(kit.files)){
    const entries=kind==='maps'?Object.values(ref):[ref];
    for(const entry of entries){const value=parseJson(files.get(entry.path));value.kitRef=kitRef;
      const bytes=jsonBytes(value);files.set(entry.path,bytes);entry.sha256=hash(bytes);}
  }
  files.set('kit.json',jsonBytes(kit));
  const next=clone(before);next.kitRef=kitRef;
  const plain=value=>{const copied=clone(value);delete copied.kitRef;return canonicalJson(copied);};
  check(plain(before)===plain(next),'GRID_BRUSH_AUTHOR_GEOMETRY');
  const assets=[...files].filter(([p])=>p.endsWith('.png')).map(([path,bytes])=>{
    check(context.files.get(path)?.equals(bytes),'GRID_BRUSH_SOURCE_BYTES');return {path,sha256:hash(bytes),byteLength:bytes.length};
  });
  return {handle,context,previous,files,document:next,assets};
}

function report(prepared,handle,scene,archive){
  check(canonicalJson(prepared.previous.collisionSuggestions)===canonicalJson(scene.collisionSuggestions),'GRID_BRUSH_COLLISION');
  return seal({format:'ai_scene_grid_brush_upgrade_v1',profile:GRID_BRUSH_PROFILE,
    sourceKitSha256:prepared.handle.bundleSha256,kitSha256:handle.bundleSha256,
    previousAuthorSha256:prepared.previous.source.authorSha256,authorSha256:scene.source.authorSha256,
    compiledSha256:scene.contentSha256,geometryChanged:false,collisionChanged:false,
    originalPngs:prepared.assets,allOriginalPngBytesPreserved:true,
    gridComponents:scene.gridTerrains?.length??0,meshGridCells:scene.gridTerrains?.reduce((n,p)=>n+p.source.gridCells.length,0)??0,
    zip:{sha256:hash(archive),byteLength:archive.length},generationCalls:0,artAcceptance:'not-assessed'});
}

export function upgradeTerrainBrushKit(options){
  exact(options,['root','document','output']);const data=prepared(options);
  const out=makeFreshDirectory(options.output,data.context.sourceRoot),kitRoot=join(out,'kit');mkdirSync(kitRoot);
  for(const [path,bytes]of data.files){const target=join(kitRoot,...path.split('/'));mkdirSync(dirname(target),{recursive:true});writeFileSync(target,bytes,{flag:'wx'});}
  const handle=loadSceneKit(kitRoot),scene=compileMap(handle,data.document),archive=exportSceneArchive(handle,data.document);
  exportScene(handle,data.document,join(out,'export'));
  writeFreshFile(join(out,'scene-kit.zip'),archive,data.context.sourceRoot);
  const receipt=report(data,handle,scene,archive);writeFreshFile(join(out,'upgrade.json'),jsonBytes(receipt),data.context.sourceRoot);return receipt;
}

export function verifyTerrainBrushKit(options){
  exact(options,['root','document','output']);const data=prepared(options),handle=loadSceneKit(join(options.output,'kit')),context=contextFor(handle);
  check(context.files.size===data.files.size&&[...data.files].every(([p,b])=>context.files.get(p)?.equals(b)),'GRID_BRUSH_UPGRADE_REPLAY');
  const opened=openSceneExport(join(options.output,'export')),scene=compileMap(handle,data.document),archive=exportSceneArchive(handle,data.document);
  check(canonicalJson(opened.document)===canonicalJson(data.document)&&opened.compiled.contentSha256===scene.contentSha256,'GRID_BRUSH_EXPORT_REPLAY');
  check(readSelectedFile(join(options.output,'scene-kit.zip'),268435456).equals(archive),'GRID_BRUSH_ZIP_REPLAY');
  const saved=parseJson(readSelectedFile(join(options.output,'upgrade.json'),2097152));unseal(saved);
  check(canonicalJson(saved)===canonicalJson(report(data,handle,scene,archive)),'GRID_BRUSH_RECEIPT_REPLAY');
  return {status:'verified',receiptSha256:saved.sha256,kitSha256:handle.bundleSha256,authorSha256:scene.source.authorSha256,
    compiledSha256:scene.contentSha256,generationCalls:0,artAcceptance:'not-assessed'};
}
