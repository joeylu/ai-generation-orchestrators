# 加载条 / 确定进度

PanelSpec / PanelBundle / PlanningContext / Proposal 0.5 支持 `progress`。
输入“生成一个加载条”时，生成器采用明确的展示约定：0～100、初始 0、百分比、0 位小数。
写明范围、初始值和显示格式时按需求保持原值。这项约定仅用于进度展示，不补充其它控件的游戏业务默认值。
严格 Spec 校验器仍不插入默认值。Intent 0.4 返回这些明确字段，程序记录展示约定并校验方案。

例如：生成资源加载面板，加载进度 0～1，初始 0.2，百分比显示一位小数；取消按钮通知宿主。
加载条只显示宿主提供的进度，没有拖动手柄、启用开关或业务 change 事件，也不会自行运行到 100%。
不确定进度的循环流动动画、实际下载和资源加载程序尚未实现；明确要求这些行为会得到具体澄清问题。

```json
{
  "id": "loading",
  "type": "progress",
  "initial": 0.2,
  "max": 1
}
```

```json
{
  "id": "loading-row",
  "kind": "progress",
  "recipe": { "id": "settings.progress", "version": "0.1.0" },
  "label": "加载进度",
  "bind": "loading",
  "format": { "mode": "percent", "fractionDigits": 1 }
}
```

状态最小值固定为 0；max 是有限正数，初始/当前值是 0～max 内的有限数。
进度没有 step，不会量化 0.376123456789 这样的宿主值。显示精度 0～6，只控制文本四舍五入。
`mode:value` 显示实际值；`mode:percent` 显示 value/max×100%。百分比绘制节点归一化，语义状态保持原始精度。
编译器 0.5.1 按整个值域预留数值宽度；0.5.0 包仍按原始几何复验。Spec 0.1～0.4 不接受新进度形状。

宿主会话要传入已经验证的 Bundle 状态，以避免从绘制值反推语义数值的浮点往返：

```js
const session = attachPanelSession(bundle.spec, runtime, onEvent, bundle.state);
session.setProgress('loading', 0.376123456789);
```

完整 `setState` 也可更新进度；缺键、额外键、越界、字符串、NaN/Infinity 都拒绝，拒绝前不写任何节点。
`setProgress` 不发玩家事件，关闭会话后不能调用。明确的 reset-initial 按钮可恢复进度初始值。

Studio 提供 `window.panelHost.setProgress(fieldId, value)`，忙于生成/修改时拒绝更新。
独立预览提供 `window.panelHarness.setProgress(fieldId, value)`。
fieldId 来自 Spec 的 bind，组合后的字段使用组合映射中的命名空间 ID，不能用显示标签或控制节点路径替代。
导出读取当前会话状态。修改初始值保留当前进度，撤销恢复此前进度；按钮重置时才应用新初始值。

现有局部修改支持改标签、改创作初始值、添加/删除进度行，以及显式修改按钮重置范围。
最大值与显示格式没有专门修改操作；这类要求会得到澄清，不会通过删除重建伪装完成。
旧 Spec 无法直接添加 progress，需要从完整需求生成 Spec 0.5。

新目录 `examples/modern-mint-progress.catalog.json` 增加 progress-row 的语义检索与原生 Intent schema。
旧目录仍产生原本的 Context 0.1～0.4 摘要和能力。Intent 0.3 不接受 progress。
核心不调用模型；工作台显式生成或修改各调用一次 Codex CLI，失败不自动重试。

Unity 适配器 0.1.2 使用原生 UGUI Image.Type.Filled、Horizontal、Left 和非 raycast 的 track/fill。
Builder 在面板自己的 Textures 目录创建哈希命名的白色 1×1 精灵，轨道和填充使用纯色 tint。
`PanelController.SetProgress(fieldId, value)` 或完整 SetState 更新连续 double 状态；fillAmount 为归一化 float。
不增加 Slider、Selectable、计时器或新的共享脚本，仍在 `Assets/PanelHarness/` 下共享六份既有适配器源码。
Unity 的 value 显示要求 max<1e21；超出时导出拒绝，百分比没有该数值显示限制。
导入已有项目仍需安装预检：0.1.1 与 0.1.2 的共享 Runtime 摘要不同，不能静默混装。
Runtime 能读取旧 Prefab 数据；旧 managed identity 的跨 Runtime 升级/重建尚未提供自动迁移流程。

验收脚本 `scripts/check-progress-workbench-browser.mjs` 默认只注入 fixture，`--real` 才执行模型调用。
两次生成与一次修改各调用一次；另验证只读指针/键盘、连续宿主更新、局部修改/撤销、导出、窄屏和组合的重置隔离。
模型回执、浏览器报告、Unity 原生检查分别存储，不把 fixture 当真实生成，也不回写 Bundle 的人工/原生验收状态。
