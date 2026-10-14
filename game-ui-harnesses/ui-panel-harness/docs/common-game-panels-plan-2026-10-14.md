# 游戏通用面板短口令测试计划

执行状态COMPLETED_WITH_FAILURES：v2已获授权并执行64次，41份交付、23次校验失败，claim已消费。完整记录见[真实结果与离线修复](common-game-panels-results-2026-10-14.md)。以下PREPARED_V2段落与命令保留计划冻结时的状态；当前源码已作后续修复，原计划不可重跑。

状态PREPARED_V2。真实模型调用0，新计划未消费授权。用户已授权的v1在模型调用前因启动记录缺少可选字段而失败，原计划的程序claim保留，不能重复执行。v2的口令、上下文、schema、完整模型提示、期待文件及预算与v1逐项一致，只有记录与审计源码修复。现有发布修复提交0eefeabe的CI已全部通过： https://github.com/joeylu/ai-generation-orchestrators/actions/runs/38437690094 。本计划是后续本地实验代码，不代表已发布的rc.5新增功能或模型验收结论。

## 请求覆盖

64条独立输入：7类×8种＝56种常见用途，加4条口语变体和4条明确约束。最长20字，无技术附录。请求清单见[测试用例源码](../examples/common-game-panels-v1/suite.mjs)。

| 类别 | 用途 |
| --- | --- |
| 基础流程 | 开始、大厅、设置、在线暂停、单机暂停、通关、失败、加载 |
| 关卡与成长 | 加载失败、断线重连、选关、章节、未解锁提示、任务列表、任务详情、成就 |
| 角色与物品 | 选角色、详情、升级、技能、装备、背包、物品详情、合成 |
| 商店与奖励 | 商店、商品详情、购买确认、金币不足、体力不足、领奖、签到、开箱结果 |
| 社交与对局 | 排行榜、好友、添加好友、公会、组队、房间、匹配等待、匹配成功 |
| 活动与信息 | 每日任务、活动列表、活动详情、邮件、邮件详情、公告、战令、新内容解锁 |
| 账号与系统 | 登录、玩家信息、改昵称、存档、读档、退出确认、帮助、意见反馈 |

口语变体：“设置界面来一个”“来个暂停菜单”“整个背包页面”“给我弄个领奖弹窗”。只比较与对应常规用语是否都能贴合目的，不要求生成同一套控件或几何。

明确约束：“做暂停面板，只要继续和返回菜单。”“做设置面板，只要音乐和音效开关，都开着。”“做通关面板，得分12800，再来一次。”“做加载失败面板，只显示网络断开和重试。”只核对已经表达的数量、类型、命名、默认值和文字，不往开放请求塞标准答案。

这是有限的高频用途清单，不穷尽所有游戏品类、平台、生命周期或业务模式；不声称每种内容行或所有16类组件都必须被本批请求调用。复杂HUD、聊天服务、地图交互、动画、支付和账号认证须根据现有能力澄清或通过宿主接入，不能伪装实现。登录、商店、背包、存档、匹配等仅产出界面和事件合同，实际业务效果不属于本批验收。

## 单一条件和评价

本轮按广度覆盖，统一采用草稿优先提示，不加skill摘录，不做三组重复对照。固定gpt-6-luna/xhigh、Compiler 0.33.0、modern-mint-light@0.22.0自动标题模式；同色0.22.1可用于明确要求显示标题。默认尺寸未指定时让程序测量，模型不应任意选小尺寸；明确要求仍优先。此实验不切换日常Studio配置，也不自动采用已发布的草稿尺寸辅助。

开放输入无唯一标准页面，模型可提议常规控件和安全默认值；游戏数值、玩家信息、物品、奖励等虚构数据必须显式标记示例或占位。内容适合程度、增补是否克制、操作是否清楚、示例诚实性、澄清必要性、视觉质量均需实际审阅，技术PASS不能替代这些评价。

