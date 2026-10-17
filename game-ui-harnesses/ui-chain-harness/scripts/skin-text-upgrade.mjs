// Deterministic, new revision only. No image modification or model invocation.
import {writeFile,mkdir} from 'node:fs/promises';
import {resolve,join,relative,isAbsolute,sep,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {parseArgs} from 'node:util';
import {verifySkinPackage,json} from '../src/skins/package.mjs';
import {deriveTextReadability} from '../src/skins/text-readability.mjs';
import {decodePng} from '../src/skins/png.mjs';
const {values}=parseArgs({options:{package:{type:'string'},out:{type:'string'}}});
if(!values.package||!values.out)throw Error('Use --package <verified skin> --out <work directory>');
const root=fileURLToPath(new URL('../',import.meta.url)),out=resolve(values.out),r=relative(join(root,'work'),out);
if(isAbsolute(r)||r==='..'||r.startsWith('..'+sep))throw Error('Output must be in work/');
const source=await verifySkinPackage(resolve(values.package)),pack=structuredClone(source.pack);
const images=new Map(pack.assets.map(a=>[a.assetId,decodePng(source.resources.get(a.file))]));
const result=deriveTextReadability(pack,images);pack.theme.textColors=result.inks;pack.revision++;
const dir=join(out,randomUUID()),target=join(dir,'pack');await mkdir(target,{recursive:true});
for(const[file,bytes]of source.resources){await mkdir(dirname(join(target,file)),{recursive:true});await writeFile(join(target,file),bytes,{flag:'wx'});}
await writeFile(join(target,'skin-pack.json'),json(pack),{flag:'wx'});
const checked=await verifySkinPackage(target);
await writeFile(join(dir,'text-upgrade.json'),json({kind:'ui_skin_text_upgrade',sourceManifestSha256:source.manifestSha256,manifestSha256:checked.manifestSha256,revision:pack.revision,pixelsUnchanged:true,modelCalls:0,textReadability:checked.textReadability,visualAcceptance:'unreviewed',productionReady:false}),{flag:'wx'});
console.log(json({directory:dir,package:target,manifestSha256:checked.manifestSha256,textReadability:checked.textReadability.status,modelCalls:0}));
