# 2026-09-15 Studio / 构图验收收尾

用户反馈：“刚刚的新包测试没问题了”，随后授权按建议记录、提交及规划后续样本。
本记录将反馈绑定到最近交付的 Skill Library r009-01 滑块三段切片包：
`work/ui-decomposition/skill-library-portrait-fullchain-20260914-r001/thumb-slices-r009-20260915-r001/acceptance-01/ui.component-handoff.draft.zip`。
SHA-256：`84f6689ee46facb214501e82ea6fd183493d5db9cae35dc901fdfcec8f437b8a`。

这是用户报告的下游测试无问题；没有收到本次下游逐项测试日志，不补造测试数。
不等于明确的人工视觉批准。human_visual_acceptance保持false，原严格视觉限制保留。
无需重新跑这张图或重新生成素材。

## 本次提交边界

独立归档通用Studio/构图验收入口、测试、文档及CLI/SKILL对应片段。
其他任务的消费端修改与更早的拆分端混合修改保留在工作区，不打包提交。
尤其不能把这次提交描述为“整个UI链路的全部未提交修补已经归档”。

证据：`work/ui-decomposition/studio-composition-mainline-20260915-r001/report.md`。
379项回归中362通过、17跳过；正范围与零范围本地Studio夹具均通过。
真实Skill Library通过通用Studio入口；参考文件、映射和保存往返保留。

## 下一轮样本

既有计划中的窄屏列表方向已经由Skill Library提供真实样本，设置方向也已有
Settings任务记录与交付目录。下一轮优先选原计划C：**中文/英文混排的表单详情页**。
这是候选规格，不是已找到的新参考图，也未启动生成。

主要验证Text换行/省略、Input编辑/placeholder、Select展开及选中项、按钮底部间距，
如参考确有进度数值再包含ProgressBar及其文案绑定。不凑满16类。
检查系统字体实际fallback、窄容器长标签、弹出菜单遮挡、焦点顺序和保存往返。
普通键盘测试不算IME或物理移动端覆盖。

先确定参考图和实际组件，完成合同/适配器与布局预检，再冻结新计划并取得新的
生成摘要授权。含ScrollView时明确底部留白和真实内容范围；不默认追加20/24px。
新通用入口只对其支持的纵向always/insets配置作保证；其他配置在生成前说明缺口。
构图背景采样与可见行间距需要明确依据，未检查项必须报告。

16/16仍只是历史样本类型出现覆盖，不升级为全部布局/状态/风格均已验收。
