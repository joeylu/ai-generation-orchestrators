# 原像素表层水平闭环审阅

`source-pixel-horizontal-cap-cycle-v1` 是零生图的显式衍生工具，用于研究已验证的
不透明 cap 材质场。完整材质场可能同时包含普通浅覆盖、局部深覆盖和附着岩肩；
裁短全宽 cap 会截到其中的深覆盖，而直接重复浅覆盖窗口又可能产生整齐台阶。
本工具只研究选定窗口的原像素闭环，不自动寻找“雪”“草”或任何材质的语义边界。
调用者负责提供当前已验证材质及准确 source 指纹；本函数只检查 PNG 和衍生身份，
不重放生成 workflow QA，也不识别输入的实际职责。

它是显式审阅衍生，`productionKit:false`。可以独立研究，也可以通过下面的确定性
交付入口构建新候选；没有自动采用或新的 HTTP/CLI 入口。不要手改 `kit.json` 的
cap 引用冒充已验交付。原生周边、作者文档、来源身份和最终美术接受仍分别处理。

## 纯程序入口

包根导出 `buildTerrainSurfaceCycle`、`validateTerrainSurfaceCycle` 和 profile 常量。

```js
const {record, png} = buildTerrainSurfaceCycle(sourcePng, {
  source: checkedCapSource, // path + sha256 + byteLength
  outputPath: 'materials/cap-cycle.png',
  fromColumn: reviewedStartColumn,
  usableColumns: reviewedWindowWidth,
  overlapColumns: reviewedOverlap,
});
validateTerrainSurfaceCycle(record, {readAsset});
```

## 检查周期内部切线

包根还导出 `reviewTerrainSurfaceCycle(record, {readAsset, display})`，其中 `display`
必须显式提供当前显示的 `capEndRow`、`fadeRows` 和 `widthWorld`。它先独立重放记录
及准确 PNG，再报告每个有效行的水平内部切线、切线改列时的纵向分支接触，以及
实际子周期。调用者仍须先从当前已验证 kit 取得准确记录与显示参数；该函数不替代
workflow QA 或 kit 身份检查。

周期首尾可能正好来自相邻原生列，却在内部拼接了相距一个周期的两列。因此仅看
wrap 行差或闭合路径不够。报告同时列出原始 RGB-L1、按声明 fade 近似加权的值、
原源两侧相邻梯度，以及超过这些原梯度的差值和最显著位置。纵向分支也按实际
变列位置测量，不能只测一个水平切口。权重只按原生行中心作近似，不模拟场景遮挡、
上角覆盖、几何裁剪或真实像素 Alpha，不能当成最终显示误差。

该检查没有颜色/物质识别、自动选窗或统一通过阈值，返回
`technicalOrArtQualification:false`。较低接缝色差可能来自更厚、较单调的覆盖：
它能减轻长桥台阶，同时仍在狭窄的 shared-cap 区形成白柱。必须把内部色差、原生
覆盖深度、最短跨度/内伸预算、原生上角职责和实际四相位组合分别审阅，不能用一个
分数自动选窗。扫描某一主题时的亮度阈值、坐标或排序不得进入通用默认。

需要同倍率隔层时，Pixi 消费者现支持明确的
`ai_scene_terrain_render_diagnostic_frame_v1` 只读显示，与正常绘制共用网格、采样和
顺序。诊断仍没有 compiled content SHA，不能作为作者地图、kit 或导出交付。
这不增加 Studio HTTP 诊断/生成入口；本地受控检查可以把核验后的 PNG 装入内存页面，
在软件 WebGL 中比较同相机的整组、省略表层、仅表层和仅原生上角。

窗口位置和范围必须来自该来源的明确审阅。检查窗口是否保留了预期覆盖和边界，
标出主动省略的局部深覆盖；这是一项表层设计近似，不是补回隐藏几何或透明修复。
不复制其他主题的像素坐标、雪层厚度或周期。

## 像素与预算合同

- 输入只支持当前已验证的不透明材质场，宽 64..2048、高 32..2048，总像素不超过
  4,194,304。它不接收透明原生包边，也不修改失败的来源或 Alpha 技术门。
  当前闭环求解器还要求选中窗口具有像素变化，不处理完全常色窗口。
- 选定一段原生列范围；内部临时转置矩阵，复用既有闭合 overlap 算法，固定单相位，
  然后转回。最终每个输出像素都来自原图**同一行**的一个完整 RGBA，原照明方向、
  原行号和原生像素密度保留；没有纵向平移、旋转、缩放、模糊、混色或插值。
