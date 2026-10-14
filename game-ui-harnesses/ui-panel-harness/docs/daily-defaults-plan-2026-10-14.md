# 最后一批日常默认真实验收计划

本计划已获批准并执行，真实模型调用 **8**，授权 **已消费**：7 份交付、背包失败 1 项、重试 0。
详见 [原始结果与修复](daily-defaults-real-results-2026-10-14.md)。以下保留当时冻结范围，不能再次提交本计划。

冻结目录 `output/daily-defaults-real-plan-v1`，计划摘要：

`054e3b9b8b9f219b7eb1c714a0c0b5952240b5d5c3865abe89168862ef828faf`

共 8 条原短口令，每项最多调用一次，串行执行，gpt-6-luna/xhigh，自动重试 0。
传输结果不确定时停止，已完成的失败也不自动补发。

| 案例 | 原口令 |
| --- | --- |
| G03 | 帮我做个设置面板 |
| G05 | 做个单机游戏暂停面板 |
| G06 | 做个通关结算面板 |
| G17 | 做个角色选择面板 |
| G22 | 做个背包面板 |
| G25 | 做个游戏商店面板 |
| G49 | 做个游戏登录面板 |
| G54 | 做个退出游戏确认框 |

采用日常 Studio／SDK 的完整 `modern-compact-message` 目录，包含 16 个主题条目
（浅深色、4 个配色、2 个标题策略）和 12 个自有图标。16 种组件继续可用。
不注入 skill 摘录，不加入测试肖像，不生成图片；共享生产规划提示与发送提示逐字相同。
冻结 483 个源码与资源文件，运行前重新校验；不使用旧授权。

实际调用走工作区生产规划器。安装 SDK 已独立通过离线验收，本批不冒称在消费方项目或游戏宿主中执行。
所有未提供的玩家身份、奖励、进度等只能是示例；按钮只通知宿主，不冒称业务完成。
合理澄清与实际生成分开记录；技术通过与文案、必要性及视觉审阅分开。
本批只有 8 个有限样本，不能证明所有输入都成功，也不是统计稳定性结论。

预览 `output/daily-defaults-plan-review-v1/index.html`。它显示口令、约束和计划，不是生成结果。
本轮默认接入和离线证据见 [结果记录](daily-defaults-results-2026-10-14.md)。

根 [AGENTS.md](../../../AGENTS.md) 明确要求：
`A generation attempt requires one fresh, single-use authorization bound to an immutable plan digest.`
用户已批准以上摘要，本次 8 次调用已消费授权；不得再次调用。后续复测使用独立新摘要和新授权。

以下为本次已执行命令记录；生成命令已消费，当前不得再次执行：

```powershell
node scripts/input-adaptability.mjs run --prepared output/daily-defaults-real-plan-v1 --approve-plan 054e3b9b8b9f219b7eb1c714a0c0b5952240b5d5c3865abe89168862ef828faf --output output/daily-defaults-real-v1
node scripts/check-input-adaptability-browser.mjs --run output/daily-defaults-real-v1 --output output/daily-defaults-real-browser-v1
node scripts/summarize-input-adaptability.mjs --prepared output/daily-defaults-real-plan-v1 --run output/daily-defaults-real-v1 --browser output/daily-defaults-real-browser-v1 --output output/daily-defaults-real-audit-v1
node scripts/review-common-game-panels.mjs --prepared output/daily-defaults-real-plan-v1 --run output/daily-defaults-real-v1 --browser output/daily-defaults-real-browser-v1 --output output/daily-defaults-real-review-v1
```
