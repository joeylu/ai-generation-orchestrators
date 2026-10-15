# 四板后处理统一入口

需要分阶段暂停和继续时，使用[可恢复流程](skin-workflow.md)，它复用本文的检查与组包工具。

前提：四张图已生成、保存在本地，并已有完整的 assembly.json 部件定位配置。本入口不调用模型、不自动定位或拆分未知图集、不修改切线。它将现有后处理工具串成可重复执行的本地流程。

在 ui-chain-harness 目录运行：

```powershell
npm run skins:postprocess -- inspect --config work/skins/orbital-hangar/assembly.json
npm run skins:postprocess -- build --config work/skins/orbital-hangar/assembly.json
```

- inspect：校验模板摘要、30件覆盖、源图摘要、裁切范围、切片最小尺寸与组装策略，输出四板核对报告。
- build：先执行上述检查，再复用既有组装器、独立消费包构建器和浏览器检查器。任何步骤失败停止，不切换当前候选；不会重新生图。
- 每次输出到 work/skin-postprocess 下的独立目录，可通过 --out 指定其他 work 子目录。run.json 记录阶段及最终结果，inspection.json 记录各部件参数与建议，review.md 用于人工核对，evidence 保存浏览器报告与横竖截图。
- checked-candidate 只表示技术检查通过，仍需视觉验收；inspect 不产生可交付组件包。原始生成报告保持原状。

## Panel Slicer 的复用边界

几何校验沿用 tools/panel-slicer 的唯一实现。自动建议直接调用其 src/suggestion.mjs，并分析经过裁切和组装适配后的实际交付像素，按素材密度换算为逻辑切线。报告同时保留当前配置、来源和建议，不自动覆盖。

自动分析不支持会明确标记，保留已配置的人工切线继续检查，不冒充自动配置成功。透明装框留白会单独提示，因为切线落在留白里可能使真实主体被压缩。建议支持也不代表艺术效果合格。

单张 Panel 的目标尺寸渲染继续使用 [工具官方入口](../tools/panel-slicer/README.md)；本流程不会把它输出的成品 PNG 再作为原始纹理重复拉伸，也不会将其24像素以上面板目标限制套到10像素滚动条上。垂直滑轨使用既有显式端帽适配。

## 维护与使用

原有模板、风格、assembly.json 与组件合同仍各自负责，不新增第二份切线配置。自动报告和生成包都不手改；修改维护源后重新运行。

build 成功后从返回的 consumerDirectory 选择候选，再使用已有 consumer 流程：

```powershell
npm run consumer -- select --directory <consumerDirectory>
npm run consumer -- check
npm run consumer -- preview
```

当前已打开的预览是启动快照，不会因为产生新包而自动变化。

尚未实现：未知生成图集的自动部件定位、交互式切线核对页、自动应用建议、跨皮肤集中回归和稳定预览切换。不要将本入口描述为从参考图开始的无人值守全自动生产。
