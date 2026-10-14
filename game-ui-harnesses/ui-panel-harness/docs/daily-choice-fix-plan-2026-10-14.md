# 选择默认项修复：4 条原短口令真实复测计划

用户批准后已执行，**真实调用 4 次、4 份交付、失败 0、自动重试 0，授权已消费**。34 项浏览器、4 份窄屏交互与完整性审计通过。见 [真实结果](daily-choice-fix-results-2026-10-15.md)。

新冻结目录 `output/daily-choice-fix-plan-v1`，摘要：

`43e99b96ad4928cb21906b470393ba40beaa0b566d8fee8cefd4508e1f7ef91b`

父批次摘要 `054e3b9b8b9f219b7eb1c714a0c0b5952240b5d5c3865abe89168862ef828faf`，
父批次已调用 8 次，7 份交付、背包 G22 失败；详见 [原始结果](daily-defaults-real-results-2026-10-14.md)。
没有修改原失败，没有自动重试，也没有从未保留的原始 intent 编造恢复方案。

| 案例 | 原短口令 | 目的 |
| --- | --- | --- |
| G22 | 做个背包面板 | 复测选择默认项导致的原失败 |
| G03 | 帮我做个设置面板 | 选择控件与状态回归 |
| G17 | 做个角色选择面板 | 单选与中性占位回归 |
| G25 | 做个游戏商店面板 | 示例选项与宿主事件回归 |

使用完整日常目录的 16 个主题条目与 12 个自有图标，共享生产提示与发送提示逐字相同。
补充每组 Select、Radio、List 恰有一个默认项，Tabs 恰有一个初始页，CheckBox／Switch 各自独立。
明确默认值保留；不支持的无选中或多选要求须澄清，不能自动改成第一个选项。
不加用户提示细节，不注入 skill，不生成图片。

最多 **4 次** gpt-6-luna/xhigh，串行，各案例一次，自动重试 **0**。
实际组件类型和模型设计建议按本轮输出记录，不预先宣称会采用哪一种控件或获得成功。
完成的失败不补发，传输结果不确定则停止。本次不直接发布；实际复测与审阅通过后再收尾。

修复后 1981 项离线回归和 39 项 SDK 安装校验通过。
三种选择控件的合成回归覆盖 0／1／2 个默认，仍严格拒绝错误默认和自动重试。
浏览器运行时与此前候选不变；本次有限 4 样本均通过，不能据此宣称任意输入稳定成功。
预览 `output/daily-choice-fix-plan-review-v1/index.html` 只显示计划，不能视为生成结果。

根 [AGENTS.md](../../../AGENTS.md) 要求：
`A generation attempt requires one fresh, single-use authorization bound to an immutable plan digest.`
用户批准了本摘要，4 次单次授权现已消费；旧批次授权也已消费，不可再次执行。

以下为已执行命令的历史记录，生成命令不得重跑：

```powershell
node scripts/input-adaptability.mjs run --prepared output/daily-choice-fix-plan-v1 --approve-plan 43e99b96ad4928cb21906b470393ba40beaa0b566d8fee8cefd4508e1f7ef91b --output output/daily-choice-fix-real-v1
node scripts/check-input-adaptability-browser.mjs --run output/daily-choice-fix-real-v1 --output output/daily-choice-fix-real-browser-v1
node scripts/summarize-input-adaptability.mjs --prepared output/daily-choice-fix-plan-v1 --run output/daily-choice-fix-real-v1 --browser output/daily-choice-fix-real-browser-v1 --output output/daily-choice-fix-real-audit-v1
node scripts/review-common-game-panels.mjs --prepared output/daily-choice-fix-plan-v1 --run output/daily-choice-fix-real-v1 --browser output/daily-choice-fix-real-browser-v1 --output output/daily-choice-fix-real-review-v1
```
