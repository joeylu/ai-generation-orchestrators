# 三次授权复验结果与启动环境修复

本页保留前一批连接失败和下一份计划准备阶段的记录；随后用户授权的新路线三次均通过，见[成功复验](ordinal-intent-recheck-success-2026-10-06.md)。

状态：**REAL_RECHECK_FAIL_NO_VALIDATED_OUTPUT**。画质、角色、背包各启动一次gpt-6-luna / xhigh，全部在连接阶段失败。
这不是三个错误UI方案：没有返回可验证的Intent/Proposal，没有新编译、Pixi浏览器重放或导出来源。
原16条同轮验收仍为13/16、总体FAIL，全16组合仍未通过来源门禁。

## 授权与真实证据

用户授权已消费的根计划SHA-256：`ca96ef40ffec0664fa27c7ee7e344093efdb58607ed104196e7e3b68d38186cc`。
子评测计划SHA-256：`dc75b4ee0ea64e6e17d6ea5ae1aec0f86ad52e7a9357a23097cb5956c7c077f8`。
父/子唯一消费记录和每次生产回执均保留，不复用授权，也不把失败改写为成功。

| 用例 | 实际进程次数 | 结果 | 业务/编译/浏览器/交付 |
| --- | ---: | --- | --- |
| eval-graphics | 1 | CODEX_CONNECTION_FAILED_NO_RETRY | NOT_RUN |
| eval-character | 1 | CODEX_CONNECTION_FAILED_NO_RETRY | NOT_RUN |
| eval-inventory | 1 | CODEX_CONNECTION_FAILED_NO_RETRY | NOT_RUN |

[生产报告](../output/ordinal-intent-recheck-run-v1/evaluation-report.json)与
[独立审计](../output/ordinal-intent-recheck-acceptance-v1/acceptance.json)核对三个请求上下文、失败回执、授权消费、零接受方案及原FAIL保留。
审计时179份冻结源码匹配；随后加入启动环境门禁改变源码，不据此覆盖当时审计或再次执行旧计划。
总实际进程3、Harness自动重试0。三份usage均null，服务端是否接受与Token用量UNKNOWN，不能写成0 Token或确认未计费。

## 发现与修复

这次我错误地从禁止联网的外层沙箱启动了真实批次。只读TCP检查得到EACCES，CLI登录状态在该环境不可见；
同一CLI在宿主执行环境能够读到已登录状态。外层网络限制也会作用于子进程，见
[OpenAI代理审批与安全说明](https://learn.chatgpt.com/docs/agent-approvals-security)。
模型进程自身的read-only sandbox、禁工具和禁自动重试配置保持；修复不放宽这些限制。

宿主直连公网TCP仍超时，HTTP/HTTPS代理环境变量缺失；系统已有代理的匿名HEAD能收到HTTP响应。
匿名403/421只证明收到HTTP响应，不证明登录、额度、所选模型或推理服务可用。
只读核对另一链路的既有证据发现进程临时代理路线曾完成真实请求，但这也不是本轮模型连接的成功证据。

新增[CLI运行环境预检](../src/codex-runtime-preflight.mjs)，在同一进程环境执行一次`codex login status`，要求成功退出与可识别的正面状态。
无命令、超时、启动失败、未登录或未知状态全部拒绝；不保存原始CLI输出、账户、密钥、代理地址、主机路径或环境变量值。
不使用继承的CODEX_SANDBOX_NETWORK_DISABLED单独判断可运行性：宿主执行环境也可能保留该标志。

[有限批次运行器](../scripts/run-intent-recheck.mjs)在创建dispatch-claim和启动模型前执行预检。
冻结计划选择explicit-process-proxy时，缺少HTTP_PROXY或HTTPS_PROXY即提前拒绝；这些变量存在不等于网络已通过。
可用[scripts/check-codex-runtime.mjs](../scripts/check-codex-runtime.mjs)单独做零模型调用的脱敏登录可见性检查。
本地忽略目录中的启动器读取系统现有回环代理，只给当前启动进程及子进程设置临时变量，结束后恢复原值。
没有登录、退出登录、改全局代理、CLI配置或真实Unity游戏工程；4191服务和旧动态提示保持。

## 验证范围

- [76项相关回归](../output/ordinal-runtime-guard-tests-v2/test-report.json)通过：仅测试替身，覆盖拒绝先于消费/推理、超时不重试、脱敏、指定代理缺失拒绝，以及既有协议/编辑/表单回归。早期75项记录保留，不能相加为151项。
- [实际沙箱预检](../output/ordinal-runtime-guard-sandbox-v1/preflight-report.json)拒绝不可见登录，零模型调用、未创建父/子消费记录。这是旧inherit路线v5的历史检查。
- [指定代理但环境缺失的预检](../output/ordinal-runtime-guard-missing-proxy-v1/preflight-report.json)拒绝启动，错误摘要也拒绝，无消费或推理输出。
- [进程临时代理及宿主登录预检](../output/ordinal-runtime-guard-proxy-host-v1/preflight-report.json)通过，核对181份源码及错误摘要拒绝，模型调用0、消费记录0。

检查报告明确network/modelAvailability为NOT_CHECKED；当前真实模型连接仍未验证。
[独立启动门禁汇总](../output/ordinal-runtime-guard-acceptance-v1/acceptance.json)另核对新计划181份源码、旧失败报告摘要、
原提示字节与新消费记录缺失；相对原授权计划只改变两份批次脚本，新增预检模块与命令，其他冻结源码保持。
一次诊断误用Node运行PowerShell脚本，在解释器阶段停止；改用PowerShell后完成上述只读预检，没有模型调用。
旧准备v5由加入明确代理路线的v6取代，v5不用于当前执行。

## 下一份有限计划

新[冻结计划](../output/ordinal-intent-recheck-plan-v6/intent-recheck-plan.json)：
`8cf2578876300bb6a2c6369058a8596109ad8019ae8b69befacdf8bdb2ff6478`。
181份源码、三个原生schema、完整请求上下文、资产库、静态构建和已有零模型浏览器证据绑定；
明确要求explicit-process-proxy和提交前登录可见性检查。
画质、角色、背包各最多一次，共最多3次gpt-6-luna / xhigh，独立失败保留，失败不重试、不修补返回。
准备时本计划仅PREPARED、未获新授权、未消费，模型调用0；随后用户明确允许这最多3次，现已执行并消费。
真实运行、生产回执与独立成功审计见上面的成功复验页，不覆盖本页前一批FAIL。

仓库[AGENTS.md](../../../AGENTS.md)要求“a fresh, single-use authorization bound to an immutable plan digest”，
不确定请求也需新的用户决定。上一份3次已启动并消费，因此本计划执行前必须有针对新摘要的新授权。
即使三项后续都通过，也不覆盖原13/16失败记录，不等于同轮全16组合或多轮稳定已通过。
新原生引擎运行、人工视觉验收和触摸易用性本轮均NOT_RUN。
