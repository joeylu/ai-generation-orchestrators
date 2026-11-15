# 固定平台外观与已接受来源的首屏组装

0.20.0 增加 kit v4/catalog v4/compiled v6。作者地图继续使用 v3；旧 kit v1—v3、
catalog v1—v3 与 compiled v1—v5 不改变原行为。这个版本将完整悬浮台图作为固定
格子矩形的外观，不把生成图的 Alpha 轮廓自动认证为碰撞形状。

## 附着规则

catalog v4 的 environment 模块可带封闭 terrainSkin：profile、columns、rows 和
surfacePx（left、right、y）。范围为 1—16 列、1—4 行，非循环、identity、无视觉
偏移；footprint 必须与格数一致。首套模块只实现三列一行，不提供任意宽度拉伸。

profile 固定为 alpha128-longest-row-first95-v1：对每行测量 Alpha≥128 的最长连续
区间，再找第一条长度达到全图最大区间 95% 的行。它只测摆放基线，不删像素、改
Alpha、裁剪或恢复轮廓。模块 anchor 必须等于这个区间左端与行号，运行时统一等比
缩放后区间宽度必须精确等于 columns×grid.width。载入时从准确 PNG 重新测量，
拒绝只改元数据并重算外层哈希的伪造。v4 的缩放有理数分子/分母上限扩到 4096，
数值仍限 1/8—4；旧 v3 的分子/分母范围不变。

地图实例锚点必须落在格点，所在非地形层必须单位视差。其矩形格子要完整、独立、
无重叠附着、不能属于混合地形。修改格子前先删外观或整个组合；不得悄悄丢失附着。
移到不存在矩形的地方、画入邻格、删除内部一格或接入混合地形都原子拒绝。

compiled v6 记录 terrainSkins、精确水平表面与被替代的格子。只省略这些格子的
普通地形 Sprite，以完整平台 Sprite 呈现；逻辑地形格子、邻接和原碰撞建议保留。
terrainPresentation 同时报告逻辑格子和实际绘制数量。矩形碰撞是建议，透明角部
与真实石底可能不一致，尚未验证物理、跳跃或从下方碰撞，不可称为 Alpha 精确碰撞。

## 编辑和交付

首屏增加 platform.vine.three 组合，含三格和一张附着外观。组合可整体放置、删除
及一次撤销；展开后可删外观恢复普通格子，再自由刷图或延长。Studio 通过模块的
首选图层为该组合选择单位视差层，普通旧组合的回退行为不变。仅隐藏图层是视图
状态，不删除作者格子或外观。保存、ZIP、重开和外部 Pixi 消费携带同一份数据。

buildSceneSupplementStudy / verifySceneSupplementStudy 读取已重放的首屏父试样、
四张已接受来源、各自接收/准备/审阅和派生证据，生成独立一屏候选。options 为
`{studyId,referenceStudy,sources}`，sources 为 foliage、distant-ruins、platform、water
各一份 `{planSha256}`。源美术必须已接受，旧五份来源决定保持原样。新增远桥、
水景和叶丛替代原借用外观；平台用上述固定附着，不覆盖原包或当前用户地图。

CLI 的 build/verify-scene-supplement-study 参数与 reference-study 相同。所有组装
都是零生图、完整重放、fresh 目录，候选保持 productionKit=false。源接受不等于
派生/整包视觉接受，单屏也不证明长地图背景覆盖或无限无缝连续。

合成回归覆盖基线测量无像素改变、三格外观/碰撞保留、组合放置/删除/展开/撤销、
错误编辑原子拒绝、旧格式关闭性、Pixi 显示、ZIP/目录重开及手机布局。测试不访问
提供商或生成媒体。
