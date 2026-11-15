# 环境源、透明层接收与派生试样 v1

源码 0.17.0。下文先保留 0.13.0 的 v5/v1 冻结合同，末节说明当前 v6/v2 原生源
政策、零计算复检与独立高度试样。原生源的隐藏 RGB 已按用户要求取消拒收；
派生资产的零 Alpha RGB 仍由程序输出为零。

实现独立冻结计划、原生 PNG 接收、Alpha 检查和确定性环境试样；
不增加提供商执行器、画布生图按钮或正式美术 kit。新源的真实生成、派生美术接受、
便携整包与目标项目接入均另行验收。路线与真实状态见 [执行文档](execution-plan.md)。

## 独立计划

`freezeEnvironmentSourcePlan(root, options)` 只用于显式 native-reference-v2 工作区。
options 必须且仅有 `planId, parents, referencePlanSha256, capabilitiesSha256, assetId,
role, sourcePolicy, derivation, intent`。程序绑定当前已接受结构/画风、准确已接受参考
原 PNG、技术检查与人工决定，以及固定处理 Profile，生成
`ai_scene_generation_plan_v5 / scene-kit-environment-source-v1`。新计划不修改旧 v1—v4
编译器、请求、接收或摘要，也不自动授权。旧版程序不承诺能读取新增 v5 事件。

role 支持天空、远山、远林、树组、拱券组、残墙组与前景植被；assetId 区分同类候选。
仅天空为不透明背景，远山/远林为透明 x 条带，其余为透明环境块。不含地形角色、
碰撞、道具、角色、UI、图集或多图合板。

`sourcePolicy` 是封闭对象：`mode=native-environment`、`orientation=landscape|any`，
以及 256—4096 整数的 `minimumWidth,minimumHeight,maximumWidth,maximumHeight`。
最小值不得大于最大值；最大值须在宿主声明内。这是接收门槛，不能宣称工具保证
原生画布尺寸。`derivation` 只有 `pixelSize {width,height}`（1—2048）、`fit` 和
`repeatAxis`，后两者由角色固定；派生尺寸不是原生精确生成承诺。

必须声明图生图能力，图像槽位足以包含准确参考图及画风锚点。透明角色还要求
`transparentBackground=true`，无需 `exactSize=true`。能力声明不是实际执行探测；
图片工具不能兑现时保留失败证据，不修改声明或既有计划以绕过失败。

原有 `authorizePlan / reservePlan / recordSubmission / receiveResult / reviewResult`
继续使用。每个新计划需要绑定准确摘要的新单次计算决定。预留后最多外部提交一次，
未知为终态；`reviseGenerationPlan` 仅显式修订失败/未知/技术拒绝/视觉拒绝的计划，
保留角色、资产、原生政策与派生规则，并重新确认。参考接受不授权环境生成。

## 原始 PNG 技术接收

v5 使用单独的 `ai_scene_environment_source_qa_v1`。保留原生 PNG 全部字节，沿用
非交错 8-bit RGB/RGBA、CRC、解压预算、每边 4096、16 MiB、零 Alpha RGB 必须为零
的门槛；允许既定位置/大小的 caBX，不解释其声明。未知关键块/不支持元数据仍拒绝。
原接收器及其他 QA 政策不变，失败原字节仍进入不可变来源存储。

除实际尺寸/方向、可见且非单色外，透明层还检查：

- 至少 1% 像素 Alpha=0，且至少 1% 像素 Alpha>0；仅一个透明像素或整张半透明
  背板不能冒充独立透明层。保留 1—254 连续 Alpha，不做阈值二值化。
- 环境块四边各两像素须完全透明；条带只要求顶部两行透明，并在左/右边各有可见
  像素，以便全宽取样。此检查不证明主体未截断或左/右能自然相连。
- 记录准确零/半透明/可见计数、非零 Alpha 包围盒、留边违例和两侧可见计数。
  拱洞是否真的透明、树冠是否完整、是否画了棋盘格/天空实底，仍需准确原图人工检查。

技术接收通过只进入 pending-visual-review，不代表原图已接受、条带可重复或正式
模块通过。不以抹背景、重编码、换尺寸、自动新调用来掩盖技术失败。

## 零生成派生

`buildEnvironmentProofBundle(root,planSha256,out)` 要求当前设计/参考有效且准确原图
技术通过，可在原图待审时生成比较材料；不写人工决定。源被接受后同包重放字节不变，
源被拒绝后不能用它继续构建。verify 对准确来源重新计算全部文件，拒绝改图、未知
文件、链接、覆盖和工作区/源码目录重叠。

固定规则见 [Profile](../src/generation/environment-source.mjs)：

