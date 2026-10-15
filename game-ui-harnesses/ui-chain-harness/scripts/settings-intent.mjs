import {settingsSkinGeometry} from '../src/panel/skin-geometry.mjs';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join,relative,isAbsolute,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {parseArgs} from 'node:util';
import {settingsFromIntent} from '../src/panel/settings-intent.mjs';
import {editorData} from '../src/panel/data.mjs';
import {verifySkinPackage,hash,json,bindingsOf} from '../src/skins/package.mjs';
import {readContracts} from '../src/contracts/validate.mjs';
import {defaults} from '../src/contracts/build.mjs';

// Offline conversion only: no transport, model call or automatic retry.
const {values}=parseArgs({options:{session:{type:'string'},intent:{type:'string'},package:{type:'string'},out:{type:'string'}}});
if(!values.session||!values.intent||!values.package||!values.out)throw Error('Use --session <json> --intent <json> --package <pack> --out <work-directory>');
const root=fileURLToPath(new URL('../',import.meta.url)),out=resolve(values.out),r=relative(join(root,'work'),out);
if(isAbsolute(r)||r==='..'||r.startsWith('..'+sep))throw Error('Output must be in work/');
const read=async p=>JSON.parse(await readFile(p,'utf8'));
const {pack,manifestSha256}=await verifySkinPackage(resolve(values.package));
const expected=bindingsOf(await readContracts(defaults));
if(pack.sourceKind!=='imported'||Object.keys(expected).some(k=>expected[k]!==pack.bindings[k]))throw Error('Use a current verified imported skin.');
const data=await editorData(),ctx={...data,profile:pack.theme,...settingsSkinGeometry(pack),binding:{sourceKind:'imported',sha256:manifestSha256}};
const session=await read(values.session),intent=await read(values.intent),policy=await read(join(root,'configs/settings-planning-policy.json')),layout=await read(join(root,'configs/settings-layout.json'));
const result=await settingsFromIntent(session,intent,policy,layout,ctx);
const dir=join(out,randomUUID());await mkdir(dir,{recursive:true});
const files=[];
for(const [name,value] of Object.entries({'session.json':session,'intent.json':intent,'policy.json':policy,'layout.json':layout,'content.json':result.content,
  'landscape.panel.json':result.documents.landscape,'portrait.panel.json':result.documents.portrait})){
  const bytes=Buffer.from(json(value));await writeFile(join(dir,name),bytes,{flag:'wx'});files.push({file:name,sha256:hash(bytes)});
}
await writeFile(join(dir,'report.json'),json({kind:'settings-intent-conversion',version:'1.0',...result.provenance,files,visualAcceptance:'unreviewed',productionReady:false}),{flag:'wx'});
console.log(dir);
