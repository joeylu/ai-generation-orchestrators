# UI Panel Harness · 0.1.0

从自然语言需求生成可交互的游戏UI面板：检索自有PNG/SVG资源，校验结构化方案，由确定性程序编译引擎无关的PanelSpec，使用Pixi预览并导出交付包。
第一版以Web/Pixi为主要验收入口，提供Unity UGUI导入工具包；无MUIP运行时依赖。

## 从这里开始

- [使用与启动](docs/start-here.md)：构建 Studio、生成、修改、试玩、撤销和下载。
- [文档索引](docs/index.md)：按生成编辑、资源交付和历史验收查阅。
- [目录与依赖边界](docs/structure.md)、[命令索引](docs/commands.md)：维护入口及只读依赖预检。
- [本次源码收尾](docs/studio-closeout-2026-10-10.md)：菜单默认、编辑体验、本机任务及当前验收。
- [此前源码检查点](docs/v1-candidate-2026-10-08.md)：此前版本的范围与验收记录。
- 本地第一版交付目录（本地产物：`output/ui-panel-closeout-v1/index.html`）：历史面板、组合和修改预览；本地产物不随 Git 提交。

日常运行 `npm run studio`，固定入口 `http://127.0.0.1:4951/`；检查、构建、启动一次完成。
同地址重启保留本机草稿、面板、试玩值和轮次，页首显示构建版本。见[日常启动](docs/studio-start.md)。
旧静态页面不会自动更新。

## 当前能力

当前 Studio 支持「新建面板」和历史恢复，澄清回答可一次点击直接提交；普通编辑保留素材、绑定与试玩值，最多成功修改10轮。已修复单按钮菜单的分组高度错误及响应正文读取失败提示。当前完整本地回归1418项通过，详情见[收尾说明](docs/studio-closeout-2026-10-10.md)。

最新将[纯文字菜单默认样式](docs/menu-defaults.md)接入日常生成：单组菜单采用完整中性底板、居中标题及280×48px按钮列；设置、表单、弹窗及Tabs保留原基础样式，旧面板不自动升级。1339项回归、15组浏览器检查、3份实际ZIP离线往返和7份旧包重放通过；默认落地阶段模型调用0，用户美术验收待定。

随后完成[新默认单次真实复验](docs/menu-defaults-real-results-2026-10-09.md)：1次gpt-6-luna/xhigh、零重试，未增加额外小标题，实际采用新默认比例与配色；5组浏览器及1份实际ZIP离线往返通过。原方案未改写，用户美术确认仍待定，授权已消费。

设计仍采用[分类型排版参考](docs/visual-baseline.md)：声音设置保留用户反馈改善的对齐版，暂停/退出回到紧凑试稿之前的版本。最近的[暂停与退出试稿](docs/compact-actions-study.md)被反馈不如上一版，不作为后续基线；历史样本与技术报告保留。

[分类型构图原则](docs/composition-planning.md)已接入原有生成和编辑提示：文字/局部编辑保留现有构图，用户明确布局要求优先，1324项本地回归通过；不改写保存包或默认主题，真实模型的理解与美术效果未在本轮复验。

随后完成[暂停菜单单次真实生成](docs/composition-real-pause-results-2026-10-09.md)：1次调用、零重试，业务/编译、5组浏览器与1份实际下载ZIP离线检查通过。右侧真实生成仍比旧精修样本松散，额外分组小标题与默认样式差距未修补；用户视觉验收待定，本次授权已消费。

最新[声音设置对齐与间距](docs/audio-aligned-layout.md)试稿整理标签/滑轨起点、数值/开关/保存右边界与底部操作层级，沿用Noto及线条图标。入口 `output/audio-aligned-review-v4/review/index.html?panel=audio-dark`，浅深色可前后试玩；24组浏览器检查、两份实际下载包离线往返通过，默认未切换。

| 能力 | 说明 |
| --- | --- |
| 控件 | Slider、Switch、Select、Button、静态Text、Progress、单行Input |
| 主题 | 浅色／深色 × 薄荷绿、蓝、紫、橙；在需求描述中指定 |
| 自定义样式 | 已生成的modern-v3面板可编辑不透明颜色与统一圆角；生成仍使用预设主题 |
| 布局 | 横排、纵排、双列、嵌套分组、垂直滚动、2–8页签Tabs |
| 面板尺寸编辑 | 已生成的modern-v3面板支持精确比例和固定宽高；画布同步调整，过小尺寸整批拒绝 |
| 局部修改 | 默认值、名称、启用状态、范围、输入约束、有限增删、重置/提交字段和布局；存活试玩值保留 |
| 撤销/文件往返 | 整批撤销恢复修改前规格与试玩值；PanelBundle可以导出后重新打开 |
| 资源 | PNG/SVG增量入库、语义标签与文本排序、精确版本引用、选材摘要绑定、PNG内嵌 |
| 组合/宿主 | 确定性组合器、实例隔离、显式事件及业务端口绑定 |
| Web交付 | 离线Pixi预览、可挂载适配器、字段/事件接线说明 |
| Unity交付 | 原生UGUI控件、共享状态/事件适配脚本、Prefab与unitypackage的编辑器导入工具；统一Assets/PanelHarness目录 |