原始意图、提案、回执、实际发送提示摘要、草稿细节、交付ZIP与浏览器证据分别保留。首屏按钮边界在焦点导航前采集，记录画布、面板和正文滚动裁切；后续交互成功不抵消初始裁切。页签仅评价当前页显示的按钮，其他页通过独立交互检查。截图保留完整页面，不裁掉失败信息。

每项一次、串行、最多64次、自动重试0。已完成的独立内容/校验失败保留后可继续；连接不确定或缺少回执立即停止余项，未运行单独计数，不重新提交失败调用。一次样本不能证明重复稳定性，澄清续答与编辑链路不在此批范围。

## 已完成的离线验证

- 64项驱动夹具的准备链路全部通过，expectedSpec全部为null，夹具不进入模型context。开放内容可以不同，不把模型迎合夹具当成功。
- 全量1847项测试通过，新增4项CLI运输替身测试通过，真实调用0。运输测试确认完整提示和短用户输入精确通过同一调用边界一次，回执无自动重试。
- 同64项夹具使用尺寸全部null时，都能测量和编译，没有正文滚动。这仍是夹具证据，不是实际模型面板的首屏保证。
- 新首屏观测测试复现8像素底部裁切；测试也确认不会将隐藏页签按钮误报为首屏缺失。
- 64条计划卡片和分类筛选通过浏览器检查；只读预检PASS，授权未消费。

启动修复补验：完整批次替身通过64次精确运输、编译、重开、打包和摘要检查；相同已claim的计划再次执行被拒绝，替身计数明确标记为fixtureInvocations，realModelCalls为0。记录字段在只读预检中就必须可编码为严格JSON。新增替身整批测试加入全量后1852/1852通过。

旧失败目录 `output/common-game-panels-real-v1` 完整保留，原报告0次调用、G01失败、其余63未运行。G01仅有acceptance.json，没有codex尝试目录、提示发送记录或模型回执；按原字段构造可以复现调用前的CANONICAL_JSON_REQUIRED错误。原报告将缺回执一律标成indeterminate，不能据此宣称发生了真实网络调用；新版本区分调用前失败与可能已调用的连接不确定。v2差异证据在本地 `output/common-game-panels-plan-review-v2/revision-evidence.json`，未改写原始报告或claim。

本地生成证据：`output/common-game-panels-full-regression-v1.log`、`output/common-game-panels-transport-v1.log`、`output/common-game-panels-measured-fixtures-v1/report.json`、`output/common-game-panels-plan-review-v1/browser-smoke.json`。本地output不随源码提交。

## 审阅与授权

完整短口令与每项实际系统提示位于本地 `output/common-game-panels-plan-review-v2/index.html`。冻结计划 `output/common-game-panels-plan-v2/input-adaptability-plan.json`，SHA-256：`2d00b6eeac00a058b27896d26189ea72682317e5300eb9728b11e24c78ff6e61`。原v1摘要 `d7806757e9230ef1a8463bdaee6f73f338f198ed9800b6cae985179a6c9328bd` 不再可执行。

根AGENTS.md要求 `A generation attempt requires one fresh, single-use authorization bound to an immutable plan digest.` 本计划需要新批准，旧批次批准不复用。所有可离线准备的内容已完成；批准后执行：

```powershell
node scripts/input-adaptability.mjs run --prepared output/common-game-panels-plan-v2 --approve-plan 2d00b6eeac00a058b27896d26189ea72682317e5300eb9728b11e24c78ff6e61 --output output/common-game-panels-real-v2
node scripts/check-input-adaptability-browser.mjs --run output/common-game-panels-real-v2 --output output/common-game-panels-browser-v2
node scripts/summarize-input-adaptability.mjs --prepared output/common-game-panels-plan-v2 --run output/common-game-panels-real-v2 --browser output/common-game-panels-browser-v2 --output output/common-game-panels-audit-v2
node scripts/review-common-game-panels.mjs --prepared output/common-game-panels-plan-v2 --run output/common-game-panels-real-v2 --browser output/common-game-panels-browser-v2 --output output/common-game-panels-review-v2
```
