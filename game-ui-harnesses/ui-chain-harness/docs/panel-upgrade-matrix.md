# Panel 更新接入对照与离线基线

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