Studio首页保留需求描述、生成按钮、修改要求和修改按钮；右侧是实际Pixi交互预览。
新生成默认目录为 `modern-menu`，在[简约面板美术 minimal-v1](docs/panel-minimal-art.md)基础上仅增加[纯文字菜单精修](docs/menu-defaults.md)；旧面板保持原目录和主题。新增[24种输入场景](docs/input-coverage-v2.md)为夹具覆盖，真实理解效果未新验收。下列美术试稿记录中的“未改默认”描述其各自执行时状态。
用户认为该版美术仍一般；最新[声音设置美术试稿](docs/crafted-audio-study.md)参考Impeccable，提供薄荷紧凑、温润留白、横向分栏三款可试玩候选及浅深色切换。首稿获“有好一些”反馈，尚未选定或替换日常默认主题。
上述三款是视觉变体；[不同 Skill 独立对照](docs/art-skill-comparison.md)现已完成 frontend-design / Taste / Impeccable 三次独立真实调用，6份浅深色结果及20组汇总检查通过。入口 `output/skill-art-real-v2/review/index.html`，先匿名比较、可显示名称；未设为默认主题，审美效果待用户选择。此前schema失败原记录保留。
用户认为三种结果基本相同，继续提出布局与Apple方向；新增[Apple风格分组布局试稿](docs/apple-grouped-layout.md)，将音量、静音与恢复默认分组，提供浅深色实际Pixi与离线包。入口 `output/apple-grouped-audio-review-v3/review/index.html`；本轮模型调用0，未设为日常默认。
用户反馈分组稿的图标与底色组合不好看；新增[无底色图标精修试稿](docs/plain-audio-icons.md)，重画三个声音图标、统一线宽与留白，原布局与业务保持。入口 `output/apple-line-icons-review-v1/review/index.html`，浅深色可切换原稿对比；模型调用0，未改默认。
随后针对滑块不清楚的问题，补充[圆钮与轨道清晰度修订](docs/slider-clarity.md)，入口 `output/slider-clarity-review-v2/review/index.html`；保留上一版直接对比，未改图标和业务。
最新针对布局零散的反馈提供[连续布局试稿](docs/audio-flow-study.md)，将声音控件合为一组，底部操作对齐，保留当前字体和控件美术；入口 `output/audio-flow-review-v1/review/index.html`，可切换上一版比较，默认未更换。
沿用这一方向提供[Apple风格多面板样本](docs/apple-panel-samples.md)：主菜单、暂停、画质设置、角色信息、退出确认，共10份浅深色候选，与原简约版并排对照、试玩及下载。入口 `output/apple-panel-samples-v3/review/index.html`；1267项回归、50组浏览器检查、10份实际ZIP离线往返和24份旧包严格重放通过，模型调用0，默认未切换。
退出确认已恢复完整圆角底板，最新入口 `output/apple-panel-samples-v4/review/index.html`。仅两份退出候选外观改变，其余8份候选与所有原对照保持；15项对应回归与新50组浏览器/实际ZIP检查通过，原v3保留。
针对仍显简陋的反馈，另提供[退出确认细节精修](docs/apple-dialog-polish.md)，入口 `output/apple-dialog-polish-v2/review/index.html`：当前版与紧凑精修的浅深色直接对照，调整比例、文字层级、细边线和轻量投影；17项对应回归与10组浏览器/实际ZIP检查通过，默认及其他面板未改。
最新[Apple风格整套精修](docs/apple-suite-polish.md)包含主菜单、暂停、声音、画质、角色信息及退出确认，共12份浅深色候选；入口 `output/apple-suite-polish-v2/review/overview.html` 可进入前后试玩对比。统一完整底板、文字层级与按钮比例，保留清晰滑块和退出精修；31项对应回归、66组浏览器检查、12份实际下载ZIP往返和24份源包重放通过，模型调用0，默认未切换。
另提供[字体对比](docs/apple-typography-study.md)，入口 `output/apple-typography-review-v2/review/index.html?panel=audio-dark-noto`：中文Noto Sans SC/等线与当前字体在三类浅深色面板中对照，字号、字重与布局保持；43项对应回归、76组浏览器检查及12份实际下载包往返通过。使用本机已有字体，未内嵌，默认未切换；首轮字体槽溢出FAIL与高DPI清晰度边界保留记录。
打开、下载和撤销位于「面板操作」，规划/资源/属性及调试工具折叠在「高级工具」。
Studio的modern-v3生成运输格式为PanelIntent 0.10 / PlanningContext 0.9，静态正文可直接多段换行；编辑为CodexEditDraft 0.3。已保存协议继续按其版本严格校验。
modern-v3 的新编辑使用 EditContext 0.14，可选择单控件，并独立核对明确的属性、[精确按钮文案](docs/button-copy-checks.md)、[同名按钮分组定位](docs/scoped-button-copy.md)与完整指定的修改范围；统一自定义样式使用 Spec/Bundle 0.8，同组按钮排列使用 0.9，单按钮样式使用 0.10，独立按钮文字／符号字号使用 0.11 与编译器 0.11.0；标题对齐与底板使用 0.12 与编译器 0.12.0；正文换行使用 0.13 与编译器 0.13.0；面板比例与固定尺寸使用 0.14 与编译器 0.14.0；保存的旧上下文和交付包保持原版本。详见[独立字号](docs/panel-button-font.md)、[正文换行](docs/panel-text-wrap.md)、[面板比例](docs/panel-frame.md)、[组合布局编辑](docs/panel-layout-details.md)和[修改结果核对](docs/panel-edit-request-checks.md)。
核心检索、结构、状态、布局、校验及打包不依赖模型提供方，可选本地Codex适配使用`gpt-6-luna / xhigh`。

