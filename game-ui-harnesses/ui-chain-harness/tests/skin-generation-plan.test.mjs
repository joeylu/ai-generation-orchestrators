import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, mkdir, rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { defaults } from '../src/contracts/build.mjs';
import { buildTemplates } from '../src/templates/build.mjs';
import { encodePng } from '../src/skins/png.mjs';
import { hash, json } from '../src/skins/package.mjs';
import { prepareGenerationPlan, verifyGenerationPlan } from '../src/skin-generation/plan.mjs';
import { reserveAttempt, receiveAttempt, assessPilot } from '../src/skin-generation/attempt.mjs';
import {authorizeBatch,beginSubmission,finishSubmission} from '../src/skin-generation/batch-execution.mjs';
import {inspectGenerationBatch} from '../src/skin-generation/batch-intake.mjs';
import {executeBatch,runAuthorizedBatch,executeBatchPipeline,postprocessBatch} from '../src/skin-generation/batch-runner.mjs';
import {prepareSupplement,executeSupplement} from '../src/skin-generation/supplement.mjs';
import {generationExecutionPolicy,validateGenerationExecutionPolicy} from '../src/skin-generation/execution-policy.mjs';
import {recoverCodexSheet,findRecoverableCodexImage} from '../src/skin-generation/codex-recovery.mjs';
import {relayRecoveryFixture} from './helpers/relay-recovery-fixture.mjs';

test('historical supplement PNG survives newer failed supplements and recovers without rewriting any outcome',async t=>{
 const f=await batchFixture(t),png=await readFile(f.args.reference),args={...f.execution,confirmedBatchSha256:f.execution.batchSha256};let calls=0;
 await executeBatch(args,{generate:async r=>{calls++;if(r.sheetId==='S01')throw Error('offline');return png;}});
 const one={...f.execution,sheetId:'S01'},first=await prepareSupplement(one);
 await executeSupplement({...one,confirmed:first.planSha256},{generate:async()=>{calls++;throw Error('failed after image fixture');}});
 const firstIntake=await inspectGenerationBatch(f.intake),node=firstIntake.summary.nodes[0];
 const relay=await relayRecoveryFixture({root:f.dir,intake:firstIntake,node,bytes:png});
 for(let i=0;i<2;i++){const next=await prepareSupplement(one);await executeSupplement({...one,confirmed:next.planSha256},{generate:async()=>{calls++;throw Error('no image');}});}
 const before=await inspectGenerationBatch(f.intake),leaf=before.summary.nodes[0],oldResults=before.evidence.filter(e=>/external-result.json$/.test(e.file)),otherReceipts=before.evidence.filter(e=>/receipt.json$/.test(e.file));
 assert.equal((await findRecoverableCodexImage({intake:before,node:leaf,...relay})).planSha256,first.planSha256);
 assert.equal(await findRecoverableCodexImage({intake:before,node:{...leaf,outcomeRecorded:false},...relay}),null);
 const callsBefore=calls,recovered=await recoverCodexSheet({...one,...relay});assert.equal(recovered.providerCalls,0);assert.equal(calls,callsBefore);
 const after=await inspectGenerationBatch(f.intake);assert.equal(after.sources.length,4);assert.equal(after.summary.nodes[0].recovered,true);assert.equal(after.summary.nodes[0].recoveredFromPlanSha256,first.planSha256);assert.equal(after.sources.find(s=>s.sheetId==='S01').sha256,hash(png));
 for(const file of [...oldResults,...otherReceipts])assert.deepEqual(await readFile(join(f.dir,file.file)),file.bytes);
 await assert.rejects(recoverCodexSheet({...one,...relay}),/indeterminate-sheet-required/);
 const record=join(f.dir,'attempts',leaf.planSha256,'recovered-result.json'),original=await readFile(record),data=JSON.parse(original);
 for(const patch of [{sourcePlanSha256:f.plans[1].sha256},{sourceResultSha256:'a'.repeat(64)},{originalResultSha256:'a'.repeat(64)},{rawSha256:'a'.repeat(64)},{providerCalls:1},{audit:{...data.audit,postImageGateVerified:false}}]){
  await writeFile(record,json({...data,...patch}));await assert.rejects(inspectGenerationBatch(f.intake),/recovery.supplement-evidence-binding/);
 }
 await writeFile(record,original);
});

