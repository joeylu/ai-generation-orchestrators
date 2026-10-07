# 全16新批次：明确只读标签失败及本地修复

本页保留原批次和修复准备时的状态。下述单次计划随后已获批并真实通过；修复版4196与结果见[一次真实复验](text-label-real-recheck-2026-10-06.md)。原16次15/16与FAIL保持。

按批准摘要 `a5f0775811f8798759dfad135304d7e6cd6493f21a535da2d219bd5245ccbcdf` 执行gpt-6-luna / xhigh，实际16次、自动重试0。第一轮方案与编译16/16，业务15/16；按计划停止第二轮，浏览器、组合及交付均NOT_RUN，原批次总体**FAIL**。未将剩余16次预算用于重试或其它需求。

## 真实失败与审计

删除确认需求明确写：“先一行只读提示，标签就是提示，显示‘删除后无法恢复’”。原文采用中文双引号；模型返回的只读行却为label:"删除后无法恢复"、text:"删除后无法恢复"，遗漏明确标签“提示”。
取消与确认删除按钮、原只读内容、标题和无可变状态均保留；业务用例的行标签/顺序与标签唯一性检查失败。这是违反明确事实，不是允许的展示命名替代，验收期望保持。

修改源码之前独立审计212份冻结源码、根/第一轮消费记录、16次真实回执、原始Intent与proposal/Bundle。16份Intent均为0.8，共73处请求来源引用通过原边界验证；来源绑定不代表业务理解正确。所有实际结果和本轮FAIL保留。
16份回执用量均已知：输入426126、缓存输入0、输出15510 Token。第二轮消费记录与运行目录不存在。

## 已落地的零模型修复

新增独立[当前原生提示](../prompts/panel-intent-v0.8-text-labels.md)，明确区分只读行标签label与内容text；当前响应schema对这两个字段分别说明，并展示可直接从请求摘录的明确标签/内容对。
原生CLI接受边界新增INTENT_TEXT_LABEL：仅对支持的连续明确字面句式，若实际text匹配指定内容，却将标签换成不允许的值，就拒绝返回。程序不改写label或text，不自动重试，也不重新生成原结果。
这是窄约束，不是通用自然语言解析器。未命名、非支持句式、条件/历史/示例/带修正或补充回答的输入交由正常解释；同样内容分别放在多个明确标签下可以保持。其它缺失或错误业务仍由既有业务判断处理，不以来源或命名检查替代。

所有旧提示字节保持；已保存Intent的公开读取和物化行为保持。16份本轮保存方案兼容重放，业务仍为原15/16；新原生门禁明确拒绝原删除确认的替换，另外15份通过，未修改成功率。
707项全量本地回归通过，包括复现标签替换的真实失败形态、负例/条件/历史/后续修正、同内容多标签、页签路径和CLI单次失败回执。失败响应不保存接受Intent或proposal，不修补原值。
一个程序删除确认夹具9项浏览器/交付检查通过，标签“提示”和内容“删除后无法恢复”分别渲染；实际ZIP经CRC/摘要/同源Bundle审计，可离线打开并重导入。
修复额外模型调用0，真实验证尚未运行。当前4195服务保留，本次后台修复尚未切换到该已启动进程；其他链路和Unity项目未改动。

## 只针对失败用例的新计划

新摘要 `c06f7dba0063f71759de380d06c635689af0f1cfe92c6559b975bf8cc97a62be`，gpt-6-luna / xhigh，最多1次。请求与业务期望和本次eval-confirm原样相同，207份源码、一个实际schema、资源/构建和夹具交付已冻结。
宿主只读登录可见性及错误摘要拒绝通过；不提交模型请求，真实连接与模型可用性仍未验证。根/子消费记录不存在。
通过后才检查这个真实来源的独立标签渲染、交互及实际下载/离线/重导入，不把这一例当作全16两轮或组合认证。

- [本轮原FAIL审计](../output/request-reference-stability-accepted-v1/acceptance.json)与[运行入口](../output/request-reference-stability-accepted-v1/index.html)
- [本地修复审计与下一例](../output/text-label-fix-accepted-v1/acceptance.json)
- [修复夹具预览](../output/text-label-recheck-plan-v1/fixture-browser/eval-confirm-delivery/pixi/index.html)
- [单次冻结计划](../output/text-label-recheck-plan-v1/quote-recheck-plan.json)
- [原样请求与业务期望](../output/text-label-recheck-plan-v1/suite.json)

[仓库AGENTS.md](../../../AGENTS.md)要求：“A generation attempt requires one fresh, single-use authorization bound to an immutable plan digest.”
原32次计划已经消费并按失败门禁终止，剩余预算不能换到新摘要。新的单例需用户决定后执行，失败不重试。
