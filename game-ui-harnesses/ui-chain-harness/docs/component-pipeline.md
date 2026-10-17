# 文字/风格或已有参考图到 16 类组件

本入口面向 `ui-chain-components-v0.1.0-rc.3`，范围到完整组件消费包及其技术检查为止。已有核心是 Node.js CLI、JavaScript API、文件合同和浏览器组件运行时；容器 HTTP 服务由部署方实现。面板需求规划、面板生成及画布编辑不属于本次接入。

对接入口：`node scripts/component-entry.mjs contract` 输出组件发行合同；JavaScript 集成使用 `src/components-api.mjs`。宿主接入见 [Docker 接入](docker-integration.md)、[Web 接入](web-integration.md)和[交接口令](deployment-handoff.md)。[本地 Studio](local-studio.md)仍只提供带图预设/上传入口；文字起步使用本页新公共 CLI/API。

## 两种起点与确认

| 模式 | 起点与顺序 | 新计算范围 |
| --- | --- | --- |
| `existing-image` | 已有 PNG + 风格草稿 → 冻结图集批次 → 确认批次 → 组件 | Studio 新项目默认 5 张；底层 `prepareSkinBatch` 默认 4 张，需显式开启 S05 才为 5 张；一次批次确认 |
| `generate-reference` | 文字/风格 + 可选 PNG 指导图 → 冻结参考计划 → 确认参考计划 → 生成不透明参考 PNG → 技术 QA → 人工接受该图片 → 冻结图集批次 → 独立确认批次 → 组件 | 默认 1 + 5 张，共 6 次生图、两次计算确认；关闭 S05 为 1 + 4 张 |

第一份确认绑定 `planSha256`（执行参数 `confirmedReferencePlanSha256`），只允许参考图一次调用。参考人工接受绑定相同的 `imageSha256` / `confirmedImageSha256` 并返回 `reviewSha256`，不授予组件计算权。第二份确认绑定新的 `batchSha256` / `confirmedBatchSha256`。查看、准备、接受和恢复均不调用模型；接受参考图不会自动提交图集，最终组件外观还要另行验收。

## 输入与完成条件

当前推荐新项目明确启用材质：S01–S04 四张组件图集，加 S05 材质图集。模板修订 3 共 32 个基础部件和 3 个材质，组成 **16 类组件**，不是 35 类组件，也不增加第 17 类纹理控件。S04 包含 `slot.normal` / `slot.selected` 两态正方形格子；S05 提取标题、分组标题和面板底纹，并按合同绑定表面。

原有 `prepareSkinBatch` / `skin-batch.mjs` 的 `materials` 默认仍是 `false`，宿主显式传 `true` 或 `--materials` 才生成五张；新 `prepareComponentsFromReference` 默认 `materials: true`，CLI 用 `--no-materials` 关闭。关闭 S05 时是四张、32 个基础部件；旧修订 2 是 30 个基础部件。张数与资产数读取冻结批次，不替换历史数据。

| 输入 | 合同及要求 |
| --- | --- |
| 参考图 | 核心计划入口接收可解析 PNG，非空且 ≤32 MiB；保留源字节和 SHA-256。宿主若允许 JPEG，先确定性转换为 PNG，同时保留原图及转换关系；不要将 JPEG 直接传给 PNG 入口 |
| 参考生成输入 | `description` 必填（最多 4000 字符），`style` 可选风格文件，未给时由文字确定性派生草稿、无额外文字模型；`guide` 可选 PNG，`reference` 是其 API 别名，不能同时传。默认 1024×1024、`resolution: native`，可选 `exact`；完整输入与提示词由程序冻结 |
| 风格草稿 | 符合 `schemas/skin-style.schema.json`；参考观察与适配规则分别记录，不伪装成人工接受 |
| 组件几何与配方 | 当前发布的 `configs/skin-template-set.draft.json`、`component-registry.draft.json`、`skin-usage.draft.json`；由计划冻结摘要 |
| 元数据 profile | `ui_skin_metadata_profile` 1.0；主题、字体、密度和切线推导基准。拷贝受维护的 profile 到 `work/` 后使用 |
| 生成适配器 | 部署方注入 `generate(frozenRequest) → Uint8Array`；每张最多提交一次，显式关闭供应商 SDK 自动重试 |
| 计算确认 | 参考图计划、组件批次各自新鲜且单次的摘要确认；参考人工接受是独立决定，不能用总括“全部同意”代替未来未知批次摘要 |

