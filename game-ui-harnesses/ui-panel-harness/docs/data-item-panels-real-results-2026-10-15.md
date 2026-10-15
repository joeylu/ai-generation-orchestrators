# 独立数据底板：十条短口令真实模型复测

用户批准固定计划 SHA-256 `7cd6fe6094113014d1ffddb5d33448e7803e0192d9084a250978ab02a557f8b1`。本轮gpt-6-luna／xhigh实际10次，每条一次、串行、零自动重试，交付10份，澄清0、失败0、未执行0。本次授权已消费，不能再次提交。

本批按新默认规则生成全新原始结果，没有人工拆组、改文案或重排后替代。用户仍只输入原短口令；生产共享提示、16主题、12自有图标、`modern-readable-game-data-panels`／Compiler0.44。数据标签和值共用内层Panel，外层语义分组保留，message.text正文不加数据框。规则见[每条数据独立底板](data-item-panels-2026-10-15.md)，此前[离线修复验收](data-item-panels-results-2026-10-15.md)单独保留，不能与本轮合并计数。

| 原短口令 | 原始结果 | 数据Panel数 | 面板宽度 | 375最小字号px | 画面检查 |
| --- | --- | --- | --- | --- | --- |
| 帮我做个设置面板 | READY_TO_COMPILE | 0 | 420 | 16.46 | PASS |
| 做个背包面板 | READY_TO_COMPILE | 0 | 420 | 16.46 | PASS |
| 做个角色选择面板 | READY_TO_COMPILE | 0 | 420 | 16.46 | PASS |
| 做个游戏商店面板 | READY_TO_COMPILE | 5 | 420 | 16.46 | PASS |
| 做个任务列表面板 | READY_TO_COMPILE | 0 | 420 | 16.46 | PASS |
| 做个成就面板 | READY_TO_COMPILE | 3 | 420 | 16.46 | PASS |
| 做个每日签到面板 | READY_TO_COMPILE | 3 | 420 | 16.46 | PASS |
| 做个通关结算面板 | READY_TO_COMPILE | 3 | 420 | 16.46 | PASS |
| 做个单机游戏暂停面板 | READY_TO_COMPILE | 0 | 360 | 18.98 | PASS |
| 做个退出游戏确认框 | READY_TO_COMPILE | 0 | 420 | 16.46 | PASS |

## 本批观察

- G25：两件商品共用一个外层组；各自的商品名称、价格和购买按钮没有形成独立商品块，所属关系仍主要靠顺序与留白。数据条目底板已生效，商品层级仍需改进。

实际内容分组如下，属于Agent观察，不代替用户美术认可：

- G03：音频（主音量、音乐音量、音效音量）；画面（画质、全屏）。
- G22：背包（物品（样例）、使用、整理）。
- G17：角色选择（角色立绘占位、选择角色、确认选择）。
- G25：游戏商店（余额、商品、价格、购买、商品、价格、购买）。
- G14：任务列表（任务）。
- G16：成就面板（初次启程（示例）、坚持训练（示例）、探索者（示例））。
- G31：每日签到（签到状态、连续签到、今日奖励、签到领取）。
- G06：通关结算（本局得分、通关用时、获得奖励）；后续选择（继续、再来一局）。
- G05：暂停（继续游戏、设置、重新开始、返回主菜单）。
- G54：退出游戏确认（确认提示、退出游戏、继续游戏）。

## 验收

| 检查 | 结果 | 范围 |
| --- | --- | --- |
| 页面身份、非空、加载及控件 | PASS | 72项离线浏览器检查，含下载完整性与原样重开 |
| 桌面与375／390窄屏 | PASS | 30屏，标题、字号、数据边界、初始按钮和分组底板 |
| 控制台与告警 | 未发现相关错误或告警 | 原始预览，外部网络阻断 |
| 实际点击 | PASS | 66组，核对状态与宿主事件，底板不触发额外事件 |
| 独立SDK精确重开 | PASS_FOR_DELIVERED_BUNDLES | 10份原始包原样导入／导出，固定归档摘要 |
| 来源、提示、收据、唯一授权和ZIP | PASS | 502份来源及保留副本；生产提示字节逐一核对 |
| 对照页 | PASS | 10图、40链接及桌面／手机布局 |
| Unity原生、游戏业务、用户美术认可 | 未执行 | 只验证导出文档，按钮发宿主事件 |

验收路径为打开本地离线交付→检查完整文字和底板层级→点击底板确认无多余事件→操作选项、滑杆或按钮→核对状态／宿主事件→导出和重开。Browser plugin not available，使用既有Playwright／Edge；无新依赖安装。截图与操作证据保存在本机忽略的输出目录。

此前2094项全量离线回归属于默认规则实现阶段，本轮没有更改产品源码，未冒充重新执行。本轮另做1项离线传输约束测试及发送前只读载荷核查：来源文件仅本地校验和冻结，模型提示包含短口令、公开UI目录／规则、输出schema和摘要；未把仓库源码清单加入提示。新模型结果与此前独立批次的内容可能不同，有限10条样本不代表所有口令或重复稳定性。

本地审阅 `output/data-item-panels-ten-real-review-v1/index.html`；原始交付 `output/data-item-panels-ten-real-v1/`；画面 `output/data-item-panels-ten-real-visual-v1/`；功能检查 `output/data-item-panels-ten-real-browser-v1/`；指针 `output/data-item-panels-ten-real-all-pointers-v1/`；SDK `output/data-item-panels-ten-real-sdk-v1/`；审计 `output/data-item-panels-ten-real-audit-v1/`；收尾 `output/data-item-panels-ten-real-closeout-v1/closeout.json`。整体COMPLETE_WITH_FINDINGS，rc.7尚未提交发布。
