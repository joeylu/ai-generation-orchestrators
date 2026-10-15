import {createHash} from 'node:crypto';
import {safePath,validatePack} from '../skins/contract.mjs';
import {settingsSkinGeometry} from '../panel/skin-geometry.mjs';
import {upgradeTextStyleRegistry} from '../runtime/text-style.mjs';
import {materialFiles} from '../skins/surface-styles.mjs';

const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const digest=/^[a-f0-9]{64}$/;
const artifactPattern=/^[a-z][a-z0-9-]{0,48}$/;
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const fail=code=>{throw Object.assign(new Error(code),{code});};
const clone=value=>structuredClone(value);
const contextKeys=['registry','usage','template','canvases','profile','binding','orientation'];
const bindingKeys=['templateSha256','registrySha256','usageSha256'];

function decode(value,code){
  if(typeof value!=='string'||!value.length||value.length%4||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value))fail(code);
  return Buffer.from(value,'base64');
}

function skinPacket(input){
  if(!object(input)||!object(input.bindings)||!object(input.resources)||!digest.test(input.manifestSha256??''))fail('STUDIO_PANEL_EDIT_SKIN');
  const manifest=decode(input.manifest,'STUDIO_PANEL_EDIT_SKIN');
  if(manifest.length>2*1024*1024||hash(manifest)!==input.manifestSha256)fail('STUDIO_PANEL_EDIT_SKIN_DIGEST');
  let pack;
  try{pack=validatePack(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(manifest)),input.bindings);}
  catch{fail('STUDIO_PANEL_EDIT_SKIN');}
  if(pack.sourceKind!=='imported'||Object.keys(input.bindings).length!==bindingKeys.length||bindingKeys.some(k=>input.bindings[k]!==pack.bindings[k]))fail('STUDIO_PANEL_EDIT_SKIN_BINDING');
  // The validated manifest owns this finite allowlist. Multiple material crops
  // can share one digest-bound original; preserve it once in the packet.
  const expected=[...new Map([...pack.assets,...pack.fonts,...pack.licenses,...materialFiles(pack)].map(resource=>[resource.file,resource])).values()],resources={};
  if(Object.keys(input.resources).length!==expected.length)fail('STUDIO_PANEL_EDIT_RESOURCES');
  let total=0;
  for(const resource of expected){
    if(!safePath(resource.file)||!Object.hasOwn(input.resources,resource.file))fail('STUDIO_PANEL_EDIT_RESOURCES');
    const bytes=decode(input.resources[resource.file],'STUDIO_PANEL_EDIT_RESOURCES');total+=bytes.length;
    if(total>128*1024*1024||bytes.length!==resource.bytes||hash(bytes)!==resource.sha256)fail('STUDIO_PANEL_EDIT_RESOURCE_DIGEST');
    resources[resource.file]=input.resources[resource.file];
  }
  return {packet:{manifest:input.manifest,manifestSha256:input.manifestSha256,bindings:clone(pack.bindings),resources},manifest:pack};
}

function sourceContracts(input,bindings){
  if(input===undefined)return undefined;
  if(!object(input)||Object.keys(input).some(k=>!['version','files'].includes(k))||input.version!=='1.0'||!Array.isArray(input.files)||input.files.length!==3)fail('STUDIO_PANEL_EDIT_CONTRACTS');
  const seen=new Set();let total=0;
  for(const file of input.files){
    if(!object(file)||Object.keys(file).some(k=>!['name','bytes','sha256','base64'].includes(k))||!['registry','usage','template'].includes(file.name)||seen.has(file.name)||!Number.isSafeInteger(file.bytes)||file.bytes<1||file.bytes>2*1024*1024||file.sha256!==bindings[file.name+'Sha256'])fail('STUDIO_PANEL_EDIT_CONTRACTS');
    const bytes=decode(file.base64,'STUDIO_PANEL_EDIT_CONTRACTS');total+=bytes.length;
    if(total>6*1024*1024||bytes.length!==file.bytes||hash(bytes)!==file.sha256)fail('STUDIO_PANEL_EDIT_CONTRACT_DIGEST');
    try{if(!object(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes))))fail('STUDIO_PANEL_EDIT_CONTRACTS');}catch{fail('STUDIO_PANEL_EDIT_CONTRACTS');}
    seen.add(file.name);
  }
  return clone(input);
}

function documents(input,{prefix,label,behavior,ctx,manifestSha256}){
  if(!object(input)||!Object.keys(input).length||Object.keys(input).some(key=>!['landscape','portrait'].includes(key)))fail('STUDIO_PANEL_EDIT_DOCUMENTS');
  return Object.entries(input).map(([orientation,document])=>{
    if(!object(document)||document.kind!=='ui_panel_document'||document.canvas!==orientation||!object(document.bindings)||document.bindings.sourceKind!=='imported'||document.bindings.sha256!==manifestSha256||!ctx.canvases.presets[orientation]||!Array.isArray(document.nodes))fail('STUDIO_PANEL_EDIT_DOCUMENT_BINDING');
    return {key:prefix+'-'+orientation,label:label+' · '+(orientation==='landscape'?'横版 16:9':'竖版 9:16'),orientation,document:clone(document),...(behavior?{behavior:clone(behavior)}:{})};
  });
}

