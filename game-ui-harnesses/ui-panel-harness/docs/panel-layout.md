# 面板布局 v1

PanelSpec 0.4 在稳定的 `sections`、`rows` 和 `state` 上增加容器布局与正文纵向滚动，
用于设置面板、暂停菜单和只读角色信息。确定性编译器计算坐标和视口，Pixi 负责显示与交互。
PanelSpec 和 PanelBundle 0.1–0.3 继续使用原合同，不自动升级或改写。

## 合同与规划入口

[PanelSpec 0.4 schema](../schemas/panel-spec-v0.4.schema.json) 定义完整字段，
[运行时校验器](../src/spec.mjs) 负责交叉引用、唯一 ID 和其他字段关系。
目录使用 [modern-mint-layout.catalog.json](../examples/modern-mint-layout.catalog.json)，
增加精确版本的 `settings.text` / `text-row` recipe，保留原有主题及交互控件。

包含 `text-row` 的目录使 `createPlanningContext` 生成 context 0.4，能力包括
`layout:"flow-containers-v1"` 和 Text 行。对应提案使用 proposal 0.4；布局尺寸可有明确设计理由，
Text 的业务内容及交互行、状态仍需请求原文依据。未决问题照常阻止编译。
旧目录生成的 context 0.1–0.3 保持原摘要与能力。

新输出是 `panelBundleVersion:"0.4"`、`compilerVersion:"0.4.1"` 的 PanelBundle，包含完整
Spec、目录、当前业务状态、绑定、动作和现有 Component Bundle；没有另造 Component Schema。
打开或校验 Bundle 会重新编译内嵌输入并比对结果。编译通过不代表语义正确、视觉验收通过，
也不能替代原生引擎验证。[Unity UGUI 适配器](unity-export.md) 的导出与验收单独记录。

## 容器树

`layout` 保留原来的八个标量字段，并增加 `maxHeight`、`overflow`、`body`。正文树的叶节点
引用已有 section；每个 section 必须恰好出现一次。容器 ID 在独立命名空间内唯一，
树最多 96 个节点、8 层，根节点计为第一层。

```json
{
  "id": "settings-grid",
  "kind": "grid",
  "width": "fill",
  "gap": 20,
  "align": "start",
  "minColumnWidth": 340,
  "children": [
    { "kind": "section", "sectionId": "audio", "width": "fill" },
    { "kind": "section", "sectionId": "general", "width": "fill" }
  ]
}
```

`width` 为 `"fill"` 或正整数像素。`fill` 使用父容器分配的可用宽度；明确数值超过槽位时
拒绝编译，不暗中压缩该节点。横排与网格会先分配等宽槽位，固定宽度子节点不会把剩余宽度
重新分给其他子节点。最外层面板的有效宽度是 `min(layout.width, canvas.width)`；
这项规则不取消子节点宽度、recipe 最小尺寸、文字和控件空间的校验。

| 容器 | 排列 | `align` 的作用 |
| --- | --- | --- |
| `column` | 按顺序纵排，以 `gap` 分隔 | 在可用宽度内左、中、右对齐子节点 |
| `row` | 所有子节点横排，按子节点数量分等宽槽位 | 在该横行高度内顶、中、底对齐 |
| `grid` | 最多两列，逐行排列 | 槽位内水平对齐，同时在每行高度内垂直对齐 |

网格只有当 `2 * minColumnWidth + gap <= 容器宽度` 时使用两列，否则使用单列。
列数由编译时的逻辑画布和可用正文宽度确定。窄画布示例是单独编译的 Spec；
浏览器窗口 resize、宿主画布缩放或页面滚动不会重新排版，也不会改变 Spec。

section 自身仍由标题及纵向设置行组成，行高由 `rowHeight` 决定，行间距由 `gap` 决定。
新容器树的 section 间距由容器 `gap` 控制；保留的 `sectionGap` 不覆盖正文树的间距。
当前不支持任意行级容器、绝对定位、跨格、独立嵌套滚动区或自动文字换行。

## 高度、滚动与下拉菜单

[measureFlowLayout](../src/flow-layout.mjs) 先测量正文自然高度。`maxHeight` 限制整个面板高度，
标题、标题后的间距和上下 padding 都占用其中空间。`overflow:"error"` 在内容超出可用高度时
拒绝编译；`overflow:"scroll"` 在确实放不下时创建正文 ScrollView，标题保持固定。
放得下的内容使用普通 Container，不强行撑到高度上限。

滚动正文会预留 16 个逻辑像素的视觉留白，并按缩小后的可用宽度重新测量，所以临界宽度的
两列网格可能转为单列。当前没有可拖拽的滚动条；这 16px 是留白，不是滚动条轨道。

滚动面板含 Select 时，还会在逻辑画布中预留最长下拉菜单所需的高度：
`40 * 最大选项数 + 2`。有效面板高度同时受 `maxHeight` 与 `canvas.height - 菜单预留高度`
限制；正文至少需要容纳一整行，否则拒绝编译。非滚动面板则逐个检查下拉菜单能否完整
向下展开。下拉菜单不会自动向上翻转，增加选项数可能需要同步增大画布或调整面板高度。

浏览器预览中的滚轮及正文空白处拖动可以纵向滚动，拖动控件仍执行其原有控件操作。
ScrollView 获得键盘焦点后可用 Home/End 到达首尾，Tab 到达正文内控件时自动滚入整行。
[attachLayoutSession](../src/layout-session.mjs) 还会在 Select 打开时显示完整控件行，
用户滚动正文时关闭已打开的菜单。滚动位置是浏览器会话状态，不作为业务 `state` 导出；
导出保存滑条、开关和下拉框等当前业务值。

