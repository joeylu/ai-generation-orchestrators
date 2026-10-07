# Studio 三项真实失败复验 · 2026-10-06

用户授权计划 742985139f18816968b790fa00b19433c2d5416e313448498e798f177afada4d 后，
使用 gpt-6-luna / xhigh 执行三次真实 Codex CLI 调用。每个样本一次，Harness 自动重试为 0。
三项均通过公开方案校验、独立业务断言、编译和真实 Pixi 浏览器交互。

| 原失败样本 | 本次模型结果 | 浏览器结果 |
| --- | --- | --- |
| eval-controls：复杂控制设置，原 INTENT_COUNT | READY_TO_COMPILE；四行、范围、步长、默认值、选项及重置范围正确 | 9 项通过 |
| casual-inventory：口语背包筛选，原连接失败 | READY_TO_COMPILE；分类、收藏、排序、重置筛选正确 | 9 项通过 |
| D09-step2：连续修改第二步，原 EDIT_CONTEXT_MISMATCH | READY_TO_APPLY；只有主音量默认值变为 50 | 8 项通过 |

生成侧保留鼠标灵敏度 0.1～2、步长 0.1、默认 1；反转 Y 默认关闭；控制方案默认键鼠，
恢复默认仅重置原三项。口语背包保留全部五种分类、三种排序选项及相应默认值。
浏览器实际打开下拉菜单并核对完整选项，使用键盘改变值、切换开关和点击重置按钮。
两项均验证导出、重新导入和手机视口无页面横向溢出。

连续修改来源为上一次已经成功应用第一步后的面板。此次结果完整保留“声音选项”标题、
高度上限 480、控件 ID、布局、按钮动作、资源和其他状态字段。
模型返回的 patch 只有 set-state-initial(row0,50)，两个摘要与本次绑定一致。
试玩值 83 持续保留，点击恢复默认变成 50；撤销第二步恢复原默认值 70 和试玩值 83，
仍保留第一步标题和布局。导出重新打开后，默认值 50、试玩值 83 分别保持。

浏览器复验通过可见生成/修改按钮，经实际本地桥接与公开验证器重放本次保存的真实方案和回执。
这部分新模型调用为 0，重放为 3 次，没有 fixture 方案替代模型结果，也没有再次提交模型请求。
首轮浏览器驱动错误地等待空白需求的生成按钮启用，三项在调用重放前超时，replayCount 为 0；
修正为等待桥接初始化后填需求，v2 的 26 项检查全部通过，原 v1 失败报告保留。

## 证据

- 冻结计划：output/studio-stability-recheck-plan-v3/recheck-plan.json。
- 一次性消费记录：该计划目录下 dispatch-claim.json；准备时计划内 REQUIRED_NOT_GRANTED 字段不改写。
- 三个生产者原始回执、已接受 intent/draft/proposal 和报告：output/studio-stability-recheck-run-v1/ 各样本目录。
- 模型与编译报告：output/studio-stability-recheck-run-v1/recheck-report.json，PASS_BEFORE_BROWSER。
- 浏览器报告：output/studio-stability-recheck-browser-v2/browser-report.json，PASS，26 项。
- 汇总：output/studio-stability-recheck-summary-v1/acceptance-summary.json，PASS，3/3；绑定计划、模型和浏览器报告摘要。
- 截图：浏览器 v2 目录下 eval-controls.png、casual-inventory.png、D09-step2.png、D09-step2-reset50.png。

本次回执合计 inputTokens 83,265、cachedInputTokens 0、outputTokens 3,354，三份 usage 均已知。
没有按未知价格换算费用。上一轮失败、usage 未知的连接失败和原 63 次统计均未覆盖。

新版 Studio 继续使用 http://127.0.0.1:4191/，原 4189 服务和用户面板保留。
本轮未更改生产源码或新建构建，复用已通过 [643 项本地、79 项浏览器修复回归](studio-stability-fixes-2026-10-06.md) 的版本；
新增真实结果浏览器检查 26 项。测试范围是这三个明确失败样本，未重新执行全部 16 类多轮生成。
D09 第三步未在本次三次预算中调用；外部连接不能凭这一次成功宣称永不失败。
本轮原生 Unity 和人工视觉验收仍为 NOT_RUN。
