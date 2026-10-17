import {mkdir,writeFile} from 'node:fs/promises';
import {join,relative} from 'node:path';
import {randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {validateProject} from './project.mjs';
import {readSafe,json,hash} from '../skins/package.mjs';
import {decodePng} from '../skins/png.mjs';
import {readContracts} from '../contracts/validate.mjs';
import {defaults} from '../contracts/build.mjs';
import {resolveStyle} from './styles.mjs';
const exec=promisify(execFile);
export function referenceStyle(project,template){
 return {kind:'ui_skin_style_draft',version:'0.1',id:'studio-'+project.reference.sha256.slice(0,16),revision:1,status:'draft',name:project.name,
 referenceSummary:'Reference-led draft. No automatic visual analysis has been performed.',palette:{basis:'reference-only-no-analysis',colors:{}},
 observedRules:['No visual observations are asserted. Use the attached image as the style reference.'],
 extensionRules:['Apply the reference materials and colors to the fixed generic UI parts; omit text, scenery and functional icons.',...project.description.match(/.{1,1800}/gs)||[]],
 partRules:template.sheets.flatMap(s=>s.parts.map(p=>({match:{assetId:p.assetId},appearance:'Follow the attached style reference while preserving the exact template geometry and stretch axis.'})))};
}
export function studioPlanner(root){
 let busy=false;
 return async data=>{
  if(busy)throw Error('PLANNING_BUSY');busy=true;
  try{
   const project=await validateProject(data.project);
   const raw=Buffer.from(project.reference.base64,'base64');
   let png=raw;
   if(project.reference.mime==='image/jpeg'){
    if(typeof data.png!=='string'||data.png.length>12*1024*1024)throw Error('PLANNING_PNG_REQUIRED');
    png=Buffer.from(data.png,'base64');
   }
   const decoded=decodePng(png);if(decoded.width*decoded.height>40000000)throw Error('PLANNING_IMAGE_TOO_LARGE');
   const preset=await resolveStyle(root,project);
   const contracts=await readContracts(defaults),style=referenceStyle(project,contracts.template);
   if(preset)style.extensionRules.splice(1,0,...preset.rules.map(r=>'Style guidance: '+r),'The optional user description overrides style guidance; transparent template geometry and no baked text/icons always apply.');
   const directory=join(root,'work/studio/projects',randomUUID());
   await mkdir(directory,{recursive:true});
   await writeFile(join(directory,'project.json'),json(project),{flag:'wx'});
   await writeFile(join(directory,'reference.png'),png,{flag:'wx'});
   await writeFile(join(directory,'style.json'),json(style),{flag:'wx'});
   if(preset)await writeFile(join(directory,'preset.json'),json(preset),{flag:'wx'});
   await writeFile(join(directory,'reference-provenance.json'),json({originalSha256:project.reference.sha256,pngSha256:hash(png),conversion:project.reference.mime==='image/jpeg'?'browser-decoded-png':'unchanged'}),{flag:'wx'});
   const result=await exec(process.execPath,[join(root,'scripts/skin-batch.mjs'),'prepare','--reference',join(directory,'reference.png'),'--style',join(directory,'style.json'),'--out',directory,...(project.materialGeneration?['--materials']:[])],{cwd:root,windowsHide:true,maxBuffer:2*1024*1024,timeout:120000});
   const prepared=JSON.parse(result.stdout),batch=JSON.parse(await readSafe(prepared.directory,'batch.json'));
   return {status:prepared.status,batchSha256:prepared.batchSha256,directory:relative(root,prepared.directory).replaceAll('\\','/'),sheets:batch.plans,assets:batch.assetCount,computeAuthorized:false,styleMode:'reference-only-no-analysis',generation:'not-invoked'};
  }finally{busy=false;}
 };
}
