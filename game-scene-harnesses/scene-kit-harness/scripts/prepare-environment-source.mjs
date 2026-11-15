import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as workflow from '../src/generation/index.mjs';
import { isWithin, makeFreshDirectory, parseJson, readSelectedFile, writeFreshFile } from '../src/files.mjs';
import { check, digest, exact, jsonBytes, seal } from '../src/generation/common.mjs';

const sourceRoot = fileURLToPath(new URL('../', import.meta.url));
try {
  const args = process.argv.slice(2), keys = ['--root', '--reference', '--capabilities', '--file', '--out'], options = {};
  check(args.length === keys.length * 2, 'ARGUMENTS');
  for (let i = 0; i < args.length; i += 2) {
    check(keys.includes(args[i]) && !Object.hasOwn(options, args[i]) && args[i + 1], 'ARGUMENTS'); options[args[i]] = args[i + 1];
  }
  const definition = parseJson(readSelectedFile(options['--file']));
  exact(definition, ['planId', 'assetId', 'role', 'sourcePolicy', 'derivation', 'intent']);
  const root = resolve(options['--root']); check(!isWithin(root, resolve(options['--out'])), 'OUTPUT_OVERLAP');
  const output = makeFreshDirectory(options['--out'], sourceRoot);
  const plan = workflow.freezeEnvironmentSourcePlanV2(root, { ...definition, parents: [], referencePlanSha256: options['--reference'],
    capabilitiesSha256: options['--capabilities'] });
  const report = seal({ format: 'ai_scene_environment_preparation_v1', status: 'awaiting-compute-confirmation',
    planSha256: plan.sha256, requestSha256: digest(plan.request), acceptedReferenceRawSha256: plan.referenceEvidence[0].rawSha256,
    assetId: plan.target.assetId, role: plan.target.role, alpha: plan.target.alpha, profileSha256: plan.target.profileSha256,
    maximumNewImageRequests: 1, newComputeAuthorizations: 0, newReservedAttempts: 0, actualNewMediaGenerationCalls: 0,
    derivedProof: 'not-run', productionKit: false, visualAcceptance: 'not-assessed' });
  for (const [name, value] of Object.entries({ 'frozen-environment-plan': plan, 'processing-profile': plan.profile, 'plan-ready-report': report }))
    writeFreshFile(join(output, `${name}.json`), jsonBytes(value), sourceRoot);
  writeFreshFile(join(output, 'environment-prompt.txt'), Buffer.from(`${plan.request.prompt}\n`), sourceRoot);
  writeFreshFile(join(output, 'accepted-style-reference.png'), workflow.readGenerationInput(root, plan.sha256, 0), sourceRoot);
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  console.error(JSON.stringify({ ok: false, code: error.errors?.[0]?.code ?? 'PREPARATION_FAILED',
    message: 'Environment preparation failed; retain partial evidence and inspect; never overwrite or automatically generate' }));
  process.exitCode = 1;
}
