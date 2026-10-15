import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {dirname,resolve,relative,join,isAbsolute,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import {randomUUID} from 'node:crypto';
import {readSafe,hash,json} from '../src/skins/package.mjs';
import {decodePng} from '../src/skins/png.mjs';
import {compareCrops} from '../src/skins/crop-comparison.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const {values:v}=parseArgs({options:{report:{type:'string'},input:{type:'string'},assembly:{type:'string'}}});
const local=p=>{if(!p)throw Error('Required --report --input --assembly');const q=resolve(root,p),r=relative(join(root,'work'),q);if(isAbsolute(r)||r==='..'||r.startsWith('..'+sep))throw Error('compare.work-path-required');return q;};
try{
  const reportBytes=await readFile(local(v.report)),inputPath=local(v.input),inputBytes=await readFile(inputPath),assemblyPath=local(v.assembly),assemblyBytes=await readFile(assemblyPath);
  const r=JSON.parse(reportBytes),input=JSON.parse(inputBytes),baseline=JSON.parse(assemblyBytes);
  if(r.kind!=='ui_skin_localization_candidates'||r.inputSha256!==hash(inputBytes)||r.templateSha256!==baseline.templateSha256||r.templateSha256!==input.templateSha256)throw Error('compare.binding');
  const results=[],conflictWindows=[];
  for(const sheet of r.sheets){
    const bound=input.sheets.find(s=>s.sheetId===sheet.sheetId);
    if(!bound||bound.sha256!==sheet.source.sha256||bound.file!==sheet.source.file)throw Error('compare.source-binding');
    const raw=await readSafe(dirname(inputPath),bound.file);if(hash(raw)!==bound.sha256)throw Error('compare.source-changed');
    const image=decodePng(raw);
    for(const id of new Set(sheet.association.parts.flatMap(p=>p.conflictComponentIds))){
      const component=sheet.components.find(c=>c.id===id);if(!component)throw Error('compare.component-missing');
      for(const p of sheet.parts.filter(p=>p.componentIds.includes(id))){
        const shared=compareCrops(image,component.rect,p.slot).shared;
        conflictWindows.push({sheetId:sheet.sheetId,componentId:id,componentRect:component.rect,slotAssetId:p.assetId,slot:p.slot,windowPixels:shared,scope:'all pixels in bounding-rectangle and slot intersection; not component-only segmentation'});
      }
    }
    for(const p of sheet.association.parts){
      const b=baseline.parts[p.assetId];if(!b)throw Error('compare.baseline-missing');
      const baselineRaw=await readSafe(dirname(assemblyPath),b.file);if(hash(baselineRaw)!==b.sha256)throw Error('compare.baseline-source-changed');
      const row={sheetId:sheet.sheetId,assetId:p.assetId,proposedCrop:p.proposedCrop,baselineCrop:b.crop??null,proposalIssues:p.issues};
      if(b.sha256!==bound.sha256){results.push({...row,status:'not-comparable-different-source'});continue;}
      if(!p.proposedCrop){results.push({...row,status:'no-proposal'});continue;}
      const comparison=compareCrops(image,b.crop??[0,0,image.width,image.height],p.proposedCrop);
      const neighbors=[];
      for(const [id,n] of Object.entries(baseline.parts))if(id!==p.assetId&&n.sha256===bound.sha256&&n.crop){
        const shared=compareCrops(image,n.crop,p.proposedCrop).shared;
        if(shared.nonzeroPixels)neighbors.push({assetId:id,...shared});
      }
      results.push({...row,status:'compared',comparison,baselineNeighborIntersections:neighbors});
    }
  }
  const compared=results.filter(p=>p.status==='compared');
  const output={kind:'ui_skin_localization_comparison',version:'1.0',proposalReportSha256:hash(reportBytes),inputSha256:hash(inputBytes),baselineSha256:hash(assemblyBytes),comparisonAlgorithmSha256:hash(await readFile(join(root,'src/skins/crop-comparison.mjs'))),status:'evaluation-only',assemblyReady:false,baselineIsSemanticGroundTruth:false,results,counts:{total:results.length,compared:compared.length,differentSource:results.filter(p=>p.status==='not-comparable-different-source').length,noProposal:results.filter(p=>p.status==='no-proposal').length,missingBaselinePixels:compared.filter(p=>p.comparison.baselineOnly.nonzeroPixels).length,addedPixels:compared.filter(p=>p.comparison.proposalOnly.nonzeroPixels).length,neighborIntersections:compared.filter(p=>p.baselineNeighborIntersections.length).length}};
  output.conflictWindows=conflictWindows;
  output.driverSha256=hash(await readFile(fileURLToPath(import.meta.url)));
  const dir='work/skin-localization-comparison/'+randomUUID();await mkdir(join(root,dir),{recursive:true});
  for(const [name,bytes] of [['report.json',json(output)],['proposal-report.json',reportBytes],['baseline.json',assemblyBytes],['input.json',inputBytes]])await writeFile(join(root,dir,name),bytes,{flag:'wx'});
  console.log(json({directory:dir,counts:output.counts}));
}catch(e){console.error(e.message);process.exitCode=1;}
