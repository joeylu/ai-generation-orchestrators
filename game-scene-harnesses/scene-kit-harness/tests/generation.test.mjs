import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, readdirSync, existsSync, renameSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as api from '../src/generation/index.mjs';
import { jsonBytes, seal } from '../src/generation/common.mjs';
import { encodeFixturePng } from '../src/png.mjs';
import { authorizeAndReserve, bytesFor, capabilitiesDraft, complete, decision, prepare, referencePlan, setup, specDraft, styleDraft } from './helpers/generation.mjs';

const rejects = (operation, code) => assert.throws(operation, error => error.errors?.some(issue => issue.code === code));
test('scene reference, text and sketch are explicit independent input modes; empty/unknown input fails', t => {
  const { root } = setup(t); api.initWorkflow(root, { projectId: 'inputs', purpose: 'synthetic-simulation' });
  const image = api.importWorkflowImage(root, bytesFor('terrain-000'));
  const cases = [{ ...specDraft(), specId: 'text' }, ...['scene-reference', 'layout-sketch'].map((role, index) => ({ ...specDraft(), specId: `image.${index}`, description: '', inputs: [{ role, artifact: image }] }))];
  cases.forEach(draft => assert.ok(api.createDesignDraft(root, draft).sha256));
  rejects(() => api.createDesignDraft(root, { ...specDraft(), specId: 'empty', description: '' }), 'SCENE_INPUT_REQUIRED');
  rejects(() => api.createDesignDraft(root, { ...specDraft(), projection: 'isometric' }), 'WORKFLOW_CONTRACT');
  rejects(() => api.createDesignDraft(root, { ...specDraft(), endpoint: 'private' }), 'WORKFLOW_CONTRACT');
  rejects(() => api.createDesignDraft(root, { ...specDraft(), description: 'Call https://private.example/jobs' }), 'PRIVATE_OPERATIONAL_TEXT');
  assert.deepEqual(api.readWorkflowImage(root, image), bytesFor('terrain-000'));
});
test('custom style needs its original anchor; neither a draft nor style review authorizes compute', t => {
  const { root } = setup(t); api.initWorkflow(root, { projectId: 'style', purpose: 'synthetic-simulation' });
  rejects(() => api.createDesignDraft(root, { ...styleDraft(), mode: 'custom' }), 'CUSTOM_STYLE_ANCHOR_REQUIRED');
  const anchor = api.importWorkflowImage(root, bytesFor('background-strip'));
  const spec = api.createDesignDraft(root, specDraft()), style = api.createDesignDraft(root, { ...styleDraft(), mode: 'custom', anchors: [anchor] });
  const capabilities = api.createDesignDraft(root, capabilitiesDraft());
  rejects(() => referencePlan(root, capabilities), 'DESIGN_REVIEW_REQUIRED');
  api.reviewDesign(root, 'spec', decision('spec', spec.sha256)); api.reviewDesign(root, 'style', decision('style', style.sha256));
  const plan = referencePlan(root, capabilities);
  assert.deepEqual(plan.request.images.map(image => image.role), ['style-anchor']);
  rejects(() => api.reservePlan(root, plan.sha256), 'AUTHORIZATION_REQUIRED');
  rejects(() => api.createDesignDraft(root, { format: 'ai_scene_terminal_v1' }), 'DRAFT_FORMAT');
  assert.equal(api.inspectWorkflow(root).plans[0].status, 'planned');
});
test('plans bind reviewed revisions, request bytes and declared size/image/alpha capabilities before reservation', t => {
  const { root, kit } = setup(t); const { capabilities } = prepare(root), plan = referencePlan(root, capabilities);
  assert.equal(api.getGenerationPlan(root, plan.sha256).sha256, plan.sha256); assert.ok(Object.isFrozen(plan.request));
  rejects(() => api.authorizePlan(root, plan.sha256, decision('wrong', 'f'.repeat(64), 'approve-compute')), 'AUTHORIZATION_STATE');
  const noSize = api.createDesignDraft(root, { ...capabilitiesDraft(), capabilityId: 'no.size', exactSize: false });
  rejects(() => referencePlan(root, noSize, 'invalid.size'), 'CAPABILITY_SIZE_UNSUPPORTED');
  complete(root, plan, bytesFor('terrain-000'));
  const noAlpha = api.createDesignDraft(root, { ...capabilitiesDraft(), capabilityId: 'no.alpha', transparentBackground: false });
  const before = api.inspectWorkflow(root);
  rejects(() => api.freezeModuleBatch(root, kit, { batchId: 'bad', referencePlanSha256: plan.sha256, capabilitiesSha256: noAlpha.sha256, intent: '' }), 'CAPABILITY_ALPHA_UNSUPPORTED');
  assert.deepEqual(api.inspectWorkflow(root), before, 'failed batch preflight appends no partial inventory/plans');
  const longBatch = api.freezeModuleBatch(root, kit, { batchId: 'a'.repeat(100), referencePlanSha256: plan.sha256, capabilitiesSha256: capabilities.sha256, intent: '' });
  assert.equal(longBatch.planSha256s.length, 49);
  assert.ok(api.getGenerationPlan(root, longBatch.planSha256s[0]).recipe.planId.length <= 100, 'derived IDs preserve the full public identifier length range');
});
test('technical reception is distinct from exact-image review and reference acceptance grants no module compute', t => {
  const { root, kit } = setup(t); const { capabilities } = prepare(root), plan = referencePlan(root, capabilities);
  const ticket = authorizeAndReserve(root, plan), result = api.receiveResult(root, ticket, bytesFor('terrain-000'));
  assert.equal(result.technical.status, 'pass'); assert.equal(result.technical.visualAcceptance, 'not-assessed');
  const options = { batchId: 'modules', referencePlanSha256: plan.sha256, capabilitiesSha256: capabilities.sha256, intent: '' };
  rejects(() => api.freezeModuleBatch(root, kit, options), 'ACCEPTED_REFERENCE_REQUIRED');
  rejects(() => api.reviewResult(root, plan.sha256, decision('wrong.image', 'f'.repeat(64))), 'IMAGE_REVIEW_STATE');
  api.reviewResult(root, plan.sha256, decision('reference.image', result.rawSha256));
  const batch = api.freezeModuleBatch(root, kit, options);
  assert.equal(batch.maximumImageRequests, 49); assert.equal(batch.newImageRequests, 49);
  assert.equal(api.inspectModuleBatch(root, batch.sha256).requiredTerrainRoleCount, 47);
  rejects(() => api.reservePlan(root, batch.planSha256s[0]), 'AUTHORIZATION_REQUIRED');
  assert.ok(api.inspectWorkflow(root).plans.filter(plan => plan.stage === 'module').every(plan => plan.status === 'planned'));
});
for (const [name, bytes, issue] of [
  ['unsupported PNG', Buffer.from('not a PNG'), 'OUTPUT_PNG_UNSUPPORTED'],
  ['wrong size', encodeFixturePng(1, 1, Buffer.from([20, 30, 40, 255])), 'OUTPUT_SIZE'],
  ['transparent reference', bytesFor('environment-marker'), 'OUTPUT_NOT_OPAQUE'],
  ['uniform reference', encodeFixturePng(64, 64, Buffer.alloc(64 * 64 * 4, 255)), 'REFERENCE_BLANK'],
]) test(`rejected ${name} retains exact raw bytes and cannot be accepted or resubmitted`, t => {
  const { root } = setup(t); const { capabilities } = prepare(root), plan = referencePlan(root, capabilities);
  const ticket = authorizeAndReserve(root, plan), result = api.receiveResult(root, ticket, bytes);
  assert.ok(result.technical.issues.includes(issue));
  assert.deepEqual(readFileSync(join(root, 'blobs', `${result.rawSha256}.bin`)), bytes);
  assert.equal(api.recheckResult(root, plan.sha256, result.rawSha256).sha256, result.technical.sha256);
  rejects(() => api.reviewResult(root, plan.sha256, decision('invalid.accept', result.rawSha256)), 'IMAGE_REVIEW_STATE');
  rejects(() => api.reservePlan(root, plan.sha256), 'RESERVATION_STATE');
  assert.equal(api.inspectWorkflow(root).plans[0].status, 'rejected-technical');
});
test('unknown is terminal; a revision needs new plan/confirmation and never changes its predecessor', t => {
  const { root } = setup(t); const { capabilities } = prepare(root), plan = referencePlan(root, capabilities);
  const ticket = authorizeAndReserve(root, plan); api.recordSubmission(root, ticket); api.stopAttempt(root, ticket, 'indeterminate');
  rejects(() => api.reservePlan(root, plan.sha256), 'RESERVATION_STATE');
  rejects(() => api.receiveResult(root, ticket, bytesFor('terrain-000')), 'ATTEMPT_NOT_PENDING');
  rejects(() => api.authorizePlan(root, plan.sha256, decision('again', plan.sha256, 'approve-compute')), 'AUTHORIZATION_STATE');
  const revised = api.reviseGenerationPlan(root, plan.sha256, { planId: 'reference.r2', capabilitiesSha256: capabilities.sha256, intent: 'Explicit synthetic revision.' });
  assert.notEqual(revised.sha256, plan.sha256); rejects(() => api.reservePlan(root, revised.sha256), 'AUTHORIZATION_REQUIRED');
  complete(root, revised, bytesFor('terrain-000'));
  assert.deepEqual(api.inspectWorkflow(root).plans.map(plan => plan.status), ['indeterminate', 'accepted']);
});
test('style revisions invalidate undispatched plans but allow historical raw results and reviews to be retained', t => {
  const { root, kit } = setup(t); const { capabilities } = prepare(root), plan = referencePlan(root, capabilities);
  const ticket = authorizeAndReserve(root, plan);
  const next = api.createDesignDraft(root, { ...styleDraft(), styleId: 'style.r2', rules: ['Synthetic revised palette.'] });
  api.reviewDesign(root, 'style', decision('style.r2', next.sha256));
  const result = api.receiveResult(root, ticket, bytesFor('terrain-000'));
  api.reviewResult(root, plan.sha256, decision('historical.review', result.rawSha256));
  assert.equal(api.inspectWorkflow(root).plans[0].current, false);
  rejects(() => api.freezeModuleBatch(root, kit, { batchId: 'stale', referencePlanSha256: plan.sha256, capabilitiesSha256: capabilities.sha256, intent: '' }), 'ACCEPTED_REFERENCE_REQUIRED');
});
test('two concurrent processes expose at most one exchange request for one confirmation', { timeout: 20000 }, async t => {
  const { root } = setup(t); const { capabilities } = prepare(root), plan = referencePlan(root, capabilities);
  api.authorizePlan(root, plan.sha256, decision('race.compute', plan.sha256, 'approve-compute'));
  const program = `import { reservePlan } from ${JSON.stringify(new URL('../src/generation/index.mjs', import.meta.url).href)};try{reservePlan(process.argv[1],process.argv[2]);console.log('reserved')}catch(e){console.log(e.errors?.[0]?.code)}`;
  const results = await Promise.all([1, 2].map(() => promisify(execFile)(process.execPath, ['--input-type=module', '-e', program, root, plan.sha256], { timeout: 10000 })));
  assert.equal(results.filter(result => result.stdout.trim() === 'reserved').length, 1);
  assert.ok(results.some(result => /WORKFLOW_BUSY|RESERVATION_STATE/.test(result.stdout)));
  assert.equal(api.inspectWorkflow(root).plans.filter(plan => plan.reserved).length, 1);
});
test('a hash-rebound forged request cannot bypass deterministic plan replay', t => {
  const { root } = setup(t); const { capabilities } = prepare(root); referencePlan(root, capabilities);
  const files = readdirSync(join(root, 'events')).sort(); let previousSha256 = JSON.parse(readFileSync(join(root, 'workflow.json'))).sha256;
  for (const file of files) {
    const event = JSON.parse(readFileSync(join(root, 'events', file)));
    if (event.record.format === 'ai_scene_generation_plan_v1') {
      const { sha256: _ignored, ...body } = event.record; body.request.prompt += '\nforged'; event.record = seal(body);
    }
    const { sha256: _ignored, ...body } = event; body.previousSha256 = previousSha256;
    const rebound = seal(body); previousSha256 = rebound.sha256; writeFileSync(join(root, 'events', file), jsonBytes(rebound));
  }
  rejects(() => api.inspectWorkflow(root), 'PLAN_RECOMPILE_MISMATCH');
});
test('crash locks fail closed without auto repair', t => {
  const { root } = setup(t); prepare(root);
  writeFileSync(join(root, '.lock'), 'synthetic crash', { flag: 'wx' });
  rejects(() => api.inspectWorkflow(root), 'WORKFLOW_BUSY'); assert.ok(existsSync(join(root, '.lock')));
});
test('original blob tampering and linked blob directories are rejected', t => {
  const { root, parent } = setup(t); prepare(root);
  const image = api.importWorkflowImage(root, bytesFor('background-strip'));
  const path = join(root, 'blobs', `${image.sha256}.bin`), original = readFileSync(path);
  writeFileSync(path, Buffer.from('tampered'));
  rejects(() => api.inspectWorkflow(root), 'BLOB_INTEGRITY'); writeFileSync(path, original);
  renameSync(join(root, 'blobs'), join(parent, 'preserved-blobs'));
  try { symlinkSync(join(parent, 'preserved-blobs'), join(root, 'blobs'), 'junction'); }
  catch (error) { if (['EPERM', 'EACCES'].includes(error.code)) return t.skip('OS does not permit creating the junction fixture'); throw error; }
  rejects(() => api.inspectWorkflow(root), 'WORKFLOW_PATH');
  assert.deepEqual(readFileSync(join(parent, 'preserved-blobs', `${image.sha256}.bin`)), original);
});
test('a newly accepted style prevents spending a previously frozen authorization', t => {
  const { root } = setup(t); const { capabilities } = prepare(root), plan = referencePlan(root, capabilities);
  api.authorizePlan(root, plan.sha256, decision('old.compute', plan.sha256, 'approve-compute'));
  const style = api.createDesignDraft(root, { ...styleDraft(), styleId: 'new.style' });
  api.reviewDesign(root, 'style', decision('new.style.review', style.sha256));
  rejects(() => api.reservePlan(root, plan.sha256), 'PLAN_STALE');
  assert.equal(api.inspectWorkflow(root).plans[0].reserved, false);
});
test('a visual rejection cannot be overwritten by another decision on the same image', t => {
  const { root } = setup(t); const { capabilities } = prepare(root), plan = referencePlan(root, capabilities);
  const result = api.receiveResult(root, authorizeAndReserve(root, plan), bytesFor('terrain-000'));
  api.reviewResult(root, plan.sha256, decision('visual.reject', result.rawSha256, 'reject'));
  rejects(() => api.reviewResult(root, plan.sha256, decision('overwrite.accept', result.rawSha256)), 'IMAGE_REVIEW_STATE');
  assert.equal(api.inspectWorkflow(root).plans[0].status, 'rejected-visual');
});
test('opaque environment output and reused terrain artwork cannot become a complete module set', t => {
  const { root, kit } = setup(t); const { capabilities } = prepare(root), reference = referencePlan(root, capabilities);
  complete(root, reference, bytesFor('terrain-000'));
  const batch = api.freezeModuleBatch(root, kit, { batchId: 'invalid.outputs', referencePlanSha256: reference.sha256, capabilitiesSha256: capabilities.sha256, intent: '' });
  const plans = batch.planSha256s.map(sha256 => api.getGenerationPlan(root, sha256));
  const environment = plans.find(plan => plan.target.kind === 'environment');
  const result = api.receiveResult(root, authorizeAndReserve(root, environment), bytesFor('terrain-000'));
  assert.ok(result.technical.issues.includes('OUTPUT_ALPHA_REQUIRED'));
  for (const terrain of plans.filter(plan => plan.target.kind === 'terrain').slice(0, 2)) complete(root, terrain, bytesFor('terrain-000'));
  assert.ok(api.inspectModuleBatch(root, batch.sha256).issues.some(issue => issue.code === 'TERRAIN_ART_REUSED'));
});
test('CLI planning and inspection stay offline and redact selected paths', async t => {
  const { parent } = setup(t), root = join(parent, 'cli-workflow');
  const { fileURLToPath } = await import('node:url');
  const script = fileURLToPath(new URL('../scripts/workflow.mjs', import.meta.url));
  const invoke = args => promisify(execFile)(process.execPath, [script, ...args], { timeout: 15000 });
  const init = JSON.parse((await invoke(['init', '--root', root, '--id', 'cli.fixture', '--purpose', 'synthetic-simulation'])).stdout);
  assert.equal(init.coreProviderCalls, 0);
  const draft = join(parent, 'draft.json'); writeFileSync(draft, jsonBytes(specDraft()));
  const spec = JSON.parse((await invoke(['draft', '--root', root, '--file', draft])).stdout).result;
  const inspect = JSON.parse((await invoke(['inspect', '--root', root])).stdout);
  assert.deepEqual(inspect.result.plans, []); assert.ok(!JSON.stringify(inspect).includes(parent));
  await assert.rejects(invoke(['inspect', '--root', root, '--unknown', 'x']), error => error.code === 2 && !error.stderr.includes(parent));
  const style = api.createDesignDraft(root, styleDraft()), capabilities = api.createDesignDraft(root, capabilitiesDraft());
  api.reviewDesign(root, 'spec', decision('cli.spec', spec.sha256)); api.reviewDesign(root, 'style', decision('cli.style', style.sha256));
  const plan = referencePlan(root, capabilities), receiptFile = join(parent, 'compute.json');
  writeFileSync(receiptFile, jsonBytes(decision('cli.compute', plan.sha256, 'approve-compute')));
  const authorization = JSON.parse((await invoke(['authorize', '--root', root, '--plan', plan.sha256, '--file', receiptFile])).stdout);
  assert.ok(!JSON.stringify(authorization).includes('nonce'));
  const reservation = JSON.parse((await invoke(['reserve', '--root', root, '--plan', plan.sha256])).stdout).result;
  assert.equal(reservation.request.maximumCalls, 1);
  await assert.rejects(invoke(['reserve', '--root', root, '--plan', plan.sha256]), error => error.code === 1);
  const ticketFile = join(parent, 'ticket.json'), imageFile = join(parent, 'result.png');
  writeFileSync(ticketFile, jsonBytes(reservation.ticket)); writeFileSync(imageFile, bytesFor('terrain-000'));
  const received = JSON.parse((await invoke(['receive', '--root', root, '--ticket', ticketFile, '--file', imageFile])).stdout);
  assert.equal(received.result.technical.status, 'pass');
  assert.equal(api.inspectWorkflow(root).plans[0].status, 'pending-visual-review');
});
test('all 49 module outputs close their evidence graph; one explicit revision reuses the other 48', { timeout: 120000 }, t => {
  const { root, kit } = setup(t); const { capabilities } = prepare(root), reference = referencePlan(root, capabilities);
  complete(root, reference, bytesFor('terrain-000'));
  const batch = api.freezeModuleBatch(root, kit, { batchId: 'full', referencePlanSha256: reference.sha256, capabilitiesSha256: capabilities.sha256, intent: 'Synthetic module exchange.' });
  const first = api.getGenerationPlan(root, batch.planSha256s[0]);
  const ticket = authorizeAndReserve(root, first); api.stopAttempt(root, ticket, 'indeterminate');
  const revised = api.reviseGenerationPlan(root, first.sha256, { planId: 'full.revised', capabilitiesSha256: capabilities.sha256, intent: 'Explicit fixture revision.' });
  const replacement = api.reviseModuleBatch(root, batch.sha256, { batchId: 'full.r2', replacements: [{ assetId: first.recipe.assetId, planSha256: revised.sha256 }] });
  assert.equal(replacement.maximumImageRequests, 49); assert.equal(replacement.newImageRequests, 1);
  for (const sha256 of replacement.planSha256s) {
    const plan = api.getGenerationPlan(root, sha256); complete(root, plan, bytesFor(plan.recipe.assetId));
  }
  const ready = api.inspectModuleBatch(root, replacement.sha256);
  assert.equal(ready.status, 'individual-reviews-recorded'); assert.equal(ready.reviewedTerrainRoleCount, 47); assert.deepEqual(ready.issues, []);
  assert.equal(ready.packageAssembly, 'not-run'); assert.equal(ready.packageVisualAcceptance, 'not-assessed');
  assert.equal(api.inspectModuleBatch(root, batch.sha256).status, 'incomplete-or-stale');
  assert.equal(api.inspectWorkflow(root).plans.filter(plan => plan.reserved).length, 51);
  assert.equal(api.inspectWorkflow(root).coreProviderCalls, 0);
  assert.ok(!JSON.stringify(ready).includes('nonce'));
});
