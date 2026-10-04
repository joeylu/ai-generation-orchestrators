# UI Panel Harness · 0.1.0

**状态：本地静态面板工作台 + 资源检索 + PanelSpec 0.5 容器布局、四类交互控件、只读文字与确定进度加载条。** 已实现需求上下文、Agent 方案校验、稳定 ID 局部修改，
以及严格 PanelSpec、文件式组件目录、确定性编译、状态投影和现有 Pixi 工作台预览。
自然语言可由对话中的 Agent 理解，也可通过本地工作台调用 Codex CLI 生成方案；
核心 `intake/check-plan/compile` 仍为确定性程序，不自行调用模型。
另提供原始纹理入库、统一矢量重绘、PNG 导出和按用途筛选的精选库，见 [纹理库说明](docs/texture-library.md)。
通用资源库已可通过 PanelSpec 0.2 绑定面板九宫格背景和静态行图标，随组件包内嵌 PNG。
`intake --assets` 可从需求检索有限资源候选；Agent 选材后，构建阶段复验完整资源库和候选快照。
新增 [Unity UGUI 导出适配器](docs/unity-export.md)：工作台直接下载 ZIP，或由 CLI 导出独立导入工具包，
由 Unity 编辑器生成真实 Prefab 和 `.unitypackage`。模型图像生成及 Cocos/Godot/UE 原生导出仍未实现。
带身份记录的新基准位于 `output/unity-managed-base-v1/`（43 项检查），更新样本位于
`output/unity-managed-update-v1/`（57 项检查），均通过 Unity 6000.3.7f1 验收。
原生包全部位于 `Assets/PanelHarness/`，共享 Runtime，各面板独立保存 Prefab、图片和复制后的字体。
交互使用原生 UGUI，附加脚本负责状态/事件、圆角外观及聚焦滚动。
Unity 适配器现为 0.1.2，支持精确同 Runtime 版本摘要绑定的显式更新，保留 Prefab 与原有组件引用；
安装预检拒绝脚本/GUID/旧版本冲突。旧 0.1.0 试用包不能自动作为更新基准。
使用方式和完整验证记录见 [Unity 导出](docs/unity-export.md) 与 [任务证据](docs/tasks.md)。

新增下拉选择、按钮和明确的“恢复默认”动作；状态导出后重开，仍能重置到 Spec 中的初值。
新增 [加载条](docs/panel-progress.md)：需求生成、百分比/数值显示、连续宿主进度、局部修改、组合与原生 UGUI Image 填充导出。新版使用 `examples/modern-mint-progress.catalog.json`；旧目录与协议继续复验。
使用 [控件示例与静态预览说明](docs/panel-controls.md) 生成可直接打开的预览目录，无需后台服务。
新增 [布局能力 v1](docs/panel-layout.md)：横排、纵排、双列及按声明画布宽度改单列，内容撑高与垂直滚动。
设置、暂停菜单、角色信息和窄画布样本位于 `examples/layout-v1/`，可交互演示入口为 `output/layout-v2/index.html`。

已有面板可用 [确定性组合器](docs/panel-composition.md) 合成新包：保留业务数据、当前试玩值和行图标，
按来源隔离控件 ID、宿主事件与恢复默认范围。支持单列、横排、双列和嵌套分组，同一面板可组合多次。
组合 API 与 CLI 不调用模型；来源、命名映射、资源去重及结果可完整重放校验。
真实生成和混合需求的评测流程见 [16 面板评测](docs/panel-evaluation.md)，执行证据见 [任务记录](docs/tasks.md)。

