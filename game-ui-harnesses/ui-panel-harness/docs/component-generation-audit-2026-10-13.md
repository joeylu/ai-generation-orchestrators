# 2026-10-13 Panel 自动生成组件接手审计

> 本文保留接手时、实现前的审计快照。缺口已在同日补齐；当前能力、范围和验收见 [16 种组件自动生成合同](all-components.md)。以下结论仅描述修改前状态。

结论：当前工作树没有将 Component 的 16 类节点全部接入 Panel 自动生成。Panel 原生生成合同只有 8 种内容行；Tabs、Container、ScrollView 通过受限布局合同接入；面板本体使用 Container 实现。CheckBox、RadioGroup、List、Dialog 尚未接入。

这是当前工作树审计，不是固定发布附件、运行中的 Studio、真实模型理解或 Unity 原生验收。审计仅新增本文，未修改运行代码或调用模型。

## 16 类逐项核对

| Component 类型 | Panel 自动生成入口 | 实际状态与边界 |
| --- | --- | --- |
| Image | `image` 内容行 | 已接入静态图片及缺图占位；固定素材身份，非图片生成、图库选择或可点击图片 |
| Text | `text` 内容行 | 已接入静态文字及换行；不是任意动态文字绑定 |
| Container | `column` / `row` / `grid` / `section` | 编译器创建容器；不接受任意 Component 树 |
| Panel | PanelSpec 整体面板 | 有面板功能，但编译结果的面板本体为 `Container`，没有生成底层 `Panel` 节点 |
| Button | `button` 内容行 | 已接入 emit、指定字段 reset-initial、输入 submit；具体业务由宿主绑定 |
| Switch | `switch` 内容行 | 已接入布尔状态、事件、编辑与保存 |
| CheckBox | 无 | 未接入；Switch 不等价于 CheckBox |
| RadioGroup | 无 | 未接入；Select 不等价于 RadioGroup |
| Input | `input` 内容行 | 已接入单行文本/密码、必填、长度、只读；不是任意表单控件 |
| Select | `select` 内容行 | 已接入下拉选择、枚举状态与默认值 |
| ProgressBar | `progress` 内容行 | 已接入只读进度，由宿主更新；不是自动运行的下载任务或不确定进度动画 |
| Slider | `slider` 内容行 | 已接入范围、步长、初值、数值事件 |
| ScrollView | 布局溢出策略 | 编译器产生垂直滚动，支持 Tabs 页内溢出；不是任意嵌套/双轴滚动树 |
| List | 无 | 未接入数据项、模板、选择状态或动态列表绑定；纵排多行不是 List |
| Dialog | 无 | 未接入 open/close、模态阻挡及生命周期；确认面板外观不是 Dialog |
| Tabs | `tabs` 根布局 | 已接入 2–8 页签、当前页、事件、保存/导出；不能嵌套，编辑不开放增删重排页签 |

按功能映射可以描述为“8 种内容行 + 4 种面板/布局能力 + 4 种缺口”；按底层节点身份则只有 11 种类型进入当前 Panel 编译/UGUI 白名单，另有 Panel 被 Container 实现。两种口径都不能称为 16/16。

源码依据：

- Component 的 16 类型定义：`../ui-component-harness/src/tree-contract.ts:20`。
- 内容行能力：`src/planning-context.mjs:100`、`src/panel-intent.mjs:17`、`src/spec.mjs:290`。
- 配方只允许现有内容行及面板布局：`src/catalog.mjs:2`。
- 编译内容行：`src/compiler.mjs:263`；滚动/Tabs：`src/compiler.mjs:430`；面板 Container：`src/compiler.mjs:469`。
- 状态映射：`src/state.mjs:12`；UGUI 节点白名单：`src/unity-export.mjs:12`。
- 直接拒绝未支持类型的既有测试：`tests/current-catalog-coverage.test.mjs:54`。

## 优先问题

### 1. 四种组件需要完整链路接入

缺口横跨 Catalog → PlanningContext/PanelIntent → PanelSpec → compiler → state/event → edit → Bundle → Pixi/UGUI。仅在提示词里加入四个名称，或者只放开 schema，不会形成可交付能力。当前相邻 Component 源码已经定义这些类型，但 Panel 没有开放对应的创作、绑定和导出合同。

建议先补 CheckBox 与 RadioGroup：可复用现有布尔/枚举状态基础，但保留独立控件身份和交互。随后补 List 的数据/模板/选择合同，以及 Dialog 的打开关闭、模态、焦点恢复合同。Panel 本体是否必须使用底层 Panel 节点，需要在“16 类覆盖”的验收定义中明确，不能靠改名充数。

### 2. 明确指定组件被替换，当前结构检查仍可通过

