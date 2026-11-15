import * as workflow from '../src/generation/index.mjs';
import { loadSceneKit } from '../src/kit.mjs';
import { readSelectedFile, parseJson } from '../src/files.mjs';
import { demand, InvalidKit } from '../src/errors.mjs';

const shapes = {
  init: ['--root', '--id', '--purpose'],
  'init-native': ['--root', '--id', '--purpose'],
  'import-image': ['--root', '--file'], draft: ['--root', '--file'],
  'review-design': ['--root', '--kind', '--file'],
  'plan-reference': ['--root', '--file'],
  'preview-native-reference': ['--root', '--file'], 'plan-native-reference': ['--root', '--file'],
  'reinspect-reference': ['--root', '--file'],
  'plan-reference-edit': ['--root', '--file'],
  'plan-terrain-material': ['--root', '--file'],
  'plan-environment-source': ['--root', '--file'],
  'plan-environment-source-v2': ['--root', '--file'], 'reinspect-environment': ['--root', '--file'],
  'plan-environment-supplement': ['--root', '--file'],
  'propose-environment-padding': ['--root', '--file'],
  'approve-environment-padding': ['--root', '--proposal', '--file'], 'prepare-environment-padding': ['--root', '--file'],
  'propose-supplement-padding': ['--root', '--file'], 'approve-supplement-padding': ['--root', '--proposal', '--file'],
  'prepare-supplement-padding': ['--root', '--file'],
  'build-environment-proof': ['--root', '--plan', '--out'], 'verify-environment-proof': ['--root', '--plan', '--out'],
  'build-environment-layout-study': ['--root', '--plan', '--file', '--out'],
  'verify-environment-layout-study': ['--root', '--plan', '--file', '--out'],
  'build-finite-environment-demo': ['--root', '--plan', '--kit', '--file', '--out'],
  'verify-finite-environment-demo': ['--root', '--plan', '--kit', '--file', '--out'],
  'build-scene-candidate': ['--root', '--kit', '--file', '--original', '--parent', '--study', '--out'],
  'verify-scene-candidate': ['--root', '--kit', '--file', '--original', '--parent', '--study', '--out'],
  'build-scene-review-candidate': ['--root', '--kit', '--file', '--original', '--parent', '--study', '--out'],
  'verify-scene-review-candidate': ['--root', '--kit', '--file', '--original', '--parent', '--study', '--out'],
  'build-scene-reference-study': ['--root', '--kit', '--file', '--original', '--parent', '--study', '--out'],
  'verify-scene-reference-study': ['--root', '--kit', '--file', '--original', '--parent', '--study', '--out'],
  'build-scene-supplement-study': ['--root', '--kit', '--file', '--original', '--parent', '--study', '--out'],
  'verify-scene-supplement-study': ['--root', '--kit', '--file', '--original', '--parent', '--study', '--out'],
  'build-terrain-proof': ['--root', '--plan', '--out'], 'verify-terrain-proof': ['--root', '--plan', '--out'],
  'revise-terrain-proof': ['--root', '--plan', '--parent', '--out'], 'verify-terrain-proof-revision': ['--root', '--plan', '--parent', '--out'],
  'build-terrain-module-study': ['--root', '--plan', '--original', '--parent', '--out'],
  'verify-terrain-module-study': ['--root', '--plan', '--original', '--parent', '--out'],
  'build-terrain-continuity-study': ['--root', '--plan', '--original', '--parent', '--out'],
  'verify-terrain-continuity-study': ['--root', '--plan', '--original', '--parent', '--out'],
  'build-terrain-long-field-study': ['--root', '--plan', '--original', '--parent', '--baseline', '--out'],
  'verify-terrain-long-field-study': ['--root', '--plan', '--original', '--parent', '--baseline', '--out'],
  'plan-modules': ['--root', '--kit', '--file'],
  'revise-plan': ['--root', '--plan', '--file'], 'revise-batch': ['--root', '--batch', '--file'],
  'get-plan': ['--root', '--plan'], authorize: ['--root', '--plan', '--file'], reserve: ['--root', '--plan'],
  submitted: ['--root', '--ticket'], stop: ['--root', '--ticket', '--outcome'],
  receive: ['--root', '--ticket', '--file'], 'review-image': ['--root', '--plan', '--file'],
  recheck: ['--root', '--plan', '--raw'], inspect: ['--root'], 'inspect-batch': ['--root', '--batch'],
};
const help = 'Scene Kit offline image exchange; no provider adapter or automatic generation.\n'
  + Object.entries(shapes).map(([command, fields]) => `  ${command} ${fields.join(' VALUE ')} VALUE`).join('\n')
  + '\n--file and --ticket select local JSON files, except import-image/receive PNG bytes.\n'
  + 'Review and compute decisions must be explicitly relayed by the human operator; never fabricate them.\n'
  + 'A reservation is single-use even if the external outcome is unknown. Synthetic demos are not human art reviews.';