test('current supplement recovery accepts audited image after CLI failure but rejects altered image evidence',async t=>{
 const f=await batchFixture(t),png=await readFile(f.args.reference);await executeBatch({...f.execution,confirmedBatchSha256:f.execution.batchSha256},{generate:async()=>{throw Error('offline');}});
 const one={...f.execution,sheetId:'S01'},p=await prepareSupplement(one);await executeSupplement({...one,confirmed:p.planSha256},{generate:async()=>{throw Error('offline');}});
 const intake=await inspectGenerationBatch(f.intake),node=intake.summary.nodes[0],relay=await relayRecoveryFixture({root:f.dir,intake,node,bytes:png});
 await writeFile(join(relay.job,'original-output-1.png'),'wrong');assert.equal(await findRecoverableCodexImage({intake,node,...relay}),null);
 await assert.rejects(recoverCodexSheet({...one,...relay}),/no-verified-image/);await assert.rejects(readFile(join(f.dir,'attempts',p.planSha256,'recovered-result.json')),e=>e.code==='ENOENT');
 await writeFile(join(relay.job,'original-output-1.png'),png);await recoverCodexSheet({...one,...relay});
 const after=await inspectGenerationBatch(f.intake);assert.equal(after.summary.nodes[0].recoveredFromPlanSha256,p.planSha256);assert.equal(after.sources.length,1);
});

test('original batch recovery still binds the original submission and preserves its outcome',async t=>{
 const f=await batchFixture(t),png=await readFile(f.args.reference);await executeBatch({...f.execution,confirmedBatchSha256:f.execution.batchSha256},{generate:async()=>{throw Error('offline');}});
 const intake=await inspectGenerationBatch(f.intake),node=intake.summary.nodes[0],relay=await relayRecoveryFixture({root:f.dir,intake,node,bytes:png}),old=await readFile(join(f.dir,'attempts',node.planSha256,'external-result.json'));
 await recoverCodexSheet({...f.execution,sheetId:'S01',...relay});const after=await inspectGenerationBatch(f.intake);assert.equal(after.summary.nodes[0].recovered,true);assert.equal(after.sources.length,1);assert.deepEqual(await readFile(join(f.dir,'attempts',node.planSha256,'external-result.json')),old);
});

