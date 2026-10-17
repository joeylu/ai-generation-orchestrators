// Deterministic test input producer. Its outputs always retain sourceKind=fixture.
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderSheets } from '../src/templates/renderer.mjs';
import { defaults } from '../src/contracts/build.mjs';
import { readContracts } from '../src/contracts/validate.mjs';
import { json } from '../src/skins/package.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
export async function prepareRasterFixture(directory, channel='chrome') {
  const {template}=await readContracts(defaults);
  await mkdir(directory,{recursive:true});
  const profile=JSON.parse(await readFile(join(root,'fixtures/neutral.skin.json')));
  await renderSheets({spec:{...template,palette:{...template.palette,...profile.palette}},directory,channel});
  const theme=Object.fromEntries(Object.entries(profile).filter(([key])=>!['kind','version','id','purpose','slice'].includes(key)));
  const parts=Object.fromEntries(template.sheets.flatMap(s=>s.parts).map(p=>{
    const text=/^(button|field|item|tab)\./.test(p.assetId), panel=p.assetId==='surface.panel';
    const contentInsets={left:text||panel?profile.padding:0,right:text||panel?profile.padding:0,top:panel?profile.padding:0,bottom:panel?profile.padding:0};
    const nineSlice=p.stretch==='uniform'?{left:0,top:0,right:0,bottom:0}:{left:3,top:2,right:5,bottom:4};
    return [p.assetId,{nineSlice,contentInsets,minSize:{width:Math.max(8,contentInsets.left+contentInsets.right+1),height:Math.max(8,contentInsets.top+contentInsets.bottom+1)}}];
  }));
  const fontRoot=join(root,'node_modules/@fontsource/noto-sans-sc'),css=await readFile(join(fontRoot,'400.css'),'utf8'),fonts=[];
  await mkdir(join(directory,'fonts'),{recursive:true});
  for(const match of css.matchAll(/@font-face\s*\{([^}]+)\}/g)){
    const block=match[1], file=block.match(/url\(\.\/files\/([^)]*\.woff2)\)/)?.[1], range=block.match(/unicode-range:\s*([^;]+);/)?.[1];
    if(!file || !range)throw Error('Bundled font CSS changed.');
    await copyFile(join(fontRoot,'files',file),join(directory,'fonts',file));
    fonts.push({family:profile.fontFamily,weight:400,style:'normal',unicodeRange:range.replaceAll(' ',''),file:'fonts/'+file});
  }
  await copyFile(join(fontRoot,'LICENSE'),join(directory,'font-license.txt'));
  const input={kind:'ui_skin_import',version:'0.1',id:'neutral-png-fixture',revision:1,sourceKind:'fixture',theme,
    sheets:template.sheets.map(s=>({sheetId:s.id,file:`${s.filePrefix}.clean.png`})),parts,fonts,licenses:[{file:'font-license.txt'}]};
  await writeFile(join(directory,'skin-import.json'),json(input),{flag:'wx'});
  return join(directory,'skin-import.json');
}
