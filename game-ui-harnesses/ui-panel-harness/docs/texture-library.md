# 纹理入库与统一重绘

这条链位于 `ui-panel-harness/`，按用户提供的 MUIP 源素材建立独立文件式资产库。
源目录只读；输出进入本 Harness 的新目录。原始像素、源文件路径关系和原始导入参数保留作追溯，
新的外观使用原创矢量配方绘制，再栅格化成 PNG。没有调用图像模型或新增 Web 服务。

## 当前入口

需要 Node >=22.18 和已经安装的 Sharp。CLI 默认解析 `sharp` 包；也可通过
`--sharp-module <已安装的 Sharp 模块目录>` 指定本机运行时。程序不会安装依赖或下载模型，
本机模块路径和源目录绝对路径不会写入交付。实际图形后端版本会写入交付证据。

```sh
node scripts/textures.mjs intake --source <原始Textures目录> --output output/source-library --sharp-module <Sharp模块目录>
node scripts/textures.mjs redraw --library output/source-library --output output/modern-mint-v1 --sharp-module <Sharp模块目录>
node scripts/textures.mjs curate --library output/modern-mint-v1 --output output/modern-mint-curated --sharp-module <Sharp模块目录>
node scripts/textures.mjs verify --library output/modern-mint-curated --sharp-module <Sharp模块目录>
node scripts/textures.mjs search --library output/modern-mint-curated --query 音量 --sharp-module <Sharp模块目录>
node scripts/textures.mjs search --library output/modern-mint-curated --query 圆角 --role shape --sharp-module <Sharp模块目录>
```

推荐先保存完整入库和重绘包，再用 `curate` 生成用于面板选材的精选库。每一步写入新目录，
档案全库不删除。精选库移出 4 张 Demo、17 张品牌图标和 18 张 UI Elements 控件示意图，
共 39 条记录；不把这些条目独占的 PNG/SVG 打包进精选库，共用文件仅在保留项需要时携带。
控件示意图只是一张图，不能代替带状态、输入和事件的真实 Slider、Switch 等组件。

精选库按使用角色保留 262 条记录：

| 角色 | 数量 | 检索方式 |
| --- | ---: | --- |
| `icon` | 116 | 默认常规候选，按需求语义检索 |
| `shape` | 133 | `--role shape`；形状、尺寸和线重变体 |
| `effect` | 6 | `--role effect`；阴影等视觉效果 |
| `layout-primitive` | 2 | `--role layout-primitive`；分隔线和纯色填充 |
| `animation-part` | 5 | `--role animation-part`；只供对应动画配方组装 |

`curate` 会按角色重新生成预览，避免常规图标与动画拆件、基础形状混在同一候选页。
精选索引 `texture-catalog.json` 使用 `panel-core@0.1` 筛选规则，每条保留项记录 `usage.role`
及原因，排除项另有记录；`derivedFrom` 绑定完整重绘包的 ID 与摘要。全来源索引仅作元数据追溯，
不会因此把被筛除的原图或重绘图重新带入包内。
这些数量是当前 MUIP 素材集的筛选结果定义，不表示自动完成美术或原生引擎验收。

intake 对 `.png` 进行实际解码，记录文件摘要、真实宽高、透明/半透明像素数量、可见内容边界。
读取 `.meta` 中明确的 GUID、单图模式、PPU、pivot 和九宫格边距；原导入器里的平台缩放、
纹理压缩、多个 Sprite 切片及 Prefab 引用不在此读取器的覆盖范围。
遇到坏 PNG、链接跳转、尺寸或文件数量越界会失败，不发布成功交付。
元信息缺失或原九宫格不满足几何检查会如实记录，并不改写源工程。

## 一套规则，多种尺寸

`modern-mint@0.1.0` 使用圆角几何、圆头描边和统一图标网格。图标与基础边框输出白色透明蒙版，
由引擎主题染色；阴影输出黑色渐变 Alpha，演示图采用深蓝、薄荷绿。
Filled 和未标注 Filled 的图标具有区分明确的视觉版本。动画拆分图标分别保留对应语义与共同坐标。