现在也可使用 [统一工作台](docs/workbench.md)：首页只突出需求描述、生成面板、修改要求和修改面板，
右侧为真实 Pixi 试玩。打开、导出、Unity 下载和撤销集中到「面板操作」；
规划文件往返、资源候选、属性/补丁和调试证据放在可主动打开的高级工具中。
Agent 有待澄清问题时，可逐项回答并重新准备上下文，保留原需求与旧预览；提交回答不自动调用模型。
已有面板也可填写自然语言修改要求，本地模式点击“修改面板”，取得有限补丁；
也可导出当前版本上下文，由对话 Agent 返回方案后导入。应用保留当前试玩值，新增字段
使用声明初值，并支持整批撤销，见 [自然语言编辑](docs/panel-editing.md)。
完整资源池随静态页面携带，支持离线检索；本地启动后可点击“生成面板”，
使用 `gpt-6-luna / xhigh`。静态页面也继续支持外部 Agent 文件往返。
当前加载条版产物为 `output/panel-studio-progress-v4/`，保持 `index.html` 与 `workbench.js` 一起使用；
直接生成须通过下述本地启动命令打开。最初的 `panel-studio-accepted` 保留作历史静态验收。
当前 Context 0.5 生成使用原生 PanelIntent 0.4；旧 Context 0.4 保持 PanelIntent 0.3。模型填写业务事实与就地嵌入的分组树，
程序生成状态、绑定、事件、精确原文区间、测量布局与公共提案的依据目标；
全部原有校验仍执行，文件导入和其他引擎格式保持原协议，见 [Codex 接入](docs/codex-planner.md)。
Codex 编辑返回受结构约束的 CodexEditDraft 对象；程序从逐字引句确定区间并生成公共 EditProposal，
避免手算字符位置和把整份补丁再转义成字符串。新增按钮文字与重置范围局部修改。
返回格式错误有单独诊断，原面板保留，失败不自动重试；用户后续提交的三项自然语言修改已取得
一次真实 `READY_TO_APPLY`，新增音效音量已在预览出现，原重置范围和当前试玩值保留。
新增 [16 面板首轮评测](docs/panel-evaluation.md)：固定自然语言需求与独立业务断言，
分开记录检索、真实模型方案、语义、编译和离线 Pixi 交互；不把程序夹具算作模型生成成功。
最终同一协议两轮完整生成 **32/32**、六份混合需求 **6/6**、五种实际来源组合 **5/5**，
共 **665 项 Pixi 交互检查通过**。统一入口为 `output/panel-stability-accepted-v1/index.html`；
完整报告在 `output/panel-stability-evidence-v1/`，历史失败保留，范围见 [任务证据](docs/tasks.md)。

所有新增源码、测试、文档及产物均在本目录内。通过只读开发适配器使用同仓库的
`ui-component-harness/src/`；没有复制或修改它的源码。本地 Codex 入口仅监听 `127.0.0.1`，
按本轮用户授权连接 CLI，不部署远程服务。
这是工作区开发集成，不是独立生产发行版。生产消费仍须使用经过摘要验证的不可变发布。

纹理选材推荐走 `intake → redraw → curate`：完整档案保留，精选库移出 4 张演示图、
17 张品牌图标和 18 张控件示意图，并省去它们独占的图片文件。保留的 262 条记录分为
116 个图标、133 个形状、6 个效果、2 个布局素材和 5 个动画拆件，预览按角色重新生成。
精选库普通检索默认只查图标；非图标通过 `search --role shape|effect|layout-primitive|animation-part`
指定用途。控件示意图片不是真实交互组件；精选库也不代表已实现原生引擎导出。
当前工作区已生成的选材入口是 `output/modern-mint-panel-core-v1/texture-catalog.json`，
实际验证记录见 [任务证据](docs/tasks.md)。`output/` 为忽略的本地产物，不属于源码发行内容。

## 补充自有资源

通用入口接受 PNG/SVG 和一份描述文件，无需修改 MUIP 重绘配方。可复制
[资源描述示例](examples/custom-assets/assets.json)，填写稳定 ID、版本、关键词、用途和尺寸。
在本目录运行（Sharp 无法直接解析时，加 `--sharp-module <已安装的模块目录>`）：

```sh
node scripts/assets.mjs import --manifest examples/custom-assets/assets.json --output output/custom-assets-v1
node scripts/assets.mjs verify --library output/custom-assets-v1
node scripts/assets.mjs search --library output/custom-assets-v1 --query 静音
node scripts/assets.mjs import --manifest examples/custom-assets/update.json --base output/custom-assets-v1 --output output/custom-assets-v2
node scripts/assets.mjs resolve --library output/custom-assets-v2 --key game-ui/mute@1.0.0
```

