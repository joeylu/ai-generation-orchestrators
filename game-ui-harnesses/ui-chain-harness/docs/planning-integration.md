# Panel 规划接口与维护边界

当前 Studio 面板链已接通：用户需求与已验证组件包 → 冻结规划计划 → 网页确认一次模型调用 → 保存原始输出和回执 → 语义转换 → PixiUI/Layout 预览与交付。原始交付与后续编辑副本分开。操作和逐节点验收见[验收指南](acceptance.md)，支持范围另见[能力对照](panel-upgrade-matrix.md)。

## 唯一依赖入口

`src/panel/sdk.mjs` 是 Panel 代码与目录 JSON 的唯一加载入口，默认读取已校验的官方 rc.8 发布包，锁定 tag、commit、ZIP 字节数和 SHA-256、发布回执及内部文件清单。缺失或不一致时停止，不回退到相邻源码。`planning-client.mjs` 只经该入口访问公开 `planning/v1` 和可选 `planning/codex/v1`；目录资源从发布 manifest 中的公开文件读取。显式开发模式与安装命令见 [SDK 依赖](panel-sdk.md)。

Panel 负责候选检索、规划上下文与响应 Schema、可选模型运输；Chain 负责自身兼容检查、需求语义转换、真实皮肤绑定、布局、预览和交付。Chain 不调用旧 PanelSpec materializer，不复制旧 Studio 或另一套组件运行时。协议放行不等于所有上游字段都已在 Chain 实现。

## 当前协议与能力

`configs/planning-compatibility.json` 维护明确配对：

| 入口 | context / intent | Chain 消费范围 |
| --- | --- | --- |
| 当前一般组件目录 | `0.11` / `0.12` | `modern-all-components`，供设置、ui-reference 预设和受限自定义转换 |
| 当前 AI 仓库 | `0.12` / `0.13` | 独立仓库目录、`inventory` 行，按冻结 `programGrid` 转换 |
| 旧基础与设置布局目录 | `0.1` / `0.3`、`0.4` / `0.3` | 兼容历史快照及相应旧 policy，不自动升级为新协议 |

设置转换支持多个同级分组、开关/滑块/下拉框、支持范围内的页签和滚动；ui-reference 入口保持五类八状态的预设控件形状，补充需求修改显示内容和初始值。预设来源由 `src/panel/reference-presets.mjs` 读取并冻结摘要，不在 Studio 复制另一份默认内容。

自定义可转换 text/input/checkbox/switch/slider/select/progress/button、受支持的 column/row/grid/section 树及本地动作。当前消费者 layout 4.0 使用一个放大角部的 frame、连续的单组普通正文，以及有实际多分组／卡片时的弱 inset；主标题与组标题遵循参考图的大小层级。标签值按宽度并排或上下排列，grid 横屏 1–3 列、竖屏单列，显式 row 保留。上游没有的逐节点 padding、min/max、fill/content 由消费者配置决定，不伪造为 AI 已输出的字段。旧冻结 layout 1.0/2.0/3.0 保持原行为，旧提示词按冻结版本选择。完整限制见[自定义面板](custom-panel.md)。

AI 仓库通过 `action-model.mjs` 的独立分支选择 `modern-readable-game-grid-layout` 目录，使用 `configs/inventory-planning.json` 约束 `inventory.grid@0.1.0`。AI 输出标题、名称、数量、格位和初始选择；程序冻结行列、格子几何、画布比例、真实皮肤和安全区。无图集时 `item.icon` 为 null，以名称展示。多格占用、拖换、堆叠、业务动作和未绑定图标不在当前转换范围内。旧 `deterministic-inventory` 结果保持原标识，不标成 AI。详见[仓库面板](inventory-panel.md)。

## 消费端展示版本

展示版本与上游 context / intent 独立，不通过修改原始模型响应升级布局：

| 当前新计划入口 | 冻结版本 | 转换标记 |
| --- | --- | --- |
| 预设与设置（含已支持的 Tabs、原生确认 Dialog） | `presentation.version:3.0` | `surfaceRecipesVersion:3` |
| 自定义 | `preset.layout.version:4.0` | `surfaceRecipesVersion:3` |
| AI 仓库 | planning/capabilities 1.3、layout 1.4 | `surfaceRecipesVersion:3` |