技术完成必须同时满足：全部所需图集有可信接收记录、来源和回执摘要一致、全部确定性节点通过、最终消费包完整、16 类组件独立加载检查通过。完成状态为 `awaiting-visual-review`，`productionReady: false`、`visualAcceptance: unreviewed`。这些字段与成功生成、原图检查及人工外观验收分别表达，不能相互推断。

当前工作树的完整批次入口在消费计算确认前检查已提供的 profile 路径、JSON、基本身份和主题格式；无效配置以 `batch-runner.invalid-profile-before-generation` 拒绝且不调用模型。这项加固晚于 rc.2，不能假定已发布 rc.2 包具备此检查。依赖实际像素的切线与安全区检查仍在后处理中执行。

## 每个节点的输入与输出

| 节点 | 输入 | 输出 / 状态 | 是否调用模型 |
| --- | --- | --- | --- |
| 模板与合同构建 | 发布内配置、锁定依赖、浏览器 | 模板清图/核对图、合同构建及 `current.json`；用于计划新鲜度校验 | 否 |
| 参考计划（仅生成模式） | 描述、可选风格/指导 PNG、尺寸和分辨率策略 | `directory`、`planSha256`、`requestSha256`、`styleSha256`；`awaiting-reference-confirmation` | 否 |
| 参考生成与接收 | 本计划确认、冻结请求、宿主适配器 | 原图/规范化 PNG/技术证据及摘要；通过为 `pending-visual-review`，尚未接受 | 是，最多一次 |
| 参考人工接受 | 实际预览的图片摘要和 accept/reject | `accepted` / `rejected-visual` 与 `reviewSha256`；只有 accepted 才能进入新图集桥接 | 否 |
| 批次准备 | 参考 PNG、风格 JSON、材质选项 | `plans/<planSha256>/` 冻结资源；`batches/<batchSha256>/batch.json` 与 `review.md`；`verified-awaiting-batch-confirmation` | 否 |
| 确认与授权 | 用户明确确认的同一批摘要 | 整批授权和各图单次预留；`authorized-awaiting-external-submission` | 否 |
| 外部生成 | 冻结 prompt、两张输入图、尺寸、图号、请求摘要 | 每图调用前独占登记；返回 PNG 或 `failed` / `indeterminate` 的真实观察记录 | 是，每图最多一次 |
| 接收与批次核验 | 原 PNG、提交/返回/接收证据、补图链 | 原始字节、检查、接收回执；`received` 与原图检查结论分别保留 | 否 |
| `source-s01`–`source-s04` | 四张完整源图与冻结摘要 | 四个文件完整性节点通过；S05 另行冻结，不混入四图定位 | 否 |
| `locate` | 四图与模板几何 | 部件定位、归属和提案报告；歧义不能静默选错部件 | 否 |
| `metadata` | 定位报告、冻结 profile | assembly 候选、切线/端帽/尺寸参数及警告 | 否 |
| `content-insets` | assembly 候选 | 文字、命中与内容安全区配置及派生证据 | 否 |
| `postprocess` | 安全区配置、可选冻结 S05 | 基础 SkinPack；S05 提取、透明 RGB 规范化派生与材质绑定；最终完整组件消费包；技术证据 | 否 |
| 独立消费检查 | 最终消费包 | `checks.json`、`wide.png`、`tall.png`；16 类组件及公共工厂检查；全部 DAG 完成后待视觉验收 | 否 |

节点产物由程序生成，任务记录只是索引和证据，不是可以任意编辑的成功标记。任务目录引用 `work/` 下的其他产物；只复制 `work/skin-tasks/<id>` 不构成完整迁移包。

## 可执行入口

下列命令均在 `game-ui-harnesses/ui-chain-harness/` 执行。尖括号表示程序返回的值或调用者准备的文件，不要照抄成路径。

```sh
npm ci --include=dev --ignore-scripts --no-audit --no-fund
npm run templates:build -- --browser chromium
npm run contracts:build
node scripts/component-entry.mjs contract
node scripts/skin-batch.mjs prepare --reference work/input/reference.png --style work/input/style.json --out work/skins/<id> --materials
node scripts/skin-batch.mjs verify --batch work/skins/<id>/batches/<batchSha256> --sha256 <batchSha256>
```

这些命令不提交模型。`templates:build` 要求相应浏览器已安装；安装浏览器属于部署准备，不发生在用户生成请求中。组件链路不需要安装面板规划 SDK。

