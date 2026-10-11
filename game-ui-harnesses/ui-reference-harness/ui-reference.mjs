#!/usr/bin/env node
import * as fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import * as api from './src/index.mjs';
import { readBytes, readJson, requireThat, sha256, withLock } from './src/common.mjs';
import { runtimeDigest } from './src/compiler.mjs';
import { validateRules } from './src/styles.mjs';

const commandOptions = {
  init: ['root', 'id'], presets: ['sample-catalog'], doctor: [], 'self-test': [], 'samples-prepare': ['output'], 'samples-plan': ['root'],
  'style-create': ['root', 'preset', 'pack', 'reference', 'sample-catalog', 'rules', 'notes'], 'pack-check': ['pack'],
  'style-show': ['root', 'style-sha256'], 'style-activate': ['root', 'style-sha256', 'approval'],
  'import-panel': ['root', 'bundle', 'spec', 'catalog', 'preview'], status: ['root'],
  plan: ['root', 'panel', 'note', 'intent', 'parent-run', 'resolution'], optimize: ['root', 'panel', 'note', 'intent', 'parent-run', 'resolution'],
  'plan-project': ['root', 'panels', 'intents', 'resolution'], 'inspect-project-plans': ['root', 'batch'],
  'dag-create': ['root', 'anchor-panel', 'panels', 'intents', 'resolution'], 'dag-inspect': ['root', 'dag'],
  'dag-advance': ['root', 'dag', 'operation-id'], 'dag-prepare': ['root', 'dag', 'panel', 'operation-id'],
  'dag-authorize': ['root', 'dag', 'panel', 'operation-id', 'run', 'plan-sha256', 'approval'],
  'dag-generate': ['root', 'dag', 'panel', 'operation-id', 'run', 'adapter'],
  'dag-request': ['root', 'dag', 'panel', 'operation-id', 'run'],
  'dag-receive': ['root', 'dag', 'panel', 'operation-id', 'run', 'request-sha256', 'image'],
  'dag-finish': ['root', 'dag', 'panel', 'operation-id', 'run', 'raw-sha256'],
  'dag-stop': ['root', 'dag', 'panel', 'operation-id', 'run', 'request-sha256', 'outcome'],
  'dag-review': ['root', 'dag', 'panel', 'operation-id', 'run', 'image-sha256', 'layout', 'style', 'copy', 'decision', 'note', 'anchor'],
  'dag-revise': ['root', 'dag', 'panel', 'operation-id', 'source-run', 'note'],
  'dag-retry': ['root', 'dag', 'panel', 'operation-id', 'source-run', 'decision'],
  'dag-export': ['root', 'dag', 'operation-id'],
  'reprocess-plan': ['root', 'source-run', 'raw-sha256'], reprocess: ['root', 'run', 'plan-sha256'],
  'correct-select-plan': ['root', 'source-run', 'targets', 'note'],
  authorize: ['root', 'run', 'plan-sha256', 'approval'], request: ['root', 'run'],
  generate: ['root', 'run', 'adapter'], receive: ['root', 'run', 'request-sha256', 'image'],
  finish: ['root', 'run', 'raw-sha256'], stop: ['root', 'run', 'request-sha256', 'outcome'],
  inspect: ['root', 'run'], review: ['root', 'run', 'image-sha256', 'layout', 'style', 'copy', 'decision', 'note', 'anchor'],
  export: ['root', 'output', 'panels'], validate: ['delivery'],
};
function parse(argv) {
  const [command, ...args] = argv;
  if (!command || command === '--help' || command === 'help') return { command: 'help', options: {} };
  requireThat(Object.hasOwn(commandOptions, command), 'COMMAND_UNKNOWN');
  const options = {};
  for (let i = 0; i < args.length; i += 2) {
    requireThat(args[i].startsWith('--'), 'OPTION_EXPECTED');
    const key = args[i].slice(2);
    requireThat(commandOptions[command].includes(key) && !Object.hasOwn(options, key)
      && args[i + 1] !== undefined && !args[i + 1].startsWith('--'), 'OPTION_INVALID');
    options[key] = args[i + 1];
  }
  return { command, options };
}
export async function main(argv = process.argv.slice(2)) {
  const { command, options: o } = parse(argv);
  const need = (...keys) => keys.forEach(key => requireThat(typeof o[key] === 'string' && o[key].length > 0, `OPTION_REQUIRED_${key.toUpperCase().replaceAll('-', '_')}`));
  if (command === 'help') return { version: api.VERSION, commands: Object.keys(commandOptions), usage: 'node ui-reference.mjs <command> --root <project-directory> ...', documentation: 'README.md' };
  if (command === 'presets') return api.presetList({ sampleCatalog: o['sample-catalog'] });
  if (command === 'pack-check') { need('pack'); return api.checkPack(o.pack); }
  if (command === 'samples-prepare') { need('output'); return api.prepareSamples(o.output); }
  if (command === 'self-test') { for (const preset of api.presetList()) validateRules(preset.rules); return { status: 'pass', runtimeSha256: runtimeDigest(), computeCalls: 0 }; }
  const [nodeMajor, nodeMinor] = process.versions.node.split('.').map(Number);
  if (command === 'doctor') return { version: api.VERSION, nodeSupported: nodeMajor > 22 || (nodeMajor === 22 && nodeMinor >= 18),
    panelAdapterPresent: fs.existsSync(new URL('../ui-panel-harness/src/component-adapter.mjs', import.meta.url)),
    generation: 'external-adapter-required', networkCalls: 0, computeCalls: 0 };
  if (command === 'validate') { need('delivery'); return api.validateDelivery(o.delivery); }
  need('root');
  if (command.startsWith('dag-')) {
    if (command === 'dag-create') return api.createProjectDag(o.root, { anchorPanelId: o['anchor-panel'], panelIds: o.panels?.split(','),
      intents: o.intents ? readJson(o.intents) : [], resolution: o.resolution ?? 'native' });
    need('dag');
    if (command === 'dag-inspect') return api.inspectProjectDag(o.root, o.dag);
    need('operation-id');
    const operation = { operationId: o['operation-id'] };
    if (command === 'dag-advance') return api.advanceProjectDag(o.root, o.dag, operation);
    if (command === 'dag-export') return api.exportProjectDag(o.root, o.dag, operation);
    need('panel');
    if (command === 'dag-prepare') return api.prepareProjectDagPanel(o.root, o.dag, o.panel, operation);
    if (command === 'dag-revise') { need('source-run', 'note'); return api.reviseProjectDagPanel(o.root, o.dag, o.panel, { ...operation, sourceRun: o['source-run'], note: o.note }); }
    if (command === 'dag-retry') { need('source-run', 'decision'); return api.retryProjectDagPanel(o.root, o.dag, o.panel, { ...operation, sourceRun: o['source-run'], decision: o.decision }); }
    need('run'); operation.run = o.run;
    if (command === 'dag-authorize') { need('plan-sha256', 'approval'); return api.authorizeProjectDagPanel(o.root, o.dag, o.panel, { ...operation, planSha256: o['plan-sha256'], approval: o.approval }); }
    if (command === 'dag-request') return api.requestProjectDagPanel(o.root, o.dag, o.panel, operation);
    if (command === 'dag-generate') {
      need('adapter'); let adapter;
      try { adapter = await import(pathToFileURL(o.adapter).href); } catch { throw new Error('ADAPTER_LOAD_FAILED'); }
      return api.generateProjectDagPanel(o.root, o.dag, o.panel, operation, adapter);
    }
    const action = command.slice(4); let payload, bytes = null;
    if (action === 'receive') { need('request-sha256', 'image'); bytes = readBytes(o.image); payload = { requestSha256: o['request-sha256'], rawSha256: sha256(bytes) }; }
    if (action === 'finish') { need('raw-sha256'); payload = { rawSha256: o['raw-sha256'] }; }
    if (action === 'stop') { need('request-sha256', 'outcome'); payload = { requestSha256: o['request-sha256'], outcome: o.outcome }; }
    if (action === 'review') {
      need('image-sha256', 'layout', 'style', 'copy', 'decision', 'note');
      requireThat(o.anchor === undefined || ['true', 'false'].includes(o.anchor), 'ANCHOR_FLAG_INVALID');
      payload = { imageSha256: o['image-sha256'], layout: o.layout, style: o.style, copy: o.copy,
        decision: o.decision, note: o.note, useAsAnchor: o.anchor === 'true' };
    }
    return api.actProjectDagPanel(o.root, o.dag, o.panel, { ...operation, action, payload }, bytes);
  }
  switch (command) {
    case 'init': need('id'); return api.initialize(o.root, o.id);
    case 'samples-plan': return api.planSamples(o.root);
    case 'style-create': return withLock(o.root, () => api.createStyle(o.root, { preset: o.preset, pack: o.pack, reference: o.reference, sampleCatalog: o['sample-catalog'], rules: o.rules ? readJson(o.rules) : null, notes: o.notes ?? '' }));
    case 'style-show': need('style-sha256'); return api.loadStyle(o.root, o['style-sha256']);
    case 'style-activate': need('style-sha256', 'approval'); return api.activateStyle(o.root, o['style-sha256'], o.approval);
    case 'import-panel': return api.addPanel(o.root, { bundle: o.bundle, spec: o.spec, catalog: o.catalog, preview: o.preview });
    case 'status': return api.projectStatus(o.root);
    case 'plan-project': return api.createProjectPlans(o.root, { panelIds: o.panels?.split(','), intents: o.intents ? readJson(o.intents) : [], resolution: o.resolution ?? 'native' });
    case 'inspect-project-plans': need('batch'); return api.inspectProjectPlans(o.root, o.batch);
    case 'optimize': need('parent-run'); // An explicit new frozen plan; never an automatic compute retry.
    case 'plan': need('panel'); return api.createPlan(o.root, { panelId: o.panel, note: o.note ?? '', intent: o.intent ? readJson(o.intent) : null, parentRun: o['parent-run'], resolution: o.resolution ?? 'native' });
    case 'reprocess-plan': need('source-run', 'raw-sha256'); return api.createReprocessPlan(o.root, { sourceRun: o['source-run'], rawSha256: o['raw-sha256'] });
    case 'correct-select-plan': need('source-run'); return api.createSelectCorrectionPlan(o.root, { sourceRun: o['source-run'], targetIds: o.targets?.split(','), note: o.note ?? '' });
    case 'reprocess': need('run', 'plan-sha256'); return api.reprocessRaw(o.root, o.run, o['plan-sha256']);
    case 'authorize': need('run', 'plan-sha256', 'approval'); return api.authorize(o.root, o.run, o['plan-sha256'], o.approval);
    case 'request': need('run'); return api.reserve(o.root, o.run);
    case 'generate': {
      need('run', 'adapter');
      let adapter; try { adapter = await import(pathToFileURL(o.adapter).href); } catch { throw new Error('ADAPTER_LOAD_FAILED'); }
      return api.generateWithAdapter(o.root, o.run, adapter);
    }
    case 'receive': need('run', 'request-sha256', 'image'); return api.receive(o.root, o.run, o['request-sha256'], readBytes(o.image));
    case 'finish': need('run', 'raw-sha256'); return api.finish(o.root, o.run, o['raw-sha256']);
    case 'stop': need('run', 'request-sha256'); return api.stopAttempt(o.root, o.run, o['request-sha256'], o.outcome);
    case 'inspect': need('run'); return api.inspectRun(o.root, o.run);
    case 'review':
      need('run', 'image-sha256', 'layout', 'style', 'copy', 'decision', 'note');
      requireThat(o.anchor === undefined || ['true', 'false'].includes(o.anchor), 'ANCHOR_FLAG_INVALID');
      return api.reviewRun(o.root, o.run, { imageSha256: o['image-sha256'], layout: o.layout, style: o.style, copy: o.copy,
        decision: o.decision, note: o.note, useAsAnchor: o.anchor === 'true' });
    case 'export': need('output'); return api.exportProject(o.root, o.output, o.panels?.split(','));
    default: throw new Error('COMMAND_UNKNOWN');
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { console.log(JSON.stringify(await main(), null, 2)); }
  catch (error) {
    // Never print raw host, provider or upstream diagnostics.
    const code = /^[A-Z][A-Z0-9_]{1,100}$/.test(error.message) ? error.message : 'OPERATION_FAILED';
    console.error(JSON.stringify({ error: code })); process.exitCode = 1;
  }
}
