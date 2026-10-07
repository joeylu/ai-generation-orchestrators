# 声音单次真实复验失败与请求来源绑定修复

随后0.8三例计划已批准并执行，来源绑定真实3/3通过；原生产批次有一项命名期望不一致，明确修正后同源业务/Pixi/交付复验通过，未增加调用。详见[最新三例结果](request-reference-recheck-results-2026-10-06.md)。以下保留本次单例与修复准备过程。

批准的 `e1a07482b45bac831a94af7776e27e62c82cf54b5021fecc6eff9af5a363340b` 已执行一次 gpt-6-luna / xhigh，自动重试0。
结果为FAIL：第一行 `sourceQuote` 没有等于完整176个UTF-16单元的需求，接受前触发 `INTENT_NATIVE_QUOTE`。
外层错误为 `CODEX_PROPOSAL_INVALID`，精确路径是 `$.panel.body.children[0].rows[0].sourceQuote`。
业务验收、编译、Pixi和交付均NOT_RUN，没有将返回修补为成功方案。
原始失败返回遵循既有策略未保存，不能推断其具体片段或业务正确性；保留安全诊断与返回摘要。
回执用量：输入29813、缓存输入0、输出634 Token。独立程序在改源码之前核验203份冻结源码、根/子单次消费记录及实际回执。

## 当前修复

当前Context 0.7的新CLI响应使用 **PanelIntent 0.8**，每行、tabs根节点和page填写 `sourceRef:"request"`。
根 `contextSha256` 绑定当前验证过的需求；程序从这份上下文取得完整原文，生成原有的UTF-16区间和来源依据。
模型继续解释控件、标签、顺序、初值、范围、重置/提交范围和页签归属。
来源绑定不会证明业务理解正确，独立业务验收和所有规格/编译门禁保持。

这是[显式的新运输格式](../src/panel-intent.mjs)，不是对失败引文的纠错或自动重试。
0.8不接受sourceQuote、缺失/非法sourceRef、旧上下文摘要或多余字段；无效业务结构仍失败。
接受的原始0.8响应按原样保存在panel-intent.json，生成PanelProposal和PanelSpec是既定程序转换。
公开保存的旧0.7短引文继续兼容；旧0.7返回进入当前CLI时仍需完整引文，不能被转换为0.8后绕过失败。
旧Context的响应格式与所有旧提示文件保持。

新增[独立0.8提示](../prompts/panel-intent-v0.8-request-refs.md)，移除要求模型重复复制长原文的竞争指令。
有限验收计划的协议指纹和8处schema生产/消费脚本使用同一个实际CLI schema构造器，旧0.7构造器保留用于历史文件检查。
PanelSpec仍为0.7，Pixi、Unity、编辑协议及其它Harness未改。

## 零模型验证

- 全量692项本地回归通过，0跳过；新覆盖16类程序期望面板、三个历史失败样本、CRLF/emoji/重复词/补充回答、非法引用及错误上下文。
- 34份历史接受响应直接重放，原方案与Bundle保持一致；没有将这些真实返回转换为新格式，也没有修改失败记录。
- 三个0.8程序样本通过42项真实Pixi交互，实际下载3份ZIP；CRC、文件摘要、Pixi/Unity同源Bundle、离线打开与重新导入均通过。
- 新版Studio `http://127.0.0.1:4195/` 通过8项保存方案导入/滑条/重置/输入入口/窄屏检查。阻断全部非GET和外部请求，未点击生成或修改。

本地首轮发现schema转换将输入字段required误当required列表，修正后再补齐已有的空容器提示断言；第二轮中断的本地测试日志保留。
第三轮定向102/102、随后全量692/692通过。保存结果审计首次输出含未定义统计字段，程序序列化失败；修正后用新v2目录保存，未覆盖v1。
这些均是零模型本地过程，真实请求仍只有批准的一次。

旧4194及其它旧服务保留；新进程采用进程临时代理，不改全局配置。
原32次31/32批次、原三例全文门禁2/3批次和本次单例仍为FAIL。
新格式真实模型复验、全16多轮/组合新认证、原生Unity运行与人工视觉验收尚未完成。

## 下一份准备结果

[新三例计划](../output/request-reference-recheck-plan-v1/quote-recheck-plan.json)摘要为
`b7a3800116d56698a83f5518736698f3cea800e2f8ed830f923eb2e9e7347a40`。
固定原样高级设置、补充回答声音和双页签进度，各最多一次gpt-6-luna / xhigh，最多3次、失败不重试。
205份源码、3份实际0.8 schema、库/构建、程序样本和42项交付证据已冻结并独立核验；只读宿主预检通过。
准备时该新计划未获授权，根/子消费记录和真实运行目录均不存在，模型调用0；随后已授权并执行，实际3次、无重试，见上方最新结果。
已消费的一次授权不会转移至新摘要。[仓库AGENTS.md](../../../AGENTS.md)规定：
“A generation attempt requires one fresh, single-use authorization bound to an immutable plan digest.”

## 可复核证据

- [本次一次真实FAIL独立审计](../output/native-quote-recheck-accepted-v1/acceptance.json)与[结果页](../output/native-quote-recheck-accepted-v1/index.html)
- [692回归与34历史方案重放](../output/request-reference-fix-check-v2/check-report.json)
- [新格式准备及交付独立审计](../output/request-reference-fix-accepted-v1/acceptance.json)与[程序样本预览/ZIP入口](../output/request-reference-fix-accepted-v1/index.html)
- [42项程序样本浏览器与交付](../output/request-reference-recheck-plan-v1/fixture-browser/browser-report.json)
- [4195启动回执](../output/panel-studio-request-reference-live-v1/launch.json)与[8项零模型入口验证](../output/panel-studio-request-reference-live-browser-v1/browser-report.json)