| 角色 | 冻结处理 |
| --- | --- |
| 天空 | 以目标宽高比作居中覆盖裁区，再面积缩小到目标；裁区不够大则拒绝，不放大 |
| 环境块 | 非零 Alpha 包围盒向外扩两像素并限制在原画布，完整保留可见部分；等比容纳、只缩不放，底部居中填透明边 |
| 远景条带 | 横向保持完整原画布，只去掉可见范围外的多余竖向透明空白并保留两像素；按目标宽等比缩小，过高或需放大时拒绝；底部对齐填透明边 |

整数尺寸向下取整，记录准确裁区、实际缩小尺寸、偏移、取整规则。环境锚点为左下
最后一个像素 `(0,height−1)`，天空为 `(0,0)`。源与输出均独立保存，不能将原图像素
直接当作世界碰撞或比例证据。

缩放使用整数面积权重，先以 Alpha 加权颜色，再求 straight RGBA；Alpha 按覆盖
面积取整。Alpha=0 输出 RGB=0；若极淡分散的原像素缩小后全部归零，拒绝空的派生
资产并保留原图，不放大 Alpha 补成可见。不引入底色或抠图，不修补原图缺失内容。
报告另记派生图 Alpha 数量/包围盒。明/暗棋盘对照只是检查图，透明 PNG 才是资产候选。

条带逐行比较输出首/尾列的 RGBA，要求准确相等；不自动混边或修缝。失败包状态
`blocked-seam`，仍提供三周期对照供审阅；字节重放成功也保留该失败状态。
三周期图在宽度超过 1024 时先等比缩小展示，源候选 PNG 保持原派生尺寸。首尾准确
相等也不证明山势/树冠/明暗自然；所有派生图美术状态继续 not-assessed。

包含原 PNG、派生 PNG、明/暗对照、派生报告与清单：天空/块 6 文件，条带增加三周期
图共 7 文件。包标记 productionKit=false。verify 额外返回 `environmentStatus` 和
独立 seam 结果，不能把 deterministic-proof-valid 当作可发布状态。

派生图人工接受记录、正式资产目录装配和 Studio/Pixi 外观接入尚未实现；当前只
接通原图审阅与离线试样。这与旧 terrain-study 句柄、已编辑用户地图及其导出无关。

## 准备与检查

从本 Harness 目录运行，输出必须是未存在的新目录，父目录已存在：

```powershell
npm run environment:prepare -- --root WORKFLOW --reference ACCEPTED_REFERENCE_PLAN --capabilities CAPABILITIES_SHA --file DEFINITION_JSON --out NEW_DIRECTORY
npm run workflow -- build-environment-proof --root WORKFLOW --plan ENVIRONMENT_PLAN_SHA --out PROOF_DIRECTORY
npm run workflow -- verify-environment-proof --root WORKFLOW --plan ENVIRONMENT_PLAN_SHA --out PROOF_DIRECTORY
```

准备程序读取封闭的 definition，冻结一个计划并导出完整提示、处理 Profile、准确
参考 PNG 和准备报告；不授权、不预留、不调用模型。v5 计划也可用 workflow 的
`plan-environment-source --root WORKFLOW --file OPTIONS_JSON` 冻结。原图接收与审阅继续
使用原有 CLI 命令。

[天空](../examples/forest-ruins/environment-sources/sky.json)、
[远山](../examples/forest-ruins/environment-sources/far-mountains.json)、
[远林](../examples/forest-ruins/environment-sources/far-forest.json) 是有界首批候选；
定义不是已生成的图片或用户计算确认。23 项新增合成
回归及全量 246 项核心/宿主测试通过，0 失败/跳过；测试没有调用生成或使用真实美术。

## 0.14.0：原生源隐藏 RGB 不再拒收

这是用户明确要求的新原生源政策，不修改任何原始图片。固定
`ENVIRONMENT_SOURCE_PROFILE_V2` 将 Alpha=0 的 RGB 视为不可见数据，记录数量而不列入
issues。PNG 的 CRC、块/位深/解压预算、尺寸/方向、可见/透明面积、Alpha 留边与
完整性仍检查。隐藏颜色的变化不计入 varied；空的 Alpha 不能靠隐藏颜色冒充非空图。

底层 PNG 默认仍严格，只有显式 allowHiddenRgb 的原生环境接收解码才允许并返回
hiddenRgbPixels，includePixels 保留原始 RGBA。旧 v5 接收/请求/摘要不改变，旧参考、
材料、精确模块与正式导出继续使用原政策。没有自动清理或重编码原图。

新 `freezeEnvironmentSourcePlanV2` 使用相同 options，冻结明确的 v6 请求和 v2 Profile；
`environment:prepare` 自 0.14.0 默认调用该新入口。旧 freezeEnvironmentSourcePlan 和
plan-environment-source 命令仍明确产生 v5；新 CLI 为 plan-environment-source-v2。
源接收 QA v2 只把隐藏颜色作为诊断，实际接收仍不能代替人工作品审阅。单次确认、
预留、未知终止和新修订要求保持。

