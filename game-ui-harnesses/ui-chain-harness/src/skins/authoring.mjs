import {cropPng} from './raster.mjs';
import {fitAsset,fitSlicedAsset,supportsSliceFit} from './assemble.mjs';
import {assertMetadata,safePath} from './contract.mjs';
import Ajv from 'ajv';
import themeSchema from '../../schemas/runtime-theme.schema.json' with {type:'json'};
import importSchema from '../../schemas/skin-import.schema.json' with {type:'json'};
const checkTheme=new Ajv().compile(themeSchema);
const checkMetadata=new Ajv().compile(importSchema.properties.parts.additionalProperties);
export function validateAssemblyDraft(config,template,templateSha256,sources){
  const parts=template.sheets.flatMap(s=>s.parts);
  if(config.templateSha256!==templateSha256||!config.parts||Object.keys(config.parts).length!==parts.length||parts.some(p=>!Object.hasOwn(config.parts,p.assetId)))throw Error('模板版本或部件列表不匹配');
  if(typeof config.id!=='string'||!Number.isInteger(config.revision)||config.revision<1||!checkTheme(config.theme))throw Error('无效的皮肤标识、版本或主题');
  for(const p of parts){
    const d=config.parts[p.assetId],s=sources.get(d.file);
    if(!checkMetadata(d.metadata))throw Error(p.assetId+'：切片/边距/最小尺寸须符合正式组包格式（整数逻辑单位）');
    if(!Number.isFinite(d.metadata?.density??1)||(d.metadata.density??1)<=0)throw Error('无效素材密度');
    if(!safePath(d.file)||!s||s.sha256!==d.sha256)throw Error(p.assetId+'：缺少匹配的源图，请先导入源图');
    const image=d.crop?cropPng(s.image,d.crop):s.image;
    assertMetadata(d.metadata,p.bodyRect[2],p.bodyRect[3],p.stretch);
    if(d.fit){
      if(!supportsSliceFit(d.fit,p.stretch,template.stateGroups?.some(g=>g.assetIds.includes(p.assetId))))throw Error(p.assetId+'：端帽适配不适用于此部件');
      fitSlicedAsset(image,p.bodyRect[2]*template.coordinates.outputScale,p.bodyRect[3]*template.coordinates.outputScale,d.fit);
    }
  }
  return config;
}
export function previewAssemblyPart(config,template,sources,id){
  const p=template.sheets.flatMap(s=>s.parts).find(p=>p.assetId===id),d=config.parts[id],read=k=>{const q=config.parts[k],s=sources.get(q.file).image;return q.crop?cropPng(s,q.crop):s;};
  const source=read(id),scale=template.coordinates.outputScale,group=template.stateGroups?.find(g=>g.assetIds.includes(id)),members=(group?.assetIds??[id]).map(read);
  return d.fit?fitSlicedAsset(source,p.bodyRect[2]*scale,p.bodyRect[3]*scale,d.fit):fitAsset(source,p.bodyRect[2]*scale,p.bodyRect[3]*scale,[Math.max(...members.map(i=>i.width)),Math.max(...members.map(i=>i.height))]);
}
