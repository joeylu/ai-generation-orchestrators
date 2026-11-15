# 侧视地形材料与拼接验证合同 v1

源码 0.8.0。已实现冻结材料源计划、零调用派生、几何/共享边检查、同源修订、完整邻域
与连续材质试样、目录重放。
没有内置图像执行器。本合同记录材料与地形工程试样，不是正式地形生产器或完整资产包。
实际阶段与用户决定由 [执行文档](execution-plan.md) 维护。

## 来源、角色与调用数

一张已接受的场景主视觉提供外观参考。一次新的、单独确认的图片请求生成一张不透明
正侧视材料源：画布上方八分之一为侧面苔草沿，下方为正面石土材质；没有顶部平面、
风景、透视地面、独立物件、空背景或图集。语义和画风仍需人工检查。

v1 程序从同一源派生 16 个四向边界试样，再拼成直段、台阶、断崖三个布局。它们共享
材质与像素边界；**不是 16 次独立生成，也没有完成 47 个八邻域角色**。图像请求数、
原始来源数、派生 PNG 数和人工接受分别记录。

新计划 `ai_scene_generation_plan_v4` / `scene-kit-terrain-material-v1` 绑定：

- 当前已接受的 SceneSpec/StyleRevision 和准确设计决定；工程基线仅支持 64×64、1:1。
- 已接受参考图的计划、原始 PNG、技术 QA 和视觉决定摘要。
- `accepted-scene-style-reference` 图像角色；额外自定义风格锚点另列，不能混为布局模板。
- 宿主图生图/图像数/接收尺寸声明，以及完整提示词和最大一次请求。
- 完整 `ai_scene_terrain_proof_profile_v1` 与其摘要。

工作区必须显式使用既有 native v2 标记。旧 v1 工作区不隐式迁移，旧 v1/v2/v3 计划与
QA 保持原语义。v1 精确尺寸模块仍要求 `exactSize=true`；材料计划允许原生画布，
不能冒充 v1 精确模块成功。没有提供商路径、地址、密钥或隐式网络调用。

单次确认、先预留后派发、未知终态、准确原图审阅与显式新计划修订继续沿用
[生成交换合同](generation-v1.md)。场景参考图的接受不支付这一次材料生成。

## 固定工程 Profile

权威数据为 [`TERRAIN_PROOF`](../src/terrain-proof/profile.mjs)，格式为
`ai_scene_terrain_proof_profile_v1`，profile 为 `sideview-material-proof-v1`。
本版不接收任意裁取/遮罩参数；修改规则必须产生新版本，不重解释旧计划。

| 项目 | 固定值与含义 |
| --- | --- |
| 逻辑格/密度/锚点 | 64×64，1:1，左上 `(0,0)`；identity，无外伸或顶部四边形 |
| 源 PNG | 原生横向，短边至少 512，单边最多 4096；RGB/RGBA8、非交错、全不透明、非单色，单图最多 16 MiB |
| PNG 附属块 | 固定 caBX 接收政策，保留原字节；不认证其中声明，其他未知配置拒绝 |
| 派生材料 | body 64×64，cap 64×8；不从主视觉像素推导地图坐标 |
| 共用边处理 | 4 像素对边混合带；body 先 x 后 y，cap 只做 x |
| 边界绘制 | 草沿 8 像素；外露左/右/下边内部 2 像素乘 3/4，整数四舍五入 |
| 占格/Alpha | 实心方格内 Alpha=255，空格 Alpha/RGB=0；不修补或改变生成源的 Alpha |
| 自动接缝 | 相同边界装饰类型的共享接口逐 RGBA 通道差为 0；每接口至少比较 3/4 像素 |
| 人工转折 | 不同草沿/侧边装饰类型的转折位置逐一报告，不记作自动视觉通过 |

本版不证明内凹角完整表现、坡面、单向平台、破坏、多个材质过渡、物理行为、GPU
缩放/图集采样、远中近景或长图视觉不重复。相同原材料会重复，实际审阅须检查图案
节奏、混合带是否显眼和转角是否自然；像素相等不能替代这些判断。

## 可重放的裁取与派生