test('single sheet supplement preserves three received sheets, binds fresh confirmation and rejects duplicate calls',async t=>{
 const f=await batchFixture(t),png=await readFile(f.args.reference),args={...f.execution,confirmedBatchSha256:f.execution.batchSha256};
 await executeBatch(args,{generate:async r=>{if(r.sheetId==='S02')throw Error('offline');return png;}});
 const old=await readFile(join(f.dir,'attempts',f.plans[1].sha256,'external-result.json'));
 const one={...f.execution,sheetId:'S02'},prepared=await prepareSupplement(one);
 assert.notEqual(prepared.planSha256,f.plans[1].sha256);
 assert.equal((await prepareSupplement(one)).planSha256,prepared.planSha256);
 let calls=0;const adapter={generate:async r=>{calls++;assert.equal(r.sheetId,'S02');assert.equal(r.planSha256,prepared.planSha256);return png;}};
 await assert.rejects(executeSupplement({...one,confirmed:'wrong'},adapter),/confirmation/);assert.equal(calls,0);
 const results=await Promise.allSettled([executeSupplement({...one,confirmed:prepared.planSha256},adapter),executeSupplement({...one,confirmed:prepared.planSha256},adapter)]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(calls,1);
 const intake=await inspectGenerationBatch(f.intake);assert.equal(intake.sources.length,4);assert.equal(intake.summary.nodes[1].supplement,true);assert.equal(intake.summary.nodes[1].status,'received');
 assert.equal(new Set(intake.evidence.map(e=>e.file)).size,intake.evidence.length);
 for(const i of [0,2,3])assert.equal(intake.summary.nodes[i].planSha256,f.plans[i].sha256);
 assert.deepEqual(await readFile(join(f.dir,'attempts',f.plans[1].sha256,'external-result.json')),old);
 await assert.rejects(executeSupplement({...one,confirmed:prepared.planSha256},adapter),/confirmation/);assert.equal(calls,1);
 await writeFile(join(f.dir,'attempts',prepared.planSha256,'raw.png'),Buffer.from('tampered'));
 await assert.rejects(inspectGenerationBatch(f.intake),/supplement.invalid-evidence/);
});

test('failed supplement requires a new plan and never automatically retries',async t=>{
 const f=await batchFixture(t),args={...f.execution,confirmedBatchSha256:f.execution.batchSha256};
 await executeBatch(args,{generate:async()=>{throw Error('offline');}});
 const one={...f.execution,sheetId:'S02'},p=await prepareSupplement(one);let calls=0;
 await executeSupplement({...one,confirmed:p.planSha256},{generate:async()=>{calls++;throw Error('offline');}});
 assert.equal((await inspectGenerationBatch(f.intake)).summary.nodes[1].status,'indeterminate');
 const next=await prepareSupplement(one);assert.notEqual(next.planSha256,p.planSha256);assert.equal(calls,1);
});

async function setup(t) {
  const dir = await mkdtemp(join(tmpdir(), 'ui-skin-plan-'));
  t.after(async () => {
    assert.equal(dirname(resolve(dir)), resolve(tmpdir()));
    assert.match(dir.split(/[\\/]/).at(-1), /^ui-skin-plan-/);
    await rm(dir, { recursive: true, force: true });
  });
  const contracts = {};
  for (const [key, source] of Object.entries(defaults)) {
    // Contract defaults also include an output path; only these three are inputs.
    if (!['template', 'registry', 'usage'].includes(key)) continue;
    contracts[key] = join(dir, `${key}.json`);
    await writeFile(contracts[key], await readFile(source));
  }
  const templateOutput = join(dir, 'templates');
  await buildTemplates({ config: contracts.template, output: templateOutput, render: async ({ spec, directory }) => {
    const width = spec.coordinates.width * spec.coordinates.outputScale;
    const height = spec.coordinates.height * spec.coordinates.outputScale;
    const png = encodePng({ width, height, pixels: Buffer.alloc(width * height * 4) });
    const files = [];
    for (const s of spec.sheets) for (const role of ['clean', 'review']) {
      const file = `${s.filePrefix}.${role}.png`; await writeFile(join(directory, file), png); files.push({ file });
    }
    return { renderer: 'offline-test-double', files };
  }});
  const reference = join(dir, 'reference.png'), style = join(dir, 'style.json');
  await writeFile(reference, encodePng({ width: 16, height: 12, pixels: Buffer.alloc(16 * 12 * 4, 255) }));
  const spec = { kind: 'ui_skin_style_draft', version: '0.1', id: 'test-style', revision: 1, status: 'draft', name: 'Offline test style', referenceSummary: 'Synthetic opaque reference',
    palette: { basis: 'visual-estimate-not-colorimetric-sampling', colors: { base: '#888888' } }, observedRules: ['Muted material.'], extensionRules: ['Extend consistently.'],
    partRules: [{ match: { assetPrefix: 'slider.' }, appearance: 'Round pale thumb.' }] };
  await writeFile(style, json(spec));
  return { args: { reference, style, output: join(dir, 'plans'), templateOutput, contracts }, spec, dir };
}

test('reference-bound planning freezes PNG, style, contracts and exactly the selected sheet without authorization', async t => {
  const { args } = await setup(t), result = await prepareGenerationPlan(args);
  const bytes = await readFile(join(result.directory, 'plan.json')), plan = JSON.parse(bytes);
  assert.equal(hash(bytes), result.planSha256);
  assert.equal(plan.computeAuthorized, false);
  assert.equal(plan.style.status, 'draft');
  assert.deepEqual(plan.reference, { file: 'reference.png', width: 16, height: 12, role: 'style-only' });
  assert.equal(plan.request.images, 1);
  assert.equal(plan.policy.automaticRetry, false);
  const template = JSON.parse(await readFile(args.contracts.template));
  assert.deepEqual(plan.parts.map(p => p.assetId), template.sheets.find(s => s.id === 'S03').parts.map(p => p.assetId));
  const geometry = JSON.parse(await readFile(join(result.directory, 'geometry.json')));
  assert.equal(geometry.sheets.length, 1);
  assert.equal(geometry.sheets[0].id, 'S03');
  assert.deepEqual(await readFile(join(result.directory, 'reference.png')), await readFile(args.reference));
  assert.ok(!bytes.toString().includes(args.reference));
  assert.equal((await verifyGenerationPlan({ ...result, contracts: args.contracts })).status, 'verified-awaiting-confirmation');
});

test('same frozen inputs have the same digest; new style revision creates a sibling and preserves the prior plan', async t => {
  const { args, spec } = await setup(t), first = await prepareGenerationPlan(args), second = await prepareGenerationPlan(args);
  assert.equal(first.directory, second.directory);
  await writeFile(args.style, json({ ...spec, revision: 2, observedRules: ['Darker material.'] }));
  const changed = await prepareGenerationPlan(args);
  assert.notEqual(first.planSha256, changed.planSha256);
  await verifyGenerationPlan({ ...first, contracts: args.contracts });
  await verifyGenerationPlan({ ...changed, contracts: args.contracts });
});

test('changed frozen resources or plan bytes cannot pass the selected digest', async t => {
  const { args } = await setup(t), result = await prepareGenerationPlan(args);
  await assert.rejects(verifyGenerationPlan({ ...result, planSha256: '0'.repeat(64), contracts: args.contracts }), /digest mismatch/);
  const prompt = join(result.directory, 'prompt.txt');
  await writeFile(prompt, 'changed prompt');
  await assert.rejects(verifyGenerationPlan({ ...result, contracts: args.contracts }), /resource changed/);
});

test('current contract changes invalidate the old plan even when its frozen resources remain intact', async t => {
  const { args } = await setup(t), result = await prepareGenerationPlan(args);
  await writeFile(args.contracts.registry, (await readFile(args.contracts.registry, 'utf8')) + '\n');
  await assert.rejects(verifyGenerationPlan({ ...result, contracts: args.contracts }), /Contracts or planning tools changed/);
});

test('unknown sheets, orphan style selectors and invented accepted status are rejected', async t => {
  const { args, spec } = await setup(t);
  await assert.rejects(prepareGenerationPlan({ ...args, sheetId: 'S99' }), /Unknown sheet/);
  await writeFile(args.style, json({ ...spec, status: 'accepted' }));
  await assert.rejects(prepareGenerationPlan(args), /Invalid style draft/);
  await writeFile(args.style, json({ ...spec, partRules: [{ match: { assetId: 'unknown.part' }, appearance: 'Any' }] }));
  await assert.rejects(prepareGenerationPlan(args), /matches no active/);
});

test('template artifact corruption blocks preparation; existing plan is preserved', async t => {
  const { args } = await setup(t), result = await prepareGenerationPlan(args);
  const pointer = JSON.parse(await readFile(join(args.templateOutput, 'current.json')));
  await writeFile(join(args.templateOutput, 'builds', pointer.buildId, 's03-tracks-thumbs.clean.png'), 'broken');
  await assert.rejects(prepareGenerationPlan(args), /Rebuild\/repair/);
  await verifyGenerationPlan({ ...result, contracts: args.contracts });
});

test('other sheet geometry is derived from the template, not a duplicated pilot part list', async t => {
  const { args } = await setup(t), result = await prepareGenerationPlan({ ...args, sheetId: 'S01' });
  const template = JSON.parse(await readFile(args.contracts.template)), plan = JSON.parse(await readFile(join(result.directory, 'plan.json')));
  assert.equal(plan.assetCount, template.sheets.find(s => s.id === 'S01').parts.length);
  assert.deepEqual(plan.parts.map(p => p.bodyRect), template.sheets.find(s => s.id === 'S01').parts.map(p => p.bodyRect));
});

test('confirmed pilot reservation is single-use; raw receipt preserves bytes even when dimensions fail', async t => {
  const { args, dir } = await setup(t), plan = await prepareGenerationPlan(args);
  const request = { planDirectory: plan.directory, planSha256: plan.planSha256, output: join(dir, 'attempts'), contracts: args.contracts };
  await assert.rejects(reserveAttempt(request), /human-confirmed/);
  const attempt = await reserveAttempt({ ...request, confirmedPlanSha256: plan.planSha256 });
  await assert.rejects(reserveAttempt({ ...request, confirmedPlanSha256: plan.planSha256 }), /already has a reservation/);
  const received = await receiveAttempt({ ...request, directory: attempt.directory, raw: args.reference });
  assert.equal(received.state, 'received'); assert.equal(received.status, 'rejected');
  assert.ok(received.issues.some(i => i.code === 'dimensions'));
  assert.deepEqual(await readFile(join(attempt.directory, 'raw.png')), await readFile(args.reference));
  await assert.rejects(receiveAttempt({ ...request, directory: attempt.directory, raw: args.reference }), { code: 'EEXIST' });
});

test('pilot inspection keeps alpha, applies outputScale, rejects one stray pixel and does not infer semantic acceptance', () => {
  const plan = { request: { width:16, height:16 }, outputScale:2, parts:[{assetId:'test',bodyRect:[2,2,4,4]}] };
  const pixels=Buffer.alloc(16*16*4);
  for(let y=4;y<12;y++)for(let x=4;x<12;x++) pixels[(y*16+x)*4+3]=127;
  const bytes=encodePng({width:16,height:16,pixels}), result=assessPilot(bytes,plan);
  assert.equal(result.status,'pixel-gates-passed-awaiting-visual-review');
  assert.equal(result.partialAlphaPixels,64); assert.equal(result.semanticIdentity,'not-automatically-verified');
  assert.deepEqual(result.silhouettes[0].bounds,[4,4,8,8]);
  pixels[3]=1;
  const bad=assessPilot(encodePng({width:16,height:16,pixels}),plan);
  assert.equal(bad.status,'rejected'); assert.equal(bad.outsideBodyPixels,1);
});

test('unsupported PNG encoding produces a rejection, not a repaired or successful image', () => {
  const result=assessPilot(Buffer.from('not a PNG'),{});
  assert.equal(result.status,'rejected'); assert.equal(result.issues[0].code,'png.unsupported');
});

async function batchFixture(t){
  const f=await setup(t),plans=[];
  const template=JSON.parse(await readFile(f.args.contracts.template));
  for(const sheet of template.sheets){const p=await prepareGenerationPlan({...f.args,sheetId:sheet.id});plans.push({sheetId:p.sheetId,sha256:p.planSha256,assets:p.assets});}
  const batch={kind:'ui_skin_generation_batch',version:'0.1',computeAuthorized:false,plans,assetCount:plans.reduce((n,p)=>n+p.assets,0),referenceSha256:hash(await readFile(f.args.reference)),styleSha256:hash(await readFile(f.args.style))};
  const batchSha256=hash(json(batch));await mkdir(join(f.dir,'batches',batchSha256),{recursive:true});await writeFile(join(f.dir,'batches',batchSha256,'batch.json'),json(batch));
  return {...f,plans,execution:{skinDirectory:f.dir,batchSha256,contracts:f.args.contracts},intake:{skinDirectory:f.dir,batchSha256,templateSha256:hash(await readFile(f.args.contracts.template)),sheets:template.sheets}};
}
test('one batch confirmation covers four single claims and verified returns; repeated authorization/calls/receipts blocked',async t=>{
  const f=await batchFixture(t),a=f.execution;
  await assert.rejects(authorizeBatch(a),/confirmation-required/);
  await authorizeBatch({...a,confirmedBatchSha256:a.batchSha256});
  await assert.rejects(authorizeBatch({...a,confirmedBatchSha256:a.batchSha256}),/already-reserved/);
  assert.equal((await inspectGenerationBatch(f.intake)).summary.status,'authorized-awaiting-external-submission');
  for(const p of f.plans){
    const args={...a,sheetId:p.sheetId};
    const claims=await Promise.allSettled([beginSubmission(args),beginSubmission(args)]);
    assert.equal(claims.filter(r=>r.status==='fulfilled').length,1);
    assert.equal((await inspectGenerationBatch(f.intake)).summary.status,'indeterminate');
    const result=await finishSubmission({...args,status:'returned',rawDirectory:f.dir,rawFile:'reference.png'});
    assert.equal(result.state,'received');assert.equal(result.status,'rejected');
    await assert.rejects(finishSubmission({...args,status:'failed'}),{code:'EEXIST'});
    await assert.rejects(beginSubmission(args),/already-claimed/);
  }
  const result=await inspectGenerationBatch(f.intake);assert.equal(result.sources.length,4);assert.equal(result.summary.originalChecksPassed,false);
  assert.equal(result.summary.status,'received-awaiting-localization');
});
test('terminal failure/unknown never retries; partial authorization blocks all submissions',async t=>{
  const f=await batchFixture(t),a=f.execution;
  await authorizeBatch({...a,confirmedBatchSha256:a.batchSha256});
  const path=join(f.dir,'attempts',f.plans[3].sha256,'reservation.json');await rename(path,path+'.saved');
  await assert.rejects(beginSubmission({...a,sheetId:'S01'}),{code:'ENOENT'});
  assert.equal((await inspectGenerationBatch(f.intake)).summary.status,'indeterminate');
  await rename(path+'.saved',path);
  for(const [sheetId,status] of [['S01','failed'],['S02','indeterminate']]){
    const args={...a,sheetId};await beginSubmission(args);await finishSubmission({...args,status});
    await assert.rejects(beginSubmission(args),/already-claimed/);
    await assert.rejects(finishSubmission({...args,status:'returned',rawDirectory:f.dir,rawFile:'reference.png'}),{code:'EEXIST'});
  }
  const result=await inspectGenerationBatch(f.intake);assert.equal(result.summary.nodes[0].status,'failed');assert.equal(result.summary.nodes[1].status,'indeterminate');
  const file=join(f.dir,'attempts',f.plans[0].sha256,'external-result.json'),r=JSON.parse(await readFile(file));
  r.submissionSha256='0'.repeat(64);await writeFile(file,json(r));await assert.rejects(inspectGenerationBatch(f.intake),/outcome-binding/);
});
test('changed planning tools/contracts stop authorization and submission without consuming a claim',async t=>{
  const f=await batchFixture(t),a=f.execution,path=f.args.contracts.registry,original=await readFile(path);
  await writeFile(path,Buffer.concat([original,Buffer.from('\n')]));
  await assert.rejects(authorizeBatch({...a,confirmedBatchSha256:a.batchSha256}),/Contracts or planning tools changed/);
  await writeFile(path,original);await authorizeBatch({...a,confirmedBatchSha256:a.batchSha256});
  await writeFile(path,Buffer.concat([original,Buffer.from('\n')]));
  await assert.rejects(beginSubmission({...a,sheetId:'S01'}),/Contracts or planning tools changed/);
  await assert.rejects(readFile(join(f.dir,'attempts',f.plans[0].sha256,'submission.json')),{code:'ENOENT'});
});

test('adapter runner submits all four frozen requests once, preserves raw results and skips received on resume',async t=>{
  const f=await batchFixture(t),seen=[],png=await readFile(f.args.reference);
  const adapter={generate:async request=>{
    seen.push(request.sheetId);assert.equal(request.images.length,2);
    assert.deepEqual(request.images.map(i=>i.role),['style-reference','geometry-template']);
    for(const i of request.images)assert.equal(hash(i.bytes),i.sha256);
    assert.equal(request.output.transparentBackground,true);assert.equal(request.width,request.height);
    const plan=JSON.parse(await readFile(join(f.dir,'plans',request.planSha256,'plan.json')));
    assert.equal(request.width,plan.request.width);
    assert.equal(request.prompt,await readFile(join(f.dir,'plans',request.planSha256,'prompt.txt'),'utf8'));
    assert.equal(JSON.stringify(request).includes(f.dir),false);
    return png;
  }};
  const args={...f.execution,confirmedBatchSha256:f.execution.batchSha256};
  const result=await executeBatchPipeline(args,adapter);assert.equal(result.generation.adapterCallsThisRun,4);assert.equal(result.generation.postprocessReady,true);assert.equal(result.task,null);
  assert.deepEqual(seen,['S01','S02','S03','S04']);
  const repeat=await runAuthorizedBatch(args,adapter);assert.equal(repeat.adapterCallsThisRun,0);assert.equal(seen.length,4);
  await assert.rejects(executeBatch(args,adapter),/already-reserved/);assert.equal(seen.length,4);
});
test('adapter exceptions and invalid returns become unknown, do not leak errors, and do not cancel untouched siblings',async t=>{
  const f=await batchFixture(t),png=await readFile(f.args.reference),seen=[];
  const adapter={generate:async r=>{seen.push(r.sheetId);if(r.sheetId==='S01')throw Error('private-token-secret-endpoint');if(r.sheetId==='S02')return 'not bytes';return png;}};
  const args={...f.execution,confirmedBatchSha256:f.execution.batchSha256,maxConcurrentSheets:2};
  const r=await executeBatchPipeline(args,adapter);
  assert.equal(r.generation.adapterCallsThisRun,4);assert.equal(r.generation.postprocessReady,false);assert.equal(r.task,null);
  assert.equal(r.generation.nodes[0].status,'indeterminate');assert.equal(r.generation.nodes[1].status,'indeterminate');assert.equal(r.generation.nodes[2].status,'received');
  assert.equal(JSON.stringify(r).includes('private-token'),false);
  const outcome=await readFile(join(f.dir,'attempts',f.plans[0].sha256,'external-result.json'),'utf8');assert.equal(outcome.includes('private-token'),false);
  await runAuthorizedBatch(args,adapter);assert.equal(seen.length,4);
});

const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};

