# Panel 更新接入对照与离线基线

## AI仓库接入（12.139；程序预设历史见12.136–12.138）

| 能力 | 上游planning/v1 | Chain | 维护位置 |
| --- | --- | --- | --- |
| 物品槽、名称、数量、选中详情 | inventory-row/context0.12/intent0.13，支持格位、名称/数量、资产图标与槽位选择 | 显式仓库预设走AI方案；行列1–32、总量≤144、默认5列4行，新计划固定格双向滚动、网格两轴≤4000；未提供物品时为空；保留模型物品及选择；图标仅null，以名称展示，不替换为例图 | inventory-planning.json、inventory-intent、action-model、runtime/inventory-* |
| 紧凑横右/竖下、皮肤最小尺寸与安全区 | grid含显式物理尺寸、间距、起点和排列轴 | 程序grid冻结方格/等距/零padding/左上逐行，意图须逐字段相同；cellSize保持方格，内部滚动，宽度不足拒绝 | inventory-intent、inventory-geometry、inventory-adapter、png-geometry |
| 模型内容与历史兼容 | 模型items/selectedSlot | AI内容不回填旧8样例；空初始槽以initialSlot保留；旧程序任务、原始格位和副本不改写 | inventory-intent、inventory-model-request、inventory-policy、pipeline builder分流 |
| 任意自定义仓库、多格/拖换、物品图集 | 新库存合同须逐项核对，不等同完整游戏业务 | 本轮仅显式仓库入口的单inventory行；不支持附加控件、多格/拖换、固定图标资产，明确拒绝 | inventory-planning能力声明、inventory-intent拒绝规则 |

新建仓库复用上游规划引擎和既有Codex可选适配，确认一次模型调用；其他预设目录保持。完整维护与当前验收见[仓库面板](inventory-panel.md)及12.139。

## 最新源码审计与责任边界（2026-10-15）

本节是 12.124 之后本轮布局对齐的接手基线，优先于后面的历史表。它区分 **上游规划协议**、上游旧 PanelSpec 编译器、Chain 组件运行时和 Chain 的 AI 转换器：运行时可以排版，不等于模型返回的同类语义已经接通。上游存在其他未提交修改，本轮只读核对，不移植其工作区、不修改或提交上游文件。下表中的“待实施”在集成与离线/真实皮肤验证通过前都不能视为完成。

### 协议与几何对照