对于原生源尺寸 `W×H`，要求 `W>H`。令 `S=H`、`X=floor((W-S)/2)`、
`C=floor(S/8)`、`B=S-C`：

1. cap 区域是 `(X,0,S,C)`，采样到 64×8。
2. body 区域是 `(X+floor((S-B)/2),C,B,B)`，采样到 64×64。
3. 裁取坐标由程序写入派生记录；这是材料图上的声明处理，原始 PNG 单独保留。
   不把裁取当成恢复被遮挡内容，也不裁改已接受的场景主视觉。
4. 采样采用整数面积加权、半数向上取整，不使用浏览器 Canvas 或平台图像库。
   输出像素覆盖的权重和分别是裁取宽与高，分母是二者乘积；RGBA 源必须全不透明。
5. 距对边距离 `d=0..3` 的像素成对取均值，再以 `(4-d)/4` 权重混合；最外侧的
   对边像素完全相等，内部不在混合带的像素不修改。body 依次处理 x/y，cap 保留上下差异。
6. 依占格派生四向邻接 N/E/S/W（位值 1/4/16/64）。body 填实心格，仅外露上边覆盖
   cap，外露左/右/下边绘制内侧阴影。16 个组合不声称覆盖八邻域 47 个美术角色。

三个布局均底部对齐：

| 布局 | 格数 | 逐列高度 | 派生尺寸 |
| --- | --- | --- | --- |
| straight | 8×4 | 2,2,2,2,2,2,2,2 | 512×256 |
| steps | 8×5 | 1,1,2,2,3,3,2,2 | 512×320 |
| cliff | 8×5 | 3,3,3,3,3,0,0,0 | 512×320 |

地图占格负责几何；图片 Alpha 不能反向修改占格。该试样不输出正式碰撞或作者地图，
不覆盖 Studio 内存地图，也不替换其合成资源。

## 检查和文件边界

接收材料的技术记录是 `ai_scene_terrain_material_qa_v1`，只证明源 PNG/尺寸/方向/
不透明/非单色，明确 `geometryEvidence=material-only-not-final-module`。
不合格原字节仍保存并终止该尝试，不自动重投或静默清除背景。

技术通过、尚待视觉审阅的材料可以生成**预览**。构建不会自动接受原图或派生图。
生成源的准确视觉决定仍用 `reviewResult`；即使接受源，派生包也继续显式标记
`visualAcceptance=not-assessed`。本版未实现派生图的正式接受/发布合同。

预览目录共 28 文件：

- `source/original.png`：准确原字节；派生 PNG 与原始元数据分开。
- `materials/`：body、cap 两个派生材料。
- `tiles/`：16 个四向边界试样。
- `proofs/`：三个布局与一个 512×928 总览；`masks/`：三个占格遮罩。
- `derivation.json`：原图/像素/PNG 摘要、裁取、完整 Profile、布局与接口 QA。
- `proof-bundle.json`：计划/请求/raw/技术记录与完整文件清单及派生摘要。

验证器从原尝试中的原字节与固定规则重新生成全部文件，并逐字节比较；它不只相信
包内自述的 SHA。改图后重填所有包内摘要仍失败。拒绝多余内容、链接、工作区内输出
和覆盖已有目录。构建/重放不追加尝试事件，不修改源 QA 或决定。
本地证据不是密码签名的身份认证；可信人工/宿主继续负责转达真实决定。

## 同源零生成修订 v2

0.6.1 新增固定 `ai_scene_terrain_proof_profile_v2`，权威数据为
[`TERRAIN_PROOF_V2`](../src/terrain-proof/revision.mjs)。它绑定 v1 Profile，另存修订包，
不重解释冻结计划或替换原包；来源仍是同一尝试中的完整原字节。

1. cap 排除画布最上方 `floor(H/16)` 行，底界仍为 `floor(H/8)`，再采样到 64×8。
   这是固定裁取改进；不保证任意材料图的草沿都位于该带内，仍须审阅。
2. 将 v1 body 正方形分成四个边长为 `floor(B/2)` 的方形，奇数多出的一行/列不采样。
   各采样到 64×64，相比 v1 保留更大的石块；四种取样全部写入派生记录。