test('invalid postprocessing profiles fail before batch authorization or provider calls',async t=>{
  const f=await batchFixture(t),args={...f.execution,confirmedBatchSha256:f.execution.batchSha256};let calls=0;
  const directory=await mkdtemp(resolve('work/profile-preflight-'));
  t.after(()=>rm(directory,{recursive:true,force:true}));
  const file=join(directory,'profile.json'),valid=JSON.parse(await readFile('configs/studio-metadata-profile.json'));
  const adapter={generate:async()=>{calls++;throw Error('must not submit');}};
  for(const profile of [null,'',join(directory,'missing.json'),f.args.reference])await assert.rejects(executeBatchPipeline({...args,profile},adapter),/invalid-profile-before-generation/);
  for(const bytes of ['{',json({...valid,version:'unknown'}),json({...valid,theme:{}}),json({...valid,allowedProposalIssues:['ignore-all']})]){
    await writeFile(file,bytes);await assert.rejects(executeBatchPipeline({...args,profile:file},adapter),/invalid-profile-before-generation/);
  }
  assert.equal(calls,0);
  assert((await inspectGenerationBatch(f.intake)).summary.nodes.every(n=>n.status==='awaiting-authorization'));
  await writeFile(file,json(valid));
  const result=await executeBatchPipeline({...args,profile:file},adapter);
  assert.equal(calls,4);assert.equal(result.task,null); // valid profile, failed synthetic provider; no postprocess
});

