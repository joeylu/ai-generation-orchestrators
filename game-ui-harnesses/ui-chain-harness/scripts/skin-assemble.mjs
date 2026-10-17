import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join,dirname,relative,isAbsolute,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import {randomUUID} from 'node:crypto';
import {readSafe,hash,json,buildSkinPackage} from '../src/skins/package.mjs';
import {readContracts} from '../src/contracts/validate.mjs';
import {defaults} from '../src/contracts/build.mjs';
import {decodePng,encodePng,cropPng} from '../src/skins/png.mjs';
import {fitAsset,fitSlicedAsset,supportsSliceFit} from '../src/skins/assemble.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const privatePath=p=>{const q=resolve(p),r=relative(join(root,'work'),q);if(isAbsolute(r)||r==='..'||r.startsWith('..'+sep))throw Error('Use work/');return q;};
const {values:v}=parseArgs({options:{config:{type:'string'},out:{type:'string'}}});
const configPath=privatePath(v.config),base=dirname(configPath),bytes=await readSafe(base,configPath.slice(base.length+1)),config=JSON.parse(bytes);
const {template,bytes:contractBytes}=await readContracts(defaults);
if(hash(contractBytes.template)!==config.templateSha256)throw Error('Template changed; review assembly mapping');
const ids=template.sheets.flatMap(s=>s.parts.map(p=>p.assetId));
if(Object.keys(config.parts).length!==ids.length||ids.some(id=>!config.parts[id]))throw Error('Require exact full asset coverage');
const dir=join(privatePath(v.out),randomUUID()),sources=new Map(),operations=[];
await mkdir(dir,{recursive:true});await writeFile(join(dir,'assembly-input.json'),bytes,{flag:'wx'});
for(const id of ids){const p=config.parts[id];const raw=await readSafe(base,p.file);if(hash(raw)!==p.sha256)throw Error('Source digest mismatch: '+id);const image=decodePng(raw);sources.set(id,p.crop?cropPng(image,p.crop):image);}
const groups=template.stateGroups??[];
for(const sheet of template.sheets){
  const scale=template.coordinates.outputScale,canvas={width:template.coordinates.width*scale,height:template.coordinates.height*scale,pixels:Buffer.alloc(template.coordinates.width*template.coordinates.height*scale*scale*4)};
  for(const p of sheet.parts){
    const group=groups.find(g=>g.assetIds.includes(p.assetId)),members=(group?.assetIds??[p.assetId]).map(id=>sources.get(id));
    const frame=[Math.max(...members.map(im=>im.width)),Math.max(...members.map(im=>im.height))];
    const fit=config.parts[p.assetId].fit;
    if(fit && (!supportsSliceFit(fit,p.stretch,group)))throw Error('Invalid configured fit: '+p.assetId);
    const [x,y,w,h]=p.bodyRect.map(n=>n*scale),r=fit?fitSlicedAsset(sources.get(p.assetId),w,h,fit):fitAsset(sources.get(p.assetId),w,h,frame);
    for(let row=0;row<h;row++)r.image.pixels.copy(canvas.pixels,((y+row)*canvas.width+x)*4,row*w*4,(row+1)*w*4);
    operations.push({assetId:p.assetId,sourceFile:config.parts[p.assetId].file,sourceSha256:config.parts[p.assetId].sha256,crop:config.parts[p.assetId].crop??null,...r.operation});
  }
  await writeFile(join(dir,sheet.id+'.png'),encodePng(canvas),{flag:'wx'});
}
const fontRoot=join(root,'node_modules/@fontsource/noto-sans-sc'),css=await readFile(join(fontRoot,'400.css'),'utf8'),fonts=[];
await mkdir(join(dir,'fonts'));
for(const m of css.matchAll(/@font-face\s*\{([^}]+)\}/g)){const f=m[1].match(/url\(\.\/files\/([^)]*\.woff2)\)/)?.[1],range=m[1].match(/unicode-range:\s*([^;]+);/)?.[1];if(!f||!range)throw Error('Font metadata changed');const b=await readSafe(fontRoot,'files/'+f);await writeFile(join(dir,'fonts',f),b,{flag:'wx'});fonts.push({family:config.theme.fontFamily,weight:400,style:'normal',unicodeRange:range.replaceAll(' ',''),file:'fonts/'+f});}
await writeFile(join(dir,'font-license.txt'),await readSafe(fontRoot,'LICENSE'),{flag:'wx'});
const spec={kind:'ui_skin_import',version:'0.1',id:config.id,revision:config.revision,sourceKind:'imported',theme:config.theme,sheets:template.sheets.map(s=>({sheetId:s.id,file:s.id+'.png'})),parts:Object.fromEntries(ids.map(id=>[id,config.parts[id].metadata])),fonts,licenses:[{file:'font-license.txt'}]};
if(config.surfaceStyles)spec.surfaceStyles=structuredClone(config.surfaceStyles);
if(config.materials){
  const copied=new Map();spec.materials=[];
  for(const material of config.materials){const raw=await readSafe(base,material.file);if(hash(raw)!==material.sha256)throw Error('Material source digest changed.');const file='material-inputs/'+material.sha256+'.png';if(!copied.has(file)){await mkdir(join(dir,'material-inputs'),{recursive:true});await writeFile(join(dir,file),raw,{flag:'wx'});copied.set(file,true);}spec.materials.push({...material,file});}
}
await writeFile(join(dir,'skin-import.json'),json(spec),{flag:'wx'});
await writeFile(join(dir,'assembly-report.json'),json({kind:'ui_skin_assembly',inputSha256:hash(bytes),templateSha256:config.templateSha256,operations,edgeRepair:false,visualAcceptance:'unreviewed'}),{flag:'wx'});
if(hash(await readSafe(base,configPath.slice(base.length+1)))!==hash(bytes))throw Error('Assembly config changed');
const built=await buildSkinPackage({input:join(dir,'skin-import.json'),output:join(dir,'package')});
console.log(json({assemblyDirectory:dir,...built}));