| 能力/字段 | 上游最新实际支持 | Chain 接手时实际支持 | 缺口与本轮对齐范围 | 集中维护位置 |
| --- | --- | --- | --- | --- |
| 公开规划边界 | `planning/v1` API `1.0`；原目录context `0.11` / intent `0.12`，库存目录context `0.12` / intent `0.13`；可选Codex API `1.0` | 精确兼容 `(0.1,0.3)`、`(0.4,0.3)`、`(0.11,0.12)`、`(0.12,0.13)`，准备/校验复用公开入口 | 原预设不切目录；库存独立消费；相邻源码尚非不可变发布锁定 | 上游planning/v1；Chain planning-client、planning-compatibility、inventory-intent、action-model |
| `section` 多分组 | intent `0.12` 原生多 section，程序按全局深度优先次序赋 row/section ID；语义标题非空 | 设置适配器支持同级多组；自定义混合控件适配器仍强制单 section | 待让自定义保留多组、标题和分组内控件/动作，不将树拍平 | Chain `src/panel/action-intent.mjs`、`custom-panel.mjs`；能力/几何用 `configs/custom-panel.json`；设置仍由 `settings-intent.mjs` 维护 |
| `column` / `row` / 嵌套 | intent 的容器精确字段为 `{kind,children}`，kind=`column|row|grid`；最多 96 节点、8 层；上游 lowering 最多 32 section / 全局 128 row | 设置只接受 column 下直接 section；自定义只接受 column 的单 section。PanelDocument `0.3` / Yoga 运行时已有嵌套 Container、row/column | 待桥接同一棵上游结构树到 Chain Container；宽度不足应明确拒绝，不把明确 row 偷换为 column | 上游 `src/panel-intent.mjs`；Chain 转换层及 `src/runtime/layout.mjs`、`schemas/panel-document.schema.json` |
| `grid` / 双列 | intent 只表达 kind=`grid`；上游 PanelSpec 的 `minColumnWidth` 决定最多两列，不足退单列；不是任意固定 N 列网格 | Chain 运行时支持明确固定 1–16 列与 cellHeight，但 AI 转换尚不接受 grid | 对齐时须保留上游“双列/不足单列”的公开语义，或明确拒绝；不能把其等同于 Chain 固定 N 列 Grid | 上游 `src/flow-layout.mjs`、`panel-intent.mjs`；Chain 转换/布局策略 JSON |
| Panel 显式尺寸 | intent `layout.width/canvasWidth/canvasHeight/maxHeight` 可 null 或整数；materializer 限 1–4096。没有 `layout.height` | 设置/动作/自定义均要求四字段 null；具体面板宽高来自各预设 JSON；Canvas 固定 1280×720 / 720×1280 | 待接自定义 `width/maxHeight` 为面板内部几何意图并执行最小尺寸/画布检查；选定画布由程序固定，显式 canvas 尺寸应拒绝 | Chain `configs/custom-panel.json`、转换层、`src/panel/orientation.mjs`；画布合同 `configs` 中既有 presets |
| 宽度比例、min/max、grow/shrink | **当前 native intent `0.12` 无这些字段**；上游 PanelSpec flow 节点只有 `width:"fill"|整数` 等字段，也没有比例权重 | PanelDocument `0.3` 运行时支持 sizing 的 min/max/grow/shrink；模型路径未暴露 | 属于上游规划协议缺口：本轮可由配置采用等分/填充，但不能声称 AI 已可表达 2:1、独立最小宽度等。后续需上游版本化协议后显式增加兼容对和语义测试 | 上游版本化 Schema/能力声明负责表达；Chain 配置/转换负责映射到 `sizing`，不能在 Chain 私改 intent Schema |
| padding / gap / align | native 容器无上述字段；上游 materializer 默认 flow gap=20、align=start、width=fill；PanelSpec 和编辑协议另有 padding/gap/align，不等于初次规划可输出 | Chain runtime 的 Container 支持 gap/padding/align/justify；既有预设配置决定内边距和间距 | 本轮可按皮肤/配置确定安全留白和排版，模型不能在 intent `0.12` 发明 padding 等字段；个性化该值需版本化上游扩展 | 上游 `src/panel-intent.mjs`、`layout-details.mjs`；Chain 配置 JSON 与转换层；共用运行时不复制几何引擎 |
| fill / 内容自适应 | native intent 没有 fill/content 模式；上游按控件、文字及主题测量其 PanelSpec | Chain runtime `sizing.widthMode/heightMode=fixed|fill|content`；content 只适用于 flow Container；禁止父 content 与同轴子 fill/grow/shrink 循环 | 待由转换程序给容器/子项采用安全 fill、content；AI 保持结构意图。Text 的真实换行测量需单独处理，不能拿 Container 几何高度声称文字全适配 | Chain `src/runtime/layout.mjs`、转换层、[布局合同](layout-contract.md)；文字复用既有安全检查 |
| 内容测量/草稿适配 | 公开主入口导出 `fitDraftPanelLayout`；`draft-content-fit-v1` 限无 Tabs/外部资源的 `0.16` / `modern-v3` / 无 frame；**最新 v2 已支持 Tabs 和内容图片**，仍无 frame/panelSurface/rowIcons | Chain 文档、PNG 皮肤及尺寸合同不同，未直接调用该旧 PanelSpec 工具；preset grow 仅基于已构建盒子 | 不跨格式直接调用或复制该函数；复用 Chain Yoga、控件/皮肤/文字验证计算实际几何。后面的历史“无 Tabs”是 v1 范围，不能泛指最新上游 | 上游 `src/draft-layout.mjs`、`src/index.mjs`；Chain `src/runtime/layout.mjs`、`src/panel/document.mjs` 及转换层 |
| Tabs | intent 根节点支持 Tabs，2–8 页，每页一个容器树，唯一 initial；页内容可嵌套 row/column/grid；Tabs 不能作为普通子节点 | 设置支持 2–8 页，但每页只 column 下直接 section；自定义拒绝 Tabs；组件 runtime 已有双层底板和页切换行为 | 自定义 Tabs 若本轮不接应明确报错；不能把“设置已有”写作全部 AI 路径已接 | 上游 `panel-intent.mjs`、`flow-layout.mjs`；Chain `settings-intent.mjs`、`settings.mjs`、`runtime/tabs-geometry.mjs`、`runtime/collections.mjs` |
| `section.actionLayout` | native `0.12` 仅 Button-only section 可非 null，direction=row/column、align=start/center/end、gap=0–128、buttonWidth/Height=44–512、shape=default/circle，circle 必须等宽高 | 设置及自定义/动作均拒绝非 null；默认动作 footer 横排均分 | 若桥接须保留 section 归属与显式大小；圆形的 Chain 皮肤/组件能力需额外映射，不能只接受字段后丢弃 shape | 上游 `src/action-layout.mjs`、`panel-intent.mjs`；Chain 转换层及按钮皮肤/最小尺寸检查 |
| overflow | native `auto|scroll|error`；上游 materializer 将 auto 作为其测量/滚动策略 | 设置 `error|scroll`；自定义 `error|scroll`；固定动作预设只有 error；滚动采用真实皮肤边距及 ScrollView | 不自动把 error 改 scroll。若新增 auto 必须在配置定义本地确定性策略和测试，不能照搬上游不同画布的结果 | Chain `action-intent.mjs`、`settings-intent.mjs`、`src/runtime/scroll-geometry.mjs`、配置 JSON |
| 16:9 / 9:16 | 上游可建议自己的 canvas 尺寸；它不是 Studio 的权威画布选择者 | Studio 已先选方向并固定消费者配置，`panelOrientations(ctx.orientation)` 只产该方向；省略参数保留历史 CLI 双版 | 本轮保留现有选择，不再让模型追问比例，不改写历史双版产物。旧文“同时交付横竖”仅适用历史/未选方向 CLI | Chain `src/panel/orientation.mjs`、模型计划与 Studio pipeline；`docs/local-studio.md` |

