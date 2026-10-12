# 角色图片槽的一次真实生成验收

结论：单次真实生成的原始方案通过事实、编译和实际浏览器检查。模型自行返回三个并排角色卡片，每个角色名出现一次，空肖像槽和独立选择按钮齐全。没有手工改写模型方案，也没有把程序样本提供给模型。人工美术认可仍待用户评价。

## 冻结输入与调用

原始需求：

> 做一个浅色简约的角色选择界面。战士、魔法师、弓箭手三个角色并排，分别显示角色名、肖像和一个选择按钮。暂无肖像素材，先保留图片占位。点击选择时分别通知宿主，暂不接游戏。

沿用当前 `modern-image-slots` 目录及 Studio 的 12 个核心图标池。需求没有逐项指定文案去重或布局尺寸；模型返回 PanelIntent 0.11、`modern-mint-light@0.20.0`、横排三个 section、`source: null` 的 image 行及三个 emit 按钮。角色名由各自分组标题承担，缺图说明为“待添加肖像”，按钮文案为“选择”。模型未提供具体尺寸时仍由既有程序测量生成几何。

- 冻结计划：`output/image-slots-real-plan-v2/plan.json`。
- 计划 SHA-256：`467e5182cde35f7ee3812f7be463135736ba2cda3937b706c6eb6b6661adb375`。
- 新的单次授权后执行 Codex CLI，`gpt-6-luna / xhigh`；调用 1 次、编辑 0 次、自动重试 0 次。授权已消费。
- 回执为 `READY_TO_COMPILE`；耗时 125945ms，输入 33315 tokens、输出 990 tokens。
- 原始 Bundle SHA-256：`dfc7482b3d70cfd632337d6f15e9c65018d4eadc792b48b1b8870aea71543a68`。

准备阶段的 6 项替身预演覆盖正确结果、重复身份、漏按钮、纵排误解及无效图片源。v1 预演通过后，冻结代码误读摘要字段导致程序拒绝求摘要；v1 文件原样保留，v2 修正为读取 `context.catalogSha256` 后重新预演、冻结。没有真实调用失败或重跑。沙箱内只读登录检查不可见；宿主侧只读检查通过，未修改配置或登录状态。

## 原结果与确定性复核

入口：`output/image-slots-real-plan-v2/review-v1/index.html`。默认显示本次真实结果，可以切换到明确标注的程序参考样本；参考样本、预期 JSON 和截图都不是模型输入。下载始终对应本次真实结果。

`plan-tool.mjs` 校验计划与 335 个源文件摘要，单次凭据采用排他写入。原始 intent、proposal、CLI 回执、首次 Bundle 和后续接受结果分别保存；冻结计划及调用前回执没有被改写。后续 `build-review.mjs`、`check-review.mjs` 只对已保存结果做确定性复核，没有推理调用。

12 项实际浏览器检查通过，覆盖：

- 原始 Pixi 与标注参考实例挂载；实际渲染角色名称各一次，文本不隐式省略。
- 三个占位横排、桌面按钮尺寸；三张静态图片不触发事件。
- 三个按钮的鼠标及键盘独立 emit 事件，每次触发一次，无额外选择状态。
- 试玩 Bundle 导出、JSON 往返、无图库工作台重导入。
- 一份实际下载 ZIP 的 CRC、精确字节数及 25 个交付文件的字节/SHA-256。
- 下载物离线打开、键盘选择和重新打开；无浏览器错误、无外部网络请求。
- 375px 对照页及画布容纳；只验证既有固定画布缩放，不宣称移动触控或响应式重排通过。

主要证据：

- `output/image-slots-real-plan-v2/acceptance.json`：`TECHNICAL_PASS_VISUAL_REVIEW_PENDING`。
- `output/image-slots-real-plan-v2/browser-v1/browser-report.json`：12/12 PASS，复核阶段模型调用 0。
- `output/image-slots-real-plan-v2/browser-v1/real-desktop.png`：原始模型结果截图。
- `output/image-slots-real-plan-v2/browser-v1/actual-downloaded-offline.png`：实际下载物离线试玩截图。

本次生成后没有修改核心源码。已有完整回归 1523/1523 是冻结前的结果；本次新增原结果编译、事实和浏览器验收，没有无关地重跑整套回归。

## 下载物与范围

| 项目 | 值 |
| --- | --- |
| 真实面板 ZIP | `review-v1/role-selection.zip` |
| 精确字节数 | 1226984 |
| ZIP SHA-256 | `35899f91a35d997c24773b6d3ead8d0dc8acd13ee9ec8f93f312f7efacaee1a4` |
| 离线 runtime 字节数 | 978769 |
| runtime SHA-256 | `bbfc75f2dfdabc96edc0d61e4c88ac5ba778ff9f3e287d8092ad101ff572d55c` |

该 ZIP 是本次面板交付物，包含匹配的 Pixi 离线运行时及 UGUI 文件，不是新的正式 SDK。正式 rc.3 未改写，未发布或推送新版本；Docker/Web 消费项目、其他 Harness 和日常 Studio 状态未修改。

这是一种需求的一次成功，不能外推为所有自然语言输入或全部 Component 节点已经受支持。肖像是缺图占位，没有生成美术素材。上游浏览器 PASS 不等于消费方 Web 验收，UGUI 文件和 ZIP 校验不等于 Unity 原生导入通过；两者以及人工美术认可仍为 NOT_RUN。
