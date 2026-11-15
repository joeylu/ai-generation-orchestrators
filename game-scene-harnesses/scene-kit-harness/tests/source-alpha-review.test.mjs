import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync,readFileSync,readdirSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {encodeRgbaPng,inspectPng,crc32} from '../src/png.mjs';
import {createSourceAlphaReview,SOURCE_ALPHA_REVIEW_BACKGROUNDS,SOURCE_ALPHA_REVIEW_PROFILE} from '../src/source-alpha-review.mjs';
import {hash,seal,unseal,jsonBytes} from '../src/generation/common.mjs';
import * as flow from '../src/generation/index.mjs';
import {setup,prepare,referencePlan,authorizeAndReserve} from './helpers/generation.mjs';

const cli=fileURLToPath(new URL('../scripts/source-alpha-review.mjs',import.meta.url));
const rejects=(fn,code)=>assert.throws(fn,e=>e.errors?.some(issue=>issue.code===code));
function synthetic({hidden=true,noOpaque=false}={}){
 const width=64,height=64,rgba=Buffer.alloc(width*height*4);
 for(let i=0;i<width*height;i++)if(hidden)rgba.set(i%2?[255,90,0,0]:[0,90,255,0],i*4);
 for(let a=0;a<=255;a++)rgba.set([230,48,190,noOpaque&&a===255?254:a],(64+a)*4);
 rgba.set([200,50,0,128],4);rgba.set([12,34,56,noOpaque?254:255],8);
 rgba.set([20,130,240,252],12);rgba.set([255,0,255,1],16);
 return {width,height,rgba,bytes:encodeRgbaPng(width,height,rgba)};
}
const decoded=bytes=>inspectPng(bytes,{includePixels:true,allowHiddenRgb:true});
const pixel=(p,i)=>[...p.rgba.subarray(i*4,i*4+4)];
const command=(args,cwd)=>spawnSync(process.execPath,[cli,...args],{cwd,encoding:'utf8',timeout:30000,maxBuffer:1048576});

test('zero-Alpha orange/blue hidden RGB is invisible on every surround and no original sample is cleaned or changed',()=>{
 const source=synthetic(),original=Buffer.from(source.bytes),rgba=Buffer.from(source.rgba),first=createSourceAlphaReview(source.bytes),
  cleaned=synthetic({hidden:false});
 // Only the Alpha-zero RGB differs between these two synthetic inputs.
 for(let i=0;i<source.width*source.height;i++)if(cleaned.rgba[i*4+3]===0)cleaned.rgba.fill(0,i*4,i*4+4);
 const second=createSourceAlphaReview(encodeRgbaPng(cleaned.width,cleaned.height,cleaned.rgba));
 for(const bg of SOURCE_ALPHA_REVIEW_BACKGROUNDS){
  assert.deepEqual(first.files.get(bg.id+'.png'),second.files.get(bg.id+'.png'));
  const p=decoded(first.files.get(bg.id+'.png')),color=bg.kind==='solid'?bg.rgb:bg.lightRgb;
  assert.deepEqual(pixel(p,0),[...color,255]);
 }
 assert.notEqual(first.report.input.rawSha256,second.report.input.rawSha256);
 assert.notEqual(first.report.input.rgbaSha256,second.report.input.rgbaSha256);
 assert.equal(first.report.input.alphaSha256,second.report.input.alphaSha256);
 assert(first.report.statistics.zeroAlphaHiddenRgbPixels>3500);
 assert.equal(second.report.statistics.zeroAlphaHiddenRgbPixels,0);
 assert.deepEqual(source.bytes,original);assert.deepEqual(decoded(source.bytes).rgba,rgba);
 assert.equal(first.report.rendering.zeroAlphaRgbContributes,false);assert.equal(first.report.originalRgbaModified,false);
 assert.equal(first.report.originalAlphaModified,false);assert.equal(first.report.originalPngModified,false);
 assert.equal(first.report.technicalReclassification,false);assert.equal(first.report.previewIsAuthoritativeSource,false);
});