// Only the two deterministic preview producers' exact final call is supported.
// The bundled JavaScript is never evaluated or interpreted during extraction.
export function extractPanelEditSource({artifactId,previewBytes,expectedPreviewSha256}={}){
  if(!artifactPattern.test(artifactId??''))fail('STUDIO_PANEL_EDIT_ARTIFACT');
  if(!(previewBytes instanceof Uint8Array)||!previewBytes.length||previewBytes.length>32*1024*1024)fail('STUDIO_PANEL_EDIT_PREVIEW');
  const previewSha256=hash(previewBytes);
  if(expectedPreviewSha256!==undefined&&(!digest.test(expectedPreviewSha256)||previewSha256!==expectedPreviewSha256))fail('STUDIO_PANEL_EDIT_PREVIEW_CHANGED');
  let html;
  try{html=new TextDecoder('utf-8',{fatal:true}).decode(previewBytes);}catch{fail('STUDIO_PANEL_EDIT_FORMAT');}
  const suffix=');</script></html>',calls=[['Actions','action-panel-preview'],['Settings','settings-panel-preview']];
  if(!html.endsWith(suffix))fail('STUDIO_PANEL_EDIT_UNSUPPORTED_PREVIEW');
  let payload,producer;
  for(const [name,kind]of calls){
    const marker='\nawait initialize'+name+'(',offset=html.lastIndexOf(marker);
    if(offset<0)continue;
    const prefix=html.slice(0,offset),start=prefix.lastIndexOf('<script type="module">');
    if(start<0||prefix.slice(start).includes('</script>'))continue;
    const text=html.slice(offset+marker.length,-suffix.length);
    if(!text.startsWith('{')||!text.endsWith('}')||/[<\r\n]/.test(text))continue;
    try{payload=JSON.parse(text);producer=kind;break;}catch{}
  }
  if(!object(payload)||!producer)fail('STUDIO_PANEL_EDIT_UNSUPPORTED_PREVIEW');
  const {packet,manifest}=skinPacket(payload.pack);
  const contracts=sourceContracts(payload.sourceContracts,packet.bindings);
  if(!object(payload.ctx)||!object(payload.ctx.binding)||payload.ctx.binding.sourceKind!=='imported'||payload.ctx.binding.sha256!==packet.manifestSha256||!object(payload.ctx.canvases?.presets)||contextKeys.slice(0,5).some(key=>!object(payload.ctx[key])))fail('STUDIO_PANEL_EDIT_CONTEXT');
  const ctx=Object.fromEntries(contextKeys.filter(key=>Object.hasOwn(payload.ctx,key)).map(key=>[key,clone(payload.ctx[key])]));
  // Derive only the current editor's optional text-style declarations. The
  // frozen preview, registry identity, pack bindings and source document stay
  // unchanged, and no defaults are introduced into an old revision's hash.
  ctx.registry=upgradeTextStyleRegistry(ctx.registry);
  ctx.binding={sourceKind:'imported',sha256:packet.manifestSha256};
  Object.assign(ctx,settingsSkinGeometry(manifest));
  let variants,source;
  if(producer==='action-panel-preview'){
    if(!['model-response','offline-fixtures'].includes(payload.source)||!Array.isArray(payload.presets)||!payload.presets.length)fail('STUDIO_PANEL_EDIT_PRESETS');
    source=payload.source;
    variants=payload.presets.flatMap(preset=>{
      if(!object(preset)||!object(preset.content)||!/^[-a-z0-9]+$/.test(preset.content.presetId??'')||typeof preset.content.title!=='string'||!object(preset.behavior)||!Array.isArray(preset.behavior.fields)||!Array.isArray(preset.behavior.actions))fail('STUDIO_PANEL_EDIT_PRESETS');
      const behavior=Object.fromEntries(['version','fields','actions','dismissOnEmit'].filter(key=>Object.hasOwn(preset.behavior,key)).map(key=>[key,clone(preset.behavior[key])]));
      return documents(preset.documents,{prefix:preset.content.presetId,label:preset.content.title,behavior,ctx,manifestSha256:packet.manifestSha256});
    });
  }else{
    if(!object(payload.content)||!Array.isArray(payload.content.fields))fail('STUDIO_PANEL_EDIT_SETTINGS');
    source='frozen-preview';
    variants=documents(payload.documents,{prefix:'settings',label:typeof payload.content.title==='string'?payload.content.title:'设置面板',ctx,manifestSha256:packet.manifestSha256});
  }
  if(new Set(variants.map(v=>v.key)).size!==variants.length)fail('STUDIO_PANEL_EDIT_DUPLICATE_VARIANT');
  return {kind:'ui_panel_edit_source',version:'1.0',artifactId,previewSha256,producer,source,ctx,pack:packet,variants,...(contracts?{sourceContracts:contracts}:{})};
}

// The caller supplies the existing verified in-memory Studio allowlist.
export function panelEditSourceFromSnapshot(snapshot,artifactId){
  if(!artifactPattern.test(artifactId??''))fail('STUDIO_PANEL_EDIT_ARTIFACT');
  if(!snapshot?.items?.some(item=>item.id===artifactId&&item.type==='panel'))fail('STUDIO_PANEL_EDIT_NOT_FOUND');
  const previewBytes=snapshot.files?.get('artifacts/'+artifactId+'/preview.html');
  if(!previewBytes)fail('STUDIO_PANEL_EDIT_NOT_FOUND');
  return extractPanelEditSource({artifactId,previewBytes});
}
