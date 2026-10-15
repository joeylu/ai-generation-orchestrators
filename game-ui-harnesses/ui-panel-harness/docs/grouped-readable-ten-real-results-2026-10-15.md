# 新默认规则：十条短口令真实模型复测

用户批准不可变计划 SHA-256 `5de8799e46adee39d9199f9b68cf2d5ebe929e6cc80b67b6e59069816c71ec6d`。本批真实模型 gpt-6-luna／xhigh 实际10次，每条一次、串行、自动重试0；生成10份、澄清0、失败0、未执行0。本次授权已消费，不得重跑。本批原始结果没有人工拆组、改写文案或重排后替换；原0.41真实样本与离线修复样本保留。

使用Studio／SDK当前默认目录 `modern-readable-game-grouped-layout`、完整16主题和12自有图标、生产共享短口令提示。实际Compiler0.42，正文／按钮24、标题32，标题底板与sectionSurface:panel-v2。用户短口令没有加入控件清单、分类、尺寸或排版要求，运行时不读取外部skill。

| 原始短口令 | 原始结果 | 面板逻辑宽 | 375页面最小文字px | 画面检查 |
| --- | --- | --- | --- | --- |
| 帮我做个设置面板 | READY_TO_COMPILE | 420 | 16.46 | PASS |
| 做个背包面板 | READY_TO_COMPILE | 420 | 16.46 | PASS |
| 做个角色选择面板 | READY_TO_COMPILE | 420 | 16.46 | PASS |
| 做个游戏商店面板 | READY_TO_COMPILE | 571 | 12.34 | FLAGS_PRESENT |
| 做个任务列表面板 | READY_TO_COMPILE | 420 | 16.46 | PASS |
| 做个成就面板 | READY_TO_COMPILE | 429 | 16.14 | PASS |
| 做个每日签到面板 | READY_TO_COMPILE | 420 | 16.46 | PASS |
| 做个通关结算面板 | READY_TO_COMPILE | 490 | 14.25 | FLAGS_PRESENT |
| 做个单机游戏暂停面板 | READY_TO_COMPILE | 360 | 18.98 | PASS |
| 做个退出游戏确认框 | READY_TO_COMPILE | 420 | 16.46 | PASS |

## 分组和可读性观察

设置实际分组：音频（音乐音量、音效音量）；画面（画质、全屏）；设置管理（保存设置、恢复默认）。本次模型自行将音频和画面放在不同内容组；按钮单独分组。

- G25：窄屏最小文字低于16px。
- G06：窄屏最小文字低于16px。

以上语义观察属于Agent审阅，不代替用户美术认可。不同批次由模型独立生成，不能把内容差异当作同一Spec的纯排版对照；也不能将有限样本外推为所有输入的成功率。

## 交付验收

| 检查 | 结果 | 证据范围 |
| --- | --- | --- |
| 页面身份、非空与加载状态 | PASS | 原始交付的离线浏览器检查 |
| 框架错误层、控制台错误 | 未发现 | 见视觉报告；告警0条 |
| 桌面与窄屏画面 | FINDINGS_PRESENT | 1100／390／375宽，共30屏 |
| 控件与宿主事件 | PASS | 73项，包括状态、重开及下载完整性 |
| 实际指针操作 | PASS | 30项，覆盖各实际生成的选择、开关、滑条和确认选择 |
| 安装SDK精确重开 | PASS_FOR_DELIVERED_BUNDLES | 10份原始保存包，固定依赖归档原样导入／导出 |
| 来源、唯一调用、提示与ZIP | PASS | 498份冻结来源、唯一授权消费及每项收据 |
| 用户审美、Unity原生、游戏业务 | 未执行 | 游戏按钮仅发宿主事件 |

浏览器技能路径：Browser plugin not available，使用既有Playwright／Edge，不安装依赖。验收流为“打开离线交付 → 点击／键盘操作控件 → 核对状态和宿主事件 → 重开保持状态”；另在窄屏点击真实选择菜单、列表与新鲜确认按钮。来源与模型答案冻结后没有改产品规则；没有自动重试。此前2064项全量测试属于规则修复阶段，本轮没有源代码变更，不冒充重新执行的测试。

可复核命令为 `scripts/check-input-adaptability-browser.mjs --run … --output …` 及 `scripts/summarize-input-adaptability.mjs --prepared … --run … --browser … --output …`。计算执行只使用已批准摘要，不能复用本批命令再次提交。

本地结果页 `output/grouped-readable-ten-real-review-v1/index.html`；原始交付 `output/grouped-readable-ten-real-v1/`；30屏及结构 `output/grouped-readable-ten-real-visual-v1/`；功能浏览器 `output/grouped-readable-ten-real-browser-v1/`；指针 `output/grouped-readable-ten-real-pointers-v1/`；SDK `output/grouped-readable-ten-real-sdk-v1/`；来源审计 `output/grouped-readable-ten-real-audit-v1/`；收尾 `output/grouped-readable-ten-real-closeout-v1/closeout.json`。整体为COMPLETE_WITH_FINDINGS，rc.7仍未发布。
