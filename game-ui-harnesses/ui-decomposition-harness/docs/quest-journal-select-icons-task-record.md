# Quest Journal 新素材全链路验收记录

2026-09-14，在 tony 分支继续 Select optionIcons 1.0 通用接入后的真实样本验证。
唯一字段沿用消费端 `docs/select-option-icons-v1.md`；没有第二套图标格式。

## 新生成与来源

原图：`work/ui-component-harness/samples/decomposition-input-r001/05-quest-journal-open-select.png`。
原始字节 SHA-256：`1740bf0983c636097e572dff65d4645d6d74c605714e044b0de3763d80aa2287`。
不是重新验收旧 Quest Journal 包。

首次 native 计划收到场景和一张带绘制棋盘格的 RGB 面板；后者正式导入被
`TRANSPARENT_RESULT_REQUIRED` 拒绝。该失败和原始字节保留，剩余请求没有发出。
用户随后明确授权 keyed 修订计划
`0c5b43140ef8f45d4f012d1e024d4f78c6d4840d192a7a2458ea1d2a64ef57c0`：
30 次新图像调用，零自动重试；仅正式复用本轮此前已验证的新场景。
30 次全部收到。两阶段实际总调用 32 次，其中 1 张 native 面板拒绝。
没有调用额外视觉模型服务，也没有在回归测试中调用媒体服务。

工作目录：`work/ui-decomposition/quest-journal-keyed-fullchain-20260914-r001/`。
`material-audit-r001` 保留进度空槽/填充比例失败；`fit-r001` 及后续
`registered-r001` 至 `registered-r004` 均为零生成、原始 received 指纹绑定复用。
空底板九宫格、菜单 235→234px 派生、样本注册和独立 shared 图标图层均走正式
freeze/reuse/process/finalize/export，不手改交付回执或旧 manifest。

## 最终交付

`acceptance-r006/ui.component-handoff.draft.zip`

SHA-256：`90e06ac1ba23593c76ec06308d459731d40d16862437271037572e40994e7477`。

v2 单包保留原图、标准化派生图及映射、观察/未知参考状态、验收范围、组件和图层。
41 个语义节点、11 类组件、51 个图层；8 个有状态组件共 26 个合同状态，
Select 加测鼠标/键盘后为 29 个真实浏览器案例、214 项检查，全通过。
`studio-r006/report.json` 的 23 项实际 Studio 检查全通过，包含菜单独立图标、
鼠标/键盘、按钮 activate、滚轮/拖动/键盘零范围行为、保存/重开和 ZIP 再导出。
`isolated-r003` 为只复制最终 ZIP 后的官方 CLI 导入证据。
本轮完整离线回归 257 项：247 通过、10 项选择性测试跳过；另启用的 7 项定向测试通过。

## 通用能力与样本派生的边界

Select 图标 schema、摘要/几何校验、状态矩阵、真实输入像素验收和关闭生命周期检查
已修入通用链路；离线程序夹具见 `tests/test_select_option_icons.py` 和
`tests/test_stateful.py`。素材生成、抠图、九宫格、完整 v2 包、未知字段、Tabs shared
来源、滚动留白及数值文字均复用已有正式能力。

本样本的具体坐标、九宫格参数、文案和图标语义属于样本提案，不能宣称通用程序能
自动识别任意图案、文字或装饰。生成面板分隔线比原图约高 20px，因此 CheckBox
调整到 x866、y150/184，REGION 标签 y141，详情标题 y519；均在 acceptance scope
记录为派生布局，不冒充原图状态恢复。
右侧纸签文字使用 x1450、y632、Arial 22；底部纸张文字使用 x735、y940、Arial 18。
两者保留观察到的文案，直排替代原手写旋转样式，并明确记录为派生布局。

## 明确未通过的部分

- 原始 scrollX/scrollY 仍未知；官方 `reference-acceptance-r003` 状态为 blocked。
  现有消费端将此次整页比较标为 unknown-state dependency；没有 41 个视觉通过。
- 滚动条常显；contentHeight594、viewportHeight596，真实范围为零。
  实测端部留白 top33、bottom34，轨道600px，可用533px，滑块按比例填满可用区域。
  原图短滑块外观差异保留，没有补造内容或修改原图。
- `delivery-check-r004` 为 failed_visual_qa：原图与运行时未知/已知滚动状态不等同，
  且四个文字控件未建立完整 baseline/letter-spacing 证据。Arial 字号、内容与实际
  边界已有检查，不能据此虚构源字体基线。
- completed/archive 无原图内容证据；只验收 header 切换，不补造任务数据。
  List 选中其他项不会生成对应详情；筛选业务不在该草稿中。
- 图案纹理、背景、面板比例、文字书写风格及进度段线存在生成/派生差异。
  不透明核心像素匹配不等于所有半透明边缘或任意重画图标识别。
- 所有 `human_visual_acceptance` 保持 false；待用户查看最终截图确认。

完整中文报告、截图和最新回归结果见工作目录 `交付报告.md`。
未覆盖历史包、未回滚其他修改、未提交共享工作区改动。

## 2026-09-14 后续：显式授权底部留白

用户明确撤销本样本零范围运行布局约束，授权在594px已有内容后追加22px空白，
保持596px视口，形成20px真实滚动。新规则见 [底部留白规划](scroll-bottom-space-v1.md)。
只修改现有contentHeight为616，六项内容和局部位置不变；always、600px轨道、
33/34px端部留白不变。原图、映射及未知滚动参考状态保持字节/字段一致，
acceptance-scope仅更新该组件的派生运行布局，比较区域未排除。

新交付：`work/ui-decomposition/quest-journal-bottom-space-20260914-r001/acceptance-r001/ui.component-handoff.draft.zip`。
SHA-256：`758f29d9add5e4765012ba5cdea62dbd15b424b69386058b54e87e21fcd2ce2e`。
29浏览器案例/214检查通过，实际Studio58检查通过；滚轮、鼠标拖动和键盘真实值
均在0～20，边界无无效事件；保存重开、导出及官方CLI再导入通过。
完整离线回归265项，255通过、10跳过。原始未知状态仍导致视觉比较blocked，
human_visual_acceptance=false。没有媒体生成或消费端代码修改。
完整证据在该新工作目录`交付报告.md`；本节保留上轮零范围历史，不覆盖旧包。

用户随后确认当前新包无问题，并反馈消费端已经测完。本轮交付收尾；
见 [包外人工确认记录](quest-journal-human-review-20260914.md)。
不改写历史包内人工标记或自动视觉结果，不推断尚未读取的消费端独立测试细节。