`--base` 也接受上述精选纹理库；首次迁移保留其 262 条资源，再追加描述文件中的新项。
后续追加使用新的通用库作为基库。已有版本保持不变，重复提交复用；同版本内容变化会被拒绝，
新版本与旧版本并存。普通检索默认选择最新版，精确引用仍可取旧版。
完整格式、SVG 支持范围及增量行为见 [通用资源导入说明](docs/asset-import.md)。

## 将资源接到面板

[资源面板示例](examples/audio-settings-assets.panel.json) 使用已迁移的通用库
`output/generic-library-migrated-v1`，配合 [浅色主题目录](examples/modern-mint-light.catalog.json)。
下面展示生成命令；输出目录必须是新的，已有同名示例产物时请换目录：

```sh
node scripts/assets.mjs search --library output/generic-library-migrated-v1 --query 静音
node scripts/cli.mjs compile examples/audio-settings-assets.panel.json --catalog examples/modern-mint-light.catalog.json --assets output/generic-library-migrated-v1 --output output/audio-settings-assets-final
node scripts/cli.mjs inspect output/audio-settings-assets-final/panel.bundle.json
```

首次选材编译需要已安装的 Sharp，无法直接解析时追加 `--sharp-module <已安装的模块目录>`。
Spec 锁定库 ID、摘要与精确资源版本；换库或增量导入后须显式更新对应引用。
仅打包实际选中的 PNG，去重后总计不超过 1 MiB；`inspect` 和 `restore` 使用内嵌资源，
无需原资源库或 Sharp。完整格式、规划和补丁约束见 [面板资源绑定](docs/panel-assets.md)。
该资源绑定阶段记录了 198 项测试通过、示例浏览器验收 13 项通过；离线恢复及旧 M2 包检查也已完成。
后续需求检索规划阶段已达到 224 项测试通过，完整需求到带图面板的浏览器检查也已通过，
入口与已验证示例见 [资源检索规划](docs/asset-planning.md)。
实际检查范围见 [任务证据](docs/tasks.md)，本地截图位于 `test-results/browser-assets-accepted/initial.png`。

## 快速开始

需要 Node >=22.18，且相邻 `ui-component-harness` 源码完整。本模块没有新增 npm 依赖。
在本目录运行：

```sh
npm test
node scripts/cli.mjs validate examples/audio-settings.panel.json
node scripts/cli.mjs catalog --query 音量
node scripts/cli.mjs compile examples/audio-settings.panel.json --output output/my-settings
node scripts/cli.mjs inspect output/my-settings/panel.bundle.json
node scripts/cli.mjs export-unity output/my-settings/panel.bundle.json --output output/my-unity-kit
```

已构建新版工作台后，启用直接生成：

```sh
node scripts/serve-workbench.mjs --workbench output/panel-studio-progress-v4 --output-root output/codex-runs --port 4188
```

打开命令打印的本地网址。模型固定为 `gpt-6-luna`、推理强度 `xhigh`，使用已有 Codex CLI
登录。每次点击提交一次；取消、失败和超时均不会自动重试。详见 [Codex 接入](docs/codex-planner.md)。

输出目录必须尚不存在，并位于本 Harness 内。拒绝目录覆盖、越界和符号链接/联接。
合同校验或编译错误发生时不创建交付目录；写入失败时目录可能不完整，只有最后写出的
`delivery.json` 中 `status: COMPLETE` 才表示离线交付完成。

## 从自然语言到面板

```text
原始需求 → intake：完整文本 + 锁定目录 + 检索候选
        → Agent：PanelSpec + 原文依据 + 设计选择 + 待澄清问题
        → check-plan：NEEDS_INPUT / READY_TO_COMPILE
        → build-plan：解析配方、布局校验、组件包与交付证据
        → 现有 Pixi 工作台：预览、操作、导出和恢复
```

1. 把需求保存为 UTF-8 文本，执行：

   ```sh
   node scripts/cli.mjs intake examples/audio-request.txt --id settings-request --output output/my-request
   ```

2. Agent 读取生成的 `planning-context.json`，按 [规划协议](prompts/panel-planner.md)
   编写 `proposal.json`。完整需求最多 8000 个 Unicode 字符；长文本分窗检索，原文不截断。
   候选是词法相关度，不是概率。所有摘要由程序生成，不让 Agent 猜测。
