# 纵向 Tabs 通用接入记录 — 2026-09-14

用户授权“补齐吧”：为 Settings Dialog 左侧原生 Tabs 补齐消费端和拆分端，
本轮只执行本地代码、程序夹具与测试，没有媒体生成或私有服务调用。

正式字段见 [tabs-layout-v1](tabs-layout-v1.md)。Schema、导出验证、状态矩阵
复用消费端版本化 layoutPolicy；无字段继续旧横向合同。非法版本、字段、
缺项、顺序、重叠、尺寸、资源和摘要错误明确拒绝。

证据目录：`work/ui-decomposition/tabs-layout-v1-20260914-r001/`。

- 消费端构建通过，445 项离线测试通过。
- 拆分端全套运行 269 项：258 通过，11 项需显式启用的测试跳过；
  本次另外启用纵向 Tabs 浏览器测试并通过。
- Studio 最终 browser-r004 六项全部通过，覆盖独立页、Dialog、旧横向
  Tabs、键盘与模态行为。真实输入后检查逐项底板和图标像素、值和事件、
  内容显隐；保存重开及 ZIP 官方 CLI 往返保留方向和 v2 原始参考证据。
- producer-acceptance-r001 保存三种状态的真实 PixiJS 截图、矩阵及报告。
- 生产者 export_component_handoff 导出程序夹具，复制唯一 ZIP 到隔离
  目录后官方 CLI 可导入；未知参考状态仍未知，human_visual_acceptance=false。

Settings 原图 SHA-256 未变。新 `preflight-r002.json` 解除纵向能力阻断，
32 项生成计划已冻结于 execution-r001/runs/settings-r001；尚待新摘要授权，
尚未生成和验收该样本。没有覆盖历史预检或失败证据，没有提交。

限制：当前扩展只表达左对齐纵向原生项，不自动安排右侧内容，不补造未展示
页签内容，不构成人工视觉通过。夹具通过不等于 Settings 美术外观已通过。
