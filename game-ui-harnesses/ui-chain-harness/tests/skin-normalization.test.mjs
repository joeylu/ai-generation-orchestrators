import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import policy from '../configs/skin-normalization.json' with { type: 'json' };
import { locateParts, normalizeSheet, normalizePart, resampleArea } from '../src/skin-generation/normalize.mjs';
import { buildNormalization, normalizationStatus, verifyNormalization } from '../src/skin-generation/normalize-build.mjs';
import { encodePng, decodePng } from '../src/skins/png.mjs';
import { hash,json } from '../src/skins/package.mjs';
import { buildTemplates } from '../src/templates/build.mjs';
import { defaults } from '../src/contracts/build.mjs';
import { prepareGenerationPlan } from '../src/skin-generation/plan.mjs';
import { reserveAttempt, receiveAttempt } from '../src/skin-generation/attempt.mjs';

const testPolicy={...policy,detection:{...policy.detection,minimumCorePixels:4}};
const image=(width,height)=>({width,height,pixels:Buffer.alloc(width*height*4)});
function rect(im,x,y,w,h,rgba=[130,90,30,253]){for(let row=y;row<y+h;row++)for(let col=x;col<x+w;col++)for(let k=0;k<4;k++)im.pixels[(row*im.width+col)*4+k]=rgba[k];}
const geometry={coordinates:{width:64,height:64,outputScale:1},sheets:[{id:'S',parts:[
  {assetId:'track',code:'A',state:'base',slotRect:[0,0,64,28],bodyRect:[4,8,56,8],stretch:'horizontal',primitive:{type:'roundRect',radius:4}},
  {assetId:'thumb',code:'B',state:'base',slotRect:[0,32,64,32],bodyRect:[24,40,16,16],stretch:'uniform',primitive:{type:'circle'}},
]}]};
function source(){const im=image(80,80);rect(im,5,6,70,18);rect(im,26,47,22,22);return im;}

