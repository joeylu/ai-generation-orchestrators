# 当前组件覆盖索引

2026-09-13 Panel 数值绑定收尾后的更新盘点：
`work/ui-decomposition/component-coverage-audit-20260913-r002/盘点报告.md`
及该目录 coverage.json（包内实际类型、摘要、原图未知字段、证据来源）。

6 份已核对的真实参考 v2 包合计出现 16/16 类；统一状态适配器 12 类，
Image/Text/Container/Panel 为静态或组合验收。出现不等于全部状态/风格验收。
角色创建 Input/RadioGroup 和 CHARACTER Panel 缺口已补；此前盘点保留历史状态。
用户确认仅针对展示的 CHARACTER Panel 组合；包内旧人工标记不被自动改写。

此前推荐：已确认五图集 Quest Journal 完整重跑（下文记录已完成结果）。
2026-09-14 消费端 Select 逐选项图标合同已接入拆分端 schema、导出校验、
默认隐藏菜单分层和统一状态验收；真实程序夹具通过 6 个鼠标/键盘状态检查。
完整拆分端测试 257 项（247 通过、10 跳过），另启用的 9 项定向测试通过，
包含旧 Select 与既有组件浏览器回归。这不增加“真实样本已生成”的覆盖数。
证据：`work/ui-decomposition/select-option-icons-producer-20260914-r001/验收报告.md`。
以上为程序夹具接入时的状态，原预检和历史产物保持不变。

2026-09-14 后续 Quest Journal 已从原图完成新美术生成和 v2 交付：
`work/ui-decomposition/quest-journal-keyed-fullchain-20260914-r001/acceptance-r006/`。
11 类组件、8 个状态组件、26 个合同状态，29 个真实浏览器案例/214 项检查通过；
实际 Studio 23 项检查通过。原始滚动值仍未知，官方整页视觉比较 blocked，
人工标记 false。此次替换 Quest 的技术覆盖证据，不增加独立样本种类数，
也不把 16 类的“出现覆盖”提升为全部状态/风格覆盖。
细节见 [Quest Journal 记录](quest-journal-select-icons-task-record.md)。

2026-09-14 最新版本追加经授权22px底部留白，contentHeight616、viewport596，
真实滚动范围20px。使用 `quest-journal-bottom-space-20260914-r001/acceptance-r001/`
的新版ZIP，29浏览器案例/214检查与实际Studio58检查通过；完整离线回归
265项，255通过、10跳过。用户确认当前新包无问题，并反馈消费端已测完，
本轮样本收尾。独立消费端测试细节未在此重复推断。
见 [人工确认与收尾](quest-journal-human-review-20260914.md)。
原包及自动视觉限制保留；下一轮应按未覆盖状态、组件组合与不同布局选样，
不再把Quest Journal完整重跑列为待办，也不提升16类的全部状态覆盖结论。

后续选样与真实输入回归要求见 [下一批测试计划](next-sample-test-plan-20260914.md)。
底部留白通用规则已独立提交ec1f617；Select及其他共享增量仍在工作区等待按功能归档。
