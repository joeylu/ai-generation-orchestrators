# 专属构图与硬/软约束合同（0.32.0）

通用的是规范、身份与检查程序；每个场景的内容、地形和构图来自本次明确设计。
上传图和手绘图仍只供风格。此版增加结构化构图规划、蓝图 v2、参考计划 v16 和
实际轮廓接受后的还原目标；v1 蓝图、v15 计划及旧字节保留原含义。

## 规划输入及能力边界

Agent 根据文字需求、玩法结构和风格要求整理 `ai_scene_composition_intent_v1`。
程序不根据关键词把“森林”映射到雪山模板，也不从上传风格图推断主体或布局。
CLI 本身不理解任意自然语言，不连接文本模型或视觉分析服务。

intent 封印以下字段：

- `designId/sceneDescription/viewport/seed`：明确内容、基准帧和确定性种子。
- `layers`：本场景实际需要的层及深度、视差，可缺省建筑、前景或平台等角色。
- `hardInstances`：玩法地形/平台等必须遵守的 polygon 与 anchor，和各自角色、内容。
- `artSubjects`：明确主体 ID、层、角色与内容；程序只选择允许摆放区域，不选最终轮廓。
- `protectedRegions/tolerances`：保护区域和硬结构容差，必须先审设计。
- `composition`：`mass` 为 airy/balanced/dense、同层最小间距以及形态语言
  `shapeLanguage`。这些是由 Agent 明确选择的美术结构要求，不是根据图片自动测得。

artSubject 的 `placement` 含 `side/vertical/widthPermille/heightPermille/topPermille`。
所有范围是闭区间 `{min,max}`，以基准帧尺寸的千分比表示。
side 支持 left/right/center/wide/auto/frame-left/frame-right；vertical 支持 free
或 frame-bottom，贴底时 topPermille 必须为 `{min:0,max:0}`，避免相互冲突。
主体还声明 `occupancyPermille`、`maxOutsidePermille` 和 `anchorBandPermille`。

`composeReferenceBlueprint` 使用有界、带种子的确定性搜索生成区域，检查同层间距
和保护区域的可用容量。不可满足时报告 `COMPOSITION_UNSATISFIABLE`，不移动既定
地形、不弱化约束。它没有为任意文本自行决定物件数量或关卡玩法；这仍由 Agent
整理出的 intent 提供。风格疏密可改变美术体量预算，硬结构保持不变。

## 蓝图 v2：生成前不冻结美术造型

`ai_scene_reference_blueprint_v2` 的每个 instance 分成两种闭合结构：

1. hard：原来的 `instanceId/layerId/role/content/polygon/anchor` 加
   `constraint:{mode:'hard'}`。按轮廓 IoU 和锚点误差检查。
2. art-region：只有 `instanceId/layerId/role/content/constraint`，没有预设
   polygon/anchor。constraint 含 region、anchorRegion、min/maxOccupancyPermille、
   maxOutsidePermille 和 shapeIntent。实际包络须落在允许范围、体量合理、锚点在
   允许区域内；不与矩形区域做轮廓 IoU，不把城堡或山体画成框的外形。

结构底图用实心填充表达 hard，用虚线表达 art-region。虚线框不是图中物件，不能
生成到最终画面。模型接收准确蓝图和文字，不声称具有硬控制能力。

软区域允许跨过保护区域，只要仍有空间容纳最小体量；实际图中的标注主体不得
违反保护区域。当前包络是单个简单多边形，不是精细 Alpha 或多连通遮罩；多主体
应分实例。背景与近景可重叠，实例数不等于图片数量或资产交付数量。

## 参考接受与还原目标

v16 计划绑定蓝图 v2、spec/style、底图与全部风格输入，仍需准确摘要单次计算授权。
技术接收沿用原生 PNG 保留和坐标映射；不自动识别形状或验收美术。

操作者看实际原图后，仍用 `ai_scene_reference_observation_v1` 为每个实例提供实际
包络与锚点。新 packet v2 分别给出 hard 绿线、art-region 黄线、实测红线，以及
硬结构误差、美术区域体量/越界/锚点、保护区域覆盖。人工必须确认标注对应真实图。

审阅前只输出状态 unaccepted 的 `reconstruction-candidate.json`。人工接受准确
packet 且全部指标通过后，程序新增不可覆盖的 review v2，并在其中生成
`ai_scene_reference_reconstruction_target_v1`。它绑定原 PNG、映射、观测、接受
packet 与用户决定摘要，记录的是**实际接受图的轮廓**，不复制生成前的软区域。
读取和导出必须从重放通过、当前且已接受的工作流取得，不能信任裸 JSON 的 status。

这仍是操作者的包络测量，不证明像素分割或恢复了遮挡后的形状。隐藏部分标为
not-recovered；精细 Alpha、遮挡估计和拆分回拼仍需后续实现。新目标不能交给旧
固定十一来源组装器冒充还原完成。

## 调用

包导出 `./composition` 提供 compose/build/verifyCompositionProposal；
`./standard-reference` 增加 initComposedReference/exportReconstructionTarget。

```sh
npm run reference:standard -- compose --intent INTENT --out NEW_DESIGN
npm run reference:standard -- verify-composition --intent INTENT --out NEW_DESIGN
npm run reference:standard -- init-composed --brief BRIEF --out NEW_PROJECT
```

BRIEF 严格包含 `projectId/intent/inputs/style`；后两项沿用 style-only PNG 与显式
风格设置。项目 v2 绑定 intent/proposal 摘要，并在 inspect/plan/run 时重算检查。
之后 design/plan/authorize/run/assess/review 沿用规范参考 CLI，自动选择 v16。
接受后可 `target --root PROJECT --out NEW_TARGET_DIRECTORY` 导出实际还原目标，
这个小包没有场景素材，不是资产交付包。

准备入口现在必须明确 `--brief` 或 `--example`，不再隐式套雪山结构：

```sh
npm run reference:standard:prepare -- --example forest-slope --out NEW_PROJECT
```

命名示例还有 snow-valley、desert-canyon；这些是明确选择的作者样例，不是所有
主题的模板库。旧固定雪山草案可显式 `--example snow-castle-v1` 复现。准备、规划、
检查与示例测试均不调用图片，不生成接受决定，也不授权计算。
