# 组件排版合同（PanelDocument 0.3）

16 类组件共用尺寸策略；Container 负责子项排版。底层使用现有 Pixi Layout 的 Yoga，离线校验与浏览器调用同一份 `src/runtime/layout.mjs`。不对整个组件做缩放来模拟排版；实际尺寸经安全检查后传给原有控件 resize，文字、九宫格、点击区域同步更新。

## 维护入口

- `schemas/panel-document.schema.json`：允许的字段及数值范围。
- `src/runtime/layout.mjs`：共享布局计算、冲突与越界检查。
- `src/runtime/runtime.mjs`：将计算尺寸交给 16 类现有适配器，刷新滚动内容。
- `src/panel/settings.mjs` / `action-intent.mjs`：新面板采用规则的地方。
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

新设置面板的控件行使用填充宽度，滚动内容使用内容高度；动作面板的按钮组均分剩余宽度。既有冻结作品和组件消费包不自动重写。重新打包的组件运行时包含本能力，本说明随消费包交付；旧消费包需走已有的离线运行时升级流程。仍不包含 Unity RectTransform 的完整锚点系统、Text 自动测量高度、自动断点和任意 16 类 AI 布局规划。
