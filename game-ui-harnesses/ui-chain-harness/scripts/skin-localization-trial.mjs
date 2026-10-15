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
import {trialPart} from '../src/skins/localization-trial.mjs';
import {locateSheet} from '../src/skins/locate.mjs';
import {associateSheet} from '../src/skins/associate.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const {values:v}=parseArgs({options:{report:{type:'string'},input:{type:'string'},baseline:{type:'string'},'allow-different-source-trial':{type:'boolean',default:false}}});
const local=p=>{if(!p)throw Error('Required --report --input --baseline');const q=resolve(root,p),r=relative(join(root,'work'),q);if(isAbsolute(r)||r==='..'||r.startsWith('..'+sep))throw Error('trial.work-path');return q;};
try{
  const rp=local(v.report),ip=local(v.input),bp=local(v.baseline);
  const rb=await readFile(rp),ib=await readFile(ip),bb=await readFile(bp),r=JSON.parse(rb),input=JSON.parse(ib),base=JSON.parse(bb),contracts=await readContracts(defaults);
  const policyBytes=await readSafe(dirname(rp),'association-policy.json'),policy=JSON.parse(policyBytes);
  if(r.kind!=='ui_skin_localization_candidates'||r.inputSha256!==hash(ib)||r.templateSha256!==hash(contracts.bytes.template)||base.templateSha256!==r.templateSha256||input.templateSha256!==r.templateSha256||r.associationPolicySha256!==hash(policyBytes))throw Error('trial.binding');
  for(const [file,expected] of [['src/skins/locate.mjs',r.algorithmSha256],['src/skins/associate.mjs',r.associationAlgorithmSha256]])if(hash(await readFile(join(root,file)))!==expected)throw Error('trial.stale-algorithm-rerun-locate');
  const sources=[],parts={},evidence=[];
  if(r.sheets.length!==contracts.template.sheets.length||input.sheets.length!==r.sheets.length)throw Error('trial.sheet-coverage');
  for(const sheet of contracts.template.sheets){
    const s=r.sheets.find(s=>s.sheetId===sheet.id),binding=input.sheets.find(s=>s.sheetId===sheet.id);
    if(!s||!binding||s.source.sha256!==binding.sha256||s.source.file!==binding.file)throw Error('trial.source-binding');
    const raw=await readSafe(dirname(ip),binding.file);if(hash(raw)!==binding.sha256)throw Error('trial.source-changed');
    const image=decodePng(raw),location=locateSheet(image,sheet,contracts.template.coordinates),fresh=associateSheet(image,location,policy);
    if(JSON.stringify(fresh)!==JSON.stringify(s.association))throw Error('trial.proposal-replay-mismatch');
    const file='sources/'+sheet.id+'.png';sources.push({file,raw});
    for(const def of sheet.parts){
      const p=fresh.parts.find(p=>p.assetId===def.assetId),old=base.parts[def.assetId];
      if(!p?.proposedCrop||!old||p.issues.includes('overlapping-proposals'))throw Error('trial.unresolved-or-overlap');
      cropPng(image,p.proposedCrop);
      if(hash(await readSafe(dirname(bp),old.file))!==old.sha256)throw Error('trial.baseline-source-changed');
      const derived=trialPart(old,{file,sha256:binding.sha256},p.proposedCrop,def.stretch,v['allow-different-source-trial']);
      parts[def.assetId]=derived.part;evidence.push({assetId:def.assetId,proposalIssues:p.issues,...derived.evidence});
    }
  }
  const dir='work/skin-localization-trials/'+randomUUID(),absolute=join(root,dir);await mkdir(join(absolute,'sources'),{recursive:true});
  for(const s of sources)await writeFile(join(absolute,s.file),s.raw,{flag:'wx'});
  const config={...base,parts};
  await writeFile(join(absolute,'assembly.json'),json(config),{flag:'wx'});
  await writeFile(join(absolute,'trial.json'),json({kind:'ui_skin_localization_trial',version:'1.0',proposalReportSha256:hash(rb),baselineSha256:hash(bb),inputSha256:hash(ib),allowDifferentSourceTrial:v['allow-different-source-trial'],visualAcceptance:'unreviewed',productionReady:false,evidence}),{flag:'wx'});
  const inspection=await inspectAssembly(join(absolute,'assembly.json'),contracts);await writeFile(join(absolute,'inspection.json'),json(inspection),{flag:'wx'});
  console.log(json({directory:dir,assembly:dir+'/assembly.json',parts:evidence.length,differentSource:evidence.filter(e=>!e.sameSource).length,status:'experimental-candidate'}));
}catch(e){console.error(e.message);process.exitCode=1;}