test('pipeline freezes profile bytes before submission and rejects a changed snapshot before postprocessing',async t=>{
  const f=await batchFixture(t),directory=await mkdtemp(resolve('work/profile-freeze-'));
  t.after(()=>rm(directory,{recursive:true,force:true}));
  const profile=join(directory,'profile.json'),original=await readFile('configs/studio-metadata-profile.json');await writeFile(profile,original);
  const args={...f.execution,confirmedBatchSha256:f.execution.batchSha256,profile};let calls=0;
  const result=await executeBatchPipeline(args,{generate:async()=>{
    calls++;await writeFile(profile,'changed while provider is running');args.profile='also-changed.json';throw Error('synthetic unknown response');
  }});
  assert.equal(calls,4);assert.equal(result.task,null);
  const frozen=result.postprocessProfile;assert.equal(frozen.batchSha256,f.execution.batchSha256);assert.equal(frozen.sha256,hash(original));assert.notEqual(frozen.file,profile);
  assert.equal(dirname(dirname(frozen.file)),resolve('work/pipeline-inputs'));
  t.after(()=>rm(dirname(frozen.file),{recursive:true,force:true}));
  assert((await readFile(frozen.file)).equals(original));
  const binding=JSON.parse(await readFile(join(dirname(frozen.file),'binding.json')));assert.equal(binding.profileSha256,frozen.sha256);assert.equal(binding.batchSha256,f.execution.batchSha256);
  const changed=JSON.parse(original);changed.theme.fontSize++;await writeFile(frozen.file,json(changed));
  await assert.rejects(postprocessBatch({...f.execution,profile:frozen.file,profileSha256:frozen.sha256}),/frozen-profile-changed/);
  assert.equal(calls,4);
});

