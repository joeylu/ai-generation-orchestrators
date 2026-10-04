#!/usr/bin/env node
/**
 * Programmatic fixture assembler for the fixed M2 examples, not an NL parser.
 * All mappings below are hand-authored fixture data. Exact source spans and
 * generated hashes establish consistency, not machine understanding, semantic
 * correctness, user approval, visual acceptance or engine acceptance.
 * No component core, browser, model or generation service is invoked.
 */
import { digestJson } from '../src/canonical.mjs';
import { createPlanningContext, validatePlanningContext } from '../src/planning-context.mjs';
import { checkPanelProposal, proposalTargets, validatePanelProposal } from '../src/proposal.mjs';
import { applyPanelPatch } from '../src/patch.mjs';
import { validatePanelSpec } from '../src/spec.mjs';
import { readJson, readText, createOutputDirectory, writeNewJson } from '../src/io.mjs';

function exactQuote(text, quote) {
  const start = text.indexOf(quote);
  if (start < 0 || text.indexOf(quote, start + 1) !== -1) throw new Error('FIXTURE_SOURCE_CHANGED');
  return { kind: 'request-interpretation', start, end: start + quote.length, quote };
}

async function main(args) {
  if (args.length !== 2 || args[0] !== '--output' || !args[1] || args[1].startsWith('--')) {
    throw new Error('USAGE: node scripts/write-planning-fixtures.mjs --output <new-directory>');
  }
  const [requestText, ambiguousText, editText, sampleInput, catalog] = await Promise.all([
    readText(new URL('../examples/audio-request.txt', import.meta.url)),
    readText(new URL('../examples/audio-ambiguous-request.txt', import.meta.url)),
    readText(new URL('../examples/audio-edit-request.txt', import.meta.url)),
    readJson(new URL('../examples/audio-settings.panel.json', import.meta.url)),
    readJson(new URL('../catalog/modern-core.json', import.meta.url)),
  ]);
  const spec = validatePanelSpec(sampleInput);
  if (spec.provenance.kind !== 'programmatic-fixture') throw new Error('FIXTURE_PROVENANCE_REQUIRED');
  const context = await createPlanningContext({ requestVersion: '0.1', id: 'audio-settings-fixture', text: requestText, target: 'pixi' }, catalog);
  const ambiguousContext = await createPlanningContext({ requestVersion: '0.1', id: 'audio-ambiguous-fixture', text: ambiguousText, target: 'pixi' }, catalog);

  // Full source lines are deliberately pinned for each business-bearing target.
  // Changing prose requires reviewing these authored fixture mappings.
  const volumeLine = '包含一个“音量”滑条：范围 0–100，整数步长 1，初值 80，显示百分比，允许操作。';
  const switchLine = '包含一个“启用声音”开关：初值开启，开启表示有声音，关闭表示没有声音，允许操作。';
  const bases = new Map([
    ['panel', exactQuote(requestText, '帮我生成一个深色的设置面板，标题为“设置”')],
    ['theme', exactQuote(requestText, '采用现代暗色主题')],
    ['section:audio', exactQuote(requestText, '分组标题为“音频”')],
    ['canvas', { kind: 'design-choice', reason: '程序夹具选择现有 960×640 参考画布；需求允许由设计系统安排，不代表响应式重排或用户视觉确认。' }],
    ['layout', { kind: 'design-choice', reason: '程序夹具复用现有纵向设置面板的完整布局参数；需求允许由设计系统安排。' }],
    ['row:volume-row', exactQuote(requestText, volumeLine)],
    ['state:volume', exactQuote(requestText, volumeLine)],
    ['row:audio-enabled-row', exactQuote(requestText, switchLine)],
    ['state:audioEnabled', exactQuote(requestText, switchLine)],
  ]);
  const targets = proposalTargets(spec);
  if (targets.length !== bases.size || targets.some(target => !bases.has(target))) throw new Error('FIXTURE_TARGETS_CHANGED');
  const proposal = {
    proposalVersion: '0.1', contextSha256: context.sha256, spec,
    decisions: targets.map(target => ({ target, basis: bases.get(target) })), unresolved: [],
  };
  const ambiguousProposal = {
    proposalVersion: '0.1', contextSha256: ambiguousContext.sha256, spec: null, decisions: [],
    unresolved: [
      { id: 'volume-range', question: '音量滑条的最小值和最大值是多少？' },
      { id: 'volume-initial', question: '预览音量初值是多少？' },
      { id: 'volume-step', question: '音量步长是多少，是否只允许整数？' },
      { id: 'switch-semantics', question: '开关开启表示启用声音还是静音？关闭时是否保留音量并允许继续调整？' },
      { id: 'switch-initial', question: '声音开关的预览初值是开启还是关闭？' },
    ],
  };
  // This exact fixed case is intentionally assembled without deriving commands
  // from arbitrary prose. Reading another request cannot produce a guessed patch.
  const expectedEdit = '把“音量”改为“主音量”，在它后面增加“背景音乐音量”滑条：范围 0–100、步长 1、初值 50、显示百分比、允许操作。新滑条使用独立状态与宿主变化事件，保留已有声音开关及其他设置。';
  if (editText.trim() !== expectedEdit) throw new Error('FIXTURE_EDIT_SOURCE_CHANGED');
  const patch = {
    patchVersion: '0.1', baseSpecSha256: await digestJson(proposal.spec),
    reason: `程序化演示夹具；以下是固定输入，非自动语义理解或审批证据：${expectedEdit}`,
    operations: [
      { op: 'set-row-label', rowId: 'volume-row', label: '主音量' },
      {
        op: 'add-row', sectionId: 'audio', afterRowId: 'volume-row',
        row: {
          id: 'music-volume-row', kind: 'slider', recipe: { id: 'settings.slider', version: '0.1.0' },
          label: '背景音乐音量', bind: 'musicVolume', enabled: true, event: 'audio.musicVolumeChanged',
          format: { fractionDigits: 0, prefix: '', suffix: '%' },
        },
        state: { id: 'musicVolume', type: 'number', initial: 50, min: 0, max: 100, step: 1 },
      },
    ],
  };

  // All inputs must pass real program validation before any directory is created.
  await validatePlanningContext(context);
  await validatePlanningContext(ambiguousContext);
  await validatePanelProposal(context, proposal);
  await validatePanelProposal(ambiguousContext, ambiguousProposal);
  const readyReport = await checkPanelProposal(context, proposal);
  const ambiguousReport = await checkPanelProposal(ambiguousContext, ambiguousProposal);
  if (readyReport.status !== 'READY_TO_COMPILE' || ambiguousReport.status !== 'NEEDS_INPUT') throw new Error('FIXTURE_STATUS_MISMATCH');
  await applyPanelPatch(proposal.spec, patch);

  const files = [
    ['context.json', context], ['proposal.json', proposal],
    ['ambiguous-context.json', ambiguousContext], ['ambiguous-proposal.json', ambiguousProposal],
    ['patch.json', patch], ['base.panel.json', proposal.spec],
  ];
  const directory = await createOutputDirectory(args[1]);
  for (const [name, value] of files) await writeNewJson(directory, name, value);
  process.stdout.write(`${JSON.stringify({
    status: 'FIXTURES_WRITTEN', kind: 'programmatic-fixture', files: files.map(([name]) => name),
    naturalLanguageInterpretation: 'NOT_RUN', semanticReview: 'NOT_RUN', userApproval: 'NOT_ASSERTED',
    browser: 'NOT_RUN', nativeEngines: 'NOT_RUN',
  }, null, 2)}\n`);
}

try { await main(process.argv.slice(2)); }
catch (error) {
  // Avoid exposing host filesystem paths through raw Node diagnostics.
  const code = typeof error.code === 'string' ? error.code : String(error.message).split(':')[0];
  process.stderr.write(`${JSON.stringify({ status: 'FAILED', code, ...(error.path?.startsWith('$') ? { path: error.path } : {}) })}\n`);
  process.exitCode = 1;
}
