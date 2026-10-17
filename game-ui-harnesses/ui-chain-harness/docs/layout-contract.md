# 组件排版合同（PanelDocument 0.3）

List可选`props.inventory`中，新建AI仓库显式使用`scrollMode:"fixed-cells-both-v1"`，支持columns/rows各1–32、总容量最多144、自然网格宽高最多4000逻辑像素，items.slotIndex唯一且在容量内。无该字段的旧文档保留各1–10、最多100格。新AI仓库消费上游原生意图，程序冻结实际方格cellSize、等距和左上逐行规则，不丢弃模型grid语义；新版本固定格子大小、横纵空间不足时独立滚动；旧无滚动版本字段仍宽度不足拒绝、高度不足内部滚动，皮肤最小尺寸/切片/文字约束仍执行。模型图标为null时格内显示名称，未知资产不替换例图；空初始格位以initialSlot保留。名称、数量和初始选择不回填默认样例。普通List、旧无新增字段库存、原文档和冻结计划保持原含义；已有副本重开/保存不重排。范围和维护见[仓库面板](inventory-panel.md)，历史12.136–12.138，当前12.139。

16 类组件共用尺寸策略；Container 负责子项排版。底层使用现有 Pixi Layout 的 Yoga，离线校验与浏览器调用同一份 `src/runtime/layout.mjs`。不对整个组件做缩放来模拟排版；实际尺寸经安全检查后传给原有控件 resize，文字、九宫格、点击区域同步更新。

## 维护入口

- `schemas/panel-document.schema.json`：允许的字段及数值范围。
- `src/runtime/layout.mjs`：共享布局计算、冲突与越界检查。
- `src/runtime/runtime.mjs`：将计算尺寸交给 16 类现有适配器，刷新滚动内容。
- `src/panel/settings.mjs` / `action-intent.mjs`：新面板采用规则的地方。
- `src/panel/size-edit.mjs`：生成后矩形候选、显式自由布局转换、实际几何和安全检查；Studio 入口见[生成后画布编辑](panel-size-editor.md)。
- 编辑器属性栏：Container 排版；所有节点的“尺寸与弹性（高级）”。默认不要求用户逐项调参。

`size.width/height` 是设计尺寸，不会被计算结果覆盖。运行时 `handle.size` 是实际尺寸，`handle.snapshot()` 保留设计尺寸和 sizing。改变设计尺寸调用 `handle.resize(w,h)`；父级会重新分配空间。隐藏子项通过 `setVisible(false)`，会退出排版；重新显示会重新加入。不要直接改 Pixi scale/width 或内部 handle.sizing 来编辑文档。

## Container.layout

| 字段 | 规则 |
| --- | --- |
| childrenMode | flow 自动排版；free 使用子项 position，禁止填充与弹性 |
| direction | column 纵向、row 横向、wrap 横向换行、grid 固定列网格 |
| gap / padding | 间距与统一内边距，默认 8 / 0 |
| align | 交叉轴 flex-start / center / flex-end / stretch |
| justify | 主轴 flex-start / center / flex-end / space-between / space-around / space-evenly |
| columns | grid 必填，1–16 列 |
| cellHeight | grid 必填，统一行高 |
| cellWidth | grid 可选；省略时均分可用宽度，最后一行仍保持列对齐 |

Grid 是统一格子尺寸，子项的最小/最大尺寸必须容得下格子；冲突会拒绝，不能把大控件挤进小格子。Grid 不接受子项的内容自适应或 grow/shrink。没有隐含的断点列数、合并单元格或瀑布流。

## 节点 sizing

| 字段 | 规则 |
| --- | --- |
| widthMode / heightMode | fixed（默认，使用 size）；fill（填充）；content（根据子项计算） |
| minWidth / minHeight | 最小尺寸，实际下限还包括组件安全尺寸，至少 24 |
| maxWidth / maxHeight | 最大尺寸；必须不小于有效下限 |
| grow | 分配额外空间的权重，默认 0；主轴 fill 默认 1 |
| shrink | 空间不足时按基准尺寸收缩，默认 0；不能突破最小尺寸 |
| alignSelf | 可选，覆盖父级交叉轴对齐 |

fill 仅适用于 flow Container 的直接子项。主轴按权重分配剩余空间，交叉轴占满可用空间；有明确宽高的 fixed 子项不会仅因为 align=stretch 自动改尺寸。需要拉满时显式用 fill。

