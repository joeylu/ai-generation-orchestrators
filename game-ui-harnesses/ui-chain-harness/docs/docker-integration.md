# Docker 宿主接入：组件链路

本文件是部署方的实现入口，范围为参考图到 **16 类组件消费包**。核心提供 CLI、`src/components-api.mjs` 和 `scripts/component-entry.mjs contract` 输出的文件合同。本发行不附带已运行的 Docker HTTP 服务、镜像地址、生产账号或通用供应商配置；下列 HTTP 操作属于 **proposed（部署方待实现）**，必须实装并验收后才能交给 Web。

链路详情见[组件流程](component-pipeline.md)，交付给 Web 的要求见[Web 接入](web-integration.md)。现有本地 Studio 只监听 loopback，不能直接通过改监听地址充当已验证的生产 API。

## 固定版本与运行环境

部署方从 `ui-chain-components-v0.1.0-rc.1` 的不可变发布资产及公开 SHA-256 安装，不从工作分支、历史 `work/` 或本机验收目录复制第二份核心。记录核心标签、资产摘要、源码 commit、宿主版本及容器镜像 digest；升级先通过同一宿主回归。

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

准备模板/合同构建时允许写入 `previews/skin-templates` 与 `generated/component-contracts`；准备完成后发布核心、这些构建及锁定依赖保持只读，核心的 `work/` 挂载可持久写入卷。必须整体保存项目参考输入、计划、整批摘要、尝试、原图、授权/提交/接收回执、补图链、任务及其引用产物；不能只保存任务索引。跨文件系统或存储服务须满足独占创建、同卷原子发布及硬链接等当前核心语义；不支持时停止，不把文件锁替换成“超时就抢占”。浏览器临时目录可用临时卷，持久交付取后处理目录已复制的技术证据。

当前 DAG 是单机文件任务模型。首个宿主实现应保证同一项目/任务只有一个执行所有者；容器副本之间不要共享一个执行目录并假设核心已提供分布式租约。HTTP 任务 ID、用户访问权限、配额、对象下载 URL 与部署平台进程治理归宿主；它们不写入公共 SkinPack 或核心回执。

供应商适配器由宿主显式注入 `executeBatchPipeline`。模型凭证仅在宿主安全配置中读取，不放进 Docker 构建参数、镜像层、输入计划、交付包或浏览器。核心不要求 Codex CLI 登录；本地可选 CLI 桥接不能直接作为通用 Linux 容器供应商方案。宿主适配器须实现一次提交、有界超时和实际输出落盘，关闭 SDK 内置自动重试；不要向外公开供应商原始错误、URL、请求头或私人路径。

原始 `failed` / `indeterminate` 是已消耗提交机会的终态。HTTP 请求超时、客户端重复点击、容器重启和平台重试都不能触发重投。宿主提交操作应以批次摘要建立幂等映射：相同键返回已有任务或冲突，不再次调用核心；幂等不等于自动再次生成。尚未使用的同批其他图可按核心规则推进，已可能提交的单图不能再次 `begin`。

## 宿主操作建议（proposed）

以下列出需要实现的操作语义，没有声称存在这些 URL。部署方自行确定实际路由、认证和版本前缀，并在 OpenAPI 中固化。

