# Docker 宿主接入：组件链路

本文件是部署方的实现入口，范围为文字/风格或已有参考 PNG 到 **16 类组件消费包**。rc.2 提供 `existing-image` / `generate-reference` 两个模式，CLI、`src/components-api.mjs` 和 `component-entry contract` 的文件合同；不附带已运行的 Docker HTTP 服务、镜像或通用供应商配置。下列 HTTP 操作仍为 **proposed（部署方待实现）**，实装并验收后才能交 Web。旧本地 Studio 仍是图片入口，没有新增文字起步 UI。

链路详情见[组件流程](component-pipeline.md)，交付给 Web 的要求见[Web 接入](web-integration.md)。现有本地 Studio 只监听 loopback，不能直接通过改监听地址充当已验证的生产 API。

## 固定版本与运行环境

部署方从 `ui-chain-components-v0.1.0-rc.4` 的不可变发布资产安装，源码归档 SHA-256 参数为 `<该标签发布资产SHA256SUMS中源码归档的SHA256>`，从独立 `SHA256SUMS` 取得并核对下载字节。源码内不回填自身归档摘要，避免自引用。不从工作分支或历史 `work/` 复制核心；记录标签、资产摘要、commit、宿主版本与镜像 digest，升级先回归。

Node.js 须满足发布 `package.json` 的版本要求（当前 `>=22.18.0`）；使用 `npm ci --include=dev --ignore-scripts --no-audit --no-fund` 和锁文件。组件构建运行仍需 esbuild 和字体，不省略 devDependencies。完整后处理会启动 Playwright 浏览器，镜像必须包含与发布锁定版本兼容的浏览器及系统库。使用 Playwright 官方镜像时，其版本应与项目 Playwright 依赖匹配，不能把任意 `latest` 镜像当作兼容保证。参见 [Playwright Docker 文档](https://playwright.dev/docs/docker)。

基础镜像使用已核验的版本与 digest，必要的构建工具与运行资源分阶段打包，排除生成证据、凭证和本机缓存。镜像摘要固定后通过受控升级接收修复；具体依据见 [Docker 构建建议](https://docs.docker.com/build/building/best-practices/)。这些是部署建议，不表示本仓库已经执行过容器验收。

准备时构建模板和合同，选择镜像内已安装的 `chromium`：

```sh
npm ci --include=dev --ignore-scripts --no-audit --no-fund
npm run templates:build -- --browser chromium
npm run contracts:build
node scripts/component-entry.mjs contract
```

使用 `UI_CHAIN_TEST_BROWSER=chromium` 为下游确定性浏览器检查选择相同浏览器，单次组件检查可用 `--browser chromium` 显式覆盖。构建、启动、健康检查、状态查询及测试不得调用模型；组件部署不安装或加载面板规划 SDK。

## 存储、进程和供应商边界

准备模板/合同构建时允许写入 `previews/skin-templates` 与 `generated/component-contracts`，完成后核心、构建和依赖保持只读，`work/` 使用持久卷。整体保存文字/指导图、参考计划/原图/QA/人工审查及其摘要、组件批次/尝试/回执/补图链、任务与全部引用产物；不能只存任务索引。存储须满足独占创建、同卷原子发布及硬链接等核心语义；不支持时停止，不按锁年龄抢占。浏览器临时目录可用临时卷，持久交付取后处理目录已复制的证据。

当前 DAG 是单机文件任务模型。首个宿主实现应保证同一项目/任务只有一个执行所有者；容器副本之间不要共享一个执行目录并假设核心已提供分布式租约。HTTP 任务 ID、用户访问权限、配额、对象下载 URL 与部署平台进程治理归宿主；它们不写入公共 SkinPack 或核心回执。

宿主分别向 `executeReference` 与 `executeComponentsFromReference` 注入适配器；已有图片模式继续用 `executeBatchPipeline`。适配器 `generate` 读取每阶段冻结的 `output`：参考图是不透明 PNG，组件图集是透明 PNG。CLI `--adapter` 仅允许部署配置指定的受信模块，不接受客户端任意模块路径。凭证仅由宿主安全配置读取，不进入镜像层、计划或浏览器；无需 Codex CLI 登录。关闭 SDK 自动重试，有界超时，脱敏错误；不把本地可选 CLI 桥接当作通用容器供应商方案。

生成参考模式需要两个独立计算决定：确认参考 `planSha256`，最多一次调用；技术 QA 后用户按 `imageSha256` 接受，取得 `reviewSha256`；再准备默认五图批次，确认新的 `batchSha256`。默认总 6 次图片调用，关闭 S05 总 5 次。人工接受不是计算授权；后端不得在 reference 成功或接受后自动提交图集。新桥接默认 `materials: true`，原 `prepareSkinBatch` 默认仍 false。

参考 QA 接受 8-bit RGB/RGBA、非交错 sRGB PNG，宽高 256–4096、完全 opaque、非单色；exact 匹配尺寸，native 比例误差 ≤1%。不支持的编码保留 raw 并拒绝，不自动转换可见内容或重投。`imageSha256` 是规范化 PNG；`sourceReferenceSha256` 是 `source-reference.json` **完整字节**摘要（包含参考 plan/request/raw/image/style/review 和 batch 绑定），不是 PNG 摘要或 JSON 内部自封印字段。HTTP 下载/确认字段不得混淆。

原始失败/未知不获得重投权。HTTP 超时、重复点击、容器重启和平台重试都不能重发；幂等键须分别绑定 reference plan 与 component batch，同键返回已有任务或冲突。参考 `reserved-no-resubmit` / `indeterminate` 不重投；仅已有可信返回字节的 `reception-incomplete` 可零调用恢复。技术/视觉拒绝须新参考计划和新确认，不能通过图集候选选项绕过。已可能提交的图集单图不能再次 `begin`。

## 宿主操作建议（proposed）

以下列出需要实现的操作语义，没有声称存在这些 URL。部署方自行确定实际路由、认证和版本前缀，并在 OpenAPI 中固化。

| 建议 operationId | 输入与核心映射 | 返回与边界 |
| --- | --- | --- |
| `getComponentCapabilities` | `component-entry contract` | 发行身份、16 类列表、模板/材质选项、输入限制；不调用模型 |
| `createComponentProject` | 明确 `existing-image` / `generate-reference`；已有 PNG，或描述/可选风格与指导 PNG，及 profile | 宿主项目 ID、冻结输入摘要；不暴露本机路径 |
| `prepareReferencePlan` | 核心同名 API，描述与尺寸/可选风格、指导 PNG | `directory` 对应的宿主 ID、`planSha256`、`requestSha256`、预览范围；不生成 |
| `confirmReferenceGeneration` | `executeReference`，确认 `confirmedReferencePlanSha256` | 参考任务 ID；最多一次，成功也须待人工接受 |
| `getReferenceTask` | `inspectReference` / `verifyReferencePlan` | 状态、技术 QA、raw/image/style 摘要与授权预览；只读 |
| `recoverReferenceReception` | 核心同名 API | 已保存可信 returned 原字节的接收恢复；零模型，无来源不伪造成功 |
| `reviewGeneratedReference` | `reviewReference`，绑定 `imageSha256` / `confirmedImageSha256`，accept/reject | `reviewSha256`；参考用途的接受不等于组件最终接受 |
| `prepareComponentBatch` | 已有图用 `prepareSkinBatch(materials:true)`；生成图用 `prepareComponentsFromReference(reviewSha256)` | `skinDirectory`、`batchDirectory` 对应 ID，`batchSha256` / `sourceReferenceSha256`、图数/资产数；不授权 |
| `confirmComponentBatch` | 已有图用 `executeBatchPipeline`；生成图用 `executeComponentsFromReference`，独立确认 batch 且绑定 `sourceReferenceSha256` | 宿主任务 ID；每图最多一次；返回既有 `{generation,task}`，缺 profile 或未收齐不得报完整包 |
| `getComponentTask` | `inspectGenerationBatch` 与 `skins:task status` | 各图状态、原图检查、各确定性节点、时间戳、可操作项；只读 |
| `recoverComponentReception` | 核验已返回图片及原调用证据 | 仅接收恢复，不生成；不能凭一张来源不明图制造成功 |
| `prepareComponentSupplement` | `prepareSupplement` | 指定图的新 `planSha256`、范围和预览；不调用模型 |
| `confirmComponentSupplement` | `executeSupplement` 与新单图确认 | 仅该图一次调用；保留原失败与补图链 |
| `resumeComponentPostprocess` | 既有任务的 `skins:task resume` | 仅确定性恢复；输入/工具变化须新任务；不重新生成 |
| `getComponentArtifacts` | 最终 `consumerDirectory`、包清单和检查证据 | 经授权的完整下载、静态预览和文件摘要；组件阶段结束 |

`recoverComponentReception` 依赖实际供应商证据实现；本地 Codex 恢复函数只适用于其可核验来源，不是所有 provider 通用的“上传即成功”接口。宿主若不支持恢复必须明确报告，不模拟成功。

参考状态分别保留 `awaiting-reference-confirmation`、`reserved-no-resubmit`、`reception-incomplete`、`pending-visual-review`、`accepted`、`rejected-technical`、`rejected-visual`、`indeterminate`。组件保留 `awaiting-authorization`、`authorized-awaiting-external-submission`、`received`、`failed`、`indeterminate`、`supplement-awaiting-confirmation`，DAG 保留 `ready-to-resume`、`failed-retryable`、`incomplete`、`awaiting-visual-review`。不得用一个 `success` 吞掉参考待接受、原图 rejected、材质缺失或最终外观待验收。

## 必须交给 Web 的 API 合同

部署方在 HTTP 服务实装后输出以下交付，Web 以这套合同和实测样例接入，不依赖本文件的建议名称猜接口：

1. **OpenAPI 3.1** 的 `openapi.yaml` 或 `openapi.json`，给出合同版本、服务版本、核心标签/摘要、真实 servers、全部 request/response schemas、认证与跨域方式、上传类型与上限、超时、分页/轮询、下载生命周期。
2. 每个操作的真实实例：两种起点、参考确认/重复确认/超时/接收恢复/技术拒绝/人工拒绝、人工接受后尚未授权图集、第二份确认、五图 35 资产/显式四图、图集 rejected/unknown/补图、确定性 resume、完整包下载。
3. 状态表与字段定义：参考/批次/单图/DAG分别列状态、允许操作与终态；绑定 `planSha256`、`requestSha256`、raw/image/style 摘要、`reviewSha256`、`sourceReferenceSha256`、`batchSha256`。参考 accepted、`originalChecksPassed`、最终 `productionReady` / `visualAcceptance` 独立；耗时取真实时间戳。
4. 统一错误合同：稳定 code、可展示 message、关联 task/project ID、`modelMayHaveBeenSubmitted`、是否可进行**本地恢复**、是否需要**新计算确认**。HTTP 状态不取代核心业务状态；不要返回 `retryable: true` 诱导重投未知结果。
5. 工件合同：完整消费包清单、包 SHA-256/文件 SHA-256、`skin/`、`kit.json`、`runtime.mjs`、许可证和技术证据的下载/校验方式；原始输入和私有调用证据由受限存储管理，不默认公开下载。
6. 容器验收报告、镜像 digest、核心发布资产 SHA-256、浏览器/Node/依赖版本、测试日志与样例请求回放。未实测操作标为 unsupported，不能在合同里宣称实现。

## 容器验收范围

先用公开替身验证文字→一次参考返回→技术 QA→显式 fixture 人工接受→新批次确认→五图→定位/切线/安全区/材质绑定→独立 16 类检查，同时保留已有 PNG 与四图路径。证明两份确认隔离、参考未接受或摘要变更时零图集调用、重复请求零新增调用。替身通过不是实际模型或美术验收；核心及宿主 CI 不调用真实模型。

再测重启、并发重复确认、调用后断连、半写盘/接收中断、单图补图新确认、后处理 resume、哈希篡改、非法路径、缺 S05、下载授权与无私人信息泄漏。计数断言应证明预检/查询/恢复/检查零模型调用、同图最多一次、重复请求零新增调用。

最后只有获得用户对新摘要的明确授权才进行真实供应商冒烟。该次结果与离线 CI 分开保留；技术通过仍交付待美术验收的组件候选。结束在完整 16 类组件包，禁止顺手触发后续面板模型。