test('two-slot batch refills the released slot, preserves out-of-order image bindings and never replays received sheets',{timeout:15000},async t=>{
  const f=await batchFixture(t),ids=f.plans.map(p=>p.sheetId),started=new Map(ids.map(id=>[id,deferred()])),release=new Map(ids.map(id=>[id,deferred()]));
  const images=new Map(ids.map((id,i)=>[id,encodePng({width:16,height:12,pixels:Buffer.alloc(16*12*4,240+i)})]));
  let active=0,peak=0;const seen=[];
  const adapter={generate:async request=>{const id=request.sheetId;seen.push(id);peak=Math.max(peak,++active);started.get(id).resolve();try{await release.get(id).promise;return images.get(id);}finally{active--;}}};
  const args={...f.execution,confirmedBatchSha256:f.execution.batchSha256,maxConcurrentSheets:2},run=executeBatch(args,adapter);
  // Attach a rejection handler immediately so a broken runner cannot produce an unhandled rejection.
  const observed=run.then(value=>({value}),error=>({error}));
  try{
    await Promise.all(['S01','S02'].map(id=>started.get(id).promise));
    assert.equal(active,2);assert.deepEqual(new Set(seen),new Set(['S01','S02']));
    release.get('S02').resolve();await started.get('S03').promise;
    assert.equal(active,2);assert.equal((await inspectGenerationBatch(f.intake)).summary.nodes.find(n=>n.sheetId==='S02').status,'received');
    release.get('S01').resolve();await started.get('S04').promise;assert.equal(active,2);
    release.get('S04').resolve();release.get('S03').resolve();
    const result=await observed;if(result.error)throw result.error;
    assert.equal(peak,2);assert.equal(active,0);assert.equal(result.value.adapterCallsThisRun,4);assert.equal(result.value.maxConcurrentSheets,2);assert.equal(result.value.postprocessReady,true);
    const intake=await inspectGenerationBatch(f.intake);
    for(const source of intake.sources)assert.equal(source.sha256,hash(images.get(source.sheetId)));
    assert.equal((await runAuthorizedBatch(args,adapter)).adapterCallsThisRun,0);assert.equal(seen.length,4);
  }finally{for(const gate of release.values())gate.resolve();await observed;}
});

