# UI Reference Harness · 0.8.3 source release

## 0.8.3：同步验证复用与 PNG 解码优化

同一次同步状态/DAG 检查复用已验证证据；缓存命中仍核对源文件完整字节与路径安全，
不依赖修改时间，不跨请求或 await。保留 SHA-256、逐像素不透明、原图/规范化像素一致及
level 9 确定性 PNG 完整字节检查。已完成的 0.8.2 结果可继续验收与交付，旧计划不执行。
详见 [0.8.3 发布说明](docs/release-0.8.3.md) 和 [验证与离线性能回归](docs/validation-performance.md)。

## 0.8.2：修复图片工具大回执

CLI 转发 Hook 的 PostToolUse 输入上限调整为 96 MiB，PreToolUse 请求仍为 2 MiB。
大图片响应仅提取身份元数据，沿用原有冻结输入、原图保留和独占凭据检查。
未知尝试保留原记录，不补写历史凭据或自动重投；Web/API 合同不变。
详见 [大回执输入合同](docs/relay-hook-input.md) 和 [0.8.2 发布说明](docs/release-0.8.2.md)。

## 0.8.0：统一项目主参考

所有新面板计划共用已确认风格版本的完整 primary-style PNG；任何面板都可以先生成。
默认无备注使用完整默认样本，衍生或自定义风格使用确认后的完整预览，不使用卡片缩略图。
项目主参考只通过风格确认/修订改变。接受面板图片只接受该 run，不能设定项目锚点。
旧 anchorPanelId 仅作为惰性兼容输入；useAsAnchor: true 明确返回 PROJECT_ANCHOR_REMOVED。
新 DAG 为 ui_reference_project_dag_v2，含 primaryReference、无 anchor 依赖。
修改请求依次冻结 revision-source、layout-reference、primary-style（及已有原型上下文）。
风格缺少主参考时返回 STYLE_PRIMARY_REFERENCE_REQUIRED，须明确修复风格；不自动补图。
旧 DAG、计划、锚点、原图、原生会话和 ZIP 均保留。已完成旧结果可显式验收/导出；旧计划不执行。
新 DAG 不重置项目/面板/风格/原型会话的三轮修改预算，失败和不明状态不自动重投。
规则风格与六种样本准备仍可读取；无主参考的规则草案不能再冻结新计算计划。
真实模型调用 0；替身与 PNG 技术检查不代表人工视觉验收或 Docker 实际部署。


把 `ui-panel-harness` 的面板原型，按一个游戏项目固定的风格转成 UI 参考图。
支持六种默认风格、定制 UI 风格包、用户主风格 PNG、可选自然语言补充、风格修订及同风格整套交付。

已实现本地文件工作区、CLI、原型接入、提示词编译、单次生图交换／可选适配器、PNG 技术 QA、
显式人工验收和可验证 ZIP。没有内置在线生图提供商；六份默认样本已完成人工验收并形成外部本地样本包。
概念图风格的同项目设置／主菜单／确认弹窗已完成真实试跑、参考图用途的人工验收及整套交付校验。
首张设置图作为视觉锚点；已观察到的字号与比例偏差保留，不承诺像素级还原。
按源码附件分发；生产接入需固定不可变仓库标签及归档摘要，不复制第二份源码维护。

当前发布标签为 `ui-reference-harness-v0.8.3`；附件校验、启动与升级边界见 [0.8.3 发布说明](docs/release-0.8.3.md)。