### 组件、皮肤与行为边界

- 上游 native intent 的叶节点支持 text/input/checkbox/radio/list/dialog/image/switch/slider/select/progress/button 等行语义；Container/Panel/ScrollView/Tabs 属于其结构/编译语义。Chain 有 16 类运行时组件不代表 16 类都有 AI 叶节点映射。当前自定义只映射 text/input/checkbox/switch/slider/select/progress/button，仍以 `configs/custom-panel.json` 和 action recipes 为白名单；图片、功能图标、radio/list/dialog 等未映射语义必须明确拒绝。
- Chain 保留选定 PNG 皮肤、九宫格、安全内边距、既有本地交互与动效。上游 `themeKey` 是已声明的符号映射，不能据此替换实际皮肤；`panelSurface` 与 row `icon` 的资源覆盖目前仍拒绝。组件展示样例的 size 不等于 runtime 上限，实际计算仍需通过组件 minimumSize、皮肤九宫格、文字与画布边界检查。
- **submitRows 是明确的消费端行为差异**：上游 materializer 只接受 Input 作为 submit 目标；Chain custom 的既有本地提交合同可收集 input/check-box/switch/slider/select 五类状态，reset 同样有自己的目标白名单。Chain 当前复用上游规划 Schema/运输而未调用上游 materializer，不能声称两者的所有行为语义等价。本轮保留既有 Chain 行为；未来统一应版本化消费者行为合同、提示、夹具及历史兼容，不能夹在布局对齐里偷偷改动。
- 未识别字段先由冻结的上游 responseSchema 拒绝；已在上游 Schema 内但 Chain 尚未映射的语义应由转换层明确拒绝。提示里的限制不能替代程序校验，也不能通过澄清要求用户放弃本来支持的已选画布。

### 本轮实施与验收记录

