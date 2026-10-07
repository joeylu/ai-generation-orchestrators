# PanelSpec 0.3：下拉选择与按钮

0.3 增加 `enum` 状态、`select` 行和 `button` 行。旧 0.1/0.2 文档和包仍按原版本编译；
新增能力使用新的 [组件目录](../examples/modern-mint-controls.catalog.json)，原目录与主题版本没有覆盖。
本阶段仍是固定画布设置面板、Pixi 工作区原型，未实现 Unity/Cocos/Godot/UE 原生导出。

## 声明语义

```json
{"id":"quality","type":"enum","initial":"high","options":[
  {"id":"low","label":"低"},{"id":"medium","label":"中"},{"id":"high","label":"高"}
]}
```

选项为 1–8 项，ID 在字段内唯一，初值和当前值必须属于它们。`select` 行以 `bind` 引用枚举，
一个字段恰好绑定一行。编译器给选项加控件命名空间；会话向游戏返回 `high` 等业务 ID，
不暴露 Pixi 的全局选项 ID。选项标签不能充当状态值。

```json
{
  "id":"reset-row","kind":"button",
  "recipe":{"id":"settings.button","version":"0.1.0"},
  "label":"默认设置","buttonLabel":"恢复默认","enabled":true,
  "event":"settings.resetRequested",
  "action":{"kind":"reset-initial","fields":["volume","muted","quality"]}
}
```

按钮不绑定状态字段。`reset-initial` 只恢复列出的字段，目标来自 **Spec 的 initial**，
与最近导入的当前状态无关；未列出的字段保持原值。`emit` 仅发动作事件，不修改状态。
不支持任意脚本、表达式、真实存档或游戏 API 调用。事件名与其他控件事件共用唯一命名空间。

重置先校验完整目标状态，再通过会话逐项写入实际控件；中途的程序赋值回调不会冒充用户事件。
全部写入成功后发一次动作事件：

```json
{"name":"settings.resetRequested","rowId":"reset-row","action":"reset-initial",
 "state":{"volume":80,"muted":true,"quality":"high"},"source":"mouse"}
```

即使已是初值，用户再次按按钮仍发一次动作事件。运行时写入失败则销毁会话，不能把部分更新
报告为成功。会话的 `setState` 接受完整快照，不向宿主发用户事件；`destroy` 幂等。

0.3 的 `assets` 字段必填：无图时为 `null`；有图时沿用 0.2 的完整库引用和非空素材选择。
[严格 schema](../schemas/panel-spec-v0.3.schema.json) 描述结构；跨字段引用、重复 ID、枚举成员、
实际几何与目录解析由运行时校验器负责。

## 布局边界

Select/Button 高度固定 40 逻辑像素，右侧槽宽至少 120。Select 菜单向下展开，间隔 2 像素，
每项 40 像素；完整菜单超出画布底边时编译拒绝，不自动翻转、滚动或裁切。
当前 Select 配方使用明确的浅色字段与深色文字，以兼容组件核心的浅色默认菜单；不会声称其
所有颜色都随主题变化。Button 文字从黑、白中选择与 accent 背景对比更高的一种。
长标签仍须在真实浏览器检查，编译成功不代表文字和视觉已验收。

## 静态预览与恢复

基础样本 [settings-controls.panel.json](../examples/settings-controls.panel.json) 有四种控件。
在本 Harness 目录执行，输出目录必须不存在：

```sh
node scripts/cli.mjs compile examples/settings-controls.panel.json --catalog examples/modern-mint-controls.catalog.json --output output/my-controls
node scripts/build-preview.mjs --bundle output/my-controls/panel.bundle.json --output output/my-controls-preview
```

用桌面浏览器打开输出的 `index.html`。同目录的 `preview.js` 包含 Pixi 和面板会话，PNG 内嵌
在 HTML 中的 PanelBundle；没有 CDN、安装步骤或后台服务。文件不要拆开移动。
“导出当前面板”保存含原始 Spec、当前状态、动作和资产的 PanelBundle；“打开面板”重新校验并导入。
该预览复用相邻项目当前源码与已安装的 Vite/Pixi，只写本目录，不修改相邻源码或 dist。
这是工作区静态构建，尚不是经过发行摘要锁定的生产 SDK。

原有 `component.bundle.json` 仍可导入旧工作台查看和操作控件，但按钮不会自动具备面板重置语义。
0.3 的 PanelBundle 标记 `sessionRequired:true`。自定义宿主须在真实 `TreePreview.load` 后接上：

```js
const session = attachPanelSession(panelBundle.spec, treePreview, event => handleGameEvent(event));
session.getState();
session.setState({ volume: 40, muted: false, quality: 'medium' });
session.destroy(); // renderer ownership stays with the host
```

先验证完整 PanelBundle，再装载其中的组件文档与 PNG；不能仅信任摘要或拼接部分 Spec。
当前预览展示设置变化，实际音量、画质与持久化由游戏侧处理。

## 需求与资源规划

新目录中存在 select/button 配方时，`intake` 创建 context 0.3；相应提案必须使用
[proposal 0.3](../schemas/panel-proposal-v0.3.schema.json)。`assetRetrieval` 必填，为 `null`
或已验证的资源候选。旧目录仍生成原来的 context 0.1/0.2，旧摘要保持不变。

枚举选项、初值、按钮动作和重置范围必须有原文依据。带资产时，候选槽位、每项素材依据、
构建时全库复验与 0.2 一致。`READY_TO_COMPILE` 只说明结构和依据引用通过，不证明自然语言解释正确。
[固定验收需求](../examples/controls-planning/request-assets.txt) 和 [提案](../examples/controls-planning/proposal.json)
演示音量、静音、画质、恢复默认及三份内嵌 PNG；来源明确为验收 fixture。

```sh
node scripts/cli.mjs intake examples/controls-planning/request-assets.txt --id controls-asset-request --catalog examples/modern-mint-controls.catalog.json --assets output/generic-library-migrated-v1 --asset-style modern-mint --output output/my-controls-context
node scripts/cli.mjs build-plan output/my-controls-context/planning-context.json --proposal examples/controls-planning/proposal.json --assets output/generic-library-migrated-v1 --output output/my-controls-assets
```

需要时加 `--sharp-module <已安装的模块目录>`。上述提案锁定示例需求、目录与资源库的实际摘要；
修改任何输入须重新 intake 并编写匹配提案。原资源库的本地产物不会随源码发行。

Patch 的 `add-row` 对按钮要求 `state:null`，其他行要求配对的状态定义；删除一个仍被重置动作
引用的字段会失败，不能擅自缩小按钮作用范围。若需同时改变该范围，应显式提交新的完整 Spec。

## 验收口径

```sh
node scripts/check-controls-browser.mjs --preview output/my-controls-preview --bundle output/my-controls/panel.bundle.json --output test-results/my-controls
```

验收使用真实 Pixi 和真实面板会话。静态文件由 Playwright 在浏览器请求层供应，不启动服务器；
另以断网 `file://` 打开验证桌面离线预览。检查鼠标/键盘选择、菜单边界、重置、下载包重验、
新浏览器上下文恢复、禁用态、并发导入与销毁。它需要安装好的 Edge 与相邻 Playwright。
截图不是人工视觉批准；原生引擎验证仍为 `NOT_RUN`。结果与摘要见 [任务证据](tasks.md)。
