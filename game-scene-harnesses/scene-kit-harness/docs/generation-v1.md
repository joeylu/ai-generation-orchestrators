# 场景生成离线编排与外部交换 v1

源码 0.14.0。实现输入/风格合同、冻结计划、单次预留、原图接收、技术 QA、人工决定记录
与模块清单修订。**没有内置图像提供商适配器，也不会提交生成请求。** 本地 Studio
继续负责已验证地图编辑。完整路线与实际证据由 [执行文档](execution-plan.md) 维护。

0.6.0 的 v4 材料源计划与零调用派生见 [侧视地形材料验证合同](terrain-proof-v1.md)。
它区分一个生成来源与多个程序派生物，保留本文件的单次确认/原图审阅；不放宽 v1
精确模块尺寸、独立图片或 47 角色闭包政策。0.6.1 的同源裁取/变体修订绑定已验证的
父派生包，零生成、另存新目录；不改变原计划、原尝试、材料源接受或旧派生字节。
0.7.0 的完整邻域和连续材质试样额外要求材料源已获准确原图接受；继续零生成，
绑定并重验两版父包。它们有独立试样索引，不进入旧独立 PNG 模块批次或正式 kit。
0.12.0 的长材质场另绑定完整连续材质基线，提供零生成的 16 格长段对照；没有改变
任何图片计划、授权或接收政策，没有接入 Studio，见同一地形材料合同末节。
0.13.0 单独增加 [原生环境源 v5](environment-source-v1.md)，接收不透明天空和真实透明
远景/环境块。原参考图与精确模块规则不变；新源仍绑定同一单次授权/尝试/原图审阅
状态机，派生 PNG 与原图分开，接缝失败不自动修补或视为通过。
0.14.0 按用户要求，显式 v6/v2 环境源忽略 Alpha=0 的隐藏 RGB；旧 v5 政策保留。
同一原字节可按独立零计算复检进入待视觉审阅，布局高度另有有界试样。详见环境源
合同末节；它不提供新的计算授权或放宽其他 Alpha/完整性/接缝门槛。

## 可直接检查的合成演示

从本 Harness 目录执行；输出须是未存在的目录，父目录已存在：

```powershell
npm run workflow:demo -- --out ../../work/my-scene-generation-demo
```

程序读取三份 [合成输入示例](../examples/synthetic-generation/spec.json) 和已有夹具 PNG，
在 `workflow/` 保存事件/原图，在外层写 `demo-report.json`、`module-readiness.json`。
模拟风格/结构审阅、参考图结果、49 个模块结果，以及一个未知尝试的显式修订。全部
决定和图片均为测试替身；`purpose=synthetic-simulation`、`humanVisualReview=not-run`。

实际演示：47 地形角色、49 模块；初始模块清单 49 请求槽位，修订只新增 1 个计划；
共 51 次预留、50 个已接收夹具 PNG、1 个终态未知。旧清单保持不完整，新清单的
个体替身审阅闭包通过。实际媒体生成调用为 0，不证明真实图片工具可用、风格被用户
接受或场景包已经组装。49 是该独立 PNG 协议的夹具请求数，不是生产成本承诺。

## 三份输入合同

| 合同 | 事实与限制 |
| --- | --- |
| [SceneSpec](../schemas/scene-spec.schema.json) | 纯侧视；描述、场景参考 PNG、手绘布局 PNG 至少一种。图像角色显式且不重复；网格、像素密度、视窗和地图格数冻结 |
| [StyleRevision](../schemas/scene-style.schema.json) | preset/custom、名称和规则；custom 必须一张原始场景风格锚点。规则预设可无图，但不能冒充已有美术样本 |
| [ImageCapabilities](../schemas/image-capabilities.schema.json) | 宿主声明的图生图/文生图、精确尺寸、透明输出、输入张数与最大尺寸；无端点、模型路径或凭据 |

图像引用只保存原字节 SHA-256、字节数、实际像素尺寸；原字节保留在私有工作区。
当前接收非交错、8-bit RGB/RGBA PNG、单边最多 4096、单图最多 16 MiB。编码/元数据
不支持时明确拒绝，不静默重编码、抹背景或改变像素。其他输入格式留后续接收合同。

