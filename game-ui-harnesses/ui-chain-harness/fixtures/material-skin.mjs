// Offline raster input producer for material/appearance regression tests.
import {mkdir,readFile,writeFile,copyFile} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {encodePng} from '../src/skins/png.mjs';
import {buildSkinPackage,hash,json} from '../src/skins/package.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
export async function materialSkinFixture(directory){
 await mkdir(directory,{recursive:true});
 const template=JSON.parse(await readFile(join(root,'configs/skin-template-set.draft.json'))),profile=JSON.parse(await readFile(join(root,'fixtures/neutral.skin.json')));
 const theme=Object.fromEntries(Object.entries(profile).filter(([k])=>!['kind','version','id','purpose','slice'].includes(k))),parts={};
 for(const sheet of template.sheets){
  const image={width:1024,height:1024,pixels:Buffer.alloc(1024*1024*4)};
  for(const p of sheet.parts){const[x,y,w,h]=p.bodyRect;for(let row=y;row<y+h;row++)for(let col=x;col<x+w;col++)image.pixels.set([30,75,92,255],(row*1024+col)*4);parts[p.assetId]={nineSlice:p.stretch==='uniform'?{left:0,top:0,right:0,bottom:0}:{left:4,top:4,right:4,bottom:4},contentInsets:{left:0,top:0,right:0,bottom:0},minSize:{width:p.stretch==='uniform'?1:9,height:p.stretch==='uniform'?1:9}};}
  await writeFile(join(directory,sheet.id+'.png'),encodePng(image));
 }
 await copyFile(join(root,'node_modules/@fontsource/noto-sans-sc/files/noto-sans-sc-latin-400-normal.woff2'),join(directory,'font.woff2'));
 await copyFile(join(root,'node_modules/@fontsource/noto-sans-sc/LICENSE'),join(directory,'license.txt'));
 const input=join(directory,'input.json'),spec={kind:'ui_skin_import',version:'0.1',id:'material-fixture',revision:1,sourceKind:'fixture',theme,parts,sheets:template.sheets.map(s=>({sheetId:s.id,file:s.id+'.png'})),fonts:[{family:theme.fontFamily,weight:400,style:'normal',unicodeRange:'U+0000-00FF',file:'font.woff2'}],licenses:[{file:'license.txt'}]};
 await writeFile(input,json(spec));
 const built=await buildSkinPackage({input,output:join(directory,'base')});
 const paper={width:32,height:32,pixels:Buffer.alloc(32*32*4)};
 for(let y=0;y<32;y++)for(let x=0;x<32;x++)paper.pixels.set((x+y)%8<2?[240,200,110,255]:[90,150,130,255],(y*32+x)*4);
 const bytes=encodePng(paper);await writeFile(join(directory,'paper.png'),bytes);
 const config={kind:'ui_skin_material_input',version:'1.0',sourceSkinSha256:built.manifestSha256,materials:[{assetId:'material.paper',file:'paper.png',sha256:hash(bytes),crop:[0,0,32,32]},{assetId:'material.accent',file:'paper.png',sha256:hash(bytes),crop:[8,8,16,16]}],surfaceStyles:{title:{baseRole:'skin.surface.bar',insets:{left:18,right:18,top:8,bottom:8},clipInsets:{left:4,right:4,top:4,bottom:4},radius:12,textColor:'#FFFFFF',layers:[{assetId:'material.paper',mode:'tile',scale:1,alpha:.4},{assetId:'material.accent',mode:'contain',width:48,height:48,anchorX:1,anchorY:.5,offsetX:12}]},panel:{baseRole:'skin.surface.panel',layers:[{assetId:'material.paper',mode:'tile',scale:1,alpha:.2}]}}};
 const configPath=join(directory,'materials.json');await writeFile(configPath,json(config));
 return {directory,input,spec,packageDirectory:join(built.directory,'pack'),config,configPath};
}