## 验收证据

| 验收 | 已执行结果 | 说明 |
| --- | --- | --- |
| [16类两轮真实结果](docs/panel-title-stability-results-2026-10-06.md) | 32份真实来源、每轮5种组合、898项浏览器检查、42份实际ZIP离线往返 | 新v2期望显式接受画质grid外的等价单子column；原批31/32及FAIL保持 |
| [10步真实连续修改](docs/edit-chain-results-2026-10-06.md) | 10/10、123项浏览器检查、10份实际ZIP及逐步/整链撤销 | 实际10次、无重试，仅最新声音来源的固定修改链 |
| 授权前单元回归 | 727/727 | 测试使用夹具/替身，不提交模型请求 |
| [视觉主题优化](docs/panel-visual-style.md) | 734项回归、518项浏览器检查、24份实际ZIP离线往返 | 保存的16份真实面板换主题、3份程序夹具及5种组合；本轮新增模型0 |
| [浅深模式与四主色](docs/panel-themes.md) | 749项回归、701项浏览器检查、32份实际ZIP离线往返 | 八主题夹具与保存结果重编译；本轮新增模型0 |
| [按用途排版](docs/panel-presentation.md) | 764项回归、443项浏览器检查、26份实际ZIP离线往返 | 表单、对话框、菜单、设置与组合夹具，修复连续中文输入；本轮新增模型0 |
| [用途排版真实复验](docs/visual-smoke-acceptance.md) | 5/5真实调用、五份390宽度布局、实际ZIP校验及重导入 | 无重试；769项回归证据绑定该批次源码，窄屏仅检查可见布局 |
| [按用途选图真实验收](docs/asset-usage-real-acceptance-2026-10-09.md) | 4份真实结果、19项页面检查、4份实际下载ZIP离线打开及无图库重导入 | 1170项回归与84项夹具浏览器检查；首次标签误判FAIL保留，原结果确定性复核；最后3次调用通过 |
| [声音设置美术试稿](docs/crafted-audio-study.md) | 1226项回归、8组浏览器检查、2份实际ZIP下载与离线打开 | 候选编译器0.20；一个面板浅深色，用户美术未确认，模型调用0，Unity原生NOT_RUN |
| [声音设置三款候选](docs/crafted-audio-study.md) | 25组浏览器检查、6份实际ZIP下载与离线打开、4项对应回归 | 保留A原包，新增B/C；复用0.20，未改生产源码；新增模型调用0，未美术定稿 |
| [简约面板美术](docs/panel-minimal-art.md) | 1222项回归、86项面板浏览器检查、17项旧面板编辑检查、12屏美术总览 | 编译器0.19；用户认为仍一般，模型调用0，Unity原生NOT_RUN |
| [面板视觉与输入覆盖](docs/panel-refined-surface.md) | 1209项回归、84项视觉夹具浏览器检查、17项新构建编辑旧面板检查 | 新主题为0.18；新增24输入场景为程序夹具，新增模型调用0，Unity原生NOT_RUN |
| [原生Unity接入](docs/unity-game-integration-acceptance-2026-10-06.md) | 先前隔离环境的UGUI与宿主业务验收 | 不替代上述最新批次的原生验证，普通下载包仍标NOT_RUN |