3. 检查并编译：

   ```sh
   node scripts/cli.mjs check-plan output/my-request/planning-context.json --proposal output/my-request/proposal.json
   node scripts/cli.mjs build-plan output/my-request/planning-context.json --proposal output/my-request/proposal.json --output output/my-plan
   ```

提案包含一个完整 Spec 或 `null`。存在任何 `unresolved` 项都会阻止 build；Agent 应把
未支持控件、开关含义、必要初值等问题明确列出。主题和布局可作为有理由的设计选择。
程序不能自动发现 Agent 遗漏的歧义，也无法判断引句是否足以支持每个业务值。
原文依据使用 UTF-16 半开区间，检查通过只证明引句存在；`semanticReview` 始终为 `NOT_RUN`。
`READY_TO_COMPILE` 表示可交给编译器，几何和浏览器仍可能失败，不表示视觉验收。
需要资源候选时，在 intake 追加 `--assets <资源库目录>`，可选 `--asset-style <风格>`，得到
context 0.2；使用新增控件目录时则为 context/proposal 0.3。Agent 从对应槽位候选填写 Spec 的资源引用，并为整体 `assets`、
所选 `asset:surface` 和每个 `asset:row:<rowId>` 提供依据。每槽位最多 16 个实际 key，总计 32 项。
程序检索候选，Agent 根据完整需求选材；零命中不自动补图或忽略需求。

`check-plan` 保留 `assetEvidence.libraryVerification: REQUIRES_BUILD_VERIFICATION`；
`build-plan --assets <资源库目录>` 复验全库并重算、比较整个候选快照，另写构建核验报告。
intake/build-plan 需要已安装的 Sharp，必要时加 `--sharp-module`；离线检查不用读取图片。
完整命令见 [资源检索规划](docs/asset-planning.md)。旧 context 0.1/proposal 0.1 继续兼容手动填写
PanelSpec 0.2 及整体 `assets` 决策，其资源由编译阶段验证，不声称经过新候选约束。

合同见 [PanelRequest](schemas/panel-request.schema.json) 和
[PanelProposal 0.1](schemas/panel-proposal.schema.json)、[PanelProposal 0.2](schemas/panel-proposal-v0.2.schema.json)。真实 Agent 方案标为 `agent-authored`；
新控件使用 [PanelProposal 0.3](schemas/panel-proposal-v0.3.schema.json)。带 `text-row` 的布局目录启用
[PanelProposal 0.4](schemas/panel-proposal-v0.4.schema.json)，支持布局树与只读文字；旧目录的上下文摘要保持兼容。
测试样本标为 `programmatic-fixture`。用户手写 Spec 仍可通过直接 compile 处理。
组件核心沿用 `user-provided` 表示调用方提交的外部文档，附固定 Agent 来源说明；
完整真实来源、描述与假设保存在外层 PanelBundle，绝不视为用户批准。

## 局部修改

build-plan 同时输出 `panel.spec.json`。先执行 `validate` 取得它的 `specSha256`，
再按 [PanelPatch](schemas/panel-patch.schema.json) 编写补丁：

```sh
node scripts/cli.mjs validate output/my-plan/panel.spec.json
node scripts/cli.mjs patch output/my-plan/panel.spec.json --patch output/my-patch.json --output output/my-plan-edited
```

支持修改面板标题、主题、完整布局、行标签、启用态、状态初值，以及增删设置行。
操作按稳定 ID 定位，不使用数组下标。补丁绑定原 Spec 摘要，旧版本补丁不能套到新方案；
重复写同一属性、增删与其他写入冲突都会拒绝。添加状态行须同时提供新的状态字段；按钮和 0.4 只读文字提供 `state:null`。
删除行同时删除它绑定的字段及 0.2 中该行的图标引用，不能悄悄删除空分组。
0.2 的 `patch` 也需 `--assets`，必要时加 `--sharp-module`；若删除后不再有任何资源选择，
会拒绝违反 0.2 非空约束的结果。需显式重写 Spec，不能靠补丁自动退回 0.1。
整批修改和最终目录/布局都通过后才发布新目录，保留补丁与程序生成回执。
回执的 `changedRowIds` 记录行定义或绑定字段变化，不表示所有受主题/布局影响的绘制节点。
patch 操作面向创作源，采用 Spec 初值；运行中的玩家状态需要通过 restore 显式提供完整快照。

