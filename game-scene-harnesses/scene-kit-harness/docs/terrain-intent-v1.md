# 地形轮廓意图与画刷交付 v1

参考图的材质与轮廓是两项独立判断。工程板材可以是直边、折面或设计曲线；
自然岸地也可能有平直的顶面。不能根据“金属”“岩石”等关键词选择轮廓，
也不能把旧 blob47 模板的固定起伏当作所有样本的默认美术。

## 新计划的输入

本页保留 v1 轮廓合同；新 CLI 项目已使用[完整性 v2](terrain-completion-v2.md)。
既有 `explicit-terrain-intent-required-v1` 策略要求每个 ground 的 `sourceScopes`
覆盖必须携带 `terrainIntent`；缺失会在写入新项目之前停止。程序调用
`initCoherentPipeline` 时通过同名 `terrainIntentPolicy` 选项启用策略。
旧 API 调用和已有项目未记录该策略时保持原有契约，不重写已冻结计划。

```json
{
  "subjectId": "ground",
  "parentRole": "main",
  "content": "Continuous surface and body material for the observed terrain.",
  "exclusions": ["Complete platform silhouette", "Independent scenery"],
  "terrainIntent": {
    "profile": "reference-terrain-intent-v1",
    "contour": "rigid-manufactured",
    "notes": "Observed straight constructed ledge; joints are paint, not contour displacement."
  }
}
```

`contour` 有三个值：

- `rigid-manufactured`：硬质设计轮廓，不允许程序增加随机起伏。
- `irregular-natural`：参考允许自然细微起伏，后续明确其范围。
- `authored`：保留作者给出的格子或曲线轮廓，不额外增加起伏；适用于平整自然面等情况。

先记录可见顶边、侧边、底边、转角和开口，区分轮廓起伏、接缝图案和材质明暗。
说明观察依据及看不见部分的推断，不要求逐像素复原。生成参考图之前的判断属于
设计意图，接受准确参考后必须复核；需要修改时使用新的来源职责与准确计划。
多个 ground 在当前链路共享一个材质源时必须有相同意图；不兼容的轮廓职责
不能悄悄合并。先解决资产/地形表示能力，再冻结来源。

该字段进入 material 来源计划、提示和摘要，不进入环境物件提示。来源修订可以
通过新计划修改意图，但不能删除它以恢复旧模板。来源 PNG 只供应连续材质；
编辑轮廓由确定性编译器负责。独立平台皮肤和原生完整周边素材仍遵守各自合同。

## 实际素材校准后的交付

测量原始素材与参考的表面位置、材质密度和完整 cap 窗口后，给 `surface-review`
增加 `--terrain-rendering JSON`，或在程序调用中传入 `terrainRendering`。
它也可由已校准的 `baseComposition` 原样带入：

```json
{
  "profile": "intent-bound-shared-terrain-v1",
  "terrainIntentSha256": "<digest(terrainIntent) 的 64 位十六进制值>",
  "outline": {
    "maximumInsetWorld": 0,
    "sampleStepWorld": 8,
    "wavelengthWorld": 64,
    "seed": 731
  },
  "capEndRow": 16,
  "fadeRows": 0
}
```

以上行数和自然起伏参数只是格式示例，不是美术默认值。必须从本次 cap 素材
测量表面覆盖结束行及淡出范围；完整 cap 采样窗口不等于表面覆盖厚度。
`rigid-manufactured` 和 `authored` 要求 `maximumInsetWorld: 0`；
`irregular-natural` 要求明确大于零且不超过 16 world units 的范围。
不需要额外起伏的自然轮廓应选择 `authored`。

意图或摘要不匹配、缺少渲染参数、选择冲突的轮廓、行数超出实际素材时停止。
不能默认派生旧的起伏格子来凑成可交付结果。该配置自动启用既有
`world-material-grid-curve-boundary-v2` 编译器，让新画的格子与作者曲线使用
同一套世界坐标材质及连接规则；不修改源 PNG 或作者碰撞几何。候选保留
`evidence/terrain-intent.json`，并参与原有确定性重放验证。

Studio 的画刷主缩略图和展开示例使用同一个编译器渲染连续面、阶梯、开口、
凹角，避免继续拿旧模板 PNG 代表新画刷。预览是隔离的临时文档，不进入历史。
历史 kit 无 shared-field 配置时仍显示原有预览。

## 验收边界

**轮廓约束不等于周边收口。** 本文的 shared-field 路径解决旧模板强加起伏与
材质坐标不一致；它本身没有原生左右侧壁、顶角或底部收边。`maximumInsetWorld: 0`
保证设计直边，不会自动生成装甲厚度、顶沿端头或倒角。不能把它的技术通过称为
完整工业/自然地形画刷完成。

拆分时另行登记顶面、左右暴露面、顶角、底面和底角由谁负责。若用户只要求
连续材质或有限范围的直边修订，可以明确交付该有限候选；若要任意涂画或会露出
底部，按[完整周边合同](terrain-bottom-edges-v1.md)规划四角、左右侧壁、底边
七个职责。缺项时先解决完整画刷计划，不能静默用裁切平面顶替，也不能借
shared-field 的能力绕过合同。已有顶面和主体材质可复用；自然与工业外形、
光照、接缝与尺度仍由实际参考决定。

原生周边与 shared-field 是不同渲染路径，不能只在 kit 上叠加两个配置就声称
兼容。完整边角候选应走既有原生并集地形交付与验证，保留原来的直边、世界材质
连续性和作者几何，并独立审查首尾端头、内凹角、窄柱、上下接触和悬空下缘。
真正相邻的实体需要消除内部收边，暴露的部分才显示端头和侧壁。

离线回归覆盖源计划传递、丢失判断时阻断、两类不同构图、派生交付重放、
新笔画、撤销重做以及真实渲染缩略图。直边跨多个格子不得出现旧模板波浪；
自然起伏必须在声明范围内，开口保持空，世界材质不能在每格重新位移。

这些约束消除的是确定性派生的错误默认值。生成 PNG 本身仍可能画错材质线条，
Agent 必须比较准确原图、原始素材、连续笔画和实际 Studio。若波浪已画在
PNG 内，不能靠抹平、裁切或放宽 QA 冒充通过；先诊断，再决定是否需要新计划。
技术通过不等于最终人类美术接受，也不授权任何额外生成。
