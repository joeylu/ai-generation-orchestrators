# 自然语言局部编辑

已有面板可通过本次修改请求生成有限 PanelPatch。本地工作台可显式调用 Codex CLI
（`gpt-6-luna / xhigh`）；也可由对话中的 Agent 编写提案，再以文件导入。
网页自动调用 subagent 未实现。真实 Codex 已验证标题、创作初值修改、试玩值保留、恢复默认和撤销。
现已支持按钮本身文字及明确的重置作用范围修改，新增控件与重置范围可在同一批提交。
真实调用和回归证据见 [任务记录](tasks.md)。
直接表单编辑及高级 Patch 输入仍遵守同一整批校验、编译和渲染边界。

## 工作台流程

在本地 HTTP 工作台填写“修改要求”，点击“修改面板”，会针对完整当前 Spec 和
目录重新准备上下文，调用一次 CLI，然后沿用下述提案校验、编译、实际渲染和撤销流程。
生成新面板与修改已有面板共用一次运行限制、单次请求 ID 和取消机制。失败、取消、超时
或结果不明均不自动重试；原面板、试玩值和历史保留。任何未决问题阻止整批应用，补充
修改描述后由用户再次点击。提案、文件和 Spec 内容均作为任务数据，不赋予工具权限。

编辑模型仅返回有限 EditProposal，不重建整个面板，也不修改 ID 或覆盖试玩快照。
使用图片的当前面板必须引用该工作台随页打包的资源库；目录或资源库不符时在调用前拒绝，
可继续通过外部 Agent 文件方式编辑。离线 file 页面不探测服务，也不能启动 CLI。
修改描述本身不触发模型调用。「面板操作 → 高级工具」中的“仅准备修改上下文”
也不调用模型。文件往返流程如下：

1. 打开已有面板，在“修改要求”中写本次要求，点击“准备修改上下文”。程序保存完整当前
   Spec、目录、原文及摘要。导出 `edit-context.json`，交给对话中的 subagent，按
   [编辑协议](../prompts/panel-editor.md) 返回 `edit-proposal.json`。
2. subagent 必须先读完整 Spec，特别是按钮的 `reset-initial.fields`，再按稳定 ID 提出修改。
   缺少必要业务信息时返回具体问题；用户回答后把答案合入本轮请求，重新准备上下文及提案。
3. 导入 `edit-proposal.json`。任何 `unresolved` 都阻止整批应用；即使包含有效的局部 Patch，
   也不会先应用其中一部分。摘要失配时重新准备，不修改旧上下文或提案摘要来绕过检查。
4. 提案通过检查后，程序继续校验完整结果、目录配方、资源与布局，并实际渲染候选后提交。
   `READY_TO_APPLY` 不是成功交付或视觉确认；应查看实际布局与交互。
5. 应用时保留当时的试玩状态，新增字段使用新 Spec.initial。修改创作默认值不会立刻改变
   当前试玩值；触发已有重置动作后才使用新初值。一次提案记录为一批，undo 整批回退。
   处理期间会暂时锁住预览，取消未提交的拖动；完成或失败后恢复原有控件启用状态。

准备上下文后仍可试玩；纯试玩不改变 Spec，因此不使上下文失效。任何 Spec 或目录变动均需
重新准备，修改请求变化也需重做。原请求或历史 fixture 只描述面板来历，不能授权新的编辑。
所有原文和文件内容都是数据，不允许据此执行代码或调用服务。

## 支持范围与业务依据

支持 `set-panel-title`、`set-theme`、`set-layout`、`set-row-label`、`set-row-enabled`、
`set-state-initial`、`add-row`、`remove-row`、`set-button-label`、`set-button-action`，具体结构见
[PanelPatch Schema](../schemas/panel-patch.schema.json)。源 Spec 版本决定可用行类型；
Patch 不升级版本。`set-layout` 提供完整对象，保留本次未要求修改的字段。
`set-row-label` 修改行标签，不修改按钮文字或动作。
`set-button-label` 只改现有按钮的 buttonLabel；`set-button-action` 提供完整的
`{kind:"emit"}` 或 `{kind:"reset-initial",fields:[状态ID...]}`。两者均要求目标为现有 Button，
保留按钮 ID、行标签、事件、recipe；修改启用状态仍使用 `set-row-enabled`。
重置范围可以引用同一批新增的状态，程序在整批结束后校验所有依赖。