content 当前只用于 flow Container，按子项、间距、内边距计算；支持纵向、横向、换行和网格的内容高度，不是 Text 的字体测量或任意组件的 ContentSizeFitter。换行需要确定宽度。内容宽度网格必须指定 cellWidth。父级 content 与同轴子项 fill/grow/shrink 的循环依赖会拒绝。Panel/Tabs/ScrollView 等内部内容槽仍由各自适配器管理，复杂内容先放 Container，不能把 fill 直接挂在这些槽根上。

## 示例

一行内左边固定标签，右边输入框占用剩余宽度（节点均省略无关字段）：

```json
{
  "row": {
    "size": {"width": 600, "height": 64},
    "layout": {"direction": "row", "padding": 10, "gap": 16, "align": "center"},
    "slots": {"children": ["label", "input"]}
  },
  "label": {"size": {"width": 160, "height": 32}},
  "input": {
    "size": {"width": 240, "height": 44},
    "sizing": {"widthMode": "fill", "minWidth": 120}
  }
}
```

三列网格，统一格子高度，容器高度随行数变化：

```json
{
  "size": {"width": 600, "height": 200},
  "sizing": {"heightMode": "content"},
  "layout": {"direction": "grid", "columns": 3, "cellHeight": 80, "gap": 12, "padding": 16}
}
```

## 兼容与边界

旧 0.1/0.2 文档仍按原固定布局运行；使用新字段需 0.3。编辑操作首次添加规则会升级版本，撤销可恢复旧版本。新增规则不改变动作、输入值、动效选择或皮肤素材。尺寸与布局编辑走现有候选校验、失败回滚、撤销/重做和 JSON 导入导出。

Studio 的生成后画布工作台可编辑现有节点宽高；free Container 的直接子项可编辑父级局部 X/Y。自由父级的可编辑节点提供八个边角尺寸柄，flow 子项只提供右、下和右下尺寸柄，不能拖动位置。属性栏显示共享求解器的实际矩形；显式修改 fill/content 轴会改为 fixed，主轴不再保留会覆盖输入尺寸的 grow/shrink。数值必须能成为实际矩形，否则拒绝，不能只写入运行时会忽略的设计尺寸。仍由 grid 管理的直接子项和锁定节点不提供独立宽高编辑。

flow→free 必须显式使用分组转换：用共享求解器当前矩形冻结组自身及直接子项，添加子项局部 position，固定相关宽高并移除 grow/shrink；直接子项移除自由父级不适用的 alignSelf。最小/最大约束、节点树、顺序、文案、行为和后代内部布局保留。grid 转换同时确定性移除 columns/cellWidth/cellHeight 并将 direction 设为 column，保留当前各格矩形；不是偷偷更换布局。画布根、空组及含隐藏或锁定直接子项的组拒绝转换。反向恢复使用撤销或恢复生成布局，不提供独立 free→flow 转换。

画布比例与原逻辑尺寸固定。外层 Panel/Dialog 可在画布中移动；尺寸拖动保留所拖边角的锚定位置，数字编辑仍居中的面板沿用居中策略，已移动的面板保留其位置。原先贴合的内容区同步更新，滚动视口、Tabs 页面继续遵守适配器安全区；独立控件不随整组缩放。位置与尺寸通过 `rectangleEditDocument` 合并成一个原子候选，避免一个合法的移位增宽操作在中间步骤误判越界。

拖动候选实时进行实际 Pixi 渲染，松开后单次发布并进入撤销历史；Esc、指针取消或窗口失焦取消。最新候选未通过文档、布局、PNG 几何、文字空间或浏览器渲染检查时，整个手势回退，不自动夹取最小尺寸。保存编辑副本与冻结交付包分离，整个文档的尺寸、位置与受控转换均参与摘要和差异白名单检查；`ui_panel_size_*` 标识及路由继续兼容。下载编辑 JSON 不代表已重新构建消费包；详细保存和重开语义见[画布编辑文档](panel-size-editor.md)。

生成后也可在属性栏编辑白名单显示文字：Text 正文、Panel/Dialog 标题、控件标签/提示，以及原有选项、页签、列表和操作项的 label。`src/panel/text-edit.mjs` 集中维护字段与纯文本规则，`size-edit.mjs` 统一产生和校验候选；文案变化即重新检查原字号下的文字容量、实际布局和内容安全区，浏览器追加真实字体检查。文字与尺寸分别应用，每次成功应用进入一步历史；失败不改画布或历史，并保留输入。集合 ID/顺序/数量、Input.value、选中初值、行为和皮肤均不可变，显式子行 List 需编辑实际子控件。保存副本后普通预览读取新文案，冻结原始包不变。

