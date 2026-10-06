# 三次真实复验结果与原生引用校验修复

本次真实批次为 **FAIL**：按批准摘要 `ed0403964f1a8aee2189d67e3faef2bfad714053c0b8909327c839ab101f1358` 实际调用3次gpt-6-luna / xhigh，自动重试0。
方案、独立业务与编译3/3通过，但新增完整原文引用门禁仅2/3满足，因此没有继续该批浏览器或交付阶段。
原高级设置引文错误在本次单次复验中没有复发；这不是全16多轮稳定的结论。

## 实际结果

| 输入 | 方案/业务/编译 | 当前批次完整原文门禁 |
| --- | --- | --- |
| 原样高级设置 | PASS | 14处引用均为完整329个UTF-16单元原文 |
| 补充回答声音设置 | PASS | FAIL：3行引用同一个合法唯一35单元片段，未复制完整176单元原文 |
| 声音/显示双页签与进度条 | PASS | 5行＋tabs根节点＋2个page，共8处完整215单元原文 |

公开保存协议允许合法唯一短引文，因此声音方案确实通过当时的公共校验、业务与编译；不能将其说成业务缺失或编译失败。
本批原生响应schema额外要求完整原文，接受的返回对象没有兑现该枚举要求。现有证据不能进一步确定模型、CLI或服务端在哪一层没有兑现约束。
程序汇总在完整引文核对处停止，记录3次实际调用、FAIL和后处理NOT_RUN；独立审计另定位到声音输入，未改写原回执或返回。
三份回执用量已知：输入94231、缓存输入0、输出8589 Token。上一份32次的31/32与总体FAIL继续保留。

第一次宿主命令被自动审批超时拦住，CreateProcess未启动；根/子消费记录及运行目录均不存在。
按工具明确允许的一次启动重试成功，随后三个不同请求各调用一次；没有重试任何模型请求。

## 零模型修复

过去实际接受边界只运行公开兼容校验：原文内精确且唯一的短片段仍可通过。
新增[原生引用校验](../src/panel-intent.mjs)，在当前CLI的Intent 0.7公共形状校验之后、READY和接受文件保存之前，逐个核对每行、tabs根节点和page的`sourceQuote === context.request.text`。
违反时生成`CODEX_PROPOSAL_INVALID`与安全诊断`INTENT_NATIVE_QUOTE`，记录当前树路径，单次失败，不修补、不保存为接受方案、不重试。
该规则只用于当前CLI运输边界；公开`materializePanelIntent`及保存文件导入继续允许合法唯一短引文。

提示末尾过去仍说“prefer the complete sourceQuoteCopy”，与完整枚举要求冲突。
现在当前Context 0.7明确使用“必须等于完整复制值”的指令，不允许唯一短片段；旧Context的指令保持。
另用[新独立提示文件](../prompts/panel-intent-v0.7-native-quotes.md)清除相关导航短片段说明，并纳入执行指纹。
旧通用、旧v0.7、旧quote-guard提示字节全部保持；旧4193进程不会动态读到新提示。

77项本地回归通过，0跳过。新测试用假的CLI进程复现“schema要求全文、返回合法短引文”并确认拒绝、单次回执与接受文件不存在；同时保持保存协议兼容。
首次测试过程在提示字符串断言后中断，日志保留；第二次76/77，发现原测试助手将不同输入的回执绑定到默认上下文，修正助手后第三次77/77。
34份保存方案（此前31份＋本次3份）用新公开代码重放全部保持原方案/业务/Bundle；新原生校验能拒绝本次声音返回，另外两份符合约束，未改写输入。

新版Studio在 `http://127.0.0.1:4194/` 启动，旧服务保留，启动模型调用0。
导入本次通过完整引文门禁的高级设置，真实Pixi、滑条、重置、两组输入及窄屏入口8项检查通过；阻断所有非GET和外部请求，未点击生成/修改。
这8项是新服务入口检查，不能替代失败批次停止的三例验收。

## 仅一个样本的计划与随后执行

下述单次计划随后已批准并执行，结果仍为FAIL：第一行触发INTENT_NATIVE_QUOTE，实际1次、无重试，业务/编译/Pixi/交付未运行。
已进一步改为显式Intent 0.8请求来源绑定，当前Studio为4195；详见[最新单次结果与修复](request-reference-fix-results-2026-10-06.md)。以下保留当时的准备证据。

修复后只为声音输入准备一次新复验，不再重跑已通过的高级设置或分页样本。
[冻结计划](../output/native-quote-recheck-plan-v1/quote-recheck-plan.json)摘要：

```text
e1a07482b45bac831a94af7776e27e62c82cf54b5021fecc6eff9af5a363340b
```

模型gpt-6-luna / xhigh，最大1次、失败不重试。原声音请求、上下文和独立业务期望保持；203份源码、一个原生schema、库、构建、程序样本与预检证据均冻结。
准备时一个程序样本9项Pixi/实际ZIP下载/离线打开/重导入检查通过；宿主只读登录与错误摘要拒绝通过。当时新根/子消费记录和真实运行目录均未创建，模型调用0。
真实结果须通过方案、业务、编译与当前本地原生全文引用校验，之后才执行真实Pixi与交付检查；后处理不额外调用模型。
本轮3次授权已消费；[仓库AGENTS.md](../../../AGENTS.md)要求“A generation attempt requires one fresh, single-use authorization bound to an immutable plan digest.”，因此新摘要需要单独批准。
当时修复后的真实模型复验、新原生Unity运行和人工视觉验收均NOT_RUN。随后只执行已批准的一次真实复验并失败，未宣称全16稳定或新的组合认证。

## 程序证据

- [三次真实生产报告](../output/quote-recheck-run-v2/quote-recheck-report.json)与[独立审计](../output/quote-recheck-accepted-v2/acceptance.json)
- [三次结果入口](../output/quote-recheck-accepted-v2/index.html)，总体FAIL和逐项门禁保持
- [零模型修复与34份重放](../output/native-quote-fix-check-v1/check-report.json)
- [单例冻结计划](../output/native-quote-recheck-plan-v1/quote-recheck-plan.json)与[零模型准备审计](../output/native-quote-prepared-v1/preparation-audit.json)
- [单例程序样本9项浏览器与实际交付](../output/native-quote-recheck-plan-v1/fixture-browser/browser-report.json)
- [4194启动回执](../output/panel-studio-native-quotes-live-v1/launch.json)与[8项入口检查](../output/panel-studio-native-quotes-live-browser-v1/browser-report.json)
- [修复与待复验状态汇总](../output/native-quote-fix-accepted-v1/acceptance.json)
