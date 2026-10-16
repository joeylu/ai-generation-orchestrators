# 标题底板与分层材质

当前接入保留 16 类基础组件。`title`、`section` 是 Text 节点的视觉配方，`panel` 为 Panel 背景叠层；它们不增加交互类型。新面板依据参考图的主框、主标题与分组层级编译，使用已绑定的皮肤与材质。历史文档不添加字段，历史模型结果按原转换标记和冻结配置重放。

## 当前参考图排版

新预设使用`presentation.version:3.0`，自定义使用`preset.layout.version:4.0`，AI仓库使用planning/capabilities 1.5与layout 1.6（专用正方形格子），历史1.4/1.5继续按冻结配置重放。对应转换标记为`surfaceRecipesVersion:3`，不改变上游规划协议或16类组件的交互合同。

- 主框采用 `surfaceLayer:frame`、`surfaceScale:3`。只把该节点的边角与安全留白放大，保留一个完整的主框；不修改皮肤密度、原始 PNG、S05 来源或其他控件的九宫格。安全留白按四边分别计算，例如原声明 14 的边在该主框至少保留 42。
- 单组普通公告、说明或表单使用连续正文，不再为结构包装另画一张装饰底板。明确的多个分组、任务卡和独立数据保留较弱的 `inset` 材质与分隔；纯排版和按钮组保持透明。库存格区与详情同样使用弱底板，金角只属于主框。
- 新标题节点声明 `surfaceBand:reference-v1`。适用的完整标题材质保留左右端纹饰的比例，仅延展中间区域；可核验的嵌套主框残留从运行时展示区排除，不能确定时保留完整源区域。显式偏移、尺寸、缩放的装饰层以及 `tile` 层继续按原配方绘制。派生展示不回写原材质、裁片或皮肤摘要。
- 标题的语义字号写在节点级 `surfaceFontSize`，只适用于带 `reference-v1` 的 `title/section` Text，不写入旧组件合同的 props。常见 16 像素正文皮肤采用主标题 28、分组标题 18，标题盒分别至少 64、42，并继续增加必要的实际安全区。用户明确编辑的 `props.fontSize` 优先；显式字色优先级不变，全文仍须通过真实字体与安全区检查。
- 当前新配置的主标题明确居中，左右安全区取两侧较大值，避免非对称装饰留白让文字偏离标题条中心。旧冻结配置继续读取其原始对齐，显式作者对齐不被重写；分区标题保持自己的层级与对齐。
- 同时声明新版主框与标题标记的文档，开关行按参考图采用左标签、右开关；尺寸调整后仍保持右侧对齐，原生状态和禁用行为不变。普通自动换行 Text 若末行只有中文闭标点，可在不增加行数、不越过原文本框的前提下缩小最多一字号的换行宽度，将前一汉字与标点一起换行；作者显式换行、标题、字号、原文与节点尺寸保持原样。旧文档不启用这两项展示策略。

S05 的面板底纹仍按原尺度平铺；主框角部放大不会放大平铺颗粒，也不会替换材质源图。此版本只约束消费端的排版层级，不能据此宣称六种风格或任意模型生成都已完成美术验收。

转换标记 0（含更早未写标记的结果）保留无表面配方行为，1 保留标题表面配方，2 保留上一版 frame/content/inset 分层，3 启用本节参考图排版。旧配置、原提示词、原任务、原交付和已保存副本均不自动升级或重写；重新生成需使用新计划。

## 皮肤合同

现有皮肤包可以省略全部新增字段。可选 `surfaceStyles` 以 `title`、`section`、`panel` 为键，每个配方声明：

- `baseRole`：已有皮肤角色。标题缺省用 `skin.surface.bar`；Panel 叠层保留已有底板。
- `baseMode`：缺省 `overlay`，保留基底并叠加细纹理。标题/分组使用完整底板图时声明 `replace`，仅绘制材质，不再露出旧底条；必须有材质层。Panel 继续采用 `overlay`。
- `insets`：文字安全留白，不能小于源皮肤声明；缺省采用源留白，标题至少左右 12、上下 4。
- `clipInsets`：材质裁剪范围。`overlay` 不能侵入源九宫格边框，缺省为源边框；`replace` 缺省为零，覆盖整个标题盒子。两种模式均保留文字安全留白。
- `radius`：内部裁剪圆角；当前支持矩形/圆角矩形，任意异形 alpha 遮罩不在本版合同内。
- `textColor`：可选明确字色。节点字号/字色覆盖仍优先；叠层后的对比度保留待视觉复核语义。
- `layers`：最多 12 层。每层有 `assetId` 和 `mode: tile|contain|cover`；可选 `scale`、`width/height`、`anchorX/Y`、`offsetX/Y`、`alpha`、`blendMode: normal|multiply|screen`。