当前源码另包含可选 CLI Code-mode 转发适配器，可显式传递
`transparent_background=false`；原生适配器继续沿用 0.7.2 合同。配置与单次调用门禁见
[本地工作台说明](web/README.md#可选的-code-mode-转发入口073)，
宿主边界见 [接入说明](docs/host-integration.md#073-可选-cli-code-mode-转发)。
本版修复原生生图 Hook 的参数兼容，移除 `transparent_background` 注入，保留不透明 PNG 检查。
包含 [0.7.1](docs/release-0.7.1.md) 的 Studio 验收、删除／恢复、报错提示和 ZIP 命名补丁。
项目级 DAG 自 [0.7.0](docs/release-0.7.0.md) 提供；旧 `ui-reference-harness-v0.6.0` 不含 DAG。开发快照不能替代正式发布附件。

## 项目级 DAG

已实现显式无环依赖、冻结项目上下文、已确认主参考与独立面板计划、逐面板
单次生成交换／适配器、持久化操作重放、三轮修改、最近接受版本选择及可验证整套交付。
已有 CLI 接受图可以直接接入，不重新生成。创建、检查和 advance 均为零计算；授权、
生成、验收和导出仍有明确入口。提供核心函数与 `dag-*` CLI，消费服务自行接入。
详细命令、恢复规则与 Studio UX 映射见 [项目级 DAG 合同](docs/project-dag.md)。

## 流程

```text
PanelBundle 或 PanelSpec + Catalog
  → 可见结构 + 中性布局 PNG + 可选原型截图
  + 项目已确认风格（预设 / 定制包 / 用户参考图 / 包与图片组合）
  + 可选面板意图
  → intent → compiler-prompt → 冻结计划
  → 一次摘要绑定授权 → generation
  → qa（格式、分辨率策略、宽高比、不透明、非空）
  → post-process（规范化 PNG 编码，RGBA 像素不变）
  → qa（像素重放、摘要、人工布局/风格/文案验收）
  → output（PNG + 来源说明 + handoff + manifest + ZIP）

显式优化：拒绝结果 → optimize → 新计划 → 新授权
下游：已接受 reference.png → ui-layer-harness
```

原型决定结构、文案、逻辑坐标和当前可见状态；风格决定配色、材质、造型和装饰。
面板备注只强调现有元素。结构变化回到上游；全局外观变化创建新风格草案。
程序不通用判定自然语言冲突，由 Agent 在规划前处理，实际视觉服从仍需验收。

## 条件与启动

- CLI 使用 Node >= 22.18.0，无 npm 第三方依赖，无须启动 Web 服务。
  可选的 [本地参考图工作台](web/README.md) 使用独立 React/Vite 依赖，直接复用核心接口。
- 保留兄弟包目录关系。原型导入只读复用 `ui-panel-harness` 与 `ui-component-harness` 公开核心。
- 输入／输出 PNG：8-bit、非隔行，支持 RGB/RGBA/灰度/灰度 alpha/索引色。
  单边最多 4096 像素，单文件最多 64 MiB；不支持 JPEG、APNG、16-bit 或隔行 PNG。
- 每次生成一个面板当前视图的一张完整不透明参考图，不扩展隐藏页签或交互状态。

从仓库根目录运行（PowerShell）：

```powershell
$ReferenceCli = "game-ui-harnesses/ui-reference-harness/ui-reference.mjs"
$ProjectRoot = "work/my-game-ui"
node $ReferenceCli doctor
node $ReferenceCli self-test
node $ReferenceCli init --root $ProjectRoot --id my-game
node $ReferenceCli presets
```

doctor/self-test/status/inspect/inspect-project-plans/validate 均不提交模型请求。plan/plan-project 只冻结本地输入；
style-create 只冻结规则和可选图片，不调用生图；仅旧开发预设保留确定性配色指导板。
私有输入和输出应保存在忽略的 `work/`。

## 项目风格

默认目录与网站一致：

| ID | 名称 |
| --- | --- |
| concept-art | 概念图风格：中性 2D，干净易读，不强调特定流派 |
| pixel-cartoon | 像素卡通 |
| anime-cel | 日系赛璐璐 |
| western-cartoon | 欧美卡通 |
| fantasy-handpainted | 幻想手绘 |
| chinese-fantasy | 国风幻想 |

每包有自己的 UI 适配版本、来源摘要、画风和控件规则、推荐配色及禁则。
默认包允许没有图片；当前目录的 sample.status=not_generated，不把配色矩形当成美术样本。
旧 `casual-clean`、`painted-fantasy`、`neon-tech` 仍可显式读取／创建，不在新默认目录展示。

```powershell
node $ReferenceCli style-create --root $ProjectRoot --preset concept-art
# 或装载已接受的本地默认样本包（该目录须已解包）：
node $ReferenceCli presets --sample-catalog work/default-samples/catalog.json
node $ReferenceCli style-create --root $ProjectRoot --preset concept-art --sample-catalog work/default-samples/catalog.json
# 或用户主参考图：
node $ReferenceCli style-create --root $ProjectRoot --reference work/input/style.png
# 或预设 + 用户图 + 明确规则：
node $ReferenceCli style-create --root $ProjectRoot --preset fantasy-handpainted --reference work/input/style.png --rules game-ui-harnesses/ui-reference-harness/examples/style-rules.json --notes "主色使用蓝色，减少装饰"
# 或定制规则包，可单独使用、继承默认风格或附带主 PNG：
node $ReferenceCli pack-check --pack game-ui-harnesses/ui-reference-harness/examples/custom-style-pack.json
node $ReferenceCli style-create --root $ProjectRoot --pack game-ui-harnesses/ui-reference-harness/examples/custom-style-pack.json
node $ReferenceCli style-create --root $ProjectRoot --pack work/input/custom-ui.json --reference work/input/style.png
node $ReferenceCli style-show --root $ProjectRoot --style-sha256 STYLE_SHA256
node $ReferenceCli style-activate --root $ProjectRoot --style-sha256 STYLE_SHA256 --approval "用户对这份图片与规则的明确确认"
```

将命令中的 STYLE_SHA256、PLAN_SHA256、REQUEST_SHA256、IMAGE_SHA256、RAW_SHA256 和
runs/RUN_UUID 替换为对应命令实际返回值；确认文本来自人的真实决定。
激活前查看草案中的规则及图片实际内容。创建草案不会自动切换项目风格。
纯图片模式 `palette=null`，不伪造视觉分析；Agent 可先看图，再提出
[规则草案](schemas/style-rules.schema.json) 供用户审查。
新包的优先级：确认后的项目规则 → 完整解析后的 UI 包 → 主参考图。
--rules 会合并到最终 pack 并留下覆盖来源，不把冲突规则并列传给模型；未覆盖的字段仍由包冻结。
旧 v1 图片风格保留“文字规则 → 主图 → 旧指导板”优先级。每份风格最多一张用户主参考图。

定制包见 [示例](examples/custom-style-pack.json) 和 [schema](schemas/style-pack.schema.json)。
不继承时须填写全部 render_style 和 ui_rules；继承时可只覆盖部分字段，base_style 的 ID 和版本必须准确。
palette 可为 null，不伪造自动颜色提取。像素包固定逻辑像素单位及阴影色阶，实际视觉仍须人工检查。
可用 references.primary 指定包目录内的相对 PNG；与 --reference 二选一，禁止绝对路径、穿越和链接。
原包字节、继承包和图片进入不可变快照；随后修改外部文件不会改变项目。
只接受数据 JSON，不执行压缩包、脚本或路径指令。角色包须先适配为 UI 包，character_rules、提供商和运行配置字段均不接受。

## 六种默认样本

```powershell
node $ReferenceCli samples-prepare --output work/ui-style-samples
# 打开 work/ui-style-samples/style-review.md 查看六份完整规则、配色、摘要和同一个原型。
# 用户确认后，逐工作区 style-activate，真实确认文本可以对应同一次六份草案决定。
node $ReferenceCli samples-plan --root work/ui-style-samples
```

samples-prepare 创建六个独立项目，均为未激活草案，不记录人工决定、不生成图片。
samples-plan 要求六份指定风格已被确认、原型摘要相同且没有项目样板；只冻结六份计划，仍须各自的摘要绑定计算决定。
当前展示原型为 960×800，固定常规页、文案和值，含标题、页签、滑条、开关、下拉选择及主次按钮；不含素材图标或物品列表。
这些项目用于风格比较，每个项目只用一种风格。各图仍通过现有 review/export 流程验收交付。
六份真实样本已接受：四份原稿与两份下拉框修正版；图片单独保存在忽略工作区，不随源码发布。
不提供 --sample-catalog 时，目录 sample.status=not_generated 表示源码没有内置美术样本。
显式提供 catalog.json 后校验六份交付、ZIP、PNG／风格／原型摘要、画布和默认包版本，返回 accepted 样本。
style-create --preset ID --sample-catalog FILE 将该图片作为 primary-style 冻结进 v2 项目风格，
不会激活风格、生成图片或设置项目样板。与 --reference／--pack 互斥；可用 --rules 明确覆盖项目规则。
外部样本包改动不会影响已有风格；重新导入产生新的修订。catalog 自摘要证明完整性，不证明作者身份，须选择可信来源。
目录合同见 [sample-catalog.schema.json](schemas/sample-catalog.schema.json)。
准备失败保留已有草案，重新准备须使用新输出目录。

## 面板原型

```powershell
node $ReferenceCli import-panel --root $ProjectRoot --bundle work/input/panel.bundle.json
# 或使用公开程序夹具验证接入：
node $ReferenceCli import-panel --root $ProjectRoot --spec game-ui-harnesses/ui-panel-harness/examples/audio-settings.panel.json --catalog game-ui-harnesses/ui-panel-harness/catalog/modern-core.json
```

可附加 `--preview work/input/panel.png`，尺寸须与原型画布相同。截图来源由用户／宿主负责，
尺寸校验不证明视觉一致。原型会通过上游校验和重编译，再保存完整输入、可见结构和中性 PNG。
中性图表示可见矩形，准确文字在结构数据中，不宣称字体或原素材还原。
Tabs 只展示保存时的选中页；滚动视图使用顶部位置并记录裁切边界。
同 panelId 原型改变会取消当前交付选择，旧结果保留。

## 计划与一次生成

```powershell
node $ReferenceCli plan --root $ProjectRoot --panel audio-settings
# 默认 native；需要像素尺寸完全等于原型时显式使用 --resolution exact
# 可加 --note "突出已有的声音开关" 或 --intent game-ui-harnesses/ui-reference-harness/examples/intent.json
node $ReferenceCli inspect --root $ProjectRoot --run runs/RUN_UUID
node $ReferenceCli authorize --root $ProjectRoot --run runs/RUN_UUID --plan-sha256 PLAN_SHA256 --approval "用户针对这份计划的一次生图确认"
```

先查看 plan.json 的完整 prompt、图片顺序、逻辑画布、分辨率策略与摘要。每个生图计划只允许一次调用，
风格确认不包含计算授权。执行可任选一种方式：

默认 `--resolution native` 保留模型原生分辨率：短边至少 256、长边最多 4096 像素，
相对宽高比误差最多 1%。不裁切、补边、缩放或修改像素。
原型坐标仍以逻辑画布为单位，程序记录 `x × pixelWidth / logicalWidth` 和
`y × pixelHeight / logicalHeight` 的精确分数映射，验收时比较归一化布局。
这是整张画布的坐标变换，不证明模型实际把控件放在正确位置。
`--resolution exact` 则要求生成 PNG 与逻辑画布尺寸完全一致；策略在生图前冻结，不能事后改写。

```powershell
# 可选本地提供商适配器：
node $ReferenceCli generate --root $ProjectRoot --run runs/RUN_UUID --adapter work/provider-adapter.mjs
# 或宿主／Agent 工具交换：
node $ReferenceCli request --root $ProjectRoot --run runs/RUN_UUID
# 按返回的冻结 prompt 与有序图片调用一次外部图片工具，再接收结果：
node $ReferenceCli receive --root $ProjectRoot --run runs/RUN_UUID --request-sha256 REQUEST_SHA256 --image work/provider-result.png
```

适配器导出异步 generate(request)，返回 PNG Uint8Array，见 [合同](docs/contracts.md#生成交换与适配器)。
request 先保留不可复用的请求再返回输入；artifact 路径相对项目工作区。
宿主须原样转发 prompt 和图片顺序；本地回执绑定输入与结果，不能独立证明外部提供商服从请求。
超时或结果不确定时禁止重投：

```powershell
node $ReferenceCli stop --root $ProjectRoot --run runs/RUN_UUID --request-sha256 REQUEST_SHA256 --outcome indeterminate
```

已有 raw.png 可以 `finish --raw-sha256 RAW_SHA256` 重放确定性处理。inspect 提供原图摘要。
非法尺寸、透明、空白或损坏图片属于终止结果，不能用另一张图替换该尝试。

如果一张图仅因 `exact` 尺寸不符而被拒收，而用户已选择原生分辨率策略，可复用同一原图：

```powershell
node $ReferenceCli reprocess-plan --root $ProjectRoot --source-run runs/FAILED_UUID --raw-sha256 RAW_SHA256
node $ReferenceCli inspect --root $ProjectRoot --run runs/NEW_UUID
node $ReferenceCli reprocess --root $ProjectRoot --run runs/NEW_UUID --plan-sha256 NEW_PLAN_SHA256
```

这是新的本地处理计划，`maximumCalls=0`，不能 authorize/request/generate，也不需生图计算授权。
程序验证原计划、一次授权、请求、回执、失败状态与原图 SHA，复制完全相同的原图字节后只规范化 PNG。
旧失败记录不改写；新结果仍待人工验收。仅接受原型、风格和意图未改变、符合 native 技术门的尺寸拒收图；
不复用未知结果、透明／空白／损坏图或宽高比超限图，不串接复用来源链。

## 验收与交付

技术 QA 后仍是 pending_visual_review。展示 reference.png、原型和风格，由用户逐项决定：

```powershell
node $ReferenceCli review --root $ProjectRoot --run runs/RUN_UUID --image-sha256 IMAGE_SHA256 --layout pass --style pass --copy pass --decision accept --note "用户针对这张图的真实验收意见" --anchor false
```

三项均 pass 才能 accept。拒绝时 decision=reject，失败项传 fail。审查记录不可覆盖。
接受图片只更新该面板已接受版本，后续计划继续引用已确认的项目主参考。
已固定样板不可替换；改变样板需要新的风格修订。各计划记录是否附加样板。

同项目验证可使用已有设置展示原型及 [主菜单](examples/main-menu.panel.json)、[确认弹窗](examples/exit-confirm.panel.json)，
均经公开 ui-panel 编译器导入，统一 960×800 逻辑画布。任选面板生成，其他面板无需等待其验收；确认各份新计划共用同一 styleSha256 与 primary-style。
设定样板之前冻结的计划不会自动追加新样板；需要为后续面板创建新计划。

首图接受并选为样板后，可一次准备当前项目待生成面板的计划：

```powershell
$Batch = node $ReferenceCli plan-project --root $ProjectRoot | ConvertFrom-Json
node $ReferenceCli inspect-project-plans --root $ProjectRoot --batch $Batch.batch
```

默认跳过 `accepted_current_style`，包含未生成和需更新风格的面板；一次最多 64 个。
也可显式 `--panels main-menu,exit-confirm`，集合会标记子集；已接受面板的改进继续使用 optimize。
风格确认完整主参考后可直接冻结任意面板的计划，无需先验收代表图。
全部完成则返回 `nothing_to_plan`，不新增计划文件。

可选 `--intents FILE` 接收 [project-intents.schema.json](schemas/project-intents.schema.json)
描述的数组，每项是现有 `ui_reference_intent_v1`；只允许本次选中面板，panelId 不重复。
未提供意图的面板使用空备注；不能通过意图覆盖项目风格或改布局。`--resolution native|exact` 对集合统一生效。

命令在一个项目锁内校验全部请求，再写各份 plan.json、带摘要的集合 JSON 和评审 Markdown。
返回的 `batch`／`review` 为项目内相对路径，集合记录每份计划／请求／原型摘要及共同风格和样板摘要。
`inspect-project-plans` 重建每份请求并核对集合，返回当前上下文、运行时是否匹配，以及各计划已有状态。
集合不代替单份计算决定：展示完整请求后，仍按每个 planSha256 使用现有 authorize 和单次执行流程。
`computeCalls=0` 记录准备集合时没有计算，不代表后续各计划的执行状态；状态以 inspect 为准。
再次调用 plan-project 会创建新计划；不能用于自动重试或解除保留。写入中断可能留下未授权计划，
不会提交任何请求。流程接入顺序见 [宿主接入说明](docs/host-integration.md)。

关闭的 Select 只向生成提示词投影当前选中文案，明确单个字段、右侧向下箭头、隐藏候选项，
禁止变成并列按钮或展开列表。原始快照保留，不按选项数量或控件名字猜类型。
已有成图出现这类问题时，可创建绑定原成图的局部修正计划：

```powershell
node $ReferenceCli correct-select-plan --root $ProjectRoot --source-run runs/RUN_UUID --note "只修正下拉框，保留其余外观"
```

可用 `--targets select-node-id,another-select-id` 指定可见 Select，省略则选择源原型全部可见 Select。
来源须有完整技术结果，且仍与当前项目、原型、风格一致；尚未人工接受的成图也可作为编辑来源，
不会因此变成已接受样板。新计划附带 `correction-source` 原图快照及目标 ID，需要新的一次计算决定。
目前不串接局部修正来源链；修正计划也不能作为尺寸拒收的零调用复用来源。
提示词要求保留目标之外的外观；这不是逐像素不变保证，修正后仍须人工检查。

```powershell
node $ReferenceCli optimize --root $ProjectRoot --panel audio-settings --parent-run runs/RUN_UUID --note "在固定布局和风格内改善主按钮层级"
node $ReferenceCli status --root $ProjectRoot
node $ReferenceCli export --root $ProjectRoot --output work/my-game-ui-delivery
node $ReferenceCli validate --delivery work/my-game-ui-delivery
```

optimize 只产生新计划，需要新计算决定，不自动循环。换风格创建并激活新草案，旧图不改写，
status 标记 needs_style_update。整套导出默认包含所有注册面板，阻断混合风格、旧原型与未验收面板；
显式子集使用 `--panels audio-settings,another-panel`，manifest 准确披露范围。

交付包含 style.json、原始 UI 包／继承包 JSON、可选风格／样板图片、每面板 reference.png、中性图、可见结构、来源摘要、
handoff.json、manifest.json 和确定性 references.zip。输出须是新目录。
校验重放 ZIP 并核对文件集合、字节、摘要、尺寸和风格身份。
授权、审批文本、私有适配器、完整业务状态和提供商配置不进入交付。
v2 handoff 的 `canvas` 是实际 PNG 像素尺寸，`logicalCanvas` 是原型尺寸，`coordinateMapping`
记录二者的变换。provenance 同时记录策略和复用来源摘要；下游不可把逻辑尺寸当成图片尺寸。

下游现有 ui-layer-harness 直接接收 reference.png；未实现自动 handoff 导入。
下游默认移除普通业务文字，与这里保留文案的策略独立。统一风格和人工验收约束视觉一致性，
**不承诺跨面板控件逐像素一致**。

## 开发验证

```powershell
node --test game-ui-harnesses/ui-reference-harness/tests/*.test.mjs
```

测试只用自有程序图形、公开夹具和 provider doubles，不连接服务、不消耗 GPU。
项目写入串行持有 mutation.lock。异常退出遗留锁时，确认原进程停止并备份工作区后，
才显式移除锁文件；这不解除尝试的保留或终止状态。源码指纹变化后拒绝恢复旧计算任务。
已知 0.1.0 指纹支持只读检查和尺寸拒收原图接入；已知 0.2.0／0.3.0／0.4.0／0.5.0 的完整结果可继续人工审核、固定样板和导出。
旧计划均不能新增授权、派发或 finish；未知运行时指纹拒绝读取。旧记录不覆盖。

详细契约见 [docs/contracts.md](docs/contracts.md)，Agent 入口见 [SKILL.md](SKILL.md)。
