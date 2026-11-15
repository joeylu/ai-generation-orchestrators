import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseJson, readSelectedFile } from '../src/files.mjs';
import { check } from '../src/generation/common.mjs';
import * as standard from '../src/standard-pipeline.mjs';
import * as flow from '../src/generation/index.mjs';
import { buildCompositionProposal, verifyCompositionProposal } from '../src/composition-planner.mjs';

const help = `Standard side-view reference workflow; uploads provide style only.
  init --brief FILE --out NEW_DIRECTORY
  init-composed --brief FILE --out NEW_DIRECTORY
  compose|verify-composition --intent FILE --out DIRECTORY
  input-experiment-preview|input-experiment-plan --root DIRECTORY --options FILE
  inspect --root DIRECTORY
  preview|verify-preview --root DIRECTORY --out DIRECTORY
  design --root DIRECTORY --decisions FILE
  plan --root DIRECTORY --options FILE
  authorize --root DIRECTORY --decision FILE
  run --root DIRECTORY --adapter-module FILE
  run --root DIRECTORY --adapter codex [--codex-bin EXECUTABLE]
  assess|verify-assessment --root DIRECTORY --observation FILE --out DIRECTORY
  review --root DIRECTORY --observation FILE --decision FILE
  reject --root DIRECTORY --decision FILE
  stop-unknown --root DIRECTORY
  target --root DIRECTORY --out NEW_DIRECTORY
Only run invokes the explicitly selected image adapter. No automatic retry.
Acceptance targets the alignment review packet, not just the raw PNG.
Faithful asset extraction/recomposition is not implemented by this entry point.`;
try {
  const [command, ...args] = process.argv.slice(2);
  if (!command || command === '--help') console.log(help);
  else {
    const options = {};
    for (let i = 0; i < args.length; i += 2) {
      check(/^--[a-z-]+$/.test(args[i]) && args[i + 1] && !Object.hasOwn(options, args[i]), 'STANDARD_ARGUMENTS');
      options[args[i]] = args[i + 1];
    }
    const fields = { init: ['--brief', '--out'], 'init-composed': ['--brief', '--out'], compose: ['--intent', '--out'],
      'input-experiment-preview': ['--root', '--options'], 'input-experiment-plan': ['--root', '--options'],
      'verify-composition': ['--intent', '--out'], target: ['--root', '--out'], inspect: ['--root'], preview: ['--root', '--out'], 'verify-preview': ['--root', '--out'],
      design: ['--root', '--decisions'], plan: ['--root', '--options'], authorize: ['--root', '--decision'],
      run: ['--root', '--adapter', '--adapter-module', '--codex-bin'], assess: ['--root', '--observation', '--out'],
      'verify-assessment': ['--root', '--observation', '--out'], review: ['--root', '--observation', '--decision'],
      reject: ['--root', '--decision'], 'stop-unknown': ['--root'] };
    check(fields[command] && Object.keys(options).every(key => fields[command].includes(key)), 'STANDARD_ARGUMENTS');
    check(command === 'run' ? options['--root'] && Boolean(options['--adapter']) !== Boolean(options['--adapter-module'])
      && (!options['--adapter'] || options['--adapter'] === 'codex') && (!options['--codex-bin'] || options['--adapter'] === 'codex')
      : fields[command].every(key => options[key]), 'STANDARD_ARGUMENTS');
    const read = key => parseJson(readSelectedFile(options[key])), root = options['--root']; let result;
    switch (command) {
      case 'init': result = standard.initStandardReference(options['--out'], read('--brief')); break;
      case 'init-composed': result = standard.initComposedReference(options['--out'], read('--brief')); break;
      case 'compose': result = buildCompositionProposal(read('--intent'), options['--out']); break;
      case 'verify-composition': result = verifyCompositionProposal(read('--intent'), options['--out']); break;
      case 'target': result = standard.exportReconstructionTarget(root, options['--out']); break;
      case 'input-experiment-preview':
      case 'input-experiment-plan': {
        standard.inspectStandardReference(root);
        result = command === 'input-experiment-preview' ? flow.previewReferenceInputExperiment(join(root, 'workflow'), read('--options'))
          : flow.freezeReferenceInputExperiment(join(root, 'workflow'), read('--options')); break;
      }
      case 'inspect': result = standard.inspectStandardReference(root); break;
      case 'preview': result = standard.previewStandardReference(root, options['--out']); break;
      case 'verify-preview': result = standard.verifyStandardPreview(root, options['--out']); break;
      case 'design': result = standard.reviewStandardDesign(root, read('--decisions')); break;
      case 'plan': result = standard.planStandardReference(root, read('--options')); break;
      case 'authorize': result = standard.authorizeStandardReference(root, read('--decision')); break;
      case 'assess': result = standard.assessStandardReference(root, read('--observation'), options['--out']); break;
      case 'verify-assessment': result = standard.verifyStandardAssessment(root, read('--observation'), options['--out']); break;
      case 'review': result = standard.reviewStandardImage(root, read('--observation'), read('--decision')); break;
      case 'reject': {
        const decision = read('--decision'), state = standard.inspectStandardReference(root);
        check(decision.decision === 'reject' && state.reference, 'STANDARD_REJECTION');
        flow.reviewResult(join(root, 'workflow'), state.reference.planSha256, decision); result = standard.inspectStandardReference(root); break;
      }
      case 'stop-unknown': {
        const state = standard.inspectStandardReference(root), workflow = join(root, 'workflow');
        check(state.reference, 'PLAN_MISSING');
        flow.stopAttempt(workflow, flow.getPendingGenerationTicket(workflow, state.reference.planSha256), 'indeterminate');
        result = standard.inspectStandardReference(root); break;
      }
      case 'run': {
        let adapter;
        if (options['--adapter'] === 'codex') {
          const { createSceneCodexAdapter } = await import('../adapters/codex.mjs');
          adapter = await createSceneCodexAdapter({ workspace: join(resolve(root), 'private-transport'),
            ...(options['--codex-bin'] ? { executable: options['--codex-bin'] } : {}) });
        } else {
          const module = await import(pathToFileURL(resolve(options['--adapter-module'])).href);
          check(typeof module.createAdapter === 'function', 'PIPELINE_ADAPTER_REQUIRED');
          adapter = await module.createAdapter({ workspace: join(resolve(root), 'private-transport') });
        }
        result = await standard.runStandardReference(root, adapter); break;
      }
    }
    console.log(JSON.stringify(result, null, 2));
  }
} catch (error) {
  console.error(JSON.stringify({ ok: false, code: error.errors?.[0]?.code ?? 'STANDARD_OPERATION_FAILED',
    message: 'Operation stopped. Preserve the original image and attempt evidence; no automatic submission or retry.' }));
  process.exitCode = 1;
}