文件名中的尺寸属于源命名信息，**输出像素尺寸以实际源 PNG 为准**。例如原 Border 中
许多 `32px`、`128px` 文件实际均为 1024×1024，不能直接按名称缩小。
轮廓线重与尺寸变体由参数产生；不能把同一圆角的数十张变体误认为数十个独立组件。

新九宫格边距根据新图形单独校验；适用时保留原值，必要时重算，圆形等不适合拉伸的图形可明确
标为 unsliced。原始参数与新参数同时保留。新记录中的 PPU/pivot 优先使用原值，缺失时会明确
记录 100 PPU/中心 pivot 的设计缺省。这不是修改 Unity 原文件，也不保证现有 Prefab 无需调整。

## 文件与标识

| 内容 | 用途 |
| --- | --- |
| `texture-library.json` | 原始资产索引；相对源路径、稳定 ID、摘要、像素与导入参数、语义族；精选库中仅作追溯元数据 |
| `texture-redesign.json` | 完整重绘档案的旧→新映射、设计规则、SVG/PNG 引用、新导入参数和检查状态 |
| `texture-catalog.json` | 精选库入口；保留项及使用角色、排除原因、来源包摘要和预览引用 |
| `textures/<sha256>.png` | 按内容去重的图片；原库字节保留，新库是新绘制的像素 |
| `vectors/<sha256>.svg` | 新设计的可编辑矢量源 |
| `previews/` | 全库按索引、精选库按角色重新生成的联系表，用于人工查看 |
| `delivery.json` | 最后写入的完成记录和实际文件字节摘要 |

稳定 ID 由相对源路径生成，不把机器路径放进公共合同。不同源路径即使字节相同也保留各自记录，
仅共用物理文件。原始包、完整重绘包和精选包分开放置，不覆盖或删除旧包。
写入中断时可能留下不完整目录；只有最后的 COMPLETE 记录及 verify 通过才能作为完整本地交付。

verify 检查各附件实际字节、索引摘要、路径约束、分类、完整统计和 PNG 解码结果；对于重绘包，
还会重算新 SVG、重新栅格化并比较 PNG，以及核对旧→新映射和新导入参数。
精选库还会从全来源索引重新执行筛选规则，核对完整保留/排除集合、使用角色与附件清单，
重新生成按角色分组的预览，拒绝把排除项附带进交付清单或重新标为普通图标。
摘要用于一致性检查，不是数字签名。复验使用同一 Sharp/libvips 版本，以免后端升级改变栅格结果。

## 检索与当前边界

语义来自路径规则和显式中英文别名，如 speaker → 音量/扬声器。检索结果先合并 family，
再列出 Filled、Outline、线重和尺寸变体。无命中返回空，不用相似名称猜测业务行为。
精选库的普通检索默认只查 `icon`，非图标须通过 `--role` 指定用途；例如“锁定”不会默认返回
Lock Top/Bottom 动画拆件，“滑条”也不会从已移出的 UI Elements 示意图生成假控件。
角色筛选可与 `--category` 一起使用，条件同时满足才返回。完整档案库在不传 `--role` 时保留
原检索行为：Demo 默认不进入普通检索，明确指定 `--category demo` 时可检索。

这是文件式资产索引，不依赖数据库或向量服务。`semanticEvidence: path-rules` 和
`semanticReview: NOT_RUN` 明示当前没有执行视觉语义模型审查。
图标外观、动画拆件组合和演示图仍需要实际使用中的视觉检查；联系表不能证明全部样本美术验收。

**当前交付是 SVG/PNG 资源库和映射数据。** 还没有把纹理选择接进 PanelSpec 及现有 Pixi
组件外观合同，也未生成 Unity `.meta`、Prefab 或 unitypackage。Unity 多 Sprite/平台缩放和
已有组件引用的适配需要后续分别验证；本轮不改变现有面板编译或其他 Harness。
