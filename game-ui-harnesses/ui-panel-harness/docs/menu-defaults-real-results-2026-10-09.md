# 新菜单默认 · 单次真实复验结果

用户对冻结摘要 `9c4ff862621433bafc3dbbb129f6085906a4413c14262ae523297f0af1d1f1dc` 明确授权后，完成一次Codex CLI / gpt-6-luna / xhigh生成，124887ms、零重试。新默认在本次暂停菜单真实样本中生效：没有额外“菜单入口”标题，原生Intent未指定尺寸，实际编译得到预期菜单比例与配色。该结果只证明一个样本，不代表其他输入类型或普遍美术稳定性已通过。

入口：`output/menu-defaults-real-pause-plan-v1/review/index.html?panel=pause-dark`。左侧为上次真实minimal-v1结果，右侧为本次真实minimal-v2结果，需求文字完全一致；两次目录和提示源码不同，不作Skill对比，也不能据此单独归因于某一条提示。左侧旧结果及程序夹具都未作为模型输入。

## 实际验收

| 项目 | 结果与证据 |
| --- | --- |
| 调用 | 1次，gpt-6-luna / xhigh，自动重试0；输入29637、输出843、缓存输入0 tokens |
| 原运输回执 | `real-call/codex-78a6c3f8-582d-4eea-9126-6e89ea8a6de1/codex-receipt.json`，READY_TO_COMPILE |
| 原生方案 | PanelIntent0.10，单组标题“暂停”，actionLayout与所有尺寸为null、无图标、无额外内容或状态；三个完整入口依次为继续游戏、设置、返回主菜单，独立emit事件，primary/secondary/secondary配方 |
| 编译 | compiler0.26.0，modern-blue-dark@0.18.0；底板428×298px，内边距28px，标题槽34px；三个280×48px按钮、10px圆角，底板20px圆角，标题加粗与中性表面/蓝色主按钮 |
| 保存包 | `panel.bundle.json`，SHA-256 `05402ce0e888517373a825582fbd2318b5ddd4ee554504a71797c9d1cb2bada2`；原proposal.spec与交付Spec逐字段相同，没有物化后补写样式 |
| 浏览器 | `review/review-report.json`，5组PASS；桌面和390px下实际点击/事件、独立状态、无文字截断、严格即时导出及容纳检查通过 |
| 实际下载 | 1份ZIP完成CRC/文件摘要、无图库Studio重导入/重导出和独立离线打开；浏览器错误0、外部请求0 |
| 来源复核 | `provenance-audit.json`，14份冻结输入及278份源码/合同/锁定依赖指纹复核、唯一一次真实目录、原方案与交付一致；除面板ID外与明确编写的新默认夹具Spec一致，夹具本身仍不算模型输出 |
| 汇总结论 | `acceptance.json`，TECHNICAL_PASS_VISUAL_REVIEW_PENDING，outputSpecRewritten=false，humanVisualApproval/nativeUnity/gameIntegration均NOT_RUN |

已查看实际Pixi并排截图。相较上次真实结果，新版减少了多余标题层级，采用更集中的底板/按钮列和更明确的主操作颜色；这是Agent的视觉观察，用户审美确认仍待定。390px检查只证明固定画布缩放容纳，不是响应式重排。字体沿用新菜单默认系统字体，未内嵌；高DPI清晰度边界保持。

## 来源及计算边界

冻结plan.json、准备README及夹具预演文件保持执行前状态，不回填为成功。执行事实由新增dispatch-claim、原生Intent/方案/回执、terminal-result、acceptance及审计记录表达。terminal-result的browser=NOT_RUN是浏览器验收之前的历史阶段，后续浏览器结果以acceptance为准。

原真实minimal-v1包没有改写，bundle摘要仍为 `ab30c0804bd89d1c4bc251ae6bf0edce9e7446bb1f11f7d7af24291dbd541658`，字节摘要仍为 `760f5a7a0b5e64b1fc0973681acbf67825fe35c0f96a6566f4ab4069b14afd8b`。准备时受限环境登录可见性FAIL和宿主只读复核PASS分别保留，均不是模型请求或重试。

本轮没有新的生产代码改动，没有重跑无关全量回归；此前1339项回归证据与本次冻结源码分别记录。没有启动、停止或替换4951服务，没有接入游戏或推送GitHub。Unity只生成UGUI导入工具包，编辑器原生导入及交互未验收。本次单次授权已消费，不继续调用生成或编辑模型。

## 后续用户反馈

用户查看本页深色暂停菜单后反馈“还可以，接下来呢”。据此将该样本保留为当前菜单方向；这不等于浅色、其他面板或全部美术细节均获确认。原acceptance的视觉待确认状态记录的是生成验收当时的事实，保持不改写。

后续工作转向[精确按钮文案编辑核对](button-copy-checks.md)，没有新的模型调用。该工作改变了源码，原plan的冻结源码指纹不用于证明新版本；原方案、回执、技术验收及保存包保持。