节点可选 `props.fontSize`（12–96 整数）和 `props.textColor`（`#RRGGBB`），支持具有自身文字的13类型；Container/ScrollView/Image、显式子行List及不显示数值的Slider/ProgressBar不提供无效编辑入口。未设置沿用皮肤，恢复默认删除字段。`runtime/text-style.mjs`集中派生字号、行高与内部行高度，文档最小尺寸、PNG安全区、Panel/Dialog标题与Tabs页内容槽、适配器和真实字体检查均使用同一度量；字号改变重新校验全部自身文字和保留空间。每节点独立文字皮肤不向子节点继承，不缩放九宫格或整体。颜色覆盖不改几何，运行时保护选项、切换状态及原生输入的显式色，仍保留皮肤自动配色默认路径。

## 参考图表面排版

PanelDocument 0.3 另有消费端展示字段；这些是确定性编译策略，不是模型私加的布局属性：

| 字段 | 规则 |
| --- | --- |
| `surfaceLayer` | frame 主框、content 原装饰内容板、inset 安全中心弱底板；仅支持的 Panel/Dialog/ScrollView/Tabs/List 可声明 |
| `surfaceScale` | 仅显式 frame 可用，默认 1；新预设 3.0、自定义 4.0、仓库 layout 1.4/1.5/1.6 固定为 3，并同步保留放大后的四边安全区 |
| `surfaceStyle` | Text 的 title/section，或已有 Panel 材质配方；不能与同节点 surfaceLayer 冲突 |
| `surfaceTextInsets` | 语义标题的显式安全留白，不能侵入冻结皮肤原安全区 |
| `surfaceBand` | `reference-v1` 仅用于 title/section Text，保留适用标题层的完整左右端纹饰、延展中间区域；tile 与显式定位装饰保留原合同 |
| `surfaceFontSize` | 节点级 8–96 整数字号，仅允许 reference-v1 标题；不改变旧组件 props 合同，用户显式 props.fontSize 优先 |

主框缩放不改皮肤密度或原 PNG，不放大 S05 平铺颗粒。新策略只保留一个装饰主框：单组普通公告、说明和表单的正文连续，真正的多分组、任务卡和独立数据使用弱 inset，纯排版容器透明。标题字号与内容安全区在预检、渲染和尺寸编辑中共用约束；失败回退仍为原子操作，不靠缩字或裁文案解决。

对应新转换写 `surfaceRecipesVersion:3`；旧标记 0/1/2（及更早缺失标记）与冻结配置保持各自行为，不向旧文档添加新字段，不重写原始交付或编辑副本。实际美术验收与离线布局检查分别判断。

新设置面板的控件行使用填充宽度，滚动内容使用内容高度；动作面板的按钮组均分剩余宽度。既有冻结作品和组件消费包不自动重写。重新打包的组件运行时包含本能力，本说明随消费包交付；旧消费包需走已有的离线运行时升级流程。仍不包含 Unity RectTransform 的完整锚点系统、Text 字体实际测量高度、自动断点和任意 16 类 AI 布局规划。

## 自定义规划桥接（2026-10-15）

`src/panel/custom-layout.mjs` 将上游 intent 0.12 的 column/row/grid/section 树转换到本合同，按配置生成 fill/content、padding/gap，继续调用同一 Yoga 求解器。row 等宽；旧 layout 1.0 的 grid 固定两列，2.0/3.0/当前 4.0 根据所选方向、内容下限及冻结卡片策略选择列数。模型可给面板 width/maxHeight，不能改 Studio 画布，也不能在原生意图私加 sizing、比例或 padding 字段。

`configs/custom-panel.json` 的 `preset.layout` 集中维护 groupGap、groupPadding、maxDepth、gridColumns、minColumnWidth；基础行间距沿用 geometry.gap。导入 PNG 皮肤的 panelInsets、scrollInsets、组件几何来自已验证包，转换后按实际求解尺寸执行运行时同源安全校验。缺少证据、九宫格尺寸不足、内容安全区冲突、超出画布或显式上限均失败。文字空间采用保守估计与运行时溢出检查，真实字体和真实皮肤仍需浏览器验收。具体能力、滚动按钮边界与拒绝项见 [自定义面板](custom-panel.md)。
