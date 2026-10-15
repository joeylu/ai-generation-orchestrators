// Deterministic offline raster fixture: imported PNGs are synthetic, never model output.
import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises';
import {join,resolve,relative,isAbsolute,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {parseArgs,promisify} from 'node:util';
import {execFile} from 'node:child_process';
import {materialSkinFixture} from '../fixtures/material-skin.mjs';
import {buildSkinPackage,json,readSafe} from '../src/skins/package.mjs';
import {studioSnapshot} from '../src/studio/catalog.mjs';
const root=fileURLToPath(new URL('../',import.meta.url)),exec=promisify(execFile);
export function fixtureWorkPath(value){
 const path=resolve(root,value),r=relative(join(root,'work'),path);
 if(!r||isAbsolute(r)||r==='..'||r.startsWith('..'+sep))throw Error('STUDIO_FIXTURE_WORK_PATH_REQUIRED');
 return path;
}
export async function readStudioFixtureConfig(path){
 const file=fixtureWorkPath(path),config=JSON.parse(await readSafe(root,relative(root,file).replaceAll('\\','/')));
 if(config.fixture?.kind!=='ui_studio_offline_fixture'||config.fixture.realModelCalls!==0||config.fixture.source!=='synthetic-raster')throw Error('STUDIO_OFFLINE_FIXTURE_CONFIG_REQUIRED');
 return config;
}
export async function buildStudioFixture({output=join(root,'work/studio-fixtures',randomUUID())}={}){
 const directory=fixtureWorkPath(output);await mkdir(directory,{recursive:true});
 const source=await materialSkinFixture(join(directory,'source'));
 // A fresh input document imports locally produced PNGs through the ordinary pack producer.
 // Keep fixture identity outside the generated manifest instead of editing its fingerprints.
 const spec={...source.spec,id:'studio-offline-synthetic',sourceKind:'imported',fonts:[]};
 const fontRoot=join(root,'node_modules/@fontsource/noto-sans-sc'),css=await readFile(join(fontRoot,'400.css'),'utf8');
 await mkdir(join(source.directory,'fonts'),{recursive:true});
 for(const match of css.matchAll(/@font-face\s*\{([^}]+)\}/g)){
  const block=match[1],file=block.match(/url\(\.\/files\/([^)]*\.woff2)\)/)?.[1],range=block.match(/unicode-range:\s*([^;]+);/)?.[1];
  if(!file||!range)throw Error('STUDIO_FIXTURE_FONT_CHANGED');
  await copyFile(join(fontRoot,'files',file),join(source.directory,'fonts',file));
  spec.fonts.push({family:spec.theme.fontFamily,weight:400,style:'normal',unicodeRange:range.replaceAll(' ',''),file:'fonts/'+file});
 }
 const input=join(source.directory,'studio-import.json');await writeFile(input,json(spec),{flag:'wx'});
 const skin=await buildSkinPackage({input,output:join(directory,'skin')});
 const run=async(script,args)=>{const result=await exec(process.execPath,[join(root,'scripts',script),...args],{cwd:root,windowsHide:true,maxBuffer:2*1024*1024,timeout:120000});return result.stdout.trim();};
 const packageDirectory=join(skin.directory,'pack');
 const consumer=await run('consumer-pack.mjs',['--package',packageDirectory,'--out',join(directory,'consumers')]);
 const panel=await run('settings-preview.mjs',['--package',packageDirectory,'--out',join(directory,'panels')]);
 const local=path=>relative(root,path).replaceAll('\\','/');
 const config={version:'0.1',name:'Isolated offline Studio fixture',artifacts:[{id:'fixture-components',name:'Synthetic component fixture',type:'components',directory:local(consumer)},{id:'fixture-panel',name:'Synthetic panel fixture',type:'panel',directory:local(panel)}],tasks:[],fixture:{kind:'ui_studio_offline_fixture',version:'1.0',source:'synthetic-raster',realModelCalls:0,productionReady:false,visualAcceptance:'unreviewed'}};
 await studioSnapshot(root,config);
 const configPath=join(directory,'fixture.json');await writeFile(configPath,json(config),{flag:'wx'});
 return {directory,configPath,consumer,panel,realModelCalls:0,source:'synthetic-raster'};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const {values}=parseArgs({options:{out:{type:'string'},help:{type:'boolean',default:false}}});
 if(values.help)console.log('node scripts/studio-fixture-build.mjs [--out work/<new-fixture-directory>] — deterministic synthetic assets; model calls 0');
 else console.log(json(await buildStudioFixture(values.out?{output:values.out}:{})));
}