test('locates scaled/over-thick parts by slots and outputs exact geometry; keeps source bytes unchanged',()=>{
  const im=source(),before=Buffer.from(im.pixels),r=normalizeSheet(im,geometry,testPolicy);
  assert.equal(r.report.status,'normalized-candidates-awaiting-review');
  assert.deepEqual(r.assets.map(a=>[a.part.assetId,a.image.width,a.image.height]),[['track',56,8],['thumb',16,16]]);
  assert.deepEqual(r.assets[0].match.sourceRect,[5,6,70,18]);
  assert.equal(r.report.semanticReview,'required');assert.ok(im.pixels.equals(before));
});
test('low-alpha detached debris removed, attached soft edge and enclosed hole preserved',()=>{
  const im=source();rect(im,4,6,1,18,[10,20,30,1]);rect(im,1,75,1,1,[250,1,250,1]);rect(im,32,52,3,3,[255,255,255,0]);
  const r=normalizeSheet(im,geometry,testPolicy);
  assert.equal(r.report.cleanup.discardedPixels,1);
  assert.equal(r.report.cleanup.discardedAlphaMass,1);
  assert.equal(r.assets[0].source.pixels[3],1);
  const thumb=r.assets[1].source;assert.equal(thumb.pixels[((52-47)*thumb.width+32-26)*4+3],0);
  assert.equal(decodePng(encodePng(r.sheet)).transparentRgbPixels,0);
});
test('multiple candidates, missing parts and significant fragments block normalization',()=>{
  const missing=source();rect(missing,26,47,22,22,[0,0,0,0]);assert.ok(locateParts(missing,geometry,testPolicy).report.issues.some(i=>i.code==='missing-part'));
  const multiple=source();rect(multiple,5,26,3,2);assert.ok(locateParts(multiple,geometry,testPolicy).report.issues.some(i=>i.code==='multiple-candidates'));
  const fragment=source();rect(fragment,1,75,1,1,[10,10,10,255]);const r=normalizeSheet(fragment,geometry,testPolicy);assert.equal(r.sheet,null);assert.ok(r.report.issues.some(i=>i.code==='strong-fragment'));
});
test('a soft bridge between two strong cores is rejected, never split by guessed crop coordinates',()=>{
  const im=source();rect(im,36,24,1,23,[100,100,100,1]);
  const r=normalizeSheet(im,geometry,testPolicy);assert.equal(r.sheet,null);
  assert.ok(r.report.issues.some(i=>i.code==='joined-or-fragmented-cores'||i.code==='missing-part'));
});
test('excess low-alpha debris and canvas aspect mismatch block instead of silently cleaning',()=>{
  const im=source();rect(im,2,72,60,6,[1,1,1,127]);
  assert.ok(locateParts(im,geometry,testPolicy).report.issues.some(i=>i.code==='excess-discarded-alpha'));
  const stretched=image(80,100);assert.ok(locateParts(stretched,geometry,testPolicy).report.issues.some(i=>i.code==='canvas-aspect'));
});
test('area sampling uses alpha-weighted RGB, retains fractional alpha and clears fully transparent RGB',()=>{
  const im=image(2,1);rect(im,0,0,1,1,[255,0,0,128]);rect(im,1,0,1,1,[0,0,255,0]);
  assert.deepEqual([...resampleArea(im,1,1).pixels],[255,0,0,64]);
  assert.deepEqual([...resampleArea(image(2,2),1,1).pixels],[0,0,0,0]);
});
test('endcaps preserve their cross-axis scale while only center length changes',()=>{
  const im=image(12,4);rect(im,0,0,2,4,[255,0,0,255]);rect(im,2,0,8,4,[0,255,0,255]);rect(im,10,0,2,4,[0,0,255,255]);
  const p={assetId:'caps',bodyRect:[0,0,20,4],stretch:'horizontal',primitive:{type:'roundRect',radius:2}};
  const out=normalizePart(im,p,1,testPolicy).image;
  assert.deepEqual([...out.pixels.subarray(4,8)],[255,0,0,255]);
  assert.deepEqual([...out.pixels.subarray(8,12)],[0,255,0,255]);
  assert.deepEqual([...out.pixels.subarray(18*4,19*4)],[0,0,255,255]);
});
test('uniform shapes are contained without stretching; unsupported geometry and severe aspect drift rejected',()=>{
  const p={assetId:'uniform',bodyRect:[0,0,12,12],stretch:'uniform',primitive:{type:'circle'}};
  const im=image(10,9);rect(im,0,0,10,9);
  const r=normalizePart(im,p,1,testPolicy);assert.deepEqual(r.operation.resized,[12,11]);
  assert.throws(()=>normalizePart(image(20,5),p,1,testPolicy),/aspect drift/);
  assert.throws(()=>normalizePart(im,{...p,stretch:'nine-slice'},1,testPolicy),/does not support/);
});
test('asset additions and outputScale derive from geometry without new normalization code',()=>{
  const g=structuredClone(geometry);g.coordinates.outputScale=2;
  const r=normalizeSheet(source(),g,testPolicy);assert.equal(r.sheet.width,128);assert.equal(r.assets[0].image.width,112);
  g.sheets[0].parts[1].slotRect=[0,32,32,32];g.sheets[0].parts[1].bodyRect=[8,40,16,16];
  g.sheets[0].parts.push({...g.sheets[0].parts[1],assetId:'new.thumb',code:'C',slotRect:[32,32,32,32],bodyRect:[40,40,16,16]});
  const added=image(80,80);rect(added,5,6,70,18);rect(added,10,50,20,20);rect(added,50,50,20,20);
  const expanded=normalizeSheet(added,g,testPolicy);assert.equal(expanded.assets.length,3);assert.equal(expanded.assets[2].part.assetId,'new.thumb');
});

