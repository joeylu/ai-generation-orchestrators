# 从需求检索资源并形成面板方案

`intake --assets` 把资源检索接入规划：程序验证资源库，从完整需求检索有限候选，
Agent 根据语义选择资源并填写 PanelSpec，`build-plan` 再核对真实资源库后编译。
这一流程采用关键词匹配，没有向量库、模型调用或自动图像生成。

## 使用流程

在本 Harness 目录运行。示例资源库须先按 [资源导入说明](asset-import.md) 准备；
Sharp 无法直接解析时，给 `intake` 和 `build-plan` 加上 `--sharp-module <已安装的模块目录>`。
输出目录必须尚不存在，重复运行请换目录。

```sh
node scripts/cli.mjs intake examples/asset-planning/request.txt --id audio-asset-planning --catalog examples/modern-mint-light.catalog.json --assets output/generic-library-migrated-v1 --asset-style modern-mint --output output/asset-planning-context-final
```

生成的 `planning-context.json` 使用 `planningContextVersion: "0.2"`，包含原文、组件目录、
组件候选及 `assetRetrieval`。后者固定资源库 ID、摘要、检索策略和候选的语义、尺寸、
切片、PNG 摘要等信息；不包含宿主绝对路径、PNG 字节或完整资源库。

Agent 按 [规划协议](../prompts/panel-planner.md) 编写 `proposal.json`。
仓库提供了与上述完整请求、请求 ID、主题目录和资源库摘要相配的
[Agent 方案示例](../examples/asset-planning/proposal.json)。任一输入变化后应重新规划，不能复用旧 contextSha256。

- 使用 `proposalVersion: "0.2"`，复制实际 `contextSha256`。
- 需要图片时使用 PanelSpec 0.2，复制 `assetRetrieval.library`；精确资源 key 必须来自对应槽位的候选。
- 为整体 `assets`、所选 `asset:surface`、每个 `asset:row:<rowId>` 分别填写依据。
- 不使用图片时可以提出 PanelSpec 0.1；若用户明确需要的图片缺失，Agent 应记录 `unresolved`，不能悄悄省略。

然后运行：

```sh
node scripts/cli.mjs check-plan output/asset-planning-context-final/planning-context.json --proposal examples/asset-planning/proposal.json
node scripts/cli.mjs build-plan output/asset-planning-context-final/planning-context.json --proposal examples/asset-planning/proposal.json --assets output/generic-library-migrated-v1 --output output/asset-planning-final
```

`component.bundle.json` 可导入现有 Pixi 工作台。`inspect` 和 `restore` 继续使用包内图片，
无需源资源库；没有新增选图转换命令，Agent 直接提交完整方案。

## 候选范围

资源检索使用完整请求的规范化文本及资源名称、标签和系列信息，原始请求保持不变。
每个 namespace/id 先选数值版本最高的记录，再过滤用途与可选的精确风格。
因此新版本改变用途后，不会自动回退到旧版本。排名是词法相关度，不是概率或语义判断。
“图标 / icon / png”等通用类别和格式词不参与匹配；描边、填充等外观词只辅助已有业务语义命中的排序，
不能单独让无关资源进入候选。“给我图标”返回空，“音量图标”在示例库中只返回两种扬声器变体。

每个槽位最多保留 16 个实际资源 key，总计最多 32 项；槽位为 `row-icon` 和 `panel-surface`。
图标仅接受 `icon`；面板背景仅接受带有效切片的 `shape` 或 `layout-primitive`。
零相关度不返回候选。`--asset-style` 只在 intake 设置，省略时不过滤风格；build 使用上下文锁定的策略。
这些候选不会自动绑定到行，Agent 仍需核对控件含义、风格、可读性及图片实际用途。

## 两个验证阶段

`check-plan` 在离线上下文中检查候选格式与其内嵌依据、所选 key 的槽位及固定库引用。
报告明确保留 `assetEvidence.libraryVerification: "REQUIRES_BUILD_VERIFICATION"`。
它无法只凭库摘要证明候选属于真实资源库，或证明全库前 16 项没有被遗漏或替换。
`READY_TO_COMPILE` 也不代表资源已完成外部复验、布局通过或视觉确认。

`build-plan` 必须再次提供实际资源库。程序完整验证库，以同一请求和策略重新检索，
比较整个候选快照后才解析所选 PNG。库变化、候选增加/删除/修改或引用不匹配都会拒绝交付。
即使方案不使用图片，0.2 规划上下文仍需完成这一步外部复验。

成功交付另存程序生成的 `asset-build-verification.json`；原 `planning-report.json` 保留其
检查时的证据边界，不把离线检查报告改写为构建成功证明。摘要提供一致性校验，不提供身份认证。
Agent 不应编辑这些程序报告，也不能把检索结果当作业务语义正确的证据。

## 兼容与缺失处理

不传 `--assets` 的 intake 仍生成 context 0.1，与 proposal 0.1 配对。旧流程继续允许
手动填写 PanelSpec 0.2 的资源引用及整体 `assets` 决策，由构建阶段验证资源；它没有候选约束。
context 0.2 必须与 proposal 0.2 配对，不能换用旧提案版本跳过检查。

检索未命中、候选不足、必要图片语义不清等情况由 Agent 明确写入 `unresolved`。
程序阻止已记录的待决项，但不会自动发现被遗漏的需求。补充资源或调整需求后重新 intake，
生成新的上下文与方案；不要手改旧候选或猜测摘要。

格式见 [proposal 0.1](../schemas/panel-proposal.schema.json) 和
[proposal 0.2](../schemas/panel-proposal-v0.2.schema.json)。运行时还检查上下文绑定、
目标覆盖、精确引文、候选与槽位关系；JSON Schema 单独不能建立这些跨文档约束。

本轮实际验证：224 项测试通过，完整需求产生 30 个候选后由 Agent 选取 3 项资源；
构建复验、13 项 Pixi 浏览器检查、离线 CLI 恢复和 7 个交付附件摘要检查均通过。
证据见 [任务记录](tasks.md)，最终包在 `output/asset-planning-final/`，截图在
`test-results/browser-asset-planning/initial.png`；临时只读预览已关闭。