## 复现 M2 演示

以下命令使用固定的程序测试样本，证明协议和编译链，不宣称 CLI 理解了任意自然语言。
每次请选择尚不存在的输出目录：

```sh
node scripts/write-planning-fixtures.mjs --output output/demo-inputs
node scripts/cli.mjs check-plan output/demo-inputs/ambiguous-context.json --proposal output/demo-inputs/ambiguous-proposal.json
node scripts/cli.mjs build-plan output/demo-inputs/context.json --proposal output/demo-inputs/proposal.json --output output/demo-panel
node scripts/cli.mjs patch output/demo-panel/panel.spec.json --patch output/demo-inputs/patch.json --output output/demo-edited
```

含糊请求返回 `NEEDS_INPUT`；明确样本生成音量/声音开关；补丁把音量改为主音量，
增加独立的背景音乐音量，保留已有 ID 和绑定。真实需求请走上述 Agent 规划过程。

## 产物与预览

| 文件 | 用途 |
| --- | --- |
| `panel.bundle.json` | 包含 PanelSpec、目录快照、当前状态、绑定与组件包；有图时含精确资源记录，0.3 另含动作 |
| `component.bundle.json` | 既有 UiBundle，0.2 资源面板的 PNG 内嵌其中，可交给现有工作台导入 |
| `delivery.json` | 程序生成的完成记录和所有列出附件的实际文件字节 SHA-256 |

build-plan 另附原始规划上下文、方案、规划检查报告与可编辑 Spec；context 0.2 还附
`asset-build-verification.json`，保留规划检查与实际资源库复验的不同证据范围。patch 另附新 Spec、
补丁和回执。编译包中的验收状态与浏览器独立报告分别保存。

在已经启动的 UI Component 工作台中导入 **component.bundle.json** 查看真实 Pixi 组件。
不要把 PanelBundle 信封直接送入它的严格组件导入器。
打开工作台、导入文件不会调用模型。此模块不负责启动或重启共享服务。

已有本地预览服务及相邻项目的 Playwright/Edge 时，可执行独立验收客户端：

```sh
node scripts/check-browser.mjs --bundle output/my-settings/panel.bundle.json --url http://127.0.0.1:4173/ --output test-results/my-settings
```

该客户端只连接已存在的 loopback 工作台，禁止非本地浏览器请求，不安装浏览器、
构建相邻工程或修改服务。它核对服务字节与相邻 `dist` 文件；这不等于断言所有当前
源码都对应该构建。截图、服务构建摘要及实际断言结果保存在指定新目录。
当前验收场景要求至少一个启用的 Slider 和初值为 true 的 Switch；额外 Slider 会检查
独立变化事件和其他字段不变。此场景不代表所有任意面板都得到通用验收。

## 当前支持的面板

- 单个固定参考画布；0.1–0.3 纵向分组，0.4 支持横排/纵排/双列容器、对齐和垂直滚动。
- Slider 行：标签、数值范围/步长、独立数值文字与格式。
- Switch 行：标签、布尔状态与明确的宿主事件名。
- Select 行：有限枚举选项、语义值与明确的宿主事件名。
- Button 行：只发事件，或恢复指定字段到创作初值；需面板会话接线。
- Text 行（0.4）：静态标签与内容，不伪造状态或交互事件；支持空状态的纯按钮菜单。
- 自有 `modern-dark` 主题和 4 个基础配方，另附 `modern-mint-light` 主题与 6 配方控件目录；无 MUIP 运行时依赖。
- 0.2 显式绑定面板九宫格背景与静态行图标；背景拆为最多 9 个 Image 区域，图标带主题色徽章底。
- intake 可固定资源库并按完整需求检索图标/背景候选，Agent 方案受槽位、精确 key 与库摘要约束，构建时重算候选。
- 中文/英文文本目录检索；先过滤类型和目标，再排序，零相关度不返回随意候选。
- 明确的初值、完整状态恢复、精确版本引用、未解析引用拒绝、重新编译校验。

