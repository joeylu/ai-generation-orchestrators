import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, mkdtemp, copyFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodePng, decodePng, cropPng } from '../src/skins/png.mjs';
import { buildSkinPackage, verifySkinPackage, skinPackageStatus, hash, json } from '../src/skins/package.mjs';
import { validatePack, safePath } from '../src/skins/contract.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const template=JSON.parse(await readFile(join(root,'configs/skin-template-set.draft.json')));
async function setup(){
  const base=fileURLToPath(new URL('../../../.tmp/ui-chain-skin-tests/',import.meta.url));await mkdir(base,{recursive:true});
  const dir=await mkdtemp(join(base,'case-')), profile=JSON.parse(await readFile(join(root,'fixtures/neutral.skin.json')));
  const theme=Object.fromEntries(Object.entries(profile).filter(([k])=>!['kind','version','id','purpose','slice'].includes(k)));
  const parts={};
  for(const sheet of template.sheets){
    const image={width:1024,height:1024,pixels:Buffer.alloc(1024*1024*4)};
    for(const p of sheet.parts){
      const [x,y,w,h]=p.bodyRect;
      for(let row=y;row<y+h;row++)for(let col=x;col<x+w;col++){const i=(row*1024+col)*4;image.pixels.set([35,80,130,255],i);}
      image.pixels[(y*1024+x)*4+3]=128;
      parts[p.assetId]={nineSlice:{left:0,top:0,right:0,bottom:0},contentInsets:{left:0,top:0,right:0,bottom:0},minSize:{width:1,height:1}};
    }
    await writeFile(join(dir,sheet.id+'.png'),encodePng(image));
  }
  await copyFile(join(root,'node_modules/@fontsource/noto-sans-sc/files/noto-sans-sc-latin-400-normal.woff2'),join(dir,'font.woff2'));
  await copyFile(join(root,'node_modules/@fontsource/noto-sans-sc/LICENSE'),join(dir,'license.txt'));
  const spec={kind:'ui_skin_import',version:'0.1',id:'test-raster',revision:1,sourceKind:'fixture',theme,parts,sheets:template.sheets.map(s=>({sheetId:s.id,file:s.id+'.png'})),fonts:[{family:profile.fontFamily,weight:400,style:'normal',unicodeRange:'U+0000-00FF',file:'font.woff2'}],licenses:[{file:'license.txt'}]};
  const input=join(dir,'input.json'), output=join(dir,'out');
  const save=()=>writeFile(input,json(spec));await save();
  return {dir,input,output,spec,save,build:()=>buildSkinPackage({input,output})};
}
test('per-asset density survives a verified package roundtrip and rejects collapsed centers',async()=>{
  const w=await setup(),m=w.spec.parts['button.primary.normal'];m.density=4;m.nineSlice={left:12,right:12,top:4,bottom:4};m.minSize={width:24,height:8};await w.save();
  const built=await w.build(),r=await verifySkinPackage(join(built.directory,'pack'));
  assert.equal(r.pack.assets.find(a=>a.assetId==='button.primary.normal').density,4);
  m.density=32;await w.save();await assert.rejects(w.build(),e=>e.code==='skin.slice');
});
test('PNG crop retains fractional alpha and zeroes RGB only at alpha zero',()=>{
  const source={width:2,height:2,pixels:Buffer.from([10,20,30,255,90,70,30,128,55,66,77,0,1,2,3,255])};
  const result=cropPng(decodePng(encodePng(source)),[1,0,1,2]);
  assert.deepEqual([...result.pixels],[90,70,30,128,1,2,3,255]);
  assert.deepEqual([...decodePng(encodePng(source)).pixels.subarray(8,12)],[0,0,0,0]);
  assert.throws(()=>cropPng(source,[2,0,1,1]),{code:'skin.png'});
  const corrupt=encodePng(source);corrupt[40]^=1;assert.throws(()=>decodePng(corrupt),{code:'skin.png'});
  assert.throws(()=>decodePng(Buffer.from('not png')),{code:'skin.png'});
});
test('package roundtrip carries all 32 independent assets, sources, font/license and remains unreviewed',async()=>{
  const s=await setup(),built=await s.build(),r=await verifySkinPackage(join(built.directory,'pack'));
  assert.equal(r.pack.assets.length,32);assert.equal(r.pack.sources.length,4);assert.equal(r.pack.visualAcceptance,'unreviewed');assert.equal(r.pack.sourceKind,'fixture');
  for(const id of ['slot.normal','slot.selected'])assert.equal(r.pack.roles.find(role=>role.role==='skin.'+id).assetId,id);
  assert.equal((await skinPackageStatus(s.output)).status,'current');
  assert.ok(r.pack.assets.every(a=>r.resources.has(a.file)));assert.equal(r.pack.fonts.length,1);
  assert.equal(r.textReadability.status,'passed');assert.ok(Object.keys(r.pack.theme.textColors).length>0);
  const missing=structuredClone(r.pack);delete missing.theme.textColors['skin.surface.panel'];assert.throws(()=>validatePack(missing),{code:'skin.text-colors'});
  assert.throws(()=>validatePack(r.pack,{templateSha256:'0'.repeat(64)}),{code:'skin.binding'});
});
test('legacy packs remain byte-compatible and explicitly not assessed',async()=>{
 const s=await setup(),built=await s.build(),directory=join(built.directory,'pack'),r=await verifySkinPackage(directory);
 delete r.pack.theme.textColors;await writeFile(join(directory,'skin-pack.json'),json(r.pack));
 const legacy=await verifySkinPackage(directory);assert.equal(legacy.textReadability.status,'not-assessed');assert.equal(legacy.pack.theme.textColors,undefined);
});
test('all source/metadata identity mismatches fail before publication',async()=>{
  const s=await setup();delete s.spec.parts['surface.panel'];await s.save();await assert.rejects(s.build,{code:'skin.coverage'});
  assert.equal((await skinPackageStatus(s.output)).status,'missing');
});
test('invalid slicing and content minima are rejected',async()=>{
  const s=await setup();s.spec.parts['surface.panel'].nineSlice.left=896;await s.save();await assert.rejects(s.build,{code:'skin.slice'});
  s.spec.parts['surface.panel'].nineSlice.left=0;s.spec.parts['surface.panel'].contentInsets.left=4;await s.save();await assert.rejects(s.build,{code:'skin.minimum'});
});
test('opaque board or stray pixels rejected; a failed attempt cannot replace current',async()=>{
  const s=await setup();const good=await s.build();const bytes=await readFile(join(s.output,'current.json'));
  const source=decodePng(await readFile(join(s.dir,'S01.png')));source.pixels.set([1,2,3,255],0);await writeFile(join(s.dir,'S01.png'),encodePng(source));
  await assert.rejects(s.build,{code:'skin.outside'});assert.deepEqual(await readFile(join(s.output,'current.json')),bytes);assert.equal((await skinPackageStatus(s.output)).buildId,good.buildId);
});
test('empty required part is rejected',async()=>{
  const s=await setup(),image=decodePng(await readFile(join(s.dir,'S01.png'))),[x,y,w,h]=template.sheets[0].parts[0].bodyRect;
  for(let row=y;row<y+h;row++)image.pixels.fill(0,(row*image.width+x)*4,(row*image.width+x+w)*4);
  await writeFile(join(s.dir,'S01.png'),encodePng(image));await assert.rejects(s.build,{code:'skin.empty'});
});
test('path traversal, URLs, encoded paths and Windows device names are refused',async()=>{
  for(const path of ['../a','a/../b','a\\b','C:/x','https://x/a','a%2fb','a/NUL.png','a/COM1.txt','a/','/a'])assert.equal(safePath(path),false,path);
  const s=await setup();s.spec.sheets[0].file='../outside.png';await s.save();await assert.rejects(s.build,{code:'skin.path'});
});
test('corrupt resource checksum and undeclared resource are refused',async()=>{
  const s=await setup(),built=await s.build(),dir=join(built.directory,'pack');
  await writeFile(join(dir,'extra.txt'),'untracked');await assert.rejects(()=>verifySkinPackage(dir),{code:'skin.extra'});
  await writeFile(join(dir,'assets/surface.panel.png'),'changed');assert.equal((await skinPackageStatus(s.output)).status,'corrupt');
});
test('rehashed but substituted crop still fails source identity',async()=>{
  const s=await setup(),built=await s.build(),dir=join(built.directory,'pack'),r=await verifySkinPackage(dir),a=r.pack.assets[0];
  const image=decodePng(r.resources.get(a.file));image.pixels[0]^=10;const bytes=encodePng(image);await writeFile(join(dir,a.file),bytes);a.sha256=hash(bytes);a.bytes=bytes.length;
  await writeFile(join(dir,'skin-pack.json'),json(r.pack));await assert.rejects(()=>verifySkinPackage(dir),{code:'skin.crop'});
});
test('input dimensions and unknown fields do not silently normalize',async()=>{
  const s=await setup();s.spec.unrecognized=true;await s.save();await assert.rejects(s.build,{code:'skin.schema'});delete s.spec.unrecognized;await s.save();
  await writeFile(join(s.dir,'S01.png'),encodePng({width:1,height:1,pixels:Buffer.from([0,0,0,255])}));await assert.rejects(s.build,{code:'skin.dimensions'});
});