3. 变体 0 经原对边处理得到共用边来源。四种 body 以到最近外边的距离 `d=0..3`，
   按 `d/4` 保留各自像素、`(4-d)/4` 混入共用边来源，整数半数向上取整；边像素
   完全一致，距离至少 4 的内部保持原取样。cap 继续共用。
4. 以 UTF-16 字符串 `x,y` 做 FNV-1a、fmix32 后模 4 选变体，坐标不变就不因地图
   扩建重新选图；完整算法见源码。四种取样仍可能出现格状重复或显眼混合带。
5. 每变体派生 16 类四向试样，共 64 张 PNG。相同三个布局按坐标选变体，并重做占格、
   共享接口和需人工检查的转折记录；仍未认证八邻域内凹角或完整 47 角色表现。

v2 目录共 79 文件：原图 1、cap/body 材料 5、试样 64、布局/总览 4、遮罩 3、
派生记录与包清单 2。`ai_scene_terrain_proof_bundle_v2` 绑定已验证的 v1 父包摘要。
构建和验证都先从原来源重验父包，再重新计算修订包；任一目录篡改都拒绝。
不追加授权、预留或尝试事件；`generationCalls=0`、`productionKit=false`、
`visualAcceptance=not-assessed`。源图的人工接受不会转成派生图的接受。

## 完整邻域与连续材质试样：0.7.0

两个新增生产者均要求材料源状态为 `accepted`，当前结构/画风有效；重验 v1、v2
父包后才输出新目录。它们不改原计划/尝试，不产生新的图像请求，采用独立试样索引，
不进入旧模块批次的独立 PNG 闭包，也不输出正式 kit 或替换 Studio 资源。

共同几何规则来自 [`TERRAIN_MODULE_STUDY`](../src/terrain-proof/modules.mjs)：

- 同一个 `sideview-solid-blob47-v1` 八邻域归一化、47 签名，64×64/1:1、单格占地。
- 顶/底轮廓按固定序列内缩 0—2 像素，侧边 0—1 像素；两个外露边交会处半径 4
  像素圆化，以 4×4 子像素面积产生连续 Alpha；Alpha=0 处 RGB=0。不外伸。
- 两个相邻方向占用、对应对角缺失时，在内凹角半径 8 像素内增加局部阴影。四个方向
  分别绘制，47 种在合成材料下均能区分；这只证明程序角色覆盖，不证明转角美术已接受。
- 轮廓是声明的视觉内缩，不是从材料图分割或恢复地形；逻辑实心占用和碰撞依据不变。
- 逐格检查 Alpha、透明 RGB 和逻辑位置；同装饰接口通道差为 0，每接口至少比较
  48/64 像素，不同装饰/阴影/Alpha 的转折位置单列，仍须人工审阅。

七张检查图包括原三布局、32×6 格长段、带空洞与内角的布局、悬浮平台，以及 47
角色逐项检查图。后者按 7×7 排列独立 3×3 邻域，案例间留一格，中心位置重新计算
签名；共 235 个实心格，完整覆盖 47 个目标。另输出原三类布局的总览。

**九取样试验** `sideview-derived-blob47-study-v1` 从原 body 的三乘三重叠位置取九个
半边长方形；草沿取九个水平半宽窗口，均为面积采样。取样均值做对边处理，
再以 2 像素混合带共享外边，内部保留取样；坐标哈希模 9 选择。重复来源可能得到
相同像素，报告记录实际不同 body/cap 数量，不伪造多样性。目录共 453 文件，其中
423 张为 47 角色乘九取样。真实查看仍有逐格石纹重置，这个试验保留供对照。

**连续取样版** [`TERRAIN_CONTINUITY_STUDY`](../src/terrain-proof/continuity.mjs) 从 v1
body 方形和 v2 草沿采样：body 为 253×253，cap 为 253×8；body 做 x/y、cap 只做 x
的 4 像素对边处理。四乘四个相位分别在 `phaseX*63,phaseY*63` 起点取 64×64 窗口，
草沿只按 phaseX 取 64×8。相邻窗口共用同一行/列原采样，回绕处由对边处理闭合；
每接口一列/行在显示中重复一次是声明的采样规则，不是原生精确模块生成。