资源库支持 PNG/SVG 入库；面板使用其中选定的 PNG。字体入库与向量检索尚未实现。
图片不随主题染色，行图标不随开关或其他状态切换；动态图标、原生九宫格组件和任意控件皮肤仍未实现。
字体使用明确的系统 `sans-serif` 字体族，未嵌入字体文件，不宣称跨设备字体一致。
固定画布缩放不代表响应式重排。文字宽度由真实 Pixi 渲染验收，离线结构通过不代表文字一定放得下。
动效、任意脚本、通用表达式、多控件共享同一状态字段不在当前实现范围。

## PanelSpec 与绑定

原合同见 [0.1 schema](schemas/panel-spec.schema.json) 和
[audio-settings.panel.json](examples/audio-settings.panel.json)，保持向后兼容且不接受 `assets`。
资源绑定合同见 [0.2 schema](schemas/panel-spec-v0.2.schema.json) 和 [资源绑定说明](docs/panel-assets.md)。
下拉与按钮合同见 [0.3 schema](schemas/panel-spec-v0.3.schema.json) 和 [控件说明](docs/panel-controls.md)。
容器布局与静态文字合同见 [0.4 schema](schemas/panel-spec-v0.4.schema.json) 和 [布局说明](docs/panel-layout.md)。
运行时验证器还检查状态引用、类型、步长、ID/事件唯一性等 schema 无法独立覆盖的约束。
主题和行配方按 ID + 精确版本解析；0.1 的面板/分组布局实现固定使用
`settings.panel@0.1.0` 与 `settings.section@0.1.0`，同样进入选择记录。

0.1 示例的显式业务约定：音量为 0–100 整数；开关代表“启用声音”；关闭不清空音量，
调整音量也不自动开启声音。初值 80/true 是程序夹具数据。
拖动过程中更新可见数值，释放指针或键盘步进时提交状态；初始化和恢复不模拟用户操作。
实际声音、存档与音频 API 单位换算由宿主负责。

`src/state.mjs` 提供：

- `projectPanelEvent(spec, state, runtimeEvent)`：纯函数，校验已提交值并映射明确的宿主事件；
  `source: control` 更新状态但不派发用户事件，避免程序设置反馈循环。
- `attachPanelSession(spec, treePreview, onEvent)`：绑定已加载的 TreePreview，读取实际状态，
  提供 `getState` / `setState` / `destroy`。调用者保留渲染器生命周期所有权。

现有工作台独立导入组件包时验证组件交互；宿主业务接线仍由集成者显式完成。
动态 `setEnabled` 是组件运行时状态，工作台组件快照可以保存它；面板状态快照只保存
声明的数据字段。想改变面板方案中的启用策略，应修改 PanelSpec 再编译。

## 保存当前状态

写一个完整状态文件，例如：

```json
{ "volume": 35, "audioEnabled": false }
```

```sh
node scripts/cli.mjs restore output/my-settings/panel.bundle.json --state my-state.json --output output/my-settings-restored
```

新包保留原始创作初值，单独记录当前状态并重新编译。缺键、额外键、`null`、越界或
不满足步长的值都会失败。`inspect` 会用内嵌 Spec/目录重新编译并比较结果，
因此仅修改摘要无法掩盖与源方案不一致的组件树。
PanelBundle 的 `sha256` 是不含自身的规范 JSON 内容摘要；交付清单则校验实际文件字节，含结尾换行。
这些摘要用于一致性校验，不代表数字签名或作者身份认证。

## 验收和后续

本次已执行证据见 [tasks.md](docs/tasks.md)。编译包中的浏览器、人工视觉与原生引擎
验收始终标为 `NOT_RUN`；另行执行的浏览器报告只证明该输入在记录构建中的实际检查。
不可用结构测试或截图自动宣称用户视觉确认、真实音频接入或其他引擎支持。

需求、方案、布局、当前预览和 Unity 导入工具包下载已接到统一静态工作台。
后续可继续补充真实需求样本与其他引擎适配器；
向量检索、原生编辑反向同步仍未实现。原生验收范围见 [任务证据](docs/tasks.md)。
长期方向保留在 [原始设计草案](docs/design.md)，其阶段状态以本 README 和实际验收记录为准。