test('all 256 Alpha values use continuous source-over while opaque colors and real Alpha252 blue paint remain visible',()=>{
 const source=synthetic(),{files,report}=createSourceAlphaReview(source.bytes),white=decoded(files.get('white.png')),dark=decoded(files.get('dark.png'));
 assert.deepEqual(pixel(white,1),[227,152,127,255]);assert.deepEqual(pixel(dark,1),[116,43,21,255]);
 assert.deepEqual(pixel(white,2),[12,34,56,255]);assert.deepEqual(pixel(dark,2),[12,34,56,255]);
 const formula=(rgb,a,bg)=>rgb.map((v,i)=>Math.round((v*a+bg[i]*(255-a))/255)).concat(255);
 assert.deepEqual(pixel(white,3),formula([20,130,240],252,[255,255,255]));
 assert.notDeepEqual(pixel(white,3),[255,255,255,255],'real nonzero-Alpha blue stays visible rather than being treated as hidden RGB');
 for(const bg of SOURCE_ALPHA_REVIEW_BACKGROUNDS){
  const p=decoded(files.get(bg.id+'.png'));
  for(let a=0;a<=255;a++){
   const i=64+a,x=i%source.width,y=Math.floor(i/source.width),color=bg.kind==='solid'?bg.rgb:
    (Math.floor(x/bg.cellPixels)+Math.floor(y/bg.cellPixels))%2?bg.darkRgb:bg.lightRgb;
   assert.deepEqual(pixel(p,i),formula([230,48,190],a,color));
  }
 }
 assert.equal(Object.values(report.statistics.alphaHistogram).reduce((a,b)=>a+b,0),source.width*source.height);
 assert.equal(report.profile,SOURCE_ALPHA_REVIEW_PROFILE);assert.equal(report.rendering.alphaThresholdApplied,false);
 const noOpaque=createSourceAlphaReview(synthetic({noOpaque:true}).bytes);
 assert.equal(noOpaque.report.statistics.alphaHistogram.opaque255,0);assert(noOpaque.report.statistics.nonzeroAlphaPixels>0);
 assert(noOpaque.report.statistics.boundsAlphaAtLeast8);
});

test('sealed original result/QA fingerprints bind exact source bytes without transferring a failed verdict into acceptance',()=>{
 const source=synthetic(),rawSha256=hash(source.bytes),technical=seal({format:'synthetic_source_alpha_qa_v1',rawSha256,status:'fail',issues:['SYNTHETIC_ORIGINAL_GATE'],
  image:{sha256:rawSha256,byteLength:source.bytes.length,pixelSize:{width:source.width,height:source.height}}}),
  result=seal({format:'ai_scene_generation_result_v1',planSha256:'a'.repeat(64),attemptSha256:'b'.repeat(64),requestSha256:'c'.repeat(64),rawSha256,byteLength:source.bytes.length,technical}),
  original=jsonBytes(result),review=createSourceAlphaReview(source.bytes,{generationResult:result});
 assert.deepEqual(jsonBytes(result),original);assert.equal(review.report.sourceBinding.planSha256,result.planSha256);
 assert.equal(review.report.sourceBinding.resultSha256,result.sha256);assert.equal(review.report.sourceBinding.technicalSha256,technical.sha256);
 assert.equal(review.report.sourceBinding.technicalStatus,'fail');assert.equal(review.report.sourceBinding.originalTechnicalVerdictTransferred,false);
 assert.equal(review.report.originalQaModified,false);assert.equal(review.report.generationCalls,0);assert.equal(review.report.sourceArtAcceptance,'not-granted');
 rejects(()=>createSourceAlphaReview(source.bytes,{generationResult:seal({...unseal(result),rawSha256:'0'.repeat(64)})}),'SOURCE_ALPHA_REVIEW_RESULT_BINDING');
 const changedQa=seal({...unseal(technical),rawSha256:'0'.repeat(64)});
 rejects(()=>createSourceAlphaReview(source.bytes,{generationResult:seal({...unseal(result),technical:changedQa})}),'SOURCE_ALPHA_REVIEW_QA_BINDING');
 assert.throws(()=>createSourceAlphaReview(source.bytes,{generationResult:null}));
 assert.throws(()=>createSourceAlphaReview(source.bytes,{background:'custom'}));
 assert(!/(?:https?:\/\/|[a-z]:[\\/]|\\\\|\/Users\/|\/home\/)/i.test(JSON.stringify(review.report)));
});