上面的“接手时”表保留为实施前快照；下面单独记录本轮已落地源码，二者不是同一时点。最终验证数量、真实皮肤浏览器证据及 Studio 是否已重启，以 [执行文档 12.125](execution-plan.md) 的最终记录为准，本表不提前宣称现场接入完成。

| 本轮已落地 | 实际行为与保留边界 | 维护入口 |
| --- | --- | --- |
| 自定义结构转换 | 保留原生 section / column / row / grid 的嵌套、分组标题和深度优先行序；全局动作目标随原序保留。最多 8 层（根为第 1 层）、96 个结构节点、32 组，并保留 12 个内容项 / 3 个按钮的消费者上限；仍复用规划 API 和既有组件运行时 | `src/panel/custom-layout.mjs` 的 `customIntentLayout`、`customPanelDocument`；`src/panel/action-intent.mjs` |
| 集中布局策略 | `preset.layout` 1.0 冻结 groupGap、groupPadding、maxDepth、gridColumns、minColumnWidth；转换程序采用 `widthMode:fill` / `heightMode:content`，由现有 Yoga 解算实际尺寸；不让 AI 发明对应 native intent 字段 | `configs/custom-panel.json`；`src/panel/custom-panel.mjs`；`src/runtime/layout.mjs` |
| 面板宽度和高度上限 | 自定义接受 `layout.width/maxHeight` 为 24–4096 的逻辑整数或 null；null 时结合控件/文字/皮肤要求计算，显式宽度不足或高度超上限报错。画布仍由 Studio 预选 16:9 / 9:16 决定，只输出该方向 | `src/panel/custom-layout.mjs`；`src/panel/orientation.mjs`；`src/panel/action-model.mjs`；`prompts/custom-panel-planner.md` |
| PNG 几何和安全留白 | 从已校验皮肤提取 panelInsets、scrollInsets 与无路径的 skinGeometry，编译及 PNG 运行时复用 `pngGeometry` / `assertPngComponent` 的九宫格、最小尺寸和内容安全区门槛。缺少证据拒绝；不重新生成皮肤、不缩小文字或控件来放行 | `src/panel/skin-geometry.mjs`；`src/runtime/png-geometry.mjs`、`png-skin.mjs`；`scripts/action-model.mjs`、`action-preview.mjs` |
| 严格双列及按钮布局 | row 等宽分配；grid 明确固定两列，最后一行保持空槽，不足即报错。**这是 Chain 明示的消费策略，与上游 PanelSpec grid 可退单列不同**。Button-only section 可使用 shape=default 的 actionLayout；显式按钮大小不足拒绝，普通连续按钮测宽计入整行需求 | `configs/custom-panel.json` 的 `preset.layout`；`src/panel/custom-layout.mjs`；`prompts/custom-panel-planner.md` |
| 滚动与固定按钮 | 保留旧“单 column + 单 section + actionLayout:null”末尾按钮的固定 footer；复杂树的按钮按其 section 和源序进入滚动内容。两种情况均固定主标题；overflow:error 不自动改为 scroll | `src/panel/custom-layout.mjs`；`src/runtime/scroll-geometry.mjs`；`docs/custom-panel.md` |
| 明确拒绝未接语义 | 自定义仍拒绝 Tabs、circle 按钮形状、overflow:auto、显式 canvasWidth/canvasHeight、资源覆盖、图片/图标及未映射行种类；未知字段由冻结的上游 responseSchema 拒绝，已知但未接字段由转换器拒绝，不静默删除或替换结构 | `src/panel/settings-intent.mjs` 的 Schema 校验；`src/panel/action-intent.mjs`、`custom-layout.mjs`；`configs/custom-panel.json` |
| 保留上游协议职责 | 原生 intent 0.12 仍没有任意宽度比例、容器 gap/padding、独立 sizing 等语义；本轮仅冻结 Chain 的确定性配置，没有新增平行规划协议。要让 AI 指定 2:1 等规则，需上游先版本化表达，再显式升级兼容对与转换回归 | 上游 `src/panel-intent.mjs` / 公开能力声明；Chain `configs/planning-compatibility.json`、`planning-client.mjs`、转换层 |