这些成绩只证明报告中指定的请求、构建和来源。程序夹具、保存结果重放、原生引擎和人工视觉分别记录；历史失败不回填为成功。
最新生成及修改包的Unity原生导入本轮未运行，Cocos/Godot/UE适配尚未实现。

## 快速构建

需要Node >=22.18和同仓库`ui-component-harness`源码；已安装的Vite/Pixi/Playwright版本由[开发依赖合同](src/workspace/requirements.mjs)明确限定。预检不会安装依赖或调用模型。
日常从本目录运行 `npm run studio`，按 Ctrl+C 停止；再次运行会构建新版本，并沿用固定地址。
在`ui-panel-harness`目录运行；输出目录必须不存在：

```sh
node scripts/check-workspace.mjs
node --test tests/*.test.mjs
node scripts/cli.mjs validate examples/audio-settings.panel.json
node scripts/build-workbench.mjs --catalog examples/modern-menu.catalog.json --assets builtin --output output/my-studio
node scripts/serve-workbench.mjs --workbench output/my-studio --output-root output/my-codex-runs --port 0
```

构建和启动不会调用模型。直接打开静态`index.html`可以导入、试玩和导出；点击生成/修改须使用本地服务打印的网址，并先安装、登录Codex CLI。
每次点击最多提交一次调用；失败、取消、超时或结果不确定后不自动重试。批量真实验收必须事先冻结计划并取得该摘要的单次授权。
需要完整自有资源池时，构建命令加`--assets <已验证资源库目录>`；Sharp无法直接解析时再加`--sharp-module <已安装的模块目录>`。
资源目录和本机CLI/模块路径只作为显式本地输入，不进入公共面板包。

## 文档入口

- [通用资源增量导入](docs/asset-import.md)、[纹理重绘与筛选](docs/texture-library.md)、[面板选材](docs/asset-planning.md)、[按控件用途选图](docs/asset-usage.md)
- [布局](docs/panel-layout.md)、[进度条](docs/panel-progress.md)、[Tabs](docs/panel-tabs.md)、[输入表单](docs/panel-forms.md)
- [自然语言编辑](docs/panel-editing.md)、[Codex接入](docs/codex-planner.md)、[PanelSpec/事件映射](schemas/panel-spec-v0.7.schema.json)
- [确定性组合](docs/panel-composition.md)、[多面板宿主](docs/panel-host.md)、[Web业务绑定](docs/game-binding.md)
- [面板交付包](docs/panel-delivery.md)、[Unity导出](docs/unity-export.md)、[Unity业务SDK](docs/unity-game-binding.md)
- [16类评测方法](docs/panel-evaluation.md)、[修改链计划](docs/edit-chain-plan-2026-10-06.md)、[完整历史证据](docs/tasks.md)

## 交付边界

本版是同仓库的工作区开发集成，尚未发布独立生产SDK。生产消费仍需另行发布并核验不可变标签和摘要。
固定画布缩放与有限布局规则不能替代任意响应式设计；未嵌入字体，不保证跨设备字形一致。
矢量检索、动态图标、任意控件皮肤、任意脚本/表达式、嵌套Tabs和其他引擎适配不在第一版范围内。
Studio每个面板最多成功修改10轮，失败、澄清与无需修改不计数；撤销、恢复旧版本和同地址重新打开同一面板不返还轮次，成功生成新面板后重新开始。高级属性和补丁入口共用上限；达到上限仍可试玩、撤销和导出，无redo。Studio自动保存需求/修改草稿、轮次、最近面板和试玩值，跨刷新最多保留8个面板版本；容量不足时减少旧版本。入口在「面板操作 → 历史版本与本机存档」。记录仅限当前浏览器与地址，长期备份仍应导出；撤销栈、未完成的生成和方案上下文不跨刷新恢复。详见[Studio本机保存](docs/studio-storage.md)。
默认值存于PanelSpec，试玩值存于PanelBundle，恢复默认才应用创作初值。
`output/`、`.tmp/`、浏览器结果和模型运行记录保持为忽略的本地产物；源码提交不包含机器配置、认证文件或临时代理设置。