test('explicit PNG CLI writes fresh deterministic fixed previews and path-free fingerprints, refusing overwrite and malformed input',t=>{
 const parent=mkdtempSync(join(tmpdir(),'source-alpha-review-'));t.after(()=>rmSync(parent,{recursive:true,force:true}));
 const source=synthetic(),path=join(parent,'source.png'),out=join(parent,'review');writeFileSync(path,source.bytes);
 const result=command(['--png',path,'--out',out],parent);assert.equal(result.status,0,result.stderr);
 const stdout=JSON.parse(result.stdout),report=JSON.parse(readFileSync(join(out,'source-alpha-review.json'),'utf8'));unseal(report);
 assert.deepEqual(readdirSync(out).sort(),['checker.png','dark.png','source-alpha-review.json','white.png']);
 assert.equal(stdout.reportSha256,report.sha256);assert.equal(report.sourceBinding.kind,'explicit-png-unbound');
 for(const p of report.previews){const b=readFileSync(join(out,p.path));assert.equal(hash(b),p.sha256);assert.equal(b.length,p.byteLength);}
 assert.equal(hash(readFileSync(path)),hash(source.bytes));assert(!result.stdout.includes(parent));assert(!JSON.stringify(report).includes(parent));
 const before=readFileSync(join(out,'white.png')),again=command(['--png',path,'--out',out],parent);
 assert.notEqual(again.status,0);assert.equal(JSON.parse(again.stderr).code,'OUTPUT_EXISTS');assert.deepEqual(readFileSync(join(out,'white.png')),before);
 const invalid=join(parent,'invalid.png');writeFileSync(invalid,Buffer.from('not a PNG'));
 const fail=command(['--png',invalid,'--out',join(parent,'invalid-review')],parent);assert.notEqual(fail.status,0);assert(!existsSync(join(parent,'invalid-review')));assert(!fail.stderr.includes(parent));
});

test('workflow CLI reads the verified exact generation result and changes no source, QA, events or terminal status',{timeout:60000},t=>{
 const f=setup(t),{capabilities}=prepare(f.root),plan=referencePlan(f.root,capabilities),ticket=authorizeAndReserve(f.root,plan),source=synthetic();
 flow.recordSubmission(f.root,ticket);const result=flow.receiveResult(f.root,ticket,source.bytes),before=flow.inspectWorkflow(f.root),original=flow.getGenerationResult(f.root,plan.sha256),out=join(f.parent,'bound-alpha-review');
 const run=command(['--workflow',f.root,'--plan',plan.sha256,'--out',out],f.parent);assert.equal(run.status,0,run.stderr);
 const report=JSON.parse(readFileSync(join(out,'source-alpha-review.json'),'utf8'));unseal(report);
 assert.equal(report.sourceBinding.kind,'sealed-generation-result');assert.equal(report.sourceBinding.planSha256,plan.sha256);
 assert.equal(report.sourceBinding.resultSha256,result.sha256);assert.equal(report.sourceBinding.technicalSha256,result.technical.sha256);
 assert.equal(report.sourceBinding.technicalStatus,result.technical.status);
 assert.deepEqual(flow.inspectWorkflow(f.root),before);assert.deepEqual(flow.getGenerationResult(f.root,plan.sha256),original);
 assert.equal(existsSync(join(f.root,'.lock')),false);assert.equal(report.generationCalls,0);assert(!run.stdout.includes(f.parent));
 const overlap=command(['--workflow',f.root,'--plan',plan.sha256,'--out',join(f.root,'review')],f.parent);
 assert.notEqual(overlap.status,0);assert.equal(JSON.parse(overlap.stderr).code,'SOURCE_ALPHA_REVIEW_OUTPUT_OVERLAP');assert(!existsSync(join(f.root,'review')));
 assert.deepEqual(flow.inspectWorkflow(f.root),before);
});

test('empty or opaque valid PNGs remain diagnostics rather than alpha cleanup or generation attempts',()=>{
 const empty=encodeRgbaPng(4,3,Buffer.alloc(4*3*4)),review=createSourceAlphaReview(empty);
 assert.equal(review.report.statistics.nonzeroAlphaPixels,0);assert.equal(review.report.statistics.boundsAlphaAtLeast1,null);
 assert.equal(review.report.sourceBinding.technicalStatus,'not-supplied');assert.equal(review.report.sourceArtAcceptance,'not-granted');
 const solid=Buffer.alloc(4*3*4);for(let i=0;i<12;i++)solid.set([22,77,133,255],i*4);
 const opaque=createSourceAlphaReview(encodeRgbaPng(4,3,solid));
 for(const p of opaque.report.previews)assert.deepEqual(decoded(opaque.files.get(p.path)).rgba,solid);
 rejects(()=>createSourceAlphaReview(Buffer.alloc(0)),'SOURCE_ALPHA_REVIEW_BYTES');
 rejects(()=>createSourceAlphaReview(Buffer.alloc(16777217)),'SOURCE_ALPHA_REVIEW_BYTES');
 rejects(()=>createSourceAlphaReview(Buffer.from('invalid')),'SOURCE_ALPHA_REVIEW_PNG');
 const maximum=encodeRgbaPng(4096,1,Buffer.alloc(4096*4));assert.equal(createSourceAlphaReview(maximum).report.input.pixelSize.width,4096);
 const tooWide=Buffer.from(maximum);tooWide.writeUInt32BE(4097,16);tooWide.writeUInt32BE(crc32(tooWide.subarray(12,29)),29);
 rejects(()=>createSourceAlphaReview(tooWide),'SOURCE_ALPHA_REVIEW_PNG');
});