新增结构夹具在 `examples/custom-layout.json`；针对转换、尺寸、皮肤、错误边界和计划冻结的离线回归在 `tests/custom-layout.test.mjs`、`tests/planning-layout-policy.test.mjs`，真实皮肤浏览器检查复用本地预览与 Studio 检查器。配置和提示均进入不可变模型计划，变更后的旧待执行自定义计划须重新准备；已有冻结面板、皮肤包、本地行为与动效选择不重写。本轮无模型调用，最终检查结果与 Studio 接入记录继续见执行文档 12.125。

## 历史接入记录（2026-10-14）

2026-10-14。此表记录实际接入边界，不把上游能力等同于 Chain 已实现。

| 能力 | 上游公开能力 | Chain 当前情况 | 接入动作 |
| --- | --- | --- | --- |
| 规划与输出 Schema | planning/v1，API 1.0 | 已接；新版标题目录仍为 context 0.11 / intent 0.12 | 已加入该目录的准备、验证回归，不扩大白名单 |
| 模型调用 | planning/codex/v1 | 已接可选运输 | 本轮零调用；旧计划不重放生成 |
| 开关、滑块、下拉设置 | 原生意图支持 | 默认已迁移 intent 0.12，保留显式0.3兼容、单列单组 | 范围、默认值、禁用与顺序等价回归通过；多组仍待续 |
| 确认、输入表单 | 原生意图 0.12 | Text/Input/Checkbox/Button 有限预设已接 | 继续保留提交、重置、关闭行为与内容独立 |
| 主标题居中 | 上游编译器已实现 | Chain 新预设通过 presentation.titleAlign 居中 | 已适配；旧配置未声明时保持左对齐 |
| 自动隐藏多余分组标题 | 0.22.0 concise-v3；显式显示 0.22.1 | 当前单分组动作预设支持 auto-single / show | 已适配受限单组策略；名称保留，多组/Tabs仍未支持 |
| 内容测量与草稿适配 | 公共 fitDraftPanelLayout | 不能直接调用于 Chain 文档/PNG 皮肤 | 上游仅支持特定 0.16 flow/modern-v3、无外部资源/页签/边框；下一步确定独立布局数据桥接边界 |
| 横竖画布 | 上游可调整建议画布 | Chain 固定 1280×720 / 720×1280 | 保持 16:9 / 9:16，不因内容自动改变画布比例 |
| 全部 16 类组件组装 | 上游有完整组件协议 | Chain 运行时有 16 类，AI 转换尚未覆盖全部 | 逐类映射状态、布局、资源与行为；拒绝未支持字段，不能自动丢弃 |
| 业务功能 | 界面与事件合同 | 本地试玩事件 | 不把登录、支付、存档等面板当成业务实现 |

## 本轮实测

复用烘焙修正包 `work/skin-postprocess/d0592dc5-7dd9-4fea-a1bb-d1ef416cf1f3/consumer/ffd632c8-1d44-4f90-b030-f4ece56185e3/skin`，没有重新生成图片。结构化示例是离线夹具，不是新模型输出。

| 检查 | 结果 | 证据（Harness 内本地产物） |
| --- | --- | --- |
| 新旧规划目录、受限转换与计划校验 | 12 项通过 | planning-client/settings-intent/action-intent/action-model 测试 |
| 设置横竖交互、导出与重开 | 13 项通过，语义差异 0 | work/panels/upstream-upgrade/settings/2b16e9e2-ff45-4272-b8e4-8e670be30698 |
| 确认/表单横竖交互、提交与重置 | 10 项通过，语义差异 0 | work/panels/upstream-upgrade/actions/7438c28e-04cd-4469-b0ff-70bb70d6a400 |
| 设置首屏按钮边界 | 2 个方向通过 | work/panels/first-screen-checks/f459a1b3-f3b9-489c-8f12-95828f28334a |
| 确认/表单首屏按钮边界 | 4 个样本通过 | work/panels/first-screen-checks/5373050a-508d-439e-90aa-ba128bd6a253 |

