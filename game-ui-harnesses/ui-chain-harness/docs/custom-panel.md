# 自定义面板

面板生成台的“创建方式”新增“自定义面板”，与 ui-reference 五类八状态并列。选择后隐藏预设状态，需求必填；选择已完成组件项目后生成。切换创建方式保留已填写的需求，不自动替换成预设文案。

自定义使用 ui-panel-harness 的公开规划接口和既有 Codex CLI 运输。准备阶段零模型调用，冻结用户原文、皮肤版本、能力配置与独立提示；确认后沿用一次调用、原文/回执先保存、无自动重试的流程。没有 SDK 预设源或固定控件数量约束。

当前新计划默认使用 `preset.layout.version:4.0`，配合 `presentation.version:3.0` 与 `surfaceRecipesVersion:3` 还原参考图的主框和内容层级。旧冻结配置的 1.0、2.0、3.0 及其对应提示词继续逐版本重放，不自动改写原任务或已保存面板。

新计划同时冻结 `preset.formActions: {version:"1.0",defaultScope:"all-value-rows"}`。普通表单的提交、保存和重置默认覆盖整张表单的 input、checkbox、switch、slider、select 值行，跨分组保持一致；正文、进度和按钮不作为值字段。“提交全部”必须声明为本地 submit，不能因不接后端而改成不携带值的 emit。明确要求“提交昵称”“只保存昵称和语言”或每组独立动作时保留该范围。转换程序校验声明，不补写 targets、不改模型响应；不符时保留原始证据并停止转换。旧无此策略的配置仍按原声明核验，3.0 的原提示词字节保存在 `prompts/custom-panel-planner-v3.md`，新的策略选择当前提示词；布局版本和表单动作版本独立冻结。

- 新 4.0 保留一个 `surfaceLayer:frame` 主框，并以 `surfaceScale:3` 放大角部与对应安全区；单组普通公告、说明和表单使用连续正文，不为结构包装额外套板。有实际多分组、独立任务卡或只读数据时使用弱 `inset` 材质，纯 row/column/grid 与按钮组仍为透明 Container。用户明确请求的分组标题保留，模型添加的包装标题不必重复显示；源分组名、文字、动作目标及深度优先行 ID 保留在内容中。
- 新主标题与组标题用 `surfaceBand:reference-v1` 保留端部纹饰、延展中间区域。语义字号写在节点级 `surfaceFontSize`；常见 16 像素正文皮肤的主标题为 28、组标题为 18，盒高分别至少 64、42，再按安全区增加。用户显式 `props.fontSize` 编辑优先。原皮肤密度、S05 源图及平铺尺度不改。
- 分组／数据卡片内边距逐边取配置留白与已核验实际表面安全区的较大值；inset 使用安全中心材质，只有 frame 叠加已有 S05 面板纹理。标题通过显式 `surfaceTextInsets` 避开装饰，旧无字段文档不改。尺寸仍受九宫格、组件最小尺寸和原 Yoga 求解器约束。不同组件类型的等宽横排使用相同最小宽度基准，避免 Yoga 按不同组件下限分配出不等宽列。
- 4.0 未指定尺寸的单个动作按钮默认限宽居中，首选宽度为配置按钮高度的五倍；长文案和皮肤最小宽度优先，空间不足仍拒绝。显式 `actionLayout`、多个连续按钮及 1.0–3.0 的尺寸与排列保持原规则。滚动面板已有的固定动作区也使用这项单按钮比例，不改变动作所在分组或提交范围。
- 4.0 进度项把名称与数值／百分比排在同一行，进度条紧随其后；窄空间保留完整文字并回退到纵排，不缩小字号。同一分组内有多个进度项时，各项使用弱 inset 底板；已有任务卡中的单个进度项不额外套板。安全区与轨道最小宽高参与编译预量、自动面板宽度和网格列数选择，原值、上限、百分比与行 ID 保持不变。
- 2.0、3.0、4.0 的 grid 为自适应卡片网格：横屏依据内容最小宽度、`minCardWidth` 和 `maxColumns` 选择 1–3 列，竖屏为一列，末行保留统一格宽。仅在编译所选方向时决定列数；不是随浏览器窗口动态重排。明确横排和固定列数用原生 row 表达，空间不足仍拒绝。
- 旧 3.0 按原合同为正文／控件分组使用 content、独立只读数据使用 inset；旧 2.0 的纯说明无底板、分组与数据双层 Panel 继续原样复现。这些版本不获得 4.0 的主框放大或连续正文策略。
- 1.0 保留固定两列、普通容器分组与原有数据块，不回填新底板。旧输出不改写，新配置和提示进入计划摘要；旧待执行计划使用冻结配置及严格版本化的旧提示词，只有输入或能力确实变化才要求重新准备。

其余结构与尺寸合同：

