import {mkdirSync,writeFileSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {canonicalJson,clone} from './document.mjs';
import {loadSceneKit,contextFor,readMap} from './kit.mjs';
import {compileMap} from './compile.mjs';
import {exportScene,exportSceneArchive,openSceneExport} from './persistence.mjs';
import {makeFreshDirectory,parseJson,readSelectedFile,writeFreshFile} from './files.mjs';
import {check,exact,hash,jsonBytes,seal,unseal} from './generation/common.mjs';
import {buildTerrainMaterialLoop} from './terrain-material-loop.mjs';

const outputPath='materials/body-loop.png';

// An explicit, zero-generation revision keeps the original checked material
// PNG and adds one replayable derived loop. The editable geometry only rebinds
// kitRef; earlier revisions and their compiled exports remain independent.
function prepared(options){
  exact(options,['root','document','output','loopOptions']);
  const handle=loadSceneKit(options.root),context=contextFor(handle),before=options.document??readMap(handle);
  check(context.kit.terrainEdges?.format==='ai_scene_terrain_edges_v6'
    &&context.kit.terrainAppearance?.format==='ai_scene_continuous_terrain_appearance_v6'
    &&!Object.hasOwn(context.kit,'terrainMaterialLoop'),'TERRAIN_MATERIAL_LOOP_UPGRADE_SOURCE');
  exact(options.loopOptions,['usableRows','overlapRows','phaseCount']);
  const previous=compileMap(handle,before),files=new Map([...context.files].map(([path,bytes])=>[path,Buffer.from(bytes)])),kit=clone(context.kit),
    source=kit.terrainAppearance.body.source,input=files.get(source.path);
  check(input instanceof Uint8Array&&!files.has(outputPath),'TERRAIN_MATERIAL_LOOP_UPGRADE_SOURCE');
  const derived=buildTerrainMaterialLoop(input,{source,outputPath,...options.loopOptions}),png=Buffer.from(derived.png),record=derived.record;
  unseal(record);
  check(record.output?.source?.path===outputPath&&record.output.source.sha256===hash(png)
    &&record.output.source.byteLength===png.length,'TERRAIN_MATERIAL_LOOP_UPGRADE_RESULT');
  const originalPngs=[...files].filter(([path])=>path.endsWith('.png')).map(([path,bytes])=>({path,sha256:hash(bytes),byteLength:bytes.length}));
  files.set(outputPath,png);kit.terrainMaterialLoop=record;
  kit.revision='material-loop-'+hash(canonicalJson({sourceKitSha256:handle.bundleSha256,loopSha256:record.sha256})).slice(0,16);
  const kitRef={kitId:kit.kitId,revision:kit.revision};
  for(const [kind,ref]of Object.entries(kit.files))for(const entry of kind==='maps'?Object.values(ref):[ref]){
    const value=parseJson(files.get(entry.path));value.kitRef=kitRef;
    const bytes=jsonBytes(value);files.set(entry.path,bytes);entry.sha256=hash(bytes);
  }
  files.set('kit.json',jsonBytes(kit));const document=clone(before);document.kitRef=kitRef;
  const plain=value=>{const author=clone(value);delete author.kitRef;return canonicalJson(author);};
  check(plain(before)===plain(document),'TERRAIN_MATERIAL_LOOP_AUTHOR_GEOMETRY');
  for(const item of originalPngs)check(files.get(item.path).equals(context.files.get(item.path)),'TERRAIN_MATERIAL_LOOP_SOURCE_BYTES');
  return {handle,context,previous,files,document,originalPngs,record,png};
}

function receipt(data,handle,scene,zip){
  check(canonicalJson(data.previous.collisionSuggestions)===canonicalJson(scene.collisionSuggestions),'TERRAIN_MATERIAL_LOOP_COLLISION');
  return seal({format:'ai_scene_terrain_material_loop_upgrade_v1',profile:data.record.profile,
    sourceKitSha256:data.handle.bundleSha256,kitSha256:handle.bundleSha256,previousAuthorSha256:data.previous.source.authorSha256,
    authorSha256:scene.source.authorSha256,compiledSha256:scene.contentSha256,materialLoopSha256:data.record.sha256,
    originalPngs:data.originalPngs,allOriginalPngBytesPreserved:true,derivedBody:clone(data.record.output),addedPngFiles:1,
    geometryChanged:false,collisionChanged:false,zip:{sha256:hash(zip),byteLength:zip.length},generationCalls:0,artAcceptance:'not-assessed'});
}

export function upgradeTerrainMaterialLoopKit(options){
  const data=prepared(options),out=makeFreshDirectory(options.output,data.context.sourceRoot),kitRoot=join(out,'kit');mkdirSync(kitRoot);
  for(const [path,bytes]of data.files){const file=join(kitRoot,...path.split('/'));mkdirSync(dirname(file),{recursive:true});writeFileSync(file,bytes,{flag:'wx'});}
  const handle=loadSceneKit(kitRoot),scene=compileMap(handle,data.document),zip=exportSceneArchive(handle,data.document);
  exportScene(handle,data.document,join(out,'export'));
  writeFreshFile(join(out,'scene-kit.zip'),zip,data.context.sourceRoot);writeFreshFile(join(out,'material-loop.json'),jsonBytes(data.record),data.context.sourceRoot);
  const result=receipt(data,handle,scene,zip);writeFreshFile(join(out,'upgrade.json'),jsonBytes(result),data.context.sourceRoot);return result;
}

export function verifyTerrainMaterialLoopKit(options){
  const data=prepared(options),handle=loadSceneKit(join(options.output,'kit')),context=contextFor(handle);
  check(context.files.size===data.files.size&&[...data.files].every(([path,bytes])=>context.files.get(path)?.equals(bytes)),'TERRAIN_MATERIAL_LOOP_KIT_REPLAY');
  const reopened=openSceneExport(join(options.output,'export')),scene=compileMap(handle,data.document),zip=exportSceneArchive(handle,data.document);
  check(canonicalJson(reopened.document)===canonicalJson(data.document)&&reopened.compiled.contentSha256===scene.contentSha256,'TERRAIN_MATERIAL_LOOP_EXPORT_REPLAY');
  check(readSelectedFile(join(options.output,'scene-kit.zip'),268435456).equals(zip),'TERRAIN_MATERIAL_LOOP_ZIP_REPLAY');
  check(readSelectedFile(join(options.output,'material-loop.json'),16777216).equals(jsonBytes(data.record)),'TERRAIN_MATERIAL_LOOP_RECORD_REPLAY');
  const saved=parseJson(readSelectedFile(join(options.output,'upgrade.json'),2097152));unseal(saved);
  check(canonicalJson(saved)===canonicalJson(receipt(data,handle,scene,zip)),'TERRAIN_MATERIAL_LOOP_RECEIPT_REPLAY');
  return {status:'verified',receiptSha256:saved.sha256,kitSha256:handle.bundleSha256,authorSha256:scene.source.authorSha256,
    compiledSha256:scene.contentSha256,materialLoopSha256:data.record.sha256,profile:data.record.profile,generationCalls:0,artAcceptance:'not-assessed'};
}
