# Intent 0.8：全16两轮稳定性与组合验收准备

本页保留准备时的状态。此计划随后获批，实际第一轮16次、业务15/16后按门禁停止，第二轮未运行；结果和修复见[执行记录](request-reference-stability-results-2026-10-06.md)。

状态：**LOCAL_PREPARATION_PASS_REAL_NOT_RUN**。本次没有新增模型调用；212份源码、32份实际响应schema和完整两轮计划已冻结，独立准备审计通过。当前Studio仍为 `http://127.0.0.1:4195/`。

根计划摘要：`a5f0775811f8798759dfad135304d7e6cd6493f21a535da2d219bd5245ccbcdf`。
使用gpt-6-luna / xhigh，最多32次：同16条需求独立生成两轮，每轮每条仅一次、自动重试0。第一轮独立需求完成后，任一生成、业务、编译、来源绑定、浏览器、组合或交付门禁失败，都不启动第二轮；剩余预算不用于重试。

## 固定范围

本轮完整请求和业务期望逐字保持原32次测试集，可比较同一输入在修复前后的表现；未将已保存结果或其它轮次的来源混入新cohort。16类包括声音、画质、控制、无障碍、通知、语言、主菜单、暂停、删除确认、存档、角色信息、任务、背包筛选、商店筛选、房间准备和长高级设置。
已经检查控件名称与请求描述相符，不应用双页签进度三例复验中的专用命名替代，也不在看到新返回后动态改写业务期望。

每轮依次完成：

1. 16份真实生成、严格业务期望和编译。保存返回必须是Intent 0.8，每个行/导航来源通过当前contextSha256和sourceRef=request绑定原始需求。
2. 16份真实来源的Pixi交互、只读内容、禁用按钮、事件、恢复默认、滚动、状态导出和文件重开。
3. 同一轮来源组成全16单列、全16双列、声音/画质/控制横排、声音双实例及五来源混合，验证布局、命名空间、事件和重置范围隔离。
4. 16份CLI交付ZIP检查CRC、文件大小、SHA和Pixi/Unity同源Bundle；另外逐份从Studio实际下载ZIP，解包后离线运行、重新导入，验证试玩状态保留。

浏览器、组合、导出和离线检查不额外调用模型。仅实际两轮全部通过后记为OBSERVED_TWO_ROUND_PASS；不将有限样本视为任意输入都可靠，不包含连续修改链、原生Unity运行或其它引擎认证。

## 已完成的零模型准备

33项相关回归通过，包括16类来源绑定和原失败用例，以及错误业务/来源仍拒绝的测试。没有改动模型运输、核心规格或通用业务比较器；仅强化两轮准备、运行和交付验收脚本。

程序夹具16个单面板、5种组合编译/结构检查通过；383项浏览器检查通过，实际下载21份ZIP，分别离线打开及重新导入。独立审计重新校验所有ZIP的CRC、文件摘要、展开文件、来源规格及Pixi/Unity一致性。这些明确是程序夹具，不能计作真实生成成功。

同环境CLI登录可见性预检通过，错误授权摘要在调用前拒绝。只继承现有本机代理到进程临时变量，未修改系统设置；预检不提交模型请求，真实网络连接和模型可用性仍未验证。新根/子消费记录不存在，真实运行目录未创建。

四份历史FAIL审计报告的原字节SHA保持，包括原32次、旧三例、旧单例及最新来源绑定三例原生产批次。最新三例同源修正期望后的独立PASS也保留，不计入本轮16类成绩。

- [冻结计划](../output/request-reference-stability-plan-v1/ordinal-stability-plan.json)
- [完整请求与期望](../output/request-reference-stability-plan-v1/suite.json)
- [夹具预览与交付包](../output/request-reference-stability-preparation-accepted-v1/index.html)
- [383项夹具浏览器检查](../output/request-reference-stability-plan-v1/fixture-browser/browser-report.json)
- [宿主零模型预检](../output/request-reference-stability-preflight-v1/preflight-report.json)
- [独立准备审计](../output/request-reference-stability-preparation-accepted-v1/acceptance.json)

[仓库AGENTS.md](../../../AGENTS.md)明确要求：“A generation attempt requires one fresh, single-use authorization bound to an immutable plan digest.”
前次三次授权已经消费；本次计划需要上述新摘要的一次决定，批准后才能执行最多32次真实调用。