test('parallel batch stops unstarted siblings after local reception failure and drains already-started calls',{timeout:15000},async t=>{
  const f=await batchFixture(t),png=await readFile(f.args.reference),second=deferred(),both=deferred(),seen=[];let settled=false;
  const args={...f.execution,confirmedBatchSha256:f.execution.batchSha256,maxConcurrentSheets:2};
  const run=executeBatch(args,{generate:async r=>{
    seen.push(r.sheetId);if(seen.length===2)both.resolve();await both.promise;
    if(r.sheetId==='S01')await writeFile(join(f.dir,'attempts',r.planSha256,'adapter-output.png'),png,{flag:'wx'}); // Fixture: reproduce a local exclusive-write collision.
    else await second.promise;
    return png;
  }}).then(value=>{settled=true;return {value};},error=>{settled=true;return {error};});
  try{
    await both.promise;await new Promise(r=>setTimeout(r,100));
    assert.equal(settled,false);assert.deepEqual(new Set(seen),new Set(['S01','S02']));
    second.resolve();const result=await run;assert.match(result.error?.message??'',/reception-incomplete-no-resubmit/);
    assert.deepEqual(new Set(seen),new Set(['S01','S02']));
    const intake=await inspectGenerationBatch(f.intake);
    assert.equal(intake.summary.nodes.find(n=>n.sheetId==='S02').status,'received');
    assert.equal(intake.summary.nodes.find(n=>n.sheetId==='S03').status,'authorized-awaiting-external-submission');
    assert.equal(intake.summary.nodes.find(n=>n.sheetId==='S04').status,'authorized-awaiting-external-submission');
  }finally{both.resolve();second.resolve();await run;}
});

