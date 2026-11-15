import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseJson, readSelectedFile } from '../src/files.mjs';
import { check } from '../src/generation/common.mjs';
import * as reference from '../src/reference-led-pipeline.mjs';
import * as flow from '../src/generation/index.mjs';
import * as assets from '../src/reference-asset-pipeline.mjs';

const help = `Reference-led default workflow: standards first, actual layout after image review.
  init --brief FILE --out NEW_DIRECTORY
  inspect --root DIRECTORY
  preview|verify-preview --root DIRECTORY --out DIRECTORY
  design --root DIRECTORY --decisions FILE
  plan --root DIRECTORY --options FILE
  preview-isolation|isolation --root DIRECTORY --options FILE
  controls-import --root DIRECTORY --review DIRECTORY --options FILE
  controls-review --root DIRECTORY --control SHA256 --decision FILE
  preview-controlled|controlled --root DIRECTORY --options FILE
  candidate --root DIRECTORY --file PNG --options FILE
  authorize --root DIRECTORY --decision FILE
  run --root DIRECTORY --adapter codex [--codex-bin EXECUTABLE]
  run --root DIRECTORY --adapter-module FILE
  assess|verify-review --root DIRECTORY --analysis FILE --out DIRECTORY
  review --root DIRECTORY --analysis FILE --decision FILE
  reject --root DIRECTORY --decision FILE
  target --root DIRECTORY --out NEW_DIRECTORY
  decompose|verify-decomposition --root DIRECTORY --out DIRECTORY
  ownership|verify-ownership --root DIRECTORY --map NATIVE_LABEL_PNG --out DIRECTORY
  segmentation-seeds|verify-segmentation-seeds --root DIRECTORY --seeds FILE --out DIRECTORY
  segmentation-import|verify-segmentation --root DIRECTORY --seeds FILE --cpu DIRECTORY --out DIRECTORY
  prompt-input|verify-prompt-input --root DIRECTORY --prompts FILE --out DIRECTORY
  prompt-import|verify-prompt --root DIRECTORY --prompts FILE --cpu DIRECTORY --out DIRECTORY
  asset-preview|verify-asset-preview --root DIRECTORY --options FILE --out DIRECTORY
  asset-plan --root DIRECTORY --options FILE
  asset-inspect --root DIRECTORY --batch SHA256
  asset-authorize --root DIRECTORY --batch SHA256 --decision FILE
  asset-run --root DIRECTORY --batch SHA256 --adapter-module FILE
  asset-proof|verify-asset-proof --root DIRECTORY --batch SHA256 --out DIRECTORY
Only run and asset-run may invoke the selected image adapter after single-use confirmation.
candidate imports exact existing PNG bytes with zero compute; it never accepts art.
Precise-layout workflows remain available through reference:standard.
Asset extraction and faithful recomposition remain unfinished.`;
try {
  const [command, ...args] = process.argv.slice(2);
  if (!command || command === '--help') console.log(help);
  else {
    const opts = {};
    for (let i = 0; i < args.length; i += 2) {
      check(/^--[a-z-]+$/.test(args[i]) && args[i + 1] && !Object.hasOwn(opts, args[i]), 'REFERENCE_ARGUMENTS'); opts[args[i]] = args[i + 1];
    }
    const fields = { init: ['--brief', '--out'], inspect: ['--root'], preview: ['--root', '--out'], 'verify-preview': ['--root', '--out'],
      design: ['--root', '--decisions'], plan: ['--root', '--options'], candidate: ['--root', '--file', '--options'], authorize: ['--root', '--decision'],
      'preview-isolation': ['--root', '--options'], isolation: ['--root', '--options'],
      'controls-import': ['--root', '--review', '--options'], 'controls-review': ['--root', '--control', '--decision'],
      'preview-controlled': ['--root', '--options'], controlled: ['--root', '--options'],
      run: ['--root', '--adapter', '--adapter-module', '--codex-bin'], assess: ['--root', '--analysis', '--out'], 'verify-review': ['--root', '--analysis', '--out'],
      review: ['--root', '--analysis', '--decision'], reject: ['--root', '--decision'], target: ['--root', '--out'],
      decompose: ['--root', '--out'], 'verify-decomposition': ['--root', '--out'],
      ownership: ['--root', '--map', '--out'], 'verify-ownership': ['--root', '--map', '--out'],
      'segmentation-seeds': ['--root', '--seeds', '--out'], 'verify-segmentation-seeds': ['--root', '--seeds', '--out'],
      'segmentation-import': ['--root', '--seeds', '--cpu', '--out'], 'verify-segmentation': ['--root', '--seeds', '--cpu', '--out'],
      'prompt-input': ['--root', '--prompts', '--out'], 'verify-prompt-input': ['--root', '--prompts', '--out'],
      'prompt-import': ['--root', '--prompts', '--cpu', '--out'], 'verify-prompt': ['--root', '--prompts', '--cpu', '--out'],
      'asset-preview': ['--root', '--options', '--out'], 'verify-asset-preview': ['--root', '--options', '--out'],
      'asset-plan': ['--root', '--options'], 'asset-inspect': ['--root', '--batch'], 'asset-authorize': ['--root', '--batch', '--decision'],
      'asset-run': ['--root', '--batch', '--adapter', '--adapter-module', '--codex-bin'],
      'asset-proof': ['--root', '--batch', '--out'], 'verify-asset-proof': ['--root', '--batch', '--out'] };
    check(fields[command] && Object.keys(opts).every(k => fields[command].includes(k)), 'REFERENCE_ARGUMENTS');
    check(['run', 'asset-run'].includes(command) ? opts['--root'] && (command !== 'asset-run' || opts['--batch']) && Boolean(opts['--adapter']) !== Boolean(opts['--adapter-module'])
      && (!opts['--adapter'] || opts['--adapter'] === 'codex') && (!opts['--codex-bin'] || opts['--adapter'] === 'codex')
      : fields[command].every(k => opts[k]), 'REFERENCE_ARGUMENTS');
    const root = opts['--root'], read = key => parseJson(readSelectedFile(opts[key])); let result;
    switch (command) {
      case 'init': result = reference.initReferenceLedProject(opts['--out'], read('--brief')); break;
      case 'inspect': result = reference.inspectReferenceLedProject(root); break;
      case 'preview': result = reference.previewReferenceLedProject(root, opts['--out']); break;
      case 'verify-preview': result = reference.verifyReferenceLedPreview(root, opts['--out']); break;
      case 'design': result = reference.reviewReferenceLedDesign(root, read('--decisions')); break;
      case 'plan': result = reference.planReferenceLedProject(root, read('--options')); break;
      case 'preview-isolation': result = reference.previewReferenceLedIsolationProject(root, read('--options')); break;
      case 'isolation': result = reference.planReferenceLedIsolationProject(root, read('--options')); break;
      case 'controls-import': result = reference.importReferenceControlProject(root, opts['--review'], read('--options')); break;
      case 'controls-review': result = reference.reviewReferenceControlProject(root, opts['--control'], read('--decision')); break;
      case 'preview-controlled': result = reference.previewReferenceControlledProject(root, read('--options')); break;
      case 'controlled': result = reference.planReferenceControlledProject(root, read('--options')); break;
      case 'candidate': result = reference.intakeReferenceLedImage(root, opts['--file'], read('--options')); break;
      case 'authorize': result = reference.authorizeReferenceLedProject(root, read('--decision')); break;
      case 'assess': result = reference.assessReferenceLedImage(root, read('--analysis'), opts['--out']); break;
      case 'verify-review': result = reference.verifyReferenceLedImageReview(root, read('--analysis'), opts['--out']); break;
      case 'review': result = reference.reviewReferenceLedImage(root, read('--analysis'), read('--decision')); break;
      case 'target': result = reference.exportReferenceLedTarget(root, opts['--out']); break;
      case 'decompose': result = reference.buildReferenceDecomposition(root, opts['--out']); break;
      case 'verify-decomposition': result = reference.verifyReferenceDecomposition(root, opts['--out']); break;
      case 'ownership': result = reference.buildVisibleOwnershipReview(root, opts['--map'], opts['--out']); break;
      case 'verify-ownership': result = reference.verifyVisibleOwnershipReview(root, opts['--map'], opts['--out']); break;
      case 'segmentation-seeds': result = reference.buildReferenceSegmentationSeeds(root, read('--seeds'), opts['--out']); break;
      case 'verify-segmentation-seeds': result = reference.verifyReferenceSegmentationSeeds(root, read('--seeds'), opts['--out']); break;
      case 'segmentation-import': result = reference.buildReferenceSegmentationReview(root, read('--seeds'), opts['--cpu'], opts['--out']); break;
      case 'verify-segmentation': result = reference.verifyReferenceSegmentationReview(root, read('--seeds'), opts['--cpu'], opts['--out']); break;
      case 'prompt-input': result = reference.buildReferencePromptInput(root, read('--prompts'), opts['--out']); break;
      case 'verify-prompt-input': result = reference.verifyReferencePromptInput(root, read('--prompts'), opts['--out']); break;
      case 'prompt-import': result = reference.buildReferencePromptReview(root, read('--prompts'), opts['--cpu'], opts['--out']); break;
      case 'verify-prompt': result = reference.verifyReferencePromptReview(root, read('--prompts'), opts['--cpu'], opts['--out']); break;
      case 'asset-preview': result = assets.buildReferenceAssetProposal(root, read('--options'), opts['--out']); break;
      case 'verify-asset-preview': result = assets.verifyReferenceAssetProposal(root, read('--options'), opts['--out']); break;
      case 'asset-plan': result = assets.freezeReferenceAssetProject(root, read('--options')); break;
      case 'asset-inspect': result = assets.inspectReferenceAssetProject(root, opts['--batch']); break;
      case 'asset-authorize': result = assets.authorizeReferenceAssetProject(root, opts['--batch'], read('--decision')); break;
      case 'asset-proof': result = assets.buildReferenceAssetProof(root, opts['--batch'], opts['--out']); break;
      case 'verify-asset-proof': result = assets.verifyReferenceAssetProof(root, opts['--batch'], opts['--out']); break;
      case 'reject': {
        const status = reference.inspectReferenceLedProject(root), receipt = read('--decision');
        check(status.reference && receipt.decision === 'reject', 'REFERENCE_REJECTION');
        flow.reviewResult(join(root, 'workflow'), status.reference.planSha256, receipt); result = reference.inspectReferenceLedProject(root); break;
      }
      case 'run':
      case 'asset-run': {
        let adapter;
        if (opts['--adapter'] === 'codex') {
          const { createSceneCodexAdapter } = await import('../adapters/codex.mjs');
          adapter = await createSceneCodexAdapter({ workspace: join(resolve(root), 'private-transport'), ...(opts['--codex-bin'] ? { executable: opts['--codex-bin'] } : {}) });
        } else {
          const module = await import(pathToFileURL(resolve(opts['--adapter-module'])).href);
          check(typeof module.createAdapter === 'function', 'PIPELINE_ADAPTER_REQUIRED'); adapter = await module.createAdapter({ workspace: join(resolve(root), 'private-transport') });
        }
        result = command === 'asset-run' ? await assets.runReferenceAssetProject(root, opts['--batch'], adapter)
          : await reference.runReferenceLedProject(root, adapter); break;
      }
    }
    console.log(JSON.stringify(result, null, 2));
  }
} catch (error) {
  console.error(JSON.stringify({ ok: false, code: error.errors?.[0]?.code ?? 'REFERENCE_OPERATION_FAILED',
    message: 'Operation stopped; preserve original bytes and evidence. No automatic generation, retry, or art acceptance.' })); process.exitCode = 1;
}
