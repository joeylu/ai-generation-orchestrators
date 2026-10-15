# 确认弹窗与简单表单：维护入口

本批是原生 PanelIntent 0.12 → Chain 的有限适配。输入是显式离线夹具，通过 ui-panel-harness 公共规划入口冻结上下文和验证响应；未调用模型。渲染复用现有 PixiUI、Layout 和真实皮肤运行时。

0.44 补充：用户授权后，两类预设各调用一次真实模型并成功转换。4188 为真实模型候选，独立语义核对无差异，10 项横竖浏览器交互通过；4187 保留为离线示例。详见执行文档 12.29。

## 维护分工

| 修改目标 | 唯一维护入口 |
| --- | --- |
| 横竖尺寸、间距、允许的部件及数量、上游 recipe 映射 | `configs/action-presets.json` |
| 验收示例的文案、字段初值、校验要求、按钮目标 | `examples/action-presets.json` |
| 上游协议兼容范围与入口 | `configs/planning-compatibility.json`、`src/panel/planning-client.mjs` |
| 新语义的确定性转换 | `src/panel/action-intent.mjs` |
| 本地提交校验、重置、事件行为 | `src/panel/action-behavior.mjs` |
| 本类规划规则 | `prompts/action-planner.md` |
| 计划绑定、结果摘要检查 | `src/panel/action-model.mjs` |
| 本次生成的快照 | `work/panels/action-preview/<运行ID>/`，由程序产生，不手改 |

添加同类字段主要改示例 JSON；添加新控件语义仍需要适配器和回归，不能只声明映射就视为支持。配置引用的上游 recipe 不属于真实皮肤纹理身份，真实素材仍由包摘要绑定。

## 支持与边界

- Text 保留标签、正文和换行；Input 保留初值、占位文字、文本/密码、只读、禁用、最大长度、必填和最小长度；Checkbox 保留标签、初值与禁用；Button 保留主/次样式、禁用和动作。
- 支持单列、单 section、末尾按钮的预设结构。拒绝未支持的布局、图标、danger 样式、无效或重复目标，避免静默丢失语义。
- 按钮支持 emit、reset-initial、submit。reset/submit 使用原生深度优先行序号确定目标，转换为稳定节点 ID。提交只检查指定字段，不连接游戏业务。文本长度沿用运行时 UTF-16 长度规则。
- 确认弹窗用现有 Dialog 容器，两个示例按钮发出不同节点事件后关闭；实际返回地图等行为由宿主决定。
- 试玩状态与创作文档分离。导出 `ui_action_preview_bundle` 同时包含 `document` 与 `behavior`；这是预览包，尚无通用导入器或正式发布合同，不能冒充生产交付格式。
- 字体基础样式沿用现有皮肤；实例文字属性编辑仍为待办。全 16 类组件基础已经存在，但本次不代表全部 16 类 AI 规划语义已适配。

## 构建与验收

在本 Harness 目录执行：

```text
node scripts/action-preview.mjs --package <已验证的真实皮肤包目录> --out work/panels/action-preview
node scripts/action-check.mjs <构建输出目录>
node --test tests/action-intent.test.mjs tests/settings-intent.test.mjs tests/panel-document.test.mjs tests/settings-panel.test.mjs tests/planning-client.test.mjs
```

构建冻结示例规划会话、原生 intent、转换结果、配置和真实包身份。浏览器检查完全离线，使用实际指针/原生输入，并下载检查导出内容；报告与截图由检查程序生成。模型是否能稳定产出该子集，需要另外的真实规划验收。

## 真实规划入口

```text
node scripts/action-model.mjs prepare --preset confirmation --request <request.json> --package <pack>
node scripts/action-model.mjs prepare --preset form --request <request.json> --package <pack>
node scripts/action-model.mjs run --plan <冻结计划.json> --authorize <该计划完整SHA256> --package <pack>
node scripts/action-preview.mjs --run <已编译调用结果目录> --package <pack> --out work/panels/action-model-preview
```

`prepare` 不调用模型。`run` 复用公共可选 Codex 适配器；配置、提示规则或皮肤变化时要求重新准备，重复计划提交由公共入口拒绝。调用前需要该摘要的一次明确授权；程序参数不是代替人工授权的证据。

原始响应先保留，之后才记录 COMPILED / NEEDS_INPUT / REJECTED。编译失败不能冒充模型成功；不自动重试。预览 `--run` 可重复传入不同预设的结果目录，只显示实际传入的预设，绝不补入离线示例冒充模型结果。预览读取核对计划、原始响应摘要、响应 JSON、产物摘要并重新转换核对行为；仅 COMPILED 可显示。示例专用 `action-check.mjs` 仍针对两套固定验收需求，其他真实需求需相应的独立验收期望，不能随意套用。
