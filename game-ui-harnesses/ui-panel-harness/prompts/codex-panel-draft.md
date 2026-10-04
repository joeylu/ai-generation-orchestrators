# Codex 规划传输格式 0.1

此文件只定义可选 Codex 接口的返回格式。需求理解、选材、原文依据和未决问题仍遵循
panel-planner.md；公共 PanelProposal、文件导入和编辑协议不变。
本次生成返回 CodexPanelDraft，不手写 PanelProposal 的 decisions 或 target。

外层仍只有 `proposalJson`，其值是包含下列完整对象的 JSON 字符串：

```json
{
  "codexPanelDraftVersion": "0.1",
  "contextSha256": "复制 context.sha256",
  "spec": "完整 PanelSpec 对象，或 null",
  "bases": "下述依据对象，或 null",
  "unresolved": []
}
```

`spec` 保持原有字段及 agent-authored 来源；不要在 Spec 中加依据字段。
非空 Spec 的 `bases` 恰好包含：

- `panel`、`theme`、`canvas`、`layout`：各一份原协议的 basis 对象。
- `sections`：严格与 `spec.sections` 等长、同序。每项恰好为 `{section, rows}`：
  `section` 是分组的 basis；`rows` 是与该分组 rows 等长、同序的 basis 数组。
  按钮的 reset-initial/emit 动作及字段清单由该按钮行的依据解释，不另外写动作目标。
- `state`：与 `spec.state` 等长、同序的 basis 数组。所有控件行与状态都需要
  request-interpretation，不用 design-choice 补上必要业务语义。
- `assets`：Spec 无资源或 `assets:null` 时为 null。有资源时恰好为
  `{overall, surface, rowIcons}`：overall 解释整体资源选择；surface 解释所选面板底图，
  没选底图时为 null；rowIcons 与 `spec.assets.rowIcons` 等长、同序。context 0.1
  仅使用 overall，surface 为 null、rowIcons 为 []，保持旧协议能力。

basis 只能是 `{kind:"request-interpretation",start,end,quote}` 或
`{kind:"design-choice",reason}`，原文 UTF-16 规则不变。多个不同对象可引用同一段完整
需求，但每个对象只能有一份依据；不可把两个对象的依据合并成一项，不加 target、ID、
recipe、动作、属性、容器或 provenance 的额外依据项。

例如一个分组里按顺序声明音量、静音、重置三个控件，state 按顺序声明音量和静音：
`bases.sections` 有一项，其中 `rows` 恰好有三项；`bases.state` 恰好有两项。
重置按钮没有独立状态，不能再为它添加第三项 state。布局树的容器 ID 没有单独依据，
由 layout 的依据解释。程序从实际 Spec 自动生成 section/row/state 的目标名，
再运行全部公共提案校验；缺失、额外或错误的依据都会拒绝，不会自动补齐或删掉。

必须询问用户时，可以返回 `spec:null,bases:null` 和非空 unresolved。若 Spec 非空但仍有
问题，也可以提交完整 bases 与 unresolved，程序只显示问题，不编译为可用面板。
不要返回 proposalVersion、decisions、target、成功状态、回执、摘要计算或批准。
