#!/usr/bin/env node
/** Explicit programmatic examples, never evidence of natural-language model accuracy. */
import { readJson, createOutputDirectory, writeNewJson } from '../src/io.mjs';
import { createPlanningContext } from '../src/planning-context.mjs';
import { proposalTargets, checkPanelProposal } from '../src/proposal.mjs';
const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== '--output') throw new Error('Expected --output <new-directory>');
const catalog = await readJson('examples/modern-mint-layout.catalog.json');
const cases = [];
for (const name of ['settings', 'pause', 'character', 'settings-compact']) {
  const spec = await readJson(`examples/layout-v1/${name}.panel.json`);
  const text = `这是程序化布局验收夹具，不是模型推理结果。面板标题为“${spec.title}”。采用以下明确的业务状态和内容：\n${JSON.stringify({ state: spec.state, sections: spec.sections })}`;
  const context = await createPlanningContext({ requestVersion: '0.1', id: `layout-${name}`, target: 'pixi', text }, catalog);
  const proposal = { proposalVersion: context.planningContextVersion, contextSha256: context.sha256, spec, unresolved: [],
    decisions: proposalTargets(spec, context.planningContextVersion).map(target => ({ target,
      basis: target.startsWith('row:') || target.startsWith('state:')
        ? { kind: 'request-interpretation', start: 0, end: text.length, quote: text }
        : { kind: 'design-choice', reason: 'Explicitly authored deterministic layout acceptance fixture.' } })) };
  const report = await checkPanelProposal(context, proposal); cases.push({ name, context, proposal, report });
}
const output = await createOutputDirectory(args[1]);
for (const item of cases) for (const kind of ['context', 'proposal', 'report']) await writeNewJson(output, `${item.name}.${kind}.json`, item[kind]);
console.log(JSON.stringify({ status: 'FIXTURES_WRITTEN', cases: cases.length, modelCalls: 0 }));