| 建议 operationId | 输入与核心映射 | 返回与边界 |
| --- | --- | --- |
| `getComponentCapabilities` | `component-entry contract` | 发行身份、16 类列表、模板/材质选项、输入限制；不调用模型 |
| `createComponentProject` | 有界图像上传、风格及 profile，宿主生成安全项目 ID | 原图及派生 PNG 摘要；不暴露本机路径 |
| `prepareComponentBatch` | `prepareSkinBatch`，新项目显式 `materials: true` | `batchSha256`、每图计划、图数、资产数、确认预览；不授权 |
| `confirmComponentBatch` | 用户确认该不可变摘要后，`executeBatchPipeline` | 宿主任务 ID；一批一次确认，每图最多一次；重复请求返回已有任务 |
| `getComponentTask` | `inspectGenerationBatch` 与 `skins:task status` | 各图状态、原图检查、各确定性节点、时间戳、可操作项；只读 |
| `recoverComponentReception` | 核验已返回图片及原调用证据 | 仅接收恢复，不生成；不能凭一张来源不明图制造成功 |
| `prepareComponentSupplement` | `prepareSupplement` | 指定图的新 `planSha256`、范围和预览；不调用模型 |
| `confirmComponentSupplement` | `executeSupplement` 与新单图确认 | 仅该图一次调用；保留原失败与补图链 |
| `resumeComponentPostprocess` | 既有任务的 `skins:task resume` | 仅确定性恢复；输入/工具变化须新任务；不重新生成 |
| `getComponentArtifacts` | 最终 `consumerDirectory`、包清单和检查证据 | 经授权的完整下载、静态预览和文件摘要；组件阶段结束 |

`recoverComponentReception` 依赖实际供应商证据实现；本地 Codex 恢复函数只适用于其可核验来源，不是所有 provider 通用的“上传即成功”接口。宿主若不支持恢复必须明确报告，不模拟成功。

查询必须保留核心原始状态，例如 `awaiting-authorization`、`authorized-awaiting-external-submission`、`received`、`failed`、`indeterminate`、`supplement-awaiting-confirmation`；DAG 保留 `ready-to-resume`、`failed-retryable`、`incomplete`、`awaiting-visual-review`。宿主可附加排队/运行状态，但不得用单一 `success` 吞掉原图 rejected、材质缺失或待视觉验收。

## 必须交给 Web 的 API 合同

部署方在 HTTP 服务实装后输出以下交付，Web 以这套合同和实测样例接入，不依赖本文件的建议名称猜接口：

1. **OpenAPI 3.1** 的 `openapi.yaml` 或 `openapi.json`，给出合同版本、服务版本、核心标签/摘要、真实 servers、全部 request/response schemas、认证与跨域方式、上传类型与上限、超时、分页/轮询、下载生命周期。
2. 每个操作的真实请求/响应示例；五图 35 资产、显式四图、确认前无调用、确认/重复确认、rejected、failed、indeterminate、接收恢复、单图新确认、确定性 resume、完整包下载各有例子。
3. 状态转换表及字段定义：整批/单图/DAG 各自状态，允许操作，终态，`originalChecksPassed`、`productionReady`、`visualAcceptance` 的独立意义；耗时来自实际时间戳。
4. 统一错误合同：稳定 code、可展示 message、关联 task/project ID、`modelMayHaveBeenSubmitted`、是否可进行**本地恢复**、是否需要**新计算确认**。HTTP 状态不取代核心业务状态；不要返回 `retryable: true` 诱导重投未知结果。
5. 工件合同：完整消费包清单、包 SHA-256/文件 SHA-256、`skin/`、`kit.json`、`runtime.mjs`、许可证和技术证据的下载/校验方式；原始输入和私有调用证据由受限存储管理，不默认公开下载。
6. 容器验收报告、镜像 digest、核心发布资产 SHA-256、浏览器/Node/依赖版本、测试日志与样例请求回放。未实测操作标为 unsupported，不能在合同里宣称实现。

## 容器验收范围

先使用公开离线夹具/替身跑完整五图→定位→切线→安全区→材质绑定→独立 16 类组件检查；验证脱离源码目录加载、横竖预览、普通/选中正方形槽位、字体/资源/许可证随包。核心测试和宿主 CI 均不得调用真实模型。

再测重启、并发重复确认、调用后断连、半写盘/接收中断、单图补图新确认、后处理 resume、哈希篡改、非法路径、缺 S05、下载授权与无私人信息泄漏。计数断言应证明预检/查询/恢复/检查零模型调用、同图最多一次、重复请求零新增调用。

最后只有获得用户对新摘要的明确授权才进行真实供应商冒烟。该次结果与离线 CI 分开保留；技术通过仍交付待美术验收的组件候选。结束在完整 16 类组件包，禁止顺手触发后续面板模型。
