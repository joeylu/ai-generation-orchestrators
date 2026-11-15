import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseJson, readSelectedFile, makeFreshDirectory, writeFreshFile } from '../src/files.mjs';
import { check, jsonBytes, seal } from '../src/generation/common.mjs';
import * as pipeline from '../src/pipeline.mjs';
import { getGenerationResult, getGenerationPlan, getPendingGenerationTicket, stopAttempt } from '../src/generation/index.mjs';

const help = `Scene Kit local generation pipeline (no compute in init/inspect/advance/plans).
  init --brief FILE --out NEW_DIRECTORY
  inspect|advance|plans --root DIRECTORY
  design --root DIRECTORY --decisions FILE
  authorize --root DIRECTORY --decision FILE
  run --root DIRECTORY --adapter codex [--codex-bin EXECUTABLE]
  doctor --root DIRECTORY --adapter codex
  run --root DIRECTORY --adapter-module FILE
  review --root DIRECTORY --plan SHA256 --decision FILE
  review-set --root DIRECTORY --out NEW_DIRECTORY
  deliver --root DIRECTORY --out NEW_DIRECTORY
  stop-unknown --root DIRECTORY --plan SHA256
  revise-sources --root DIRECTORY --options FILE
  revise-reference --root DIRECTORY --options FILE
Reference and source-batch authorization are separate, exact-digest human decisions.
Unknown/failed attempts never retry; source/art/geometry reviews are not compute approval.`;
try {
  const [command, ...args] = process.argv.slice(2);
  if (!command || command === '--help') { console.log(help); }
  else {
    const options = {};
    for (let i = 0; i < args.length; i += 2) {
      check(/^--[a-z-]+$/.test(args[i]) && args[i + 1] && !Object.hasOwn(options, args[i]), 'PIPELINE_ARGUMENTS'); options[args[i]] = args[i + 1];
    }
    const fields = { init: ['--brief', '--out'], inspect: ['--root'], advance: ['--root'], plans: ['--root'],
      design: ['--root', '--decisions'], authorize: ['--root', '--decision'], review: ['--root', '--plan', '--decision'],
      'review-set': ['--root', '--out'], deliver: ['--root', '--out'], 'stop-unknown': ['--root', '--plan'],
      'revise-sources': ['--root', '--options'], 'revise-reference': ['--root', '--options'],
      run: ['--root', '--adapter', '--adapter-module', '--codex-bin'], doctor: ['--root', '--adapter', '--adapter-module', '--codex-bin'] };
    check(fields[command] && Object.keys(options).every(k => fields[command].includes(k)), 'PIPELINE_ARGUMENTS');
    check(['run', 'doctor'].includes(command) ? options['--root'] && Boolean(options['--adapter']) !== Boolean(options['--adapter-module'])
      && (!options['--adapter'] || options['--adapter'] === 'codex') && (!options['--codex-bin'] || options['--adapter'] === 'codex')
      : fields[command].every(k => options[k]), 'PIPELINE_ARGUMENTS');
    const read = name => parseJson(readSelectedFile(options[name]));
    const root = options['--root']; let result;
    switch (command) {
      case 'init': result = pipeline.initScenePipeline(options['--out'], read('--brief')); break;
      case 'inspect': result = pipeline.inspectScenePipeline(root); break;
      case 'advance': result = pipeline.advanceScenePipeline(root); break;
      case 'plans': result = pipeline.pipelinePlans(root); break;
      case 'design': result = pipeline.reviewPipelineDesign(root, read('--decisions')); break;
      case 'authorize': result = pipeline.authorizePipelineStage(root, read('--decision')); break;
      case 'review': result = pipeline.reviewPipelineImage(root, options['--plan'], read('--decision')); break;
      case 'deliver': result = pipeline.deliverScenePipeline(root, options['--out']); break;
      case 'revise-sources': result = pipeline.revisePipelineSources(root, read('--options')); break;
      case 'revise-reference': result = pipeline.revisePipelineReference(root, read('--options')); break;
      case 'stop-unknown': stopAttempt(join(root, 'workflow'), getPendingGenerationTicket(join(root, 'workflow'), options['--plan']), 'indeterminate'); result = pipeline.inspectScenePipeline(root); break;
      case 'doctor':
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
        if (command === 'doctor') { await adapter.preflight(); result = { status: 'adapter-ready', generationCalls: 0, automaticRetry: false }; }
        else result = await pipeline.runScenePipeline(root, adapter, { onProgress: event => process.stderr.write(`${JSON.stringify(event)}\n`) }); break;
      }
      case 'review-set': {
        const status = pipeline.inspectScenePipeline(root), selected = [status.reference, ...status.sources].filter(s => s?.received);
        check(selected.length > 0, 'RESULT_REQUIRED');
        const out = makeFreshDirectory(options['--out'], resolve(root)), entries = [];
        for (const item of selected) {
          const plan = getGenerationPlan(join(root, 'workflow'), item.planSha256), record = getGenerationResult(join(root, 'workflow'), item.planSha256);
          const key = plan.recipe.assetId, png = `${key}.png`;
          writeFreshFile(join(out, png), record.bytes, resolve(root));
          entries.push({ assetId: key, planSha256: item.planSha256, rawSha256: record.result.rawSha256, png, status: item.status, technical: record.result.technical });
        }
        result = seal({ format: 'ai_scene_pipeline_review_set_v1', entries, humanVisualAcceptance: 'not-run' });
        writeFreshFile(join(out, 'review-set.json'), jsonBytes(result), resolve(root)); break;
      }
    }
    console.log(JSON.stringify(result, null, 2));
  }
} catch (error) {
  console.error(JSON.stringify({ ok: false, code: error.errors?.[0]?.code ?? (/^CODEX_[A-Z_]+$/.test(error.message) ? error.message : 'PIPELINE_OPERATION_FAILED'),
    message: 'Operation stopped. Preserve evidence; inspect the frozen plan and attempt. No automatic submission or retry.' }));
  process.exitCode = 1;
}