对已收到且旧 v5 仅报告 PNG_UNSUPPORTED、准确严格解码原因是隐藏 RGB 的来源，
可调用 `reinspectEnvironmentSource(root,{inspectionId,sourcePlanSha256})`。它在当前
设计/参考下重读同一原字节，产生独立的 environment-reinspection 与 QA v2，保留
原失败和原尝试；request.maximumCalls=0，不能授权、预留或修订成生成。其他错误
不会借此放行。新 QA 通过只进入 pending-visual-review，同一原图仍需独立人工作品
接受。recheck 能分别重放旧失败与新复检结果。

### 独立高度试样

`buildEnvironmentLayoutStudy(root,assessmentSha,{studyId,pixelSize},out)` 与 verify 只
用于 v2 透明条带来源，保持原目标宽、允许增加画布高至 2048。封闭 options 生成
有摘要的 layoutStudy，绑定准确源评估、原目标摘要/尺寸和新尺寸；原目标、原计划
都不改变。不能改宽、缩小高度、拉伸、丢弃微弱 Alpha、修边或改变接缝规则。

程序仍按全 Alpha 包围盒、原固定规则面积缩小与底部对齐；新包明确标记
separate-height-study-not-original-delivery，报告同时含新旧 target。源 Alpha>0 的
颜色参与面积加权；隐藏 RGB 对派生可见像素/Alpha 没有影响，输出 Alpha=0 时 RGB=0。
同一源的隐藏颜色是彩色或零，所派生资产和对照图字节相同，已用合成回归证明。

布局试样依然提供明/暗对照和三周期图；接缝失败保持 blocked-seam。新画布能容纳
来源不代表原目标通过，也不是新的生成来源或可交付美术包。

```powershell
npm run workflow -- reinspect-environment --root WORKFLOW --file REINSPECTION_OPTIONS_JSON
npm run workflow -- build-environment-layout-study --root WORKFLOW --plan ASSESSMENT_SHA --file LAYOUT_STUDY_JSON --out NEW_DIRECTORY
npm run workflow -- verify-environment-layout-study --root WORKFLOW --plan ASSESSMENT_SHA --file LAYOUT_STUDY_JSON --out NEW_DIRECTORY
```

新增 9 项合成回归，全量 255 项核心/宿主测试通过、0 失败/跳过。覆盖默认严格、显式
源解码、v5/v6 隔离、原图不变、零计算复检、剩余失败门槛、Alpha/可见颜色不受隐藏
RGB 影响、当前设计、伪造 QA 拒绝、独立高度/原合同分离、接缝失败、重放/篡改与 CLI。

### 有限远景示例：0.15.0

用户接受源作品并选择有限远景后，可通过 `buildFiniteEnvironmentDemo` 构建独立的
演示 kit。入口重放当前设计、准确源技术 QA、源作品接受；options 为封闭结构
`{exampleId,parallax:{numerator,denominator},layoutStudy:{studyId,pixelSize}}`。
只允许已验证的合成工程基础 kit、1:1 密度、左侧初始镜头、单屏高度和匹配源高度。
不会将接缝失败的条带改成成功：准确派生 PNG 作为 repeatAxis=none 的 environment
模块加入新 art-candidate kit，原始 x 条带派生报告和 blocked-seam 原样放入证据。

宽度按 `视窗宽＋横向相机行程×视差` 以有理数验证，覆盖整个连续行程，不能仅靠
五个采样点。不足时在写文件前失败。只承诺源原点 (0,0)、固定游戏视窗及声明地图
边界下的横向滚动；扩建、移动远山、更改视差或视窗后必须重新核算。不认证循环。

新目录包含 kit、有限覆盖、准确源接受与派生证据、原图及摘要清单；地形保留工程
数据，可额外配置已有地形试样；天空是明确标记的纯色工程占位。独立包不会改写
旧 kit/试样、已有作者地图或作品接受。productionKit=false、visualAcceptance=
not-assessed。verify 从工作流与基础 kit 完整重编译，拒绝改图、伪造清单和额外文件。

```powershell
npm run workflow -- build-finite-environment-demo --root WORKFLOW --plan ACCEPTED_ASSESSMENT_SHA --kit BASE_KIT --file OPTIONS_JSON --out NEW_DIRECTORY
npm run workflow -- verify-finite-environment-demo --root WORKFLOW --plan ACCEPTED_ASSESSMENT_SHA --kit BASE_KIT --file OPTIONS_JSON --out DEMO_DIRECTORY
npm run studio -- --kit DEMO_DIRECTORY/kit
```

这两个命令不计算图片、不追加生成尝试或自动记录新的美术决定。源作品接受并不等于
派生模块、工程占位或整包接受。完整私有样例证据与检查范围见执行文档第 35 节。
