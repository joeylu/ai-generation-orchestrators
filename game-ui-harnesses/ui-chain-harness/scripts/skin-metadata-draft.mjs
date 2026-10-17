import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,relative,dirname,join,isAbsolute,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import {randomUUID} from 'node:crypto';
import {readSafe,hash,json} from '../src/skins/package.mjs';
import {readContracts} from '../src/contracts/validate.mjs';
import {defaults} from '../src/contracts/build.mjs';
import {decodePng,cropPng} from '../src/skins/png.mjs';
import {inspectAssembly} from '../src/skins/postprocess.mjs';
import {deriveMetadata} from '../src/skins/metadata-draft.mjs';
import {locateSheet} from '../src/skins/locate.mjs';
import {associateSheet} from '../src/skins/associate.mjs';
import {assertSeparatedCrops} from '../src/skins/proposal-crops.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const {values:v}=parseArgs({options:{report:{type:'string'},input:{type:'string'},profile:{type:'string'}}});
const local=p=>{if(!p)throw Error('Required --report --input --profile');const q=resolve(root,p),r=relative(join(root,'work'),q);if(isAbsolute(r)||r==='..'||r.startsWith('..'+sep))throw Error('trial.work-path');return q;};
try{
  const rp=local(v.report),ip=local(v.input),bp=local(v.profile);
  const rb=await readFile(rp),ib=await readFile(ip),bb=await readFile(bp),r=JSON.parse(rb),input=JSON.parse(ib),base=JSON.parse(bb),contracts=await readContracts(defaults);
  const policyBytes=await readSafe(dirname(rp),'association-policy.json'),policy=JSON.parse(policyBytes);
  if(r.kind!=='ui_skin_localization_candidates'||r.inputSha256!==hash(ib)||r.templateSha256!==hash(contracts.bytes.template)||input.templateSha256!==r.templateSha256||r.associationPolicySha256!==hash(policyBytes))throw Error('trial.binding');
  for(const [file,expected] of [['src/skins/locate.mjs',r.algorithmSha256],['src/skins/associate.mjs',r.associationAlgorithmSha256]])if(hash(await readFile(join(root,file)))!==expected)throw Error('trial.stale-algorithm-rerun-locate');
  if(base.kind!=='ui_skin_metadata_profile'||base.version!=='1.0'||!base.theme||!base.id||!Number.isInteger(base.revision)||base.revision<1)throw Error('metadata.profile');
  const metadataPolicyBytes=await readFile(join(root,'configs/skin-metadata-policy.json')),metadataPolicy=JSON.parse(metadataPolicyBytes);
  const sources=[],parts={},evidence=[],images=new Map();
  // Retain compatibility with old explicit trial profiles. Foreign-slot warnings
  // are now non-blocking when ownership and actual crop separation are verified.
  const allowedIssues=base.allowedProposalIssues??[];
  if(!Array.isArray(allowedIssues)||allowedIssues.some(i=>i!=='foreign-component-in-slot'))throw Error('metadata.invalid-proposal-exception');
  if(r.sheets.length!==contracts.template.sheets.length||input.sheets.length!==r.sheets.length)throw Error('trial.sheet-coverage');
  for(const sheet of contracts.template.sheets){
    const s=r.sheets.find(s=>s.sheetId===sheet.id),binding=input.sheets.find(s=>s.sheetId===sheet.id);
    if(!s||!binding||s.source.sha256!==binding.sha256||s.source.file!==binding.file)throw Error('trial.source-binding');
    const raw=await readSafe(dirname(ip),binding.file);if(hash(raw)!==binding.sha256)throw Error('trial.source-changed');
    const image=decodePng(raw),location=locateSheet(image,sheet,contracts.template.coordinates),fresh=associateSheet(image,location,policy);
    if(JSON.stringify(fresh)!==JSON.stringify(s.association))throw Error('trial.proposal-replay-mismatch');
    assertSeparatedCrops(fresh.parts);
    const file='sources/'+sheet.id+'.png';sources.push({file,raw});
    for(const def of sheet.parts){
      const p=fresh.parts.find(p=>p.assetId===def.assetId);
      if(!p)throw Error('trial.sheet-coverage');
      images.set(def.assetId,cropPng(image,p.proposedCrop));
      parts[def.assetId]={file,sha256:binding.sha256,crop:p.proposedCrop};
      evidence.push({assetId:def.assetId,proposalIssues:p.issues});
    }
  }
  const derived=deriveMetadata(contracts.template,images,metadataPolicy,base.overrides??{});
  for(const [id,value] of Object.entries(derived.parts))Object.assign(parts[id],value);
  if(hash(await readFile(bp))!==hash(bb)||hash(await readFile(join(root,'configs/skin-metadata-policy.json')))!==hash(metadataPolicyBytes))throw Error('metadata.inputs-changed');
  const dir='work/skin-metadata-drafts/'+randomUUID(),absolute=join(root,dir);await mkdir(join(absolute,'sources'),{recursive:true});
  for(const s of sources)await writeFile(join(absolute,s.file),s.raw,{flag:'wx'});
  const config={id:base.id,revision:base.revision,theme:base.theme,templateSha256:r.templateSha256,parts};
  await writeFile(join(absolute,'assembly.json'),json(config),{flag:'wx'});
  await writeFile(join(absolute,'trial.json'),json({kind:'ui_skin_metadata_draft',version:'1.0',proposalReportSha256:hash(rb),profileSha256:hash(bb),profile:base,metadataPolicySha256:hash(metadataPolicyBytes),metadataPolicy,inputSha256:hash(ib),visualAcceptance:'unreviewed',productionReady:false,evidence,metadataEvidence:derived.evidence}),{flag:'wx'});
  const inspection=await inspectAssembly(join(absolute,'assembly.json'),contracts);await writeFile(join(absolute,'inspection.json'),json(inspection),{flag:'wx'});
  console.log(json({directory:dir,assembly:dir+'/assembly.json',parts:evidence.length,status:'experimental-candidate'}));
}catch(e){console.error(json({status:'failed',code:e.code??'metadata.failed',message:e.message}));process.exitCode=1;}
