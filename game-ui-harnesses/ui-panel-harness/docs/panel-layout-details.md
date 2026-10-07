# 同轮修改比例与内容布局

现有 modern-v3 面板可以一次提出多个独立的几何要求，例如：

> 改成9:16竖版，宽480，内边距24，标题区域高56，间距12，保留字号、当前输入和按钮行为。

比例决定实际面板底板；内边距、标题区域高度等决定内容排列。程序把它们放入同一事务，完整校验、编译和渲染成功后一次发布，计一轮。无法容纳内容、字段非法或重复写入时，原面板和轮次保持原样。字号不会随比例拉伸，当前试玩值和存活控件的事件、ID、绑定保持原样。

## 编辑合同

Studio 新建 EditContext 0.10，增加 `layoutDetailsPolicy: layout-details-v1` 和 `set-layout-details`。CodexEditDraft 仍为0.3，尺寸修改后的 Spec/Bundle 仍为0.14。现有0.1–0.9上下文按原版本和摘要验证，不追加入新能力。

```json
[
  {"op":"set-panel-ratio","ratio":{"width":9,"height":16},"width":480},
  {"op":"set-layout-details","details":{
    "padding":24,"gap":12,"labelWidth":null,"rowHeight":null,
    "titleHeight":56,"sectionTitleHeight":null,"overflow":null,"body":null
  }}
]
```

details 必填以上八个键。null 保留当前值，不代表恢复默认。范围、flow树、引用与溢出仍由现有规格和编译器校验。`body` 可重排已有分组的容器、调整容器间距，但不能新增分组或移动其中的行到其他分组。width、maxHeight、canvas、frame 不能放进 details；尺寸使用已有比例或固定宽高操作。

这两项操作可以交换顺序，结果相同。多个 details 操作的非空属性必须互不重叠，通常合并为一项；重复写同一属性不会按“最后一条优先”覆盖。旧 set-layout 仍整块替换布局，不能与尺寸操作或非空 details 同轮混写。模型须先理解自我纠正，输出每项属性唯一的最终值。

也支持 frame:null 与 details 同轮，取消固定高度并重新测量内容。只改 details 不升级规格版本或扩大画布。需要扩大实际面板时应明确提出尺寸修改。

公开 API 使用第五个参数 `{layoutDetails:true}`，同时提供比例能力；省略参数保持旧上下文行为。选择了单控件时新全局操作不可用，先取消选择。新增操作须引用当前请求，不接受设计默认作为来源。

## 验证及边界

`tests/layout-details.test.mjs` 覆盖属性实际值、精确比例、操作换序、空操作、重复写入、非法值、flow重排、旧上下文、原生输出schema、诊断脱敏、当前输入/提交、一次计数、十轮上限、撤销和导出重导入。CLI使用内存替身；不启动真实模型。

`examples/layout-details-v1/fixture.mjs` 提供竖版和横版连续组合修改。浏览器、独立交付包及回归证据保存在本地 `output/layout-details-accepted-v1/`。程序方案通过不等于自然语言命中率通过；本轮真实模型和Unity Editor原生导入未运行。

本项没有实现请求逐项语义核验、条件联动、按属性恢复历史或任意响应式断点。它保证合法方案中的独立布局修改一起应用，不保证模型没有漏解原文。
