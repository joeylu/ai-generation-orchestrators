import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {defaults} from '../src/contracts/build.mjs';
import {buildTemplates} from '../src/templates/build.mjs';
import {hash,json} from '../src/skins/package.mjs';
import {encodePng} from '../src/skins/png.mjs';
import {prepareGenerationPlan,verifyGenerationPlan} from '../src/skin-generation/plan.mjs';
import {readMaterialTemplate,assessMaterialAtlas} from '../src/skin-generation/material-template.mjs';
import {assessPilot,recoverReturnedAttempt} from '../src/skin-generation/attempt.mjs';
import {authorizeBatch,beginSubmission} from '../src/skin-generation/batch-execution.mjs';
import {inspectGenerationBatch} from '../src/skin-generation/batch-intake.mjs';
import {executeBatch,runAuthorizedBatch} from '../src/skin-generation/batch-runner.mjs';
import {prepareSupplement,executeSupplement} from '../src/skin-generation/supplement.mjs';
import {recoverCodexSheet} from '../src/skin-generation/codex-recovery.mjs';
import {relayRecoveryFixture} from './helpers/relay-recovery-fixture.mjs';

async function fixture(t){
 const dir=await mkdtemp(join(tmpdir(),'skin-material-generation-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const contracts={};for(const key of ['template','registry','usage']){contracts[key]=join(dir,key+'.json');await writeFile(contracts[key],await readFile(defaults[key]));}
 const reference=join(dir,'reference.png'),style=join(dir,'style.json');
 await writeFile(reference,encodePng({width:8,height:8,pixels:Buffer.alloc(8*8*4,255)}));
 await writeFile(style,json({kind:'ui_skin_style_draft',version:'0.1',id:'offline-style',revision:1,status:'draft',name:'Offline material style',referenceSummary:'Synthetic opaque reference',palette:{basis:'visual-estimate-not-colorimetric-sampling',colors:{base:'#888888'}},observedRules:['Paper material.'],extensionRules:['Preserve the palette.'],partRules:[{match:{assetPrefix:'slider.'},appearance:'Pale thumb.'}]}));
 return {dir,args:{reference,style,contracts,templateOutput:join(dir,'templates'),output:join(dir,'plans')}};
}
function imageFor(plan){
 const width=plan.request.width,height=plan.request.height,pixels=Buffer.alloc(width*height*4),scale=plan.outputScale??1;
 for(const p of plan.parts){const [x,y,w,h]=p.bodyRect.map(n=>n*scale);for(let row=y;row<y+h;row++)for(let col=x;col<x+w;col++)pixels.set([80,100,120,255],(row*width+col)*4);}
 return {width,height,pixels};
}
async function batchFixture(t){
 const f=await fixture(t),template=JSON.parse(await readFile(f.args.contracts.template));
 await buildTemplates({config:f.args.contracts.template,output:f.args.templateOutput,render:async({spec,directory})=>{
  const width=spec.coordinates.width*spec.coordinates.outputScale,height=spec.coordinates.height*spec.coordinates.outputScale,png=encodePng({width,height,pixels:Buffer.alloc(width*height*4)}),files=[];
  for(const sheet of spec.sheets)for(const role of ['clean','review']){const file=sheet.filePrefix+'.'+role+'.png';await writeFile(join(directory,file),png);files.push({file});}return {renderer:'offline-test-double',files};
 }});
 const plans=[];for(const sheetId of [...template.sheets.map(s=>s.id),'S05']){const p=await prepareGenerationPlan({...f.args,sheetId});plans.push({sheetId,sha256:p.planSha256,assets:p.assets});}
 const batch={kind:'ui_skin_generation_batch',version:'0.1',computeAuthorized:false,plans,assetCount:plans.reduce((sum,p)=>sum+p.assets,0),referenceSha256:hash(await readFile(f.args.reference)),styleSha256:hash(await readFile(f.args.style))},batchSha256=hash(json(batch));
 await mkdir(join(f.dir,'batches',batchSha256),{recursive:true});await writeFile(join(f.dir,'batches',batchSha256,'batch.json'),json(batch));
 const execution={skinDirectory:f.dir,batchSha256,contracts:f.args.contracts},intake={...execution,templateSha256:hash(await readFile(f.args.contracts.template)),sheets:template.sheets};
 return {...f,plans,batch,execution,intake};
}
test('optional S05 freezes its own three-slot contract and shared style without changing the 32-part core',async t=>{
 const f=await fixture(t),before=await readFile(f.args.contracts.template),p=await prepareGenerationPlan({...f.args,sheetId:'S05'}),plan=JSON.parse(await readFile(join(p.directory,'plan.json'))),material=await readMaterialTemplate();
 assert.equal(plan.purpose,'material-atlas');assert.equal(plan.assetCount,3);assert.equal(plan.bindings.materialTemplateSha256,material.sha256);
 assert.deepEqual(plan.parts.map(p=>p.bodyRect),[[64,64,896,144],[64,272,896,96],[64,432,512,512]]);
 assert.deepEqual(await readFile(join(p.directory,'inputs/material-template.json')),material.bytes);
 assert.deepEqual(await readFile(f.args.contracts.template),before);assert.equal(JSON.parse(before).sheets.flatMap(s=>s.parts).length,32);
 const prompt=await readFile(join(p.directory,'prompt.txt'),'utf8');assert.match(prompt,/Opaque material inside rectangles is allowed/);assert.doesNotMatch(prompt,/Tracks must be empty/);
 assert.equal((await verifyGenerationPlan({directory:p.directory,planSha256:p.planSha256,contracts:f.args.contracts})).status,'verified-awaiting-confirmation');
 await writeFile(join(p.directory,'inputs/material-template.json'),'{}');await assert.rejects(verifyGenerationPlan({directory:p.directory,planSha256:p.planSha256,contracts:f.args.contracts}),/resource changed/);
});
test('material gates allow opaque tiles and disconnected ornament, but reject gutters, empty slots and invalid alpha',async()=>{
 const {spec}=await readMaterialTemplate(),plan={purpose:'material-atlas',request:{width:1024,height:1024},parts:spec.parts},image=imageFor(plan);
 const [x,y,w,h]=spec.parts[0].bodyRect;
 for(let row=y;row<y+h;row++)for(let col=x+32;col<x+w-32;col++)image.pixels.fill(0,(row*image.width+col)*4,(row*image.width+col)*4+4);
 assert.equal(assessPilot(encodePng(image),plan).status,'pixel-gates-passed-awaiting-visual-review');
 image.pixels[3]=255;assert.equal(assessMaterialAtlas(encodePng(image),plan).outsideBodyPixels,1);
 image.pixels[3]=0;image.pixels[0]=1;assert.ok(assessMaterialAtlas(encodePng(image),plan).issues.some(i=>i.code==='alpha.transparent-rgb'));
 const blank={...image,pixels:Buffer.alloc(image.pixels.length)};assert.equal(assessMaterialAtlas(encodePng(blank),plan).issues.filter(i=>i.code==='empty-body').length,3);
 assert.ok(assessMaterialAtlas(encodePng({...image,pixels:Buffer.alloc(image.pixels.length,255)}),plan).issues.some(i=>i.code==='alpha.opaque-background'));
});
test('five-sheet batch submits each once and separates frozen material sources from four core sources',async t=>{
 const f=await batchFixture(t),seen=[],args={...f.execution,confirmedBatchSha256:f.execution.batchSha256};
 const adapter={generate:async request=>{seen.push(request.sheetId);const plan=JSON.parse(await readFile(join(f.dir,'plans',request.planSha256,'plan.json'))),geometry=JSON.parse(await readFile(join(f.dir,'plans',request.planSha256,'geometry.json')));return encodePng(imageFor({...plan,outputScale:geometry.coordinates.outputScale}));}};
 const result=await executeBatch(args,adapter);assert.equal(result.postprocessReady,true);assert.equal(result.adapterCallsThisRun,5);assert.deepEqual(seen,['S01','S02','S03','S04','S05']);
 const intake=await inspectGenerationBatch(f.intake);assert.equal(intake.sources.length,4);assert.equal(intake.materialSources.length,1);assert.equal(intake.summary.nodes.length,5);assert.equal(intake.summary.originalChecksPassed,true);
 const source=intake.materialSources[0];assert.equal(source.planSha256,f.plans[4].sha256);assert.equal(hash(source.template.bytes),source.template.sha256);assert.deepEqual(JSON.parse(source.template.bytes).parts.map(p=>p.assetId),['material.title-band','material.section-band','material.panel-fill']);
 assert.equal((await runAuthorizedBatch(args,adapter)).adapterCallsThisRun,0);assert.equal(seen.length,5);
});
test('S05 supplements and local image recovery retain the frozen material binding and never resubmit old plans',async t=>{
 const f=await batchFixture(t),args={...f.execution,confirmedBatchSha256:f.execution.batchSha256};let calls=0;
 await executeBatch(args,{generate:async request=>{calls++;if(request.sheetId==='S05')throw Error('offline fixture');return readFile(f.args.reference);}});
 let intake=await inspectGenerationBatch(f.intake);assert.equal(intake.materialSources.length,0);assert.equal(intake.sources.length,4);
 const one={...f.execution,sheetId:'S05'},supplement=await prepareSupplement(one);
 await executeSupplement({...one,confirmed:supplement.planSha256},{generate:async()=>{calls++;throw Error('offline fixture');}});
 intake=await inspectGenerationBatch(f.intake);const node=intake.summary.nodes.find(n=>n.sheetId==='S05'),plan=JSON.parse(await readFile(join(f.dir,'plans',node.planSha256,'plan.json'))),png=encodePng(imageFor(plan)),relay=await relayRecoveryFixture({root:f.dir,intake,node,bytes:png}),before=calls;
 const recovered=await recoverCodexSheet({...one,...relay});assert.equal(recovered.providerCalls,0);assert.equal(calls,before);
 intake=await inspectGenerationBatch(f.intake);assert.equal(intake.sources.length,4);assert.equal(intake.materialSources.length,1);assert.equal(intake.materialSources[0].planSha256,supplement.planSha256);assert.equal(intake.materialSources[0].template.sha256,plan.bindings.materialTemplateSha256);assert.equal(intake.summary.nodes.find(n=>n.sheetId==='S05').inspection,'pixel-gates-passed-awaiting-visual-review');
});

test('a received but rejected material sheet can be replaced only by a fresh confirmed supplement, preserving the original evidence',async t=>{
 const f=await batchFixture(t),args={...f.execution,confirmedBatchSha256:f.execution.batchSha256};let calls=0;
 await executeBatch(args,{generate:async request=>{
  calls++;const plan=JSON.parse(await readFile(join(f.dir,'plans',request.planSha256,'plan.json'))),geometry=JSON.parse(await readFile(join(f.dir,'plans',request.planSha256,'geometry.json'))),image=imageFor({...plan,outputScale:geometry.coordinates.outputScale});
  if(request.sheetId==='S05'){const [x,y,w,h]=plan.parts[1].bodyRect;for(let row=y;row<y+h;row++)image.pixels.fill(0,(row*image.width+x)*4,(row*image.width+x+w)*4);}
  return encodePng(image);
 }});
 const one={...f.execution,sheetId:'S05'},intake=await inspectGenerationBatch(f.intake),oldNode=intake.summary.nodes.find(n=>n.sheetId==='S05');
 assert.equal(oldNode.status,'received');assert.equal(oldNode.inspection,'rejected');
 const original=new Map();for(const name of ['raw.png','receipt.json','inspection.json','external-result.json'])original.set(name,await readFile(join(f.dir,'attempts',oldNode.planSha256,name)));
 const prepared=await prepareSupplement(one);assert.notEqual(prepared.planSha256,oldNode.planSha256);assert.equal(calls,5);
 await assert.rejects(executeSupplement({...one,confirmed:oldNode.planSha256},{generate:async()=>{calls++;}}),/confirmation/);assert.equal(calls,5);
 const plan=JSON.parse(await readFile(join(f.dir,'plans',prepared.planSha256,'plan.json'))),replacement=encodePng(imageFor(plan));
 assert.equal(plan.supplement.parentReceiptSha256,hash(original.get('receipt.json')));
 await executeSupplement({...one,confirmed:prepared.planSha256},{generate:async()=>{calls++;return replacement;}});
 const after=await inspectGenerationBatch(f.intake),node=after.summary.nodes.find(n=>n.sheetId==='S05');
 assert.equal(calls,6);assert.equal(node.inspection,'pixel-gates-passed-awaiting-visual-review');assert.equal(after.summary.originalChecksPassed,true);assert.equal(after.materialSources[0].sha256,hash(replacement));
 for(const [name,bytes]of original)assert.deepEqual(await readFile(join(f.dir,'attempts',oldNode.planSha256,name)),bytes);
 await assert.rejects(prepareSupplement(one),/only-missing/);await assert.rejects(executeSupplement({...one,confirmed:prepared.planSha256},{generate:async()=>{calls++;}}),/confirmation/);assert.equal(calls,6);
});

async function returnedFixture(t){
 const f=await batchFixture(t),one={...f.execution,sheetId:'S05'};await authorizeBatch({...f.execution,confirmedBatchSha256:f.execution.batchSha256});await beginSubmission(one);
 const p=f.plans.find(p=>p.sheetId==='S05'),directory=join(f.dir,'attempts',p.sha256),planDirectory=join(f.dir,'plans',p.sha256),plan=JSON.parse(await readFile(join(planDirectory,'plan.json'))),raw=encodePng(imageFor(plan));
 const submission=await readFile(join(directory,'submission.json')),outcome=Buffer.from(json({kind:'ui_skin_external_result',version:'1.0',status:'returned',submissionSha256:hash(submission),rawSha256:hash(raw),automaticRetry:false,createdAt:'2026-01-01T00:00:00.000Z'}));
 // Fixtures model process termination after the outcome and before the receipt.
 await writeFile(join(directory,'external-result.json'),outcome);await writeFile(join(directory,'adapter-output.png'),raw);
 const claim=Buffer.from(json({rawSha256:hash(raw),bytes:raw.length})),inspection=Buffer.from(json({kind:'ui_skin_pilot_inspection',version:'0.1',planSha256:p.sha256,rawSha256:hash(raw),...assessPilot(raw,{...plan,outputScale:1})}));
 return {...f,one,p,directory,planDirectory,raw,outcome,claim,inspection};
}
test('recorded returns recover locally at every reception checkpoint without relay lookup, overwrite or resubmission',async t=>{
 for(const checkpoint of [0,1,2,3]){
  const f=await returnedFixture(t),files=[['receive.claim',f.claim],['raw.png',f.raw],['inspection.json',f.inspection]],preserved=new Map([['external-result.json',f.outcome],['adapter-output.png',f.raw]]);
  for(const [file,bytes]of files.slice(0,checkpoint)){await writeFile(join(f.directory,file),bytes);preserved.set(file,bytes);}
  const before=await inspectGenerationBatch(f.intake),node=before.summary.nodes.find(n=>n.sheetId==='S05');assert.equal(node.status,'indeterminate');assert.equal(node.receptionPending,true);
  const recovered=await recoverCodexSheet({...f.one,relayRoot:'this-relay-must-never-be-read',home:'this-home-must-never-be-read'});
  assert.equal(recovered.providerCalls,0);assert.equal(recovered.recoveredReception,true);assert.equal(recovered.rawSha256,hash(f.raw));
  for(const [file,bytes]of preserved)assert.deepEqual(await readFile(join(f.directory,file)),bytes);
  const after=await inspectGenerationBatch(f.intake),ready=after.summary.nodes.find(n=>n.sheetId==='S05');assert.equal(ready.status,'received');assert.equal(ready.inspection,'pixel-gates-passed-awaiting-visual-review');assert.equal(ready.receptionPending,undefined);
  const receipt=await readFile(join(f.directory,'receipt.json'));
  await assert.rejects(recoverCodexSheet(f.one),/indeterminate-sheet-required/);assert.deepEqual(await readFile(join(f.directory,'receipt.json')),receipt);
 }
});
test('returned-reception recovery refuses every changed partial artifact before writing a receipt',async t=>{
 const f=await returnedFixture(t),reservation=await readFile(join(f.directory,'reservation.json')),submission=await readFile(join(f.directory,'submission.json'));
 for(const bad of ['receive.claim','raw.png','inspection.json','adapter-output.png','missing-source']){
  const directory=join(f.dir,'corrupted',bad.replaceAll('.','-'));await mkdir(directory,{recursive:true});
  for(const [file,bytes]of [['reservation.json',reservation],['submission.json',submission],['external-result.json',f.outcome],['adapter-output.png',f.raw]])if(bad!=='missing-source'||file!=='adapter-output.png')await writeFile(join(directory,file),bytes);
  if(bad!=='missing-source')await writeFile(join(directory,bad),'changed fixture evidence');
  const before=bad==='missing-source'?null:await readFile(join(directory,bad));
  await assert.rejects(recoverReturnedAttempt({directory,planDirectory:f.planDirectory,planSha256:f.p.sha256}),/changed|missing/);
  if(before)assert.deepEqual(await readFile(join(directory,bad)),before);
  await assert.rejects(readFile(join(directory,'receipt.json')),{code:'ENOENT'});if(bad!=='receive.claim')await assert.rejects(readFile(join(directory,'receive.claim')),{code:'ENOENT'});
 }
 const prompt=join(f.planDirectory,'prompt.txt'),originalPrompt=await readFile(prompt);await writeFile(prompt,'changed frozen input');
 await assert.rejects(recoverReturnedAttempt({directory:f.directory,planDirectory:f.planDirectory,planSha256:f.p.sha256}),/Frozen input changed/);
 await assert.rejects(readFile(join(f.directory,'receive.claim')),{code:'ENOENT'});await writeFile(prompt,originalPrompt);
});
test('a fresh material supplement interrupted during reception is recovered locally without replaying its model request',async t=>{
 const f=await batchFixture(t);let calls=0;
 await executeBatch({...f.execution,confirmedBatchSha256:f.execution.batchSha256},{generate:async request=>{calls++;if(request.sheetId==='S05')throw Error('offline fixture');return readFile(f.args.reference);}});
 const one={...f.execution,sheetId:'S05'},supplement=await prepareSupplement(one),directory=join(f.dir,'attempts',supplement.planSha256);
 await assert.rejects(executeSupplement({...one,confirmed:supplement.planSha256},{generate:async request=>{
  calls++;const plan=JSON.parse(await readFile(join(f.dir,'plans',request.planSha256,'plan.json'))),raw=encodePng(imageFor(plan));
  // Matching claim models a previous receiver stopping immediately afterwards.
  await writeFile(join(directory,'receive.claim'),json({rawSha256:hash(raw),bytes:raw.length}));return raw;
 }}),{code:'EEXIST'});
 const before=await inspectGenerationBatch(f.intake);assert.equal(before.summary.nodes.find(n=>n.sheetId==='S05').receptionPending,true);
 const outcome=await readFile(join(directory,'external-result.json')),recovered=await recoverCodexSheet(one);assert.equal(recovered.recoveredReception,true);assert.equal(recovered.providerCalls,0);assert.equal(calls,6);
 const after=await inspectGenerationBatch(f.intake);assert.equal(after.materialSources.length,1);assert.equal(after.materialSources[0].planSha256,supplement.planSha256);assert.deepEqual(await readFile(join(directory,'external-result.json')),outcome);
 await assert.rejects(executeSupplement({...one,confirmed:supplement.planSha256},{generate:async()=>{calls++;}}),/confirmation/);assert.equal(calls,6);
});