世界格坐标采用正模 `phaseX=((x%4)+4)%4`、`phaseY=((y%4)+4)%4`，相位号为
`phaseY*4+phaseX`。负坐标、扩建和无关编辑不改变原格的相位；地形纹理绑定世界原点。
**相位不可任意互换**，消费方必须按坐标选择；现有随机变体选择器不能直接替代该规则。
由此石块可以跨格延续，但仍每四格重复一次，不承诺长图没有重复。固定世界尺度、
转折装饰和实际 GPU 采样仍须后续画布验收。

连续取样目录共 766 文件：原图 1、材料场 2、角色/相位 PNG 752、检查图/总览 8、
`topology.json` 与 `derivation.json` 2、包清单 1。752 是 47 角色乘 16 固定相位的
派生数量，不是独立生成数。索引列出每角色占地、锚点、16 个文件与必需相位规则；
两个生产者均标记 `productionKit=false`、`visualAcceptance=not-assessed`。
构建和验证从原材料及固定规则重算全部输出，未知文件、链接或字节篡改均拒绝。

## API 与离线演示

`ai-scene-kit-contracts/terrain-proof` 提供只读 v1/v2 Profile 和纯函数
`deriveTerrainProof` / `deriveTerrainProofRevision`。
另提供完整邻域/连续材质 Profile 与纯函数 `deriveTerrainModuleStudy` /
`deriveTerrainContinuityStudy`；真实来源仍须经以下工作区入口验证。
只有 `/generation` 的工作区 API 才绑定真实引用、原尝试与决定：

| API | 作用 |
| --- | --- |
| freezeTerrainMaterialPlan | 当前设计/准确参考与材料派生规则冻结 |
| readGenerationInput | 按计划图像索引读准确原字节，不选择任意路径 |
| buildTerrainProofBundle | 技术通过来源生成新预览目录，零模型调用 |
| verifyTerrainProofBundle | 原来源重新计算并逐文件检查，零模型调用 |
| reviseTerrainProofBundle | 验证 v1 父包后，以同一原图构建独立 v2 目录，零模型调用 |
| verifyTerrainProofRevision | 从原来源重算父包与修订包，零模型调用 |
| buildTerrainModuleStudy / verifyTerrainModuleStudy | 已接受来源的完整邻域九取样试验，零生成构建/重放 |
| buildTerrainContinuityStudy / verifyTerrainContinuityStudy | 已接受来源的连续材质场与固定相位，零生成构建/重放 |

从 Harness 目录执行；输出须未存在且父目录已存在：

```powershell
npm run terrain:demo -- --out ../../work/my-terrain-proof-demo
npm run workflow -- --help
```

演示只用合成材料/替身决定，实际图片工具调用 0，humanVisualReview=not-run。
真实准备使用 `terrain:prepare --root WORKFLOW --reference PLAN_SHA --capabilities CAP_SHA
--id PLAN_ID --out NEW_DIRECTORY`，只冻结一个材料计划，输出完整提示、Profile、
准确参考图副本和几何示意，不授权或调用图像工具。

CLI 的 `revise-terrain-proof` / `verify-terrain-proof-revision` 均要求
`--root WORKFLOW --plan MATERIAL_PLAN_SHA --parent V1_DIRECTORY --out V2_DIRECTORY`。
构建时新目录必须未存在；验证时读取既有目录。均没有图片工具调用。

截至 0.6.1，材料派生及修订新增 28 项回归，核心/宿主合计 142 项通过、0 跳过。检查覆盖已知面积权重、
RGB 解码、奇数尺寸裁取、共享边/转折、Alpha、原图/清单篡改、链接、未知终态、
当前设计、四种共用边变体、旧包字节不变、父包/修订包篡改和 CLI。
测试使用合成 PNG，不使用真实生成图片或私有服务。

0.7.0 新增 12 项完整邻域、几何、透明 RGB、源多样性、连续场共享采样、负坐标相位、
接受门禁、父包/试样篡改与 CLI 回归；核心/宿主合计 154 项通过、0 跳过。
`build/verify-terrain-module-study`、`build/verify-terrain-continuity-study` 各对应独立 CLI
命令，均要求 `--root WORKFLOW --plan MATERIAL_PLAN_SHA --original V1_DIRECTORY
--parent V2_DIRECTORY --out STUDY_DIRECTORY`；build 的输出必须未存在。

