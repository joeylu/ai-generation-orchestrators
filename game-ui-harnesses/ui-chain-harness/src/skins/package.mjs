import { readFile, writeFile, mkdir, lstat, readdir, open, unlink, rename } from 'node:fs/promises';
import { join, resolve, dirname, parse, relative, sep, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { defaults } from '../contracts/build.mjs';
import { readContracts } from '../contracts/validate.mjs';
import { assertSchema, assertMetadata, validatePack, safePath, fail } from './contract.mjs';
import { decodePng, encodePng, cropPng } from './png.mjs';
import {deriveTextReadability} from './text-readability.mjs';
import {materialFiles} from './surface-styles.mjs';
import {importMaterials,verifyMaterials} from './materials.mjs';
export const hash = b => createHash('sha256').update(b).digest('hex');
export const json = v => JSON.stringify(v, null, 2) + '\n';
export async function skinToolIdentity() {
  const root=fileURLToPath(new URL('../../',import.meta.url)), files=['package.json','package-lock.json','scripts/skins.mjs','configs/text-readability-policy.json','schemas/skin-pack.schema.json','schemas/skin-import.schema.json','schemas/runtime-theme.schema.json','src/slicing/geometry.mjs','tools/panel-slicer/src/geometry.mjs','schemas/slice-document.schema.json'];
  for(const dir of ['src/skins','src/templates','src/contracts'])for(const f of await readdir(join(root,dir)))if(/\.mjs$/.test(f))files.push(dir+'/'+f);
  const entries=[];for(const file of files.sort())entries.push({file,sha256:hash(await readFile(join(root,file)))});
  return {sha256:hash(Buffer.from(json(entries))),files:entries};
}
export function bindingsOf(inputs) { return Object.fromEntries(['template','registry','usage'].map(k => [k+'Sha256', hash(inputs.bytes[k])])); }
export async function noLinks(path) {
  path = resolve(path);
  const base = parse(path).root;
  let current = base;
  for (const part of path.slice(base.length).split(/[\\/]/).filter(Boolean)) {
    current = join(current, part);
    try { if ((await lstat(current)).isSymbolicLink()) fail('skin.path', 'Symbolic links/junctions are not permitted.'); }
    catch (e) { if (e.code !== 'ENOENT') throw e; }
  }
}
export async function readSafe(directory, file, limit = 32 * 1024 * 1024) {
  if (!safePath(file)) fail('skin.path', 'Expected a relative package path.');
  const path = join(directory, file);
  await noLinks(path);
  const stat = await lstat(path);
  if (!stat.isFile() || stat.size < 1 || stat.size > limit) fail('skin.file', 'Expected a bounded regular file.');
  return readFile(path);
}
async function emit(directory, file, bytes) {
  if (!safePath(file)) fail('skin.path', 'Unsafe output path.');
  await mkdir(dirname(join(directory, file)), { recursive: true });
  await writeFile(join(directory, file), bytes, { flag: 'wx' });
  return { file, sha256: hash(bytes), bytes: bytes.length };
}
async function move(from, to) {
  for (let i = 0; ; i++) {
    try { return await rename(from, to); }
    catch (e) { if (!['EPERM','EACCES','EBUSY'].includes(e.code) || i === 5) throw e; await delay(50*(i+1)); }
  }
}
function checkSheet(image, sheet, scale) {
  const occupancy = new Uint8Array(image.width * image.height);
  for (const p of sheet.parts) {
    const [x,y,w,h] = p.bodyRect.map(v => v * scale);
    for (let row=y; row<y+h; row++) occupancy.fill(1, row*image.width+x, row*image.width+x+w);
  }
  for (let i=0; i<occupancy.length; i++) if (!occupancy[i] && image.pixels[i*4+3]) fail('skin.outside', `${sheet.id}: visible pixels outside template bodies; no silent clipping.`);
}
function checkPart(image, id) {
  let visible = 0, transparent = 0, soft = 0;
  for (let i=3; i<image.pixels.length; i+=4) {
    const a = image.pixels[i]; if (a) visible++; else transparent++;
    if (a > 0 && a < 255) soft++;
  }
  if (!visible) fail('skin.empty', `${id}: empty asset.`);
  return { visible, transparent, soft };
}
export async function buildSkinPackage({ input, output, contracts = defaults }) {
  const inputPath = resolve(input), base = dirname(inputPath), outputPath = resolve(output);
  const rel=relative(outputPath,inputPath);
  if(!rel || (!isAbsolute(rel) && rel!=='..' && !rel.startsWith('..'+sep)))fail('skin.output','Input metadata must be outside the output tree.');
  await noLinks(inputPath); await noLinks(outputPath);
  const inputBytes = await readSafe(base, parse(inputPath).base, 2*1024*1024), spec = JSON.parse(inputBytes);
  assertSchema(spec, 'input');
  const inputs = await readContracts(contracts), { template, usage } = inputs, tool=await skinToolIdentity();
  const parts = template.sheets.flatMap(s => s.parts), ids = parts.map(p=>p.assetId);
  if (ids.length !== Object.keys(spec.parts).length || ids.some(id => !Object.hasOwn(spec.parts,id))) fail('skin.coverage', 'Skin metadata must cover exactly the active template assets.');
  if (spec.sheets.length !== template.sheets.length || new Set(spec.sheets.map(s=>s.sheetId)).size !== spec.sheets.length || template.sheets.some(s => !spec.sheets.some(i=>i.sheetId===s.id))) fail('skin.coverage', 'Input sheets differ from template.');
  for (const p of parts) assertMetadata(spec.parts[p.assetId], p.bodyRect[2], p.bodyRect[3], p.stretch);
  await mkdir(outputPath, { recursive: true });
  const lockPath = join(outputPath, '.build.lock');
  let lock;
  try { lock = await open(lockPath, 'wx'); } catch (e) { if (e.code==='EEXIST') fail('skin.busy', 'Skin package build already in progress.'); throw e; }
  const buildId = randomUUID(), candidate = join(outputPath,'.staging',buildId), packDir = join(candidate,'pack');
  try {
    await noLinks(join(outputPath,'.staging')); await noLinks(join(outputPath,'builds'));
    await mkdir(packDir,{recursive:true}); await mkdir(join(outputPath,'builds'),{recursive:true});
    const pack = { kind:'ui_skin_asset_pack', version:'0.1', id:spec.id, revision:spec.revision, sourceKind:spec.sourceKind,
      visualAcceptance:'unreviewed', scale:template.coordinates.outputScale, bindings:bindingsOf(inputs), theme:structuredClone(spec.theme),
      sources:[], assets:[], roles:usage.bindings.map(({role,assetId})=>({role,assetId})), fonts:[], licenses:[] };
    const fingerprints = [], pixelChecks = [], textImages=new Map();
    let total = 0;
    const source = async file => {
      const b = await readSafe(base,file); total += b.length;
      if (total > 96*1024*1024) fail('skin.limit','Input resources exceed 96 MiB.');
      fingerprints.push({file,sha256:hash(b)}); return b;
    };
    for (const sheet of template.sheets) {
      const ref = spec.sheets.find(s=>s.sheetId===sheet.id), bytes = await source(ref.file), image = decodePng(bytes), scale = pack.scale;
      if (image.width !== template.coordinates.width*scale || image.height !== template.coordinates.height*scale) fail('skin.dimensions', `${sheet.id}: source dimensions differ from template; resampling is not automatic.`);
      checkSheet(image,sheet,scale);
      pack.sources.push({...await emit(packDir,`sources/${sheet.id}.png`,bytes),sheetId:sheet.id,width:image.width,height:image.height});
      for (const p of sheet.parts) {
        const crop = p.bodyRect.map(v=>v*scale), asset = cropPng(image,crop);
        pixelChecks.push({assetId:p.assetId,...checkPart(asset,p.assetId)});
        textImages.set(p.assetId,asset);
        pack.assets.push({...await emit(packDir,`assets/${p.assetId}.png`,encodePng(asset)),assetId:p.assetId,code:p.code,state:p.state,sheetId:sheet.id,crop,width:asset.width,height:asset.height,stretch:p.stretch,...spec.parts[p.assetId]});
      }
    }
    for (const [i,f] of spec.fonts.entries()) {
      const bytes = await source(f.file);
      if (bytes.toString('ascii',0,4) !== 'wOF2') fail('skin.font','Only bundled WOFF2 fonts are supported.');
      pack.fonts.push({...f,...await emit(packDir,`fonts/font-${i}.woff2`,bytes)});
    }
    for (const [i,f] of spec.licenses.entries()) pack.licenses.push(await emit(packDir,`licenses/font-${i}.txt`,await source(f.file)));
    await importMaterials(pack,spec,base,(file,bytes)=>emit(packDir,file,bytes));
    const readability=deriveTextReadability(pack,textImages);pack.theme.textColors=readability.inks;
    validatePack(pack,bindingsOf(inputs));
    const manifest = Buffer.from(json(pack)); await emit(packDir,'skin-pack.json',manifest);
    await verifySkinPackage(packDir, bindingsOf(inputs));
    for (const f of fingerprints) if (hash(await readSafe(base,f.file)) !== f.sha256) fail('skin.stale','An input resource changed during import.');
    if (hash(await readFile(inputPath)) !== hash(inputBytes)) fail('skin.stale','Input metadata changed during import.');
    for (const key of ['template','registry','usage']) if (hash(await readFile(contracts[key])) !== pack.bindings[key+'Sha256']) fail('skin.stale','Contracts changed during import.');
    await emit(candidate,'inputs.json',Buffer.from(json({input:spec,template:inputs.template,registry:inputs.registry,usage:inputs.usage})));
    if((await skinToolIdentity()).sha256!==tool.sha256)fail('skin.stale','Import tools changed during processing.');
    const report = {kind:'ui_skin_import_report',version:'0.1',buildId,sourceKind:pack.sourceKind,technicalValidation:'passed',visualAcceptance:'unreviewed',productionReady:false,inputSha256:hash(inputBytes),manifestSha256:hash(manifest),bindings:pack.bindings,tool,pixelChecks};
    report.textReadability=readability.report;
    await emit(candidate,'report.json',Buffer.from(json(report)));
    await move(candidate,join(outputPath,'builds',buildId));
    const current = {kind:'ui_skin_pack_current',buildId,manifestSha256:hash(manifest),reportSha256:hash(Buffer.from(json(report)))};
    const pending = join(outputPath,`${buildId}.current.tmp`);
    await writeFile(pending,json(current),{flag:'wx'}); await move(pending,join(outputPath,'current.json'));
    return { ...current, directory:join(outputPath,'builds',buildId), assets:pack.assets.length, sourceKind:pack.sourceKind, productionReady:false };
  } finally { await lock.close(); await unlink(lockPath); }
}
export async function verifySkinPackage(directory, expected = {}) {
  const bytes = await readSafe(directory,'skin-pack.json',2*1024*1024), pack = validatePack(JSON.parse(bytes),expected), resources = new Map();
  let total=0;
  for (const f of [...pack.sources,...pack.assets,...pack.fonts,...pack.licenses,...materialFiles(pack)]) {
    if(resources.has(f.file))continue;
    const b = await readSafe(directory,f.file); total+=b.length;
    if (total>128*1024*1024 || b.length!==f.bytes || hash(b)!==f.sha256) fail('skin.digest','Resource size/digest mismatch or package limit exceeded.');
    resources.set(f.file,b);
  }
  const sources = new Map(pack.sources.map(s=>[s.sheetId,decodePng(resources.get(s.file))]));
  for (const s of pack.sources) {
    const image = sources.get(s.sheetId);
    if (image.width!==s.width || image.height!==s.height) fail('skin.dimensions','Source dimensions mismatch.');
    checkSheet(image,{id:s.sheetId,parts:pack.assets.filter(a=>a.sheetId===s.sheetId).map(a=>({bodyRect:a.crop}))},1);
  }
  const textImages=new Map();
  for (const a of pack.assets) {
    const image=decodePng(resources.get(a.file)), crop=cropPng(sources.get(a.sheetId),a.crop);
    if(image.transparentRgbPixels)fail('skin.alpha','Transparent delivery pixels must have zero RGB.');
    if (image.width!==a.width || image.height!==a.height || !image.pixels.equals(crop.pixels)) fail('skin.crop','Asset pixels do not match source crop.');
    checkPart(image,a.assetId);
    textImages.set(a.assetId,image);
  }
  for (const f of pack.fonts) if (resources.get(f.file).toString('ascii',0,4)!=='wOF2') fail('skin.font','Invalid WOFF2 signature.');
  await verifyMaterials(pack,resources);
  const allowed=new Set(['skin-pack.json',...resources.keys()]);
  const visit=async (relative='')=>{for(const item of await readdir(join(directory,relative),{withFileTypes:true})){const path=relative+item.name;if(item.isDirectory()) await visit(path+'/'); else if(!item.isFile() || !allowed.has(path)) fail('skin.extra','Unexpected file in skin package.');}};
  await visit();
  const textReadability=pack.theme.textColors?deriveTextReadability(pack,textImages).report:{kind:'ui_text_readability',version:'1.0',status:'not-assessed',reason:'legacy-theme',productionReady:false};
  return {pack,resources,manifestSha256:hash(bytes),textReadability};
}
export async function skinPackageStatus(output, contracts=defaults) {
  try {
    const c=JSON.parse(await readSafe(output,'current.json',4096));
    if(c.kind!=='ui_skin_pack_current'||!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(c.buildId)) fail('skin.current','Invalid current pointer.');
    const dir=join(output,'builds',c.buildId), result=await verifySkinPackage(join(dir,'pack'));
    const reportBytes=await readSafe(dir,'report.json'),report=JSON.parse(reportBytes);
    if(result.manifestSha256!==c.manifestSha256 || hash(reportBytes)!==c.reportSha256) fail('skin.digest','Current evidence changed.');
    const expected=bindingsOf(await readContracts(contracts));
    return {status:Object.keys(expected).every(k=>expected[k]===result.pack.bindings[k])&&report.tool?.sha256===(await skinToolIdentity()).sha256?'current':'stale',buildId:c.buildId,assets:result.pack.assets.length,sourceKind:result.pack.sourceKind,productionReady:false};
  } catch(e) { return {status:e.code==='ENOENT'?'missing':'corrupt',code:e.code??'skin.read'}; }
}