新主框的 `surfaceScale:3` 只影响该 frame 的角部和安全区，其他控件及 S05 源图、平铺尺度不改。`surfaceBand:reference-v1` 保留标题端部纹饰、延展中间区域；节点级 `surfaceFontSize` 提供主标题／分组标题的语义字号，不向旧皮肤组件 props 注入新字段，用户显式字号编辑优先。单组普通公告或表单不再独立套内容底板，真实分组和数据使用弱 inset。细节见[分层材质](skin-surfaces.md)。

历史标记 0（含更早缺失标记）、1、2 分别保留无表面配方、标题配方与上一版分层展示；旧配置和转换标记优先于当前默认值。原始请求、提示、计划、响应、回执、原交付及独立编辑副本不重写；复核或确定性重放也不自动提交新模型任务。展示规则已实现不代表任意真实模型结果或六种风格均已完成视觉验收。

16 类组件可在组件画布试玩，不代表任意 16 类组合都能通过 AI 语义转换。新协议或新字段要增加语义适配及拒绝用例，不能只扩大兼容版本列表。

## 每个节点的输入与输出

| 节点 | 输入 | 输出及失败边界 |
| --- | --- | --- |
| 准备 | 需求、预设/自定义类型、方向、已验证皮肤、原合同快照、消费者配置 | 冻结 session、提示、Schema、consumer 与摘要；零模型调用 |
| 兼容校验 | 冻结计划和当前对应实现 | 明确协议配对及摘要一致；变化时要求重新准备，不覆盖快照 |
| 确认与执行 | 当前计划摘要、当前单次确认 | 一次模型调用的原始输出、回执；已可能接受请求后禁止自动重投 |
| 转换 | 原始意图、原生 Schema、冻结消费者配置和真实皮肤几何 | `COMPILED`、`NEEDS_INPUT` 或 `REJECTED` 记录；保留原始响应，不手改为通过 |
| 预览与交付 | 已转换内容、布局、对应皮肤及合同 | 所选方向 PanelDocument、离线预览和带摘要交付；程序检查不代替语义/美术验收 |
| 后续编辑 | 核验过的原始交付及所选版本 | 独立保存修订、预览和编辑 JSON；原始计划、HTML、ZIP、清单不变 |

面板计划会冻结与所选皮肤摘要一致的 registry、usage、template 快照。旧组件项目从已核验任务原始输入取得对应版本；准备、转换、预览使用同一快照，不靠修改原皮肤摘要解决错版。维护 CLI 的 `--contracts <目录>` 指向这三份配置；省略时仍需与当前配置摘要相符。

证据引用检查只证明来源在输入中，不能证明模型理解正确。需要精确保留的显示文字可在需求中加引号，并人工逐项核对标题、条目、数值、禁用状态、选中项和动作。

## 确认、澄清与恢复

`prepare` 是零调用；确认绑定该份不可变计划。模型输出先保存，再做转换。`NEEDS_INPUT` 要在原任务补充回答、准备下一版并重新确认；`REJECTED` 保留具体原因。连接失败或结果不明不是重新调用的授权。旧计划、原始结果和失败回执均保留，不能改根目录或清理状态绕过单次限制。

网页是当前真实验收入口。维护 CLI 仍提供 `scripts/settings-model.mjs`、`scripts/action-model.mjs` 的准备/校验/执行，但不使用通用 `real-confirmed` 参数替代逐次确认。恢复的选择和证据检查见[验收指南](acceptance.md#失败与恢复)。

## 维护位置

| 变化 | 维护入口与必要验证 |
| --- | --- |
| 上游公开协议变化 | `configs/planning-compatibility.json`、`src/panel/planning-client.mjs`；新增明确配对和语义回归 |
| 设置、通用预设、自定义、仓库语义 | 各自 intent 转换器与 `configs/*planning*.json`、`configs/custom-panel.json`；检查保真与不支持字段拒绝 |
| 模型能力提示 | `prompts/settings-planner.md`、`prompts/action-planner.md`、`prompts/custom-panel-planner.md`、`prompts/inventory-planner.md` |
| 选中皮肤身份 | `configs/planning-skin-aliases.json` 只提供名称；真实 ID、摘要和合同从所选包读取冻结 |
| 布局和皮肤 | 原有布局、九宫格、安全区与材质合同；不得改模型输出消除测试差异 |
| 正式依赖升级 | 锁定版本及摘要，跑接口、语义、真实皮肤预览和导出回归，保留旧包与冻结快照 |

过去的设置试验、旧协议子集和固定双向预览结果见[历史执行记录](execution-plan.md)。这些记录反映当时范围，不作为当前 Studio 未实现或所有真实生成已验收的证据。