- 输出宽高与原 cap 相同。`periodColumns = usableColumns - overlapColumns`，至少
  32，必须整除原宽，最多重复 32 次。重复只作整数列平移，源 PNG 完整保留。
- 沿用闭环求解器的最多 256 列 overlap、最多 32 个起点、步长 2 和原 DP 工作预算。
  记录源 PNG/RGBA、窗口、全部闭合路径、逐像素原始索引 provenance 及输出摘要。
- 验证必须从原 PNG 重做衍生并核对实际输出；给修改后的记录重新 seal 不能代替
  重放。未知字段、危险相对路径、错源和不闭合的输出周期明确拒绝。

## 显示审阅

输出保持原尺寸时，源像素密度保持；实际子周期等于原显示宽度乘
`periodColumns / sourceWidth`。不要把完整输出画布宽度当成新细节周期，或重新
拉伸一个小窗口到整场景。原 cap 行、cap UV 深度和 body world UV 不由此改变；
覆盖 end/fade rows 仍要另行量测、绑定准确输出并审阅。

比较原 cap、仅变薄、直接窗口重复和闭环窗口，检查短平台、桥洞、凹角/窄槽和
完整横向周期。逐个检查所有网格相位；任意曲线位置需要额外检查。更短的周期可能
消除当前浅条却增加重复节奏，或让特定深覆盖丢失，不能只根据一个单格接受。
闭合路径及颜色行差不是视觉无缝的证明，技术 pass 不转移美术接受。
尤其要在实际显示倍率下检查跨行形体：同一行原像素、闭合路径和输出摘要都正确，
仍可能产生重复的直立亮边或整齐雪纹。缩小的 source-over 图会弱化这种节奏。
实际 Studio 放大图若仍有这些问题，保留为未采用候选；不要把来源窗口不适配误报
为新的渲染器故障，也不要仅凭闭合成功继续削窄周期来宣称接缝已解决。

## 显式候选交付

`buildTerrainEdgeDelivery` / `verifyTerrainEdgeDelivery` 可在新的输出目录接受
`controls.surfaceCycle: {fromColumn, usableColumns, overlapColumns}`。必须同时选择
已检查的 dense v6 union material 和 `surfaceInterface`。interface 的 end/fade 行仍
绑定**原 cap**，在原尺寸/行号不变的衍生中保留它们；实际渲染绑定由程序明确转到
独立重放后的输出 SHA，不能由调用者手改来源散列。原 appearance、原 cap PNG
及其量测身份保留，另存 `kit.terrainSurfaceCycle` 与 evidence。

加载/导入会重做衍生，拒绝错源、篡改后的 provenance 和输出。编译与 Studio
快照共同使用显式 v9 effective appearance：它记录 surfaceCycle SHA、准确输出和
原 body material format，继续保留已有 body 循环/原世界 UV。原 kit schema 中的
measured v6 appearance 不被假装改成另一份量测源。导出/重开再次验证相同记录，
旧 kit 缺少该字段时维持原编译语义。

若候选同时替换左右上角，可传 `upperReplacementBatchSha256`，主 `batchSha256`
必须是原齐套七项批次，替换批次必须恰有左右上角且声明 explicit-subset-replacement。
当前入口限定两批都具有 native-size、render-envelope 和 reference-defined-cover
合同；基础批次、完整参考、目标、材质计划/原 PNG、质量策略及以上 profile 均须
一致，所有实际来源必须由 workflow 重放为技术 pass。它是非执行的交付选择，
不往 workflow 写入新批次或授权。每项来源仍使用自己的原批次和准备父链核验；
左角的原失败 QA、准确 padding 接受、nativeFrame 与原 RGBA 不能丢失。
新 candidate 记录 upper-source-selection、两份批次和被替换的历史计划摘要，
独立 verify 必须重做完整选择及交付。调用本入口从不消耗或恢复旧授权。

需要修订单个侧壁或与上角组合多个不重叠子集时，使用独立的
[侧边子集选源](terrain-side-source-selection-v1.md) 程序 API；它保留上述旧成对入口，
没有把底缘子集或新计算授权自动并入。

交付的 productionKit/artAcceptance 边界仍未提升。必须另外检查完整组合、实际
Studio、曲线、重开与预算拒绝，再独立记录人类美术接受；上述 API 不声称任意
自然地形接合或所有来源已达到美术要求。
