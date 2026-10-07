# 全16两轮真实结果与精确引用修复

真实批次状态：**FAIL**，32次调用中31份通过方案、业务语义和编译。
第一轮完整通过，第二轮高级设置因原文引用校验失败而停止后续门禁。
修复状态：**LOCAL_FIX_PASS_REAL_NOT_RUN**，61项本地回归、31份成功方案重放、16份新schema和8项Studio入口检查通过，修复后新增模型调用0。
当前修复版Studio为 `http://127.0.0.1:4193/`，旧4192/4191服务保留。

## 实际调用与验收结果

用户明确批准冻结计划（本地产物：`../output/ordinal-stability-plan-v1/ordinal-stability-plan.json`）：
`bdfd27b901fa4a613bcc5051e1d5721c1935c5d6e7f4b60df8fe00bfd5c47954`。
宿主环境沿用进程临时代理，gpt-6-luna / xhigh共32次，每个请求每轮一次，Harness自动重试0。
第一轮全部门禁通过后才进入第二轮；第二轮模型门禁失败，未运行该轮浏览器、组合和交付。
父/两子一次性消费记录全部保留，没有剩余额度，也没有修复调用或第四种探测请求。

| 验收 | 第一轮 | 第二轮 |
| --- | --- | --- |
| 控件配方检索 | 16/16 | 16/16 |
| 方案、业务与编译 | 16/16 | 15/16 |
| 单面板Pixi交互 | 16份、170项PASS | NOT_RUN |
| 同轮来源组合 | 5份、217项PASS | NOT_RUN |
| 交付ZIP完整性 | 16份PASS | NOT_RUN |
| 真实调用 | 16 | 16 |

组合包含全16单列、全16双列、声音/画质/控制横排、同一声音双实例、角色/房间/商店/语言/任务混合。
检查覆盖实际控件操作、禁用行为、重置隔离、滚动聚焦、事件、状态导出与文件重开。
交付包检查独立CRC、全部文件SHA与大小、Pixi/Unity源Bundle一致性；本轮没有逐份解包浏览器检查或新的原生Unity导入。
两轮保持相同请求与期望，未从另一轮或旧样本替换失败项。原13/16批次与原全16组合NOT_RUN继续保留。

独立审计在修复之前核验全部207份冻结源码，并重新materialize31份原始接受的Intent 0.7，逐份比较公开方案与Bundle。
32份回执用量均已知：输入894414、其中缓存输入32256、输出49349 Token；缓存输入是输入子集，不额外相加。
业务成功率31/32仅描述本次固定输入，不能换算成任意用户需求的保证。

## 高级设置失败与修复

第二轮高级设置诊断为`CODEX_PROPOSAL_INVALID`，底层`INTENT_QUOTE`，
位置`$.panel.sections[0].rows[5].sourceQuote`。该引文不存在于原文或不唯一；原始失败返回未保存，
因此不能断言具体字符被改写或直接重放那个失败对象。返回JSON摘要与安全诊断保留，未手改模型返回。

本次针对该类失败，让当前原生CLI的所有Intent 0.7行、tabs根节点和page的`sourceQuote`引用
同一个`$defs.exactRequestQuote`，枚举值仅为本次完整`context.request.text`。
完整引文由程序绑定；每行仍独立填写业务事实，原文区间仍由程序计算，全部业务、证据与编译门禁继续执行。
这约束本次原生输出格式；已保存方案和外部导入中的精确唯一短引文仍可按原合同校验。

[新提示文件](../prompts/panel-intent-v0.7-quote-guard.md)与旧v0.7提示隔离，
旧v0.7和旧通用提示的字节SHA均核对一致，旧服务不会动态读到新提示。
公开源码改动仅为[panel-intent](../src/panel-intent.mjs)的native schema和[codex-planner](../src/codex-planner.mjs)的新提示选择，另新增提示文件与回归。
合成夹具在第6行加入引文偏差，复现相同校验代码和路径；它不是未保存的原始失败返回。

61项本地回归覆盖新约束、长面板、补充回答、Tabs、旧协议和失败不修补；
31份成功方案以新代码离线重放全部保持原Spec/Bundle，16份新native schema精确绑定本次原文。
新Studio在4193启动后8项交互检查PASS：保存的真实面板导入、预览、滑条、恢复默认、两组输入就绪和窄屏页面无横向溢出。
浏览器阻止非GET及外部HTTP请求，未点击生成或修改；启动与测试模型调用均0。
启动第一次遇自动审批检查超时，未创建进程/产物；按工具允许的一次本地启动重试成功，没有模型重试。

## 可查看的证据

- 原32次完整审计（本地产物：`../output/ordinal-stability-accepted-v1/acceptance.json`），质量状态FAIL、证据审计PASS
- 第一轮16个真实面板预览（本地产物：`../output/ordinal-stability-run-v1/round01/preview/index.html`）
- 第一轮5种实际来源组合（本地产物：`../output/ordinal-stability-run-v1/round01/composition/index.html`）
- 原两轮生产报告（本地产物：`../output/ordinal-stability-run-v1/ordinal-stability-report.json`）
- 引用约束零模型检查（本地产物：`../output/quote-guard-check-v1/check-report.json`）
- 修复版Studio启动（本地产物：`../output/panel-studio-quote-guard-live-v1/launch.json`）与8项浏览器检查（本地产物：`../output/panel-studio-quote-guard-live-browser-v1/browser-report.json`）
- 修复后的独立汇总（本地产物：`../output/quote-guard-accepted-v1/acceptance.json`）

原32次FAIL报告摘要在修复前后保持相同；没有将程序夹具或离线重放计作真实生成通过。
原生schema服务执行的真实复验仍NOT_RUN；当前不能记录两轮全通过。
32次授权已消费，任何新真实调用需按[仓库AGENTS.md](../../../AGENTS.md)重新冻结计划并取得对应授权。