输入分工：手绘图约束结构；场景参考提供场景意图；风格锚点提供视觉语言。自然语言
和图中文字作为引用任务数据，不作为程序或工具指令。它们仍需要人工检查冲突、
侧视是否成立、风格是否适合完整场景；PNG 技术校验不能做这些判断。

草案通过格式校验后，分别记录绑定其准确摘要的结构/风格决定。仅接受的修订成为
当前修订。草案、审阅和原锚点不覆盖；修改使用新 ID。未接受草案不自动切换当前风格。

能力文件是声明，不是真实服务探测证据。精确尺寸 v1 计划要求 `exactSize=true` 且目标
处于声明范围；图片数、图生图或透明能力不满足时，在预留前拒绝。0.5.0 新增下述原生
参考图协议；合板拆分和特殊尺寸步进仍未实现。不能偷偷缩放 64 格图片或修改旧计划。

## 原生画布参考图扩展（0.5.0）

明确区分两种输出：主视觉参考图允许保留工具原生画布；模块必须满足精确几何和尺寸。
没有尺寸参数的工具不能声明 `exactSize=true`。原生参考图通过也不证明该工具能够生成
64×64 地块、无缝条带或指定透明环境块。

新增工作区显式选择 `compiler=scene-kit-native-reference-v2`，或使用 CLI `init-native`。
旧工作区默认仍是 `scene-kit-generation-v1`，原计划/QA 的编译和摘要保持不变，不能
在旧工作区写入 v2 计划。新工作区可以继续冻结 v1 精确模块计划。

`previewNativeReference(root, options)` 接收五个准确字段：`specSha256`、`styleSha256`、
`capabilitiesSha256`、`pixelPolicy`、`intent`。它验证已有草案/原图和能力声明，产生
`ai_scene_reference_proposal_v1`，包含完整请求与请求摘要、设计审阅状态和
`executable=false`。它不写事件，不成为计划，不接受设计，也不能授权或预留。
其请求可以在同一草案获审后原样进入冻结计划；草案/选项变化会改变请求摘要。

`freezeNativeReferencePlan` 的字段是 `planId`、`parents`、`capabilitiesSha256`、
`pixelPolicy`、`intent`，必须已有准确结构和画风接受记录。冻结为
`ai_scene_generation_plan_v2` / `scene-kit-native-reference-v2`，请求版本为
`ai_scene_image_request_v2`。只支持 reference 阶段，不接受 `pixelSize` 或模块角色。
它继续使用原有单次确认/预留/未知终止/原字节审阅状态机。

`pixelPolicy` 是封闭结构：`mode=native-reference`、`orientation=landscape`、
`minimumShortEdge`（至少 256）、`maximumWidth`、`maximumHeight`（受能力上限和
PNG 4096 上限约束）。这些是实际结果的接收门槛，不是工具兑现尺寸的承诺。
实际宽必须大于高；不要求与偏好视窗完全同宽高比。不进行自动裁切、缩放或背景处理。

技术结果独立版本为 `ai_scene_technical_qa_v2` / `native-reference-png-v1`：
保留实际画布尺寸、准确 raw SHA；检查原 PNG、横向、短边/最大尺寸、不透明、非单色。
它显式带 `geometryEvidence=visual-reference-only-no-map-transform`。
视窗仅是构图偏好；不能将原图像素映射为格子、碰撞或正式地图坐标。
失败原字节仍保留，不能靠换尺寸或重编码绕过失败。准确原图仍需独立人工接受。

已接受的 v2 参考图可以成为 v1 模块计划的图像依赖；它的实际尺寸和原 SHA 随依赖
冻结。模块仍要求 `exactSize=true`，原生参考图的容许范围不会传给模块。
显式修订 v2 计划保留原像素政策、失败前序和新计划确认门禁，不会自动重投。

[森林遗迹草案](../examples/forest-ruins/) 可用 `reference:prepare` 生成新的私有准备包。
它只有 3 个 draft 事件，另存 proposal、完整提示词和报告；无虚构的设计接受或计算授权。
当前没有实际执行适配器，也没有核实模型身份。实际生图仍受本目录 AGENTS 范围和
准确计划计算确认约束。

