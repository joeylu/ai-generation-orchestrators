# 在预览中选择修改对象

适用于现有 modern-v3 面板。先点击「选择修改对象」，再点击预览中的控件框；也可用 Tab 和 Enter 选择，Esc 返回试玩。选择模式覆盖 Pixi 的点击区域，选择按钮不会触发其试玩动作。屏幕外的控件需要先返回试玩并滚动到可见区域。

选中后，左侧显示「修改对象：…」，预览持续用双色边框标出该控件。边框不截获鼠标或键盘，可以继续试玩；会跟随画布缩放和滚动，只标出当前可见部分。所选控件滚出视口或切到其他页签时隐藏边框，左侧仍保留修改对象，回到可见位置后恢复。重新选择时显示选择框，取消选择后移除边框。

可以输入“这个按钮改成紫色”“把这个输入框设为只读”“把这段说明改为…”。选择只帮助明确对象，不扩展现有样式和行为能力。要改整页、其他对象或多个对象，请先「取消选择」。

点击选择不调用模型，不消耗修改轮次。成功修改仍计入最多十轮；失败、澄清和无变化不增加轮次。切换面板、应用修改、撤销或刷新后清除选择。选择不进入 PanelSpec、交付包或本机草稿；已有面板、试玩状态和轮次存储格式保持原样。

程序通过共享组件运行时的公开 `inspect()` 和 `getDocument()` 获取位置，按稳定 row ID 映射选择框。只显示当前可见的行，裁剪所有祖先滚动区域；禁用控件和静态说明仍可选中。选择框随加载、滚动、值变化和尺寸变化更新，没有每帧刷新循环。共享组件 Harness 不作修改。

## 协议

单个精确按钮改名遇到重名时，Studio还可[直接列出分组供选择](local-edit-target-choice.md)。选定后沿用同一row ID选择机制，原需求文字保持，再次点击“修改面板”才提交。

选中对象后若同时要求修改标题、布局或其他精确控件，新构建还会[在本地提示范围冲突](selected-edit-scope.md)，保留整句而不提交允许的部分；取消选择不自动调用模型。该辅助不升级公共上下文的语义校验，未知描述与改口保持原流程；后续[4951日常更新](daily-studio-scope-update-2026-10-09.md)已完成。

Studio 的 `model.prepareEdit(request, {rowId})` 当前为 modern-v3 创建 EditContext 0.14，使用[属性与同名按钮文案定位核对](scoped-button-copy.md)；未提供选择时 selection 为 null。底层 `createPanelEditContext` 按显式选项与源Spec选择版本，不自动升级旧上下文。保存的0.1–0.13内容与摘要规则保持；0.6新增[独立按钮字号](panel-button-font.md)，0.7新增[标题对齐与底板](panel-title-bar.md)。

0.5 在完整当前面板、目录和原始请求之外绑定 `selection:{rowId}`，并声明 `selectionPolicy: selected-row-v1`。能力列表由所选行的类型重新计算。允许该行适用的标签、启用状态、按钮行为/样式、输入属性、静态正文、删除行，以及它绑定字段的创作默认值；没有全局主题、布局、分组、添加行或其他对象操作。现有依赖和规格校验继续生效。

选择 ID 与原文分别纳入摘要。模型输出协议仍为 CodexEditDraft 0.3，不向需求原文拼接说明。原生响应 schema 将操作目标固定为选中行及绑定字段；公共校验器独立拒绝范围外操作。换选对象使旧规划失效，不能应用旧摘要的方案。操作依据仍必须引用未经改写的当前修改原文。

结构校验、夹具和假 CLI 检查不等同于真实模型成功率。实际模型验收需要独立的计划与计算授权；Unity 原生导入不在本功能的验收范围内。

## 持续标记的本地验证 · 2026-10-09

本次仅新增 Studio 的非交互 DOM 边框，复用现有可见行裁剪和事件订阅；PanelSpec、编译器、保存格式与交付渲染不变。边框不进入导出，选择本身不增加轮次。1170项本地回归通过；17项 Edge/Playwright 浏览器检查通过，模型调用0次、外部请求0次、页面错误0项。

检查覆盖浅深色、键盘选择及焦点返回、真实 Pixi 开关点击、390宽度缩放、导出中的规格/素材/试玩值、取消选择及 Esc、滚动裁剪、页签切换，以及替身编辑失败后的标记恢复、成功应用/撤销/刷新后的清除。两次编辑均调用显式注入的程序替身，不启动 Codex 进程，不计入真实模型成功次数。

```sh
node scripts/build-workbench.mjs --catalog examples/modern-navigation.catalog.json --assets builtin --output output/my-selection-studio
node scripts/check-selection-workbench-browser.mjs --workbench output/my-selection-studio --output output/my-selection-review
```

输出目录须不存在。本机通过报告为 `output/selection-feedback-browser-v2/selection-browser-report.json`，单元日志为 `output/selection-feedback-unit-v1.log`，构建为 `output/selection-studio-v1/`。首跑 v1 的 FAIL 保留：测试要求禁用开关，却额外断言其绑定的 enabled 不变；v2 仅修正为该开关 enabled=false、其他绑定保持。通过报告不代替人工视觉确认或 Unity 原生验收。

既有4951服务未重启、未替换用户面板。源码优化在下一次按日常启动方式重建 Studio 后生效；这些本地静态产物不随 Git 提交。