test('invalid concurrency is rejected before consuming confirmation; shared policy defaults to two and permits serial fallback',async t=>{
  assert.equal(generationExecutionPolicy.maxConcurrentSheets,2);
  assert.equal(validateGenerationExecutionPolicy({...generationExecutionPolicy,maxConcurrentSheets:1}).maxConcurrentSheets,1);
  const f=await batchFixture(t);let calls=0;
  for(const value of [0,3,-1,1.5,'2',null]){
    assert.throws(()=>validateGenerationExecutionPolicy({...generationExecutionPolicy,maxConcurrentSheets:value}),/invalid-execution-policy/);
    await assert.rejects(executeBatch({...f.execution,confirmedBatchSha256:f.execution.batchSha256,maxConcurrentSheets:value},{generate:async()=>{calls++;}}),/invalid-concurrency/);
  }
  assert.equal(calls,0);
  await assert.rejects(readFile(join(f.dir,'batches',f.execution.batchSha256,'authorization.json')),{code:'ENOENT'});
});
test('adapter runner refuses missing authorization or changed input before any call',async t=>{
  const f=await batchFixture(t);let calls=0;const adapter={generate:async()=>{calls++;return new Uint8Array(1);}};
  await assert.rejects(runAuthorizedBatch(f.execution,adapter),/authorization-required/);
  await assert.rejects(executeBatch(f.execution,adapter),/confirmation-required/);
  await writeFile(join(f.dir,'plans',f.plans[0].sha256,'prompt.txt'),'changed');
  await assert.rejects(executeBatch({...f.execution,confirmedBatchSha256:f.execution.batchSha256},adapter),/resource-changed/);
  assert.equal(calls,0);
});
