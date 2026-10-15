// Explicit whole-sheet resizing. Does not move parts, crop artwork or accept a skin.
import { mkdir, writeFile, lstat } from 'node:fs/promises';
import { resolve, join, relative, isAbsolute, parse } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { randomUUID } from 'node:crypto';
import { decodePng, encodePng } from '../src/skins/png.mjs';
import { resampleArea } from '../src/skin-generation/normalize.mjs';
import { assessPilot } from '../src/skin-generation/attempt.mjs';
import { hash, json, readSafe } from '../src/skins/package.mjs';
const work=fileURLToPath(new URL('../work/',import.meta.url));
async function privatePath(value){
  if(!value)throw Error('Missing path');
  const path=resolve(value),r=relative(work,path);
  if(isAbsolute(r)||r==='..'||r.startsWith('..\\')||r.startsWith('../'))throw Error('Use Harness work/ paths');
  let current=parse(path).root;
  for(const part of path.slice(current.length).split(/[\\/]/).filter(Boolean)){
    current=join(current,part);try{if((await lstat(current)).isSymbolicLink())throw Error('Links forbidden');}catch(e){if(e.code!=='ENOENT')throw e;}
  }
  return path;
}
try{
  const {values:v}=parseArgs({options:{plan:{type:'string'},sha256:{type:'string'},attempt:{type:'string'},out:{type:'string'}}});
  const planDir=await privatePath(v.plan),attemptDir=await privatePath(v.attempt),output=await privatePath(v.out);
  const planBytes=await readSafe(planDir,'plan.json');
  if(hash(planBytes)!==v.sha256)throw Error('Plan digest mismatch');
  const plan=JSON.parse(planBytes),receiptBytes=await readSafe(attemptDir,'receipt.json'),receipt=JSON.parse(receiptBytes);
  if(receipt.state!=='received'||receipt.planSha256!==v.sha256)throw Error('Receipt mismatch');
  const raw=await readSafe(attemptDir,receipt.raw.file);
  if(raw.length!==receipt.raw.bytes||hash(raw)!==receipt.raw.sha256)throw Error('Raw identity mismatch');
  const source=decodePng(raw),{width,height}=plan.request;
  if(source.width*height!==source.height*width)throw Error('Aspect ratio mismatch: no anisotropic resize');
  const image=resampleArea(source,width,height),png=encodePng(image);
  const inspection=assessPilot(png,plan),directory=join(output,randomUUID());
  await mkdir(directory,{recursive:true});
  const report={kind:'ui_skin_sheet_resize_candidate',version:'0.1',planSha256:v.sha256,receiptSha256:hash(receiptBytes),rawSha256:hash(raw),
    sourceSize:[source.width,source.height],targetSize:[width,height],scale:width/source.width,aspectPreserved:true,
    method:'premultiplied-area-srgb',partsRepositioned:false,edgeRepair:false,outputSha256:hash(png),inspection,productionReady:false};
  await writeFile(join(directory,'sheet.png'),png,{flag:'wx'});
  await writeFile(join(directory,'report.json'),json(report),{flag:'wx'});
  console.log(json({directory,...report}));
}catch(e){console.error(e.message);process.exitCode=1;}