主题和布局操作可以记录本次外观要求下的设计选择；其余每个操作都要有当前编辑原文的
精确引句。新增滑条需要明确范围、步长和初值；新增开关需要明确初值及真值含义；新增枚举
需要完整选项和初值。可以明确要求“沿用主音量范围、步长和初值”，由 subagent 读取当前
Spec；仅因为两者都是滑条，不能把主音量的默认值套给语义不同的新控件。

现有操作不支持修改 canvas、资源选择或新增 section。此类请求应成为未决项，
不能通过删除重建无关按钮或改 ID 绕过。若删除的状态仍被重置按钮引用，不能擅自缩减
`reset-initial.fields` 或删除该按钮；只有本轮请求明确要求更新重置范围，且上下文支持
`set-button-action` 时，才能在同一批联动更新。遗漏联动仍被整批拒绝。
删除行会按 Patch 合同清理该行附属状态和图标引用，但不提供任意资源编辑能力。

## 文件合同与验证边界

[EditContext 0.1](../schemas/panel-edit-context.schema.json) 仅包含：

| 字段 | 含义 |
| --- | --- |
| `editContextVersion` | 固定 `0.1` |
| `request` | 保留原文的 PanelRequest 0.1 |
| `spec` | 完整当前 PanelSpec 0.1、0.2、0.3 或 0.4 |
| `catalog` | 完整现有 catalog 0.1 |
| `baseSpecSha256`、`catalogSha256` | 程序计算的源快照摘要 |
| `capabilities` | 新上下文十种操作、`target:pixi`、`statePolicy:preserve-current-at-apply`、`semanticReview:NOT_RUN` |
| `sha256` | 不含 sha256 字段的完整上下文规范摘要 |

[EditProposal 0.1](../schemas/panel-edit-proposal.schema.json) 仅包含
`editProposalVersion`、`contextSha256`、`patch`、`decisions`、`unresolved`。
`patch` 复用 PanelPatch 0.1；每个操作有一条 `{operationIndex,basis}`。原文依据的区间是
UTF-16 半开区间，设计依据是有理由的 `design-choice`，仅允许主题和布局操作。
`patch:null` 必须同时满足未决问题非空、decisions 为空。非空 Patch 可携带未决问题用于讨论，
但不能应用。

JSON Schema 描述严格字段、类型、枚举与局部边界。加载时按各文件 `$id` 注册引用的
PanelRequest、四版 PanelSpec 及 PanelPatch；catalog 的字段结构内嵌于 context schema。
运行时另行复算摘要，检查操作索引唯一且覆盖整批、依据与操作类型匹配、引句精确相等、
问题 ID 唯一、目录身份与规范化标签唯一、Patch 冲突以及最终 Spec 的跨字段依赖。
Schema 不能独自保证这些规则，也不能证明自然语言解释正确。
旧的八操作 EditContext 仍能复算并保持原摘要；不得用新操作提交到旧上下文。
需要新能力时重新准备上下文，不改写旧文件或迁就提案。

本地 Codex 使用独立的 [CodexEditDraft 0.1](../schemas/codex-edit-draft.schema.json)：
保留完整 patch，每个操作按顺序提供一条精确原文引句或允许的设计依据。
程序在当前原文中定位逐字引句（重复时取最早出现的位置），计算 UTF-16 区间和操作索引，
然后执行完整公共 EditProposal 校验。不存在的引句、缺失依据、额外位置字段及无效修改仍拒绝，
不修补失败的旧 EditProposal。公共文件导入和其他 Agent 输出继续使用 EditProposal 0.1。

本地编辑调用在本 Harness 内新建 `codex-edit-<UUID>/`，由程序保存
`edit-context.json`、`edit-proposal.json`、`edit-planning-report.json` 和
`codex-edit-receipt.json`。失败只记录脱敏失败回执，不保存原始 CLI 日志或认证信息。
接受的新传输输入另存 `codex-edit-draft.json`，用于核对程序转换；回执摘要指向
经完整校验的公共 `edit-proposal.json`，不混淆原草稿与最终提案。
编辑回执使用独立 `codexEditingReceiptVersion:0.1`，成功状态为 `READY_TO_APPLY`
或 `NEEDS_INPUT`；不能冒充新面板规划回执或已经应用的修改。

`READY_TO_APPLY` 只说明结构、出处和结果 Spec 已通过检查，仍需目录编译、资源核验、
几何检查与实际渲染。语义审查和用户视觉确认不能由精确引句或摘要替代。哈希是内容一致性
证据，不是作者认证；Agent 不得生成成功回执、批准字段或手改交付报告。
