# Docker / Web 接手口令

下列文字可复制给接手的开发 Agent。它们是任务说明，不是登录口令、API 密钥或运行命令。此发行的交付范围仅到完整 **16 类组件消费包**；不自动提交真实模型，不包含后续面板生成。

## 给 Docker 部署方

```text
请接手 ai-generation-orchestrators 的 ui-chain-components-v0.1.0-rc.3 组件链路 Docker 宿主实现。先读取发布内 game-ui-harnesses/ui-chain-harness/docs/component-pipeline.md、docker-integration.md、web-integration.md，以及 component-entry contract 输出的发行合同。只用该不可变标签，源码归档 SHA-256=<该标签发布资产SHA256SUMS中源码归档的SHA256>，从独立SHA256SUMS取得并核对下载字节，记录commit/镜像digest；不要复制旧work/凭证或另维护核心，也不要回填源码归档自身SHA造成自引用。

范围有 existing-image / generate-reference 两模式。已有 PNG 沿用原批次；生成模式从 description/可选style/guide准备参考计划，确认planSha256后生成一次不透明PNG，技术QA后用户按imageSha256接受并获得reviewSha256，再冻结S01–S05批次，独立确认新batchSha256后生成透明图集，最后定位/切线/安全区/材质绑定/组包/独立16类检查。默认1参考+5图集=6次生图、两次计算确认；关闭S05为1+4次。参考人工接受不授予图集计算权，也不等于最终组件美术接受。当前修订3是32基础部件+3材质，不增加第17类纹理控件。结束在组件包，不安装Panel SDK、不调用后续面板生成。

核心已有 Node CLI（reference-generation.mjs 的 prepare/verify/status/execute/review/recover/batch-prepare/batch-execute）、src/components-api.mjs、文件合同和组件runtime；HTTP服务与容器镜像由你实现，不得声称已有现成服务或Studio文字UI。适配器显式注入executeReference/executeComponentsFromReference，读取冻结output切换参考不透明/图集透明；CLI --adapter只用受信部署模块，不接受客户端任意路径。使用npm ci --include=dev及匹配Playwright Chromium，完整持久化work含参考计划/原图/QA/人工review/来源绑定与图集证据，同任务单一所有者，满足独占创建/原子发布/硬链接语义。凭证不进入镜像层、计划或交付。

两份新鲜计算确认分别绑定confirmedReferencePlanSha256和confirmedBatchSha256；参考review匹配imageSha256/confirmedImageSha256，组件桥接绑定reviewSha256及sourceReferenceSha256（批次source-reference.json完整字节SHA，不是PNG SHA或其内部sha256）。不得从参考成功/accepted自动续调图集，SDK重试关闭。reserved-no-resubmit/indeterminate不重投；reception-incomplete仅用已保存可信returned字节零调用恢复，未知来源不能制造成功。参考技术/视觉拒绝需新计划新确认，图集补图也需新单图确认；确定性失败只resume原任务。HTTP超时/重复点击/重启仅查询/恢复同任务，两阶段幂等分开，禁止手改回执/清单/哈希。预检/构建/查询/恢复/CI零模型，真实冒烟另需实际新摘要授权。

先以公开替身覆盖文字→参考一次返回→QA→显式fixture接受→新批次确认→五图→16类完整链路，同时保留已有PNG和四图回归。证明未确认参考/未接受参考/未确认批次时对应调用数为0，错误摘要、重复并发、超时/重启、接收恢复、新单图确认、resume、缺材质、非法路径/下载授权都受控。替身不是真实模型或美术验收。最终仍productionReady=false、visualAcceptance=unreviewed，交原图检查/技术报告/横竖预览。

必须交Web：OpenAPI3.1及其SHA-256、真实服务地址/版本/认证/输入限制/所有schemas、每操作实测examples、参考/批次/单图/DAG状态与错误表、两份compute摘要和image/review/sourceReference绑定合同、完整工件/哈希/下载合同、镜像digest、核心资产SHA、Node/浏览器/依赖版本、容器验收和回放日志。明确模型可能已提交、本地可恢复与须新确认的区别。proposed操作实测后才标supported，缺项unsupported。输出具体合同位置与可复制Web接手说明，不让Web猜Studio内部路由。
```

## 给 Web 接手方（Docker 交付 API 合同后使用）

```text
请接手 ui-chain-components-v0.1.0-rc.3 的Web组件工作台，源码归档SHA-256=<该标签发布资产SHA256SUMS中源码归档的SHA256>，从独立SHA256SUMS取得。读取component-pipeline.md/web-integration.md和Docker实装OpenAPI3.1及摘要、examples、状态/错误/工件合同、容器验收报告，核对核心/镜像digest。缺合同的操作保持mock，不把proposed或旧Studio路由当现成API，不写死私人URL/端口/凭证。

范围为existing-image已有PNG与generate-reference文字/风格两入口。新模式展示冻结参考计划，用户确认一次参考compute；返回PNG先展示技术QA，再由用户接受实际imageSha256取得reviewSha256；随后展示新的图集batchSha256，第二次确认才调用。默认1+5张共6次，关闭S05为1+4；不得将参考成功/人工接受自动等同图集授权。已有PNG跳过参考生成。后续各图进度、零模型接收恢复、新单图确认、确定性resume、16类试玩与完整下载保留。32基础部件+3材质数字从批次取，不增加第17类控件，不加后续面板需求/生成/编辑。

生成请求禁自动重试，两阶段幂等分别绑定其摘要，断网/刷新只查原任务。参考reserved-no-resubmit/indeterminate或图集failed/unknown不显示“重试原生成”；参考拒绝需新计划新确认，图集补图需新单图新确认。reference pending-visual-review、accepted与最终组件awaiting-visual-review分别展示；参考接受不把组件标accepted。reception-incomplete只恢复可信已存返回，failed-retryable仅本地DAG恢复，始终保留原图警告及最终productionReady=false、visualAcceptance=unreviewed。

预览/消费使用同一完整包的 runtime.mjs 与 kit.json，Pixi 对象从该 runtime 导出，保留 skin/ 的 PNG/字体/S05材质绑定、清单/摘要/许可证与技术证据。资源经宿主授权静态 URL 加载；换包时释放组件、纹理、事件和 Pixi app。作者字段、试玩状态、Web业务状态分别管理，不用单节点 snapshot 代替完整交付。

按实测examples验证两种入口、两份确认隔离、参考QA/人工接受、拒绝/来源变更阻断、重复/取消/断网刷新/unknown/零模型恢复/新单图确认/resume；覆盖16类横竖长中文、状态/触摸/焦点、普通选中1:1槽位、S05标题/分组/底纹，无缺资源/控制台错误。提供参考对照验收、完整包和报告。替身结果不冒充真实模型或人工接受，不擅耗模型额度；结束在组件输出。
```

## 交接完成条件

Docker 方的实际 OpenAPI、实测实例和镜像验收报告到位后，Web 才从 mock 切到真实宿主。双方记录同一核心发布资产摘要；接口或核心升级重新验证，不能仅以页面能打开或 HTTP 返回 200 判定整条链路完成。
