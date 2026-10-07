# 只读标签修复后：全16两轮验收准备

后续执行记录：本计划已获批，实际16次后因任务标题语义错误和画质传输失败停止，业务14/16、方案/编译15/16、总体FAIL，第二轮/后处理未运行。下面保留准备时证据；见[真实结果与标题补强](text-label-stability-results-2026-10-06.md)。

状态：**LOCAL_PREPARATION_PASS_REAL_NOT_RUN**。删除确认原样失败输入的一次真实复验已经PASS，9项真实交互与离线交付检查、修复Studio4196的9项入口检查通过；这不改变原16次批次15/16和FAIL。

新的完整cohort计划摘要：`75989f29dfd3921790fd1cf6db3da3845c7a20da0f89b489f65dd20a8328fb8e`。
模型gpt-6-luna / xhigh，最多32次，同16条输入各自独立生成两轮。每条每轮一次、自动重试0，最多4个独立请求有限并发；第一轮任何门禁失败都不进入第二轮，不挪用未用预算重试。

## 可比较的固定范围

完整16条需求和业务期望与原32次及最近16次逐字一致，包括声音、画质、控制、无障碍、通知、语言、主菜单、暂停、删除确认、存档、角色、任务、背包筛选、商店、房间和长高级设置。
删除确认仍严格要求label“提示”、text“删除后无法恢复”，没有别名或放宽要求。新提示/schema说明与原生接受门禁已冻结；全部原始0.8返回需要当前上下文摘要和每个行/导航的sourceRef=request。

每轮全部16份新真实结果依次通过业务、编译、来源绑定、Pixi真实交互/只读内容/禁用按钮/事件/重置/滚动/状态导出重开；再用同一轮来源构建全16单列、全16双列、三设置横排、声音双实例和五来源混合，检查交互及状态/事件/重置范围隔离。
最后校验16份CLI交付ZIP的CRC/大小/SHA/Pixi与Unity同源Bundle，并从Studio实际下载各个ZIP，展开后离线运行和重新导入，验证试玩状态保持。
所有后处理不额外调用模型，不从旧轮次或这次单例抽取来源补齐新cohort。

## 准备证据

707项本地回归通过；16个程序夹具和5种组合结构/编译及383项浏览器检查通过，实际21份夹具ZIP分别离线打开、重新导入并经独立CRC/摘要/展开文件/同源规格审计。夹具不能计为模型生成成功。
214份源码、32份实际0.8响应schema、原样请求/期望、资产和静态构建已冻结。同环境登录可见性预检和错误摘要拒绝通过，真实模型调用0；真实连接与模型可用性未通过预检验证。
新根/子消费记录0，新真实运行目录不存在。五份历史FAIL审计报告原字节SHA保持，一次删除确认真实PASS的报告也保留。

- 冻结根计划（本地产物：`../output/text-label-stability-plan-v1/ordinal-stability-plan.json`）
- 原样16条需求与期望（本地产物：`../output/text-label-stability-plan-v1/suite.json`）
- 程序夹具预览与交付包（本地产物：`../output/text-label-stability-preparation-accepted-v1/index.html`）
- 383项夹具浏览器检查（本地产物：`../output/text-label-stability-plan-v1/fixture-browser/browser-report.json`）
- 宿主零模型预检（本地产物：`../output/text-label-stability-preflight-v1/preflight-report.json`）
- 独立准备审计（本地产物：`../output/text-label-stability-preparation-accepted-v1/acceptance.json`）
- [已通过的删除确认真实复验与4196](text-label-real-recheck-2026-10-06.md)

只有两轮实际全部门禁通过，才记录OBSERVED_TWO_ROUND_PASS；不代表任意自然语言输入可靠。连续修改链、原生Unity、其它引擎及人工视觉认证不在本次范围。

[AGENTS.md](../../../AGENTS.md)明确要求：“A generation attempt requires one fresh, single-use authorization bound to an immutable plan digest.”
之前32次计划已按第一轮失败终止，单例授权也已完成。新的32次仅在用户批准本摘要后执行，不能沿用旧授权。
