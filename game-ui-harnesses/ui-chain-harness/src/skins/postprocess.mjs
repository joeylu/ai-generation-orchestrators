import {dirname} from 'node:path';
import {readFile} from 'node:fs/promises';
import {readSafe,hash} from './package.mjs';
import {decodePng,cropPng} from './png.mjs';
import {fitAsset,fitSlicedAsset,supportsSliceFit} from './assemble.mjs';
import {assertMetadata} from './contract.mjs';
import {suggestMaterialSlices} from './contour-slices.mjs';
import {assertVisibleAsset,sliceRisks} from './quality.mjs';
import {suggestContentInsets} from './content-insets.mjs';

// Read-only preflight. Analyze the pixels the pack will actually deliver,
// so source-space recommendations cannot be mistaken for packed-space cuts.
export async function inspectAssembly(configPath,inputs){
  const bytes=await readFile(configPath),config=JSON.parse(bytes),template=inputs.template;
  const insetPolicyBytes=await readFile(new URL('../../configs/skin-content-insets-policy.json',import.meta.url));
  const insetPolicy=JSON.parse(insetPolicyBytes);
  const metadataPolicyBytes=await readFile(new URL('../../configs/skin-metadata-policy.json',import.meta.url)),metadataPolicy=JSON.parse(metadataPolicyBytes);
  if(metadataPolicy.filledContourFallback!==undefined&&typeof metadataPolicy.filledContourFallback!=='boolean')throw Error('metadata.invalid-policy');
  if(config.templateSha256!==hash(inputs.bytes.template))throw Error('Template digest differs');
  const parts=template.sheets.flatMap(s=>s.parts),ids=parts.map(p=>p.assetId);
  if(!config.parts||Object.keys(config.parts).length!==ids.length||ids.some(id=>!config.parts[id]))throw Error('Require exact full asset coverage');
  const sources=new Map(),files=new Map();
  for(const id of ids){
    const p=config.parts[id];
    if(!files.has(p.file)){const raw=await readSafe(dirname(configPath),p.file);files.set(p.file,{hash:hash(raw),image:decodePng(raw)});}
    const source=files.get(p.file);
    if(source.hash!==p.sha256)throw Error('Source digest differs: '+id);
    const cropped=p.crop?cropPng(source.image,p.crop):source.image;
    assertVisibleAsset(cropped,id,'source');
    sources.set(id,cropped);
  }
  const sheets=[];
  for(const sheet of template.sheets){
    const results=[];
    for(const part of sheet.parts){
      const id=part.assetId,p=config.parts[id],source=sources.get(id),scale=template.coordinates.outputScale;
      assertMetadata(p.metadata,part.bodyRect[2],part.bodyRect[3],part.stretch);
      const group=template.stateGroups?.find(g=>g.assetIds.includes(id)),members=(group?.assetIds??[id]).map(k=>sources.get(k));
      if(p.fit&&(!supportsSliceFit(p.fit,part.stretch,group)))throw Error('Invalid configured fit: '+id);
      const width=part.bodyRect[2]*scale,height=part.bodyRect[3]*scale;
      const fitted=p.fit?fitSlicedAsset(source,width,height,p.fit):fitAsset(source,width,height,[Math.max(...members.map(i=>i.width)),Math.max(...members.map(i=>i.height))]);
      assertVisibleAsset(fitted.image,id,'fitted');
      const axis=['horizontal','vertical'].includes(part.stretch)?part.stretch:'both',filledContourFallback=metadataPolicy.filledContourFallback===true&&(part.stretch==='nine-slice'||part.stretch==='horizontal'&&!p.fit);
      const suggestion=part.stretch==='uniform'?{status:'not-applicable'}:suggestMaterialSlices(fitted.image,scale*p.metadata.density,{axis,filledContourFallback});
      const risks=sliceRisks({source,fit:p.fit,suggestion,metadata:p.metadata,stretch:part.stretch,resolution:scale*p.metadata.density});
      const warnings=[];
      if(suggestion.status==='unsupported')warnings.push('自动切线不支持该纹理；保留现有配置，需视觉核对。');
      if(fitted.operation.offset?.some(n=>n>0)&&part.stretch!=='uniform')warnings.push('等比装框有透明留白；核对切线是否穿过留白及端帽。');
      warnings.push(...risks.map(r=>r.message));
      const contentInsetSuggestion=suggestContentInsets({assetId:id,width:fitted.image.width,resolution:scale*p.metadata.density,suggestion,configured:p.metadata.contentInsets,policy:insetPolicy});
      if(contentInsetSuggestion.belowRecommended?.length)warnings.push('水平内容边距小于通用建议：'+contentInsetSuggestion.belowRecommended.join(', '));
      if(contentInsetSuggestion.status==='needs-review')warnings.push('内容边框证据不足；保留配置，需复核。');
      results.push({assetId:id,sourceFile:p.file,sourceSha256:p.sha256,crop:p.crop??null,stretch:part.stretch,configured:p.metadata,fit:fitted.operation,suggestion,contentInsetSuggestion,risks,warnings});
    }
    sheets.push({sheetId:sheet.id,parts:results});
  }
  return{kind:'ui_skin_postprocess_inspection',version:'1.0',inputSha256:hash(bytes),templateSha256:config.templateSha256,contentInsetPolicySha256:hash(insetPolicyBytes),metadataPolicySha256:hash(metadataPolicyBytes),assets:ids.length,sourceFiles:files.size,status:'configuration-checked',visualAcceptance:'unreviewed',automaticCutApplication:false,sheets};
}
