import * as fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { canonical, exact, local, readJson, requireThat, seal, unseal, withLock, writeJsonNew, writeNew } from './common.mjs';
import { BUILTIN_IDS, builtinPack } from './packs.mjs';
import { createStyle, loadStyle } from './styles.mjs';
import { addPanel, initialize, loadProject } from './project.mjs';
import { loadPrototype } from './panel.mjs';
import { createPlan, verifyPlan } from './compiler.mjs';

export async function prepareSamples(output) {
  local(output, 'samples.json'); requireThat(!fs.existsSync(output), 'OUTPUT_ALREADY_EXISTS');
  fs.mkdirSync(output, { recursive: true });
  const samples = [];
  for (const id of BUILTIN_IDS) {
    const root = local(output, id); initialize(root, `sample-${id}`);
    const style = createStyle(root, { preset: id });
    const panel = await addPanel(root, {
      spec: fileURLToPath(new URL('../examples/style-showcase.panel.json', import.meta.url)),
      catalog: fileURLToPath(new URL('../../ui-panel-harness/examples/modern-controls.catalog.json', import.meta.url)),
    });
    samples.push({ id, name: builtinPack(id).metadata.name, styleSha256: style.sha256, prototypeSha256: panel.prototype.sha256,
      panelId: panel.panelId, layoutSha256: panel.neutralPreview.sha256 });
  }
  requireThat(new Set(samples.map(s => s.prototypeSha256)).size === 1, 'SAMPLE_PROTOTYPE_MISMATCH');
  const result = seal({ kind: 'ui_reference_sample_set_v1', samples, preparation: 'drafts-only-no-style-approval-no-compute' });
  writeJsonNew(output, 'samples.json', result);
  const review = ['# 六种 UI 样本风格草案', '', '状态：待风格确认，尚未激活、授权或生成图片。', '',
    '六种风格使用同一个 960×800 原型，当前常规页：主音量 70%、启用声音、高清画质、恢复默认和保存设置。',
    '原型包含标题、页签、滑条、开关、下拉选择和主次按钮；首版不含素材图标或物品列表，显示页内容保持隐藏。',
    '中性矩形图只表示布局；以下配色是待确认的项目推荐色，不是已生成美术样本。', '',
    `![统一原型](${local(output, `${samples[0].id}/blobs/${samples[0].layoutSha256}.png`).replaceAll('\\', '/')})`, ''];
  for (const item of samples) {
    const style = loadStyle(local(output, item.id), item.styleSha256), pack = style.pack;
    review.push(`## ${item.name} · ${item.id}`, '', `风格摘要：\`${style.sha256}\``, '',
      `完整快照：[style.json](${local(output, `${item.id}/styles/${style.sha256}.json`).replaceAll('\\', '/')})`, '',
      `配色（背景 / 面板 / 主色 / 辅色 / 文字）：${['background', 'surface', 'primary', 'secondary', 'text'].map(key => pack.palette[key]).join(' / ')}`, '',
      ...Object.entries(pack.render_style).map(([key, value]) => `- ${key}：${value}`), '',
      ...Object.entries(pack.ui_rules).map(([key, value]) => `- ${key}：${value}`), '',
      ...pack.negative_rules.map(value => `- ${value}`), '');
  }
  writeNew(output, 'style-review.md', Buffer.from(review.join('\n') + '\n'));
  return result;
}
export function planSamples(root) {
  return withLock(root, () => {
    const set = readJson(local(root, 'samples.json')); unseal(set);
    exact(set, ['kind', 'samples', 'preparation', 'sha256']);
    requireThat(set.kind === 'ui_reference_sample_set_v1' && Array.isArray(set.samples)
      && canonical(set.samples.map(s => s.id)) === canonical(BUILTIN_IDS), 'SAMPLE_SET_CONTRACT');
    // Check all six approved snapshots before creating any plan.
    for (const item of set.samples) {
      exact(item, ['id', 'name', 'styleSha256', 'prototypeSha256', 'panelId', 'layoutSha256']);
      const projectRoot = local(root, item.id), project = loadProject(projectRoot);
      const style = loadStyle(projectRoot, item.styleSha256), entry = project.panels[item.panelId];
      requireThat(style.source.kind === 'builtin' && style.pack.metadata.id === item.id
        && project.activeStyle === item.styleSha256, 'SAMPLE_STYLE_REVIEW_REQUIRED');
      requireThat(entry?.prototype.sha256 === item.prototypeSha256
        && loadPrototype(projectRoot, entry.prototype).layout.sha256 === item.layoutSha256, 'SAMPLE_PROTOTYPE_MISMATCH');
      requireThat(!project.baselines[item.styleSha256], 'SAMPLE_COMPARISON_REQUIRES_NO_ANCHOR');
    }
    requireThat(new Set(set.samples.map(s => s.prototypeSha256)).size === 1, 'SAMPLE_PROTOTYPE_MISMATCH');
    const plans = set.samples.map(item => {
      const projectRoot = local(root, item.id), plan = createPlan(projectRoot, { panelId: item.panelId });
      return { id: item.id, run: plan.run, planSha256: plan.planSha256, request: plan.request };
    });
    // Store exact digests for subsequent compute decisions; this command never authorizes them.
    const batch = seal({ kind: 'ui_reference_sample_plans_v1', sampleSetSha256: set.sha256, plans, computeCalls: 0 });
    const batchId = randomUUID();
    writeJsonNew(root, `plans/${batchId}.json`, batch);
    for (const item of plans) verifyPlan(local(root, item.id), item.run);
    const review = ['# 六种 UI 样本冻结计划', '', `计划集合摘要：\`${batch.sha256}\``, '',
      '六份风格草案已激活。下列六份计划尚未取得计算授权，尚未提交任何生图请求。', '',
      '统一原型：960×800，常规页，主音量 70%、声音开启、高清画质、恢复默认和保存设置。',
      '输入：同一张中性布局图与各自冻结的 UI 包规则；无美术样本图，无项目样板。',
      '输出：各一张不透明 PNG。native 保留原生像素，短边至少 256、长边最多 4096，宽高比误差最多 1%。',
      '计算范围：每份计划一次，共六次；不自动重试。生成后须分别人工验收布局、风格、文案。', '',
      '| 风格 | 计划摘要 | 最多调用 | 冻结计划 |', '| --- | --- | --- | --- |',
      ...plans.map(item => `| ${builtinPack(item.id).metadata.name} | \`${item.planSha256}\` | 1 | [plan.json](${local(root, `${item.id}/${item.run}/plan.json`).replaceAll('\\', '/')}) |`), '',
      `完整请求集合：[JSON](${local(root, `plans/${batchId}.json`).replaceAll('\\', '/')})`, ''];
    writeNew(root, `plans/${batchId}.md`, Buffer.from(review.join('\n') + '\n'));
    return batch;
  });
}
