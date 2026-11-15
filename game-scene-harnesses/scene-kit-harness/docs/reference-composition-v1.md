# 首屏参考对照与可携带视觉参数

0.18.0 将首屏构图作为独立离线试样。它读取已重放的四屏候选、准确环境来源和
已接受地形材料，重新派生、组装到新目录，不生成图片，不修改来源或作品决定。
先对照一屏的尺度、明暗、遮挡与材质，再决定是否扩成长地图。

## kit v3 与 compiled v5

kit v3 使用显式 appearance v2：64 单位格、1:1、47 角色，每角色 32 个相位，
数组顺序为 `(positiveMod(y,4)*8 + positiveMod(x,8))`。旧 kit v1/v2 及其编译结果
保持原行为；未知格式拒绝。新 compiled v5 携带材质与环境 renderStyle。

宏岩石派生绑定新的 reference-field profile：从原 body 区选中心 2/3 高度、2:1
矩形，按整数面积缩小到 505×253，草边用相同 x 区域和已有修订 cap 的 y/高度，
缩到 505×8；边界按既有四像素算法周期化。以 63 像素步长取 64 像素窗口，共
8×4 相位，派生 1504 张 Blob47 PNG，完整邻接与几何检查必须通过。
原材料和旧四格派生不变；它增加岩石块面尺度，将横向周期从 256 改为 512。
重复和人工边界仍需美术检查，不能称为无限无重复纹理。

曲线/混合地形保留原轮廓、连接、8 单位 cap 与碰撞建议，仅在 compiled v5 中
显式重映射材质 U 到 512 单位，body V 仍为 256。记录 materialMapping，格子和
曲线使用同一来源。appearance 可带 24 位 tint；两者渲染相同 tint，PNG 不改色。

catalog v3 允许 environment 模块显式携带 renderStyle：

- scale：正整数有理数，数值范围 1/8..4，统一缩放；
- tint：0..16777215 的 RGB 整数；opacity：0.05..1；
- preferredLayerId：可选编辑放置提示，优先使用当前图中同名非地形层，否则按原类别回退。

scale 同时作用于图像大小和像素锚点，逻辑实例锚点不移动；logical footprint 与
碰撞不由视觉缩放推导。原 PNG 不重采样或改 Alpha。compiled v5 写入准确位置、
大小、sourceToLogical 与样式，Pixi Sprite 按这些值呈现。旧 catalog 不接受新字段。
这些参数属于包数据，保存、ZIP、重开和外部消费不能丢失。

## 首屏组装

`buildSceneReferenceStudy(root,baseKit,options,terrainRoots,out)` / verify 逐字节重放
所有父来源与派生，options 为 `{studyId,reviewCandidate,layoutRevision?}`。布局版本：
reference-screen-v1（原首屏）、framed-v2（收窄前景并着色）、framed-v3（加高底部框景）。
没有布局版本时保留 v1。CLI 的参数形式与 build/verify-scene-review-candidate 相同，
命令分别为 build-scene-reference-study / verify-scene-reference-study。

首屏为 16×9 格、1024×576，含左侧台地、曲线下降段、低台、中央缺口、右侧台地
和悬浮台。远近遗迹、中景树、近景树和底部树冠分别成层，11 个视觉实例。
远处遗迹复用墙组；底部框景复用完整树冠在视口外的摆放，不冒充新叶丛源。
近景树读取准备来源的完整原生画布，派生只将 Alpha=0 处 RGB 置零；连续 Alpha
与所有可见 RGBA 保留，源文件不动。视口有意遮挡与源图真实截断是不同检查。

单屏布局不认证扩建后的背景覆盖。城堡/长桥、水域、专用前景叶丛及垂藤/平台底部
仍列缺项。sourceArtAcceptance、derived/fullKitVisualAcceptance 保持未接受，
productionKit=false；布局修复和技术通过不代签人工作品决定。

## 载入和验证

Studio 按源 SHA-256 复用纹理，最多八个请求并行。视觉变体共享纹理；需要平滑
缩放的来源用 linear，其余保留 nearest。失败终止未派发任务，不自动重试。
这修复了 1500 多模块一次并行 fetch 导致的资源拒绝，不增加 HTTP 或模型服务。

回归包含：32 相位/负坐标/边界、旧格式关闭性、样式和像素锚点、源 Alpha/可见
RGBA 保真、材质 U/V 与 tint、编辑/撤销、图层显隐改变实际画面、优先图层放置、
长地图名手机布局、浏览器 ZIP 下载与严格重开。测试只用合成素材与决定替身。