静态预览已经接入面板动作与布局会话。自行集成时需要使用 PanelBundle 的 Spec 并挂载
`attachPanelSession` 与 `attachLayoutSession`，销毁预览时同步销毁会话订阅；
只打开 Component Bundle 不会自动补上面板重置动作和键盘聚焦滚入行为。

## 只读文字与无状态菜单

Text 行完整形状如下，不含 `enabled`、`bind`、`event` 或动作：

```json
{
  "id": "level-row",
  "kind": "text",
  "recipe": { "id": "settings.text", "version": "0.1.0" },
  "label": "等级",
  "text": "Lv. 24"
}
```

Text 用于 Spec 内明确的只读单行内容；它不创建状态、不进入控件交互，也不提供实时宿主
数据绑定、输入框或富文本。内容放不下时应调整尺寸或内容，不能依赖静默截断。

只有文字与 emit 按钮的面板允许 `state:[]`，运行时业务快照为 `{}`。0.4 Button 可以
使用 `label:""`，让按钮占据该行可用内容宽度；按钮文字仍是 `buttonLabel`。
0.4.1 将这种独立按钮直接输出到分组，省去带浅色底板的行 Container；控件 ID、绝对位置、
点击范围和动作保持。可选图标同样直接位于分组。带标签的按钮及其他控件保留行底板。
0.4.0 已导出的 Bundle 仍按其原编译版本严格复验，不换版本号掩盖不同输出；重新编译或
导出当前状态才使用 0.4.1。PanelSpec 与目录无需修改，不影响旧 0.1–0.3 编译器。
点击只发出声明的宿主事件，不自行暂停游戏、打开其他面板或执行存档。
`reset-initial` 继续只重置显式列出的字段，恢复 Spec 中的创作初值。

## 四个程序化样本

| 样本 | 文件 | 验证用途 |
| --- | --- | --- |
| 设置面板 | [settings.panel.json](../examples/layout-v1/settings.panel.json) | 双列、正文滚动、独立控件与有界重置 |
| 暂停菜单 | [pause.panel.json](../examples/layout-v1/pause.panel.json) | 居中定宽 column、全宽按钮、空 state |
| 角色信息 | [character.panel.json](../examples/layout-v1/character.panel.json) | row 横排、只读 Text 与空 state |
| 窄画布设置 | [settings-compact.panel.json](../examples/layout-v1/settings-compact.panel.json) | 400px 逻辑画布、grid 单列、滚动与 Select 展开 |

以下 PowerShell 命令从 `ui-panel-harness` 目录执行。所有输出路径必须是新目录；
再次运行时更换后缀，保留已有结果。

先用确定性脚本生成四组 context/proposal/report。该脚本不会调用模型：

```powershell
node scripts/write-layout-fixtures.mjs --output output/layout-guide-fixtures-v1
```

逐个检查、构建和制作静态预览：

```powershell
foreach ($sampleName in @('settings', 'pause', 'character', 'settings-compact')) {
  node scripts/cli.mjs check-plan "output/layout-guide-fixtures-v1/$sampleName.context.json" --proposal "output/layout-guide-fixtures-v1/$sampleName.proposal.json"
  if ($LASTEXITCODE -ne 0) { throw "Check failed: $sampleName" }
  node scripts/cli.mjs build-plan "output/layout-guide-fixtures-v1/$sampleName.context.json" --proposal "output/layout-guide-fixtures-v1/$sampleName.proposal.json" --output "output/layout-guide-$sampleName-v1"
  if ($LASTEXITCODE -ne 0) { throw "Build failed: $sampleName" }
  node scripts/build-preview.mjs --bundle "output/layout-guide-$sampleName-v1/panel.bundle.json" --output "output/layout-guide-$sampleName-preview-v1"
  if ($LASTEXITCODE -ne 0) { throw "Preview build failed: $sampleName" }
}
```

打开对应 `output/layout-guide-<样本名>-preview-v1/index.html` 即可试玩。若只需要从现有
Spec 直接编译，可跳过规划文件，例如：

```powershell
node scripts/cli.mjs compile examples/layout-v1/settings.panel.json --catalog examples/modern-mint-layout.catalog.json --output output/layout-guide-direct-v1
node scripts/build-preview.mjs --bundle output/layout-guide-direct-v1/panel.bundle.json --output output/layout-guide-direct-preview-v1
```

这些样本明确标为 `programmatic-fixture`。它们验证合同、编译、布局和交互，不是自然语言
模型生成记录，也不能据此推断模型准确率。结构化报告的 `semanticReview`、构建报告的
浏览器与视觉审查字段仍保持各自真实状态。

## 局部修改

现有 PanelPatch 操作继续适用。`set-layout` 提交完整 layout 对象，包括 0.4 的正文树、
高度上限与溢出策略；未要求修改的字段保留。section 和 row 的稳定 ID 继续绑定原控件，
正文树必须覆盖现有全部 section，不能隐式增删 section 或业务行为。

自然语言编辑方案仍绑定本次请求、源 Spec 和目录摘要，先校验整批补丁并成功渲染后提交。
应用时保留仍存在字段的当前试玩值，新字段使用创作初值，撤销整批恢复原面板及对应试玩值。
改变布局或滚动不会把业务状态变成默认值。

Text 的 `add-row` 使用 `state:null`，`set-row-label` 可改其标签，`set-row-enabled` 不适用。
现有 Text 的 `text` 内容没有独立补丁操作，不能以删除重建绕过此限制。旧版 Spec 不能通过
`set-layout` 偷换成 0.4；需要新版功能时应生成并校验一份完整的新 Spec。
