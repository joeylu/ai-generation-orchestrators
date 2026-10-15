export function deriveCatalog(spec, sourceSha256) {
  const assets = spec.sheets.flatMap(sheet => sheet.parts.map(part => ({
    ...part, sheetId: sheet.id,
    cleanImage: `${sheet.filePrefix}.clean.png`, reviewImage: `${sheet.filePrefix}.review.png`,
  })));
  return {
    kind: 'ui_template_catalog', version: '0.1', templateVersion: spec.version,
    templateRevision: spec.revision, sourceSha256, status: spec.status,
    scope: 'Design template only; not a generated or accepted skin pack.',
    coordinates: spec.coordinates, sheetCount: spec.sheets.length, partCount: assets.length,
    unresolvedPolicyCount: assets.filter(a => a.productionPolicy === 'raster-or-procedural-undecided').length,
    sheets: spec.sheets.map(s => ({ id: s.id, title: s.title, filePrefix: s.filePrefix, assetIds: s.parts.map(p => p.assetId) })),
    consumerIndex: Object.fromEntries(spec.consumerTypes.map(c => [c, assets.filter(a => a.consumers.includes(c)).map(a => a.assetId)])),
    stateGroups: spec.stateGroups, assets,
  };
}

export function deriveModelProjection(spec, sourceSha256) {
  return {
    kind: 'ui_template_model_geometry', version: '0.1', sourceSha256,
    templateVersion: spec.version, templateRevision: spec.revision,
    scope: 'Offline geometry input candidate. Not a provider request or compute authorization.',
    coordinates: spec.coordinates, constraints: spec.constraints,
    sheets: spec.sheets.map(s => ({
      id: s.id, layoutImage: `${s.filePrefix}.clean.png`,
      parts: s.parts.map(({ assetId, code, consumers, state, slotRect, bodyRect, primitive, stretch, productionPolicy }) =>
        ({ assetId, code, consumers, state, slotRect, bodyRect, primitive, stretch, productionPolicy })),
    })),
  };
}

const cell = value => String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('|','&#124;').replaceAll('`','&#96;').replaceAll('[','&#91;').replaceAll(']','&#93;').replaceAll('*','&#42;').replaceAll('_','&#95;');
export function deriveOverview(catalog) {
  const { coordinates: c } = catalog;
  const lines = [
    '# 独立部件模板对照（自动生成）', '',
    '请修改源模板 JSON 后重建，不手改本页。模板仍为讨论草案；本页不表示真实生图、切分或组件验收通过。', '',
    `模板合同 ${catalog.templateVersion}，内容修订 ${catalog.templateRevision}；${catalog.sheetCount} 张板，${catalog.partCount} 个候选部件，其中 ${catalog.unresolvedPolicyCount} 个生产方式待定。`, '',
    `逻辑尺寸 ${c.width} × ${c.height}（1:1），输出 ${c.width*c.outputScale} × ${c.height*c.outputScale} PNG。`, '',
    `源摘要：\`${catalog.sourceSha256}\`。`, '',
    '[冻结源数据](source.json) · [部件目录](catalog.json) · [模型几何投影](model-projection.json) · [构建记录](build-record.json)', '',
  ];
  for (const sheet of catalog.sheets) {
    lines.push(`## ${sheet.id} · ${cell(sheet.title)}`, '',
      `[无标注透明 PNG](${sheet.filePrefix}.clean.png) · [编号核对 PNG](${sheet.filePrefix}.review.png)`, '',
      `![${sheet.id} 编号核对](${sheet.filePrefix}.review.png)`, '',
      '| 编号 | 资产 ID | 部件 | 使用方 | 状态 | 主体尺寸 | 槽位 x,y,w,h | 主体 x,y,w,h | 伸缩 | 生产方式 |',
      '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
    for (const a of catalog.assets.filter(a => a.sheetId === sheet.id)) {
      lines.push(`| ${[a.code, a.assetId, a.label, a.consumers.join(', '), a.state, a.bodyRect.slice(2).join(' × '), a.slotRect.join(', '), a.bodyRect.join(', '), a.stretch, a.productionPolicy === 'raster-candidate' ? '栅格候选' : '栅格/程序待定'].map(cell).join(' | ')} |`);
    }
    lines.push('');
  }
  lines.push('## 使用方索引', '', '仅为使用关系说明，不是已实现的组件配方；没有专用皮肤的声明也会保留。', '', '| 使用方 | 资产 ID |', '| --- | --- |');
  for (const [consumer, assets] of Object.entries(catalog.consumerIndex)) lines.push(`| ${cell(consumer)} | ${assets.map(cell).join(', ') || '无专用部件'} |`);
  return lines.join('\n')+'\n';
}