使用当前默认 `modern-centered-cards`、PanelIntent 0.11 和编译器 0.30.0，在内存中手工构造四份错误规划响应。没有调用模型，没有将这些反例保存为真实生成证据。

| 原始请求明确要求 | 人为提供的错误规划 | 本次实测 |
| --- | --- | --- |
| CheckBox，且明确不要 Switch | `switch` 行 | `READY_TO_COMPILE`，Workbench `ready` |
| RadioGroup，且明确不要 Select | `select` 行 | `READY_TO_COMPILE`，Workbench `ready` |
| 可选择动态 List，且明确不要静态文字 | `text` 行 | `READY_TO_COMPILE`，Workbench `ready` |
| 初始关闭的模态 Dialog，打开阻挡背景，且明确不要普通面板 | 普通面板中的 `button` 行 | `READY_TO_COMPILE`，Workbench `ready` |

每例均经过 `prepare → materializePanelIntent → checkPanelProposal → acceptProposal`。直接把 kind 改成 `checkbox`、`radio-group`、`list`、`dialog` 则都得到 `row-kind` 拒绝。

因此类型白名单有效，但它不能检查“用户要 A，规划返回 B”。`src/proposal.mjs:128–138` 明确仅检查结构/原文绑定，并报告 `semanticReview: NOT_RUN`；当前行为符合这个有限合同。风险在于工作台仍能接受不符合指定组件的结构合法结果。真实模型是否会产生这些替换，本轮没有测试，不能由反例推断发生率。

建议增加明确组件要求的独立核对和禁止替代的回归。在新组件开放前，对必要的未支持要求给出整批澄清；新组件开放后，核对实际生成类型、数量、行为和状态，而不只核对 schema。

### 3. “16 面板”历史证据容易与“16 组件”混淆

`docs/panel-evaluation.md:1–6` 的 16 项是声音、画质、菜单、任务、背包筛选等场景，原批使用当时的五类行控件。README 的“16类两轮真实结果”不能证明底层 16 组件覆盖。

现有 `docs/panel-component-coverage.md` 已正确披露缺口；建议将 README 中该历史证据明确标成“16 种面板场景”，并把逐组件能力矩阵作为日常入口。

### 4. 全组件覆盖测试与实际默认目录没有完全同步

SDK 与 Studio 默认已是 `modern-centered-cards`，但名为 `current-catalog-coverage` 的完整八行测试仍固定读取 `modern-image-slots`，断言编译器 0.29.0。`card-alignment.test.mjs` 另有当前目录的五类样本及配方相等检查，所以并非当前默认完全无测试；缺口是完整八行矩阵没有直接统一在日常入口上运行。

建议从同一默认目录声明派生当前覆盖矩阵，并保留旧目录的独立兼容测试。新组件需要浅深色单例、混合、编辑、状态、文件往返、实际 Pixi 交互和 UGUI 导出覆盖；真实模型与原生 Unity 分别记录。

## 本机与验证结果

- 当前 Node 为 25.9.0，满足项目声明的最低版本。
- `node scripts/check-workspace.mjs` 失败：`WORKSPACE_PACKAGE_MISSING`。相邻组件开发依赖中 Pixi 8.20.1、Vite 8.2.2 存在，要求的 `@playwright/test` 不存在。本轮没有安装依赖或执行浏览器验收。
- 第一组 9 个测试文件均通过：current-catalog-coverage、card-alignment、image-slots、controls-planning、controls-compile、controls-state、tabs、forms、navigation。
- 第二组 11 个测试文件共 **114/114 通过**：spec、catalog、planning-context、proposal、state、patch、edit-planning、panel-bundle、panel-composition、game-binding、unity-export。
- 以上属于确定性夹具/核心合同测试，不是全量回归，也不代表真实模型理解、美术认可或 Unity 编辑器导入通过。
- 开始审计时 Panel 目录已有 58 个已跟踪文件修改，以及 32 个未跟踪文件，包括图片槽、当前目录及其测试。原有改动保持。本文结论针对这些实际工作树字节，不代表 HEAD 或固定 SDK 附件已包含相同内容；本轮未联网核验发布资产。
- 模型调用 0，图片/视频生成调用 0，未重启 Studio，未更改运行代码。

## 建议实施顺序

1. 固定当前工作树基线、补齐本地验收依赖，将 16 类矩阵和“不得替代明确组件”的用例作为验收合同。
2. 完整接入 CheckBox、RadioGroup，并验证旧包重放与新旧状态兼容。
3. 完整接入 List、Dialog，分别定义数据更新和生命周期/模态行为。
4. 核对 Panel、Container、ScrollView、Tabs 的开放边界及编辑能力，再进行逐组件与组合的真实模型验收。

每一步均应先完成确定性验证。真实模型验收另按仓库合同冻结计划并取得一次性计算授权；本次审计不提供该授权。