细底纹使用 tile，面板变大只增加平铺面积；局部云纹/角花使用 contain 或 cover，保持图像比例，以锚点控制位置。纹理层只在内部裁剪，不接收交互事件；文字和内容控件不受这个背景遮罩裁剪。素材不承担文字、动作或试玩状态。

除基础部件外，可选 `materialAssets` 保存额外 PNG。每个素材保留绑定源 PNG、SHA-256、精确裁切坐标和裁片摘要。服务端核验源图重放；同一源图可供多个裁片共用。S05 如产生透明 RGB 规范化派生源，材质绑定派生源，冻结 raw 和原始摘要仍由输入与提取证据保留。PNG、路径、数量、尺寸和总资源上限继续验证；不按文件名推断身份，不补画或重新调用模型。旧运行时不保证读取新扩展包，应随新消费包一起交付。

## 新项目自动生成材质

Studio 新建组件项目默认勾选“生成标题与面板纹理”。一次批次包含 S01–S04 的4张组件图集和S05材质图集。模板修订3合计32个基础部件（含两态正方形格子）+3个材质，仍组装为16类组件；修订2历史包保持30个基础部件。取消勾选沿用四图流程。旧导入草稿未声明 `materialGeneration` 时继续使用四图；此字段为可选布尔值，随项目草稿导出并校验。

S05 的三个固定语义槽位由 `configs/material-template.json` 规定：`material.title-band` 为主标题底图，`material.section-band` 为分组标题底图，`material.panel-fill` 为面板平铺底纹。计划冻结材质模板和参考图摘要，生成提示沿用同一参考风格。槽位允许复杂纹理、分散装饰和连续 alpha，不将装饰拆成多个交互组件。

标题和分组标题先由槽位确定语义归属。仅当定位与关联得到唯一主体、无未解决归属冲突、全部提案裁切互不重叠时，程序才保留超出模板 `bodyRect` 的完整轮廓；跨预留槽位本身保留告警，不以槽边截掉底边或装饰。条件不足时不盲选外扩区域；精确落在模板主体内的输入继续采用原裁切。`material.panel-fill` 始终取固定 `bodyRect` 内部样本，避免把低 alpha 拖尾和透明带带入平铺。外扩依据记录在 `cropEvidence`，不是自动美术接受。

S05 原图若仅在 alpha=0 的不可见像素含非零 RGB，程序保留 raw 原字节及 SHA-256，另生成 `derived-*.png`，只把这些像素的 RGB 清零。所有可见 RGB 与所有 alpha 数值保持不变，不抠底、不删除淡边、不重采样。报告保存 `originalSource`、`derivedSource`、变更像素数及 `visibleRgbChanges: 0`、`alphaChanges: 0`；验证从 raw 重放规范化、裁切与摘要。无需规范化的原图不额外生成派生源。

图集全部收到后，本地流程核验 S05 来源与槽位，提取三份 PNG 并自动写入 `materialAssets` 和 `surfaceStyles`。标题、分组材质替换原底条；面板底纹在面板内部叠加平铺。扩展后的皮肤包、组件预览和导出包一起入项目库，后续面板继续复用。空槽、原图完全不透明、纵横比或源摘要不符等仍保留原图并停止；同纵横比的分辨率偏差、槽外残留和明显平铺接缝记录告警。raw 不变，派生源和轮廓裁切均有独立证据；告警候选不能视为外观已经接受。

新提取报告使用版本 `1.2`，沿用 `1.1` 的字色选择：标题与分组替换材质从实际裁片中央40%区域抽样，选择最低对比度较好的明/暗色，并记录来源、裁切、采样与对比度证据。明确配方字色仍保留；透明或复杂背景继续标记待复核，最终合成仍需视觉验收。面板裁片的对边平均差值大于24，或边缘alpha低于240时，改用一层整图覆盖；其余仍平铺，叠层透明度、混合与遮罩不变。裁片、原图和材质资源不因适配而改动。各报告版本的政策固定，修改政策必须新增版本；验证器按冻结版本回放，旧 `1.0`、`1.1` 保持原行为与报告字节，既有包不自动升级。

CLI 使用 `node scripts/skin-batch.mjs prepare --reference <本地PNG> --style <风格JSON> --out work/<目录> --materials` 准备五图计划；省略 `--materials` 仍准备四图。`verify --batch <批次目录> --sha256 <批次摘要>` 同时支持四图、五图，并核验冻结的 S05 模板。一次摘要确认覆盖每张图各一次调用，不自动重试；`prepare`、`verify` 与本地提取本身不调用模型。

程序接入和离线回归不代表真实材质生成已验收。实际生成仍需查看批次计划后由用户确认，按[验收指南](acceptance.md)核对实际结果；最终外观保持待验收。

## 已有皮肤增加本地材质

编写 `ui_skin_material_input` 输入，`sourceSkinSha256` 必须等于原包摘要：