const args = process.argv.slice(2);
if (args.length === 1 && args[0] === '--help') console.log(help);
else {
  let argumentsPhase = true;
  try {
    const command = args.shift(), options = {};
    demand(Object.hasOwn(shapes, command) && args.length % 2 === 0, 'ARGUMENTS', 'workflow', '/', 'Use --help for exact command options');
    for (let i = 0; i < args.length; i += 2) {
      demand(shapes[command].includes(args[i]) && !Object.hasOwn(options, args[i]) && args[i + 1], 'ARGUMENTS', 'workflow', '/', 'Unknown, repeated or empty option');
      options[args[i]] = args[i + 1];
    }
    demand(shapes[command].every(key => Object.hasOwn(options, key)), 'ARGUMENTS', 'workflow', '/', 'Missing required option');
    argumentsPhase = false;
    const root = options['--root'];
    const input = key => parseJson(readSelectedFile(options[key]), 'workflow-input.json');
    let result;
    switch (command) {
      case 'init': result = workflow.initWorkflow(root, { projectId: options['--id'], purpose: options['--purpose'] }); break;
      case 'init-native': result = workflow.initWorkflow(root, { projectId: options['--id'], purpose: options['--purpose'], compiler: 'scene-kit-native-reference-v2' }); break;
      case 'import-image': result = workflow.importWorkflowImage(root, readSelectedFile(options['--file'], 16777216)); break;
      case 'draft': result = workflow.createDesignDraft(root, input('--file')); break;
      case 'review-design': result = workflow.reviewDesign(root, options['--kind'], input('--file')); break;
      case 'plan-reference': result = workflow.freezeReferencePlan(root, input('--file')); break;
      case 'preview-native-reference': result = workflow.previewNativeReference(root, input('--file')); break;
      case 'plan-native-reference': result = workflow.freezeNativeReferencePlan(root, input('--file')); break;
      case 'reinspect-reference': result = workflow.reinspectNativeReference(root, input('--file')); break;
      case 'plan-reference-edit': result = workflow.freezeNativeReferenceEdit(root, input('--file')); break;
      case 'plan-terrain-material': result = workflow.freezeTerrainMaterialPlan(root, input('--file')); break;
      case 'plan-environment-source': result = workflow.freezeEnvironmentSourcePlan(root, input('--file')); break;
      case 'plan-environment-source-v2': result = workflow.freezeEnvironmentSourcePlanV2(root, input('--file')); break;
      case 'plan-environment-supplement': result = workflow.freezeEnvironmentSupplementPlan(root, input('--file')); break;
      case 'reinspect-environment': result = workflow.reinspectEnvironmentSource(root, input('--file')); break;
      case 'propose-environment-padding': result = workflow.proposeEnvironmentPadding(root, input('--file')); break;
      case 'approve-environment-padding': result = workflow.approveEnvironmentPadding(root, input('--proposal'), input('--file')); break;
      case 'prepare-environment-padding': result = workflow.prepareEnvironmentPadding(root, input('--file')); break;
      case 'propose-supplement-padding': result = workflow.proposeSupplementPadding(root, input('--file')); break;
      case 'approve-supplement-padding': result = workflow.approveSupplementPadding(root, input('--proposal'), input('--file')); break;
      case 'prepare-supplement-padding': result = workflow.prepareSupplementPadding(root, input('--file')); break;
      case 'build-environment-proof': result = workflow.buildEnvironmentProofBundle(root, options['--plan'], options['--out']); break;
      case 'verify-environment-proof': result = workflow.verifyEnvironmentProofBundle(root, options['--plan'], options['--out']); break;
      case 'build-environment-layout-study': result = workflow.buildEnvironmentLayoutStudy(root, options['--plan'], input('--file'), options['--out']); break;
      case 'verify-environment-layout-study': result = workflow.verifyEnvironmentLayoutStudy(root, options['--plan'], input('--file'), options['--out']); break;
      case 'build-finite-environment-demo': result = workflow.buildFiniteEnvironmentDemo(root, options['--plan'], loadSceneKit(options['--kit']), input('--file'), options['--out']); break;
      case 'verify-finite-environment-demo': result = workflow.verifyFiniteEnvironmentDemo(root, options['--plan'], loadSceneKit(options['--kit']), input('--file'), options['--out']); break;
      case 'build-scene-candidate': case 'verify-scene-candidate': case 'build-scene-review-candidate': case 'verify-scene-review-candidate': case 'build-scene-reference-study': case 'verify-scene-reference-study': case 'build-scene-supplement-study': case 'verify-scene-supplement-study': {
        const method = command === 'build-scene-candidate' ? 'buildSceneCandidate' : command === 'verify-scene-candidate' ? 'verifySceneCandidate'
          : command === 'build-scene-review-candidate' ? 'buildSceneReviewCandidate' : command === 'verify-scene-review-candidate' ? 'verifySceneReviewCandidate'
          : command === 'build-scene-reference-study' ? 'buildSceneReferenceStudy' : command === 'verify-scene-reference-study' ? 'verifySceneReferenceStudy'
          : command === 'build-scene-supplement-study' ? 'buildSceneSupplementStudy' : 'verifySceneSupplementStudy';
        result = workflow[method](root, loadSceneKit(options['--kit']), input('--file'), {
          originalRoot: options['--original'], revisionRoot: options['--parent'], studyRoot: options['--study'],
        }, options['--out']); break;
      }
      case 'build-terrain-proof': result = workflow.buildTerrainProofBundle(root, options['--plan'], options['--out']); break;
      case 'verify-terrain-proof': result = workflow.verifyTerrainProofBundle(root, options['--plan'], options['--out']); break;
      case 'revise-terrain-proof': result = workflow.reviseTerrainProofBundle(root, options['--plan'], options['--parent'], options['--out']); break;
      case 'verify-terrain-proof-revision': result = workflow.verifyTerrainProofRevision(root, options['--plan'], options['--parent'], options['--out']); break;
      case 'build-terrain-module-study': result = workflow.buildTerrainModuleStudy(root, options['--plan'], options['--original'], options['--parent'], options['--out']); break;
      case 'verify-terrain-module-study': result = workflow.verifyTerrainModuleStudy(root, options['--plan'], options['--original'], options['--parent'], options['--out']); break;
      case 'build-terrain-continuity-study': result = workflow.buildTerrainContinuityStudy(root, options['--plan'], options['--original'], options['--parent'], options['--out']); break;
      case 'verify-terrain-continuity-study': result = workflow.verifyTerrainContinuityStudy(root, options['--plan'], options['--original'], options['--parent'], options['--out']); break;
      case 'build-terrain-long-field-study': result = workflow.buildTerrainLongFieldStudy(root, options['--plan'], options['--original'], options['--parent'], options['--baseline'], options['--out']); break;
      case 'verify-terrain-long-field-study': result = workflow.verifyTerrainLongFieldStudy(root, options['--plan'], options['--original'], options['--parent'], options['--baseline'], options['--out']); break;
      case 'plan-modules': result = workflow.freezeModuleBatch(root, loadSceneKit(options['--kit']), input('--file')); break;
      case 'revise-plan': result = workflow.reviseGenerationPlan(root, options['--plan'], input('--file')); break;
      case 'revise-batch': result = workflow.reviseModuleBatch(root, options['--batch'], input('--file')); break;
      case 'get-plan': result = workflow.getGenerationPlan(root, options['--plan']); break;
      case 'authorize': {
        const authorization = workflow.authorizePlan(root, options['--plan'], input('--file'));
        result = { status: 'authorized', planSha256: authorization.planSha256, maximumCalls: 1 }; break;
      }
      case 'reserve': {
        const { request, ...ticket } = workflow.reservePlan(root, options['--plan']); result = { ticket, request }; break;
      }
      case 'submitted': result = workflow.recordSubmission(root, input('--ticket')); break;
      case 'stop': result = workflow.stopAttempt(root, input('--ticket'), options['--outcome']); break;
      case 'receive': result = workflow.receiveResult(root, input('--ticket'), readSelectedFile(options['--file'], 16777216)); break;
      case 'review-image': result = workflow.reviewResult(root, options['--plan'], input('--file')); break;
      case 'recheck': result = workflow.recheckResult(root, options['--plan'], options['--raw']); break;
      case 'inspect': result = workflow.inspectWorkflow(root); break;
      case 'inspect-batch': result = workflow.inspectModuleBatch(root, options['--batch']); break;
    }
    console.log(JSON.stringify({ ok: true, coreProviderCalls: 0, result }, null, 2));
  } catch (error) {
    console.error(JSON.stringify({ ok: false, errors: error instanceof InvalidKit ? error.errors
      : [{ code: 'WORKFLOW_OPERATION_FAILED', artifact: 'workflow', path: '/', message: 'Offline operation failed; retain evidence and inspect; never auto-submit or retry' }] }, null, 2));
    process.exitCode = argumentsPhase ? 2 : 1;
  }
}
