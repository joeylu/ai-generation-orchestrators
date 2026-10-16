# Docker / Web 接手口令

下列文字可复制给接手的开发 Agent。它们是任务说明，不是登录口令、API 密钥或运行命令。此发行的交付范围仅到完整 **16 类组件消费包**；不自动提交真实模型，不包含后续面板生成。

## 给 Docker 部署方

```text
请接手 ai-generation-orchestrators 的 ui-chain-components-v0.1.0-rc.1 组件链路 Docker 宿主实现。先读取发布内 game-ui-harnesses/ui-chain-harness/docs/component-pipeline.md、docker-integration.md、web-integration.md，以及 component-entry contract 输出的发行合同。只使用该不可变标签的公开发布资产，核验发布 SHA-256，记录 commit 与镜像 digest；不要复制旧 work、本机凭证或另维护一份核心。

范围：参考 PNG/风格输入 → 冻结生成批次 → 用户确认摘要 → 每图一次模型提交 → 接收证据 → 四图定位 → 切线/内容安全区 → 可选 S05 提取并绑定 → 完整 SkinPack 和独立 16 类组件消费包 → 浏览器技术检查 → 待外观验收。新项目显式默认 S01–S05，当前修订 3 为 32 基础部件 + 3 材质；显示实际冻结批次数量。组件到此结束，不调用任何面板规划/生成/编辑入口，不安装面板规划 SDK。

核心已有 Node CLI、src/components-api.mjs、文件合同和组件 runtime；HTTP 服务、容器镜像、身份/下载访问控制与供应商适配器由你实现，不得声称已有现成服务。使用锁定依赖及匹配的 Playwright Chromium，持久化完整 work 卷，并满足核心独占创建/原子发布/硬链接语义；同一任务单一执行所有者。供应商凭证仅在宿主安全配置中，不进入计划、日志或交付包。

生成确认必须绑定实际显示的 batchSha256；一次确认覆盖本批每图一次，供应商 SDK 自动重试关闭。独占 begin 后可能已提交的 failed/indeterminate 图不得自动重投；HTTP 超时、重复点击、容器重启仅查询/恢复已有任务。补图先生成新单图计划并得到用户新确认。后处理恢复只 resume 原任务，不执行整批生成。程序回执、清单和哈希禁止手工修成成功，保留原图 rejected 与全部失败历史。预检、构建、健康检查、状态和 CI 零模型调用；真实模型冒烟必须另外获得当前新摘要的明确授权。

先用离线替身与公开夹具完成五图到 16 类组件的 Docker 全链路验收，再覆盖重复确认/并发、断连、重启、接收恢复、补图新确认、确定性 resume、摘要篡改、缺材质、路径与下载权限。技术完成仍保持 productionReady=false、visualAcceptance=unreviewed，并提供原图检查、技术检查和横竖预览。

必须输出给 Web 的交付：OpenAPI 3.1 文件（真实服务地址/版本/认证、上传和下载约束、全部请求/响应 schemas）、每个操作实测 examples、整批/单图/DAG 状态转换表、稳定错误合同（明确模型可能已提交、本地可恢复与新确认要求）、完整工件/哈希合同、容器镜像 digest、核心资产 SHA-256、Node/浏览器/依赖版本、验收报告和回放日志。文档中的 proposed 操作须实现并实测后才写成 supported，缺项标 unsupported。最后整理一份可复制 Web 接手说明，并附上述合同的具体交付位置；不要让 Web 根据本地 Studio 私有路由猜 API。
```

## 给 Web 接手方（Docker 交付 API 合同后使用）

```text
请接手 ui-chain-components-v0.1.0-rc.1 的 Web 组件生成工作台。先读取发布内 component-pipeline.md、web-integration.md，以及 Docker 部署方实际交付的 OpenAPI 3.1、examples、状态/错误表、工件合同和容器验收报告；确认核心资产 SHA-256 与镜像 digest。没有实际 API 合同的操作停留在 mock，不把 proposed 名称或本地 Studio 路由当作已实现 API，不写死私人 URL/端口/凭证。

范围仅为组件项目：风格参考/上传、默认启用 S05 的批次准备、用户查看冻结图数和摘要后确认、各图接收与本地节点进度、可信图片接收恢复、缺失或 rejected 单图的新计划/新确认、确定性 resume、16 类组件试玩及完整包下载。当前默认 S01–S05 为 32 基础部件 + 3 材质，数字来自冻结批次；不增加第 17 类 texture 控件。暂不加入面板需求、面板模型生成或画布编辑。

生成请求禁用自动重试；断连/刷新/重复点击查询同一任务，通过宿主幂等合同避免新增调用。failed/indeterminate 不显示“重试生成”；需要新图就准备新单图计划、显示新摘要并要求用户确认。DAG 的 failed-retryable 只能表示本地确定性恢复。图已返回、原图检查通过、16 类技术检查通过、人工外观接受分开展示；核心 awaiting-visual-review 应显示“技术检查通过，待外观验收”，保留 productionReady=false、visualAcceptance=unreviewed 和原图警告。

预览/消费使用同一完整包的 runtime.mjs 与 kit.json，Pixi 对象从该 runtime 导出，保留 skin/ 的 PNG/字体/S05材质绑定、清单/摘要/许可证与技术证据。资源经宿主授权静态 URL 加载；换包时释放组件、纹理、事件和 Pixi app。作者字段、试玩状态、Web业务状态分别管理，不用单节点 snapshot 代替完整交付。

按实测 API 样例验收取消/确认/重复确认、断网刷新、unknown、接收恢复、单图新确认和本地恢复；覆盖全部 16 类组件、横竖、长中文、状态/触摸/焦点、普通和选中1:1槽位、S05标题/分组/底纹，无资源缺失及控制台错误。最后提供与源参考并排的外观验收页、完整包下载与技术报告。任何测试不擅自消耗真实模型额度，美术接受交给用户；完成即停在组件输出。
```

## 交接完成条件

Docker 方的实际 OpenAPI、实测实例和镜像验收报告到位后，Web 才从 mock 切到真实宿主。双方记录同一核心发布资产摘要；接口或核心升级重新验证，不能仅以页面能打开或 HTTP 返回 200 判定整条链路完成。