- 文字、输入框、勾选框、开关、滑块、下拉、进度条及按钮自由组合；无需含指定种类或强制关闭按钮。至少一个内容项或按钮。
- 原生 `column/row/grid/section` 树：多分组、嵌套、横排、纵排和等宽网格。保留层级、分组标题、控件源顺序及动作所在分组；行 ID 按整棵树深度优先编号，提交/重置目标不会因重新排版而改变。
- `row` 等分宽度并保留横排结构；`grid` 按冻结的 1.0/2.0/3.0/4.0 消费策略选择列数。
- 生成前选择 16:9 或 9:16，计划、转换、预览和下载只包含选中方向。省略方向的历史 CLI 仍可产生双版，旧双版作品保留。
- `layout.width` 可指定面板逻辑宽度，`layout.maxHeight` 为高度上限；null 由默认尺寸、内容、组件最小尺寸、皮肤安全区与画布确定。3.0、4.0 的高度按实际内容收敛，短文案不强占旧 70 像素文字高度；长内容在显式 scroll 下受 maxHeight 和画布上限约束。旧 1.0/2.0 默认高度作为起点，内容需要时增高；组和行的内容高度独立计算。显式 canvasWidth/canvasHeight 拒绝，模型不能修改选定画布，不把控件整体缩放或缩小字体塞入面板。
- 程序从冻结配置生成填充宽度和内容高度，使用已有 Yoga/Layout 计算实际尺寸。多组留白和间距由 `preset.layout` 与 `geometry` 维护；上游 intent 0.12 尚无逐节点比例、padding 或 fill/content 字段，不能由模型发明它们。
- `overflow:error|scroll` 明确选择；长内容可滚动，主标题固定。旧单组末尾按钮仍固定；复杂结构中的按钮随其所属分组滚动，不抽走到另一个动作区。
- Button-only 分组可用上游 `actionLayout` 指定横纵排列、对齐、间距和按钮宽高，shape 必须为 default；显式尺寸不足明确拒绝。
- 输入校验、状态初值/禁用、滑块范围步长、下拉默认项、进度值，以及按钮的本地事件、提交、重置指定字段。
- 当前资源上限为 12 个内容项、3 个按钮；不等于每个组合必然能在任意尺寸内排下，尺寸与安全区检查仍会拒绝超量/越界组合。

自定义 Tabs、宽度比例、逐节点内边距、任意坐标、圆形按钮、图片、功能图标及未映射控件仍不在当前自定义转换器范围内。提示要求模型给出具体澄清，确定性转换再次拒绝不支持的结构或语义，不静默删控件。已有设置适配器的 Tabs 保留，不表示混合控件适配器也支持。正式文本机制与所有组件/面板共用；编译阶段的保守文字空间估计不等于字体实际栅格测量，浏览器真实皮肤校验仍是必要验收。

维护位置：

| 位置 | 责任 |
| --- | --- |
| configs/custom-panel.json | 自定义支持类型、配方、数量上限、默认尺寸和 preset.layout 策略 |
| src/panel/custom-panel.mjs | 扩展公共 action 配置；不修改八套预设或旧 action 配置 |
| prompts/custom-panel-planner.md | 自定义模型能力约束；不复用 SDK 固定结构要求 |
| src/panel/action-intent.mjs | 原生意图校验、既有字段/动作映射与自定义分流 |
| src/panel/custom-layout.mjs | 上游树到 PanelDocument 的转换、尺寸推导、滚动和明确拒绝 |
| src/panel/custom-presentation.mjs | 1.0/2.0/3.0/4.0 策略校验、语义底板、数据排列与列数选择 |
| src/panel/skin-geometry.mjs、src/runtime/png-geometry.mjs | 已验证皮肤的几何证据；编译与 PNG 运行时共用最小尺寸/九宫格/内容安全校验 |
| src/runtime/layout.mjs | 共用 Yoga 计算；不另建规划或布局求解引擎 |
| src/panel/action-behavior.mjs | 本地状态/提交/重置；不调用游戏后端 |
| src/panel/form-actions.mjs | 版本化的整表默认范围、明确范围识别及动作声明校验，不修复原意图 |
| src/studio/panel-presets.mjs、pipeline-ui.mjs、pipeline.mjs | 入口、必填交互、冻结计划与生成任务 |

编译报告 `surfaceRecipesVersion:3` 固定当前参考图排版，2 保留上一版分层展示，1 保留旧表面配方，0 或更早缺失标记保留无配方行为。已经保存的输出不被重写；旧配置与提示按冻结版本核验。八套参考预设使用 `presentation:3.0`，复用同源测量、单主框与弱分组策略，同时保持各自控件 shape 和本地行为；原生确认 Dialog 保留模态语义，设置页签保留页面和选中状态。

验证：`tests/custom-panel.test.mjs` 及布局回归检查混合类型、结构、尺寸、状态、无效语义及计划指纹；`scripts/studio-check.mjs` 检查入口、必填、切换保留文案、请求类型、取消不调用模型及移动端；`scripts/studio-layout-check.mjs` 检查真实皮肤实际布局、鼠标/原生输入交互与导出不变。最新结果见执行文档。

离线示例可通过下列命令预览，不调用模型，产物始终标记 offline-fixtures：

```powershell
node scripts/action-preview.mjs --package work/<verified-pack> --examples examples/custom-panel.json --out work/custom-panel-preview
node scripts/custom-panel-check.mjs work/custom-panel-preview/<id>
```

复杂结构夹具为 `examples/custom-layout.json`，通过同一 action-preview 入口传入 `--examples examples/custom-layout.json --orientation landscape`（或 portrait）；新夹具仍标记 `offline-fixtures`。真实皮肤检查使用 `node scripts/studio-layout-check.mjs <preview-directory> --screenshots <仓库外目录> --require row,column,nested,fill,content,grid`。这些命令不提交模型调用，不将离线样例写成模型成功记录。

分组／数据卡片／自适应列数夹具为 `examples/adaptive-panel-cards.json`，同一预览入口可生成横竖两版。来源核对固定为上游 `tony` 提交 `768cf5d09ac3fc693586815b459364dc30913a50` 的 heading/section/data panel 与 readable layout 公开行为；本地只适配已有规划语义，不复制旧 PanelSpec 编译器，不覆盖本地 rc.8 增量，也不启用尚未适配的 context 0.12 / intent 0.13。该段记录旧适配的来源；当前正式 SDK 发布包与目录读取的摘要锁定见[规划接入](planning-integration.md)。
