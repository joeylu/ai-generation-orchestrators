# 全局身份与明确名称：修复和三次复验计划

本页保留准备阶段证据；随后用户授权的三次真实复验全部连接失败，详见[执行结果与启动修复](ordinal-intent-recheck-2026-10-06.md)。
再次获得新摘要授权后，宿主临时代理路线三次复验3/3通过，详见[新路线成功复验](ordinal-intent-recheck-success-2026-10-06.md)。
准备阶段状态：**LOCAL_PASS_REAL_RECHECK_NOT_RUN**。修复已落地，654项本地测试通过；提示分离后相关59项再通过。
三个程序方案的Studio浏览器检查20项通过，冻结计划预检及错误授权摘要拒绝检查5项通过。
本轮模型调用0；原[真实验收](studio-input-stress-acceptance-2026-10-06.md)仍为13/16、总体FAIL，全16同轮组合仍未验收。

## 实际变化

当前Context 0.7的CLI新生成改为PanelIntent 0.7：模型不填写行、分组和页签ID，程序按树的深度优先顺序全局分配。
按钮resetRows/submitRows用0起始的整数行序号，所有页签和分组共用计数，文字与按钮也计入。
程序验证前向引用、类型、存在性、数量、重复引用和作用范围，再生成稳定字符串ID与公开PanelSpec。
新协议避免由模型重复填写身份；它不自动去重重复控件，也不替模型纠正业务顺序或错误范围。

保存的PanelSpec仍为0.7，编辑传输仍为0.3。旧Intent 0.6继续兼容读取，旧重复ID仍严格拒绝。
删除后不重新编号其余已有控件；绑定、事件、导出包、重新导入与编辑继续使用已有稳定ID。
普通、分组grid、嵌套树、跨页输入与前向提交/重置均有回归；没有改动Unity导出脚本。

新提示明确要求逐字保留完整标题、标签、按钮文字及选项，包括“仅”等限定词。
附加字面校验只覆盖明确“下一行”或编号行的开关/下拉名称，拦截“仅收藏”被写成“收藏”的情况。
同时存在明确命名的独立“收藏”行时允许该名称；模糊叙述没有被强行解析。
这是局部保护，不能保证所有自然语言名称都正确，也不能把“被拒绝”当作成功生成。

角色新测试明确写“面板标题必须是‘角色信息’”，原含歧义的输入与FAIL保留，不修改原期望来提高成功率。

## 已有Studio的兼容性

新版提示独立保存为[panel-intent-v0.7.md](../prompts/panel-intent-v0.7.md)，新代码按上下文选择它。
旧提示[panel-intent.md](../prompts/panel-intent.md)保持上一轮原始字节，SHA-256为
`3bd5f528e322dd8a9d954581d0700d058c551d35b75c8b0f9ea3562b2c561a35`。
已启动旧进程每次读取提示时仍取得原0.6合同；没有重启或切换当前4191服务。
新的静态构建位于`output/panel-studio-ordinal-intent-v1`，264资源记录、221PNG及原资源池摘要保持。
浏览器验收只启动随后关闭的隔离测试服务；没有写真实Unity工程或其他Harness。

## 三次真实复验

已消费的执行计划：intent-recheck-plan.json（本地产物：`../output/ordinal-intent-recheck-plan-v4/intent-recheck-plan.json`）。
SHA-256：`ca96ef40ffec0664fa27c7ee7e344093efdb58607ed104196e7e3b68d38186cc`。
完整三条输入与期望：suite.json（本地产物：`../output/ordinal-intent-recheck-plan-v4/suite.json`）。

计划绑定179份源码/协议文件、三个原生响应schema、三个完整上下文、资产库、静态构建和浏览器证据。
最多3次gpt-6-luna / xhigh：画质、角色、背包各一次；独立失败保留，其余独立项可完成。
失败不自动重试、不修补原返回，不替换原16类失败来源。生成后的浏览器重放与导出不新增模型调用。
三项全部通过也仅说明三次复验成功，不能据此改写原13/16或宣称同轮全16组合已通过。

运行入口为[scripts/run-intent-recheck.mjs](../scripts/run-intent-recheck.mjs)：`--preflight`只读且不写消费记录；
真实运行须`--approve-plan`精确匹配上面摘要，wx创建唯一消费记录后调用现有有限评测器。
准备阶段消费记录不存在；随后本计划已获授权并消费，三次均为CODEX_CONNECTION_FAILED_NO_RETRY。
父/子消费记录、失败回执与独立审计均保留。不得再用此摘要执行；新批次登录/代理环境门禁改变后，当前源码也不再匹配本计划。

## 证据

- 独立修复汇总（本地产物：`../output/ordinal-intent-fix-acceptance-v1/acceptance.json`）：654项、分离后59项、浏览器20项、预检5项以及旧提示字节核对。
- 浏览器报告（本地产物：`../output/ordinal-intent-browser-v1/browser-report.json`）：明确标为程序原生方案测试，模型调用0，不是真实生成成功率。
- 预检报告（本地产物：`../output/ordinal-intent-preflight-v2/preflight-report.json`）：当前v4摘要通过、错误摘要拒绝、父/子消费记录与未授权输出均不存在。
- [新原生协议回归](../tests/ordinal-intent.test.mjs)与[Codex传输回归](../tests/codex-planner.test.mjs)：原生schema与提示一致、原始接受方案单独保存、一次调用与不重试保持。

首轮准备v1因JSON写入接口不允许带子目录的文件名停止，没有调用模型或创建消费记录。
修正后v2准备通过；增加诊断脱敏产生v3，再为旧服务分离提示产生有效v4。
前三份准备产物保留，均未获授权/执行，不能拿其旧摘要调用当前程序。
首轮新增测试也曾因误用既有Patch API签名失败，修正测试驱动后全654项通过；没有伪造成功结果。
新Unity原生运行、人工视觉验收和触摸易用性均NOT_RUN。390×844只核对页面横向溢出，不能宣称移动视觉重排已验收。