```json
{
  "kind": "ui_skin_material_input",
  "version": "1.0",
  "sourceSkinSha256": "填写原包的64位摘要",
  "materials": [
    {"assetId":"material.paper","file":"paper.png","sha256":"填写原图的64位摘要","crop":[0,0,64,64]}
  ],
  "surfaceStyles": {
    "title": {"baseRole":"skin.surface.bar","layers":[{"assetId":"material.paper","mode":"tile","alpha":0.2}]}
  }
}
```

`file` 相对输入 JSON；源图必须为本地 PNG，裁片必须在原图以内。使用 `node scripts/skin-materials.mjs --package work/<原皮肤包> --config work/<输入>/materials.json` 生成独立候选。该程序保留原包字节和三合同绑定，生成新的皮肤摘要、资源和来源报告；模型调用为零。也可以在 `skin-import.json` / assembly 配置提供相同的 `materials`、`surfaceStyles`，由既有打包入口消费。

Studio 项目使用 `node scripts/studio-upgrade-components.mjs --project work/studio/projects/<UUID> --materials work/<输入>/materials.json`：只在项目空闲时执行；生成新消费包、通过组件浏览器检查后，程序写入可回退的选择记录。选择时再次验证扩展报告和原包资源完全一致，允许的变化仅为材质、视觉配方和皮肤修订号。既有任务、原包和面板交付均保留，新准备面板采用新皮肤。

## 面板与维护

PanelDocument 0.3 的 Text 节点可声明 `surfaceStyle: title|section`，Panel 可声明 `surfaceStyle: panel`。皮肤定义 panel 配方时，普通 Panel 自动叠加材质；明确自定义背景不隐式加层。闭包包含基底角色与所有材质引用，画布编辑和导出保留配方，只调整允许的文案、字号和几何。

`src/skins/surface-styles.mjs` 是共享合同与几何计算，`src/runtime/surface-view.mjs` 负责 Pixi 叠层，`src/panel/headings.mjs` 负责新面板的标题配方。额外素材可来自 S05 生成后的确定性提取，或明确的本地导入；新生图仍需新的计划与授权。

显式新展示节点可用 `surfaceLayer: frame|content|inset`，标题 Text 可用 `surfaceTextInsets` 保留纹饰空间。`surfaceScale` 仅允许显式 frame，未设置时为 1；当前新生成策略固定为 3。只有带新展示标记的节点启用运行时兼容补偿：核验 PNG 后从完全不透明的中央区域取得标题可用区，并按真实九宫格的固定边与拉伸中心映射，与原安全区取交集。预检、初次排字和缩放共用同一区域；全文放不下仍报溢出，不修改文案、字号、冻结留白或原图。材质替换标题继续遵守自身配方，不借用被替换底条的可见区。

旧皮肤缺少某个角色的 `textColors` 时，新层子树可从已核验像素按既有抽样策略选择运行时字色；原角色采样不足时，仅对派生字色加极细反色描边，纸面等已通过角色不加描边。节点明确字色、配方字色与已声明角色字色均优先；Select/Dialog 移入浮层后仍按逻辑归属决定作用范围。缓存不回写皮肤主题、配方、文档、原始素材或旧报告，原始 `needs-review` 保持原状态，描边合成效果仍需看实图。没有新增标记的历史面板保持原有行为。

显式 `content` / `inset` 层另外缓存排除九宫格边框后的实际内板区域墨色。若该区域样本充足且不含低alpha采样，原角色声明色在内板对比不足、候选明显更好时，仅该背景上的自动文字采用候选；节点明确字色与配方字色仍优先，嵌套按钮和输入框继续使用自身背景。无标记的角色、透明或不足样本保持原行为，不推断透明底下的颜色。采样在加载时完成，缩放与每帧更新复用缓存；来源采样证据和最终合成复核状态分别记录，不改皮肤主题或素材。

验证：`node --test tests/skin-material-generation.test.mjs tests/material-atlas.test.mjs tests/material-atlas-input.test.mjs tests/skin-batch-cli.test.mjs` 检查 S05 计划、来源与提取；`node --test tests/skin-materials.test.mjs tests/studio-component-upgrade.test.mjs` 检查已有包扩展；`node --test tests/runtime/surfaces.test.mjs tests/runtime/components.test.mjs` 检查消费。覆盖源图重放、旧包不变、扩展选择绑定、闭包、编辑、背景遮罩像素、平铺密度、装饰比例、字色覆盖、失败尺寸回退和销毁；均不调用模型。实际通过数量以本轮程序报告为准。

`node --test tests/runtime-text-fallback.test.mjs tests/runtime/derived-text-ink.test.mjs` 覆盖透明留白的九宫格映射、40px 标题完整排字边界、旧无标记行为、明确字色优先级、派生描边恢复与浮层逻辑归属；后者为离线浏览器检查。
