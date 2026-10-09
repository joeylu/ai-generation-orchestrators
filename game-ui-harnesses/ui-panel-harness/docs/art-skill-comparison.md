# 不同 Skill 的独立美术对照

用户查看后反馈“三者基本没差”，转向布局与Apple风格；后续[分组设置布局试稿](apple-grouped-layout.md)为程序夹具。它不属于本次三个Skill的真实结果，旧对照入口及记录保留。

用户澄清要比较不同 Skill 的效果。之前的 A/B/C 是同一组设计指导下的视觉方案，不是不同 Skill 的独立结果；保留它们作为试稿，不用于宣称 Skill 优劣。

修正版v4已获新的明确授权并执行完成：`output/skill-art-real-v2/batch-report.json` 为 PASS，3次独立真实CLI调用、0次自动重试、3份 Skill 方案，共6份浅深色面板。对照入口为 `output/skill-art-real-v2/review/index.html`。冻结计划及其准备时状态不改写，执行状态以批次回执为准。

新摘要：`a93693548f13705e0e5d89e4dc47a86c0922687396318360d78e26ceb73af4c3`。它是去除根 sha256 字段后，对 canonical JSON 计划正文的 SHA-256。

| 顺序 | 条件 | 来源 | 新调用上限 |
| --- | --- | --- | --- |
| 1 | Anthropic frontend-design | [官方 SKILL.md](https://github.com/anthropics/skills/blob/main/skills/frontend-design/SKILL.md) | 1 |
| 2 | Taste · redesign-existing-projects | [官方 SKILL.md](https://github.com/Leonxlnx/taste-skill/blob/main/skills/redesign-skill/SKILL.md) | 1 |
| 3 | Impeccable · Operate | [官方 SKILL.md](https://github.com/pbakaus/impeccable/blob/main/.agents/skills/impeccable/SKILL.md)，附 Operate/layout/typeset/craft-floor | 1 |

旧计划v3真实CLI调用1次，第1步被原生输出 schema 校验拒绝，未返回设计；第2、3步没有调用，整批停止，没有重试。v4使用新授权，没有沿用旧额度。两批合计派发4次，只有本轮3次返回设计。模型固定 Codex CLI / gpt-6-luna / xhigh。每步独立上下文，使用完全相同的声音设置基线、浅深色截图、素材、文案、业务、共同需求及编译器0.20；只替换该步的指导文本。结果先匿名展示。不得继承前一步结果、安装 Skill、调用工具或媒体生成；每步最多一次，没有自动重试，任一步失败、结果不明、需要修补、编译/业务/浏览器门禁失败都停止整批，不能跳过继续。

## v4真实结果与验收

| 页面方案 | Skill | 实际结果 | 可见差异 |
| --- | --- | --- | --- |
| 方案一 | Anthropic frontend-design | 浅/深色均PASS | 520px面板、较宽松的控件节奏，恢复默认保持低强调 |
| 方案二 | Taste Redesign | 浅/深色均PASS | 520px面板、略紧凑的行距，恢复默认使用有底色按钮 |
| 方案三 | Impeccable Operate | 浅/深色均PASS | 500px面板，接近原稿的尺寸和节奏，恢复默认保持低强调 |

每步返回的原始文本和CLI事件保存在各自 `step-N` 目录，程序直接解析、校验和物化，没有修补、裁剪或改写模型方案。每步8组检查通过后才进入下一步；汇总页另有20组检查通过，包含6份严格重编译、真实滑杆/开关/按钮事件、状态隔离/恢复、无文字截断、6份实际下载ZIP的CRC/摘要验证、离线打开与无图库重导入。390px仅验证切换、缩放和画布容纳，不宣称重新排版。浏览器错误0、外部网络请求0；报告见 `review/review-report.json`。该报告中 modelCalls=0 仅指已保存结果的回放，真实调用总数见根 `batch-report.json` 的3次。

6份浅深色截图已逐张查看，布局和文字显示正常。三者都选择了单列、左对齐标题和同类按钮层级，差异集中在灰阶、间距、尺寸与按钮底色；这次没有出现跨度很大的视觉语言。此结果不能证明某个 Skill 普遍更好，也不能把工程门禁PASS当作用户审美认可。`humanVisualApproval`、Unity原生和游戏接入仍为 `NOT_RUN`，日常默认主题未切换。页面可调整控件、切换当前稿/三个方案及颜色模式、显示/隐藏Skill名称，并下载每份结果。

## v3真实调用失败与修正

旧摘要 `660a0270d2662dd7af96c8341f00e8cb6348598d36615e45e8e188d4f4a01ebe` 及输入保持原样。`output/skill-art-real-v1/batch-report.json` 记录 FAIL / step-1-model / modelCalls=1；step-1 保存原始 CLI 事件、stderr、dispatch claim、失败回执与 terminal failure。最终服务端返回 HTTP400 / invalid_json_schema，未指出具体拒绝字段。连接重连和 WebSocket 转 HTTPS 通知属于该次CLI调用内的事件，未另起CLI调用。计数按一次已派发调用保守记录，不宣称没有消耗。

我准备的测试 schema 未采用现有 Codex 编辑链的保守转换，存在枚举缺显式类型、对象枚举和额外约束关键字等兼容疑点；不能凭通用错误认定某个字段就是唯一根因。失败执行器原源码已按其 evidence 摘要归档至 `output/skill-art-real-v1/executor-source/`，原失败日志、授权消耗标记、输入和响应 schema 均未改写。

修正通过 `scripts/lib/art-skill-native-schema.mjs` 明确枚举类型，将精确对象选项表示为严格 anyOf 分支，并采用与既有编辑链一致的保守原生形状。原完整约束逐字节保存在新计划 `response-constraints.json`，同一份完整约束加入三个提示，结果在物化前必须通过完整范围、文字格式、字段及对象身份检查。违反约束即停，不裁剪、不填补、不改写模型输出。[官方 Structured Outputs 文档](https://developers.openai.com/api/docs/guides/structured-outputs)说明原生响应只支持 JSON Schema 的子集；此处本地结构审计不替代真实服务端接受验证。

`scripts/prepare-audio-skill-schema-revision.mjs` 只读取、校验和冻结；两份原包、截图及7份指导文本与v3字节相同。新计划另外冻结完整约束、修正程序和执行器指纹。新增 schema 回归4项，与响应边界及停止规则共12项测试通过；修正版完整程序夹具 PASS，每步8组检查、汇总20组检查，含实际 Pixi 交互及ZIP离线打开，报告见 `output/skill-art-driver-fixture-v2/batch-report.json`。夹具调用模型0次，只回放原视觉，不属于任何 Skill 的设计结果。17份新输入和15份源码指纹在调用前及每步派发前复核通过。准备时服务端接受为 `NOT_RUN`；随后本轮三次真实调用均接受新 schema 并返回结果，不能倒改准备报告来冒称提前知道结果。

当前基线是已获“有好一些”反馈的 crafted 声音试稿，之前参考过 Impeccable，因此此次比较的是同一起点上的进一步优化，不是从零开始的无偏能力排名。每个 Skill 只做一个样本，不能据此认定普遍胜负。可用字体、文字权重、皮肤及布局受共同的现有渲染器限制；评测设计指导的局部作用，不冒称执行完整 Skill 工作流、自动 detector 或网页技术栈。

`examples/crafted-audio-v1/skill-comparison.mjs` 定义统一任务、结构化视觉响应和确定性物化。模型只提供配色、字号/圆角、布局、标题和按钮样式；程序从原包保留行对象、默认值、试玩值、动作、事件、绑定与素材闭包。原包不改写。每份真实结果仍须严格重编译、实际 Pixi 交互、ZIP 离线打开和无图库重导入；Unity原生编辑器 `NOT_RUN`。

`scripts/prepare-audio-skill-comparison.mjs` 只读取和冻结，未导入或执行模型运输。7份指导快照为完整网页提取行文本、LF统一，计划绑定实际提示字节摘要；不冒称 GitHub 原始文件字节。两份原包和截图、三份独立提示、统一 schema、CLI参数模板及共用源码指纹都已冻结。Skill 文本保存在 ignored output，仅作本地输入，没有安装成全局或项目 Skill。

本地准备检查通过：原包严格回放、6份明确标为程序夹具的响应物化预演通过、新增4项响应边界回归通过、已有 crafted-audio 4项对应回归通过。只读宿主检查确认CLI登录可见，未检查真实网络/模型可用性，未改变配置。准备v1的文件名白名单漏掉大写 `SKILL` 导致失败；v2/v3使用新目录，原部分产物保留。首次负例测试克隆了需保持验证身份的组件包，修正测试构造后通过；没有修改产品校验以迁就测试。

v3和v4授权均已消费，不能恢复或继续使用。未修改日常默认主题、4951服务、其他链路或GitHub。
