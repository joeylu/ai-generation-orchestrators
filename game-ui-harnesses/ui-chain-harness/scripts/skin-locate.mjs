import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,dirname,join,relative,isAbsolute,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import {randomUUID} from 'node:crypto';
import {readContracts} from '../src/contracts/validate.mjs';
import {defaults} from '../src/contracts/build.mjs';
import {readSafe,hash,json} from '../src/skins/package.mjs';
import {decodePng} from '../src/skins/png.mjs';
import {locateSheet} from '../src/skins/locate.mjs';
import {associateSheet} from '../src/skins/associate.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const {values:v}=parseArgs({options:{input:{type:'string'}}});
try{
  if(!v.input)throw Error('Use skins:locate --input work/.../localization-input.json');
  const path=resolve(root,v.input),r=relative(join(root,'work'),path);
  if(isAbsolute(r)||r==='..'||r.startsWith('..'+sep))throw Error('locate.work-path-required');
  const bytes=await readFile(path),input=JSON.parse(bytes),contracts=await readContracts(defaults),template=contracts.template;
  if(input.kind!=='ui_skin_localization_input'||input.version!=='1.0'||input.templateSha256!==hash(contracts.bytes.template))throw Error('locate.input-contract');
  if(!Array.isArray(input.sheets)||input.sheets.length!==template.sheets.length||new Set(input.sheets.map(s=>s.sheetId)).size!==template.sheets.length)throw Error('locate.exact-sheet-coverage');
  const policyBytes=await readFile(join(root,'configs/skin-localization-policy.json')),policy=JSON.parse(policyBytes);
  const sheets=[];
  for(const sheet of template.sheets){
    const s=input.sheets.find(s=>s.sheetId===sheet.id);if(!s)throw Error('locate.missing-sheet');
    const raw=await readSafe(dirname(path),s.file);if(hash(raw)!==s.sha256)throw Error('locate.source-digest');
    const image=decodePng(raw);
    const location=locateSheet(image,sheet,template.coordinates);
    sheets.push({source:{file:s.file,sha256:s.sha256,width:image.width,height:image.height},...location,association:associateSheet(image,location,policy)});
  }
  const dir='work/skin-localization/'+randomUUID();await mkdir(join(root,dir),{recursive:true});
  const report={kind:'ui_skin_localization_candidates',version:'1.0',inputSha256:hash(bytes),templateSha256:input.templateSha256,algorithmSha256:hash(await readFile(join(root,'src/skins/locate.mjs'))),status:sheets.every(s=>s.status==='candidate')?'candidate':'needs-review',assemblyReady:false,productionReady:false,semanticIdentity:'not-verified',sheets};
  await writeFile(join(root,dir,'input.json'),bytes,{flag:'wx'});
  report.associationAlgorithmSha256=hash(await readFile(join(root,'src/skins/associate.mjs')));
  report.associationPolicySha256=hash(policyBytes);
  await writeFile(join(root,dir,'association-policy.json'),policyBytes,{flag:'wx'});
  await writeFile(join(root,dir,'report.json'),json(report),{flag:'wx'});
  console.log(json({directory:dir,status:report.status,assemblyReady:false,sheets:sheets.map(s=>({id:s.sheetId,status:s.status,candidates:s.parts.filter(p=>p.status==='candidate').length,associationProposals:s.association.parts.filter(p=>p.proposedCrop).length,total:s.parts.length,outside:s.outsideComponents.length,accounting:s.association.accounting}))}));
}catch(e){console.error(e.message);process.exitCode=1;}
