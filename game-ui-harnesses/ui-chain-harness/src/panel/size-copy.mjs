import {validateSizeEdit} from './size-edit.mjs';
import {validatePack,safePath} from '../skins/contract.mjs';
import {materialFiles} from '../skins/surface-styles.mjs';
import {validateDocument} from './document.mjs';

const names=['registry','usage','template'],digest=/^[a-f0-9]{64}$/;
const fail=message=>{throw Object.assign(Error(message),{code:'panel.copy-export'});};
const stable=value=>Array.isArray(value)?value.map(stable):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])])):value;
const encode=value=>new TextEncoder().encode(JSON.stringify(stable(value))+'\n');
const hash=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
function base64(bytes){let result='';for(let i=0;i<bytes.length;i+=8192)result+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(result);}
function decode(value){
 if(typeof value!=='string'||!value.length||value.length%4||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value))fail('导出资源不是有效的本地字节。');
 return Uint8Array.from(atob(value),c=>c.charCodeAt(0));
}
async function checkedContracts(input,bindings){
 if(input?.version!=='1.0'||!Array.isArray(input.files)||input.files.length!==3)fail('导出缺少完整的冻结合同。');
 const seen=new Set();
 for(const file of input.files){
  if(!names.includes(file.name)||seen.has(file.name)||!Number.isSafeInteger(file.bytes)||file.bytes<1||file.bytes>2*1024*1024||file.sha256!==bindings[file.name+'Sha256'])fail('导出合同与皮肤来源版本不一致。');
  const bytes=decode(file.base64);if(bytes.length!==file.bytes||await hash(bytes)!==file.sha256)fail('导出合同字节已经变化。');
  try{const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));if(!value||typeof value!=='object'||Array.isArray(value))fail('导出合同内容无效。');}catch{fail('导出合同内容无效。');}
  seen.add(file.name);
 }
 return structuredClone(input);
}
async function checkedPack(packet,skinSha256){
 if(!packet||packet.manifestSha256!==skinSha256||!packet.resources||!packet.bindings)fail('导出皮肤来源版本不一致。');
 const bytes=decode(packet.manifest);if(bytes.length>2*1024*1024||await hash(bytes)!==skinSha256)fail('导出皮肤清单已经变化。');
 let pack;try{pack=validatePack(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)),packet.bindings);}catch{fail('导出皮肤清单无效。');}
 const expected=[...new Map([...pack.assets,...pack.fonts,...pack.licenses,...materialFiles(pack)].map(resource=>[resource.file,resource])).values()];
 if(Object.keys(packet.resources).length!==expected.length)fail('导出资源不完整或含有未声明文件。');
 let total=0;
 for(const file of expected){
  if(!safePath(file.file)||!Object.hasOwn(packet.resources,file.file))fail('导出缺少清单声明的资源。');
  const bytes=decode(packet.resources[file.file]);total+=bytes.length;
  if(total>128*1024*1024||bytes.length!==file.bytes||await hash(bytes)!==file.sha256)fail('导出纹理、字体或来源字节已经变化。');
 }
 return pack;
}

/** A portable runtime JSON copy. Original generation files and play state are never exported as authored edits. */
export async function panelSizeCopy({source,variantKey,document}){
 const variant=source?.variants?.find(v=>v.key===variantKey);
 if(source?.kind!=='ui_panel_edit_source'||!variant||!digest.test(source.previewSha256??'')||!digest.test(source.pack?.manifestSha256??''))fail('面板导出来源无效。');
 const checked=validateSizeEdit(variant.document,document,source.ctx),packet=structuredClone(source.pack),context=structuredClone(source.ctx);
 const pack=await checkedPack(packet,source.pack.manifestSha256);
 const contextBytes=encode(context),derivedContracts=[];
 for(const name of names){const bytes=encode(context[name]);derivedContracts.push({name,serialization:'canonical-editor-context-json',bytes:bytes.length,sha256:await hash(bytes),base64:base64(bytes),sourceBindingSha256:pack.bindings[name+'Sha256']});}
 const sourceContracts=source.sourceContracts===undefined?undefined:await checkedContracts(source.sourceContracts,pack.bindings);
 const value={kind:'ui_panel_size_copy',version:'1.0',artifactId:source.artifactId,variantKey,sourceSha256:source.previewSha256,skinSha256:source.pack.manifestSha256,document:checked,...(Object.hasOwn(variant,'behavior')?{behavior:structuredClone(variant.behavior)}:{}),
  portable:{kind:'ui_panel_copy_resources',version:'1.0',scope:'runtime-json',pack:packet,context,contextSha256:await hash(contextBytes),originalContractBindings:structuredClone(pack.bindings),
   contractEvidence:sourceContracts?'original-source-bytes':'derived-editor-context',...(sourceContracts?{sourceContracts}:{}),derivedContracts,
   sourceSheets:'Original component atlas sheets are not embedded; verified runtime assets, material source PNGs, fonts and licenses are embedded.'}};
 await verifyPanelSizeCopy(value);return value;
}

/** Verify resource and contract bytes before a portable copy is downloaded or reused. */
export async function verifyPanelSizeCopy(value){
 if(value?.kind!=='ui_panel_size_copy'||value.version!=='1.0'||!digest.test(value.sourceSha256??'')||!digest.test(value.skinSha256??'')||value.portable?.kind!=='ui_panel_copy_resources'||value.portable.version!=='1.0'||value.portable.scope!=='runtime-json')fail('面板导出格式无效。');
 const p=value.portable,pack=await checkedPack(p.pack,value.skinSha256);
 if(value.document?.bindings?.sourceKind!==p.context?.binding?.sourceKind||value.document?.bindings?.sha256!==value.skinSha256||p.context?.binding?.sha256!==value.skinSha256||JSON.stringify(stable(p.originalContractBindings))!==JSON.stringify(stable(pack.bindings)))fail('面板导出与冻结皮肤版本不一致。');
 if(await hash(encode(p.context))!==p.contextSha256||!Array.isArray(p.derivedContracts)||p.derivedContracts.length!==3)fail('面板导出的运行上下文已经变化。');
 const seen=new Set();
 for(const file of p.derivedContracts){
  if(!names.includes(file.name)||seen.has(file.name)||file.serialization!=='canonical-editor-context-json'||file.sourceBindingSha256!==pack.bindings[file.name+'Sha256'])fail('面板导出的运行合同无效。');
  const bytes=decode(file.base64),expected=encode(p.context[file.name]);
  if(bytes.length!==file.bytes||bytes.length!==expected.length||await hash(bytes)!==file.sha256||bytes.some((b,i)=>b!==expected[i]))fail('面板导出的运行合同字节已经变化。');
  seen.add(file.name);
 }
 if(p.contractEvidence==='original-source-bytes')await checkedContracts(p.sourceContracts,pack.bindings);
 else if(p.contractEvidence!=='derived-editor-context'||p.sourceContracts!==undefined)fail('面板导出的合同来源标识无效。');
 validateDocument(value.document,p.context);
 return {skinSha256:value.skinSha256,sourceSha256:value.sourceSha256,resources:Object.keys(p.pack.resources).length,contractEvidence:p.contractEvidence};
}
