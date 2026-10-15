export const MAX_IMAGE_BYTES=8*1024*1024;
export async function referenceRecord(bytes){
  if(!(bytes instanceof Uint8Array)||!bytes.length||bytes.length>MAX_IMAGE_BYTES)throw Error('参考图应小于 8 MB');
  const png=[137,80,78,71,13,10,26,10].every((v,i)=>bytes[i]===v);
  const jpeg=bytes[0]===255&&bytes[1]===216&&bytes[2]===255;
  if(!png&&!jpeg)throw Error('请选择 PNG 或 JPEG 图片');
  let binary='';for(let i=0;i<bytes.length;i+=16384)binary+=String.fromCharCode(...bytes.subarray(i,i+16384));
  const digest=await crypto.subtle.digest('SHA-256',bytes);
  return {mime:png?'image/png':'image/jpeg',sha256:[...new Uint8Array(digest)].map(v=>v.toString(16).padStart(2,'0')).join(''),base64:btoa(binary)};
}
export async function validateProject(value){
  if(!value||value.kind!=='ui_studio_project_draft'||value.version!=='0.1'||Object.keys(value).some(k=>!['kind','version','name','description','reference','style','automaticProcessing','materialGeneration'].includes(k)))throw Error('不支持的项目文件');
  if(value.style&&(!/^[a-z][a-z0-9-]+$/.test(value.style.id)||typeof value.style.revision!=='string'||value.style.revision.length>30||Object.keys(value.style).some(k=>!['id','revision'].includes(k))))throw Error('风格版本不合法');
  if(value.automaticProcessing!==undefined&&typeof value.automaticProcessing!=='boolean')throw Error('自动处理配置不合法');
  if(value.materialGeneration!==undefined&&typeof value.materialGeneration!=='boolean')throw Error('材质生成配置不合法');
  if(typeof value.name!=='string'||!value.name.trim()||value.name.length>80||typeof value.description!=='string'||value.description.length>4000)throw Error('项目名称或补充描述不合法');
  const ref=value.reference;
  if(!ref||typeof ref.base64!=='string'||ref.base64.length>Math.ceil(MAX_IMAGE_BYTES/3)*4||!/^[A-Za-z0-9+/]+={0,2}$/.test(ref.base64))throw Error('参考图数据不合法');
  const raw=atob(ref.base64),bytes=Uint8Array.from(raw,c=>c.charCodeAt(0)),verified=await referenceRecord(bytes);
  if(ref.sha256!==verified.sha256||ref.mime!==verified.mime||ref.base64!==verified.base64)throw Error('参考图校验失败，文件可能已被修改');
  return {kind:value.kind,version:'0.1',name:value.name.trim(),description:value.description,reference:verified,...(value.style?{style:{id:value.style.id,revision:value.style.revision}}:{}),...(value.automaticProcessing!==undefined?{automaticProcessing:value.automaticProcessing}:{}),...(value.materialGeneration!==undefined?{materialGeneration:value.materialGeneration}:{})};
}