复核命令：`node scripts/panel-first-screen-check.mjs <preview-directory>`。先验证预览文件摘要，每个样本重新加载、再选择方向/预设，在任何组件交互或焦点导航前读取实际按钮边界。保存全页面截图、画布/面板框与按钮数据，失败返回非零状态；只访问内存中的离线预览。

检查只覆盖当前三类预设的首屏按钮是否可见且完整位于画布、面板框中，不证明任意文字适配、任意滚动/页签布局或自然语言理解正确。并发浏览器发生过一次超时；修正检查器对 Pixi 可见性的读取后串行复验通过，原失败目录保留。

截图确认：现有确认弹窗仍有左对齐主标题和额外分组标题。此批是升级前基线，并非新版布局效果验收。未修改上游源码、未切换默认主题、未调用模型。

## 呈现适配 v1（2026-10-14）

新默认配置在 `configs/settings-layout.json` 与 `configs/action-presets.json` 内的 presentation：version、titleAlign、sectionHeading、height、canvasMargin。逻辑集中在 `src/panel/preset-presentation.mjs`。这属于Chain的受限预设适配，没有调用或复制上游PanelSpec排版实现。

- 主标题居中；单分组动作面板默认隐藏分组标题，可显式show，content.sectionTitle不变。
- grow按实际生成的控件行高度、间距和面板内边距计算所需高度；仅增高，不收缩控件，不改变画布比例。超出画布安全边距返回panel.canvas-capacity。
- 未声明presentation的旧配置保持fixed/left/show；新的配置进入现有模型计划摘要，旧模型计划不能绕过配置一致性检查直接套用。现有导出快照不改写。
- 这是控件盒子占用测量，尚非字体实际换行测量；也未支持任意多组/Tabs布局。长文字依然由既有文本溢出策略处理，不能声称任意文案均完整显示。
- 204项Node回归通过；三类面板横竖23项交互、6个首屏按钮样本通过。新增测试覆盖旧配置、显式标题、无语义/行为变化、增加字段时自动增高、过大内容拒绝及非法策略。
- 新候选：`http://127.0.0.1:4201/`。settings产物 `work/panels/presentation-v1/settings/947a6200-c78e-45a2-ba48-878d3a271725`；actions产物 `work/panels/presentation-v1/actions/5b97b29c-6ead-44f1-a01e-738b3b610e3b`。
- 首屏证据：`work/panels/first-screen-checks/90069297-4c19-4abc-ad4c-5749190eaa55`（四项动作）及 `work/panels/first-screen-checks/d8f18879-e3a0-4df9-8a23-c20e3c3122c4`（两项设置）。回归日志 `work/panels/presentation-v1/regression.log`。无模型调用，未生成资产。

## 多分组更新（2026-10-14）

最新设置转换支持intent0.12中column下的多个同级section，groups引用fields并验证有序完整覆盖；多组标题保留显示、占用高度参与布局。嵌套、Tabs、显式动作布局与滚动仍拒绝。旧文的单组限制已由此处补充。208项离线回归、13项真实皮肤交互与2个首屏样本通过；4202候选待用户验收，详见执行文档12.76。

## 滚动接入更新（2026-10-14）

设置的overflow:scroll已接现有ScrollView：主标题/关闭按钮固定，中间分组内容滚动；真实皮肤包经settingsSkinGeometry提供逻辑边距，编译与运行时共用scrollPadding。超宽、内区不足或缺少导入皮肤边距证据拒绝。error策略不自动变为scroll。此前“滚动未支持”说明由本段取代；Tabs/嵌套仍未接。210项回归、15项横竖交互和2个首屏按钮检查通过；4203候选待验，详见执行文档12.77。

## 页签更新（2026-10-14）

设置页签已实现：intent0.12的2–8页、每页同级分组、唯一默认页、整体禁用及独立滚动；复用PixiUI Tabs/Switcher。212项回归与17项交互通过，4204待验。此前Tabs待实现的说明由此补充；嵌套结构、完整16类AI映射、长文本测量与Studio统一入口仍未完成。详见执行文档12.78。
