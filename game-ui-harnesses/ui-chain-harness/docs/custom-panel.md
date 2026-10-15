# 自定义面板

面板生成台的“创建方式”新增“自定义面板”，与 ui-reference 五类八状态并列。选择后隐藏预设状态，需求必填；选择已完成组件项目后生成。切换创建方式保留已填写的需求，不自动替换成预设文案。

自定义使用 ui-panel-harness 的公开规划接口和既有 Codex CLI 运输。准备阶段零模型调用，冻结用户原文、皮肤版本、能力配置与独立提示；确认后沿用一次调用、原文/回执先保存、无自动重试的流程。没有 SDK 预设源或固定控件数量约束。

当前支持：

- 文字、输入框、勾选框、开关、滑块、下拉、进度条及按钮自由组合；无需含指定种类或强制关闭按钮。至少一个内容项或按钮。
- 一个内容分组，单列排版，内容后是按钮区；同时交付横版、竖版。长内容可滚动，标题与按钮固定。
- 输入校验、状态初值/禁用、滑块范围步长、下拉默认项、进度值，以及按钮的本地事件、提交、重置指定字段。
- 当前资源上限为 12 个内容项、3 个按钮；不等于每个组合必然能在任意尺寸内排下，尺寸与安全区检查仍会拒绝超量/越界组合。

多分组、页签、嵌套、任意坐标、图片、功能图标及未映射控件仍不在当前自定义转换器范围内。提示要求模型给出具体澄清，确定性转换再次拒绝不支持的结构或语义，不静默删控件。已有设置适配器支持的分组/页签，不表示这个混合控件适配器也已经支持。正式文本机制与所有组件/面板共用。

维护位置：

| 位置 | 责任 |
| --- | --- |
| configs/custom-panel.json | 自定义支持类型、配方、数量上限与尺寸 |
| src/panel/custom-panel.mjs | 扩展公共 action 配置；不修改八套预设或旧 action 配置 |
| prompts/custom-panel-planner.md | 自定义模型能力约束；不复用 SDK 固定结构要求 |
| src/panel/action-intent.mjs | 原生意图校验与横竖组件文档转换，含滚动区 |
| src/panel/action-behavior.mjs | 本地状态/提交/重置；不调用游戏后端 |
| src/studio/panel-presets.mjs、pipeline-ui.mjs、pipeline.mjs | 入口、必填交互、冻结计划与生成任务 |

修改配置或提示会使旧待执行计划要求重新准备；已经保存的输出不被重写。旧确认/表单与 SDK 预设仍走原配置和提示。

验证：`tests/custom-panel.test.mjs` 检查混合类型、纯文字/纯按钮、状态、无效语义及计划指纹；`scripts/studio-check.mjs` 检查入口、必填、切换保留文案、请求类型、取消不调用模型及移动端；`scripts/custom-panel-check.mjs` 检查真实皮肤的横竖渲染和本地交互。

离线示例可通过下列命令预览，不调用模型，产物始终标记 offline-fixtures：

```powershell
node scripts/action-preview.mjs --package work/<verified-pack> --examples examples/custom-panel.json --out work/custom-panel-preview
node scripts/custom-panel-check.mjs work/custom-panel-preview/<id>
```
