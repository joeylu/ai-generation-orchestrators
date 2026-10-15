// Prepare a new assembly candidate. Never updates the selected or accepted package.
import {readFile,writeFile} from 'node:fs/promises';
import {resolve,dirname,relative,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import {inspectAssembly} from '../src/skins/postprocess.mjs';
import {readContracts} from '../src/contracts/validate.mjs';
import {defaults} from '../src/contracts/build.mjs';
import {hash,json,readSafe} from '../src/skins/package.mjs';
import {assertMetadata} from '../src/skins/contract.mjs';
const root=fileURLToPath(new URL('../work/',import.meta.url));
const {values:v}=parseArgs({options:{config:{type:'string'},out:{type:'string'},overrides:{type:'string'}}});
const local=p=>{if(!p)throw Error('Use --config and --out, optionally --overrides');const path=resolve(p),r=relative(root,path);if(isAbsolute(r)||r==='..'||r.startsWith('../')||r.startsWith('..\\'))throw Error('Use Harness work paths');return path;};
const path=local(v.config),out=local(v.out);
if(dirname(path)!==dirname(out)||path===out)throw Error('Output must be a new sibling config to preserve source paths');
const contracts=await readContracts(defaults),inspection=await inspectAssembly(path,contracts);
const bytes=await readSafe(dirname(path),path.slice(dirname(path).length+1));
if(hash(bytes)!==inspection.inputSha256)throw Error('Input changed');
const config=JSON.parse(bytes),overrides=v.overrides?JSON.parse(await readFile(local(v.overrides))):{},changes=[];
const byId=new Map(inspection.sheets.flatMap(s=>s.parts.map(p=>[p.assetId,p])));
for(const id of Object.keys(overrides))if(!byId.has(id)||byId.get(id).contentInsetSuggestion.status==='not-applicable')throw Error('Override must target a supported policy asset');
for(const [id,p] of byId){
  const suggestion=p.contentInsetSuggestion;if(suggestion.status==='not-applicable')continue;
  const manual=overrides[id];
  if(suggestion.status!=='suggested'&&!manual)throw Error('Border evidence needs explicit override: '+id);
  if(manual&&(Object.keys(manual).length!==2||!['left','right'].every(k=>Number.isInteger(manual[k])&&manual[k]>=0)))throw Error('Overrides require nonnegative integer left/right');
  const meta=config.parts[id].metadata,before={...meta.contentInsets};
  for(const k of ['left','right'])meta.contentInsets[k]=manual?manual[k]:Math.max(meta.contentInsets[k],suggestion.proposed[k]);
  changes.push({assetId:id,before,after:{...meta.contentInsets},basis:manual?'explicit-skin-override':'common-suggestion-preserving-larger-insets',suggestion});
}
// A field's normal/focused states must not move content when switching.
for(const group of contracts.template.stateGroups??[]){
  const rows=group.assetIds.map(id=>changes.find(c=>c.assetId===id)).filter(Boolean);
  if(!rows.length)continue;
  if(rows.length!==group.assetIds.length)throw Error('Partial state-family policy coverage');
  for(const k of ['left','right']){
    const value=Math.max(...rows.map(c=>c.after[k]));
    if(rows.some(c=>overrides[c.assetId]&&overrides[c.assetId][k]!==value))throw Error('Conflicting state-family override');
    for(const c of rows){c.after[k]=value;config.parts[c.assetId].metadata.contentInsets[k]=value;}
  }
}
for(const part of contracts.template.sheets.flatMap(s=>s.parts)){
  const m=config.parts[part.assetId].metadata,c=m.contentInsets;
  m.minSize.width=Math.max(m.minSize.width,c.left+c.right+1);
  assertMetadata(m,part.bodyRect[2],part.bodyRect[3],part.stretch);
}
// Check originals and policy again before emitting the candidate.
const recheck=await inspectAssembly(path,contracts);
if(JSON.stringify(recheck)!==JSON.stringify(inspection))throw Error('Inputs or policy changed');
config.revision++;
await writeFile(out,json(config),{flag:'wx'});
await writeFile(out+'.insets.json',json({kind:'ui_skin_content_inset_candidate',inputSha256:inspection.inputSha256,policySha256:inspection.contentInsetPolicySha256,overrides,changes,visualAcceptance:'unreviewed',productionReady:false}),{flag:'wx'});
console.log(json({directory:out,changedAssets:changes.length,changes:changes.map(c=>({assetId:c.assetId,insets:c.after})),productionReady:false}));