async function fixture(t){
  const dir=await mkdtemp(join(tmpdir(),'ui-normalization-'));
  t.after(async()=>{assert.equal(dirname(resolve(dir)),resolve(tmpdir()));assert.ok(dir.split(/[\\/]/).at(-1).startsWith('ui-normalization-'));await rm(dir,{recursive:true,force:true});});
  const contracts={};for(const key of ['template','registry','usage']){contracts[key]=join(dir,key+'.json');await writeFile(contracts[key],await readFile(defaults[key]));}
  const templateOutput=join(dir,'templates');
  await buildTemplates({config:contracts.template,output:templateOutput,render:async({spec,directory})=>{
    const png=encodePng(image(spec.coordinates.width*spec.coordinates.outputScale,spec.coordinates.height*spec.coordinates.outputScale)),files=[];
    for(const s of spec.sheets)for(const role of ['clean','review']){const file=`${s.filePrefix}.${role}.png`;await writeFile(join(directory,file),png);files.push({file});}return {renderer:'offline-fixture',files};
  }});
  const reference=join(dir,'reference.png'),style=join(dir,'style.json');await writeFile(reference,encodePng(source()));
  await writeFile(style,json({kind:'ui_skin_style_draft',version:'0.1',id:'synthetic',revision:1,status:'draft',name:'Test',referenceSummary:'Synthetic fixture',palette:{basis:'visual-estimate-not-colorimetric-sampling',colors:{base:'#999999'}},observedRules:['Neutral'],extensionRules:['None'],partRules:[{match:{assetPrefix:'bar.'},appearance:'Neutral'}]}));
  const plan=await prepareGenerationPlan({reference,style,output:join(dir,'plans'),contracts,templateOutput});
  const raw=image(1024,1024),g=JSON.parse(await readFile(join(plan.directory,'geometry.json')));
  for(const p of g.sheets[0].parts)rect(raw,...p.bodyRect);
  rect(raw,10,10,1,1,[255,20,20,1]);
  const rawPath=join(dir,'raw.png');await writeFile(rawPath,encodePng(raw));
  const attempt=await reserveAttempt({planDirectory:plan.directory,planSha256:plan.planSha256,confirmedPlanSha256:plan.planSha256,output:join(dir,'attempts'),contracts});
  await receiveAttempt({planDirectory:plan.directory,planSha256:plan.planSha256,directory:attempt.directory,raw:rawPath});
  const policyPath=join(dir,'policy.json');await writeFile(policyPath,json(policy));
  return {dir,args:{planDirectory:plan.directory,planSha256:plan.planSha256,attemptDirectory:attempt.directory,output:join(dir,'normalized'),policy:policyPath,contracts}};
}
test('build freezes provenance, writes all independent PNGs and verifies replay; failures preserve current',async t=>{
  const {args}=await fixture(t),r=await buildNormalization(args),directory=join(args.output,'builds',r.buildId);
  assert.equal(r.assets,9);assert.equal((await verifyNormalization({directory,manifestSha256:r.manifestSha256})).replay,'passed');
  assert.equal((await normalizationStatus(args.output,args.policy,args.contracts)).status,'current');
  const current=await readFile(join(args.output,'current.json'));
  await writeFile(args.policy,json({...policy,detection:{...policy.detection,maxDiscardedAlphaMassFraction:0}}));
  await assert.rejects(buildNormalization(args),/blocked/);
  assert.ok(current.equals(await readFile(join(args.output,'current.json'))));
  assert.equal((await normalizationStatus(args.output,args.policy,args.contracts)).status,'stale');
});
test('tampered raw receipt or candidate cannot be accepted',async t=>{
  const {args}=await fixture(t),r=await buildNormalization(args),directory=join(args.output,'builds',r.buildId);
  await writeFile(join(directory,'assets/bar.track.png'),encodePng(image(768,48)));
  await assert.rejects(verifyNormalization({directory,manifestSha256:r.manifestSha256}),/resource changed/);
  await writeFile(join(args.attemptDirectory,'raw.png'),encodePng(image(32,32)));
  await assert.rejects(buildNormalization(args),/Source result changed/);
});
test('registry-only updates retain frozen source processing and explicitly require consumer rebinding',async t=>{
  const {args}=await fixture(t);
  await writeFile(args.contracts.registry,(await readFile(args.contracts.registry,'utf8'))+'\n');
  const r=await buildNormalization(args),status=await normalizationStatus(args.output,args.policy,args.contracts);
  assert.equal(status.status,'current');assert.equal(status.consumerCompatibility,'requires-rebind');
  assert.deepEqual(status.changedBindings,['registrySha256']);
  const report=JSON.parse(await readFile(join(args.output,'builds',r.buildId,'report.json')));
  assert.equal(report.originalInspectionStatus,'rejected');assert.equal(report.consumerCompatibility.status,'requires-rebind');
});
test('even a self-consistently rehashed replacement sheet cannot pass original-pixel replay',async t=>{
  const {args}=await fixture(t),r=await buildNormalization(args),directory=join(args.output,'builds',r.buildId);
  const m=JSON.parse(await readFile(join(directory,'manifest.json')));
  const sheet=decodePng(await readFile(join(directory,'normalized-sheet.png'))),asset=decodePng(await readFile(join(directory,'assets/bar.track.png')));
  sheet.pixels[(64*1024+128)*4]=2;asset.pixels[0]=2;
  for(const [name,im]of[['normalized-sheet.png',sheet],['assets/bar.track.png',asset]]){
    const b=encodePng(im);await writeFile(join(directory,name),b);const f=m.files.find(f=>f.file===name);f.bytes=b.length;f.sha256=hash(b);
  }
  const b=Buffer.from(json(m));await writeFile(join(directory,'manifest.json'),b);
  await assert.rejects(verifyNormalization({directory,manifestSha256:hash(b)}),/do not reproduce/);
});
