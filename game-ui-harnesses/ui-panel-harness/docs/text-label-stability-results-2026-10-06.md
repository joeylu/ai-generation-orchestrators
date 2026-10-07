# 本次全16真实结果与标题解释补强

后续记录：本文件下方的两例计划随后获批，实际2次无重试，业务/编译/来源绑定2/2及23项真实浏览器/离线交付检查通过，修复Studio4197已启用。见[两例真实复验结果](panel-title-real-recheck-2026-10-06.md)。原16次14/16和FAIL不改变，下方保留原执行及准备时证据。

状态：**FAIL**。批准计划 `75989f29dfd3921790fd1cf6db3da3845c7a20da0f89b489f65dd20a8328fb8e` 后实际调用16次 gpt-6-luna / xhigh，自动重试0。第一轮方案/编译15/16、业务14/16；按约定第二轮及浏览器、组合、交付未运行，剩余16次没有挪用。

| 用例 | 真实结果 | 原因 |
| --- | --- | --- |
| 任务详情 | 方案/编译PASS、业务FAIL | panel.title 返回“森林巡逻”，原样需求的面板名称是“任务详情”；“森林巡逻”属于任务名称行的显示内容。section.title 正确不能代替 panel.title。 |
| 画质设置 | 调用FAIL、后续NOT_RUN | CODEX_TRANSPORT_FAILED_NO_RETRY；没有接受方案，服务端是否计算与 Token 用量未知。不能记为0用量或已修复网络。 |
| 其余14类 | 方案/业务/编译PASS | 包括此前失败的删除确认，本次保留 label“提示”、text“删除后无法恢复”。这不等于交互和交付已验收。 |

改源码之前完成独立审计：214份冻结源码、根/子消费记录、16份调用回执、15份原始Intent与proposal、69处来源引用及旧证据指纹核对通过。15份已知用量：输入401836、缓存0、输出12866 Token；画质一份未知。历史五份FAIL、删除确认单例PASS均原字节保持。

- 真实独立审计（本地产物：`../output/text-label-stability-accepted-v1/acceptance.json`）
- 真实结果入口（本地产物：`../output/text-label-stability-accepted-v1/index.html`）
- 原生产报告（本地产物：`../output/text-label-stability-run-v1/ordinal-stability-report.json`）

## 本地规则补强

新增独立 `panel-intent-v0.8-panel-titles.md`，说明面板整体标题、分组标题和只读字段内容的不同用途，覆盖本次原样失败描述。当前Context 0.7 CLI选择这份提示，原生schema的两个title字段同步说明；执行协议指纹包含新提示。

程序没有从任务字段推断或强制标题、没有改写模型返回、没有放宽原样业务期望。明确用户命名、后续更正或要求把字段值作为标题仍由模型结合完整需求解释。旧提示字节和旧保存schema保持。

新增回归保留本次标题错误为FAIL，正确标题与三行只读内容独立通过原样期望；CLI测试双确认实际发送新的提示/schema，一次响应、无重试。全量714项通过，无跳过、stderr为空。15份本轮接受方案可原样重放，任务语义仍FAIL；画质仍没有接受输出。

支持从原回归目录选择1～3个固定用例，新两例选择不改变请求或期望；重复、未知、空项、冲突和超量选择拒绝。冻结计划中的最多调用次数和每项一次、失败不重试门禁保持。

任务与画质两个程序夹具通过23项浏览器检查，包括实际面板标题/文本/标签渲染、交互、ZIP下载、CRC/摘要/展开文件、离线打开及试玩状态重新导入；两份夹具包经独立审计通过。这些是程序夹具，不计为新的真实生成成功。

- 本地补强与两例夹具预览（本地产物：`../output/panel-title-fix-accepted-v1/index.html`）
- 本地补强独立审计（本地产物：`../output/panel-title-fix-accepted-v1/acceptance.json`）

## 仅两例的新真实复验计划

摘要：`de0006cfbbcdf55b84a386d0068ba2b836cb2c87f35213e3624d7465a2adc44c`。

gpt-6-luna / xhigh，最多2次：原样任务需求一次、原样画质需求一次。任何调用失败不重试，后处理不调用模型；生成、业务、编译、来源绑定及浏览器/离线交付都必须通过。209份源码、2份实际schema、资产、静态构建和夹具证据已冻结。

同环境只读登录可见性预检、错误摘要拒绝通过，新增模型调用0，根/子消费记录0，真实运行目录不存在。网络与模型可用性未验证。Studio4196和旧服务保持，本地补强尚未切换到该旧进程。

- 两例冻结计划（本地产物：`../output/panel-title-recheck-plan-v1/quote-recheck-plan.json`）
- 原样需求和期望（本地产物：`../output/panel-title-recheck-plan-v1/suite.json`）
- 23项程序夹具浏览器检查（本地产物：`../output/panel-title-recheck-plan-v1/fixture-browser/browser-report.json`）

两例通过仍不能拼接成全16成功；需要另行准备并授权新的完整两轮和同轮组合验收。原生Unity、其他引擎和人工视觉验收本次NOT_RUN。

[AGENTS.md](../../../AGENTS.md)要求：“A generation attempt requires one fresh, single-use authorization bound to an immutable plan digest.”
原32次计划已按第一轮失败停止，不能挪用第二轮预算；新两例摘要需要独立授权。