0.8.0 增加经重放的地形试样画布外观快照，见 [Studio 接入](studio-v1.md) 和
[Pixi 按节点纹理入口](pixi-consumer-v1.md)。快照载入继续要求源接受并重验全部派生，
不追加生成事件；视图预览不会提升派生图视觉状态或改写基础 kit 的编译/导出身份。

0.9.0 的预览句柄 v2 从同一包额外快照 body/cap 材质场，供 [曲线网格](curves-v1.md)
使用。冻结派生 Profile、752 张格子图和原 766 文件包均不改变；曲线预览仍未获美术接受。

## 0.12.0：长材质场离线对照

[`TERRAIN_LONG_FIELD_STUDY`](../src/terrain-proof/long-field.mjs) 是另一个固定实验，
不改上述四格 Profile、旧包、Studio 句柄、地图、编译或导出。它只输出连续材质场和
平直长段对照，没有新增独立生成图、47 角色 PNG 或正式 kit，也没有接入现有画布。

body 取原图全宽、从原 v1 body 的顶部到图底；高度仍面积采样至 253，宽为
`floor(sourceWidth*253/bodyCropHeight)`。因此保持原 body 的纵向石块尺度，横向只有
取整误差，不把原 253 方形拉宽。草沿取 v2 已去顶边的全宽条带，与 body 使用相同
水平比例、高度采样至 8。裁区是固定规则，不是自动分割或新内容恢复。

两张取样池各取五个 253 宽窗口，起点为可移动范围的 `[0,3,1,4,2]/4` 向下取整。
相邻窗口重叠 64，逐像素 RGB L1 差作为代价，自顶向下求每行最多移动一列的最小
累计路径。并列取最左前驱与终点；接缝及其左侧保留已有像素，右侧取新窗口，不旋转、
镜像、拉伸或大范围混色。body 与 cap 各自求缝。五片结果宽 `253+4*(253-64)=1009`。
最后只以原 `periodize` 的四像素带闭合 body 的 x/y 和 cap 的 x。

新 body 为 1009×253，cap 为 1009×8。对照沿用每 64 显示像素跨 63 原采样的规则，
横向 16 格、纵向 4 格；负世界坐标正模选相位，接边共享一列/行，坐标扩建不改相位。
**同源石块会反复出现，最小色差接缝也可能截断石块；不是无限不重复或美术通过。**

新目录共 12 文件：原 PNG、body/cap 取样池与新场各两张、旧场两张、两张 32×4 格
平直对照及“上旧下新”总览、`derivation.json` 和 `proof-bundle.json`。报告记录所有
窗口起点、逐行缝位置/代价、像素与文件摘要，以及相差 4/8/16 格的 RGB 差总量、
相同像素数和比较分母；这只是准确像素周期证据，不是感知自然度评分。

工作区 API `buildTerrainLongFieldStudy` / `verifyTerrainLongFieldStudy` 参数依次为
`root, planSha256, originalRoot, revisionRoot, baselineRoot, outputRoot`。必须准确材料
接受且当前设计有效，从原来源重算并验证 v1、v2 和完整 766 文件四格基线后才构建；
新包绑定基线包摘要。构建要求新目录，验证重算全部 12 文件，拒绝未知文件与篡改。
两者不追加计算、生成尝试、技术接收或人工决定事件。

对应 CLI：

```powershell
npm run workflow -- build-terrain-long-field-study --root WORKFLOW --plan MATERIAL_PLAN_SHA --original V1_DIRECTORY --parent V2_DIRECTORY --baseline CONTINUOUS_DIRECTORY --out NEW_DIRECTORY
npm run workflow -- verify-terrain-long-field-study --root WORKFLOW --plan MATERIAL_PLAN_SHA --original V1_DIRECTORY --parent V2_DIRECTORY --baseline CONTINUOUS_DIRECTORY --out NEW_DIRECTORY
```

此新场的 16×4 个相位不能传给旧句柄的 4×4 相位接口；尚未提供 Pixi 映射、全角色
图块、曲线/混合地形截图或便携 kit。后续接入须另做明确版本和图块/曲线同尺度验证。
