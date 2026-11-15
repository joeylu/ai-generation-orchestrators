import {mkdirSync,writeFileSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {canonicalJson,clone} from './document.mjs';
import {loadSceneKit,contextFor,readMap} from './kit.mjs';
import {compileMap} from './compile.mjs';
import {exportScene,exportSceneArchive,openSceneExport} from './persistence.mjs';
import {makeFreshDirectory,parseJson,readSelectedFile,writeFreshFile} from './files.mjs';
import {check,exact,hash,jsonBytes,seal,unseal} from './generation/common.mjs';
import {buildTerrainEdgeJunctions} from './terrain-edge-junction.mjs';

function prepared(options){
  const supplied=Object.hasOwn(options??{},'junctionOptions');
  exact(options,['root','document','output',...(supplied?['junctionOptions']:[])]);
  const handle=loadSceneKit(options.root),context=contextFor(handle),before=options.document??readMap(handle);
  check(context.kit.terrainEdges?.format==='ai_scene_terrain_edges_v4','TERRAIN_JUNCTION_UPGRADE_SOURCE');
  const previous=compileMap(handle,before),files=new Map([...context.files].map(([p,b])=>[p,Buffer.from(b)])),kit=clone(context.kit);
  const junctionOptions=supplied?options.junctionOptions:{};
  check(junctionOptions&&typeof junctionOptions==='object'&&!Array.isArray(junctionOptions),'TERRAIN_JUNCTION_OPTIONS');
  check(Object.keys(junctionOptions).every(k=>['firstWallNativeOriginWorld','wallStepWorld','wallRepeatProfile'].includes(k)),'TERRAIN_JUNCTION_OPTIONS');
  const junctions=buildTerrainEdgeJunctions(kit.terrainEdges,{readAsset:p=>context.files.get(p),...junctionOptions});
  kit.terrainEdges={...kit.terrainEdges,format:'ai_scene_terrain_edges_v5',junctions};
  kit.revision='edge-junction-'+hash(canonicalJson({sourceKitSha256:handle.bundleSha256,junctionsSha256:junctions.sha256})).slice(0,16);
  const kitRef={kitId:kit.kitId,revision:kit.revision};
  for(const [kind,ref]of Object.entries(kit.files))for(const entry of kind==='maps'?Object.values(ref):[ref]){
    const value=parseJson(files.get(entry.path));value.kitRef=kitRef;const bytes=jsonBytes(value);files.set(entry.path,bytes);entry.sha256=hash(bytes);
  }
  files.set('kit.json',jsonBytes(kit));const next=clone(before);next.kitRef=kitRef;
  const plain=v=>{const c=clone(v);delete c.kitRef;return canonicalJson(c);};
  check(plain(before)===plain(next),'TERRAIN_JUNCTION_AUTHOR_GEOMETRY');
  const originalPngs=[...files].filter(([p])=>p.endsWith('.png')).map(([path,bytes])=>{
    check(context.files.get(path)?.equals(bytes),'TERRAIN_JUNCTION_SOURCE_BYTES');return {path,sha256:hash(bytes),byteLength:bytes.length};
  });return {handle,context,previous,files,document:next,originalPngs,junctions};
}
function receipt(data,handle,scene,zip){
  check(canonicalJson(data.previous.collisionSuggestions)===canonicalJson(scene.collisionSuggestions),'TERRAIN_JUNCTION_COLLISION');
  return seal({format:'ai_scene_terrain_edge_junction_upgrade_v1',profile:data.junctions.profile,
    sourceKitSha256:data.handle.bundleSha256,kitSha256:handle.bundleSha256,previousAuthorSha256:data.previous.source.authorSha256,
    authorSha256:scene.source.authorSha256,compiledSha256:scene.contentSha256,junctionsSha256:data.junctions.sha256,
    originalPngs:data.originalPngs,allOriginalPngBytesPreserved:true,geometryChanged:false,collisionChanged:false,
    zip:{sha256:hash(zip),byteLength:zip.length},generationCalls:0,artAcceptance:'not-assessed'});
}
export function upgradeTerrainEdgeJunctionKit(options){
  const data=prepared(options),out=makeFreshDirectory(options.output,data.context.sourceRoot),kitRoot=join(out,'kit');mkdirSync(kitRoot);
  for(const [path,bytes]of data.files){const file=join(kitRoot,...path.split('/'));mkdirSync(dirname(file),{recursive:true});writeFileSync(file,bytes,{flag:'wx'});}
  const handle=loadSceneKit(kitRoot),scene=compileMap(handle,data.document),zip=exportSceneArchive(handle,data.document);
  exportScene(handle,data.document,join(out,'export'));
  for(const [name,bytes]of [['scene-kit.zip',zip],['junctions.json',jsonBytes(data.junctions)]])writeFreshFile(join(out,name),bytes,data.context.sourceRoot);
  const result=receipt(data,handle,scene,zip);writeFreshFile(join(out,'upgrade.json'),jsonBytes(result),data.context.sourceRoot);return result;
}
export function verifyTerrainEdgeJunctionKit(options){
  const data=prepared(options),handle=loadSceneKit(join(options.output,'kit')),context=contextFor(handle);
  check(context.files.size===data.files.size&&[...data.files].every(([p,b])=>context.files.get(p)?.equals(b)),'TERRAIN_JUNCTION_KIT_REPLAY');
  const reopened=openSceneExport(join(options.output,'export')),scene=compileMap(handle,data.document),zip=exportSceneArchive(handle,data.document);
  check(canonicalJson(reopened.document)===canonicalJson(data.document)&&reopened.compiled.contentSha256===scene.contentSha256,'TERRAIN_JUNCTION_EXPORT_REPLAY');
  check(readSelectedFile(join(options.output,'scene-kit.zip'),268435456).equals(zip)
    &&readSelectedFile(join(options.output,'junctions.json')).equals(jsonBytes(data.junctions)),'TERRAIN_JUNCTION_ARTIFACT_REPLAY');
  const saved=parseJson(readSelectedFile(join(options.output,'upgrade.json')));unseal(saved);
  check(canonicalJson(saved)===canonicalJson(receipt(data,handle,scene,zip)),'TERRAIN_JUNCTION_RECEIPT_REPLAY');
  return {status:'verified',receiptSha256:saved.sha256,kitSha256:handle.bundleSha256,authorSha256:scene.source.authorSha256,
    compiledSha256:scene.contentSha256,junctionsSha256:data.junctions.sha256,generationCalls:0,artAcceptance:'not-assessed'};
}
