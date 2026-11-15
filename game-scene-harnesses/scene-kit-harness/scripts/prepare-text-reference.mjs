import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeFreshDirectory, parseJson, readSelectedFile, writeFreshFile } from '../src/files.mjs';
import { check, exact, jsonBytes } from '../src/generation/common.mjs';
import * as workflow from '../src/generation/index.mjs';

const packageRoot = fileURLToPath(new URL('../', import.meta.url));
try {
  const args = process.argv.slice(2);
  check(args.length === 4 && args[0] === '--inputs' && args[2] === '--out', 'ARGUMENTS');
  const read = name => parseJson(readSelectedFile(join(args[1], `${name}.json`)));
  const specInput = read('spec'), styleInput = read('style'), capabilitiesInput = read('capabilities'), options = read('reference-options');
  exact(options, ['planId', 'parents', 'pixelPolicy', 'intent']);
  check(specInput.inputs?.length === 0 && styleInput.anchors?.length === 0, 'TEXT_ONLY_PREPARATION');
  const output = makeFreshDirectory(args[3], packageRoot), root = join(output, 'workflow');
  workflow.initWorkflow(root, { projectId: options.planId, purpose: 'external-exchange', compiler: 'scene-kit-native-reference-v2' });
  const spec = workflow.createDesignDraft(root, specInput), style = workflow.createDesignDraft(root, styleInput);
  const capabilities = workflow.createDesignDraft(root, capabilitiesInput);
  const freezeOptions = { ...options, capabilitiesSha256: capabilities.sha256 };
  const proposalOptions = { specSha256: spec.sha256, styleSha256: style.sha256, capabilitiesSha256: capabilities.sha256,
    pixelPolicy: options.pixelPolicy, intent: options.intent };
  const proposal = workflow.previewNativeReference(root, proposalOptions);
  const report = { format: 'ai_scene_text_reference_preparation_v1', status: 'awaiting-design-review',
    specSha256: spec.sha256, styleSha256: style.sha256, capabilitiesSha256: capabilities.sha256, proposalSha256: proposal.sha256,
    proposedMaximumImageRequests: 1, frozenPlans: 0, computeAuthorizations: 0, reservedAttempts: 0,
    actualMediaGenerationCalls: 0, humanVisualReview: 'not-run', visualAcceptance: 'not-assessed' };
  for (const [name, value] of Object.entries({ 'spec-draft': spec, 'style-draft': style, 'capabilities-draft': capabilities,
    'proposal-options': proposalOptions, 'freeze-options': freezeOptions, proposal, 'preparation-report': report })) {
    writeFreshFile(join(output, `${name}.json`), jsonBytes(value), packageRoot);
  }
  writeFreshFile(join(output, 'reference-prompt.txt'), Buffer.from(`${proposal.request.prompt}\n`), packageRoot);
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  console.error(JSON.stringify({ ok: false, code: error.errors?.[0]?.code ?? 'PREPARATION_FAILED',
    message: 'Text reference preparation failed; retain partial evidence and choose no automatic overwrite or generation' }));
  process.exitCode = 1;
}
