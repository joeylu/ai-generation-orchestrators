# 四板后处理统一入口

需要分阶段暂停和继续时，使用[可恢复流程](skin-workflow.md)，它复用本文的检查与组包工具。

本 CLI 的前提是四张组件图已保存在本地，并已有完整的 `assembly.json` 部件定位配置。它不调用模型，不负责从未知图集建立定位配置，也不修改已有切线。需要从原始图集开始自动定位、派生切线和内容安全区时，使用已实现的[定位入口](skin-localization.md)和[任务 DAG](skin-task-dag.md)；Studio 已将这些步骤连接到生成结果。

在 ui-chain-harness 目录运行：

```powershell
npm run skins:postprocess -- inspect --config work/skins/orbital-hangar/assembly.json
npm run skins:postprocess -- build --config work/skins/orbital-hangar/assembly.json
```

- inspect：校验模板摘要、冻结模板的全量部件覆盖（修订3为32件，修订2为30件）、源图摘要、裁切范围、切片最小尺寸与组装策略，输出四板核对报告。
- build：先执行上述检查，再复用既有组装器、独立消费包构建器和浏览器检查器。任何步骤失败停止，不切换当前候选；不会重新生图。
- 可选 `--material-input work/skin-tasks/<task-id>/input/materials/material-atlas.json`：读取任务冻结的S05原图与模板摘要，在基础部件组包后提取三份材质并绑定标题、分组和面板表面，再构建和检查最终消费包。旧四图调用不需要此参数。
- 每次输出到 work/skin-postprocess 下的独立目录，可通过 --out 指定其他 work 子目录。run.json 记录阶段及最终结果，inspection.json 记录各部件参数与建议，review.md 用于人工核对，evidence 保存浏览器报告与横竖截图。
- checked-candidate 只表示技术检查通过，仍需视觉验收；inspect 不产生可交付组件包。原始生成报告保持原状。
- 失败时 stderr 返回结构化 `status/code/message/stage/directory`；`run.json` 保留具体失败阶段，不将材质错误折叠为普通子进程失败。

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

由独立 consumer 预览命令启动的页面使用启动快照；生成新包后需显式选择并重开。Studio 则通过已校验产物目录和组件版本展示当前项目结果。

本 CLI 不提供交互式切线编辑页，也不会把本次检查建议直接写回已有维护配置。上游 metadata 流程已能按策略派生和应用新候选的切线，无法可靠分析时会停止并保留原因；这与覆写旧配置不同。固定槽位定位也不能识别模型画错的组件语义。预览和程序检查均不替代人工美术接受或生产发布。