### 原文件复检与编辑计划

首图试跑发现原生 PNG 包含 `caBX` 附属块。PNG 允许解码器忽略不影响显示的附属块，
但不允许把不理解的关键块当作成功。[PNG 文件结构规范](https://www.w3.org/TR/PNG-Structure.html)
`caBX` 用于承载 C2PA 数据；本核心不解释或认证其中的声明。
[C2PA PNG 绑定规范](https://spec.c2pa.org/specifications/specifications/2.1/specs/C2PA_Specification.html)

默认 PNG 读取器及旧 v1/v2 QA 继续拒绝该配置。新的固定政策
`native-reference-png-cabx-v1` 仅额外允许一个位于 IDAT 前、1—262144 字节、CRC 正确
的 `caBX`；不解释其内部数据，不放行色彩/透明元数据或其他未知块，不改动任何原字节。
宽高、空图、不透明性和其余 PNG 完整性仍检查。结果是 `ai_scene_technical_qa_v3`，
带 `metadataTrust=not-verified`。

`reinspectNativeReference(root,{inspectionId,sourcePlanSha256})` 只接受已有原字节、当前
设计下的 v2 原生参考生成结果，且原 QA 只有 `OUTPUT_PNG_UNSUPPORTED` 一项。
它追加 `ai_scene_reference_reinspection_v1`，绑定原计划、原 QA 和同一 raw SHA；
**不替换原失败、授权或尝试**。新的引用节点明确是 `kind=reference-reinspection`、
`maximumCalls=0`、`reserved=false`。它不能授权、预留或直接修订成生成尝试。
CLI 为 `reinspect-reference --root ... --file ...`。

复检通过也只进入 `pending-visual-review`，须使用同一 `reviewResult` 准确绑定原图
和新技术摘要。接受后该节点可作为精确模块依赖；原失败节点仍保留。复检失败也不能
接受。`recheckResult` 分别重放旧 QA 和新 QA，各自维持原语义；没有重新调用图像工具。

`freezeNativeReferenceEdit` / CLI `plan-reference-edit` 冻结
`ai_scene_generation_plan_v3` / `scene-kit-native-reference-edit-v3`。封闭选项为
`planId、parents、editSourceSha256、capabilitiesSha256、pixelPolicy、intent`。
`editSourceSha256` 指向技术通过且已有准确 accept/reject 视觉决定的参考节点。
被拒绝图片可以作为修改来源，不会因此变成已接受的参考图。

v3 计划冻结当前已接受结构/画风、原图 SHA/实际尺寸、原 QA/视觉决定、明确的
`edit-target` 图像角色、修改意图、一次调用与原生像素政策；接收政策显式包含 caBX。
目前编辑编译器要求宿主声明文生图和图生图，且图像数覆盖全部输入角色。它沿用
single-use 确认/预留、未知终止、准确原图审阅。旧确认不能支付新编辑；显式修订
仍需新计划/确认，保留原编辑来源，不默认为最近一次结果。

新增 22 项原生/复检/编辑用例，包含元数据 CRC/位置/重复/上限、旧失败保留、零计算
不能预留、视觉拒绝来源、准确编辑依赖和 Alpha 检查。核心/宿主全套 114 项通过；
测试仅用合成 PNG 和替身决定。

## 冻结参考图和模块计划

每份 `ai_scene_generation_plan_v1` 绑定：结构与风格原文/摘要及其审阅摘要、能力摘要、
输出尺寸/Alpha、图像角色、完整请求和编译器版本。核心从来源重编译请求再验证，
不能通过修改提示后重新填 SHA 绕过规则。公开计划没有授权 nonce、私有地址或工作流。

参考图计划只约束一张完整参考 PNG；严格检查原尺寸、全不透明、非单色空图。技术
通过进入 `pending-visual-review`。用户须查看实际原图，再明确接受或拒绝该原图 SHA。
接受参考图只成为模块规划的依赖，不授权任何模块生成。

`freezeModuleBatch` 从 P1 已验证 kit 提取结构清单：模块角色、47 邻接覆盖、像素尺寸、
占地、锚点、偏移和重复轴，去掉旧美术 source。这个 kit 是结构模板；合成标记不会
自动作为生产美术参考。结构网格与像素密度必须匹配 SceneSpec。

每个模块一份 PNG 计划，绑定已接受的场景参考原图和同一风格。模块 role、数量与图像
请求数量分开。输出环境块要求有效透明像素；地形/条带保留声明的 Alpha 能力，不通过
旋转、拉伸、自动分割或重复旧图补角色。提示里的拓扑和锚点不等于实际几何被证明，
参考/模块的美术、接缝、重复感仍须独立审阅。

## 计算与审阅状态

```text
planned → authorized → reserved → submitted（可选的外部回执记录）
                        │               │
                        ├───────────────┤
                        ├→ failed / indeterminate（终态，禁止重新预留）
                        └→ 原图接收 → rejected-technical（终态）
                                      或 pending-visual-review
                                            → accepted / rejected-visual
```

1. `authorizePlan` 只能接收人工明确给出的 `approve-compute` 决定，准确绑定计划摘要，
   程序创建新 nonce、最大一次调用。审核图片、切换风格、编辑地图不会自动授权。
2. `reservePlan` 先将单次预留事件写盘并 fsync，再返回 `{planSha256,attemptSha256,
   requestSha256,request}`。重复或并发请求最多一个能得到交换请求；同一个授权不能
   再次预留。能力和当前风格/结构在授权与预留处都重验。冻结请求本身可供事前查看；
   本地预留不能阻止不守约的外部调用方复制请求，实际执行宿主必须自己遵守票据只提交一次。
3. 本核心没有网络提交函数。外部宿主负责执行冻结请求并严格遵守单次提交；用户是否
   确认计算由可信宿主/人工输入负责。CLI 不证明操作人身份，不提供登录系统。Agent
   只能转达用户已给出的决定，不能自行填写通过。
4. 外部可能已接受请求后，丢回执、断网、超时或崩溃都不能再次派发。`reserved` 也
   不等于“肯定没提交”。用 `stopAttempt(...,'indeterminate')` 记录终态；后到结果不能
   静默替换该终态。没有自动重试、自动释放授权或后台重投。
5. `receiveResult` 验证票据，保存原始字节，再由固定政策生成 QA。失败 PNG、错误尺寸、
   不满足 Alpha、空图均原样保留并终止该尝试。`recheckResult` 只对相同 raw SHA 做
   零调用重放，不提升失败状态、不改变像素。
6. 图片人工决定同时绑定计划、技术记录和准确 raw SHA；技术未通过不能接受。接受或
   拒绝后不覆写决定。只有未来新计划/新原图可以再次审阅。

风格或结构被新修订替代后，旧计划不能花费未使用授权；已预留尝试的历史结果仍可
接收/审阅，但不能成为新风格模块的当前依赖。旧结果不会自动升级成新版本。

## 显式修订和闭包检查

`reviseGenerationPlan` 只接受失败、未知或被拒绝的前序，创建新 ID/摘要并保留 parent。
新计划从 planned 开始，须新确认；不会复用旧授权或改变旧 raw、QA 和决定。

`reviseModuleBatch` 创建新清单，只替换指定角色的直接修订计划；未变角色保留原计划，
记录新增请求数。旧清单仍保留其缺项。清单冻结/修订本身不授权执行整包。

`inspectModuleBatch` 从事件链和原字节重新核验：当前引用、完整角色清单、逐图 QA 和
个体审阅。不同地形角色复用同一原图会报错。结果显式带工作区用途和决定类别；即使
全部个体审阅齐全，仍是 `packageAssembly=not-run`、`packageVisualAcceptance=not-assessed`。
本阶段不把它转换为正式 kit、默认地图接受记录或生产交付 manifest。

## API、CLI 与本地证据

Node 入口 `ai-scene-kit-contracts/generation`，源码
[`src/generation/index.mjs`](../src/generation/index.mjs)。无需第三方核心依赖。

| API | 作用 |
| --- | --- |
| initWorkflow/importWorkflowImage/readWorkflowImage | 新建工作区，保存与读取准确原字节 |
| createDesignDraft/reviewDesign | 结构/风格/能力草案及分开的人工审阅 |
| freezeReferencePlan/freezeModuleBatch/getGenerationPlan | 零调用冻结、查询计划与完整模块清单 |
| previewNativeReference/freezeNativeReferencePlan | 原生参考图草案预览与获审后的独立版本计划 |
| reinspectNativeReference/freezeNativeReferenceEdit | 同一原文件零计算复检、带准确原图的编辑计划 |
| freezeTerrainMaterialPlan/buildTerrainProofBundle/verifyTerrainProofBundle | 独立材料计划、三布局派生与逐字节重放 |
| reviseTerrainProofBundle/verifyTerrainProofRevision | 验证父派生包后，从同一材料源派生四变体新预览；零生成重放 |
| buildTerrainModuleStudy/verifyTerrainModuleStudy | 已接受来源的 47 邻域、九取样试验；零生成构建/重放 |
| buildTerrainContinuityStudy/verifyTerrainContinuityStudy | 已接受来源的连续材质场与固定相位试样；零生成构建/重放 |
| loadTerrainStudyPreview/readTerrainStudyPreviewImage | 重验当前接受及完整来源后返回不透明句柄，按固定键读取快照副本；零生成、不追加事件 |
| readGenerationInput | 按冻结计划索引读取准确图像输入 |
| authorizePlan/reservePlan/recordSubmission | 单次明确确认、预留和外部提交回执记录 |
| receiveResult/recheckResult/reviewResult/stopAttempt | 原图接收、技术重放、准确图片审阅和终止 |
| reviseGenerationPlan/reviseModuleBatch | 新计划与角色替换，不修改前序 |
| inspectWorkflow/inspectModuleBatch | 事件/来源/引用与个体审阅闭包检查 |

```powershell
npm run workflow -- --help
# 只创建空工作区，不生图、不接受草案、不授予计算：
npm run workflow -- init --root ../../work/my-scene-workflow --id my.scene --purpose external-exchange
npm run workflow -- inspect --root ../../work/my-scene-workflow
```

CLI 的 `--file` 接收本地草案/决定 JSON；`receive` 和 `import-image` 接收原图文件。
决定格式为 `decisionId、decision、targetSha256、notes`，图片 target 是 raw SHA，设计
target 是草案 SHA，计算 target 是计划 SHA。决定 ID 全工作区唯一。

`reserve` 输出 `result.ticket`（三个摘要）和 `result.request`；外部宿主保存票据用于
`submitted/receive/stop --ticket TICKET_JSON`。CLI 不打印授权 nonce。参数错误退出 2，
操作/校验失败退出 1，诊断不回显本机选定路径。请求/票据是私有交换材料，不作为公开
资产包或日志发布。

工作区须位于 Harness 源码之外的私有目录，如仓库忽略的 `work/`。固定内容为：
`workflow.json`、追加的 `events/000001.json`、按 SHA 存放的 `blobs/*.bin`。
单写者独占锁；检验连续事件链、完整记录摘要、请求重编译、字节哈希及合法状态转移。
拒绝链接/目录穿越和超限内容。检查/重放会短暂取得同一锁，但不提交生成或写新证据。

崩溃锁不自动清理，半写文件不自动修复。出现锁或完整性错误需停止并人工检查；不得
删掉未知尝试以重投。文件锁和 fsync 不是对恶意本机写入者或断电持久性的认证保证。
授权/尝试/决定是本地操作记录，不是密码签名的身份凭据。

目前全量读取、验链和重放，最多 4096 事件/32 MiB 日志/256 MiB 原字节；不是数据库
或分布式调度器。后续迁移须显式版本化，不能以新编译器悄悄解释旧冻结请求。

P4（0.4.0）验证：新增 19 项回归，核心/宿主合计 92 项及既有浏览器 9 项均通过；11 份
Schema 经已有 Ajv 2020 strict 独立编译，6 份 kit 夹具加 3 份输入示例共 9 份数据通过。
测试与演示没有调用图像、视频、私有服务或真实审阅者。