文字起步的 CLI 顺序如下。`--adapter` 是部署方显式提供的受信模块（导出 `generate`），不包含本仓库预置凭证，不能接受 HTTP 客户端任意模块路径：

```sh
node scripts/reference-generation.mjs prepare --description "国风幻想，玉石与纸绢，克制云纹和金边" --out work/reference-plans
node scripts/reference-generation.mjs verify --directory <referenceDirectory> --plan-sha256 <referencePlanSha256>
node scripts/reference-generation.mjs execute --directory <referenceDirectory> --plan-sha256 <referencePlanSha256> --confirm-reference <referencePlanSha256> --adapter <trusted-adapter.mjs>
node scripts/reference-generation.mjs status --directory <referenceDirectory> --plan-sha256 <referencePlanSha256>
node scripts/reference-generation.mjs review --directory <referenceDirectory> --plan-sha256 <referencePlanSha256> --image-sha256 <imageSha256> --confirm-image <imageSha256> --decision accept
node scripts/reference-generation.mjs batch-prepare --directory <referenceDirectory> --plan-sha256 <referencePlanSha256> --review-sha256 <reviewSha256> --out work/skins/<id>
node scripts/reference-generation.mjs batch-execute --directory <referenceDirectory> --plan-sha256 <referencePlanSha256> --batch-directory <batchDirectory> --batch-sha256 <batchSha256> --source-reference-sha256 <sourceReferenceSha256> --skin-directory <skinDirectory> --confirm-batch <batchSha256> --adapter <trusted-adapter.mjs> --profile work/input/metadata-profile.json
```

必须先给用户展示对应计划和 PNG，再传确认参数；上述示例不是批量自动批准。prepare 可加 `--style`、`--guide`、`--width` / `--height` / `--resolution native|exact`；execute 可加 `--timeout-ms`，默认 300000（5 分钟）、允许 1–900000（最多 15 分钟）。本地接收中断时 `recover` 使用 status 相同的目录/计划参数，只处理已保存返回字节，零调用。

参考 QA 支持 8-bit RGB/RGBA、非交错 sRGB PNG，宽高均 256–4096，完全不透明且非单色；`exact` 要求尺寸匹配，`native` 允许原生尺寸且宽高比误差不超过 1%。通常输出无损 RGBA/sRGB PNG，QA 的 `normalization` 为 `lossless-rgba-srgb-v1`；若该编码超过 32 MiB，则保留已通过核心解码及全部 QA 的原 PNG，记录 `verified-original-png-v1`，并核验解码像素完全一致。两条路径均不重采样、不改变像素，原始 raw 保留。特殊编码、透明、单色或比例不符不会静默修图或重投。超时只表示本地等待结束，不证明远端调用已取消。

| 新公共 API | 参数与结果 |
| --- | --- |
| `prepareReferencePlan` | `{description,output,width?,height?,resolution?,style?,guide?,contracts?}`；返回冻结目录与计划/请求/风格摘要，不调用模型 |
| `verifyReferencePlan` / `inspectReference` / `recoverReferenceReception` | `{directory,planSha256,contracts?}`；分别核验、查询、恢复已保存原图的接收，不授权、不生成 |
| `executeReference` | `({...stage,confirmedReferencePlanSha256,timeoutMs?}, adapter)`；成功返回 `referenceFile`、`styleFile`、`rawFile` 及 image/style/raw 摘要、`adapterCallsThisRun: 1` |
| `reviewReference` | `{...stage,imageSha256,confirmedImageSha256,decision:'accept'|'reject',note?}`；返回决定与 `reviewSha256` |
| `prepareComponentsFromReference` | `{...stage,reviewSha256,output,materials=true,contracts?,templateOutput?}`；返回 `skinDirectory`、`batchDirectory`、`batchSha256`、`sourceReferenceSha256`、sheets/assets。**返回的 `directory` 仍指参考计划，不是批次目录** |
| `executeComponentsFromReference` | `({...stage,skinDirectory,batchSha256,confirmedBatchSha256,sourceReferenceSha256,profile?,allowRejectedLocalization?,maxConcurrentSheets?,contracts?}, adapter)`；再次核验已接受来源与冻结批次，返回既有 `{generation,task}` |

`stage` 为 `{directory,planSha256}`。参考适配器读取该阶段冻结的 `output`，输出不透明参考 PNG；图集适配器继续输出透明 PNG，不能写死透明选项。返回路径是核心本机文件路径，HTTP 宿主另映射为授权的文件 ID/URL。

