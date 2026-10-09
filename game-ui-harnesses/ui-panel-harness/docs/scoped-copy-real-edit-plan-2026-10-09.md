# 同名按钮单次真实编辑：准备记录

后续用户授权后已执行一次真实编辑并通过本样本技术验收，授权已消费。见[实际结果与范围](scoped-copy-real-edit-results-2026-10-09.md)。下文保留授权前的准备事实；冻结计划、预演与预检文件保持原状。

冻结计划：`output/scoped-copy-real-edit-plan-v1/plan.json`。

SHA-256：`c8f2741a11aa3b4d23cb216ec262ea0191d4f7e0897401fe1f1b566e464c213d`。

当前模型调用0；前次所有真实授权已消费。仅Codex CLI / gpt-6-luna / xhigh一次编辑，生成0、自动重试0。失败、澄清、无修改、结果不明或验收失败立即停止，不修补模型输出、不补调。

> 声音分组里的恢复默认按钮文字改为“仅恢复声音”，显示分组里的恢复默认按钮文字改为“仅恢复显示”，其他保持不变。

基础包原样来自`output/scoped-copy-browser-v2/scoped.panel.bundle.json`，Bundle摘要47027433bc7ac64cbd6c52656386196d3f2f18e7684236ca5863ace6f5000547。它是人工编写的协议夹具，经现有编译器产生，不是真实生成结果或新美术方案。主音量/亮度默认70/40，保存试玩值35/81；各reset只作用本组，无素材。本计划检验真实模型编辑程序夹具，不宣称真实生成与编辑整链路或素材保留已覆盖。

Studio准备出EditContext0.14 / explicit-properties-v4，两处文案绑定row1/row3。独立预期只允许两个buttonLabel叶子变化；其余Spec、布局、目录、动作/绑定、素材、编译器和试玩值保持。成功计1/10；撤销恢复原包，不返还轮次。

## 无模型验证

- 8项本地检查：两处定位与完整“其他保持不变”识别；错组、漏改、交换文案、额外标题、扩大reset范围整批拒绝；虚假no-change拒绝；正确修改严格接受与撤销/轮次保留。
- 5组浏览器检查：桌面和390px双组reset/事件、无截断、独立试玩值及严格导出；1份实际夹具ZIP下载的CRC/摘要；无图库重导入重导出；file URL离线Pixi打开；错误/外部请求0。
- 24份输入和284份源码/协议/提示/锁定依赖指纹冻结并复核；错误授权摘要在登录检查与派发前拒绝，没有派发标记、real-call目录或真实结果。
- 只读CLI登录检查：受限环境NOT_CONFIRMED原FAIL保留，宿主VISIBLE为PASS；网络及模型可用性NOT_CHECKED，未修改登录设置。

证据：计划目录内`local-preflight.json`、`rehearsal-v1/review-report.json`与`prepared-review.json`。`rehearsal-v1/index.html`明确标为程序预演，不能当作真实结果。

准备脚本preparation-failure-v1/v2保留：测试操作名误写set-title导致能力检查拒绝；虚假no-change直接触发请求拒绝，脚本原以为会返回报告。只修正为有效set-panel-title与正确拒绝断言，未修改公共校验或基础面板。冻结过程中修正依赖清单：Panel本身无package-lock，实际绑定既有Component锁文件。

## 授权后

`run-once.mjs`复核指纹与授权摘要，独占创建派发标记后只有一次editWithCodex调用。保存原始输出、方案和回执，公共检查与独立预期均通过后保存结果。`build-review.mjs`只重放保存结果，建立前后Pixi对比，并执行已预演的5组浏览器检查和1份实际ZIP离线往返。

这是有界编辑样本，不代表全部自然语言覆盖或新美术通过。真实结果、Unity原生及游戏接入目前NOT_RUN；本轮未改生产源码、4951日常服务、历史真实产物、其他Harness或GitHub。