`imageSha256` 是规范化参考 PNG 摘要；`styleSha256` 是冻结风格文件摘要。`sourceReferenceFile` 是批次目录的 `source-reference.json`，**`sourceReferenceSha256` 是该来源绑定 JSON 完整字节的 SHA-256，不是 PNG 摘要**。该文件绑定参考 plan/request/raw/image/style/review 和 batch 摘要；其内部自封印 `sha256` 也不能代替 API 返回的文件摘要。

生产宿主从 `src/components-api.mjs` 导入 `executeBatchPipeline(args, adapter)`。`args` 包含 Harness `work/` 下绝对路径 `skinDirectory`、不可变 `batchSha256`、本次确认的同一 `confirmedBatchSha256`、`work/` 下的 `profile`、默认 false 的 `allowRejectedLocalization`，以及只允许 1 或 2 的 `maxConcurrentSheets`。路径由宿主从授权的项目 ID 解析，不能直接使用客户端任意路径。适配器须支持选用的并发。

`adapter.generate` 接收冻结的 `prompt`、`images`（`style-reference` 与 `geometry-template` 的字节及摘要）、`width` / `height`、`output`、`sheetId`、`planSha256`、`requestSha256`。返回非空且 ≤32 MiB 的 PNG 字节；错误、无效类型或不明结果不得再次提交。`task: null` 表示没有满足后处理条件，不能把它当成完整组件包。

完整接收后也可只运行确定性 DAG：

```sh
npm run skins:task -- batch-status --batch work/skins/<id>/batches/<batchSha256> --sha256 <batchSha256>
npm run skins:task -- create --batch work/skins/<id>/batches/<batchSha256> --sha256 <batchSha256> --profile work/input/metadata-profile.json
npm run skins:task -- resume --directory work/skin-tasks/<taskId>
npm run skins:task -- status --directory work/skin-tasks/<taskId>
```

原图检查 rejected 默认阻止进入 DAG。只有明确采用已有候选策略才使用 `--allow-rejected-localization`：原失败保持，`originalChecksPassed: false` 保持，全部下游检查仍执行。全不透明材质、缺槽、来源不符等错误不能通过这个选项绕过。

最终 `postprocess` 节点输出中的 `consumerDirectory` 指向完整消费包，`directory` 指向保留检查证据的后处理目录。下游读取程序返回值，不扫描“最新文件夹”猜交付。独立复验已有包：`node scripts/consumer-check.mjs <consumerDirectory> --browser chromium`。完整离线管线复验：`node scripts/component-pipeline-check.mjs`，只使用替身/夹具，不提交模型。

## 交付、恢复与人工验收

交付应包括最终消费目录整体、SkinPack、`manifest.json`、技术报告与横竖预览。消费目录中有 `runtime.mjs`、`kit.json`、分离的 `skin/` PNG/字体/原始清单、来源摘要、依赖与许可证。不能只交 `runtime.mjs` 或几张截图；包内已有哈希须完整核验。

参考阶段的 `reserved-no-resubmit` / `indeterminate` 不允许重投；`rejected-technical` / `rejected-visual` 不能进入组件桥接。`reception-incomplete` 只有保留可信 returned 原字节时可 `recoverReferenceReception`；来源不足就停止，不将任意上传当作晚到图。恢复不生成、不改原失败为成功；需要另一张参考图时另建计划并取得新确认。已接受图片/审查或风格/工具摘要变化会拒绝桥接，不能复用旧组件授权。

`runAuthorizedBatch` 仅推进已授权且尚未 `begin` 的图；已接收、失败或未知图都不重投。图集需要新图时使用 `prepareSupplement` / `executeSupplement`，绑定新单图摘要和新确认，保留原记录。后处理失败使用原 `taskDirectory` 执行 `skins:task resume`，不重新生成。输入、工具、配置或产物摘要变化须新任务；不能改回执，锁恢复遵循[本地恢复规则](local-recovery.md)。

16 类为 Button、Switch、CheckBox、RadioGroup、Input、Select、Slider、ProgressBar、ScrollView、List、Dialog、Tabs、Image、Text、Container、Panel。组件基础、布局和材质配置仍包含 draft 限制；不可把技术通过标为已完成生产美术验收。人工核对参考风格、alpha、四角和拉伸、文字对比、普通/选中槽位、所有交互状态后再由宿主记录其独立验收决定。
