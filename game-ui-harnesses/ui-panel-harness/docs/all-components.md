# 16 种组件自动生成合同

2026-10-13 起，源码 SDK 和 Studio 新生成使用 `modern-all-components@0.1.0`。
PlanningContext/Proposal 0.11 → 原生 PanelIntent 0.12 → PanelSpec/Bundle 0.16 → Compiler 0.32.0 → Pixi / UGUI 0.1.7。
Compiler 0.32.0采用[主标题默认居中](centered-title-default.md)；旧0.31.0包继续原样回放。
旧包使用内嵌目录和原编译版本重放，不在加载时升级。

后续[输入适应性真实验收](input-adaptability-results-2026-10-13.md)：原24次真实调用23项通过、1项失败。修复后[8项新授权复验](input-adaptability-recheck-results-2026-10-13.md)7项通过、1项新口语命名失败；全部16种组件、列表/弹窗布局通过，最终47项浏览器检查通过。原样本通过不代表任意输入均能正确解析。以下确定性组件交付记录保留其执行时的范围。

| 底层组件 | 生成入口 | 状态与操作 |
| --- | --- | --- |
| Container | column/row/grid/section 布局 | 编译器确定分组 |
| Panel | 面板底板 | 输出真实 Panel 节点 |
| Image | image | 精确素材版本，或明确占位 |
| Text | text | 静态文案与换行 |
| Button | button | emit / reset-initial / submit |
| Slider | slider | 数值、范围、步长 |
| Switch | switch | 布尔开关 |
| CheckBox | checkbox | 独立复选框、布尔值 |
| Select | select | 1–8 项下拉选择 |
| RadioGroup | radio | 1–8 项可见单选按钮 |
| ProgressBar | progress | 只读连续值，宿主更新 |
| Input | input | 单行文本/密码、验证、只读 |
| ScrollView | overflow:auto；List 的视口 | 裁剪、滚动、键盘定位 |
| Tabs | tabs | 2–8 页，保留各页状态 |
| List | list | 1–64 个文字选项，单选、滚动 |
| Dialog | dialog | 独立开闭状态、模态、打开及关闭按钮 |

12 种内容行加布局构造覆盖全部 16 种实际节点。`Image` 的缺图占位仍是 Container/Text；覆盖夹具使用已验证 PNG，避免把占位误计为 Image。

## 新组件的边界

- `checkbox`：enabled、initial，与 Switch 分开编译和编辑。
- `radio`：options 中恰好一个 initial:true；选项名保留原文。
- `list`：固定 ID 的文字选项；itemHeight 32–96，visibleItems 1–12。通过 List + ScrollView 保留独立列表语义、鼠标/键盘选择和可见范围。当前支持有界文字项，不包含任意重复控件模板、网络数据源或虚拟化。
- `dialog`：label 是打开按钮；title、text、closeLabel、modal、initial、dialogWidth、dialogHeight 显式声明。根画布上的 Dialog 不被面板滚动裁切；模态时阻挡背景输入，关闭后恢复打开按钮焦点。它是消息弹窗，不支持任意嵌套表单。

明确要求 CheckBox、RadioGroup、List 或 Dialog，却用其他类型替代的方案会在 `checkPanelProposal` 阶段以 `PLAN_COMPONENT_REQUIREMENT` 拒绝；不以编译成功冒充语义符合。此检查覆盖明确组件名，完整自然语言理解仍属于模型验收范围。缺少必要选项、默认值或正文时保留澄清流程。

## 编辑与接入

通用增删、名称、启用、初始值编辑适用于相应新类型，并受选中范围和同一十轮预算约束。新增三个原子操作：

- `set-choice-options`：Select/RadioGroup/List 的选项及 authored initial ID，存活选项保留 ID。
- `set-list-properties`：itemHeight 和 visibleItems。
- `set-dialog-properties`：title、text、closeLabel、modal、dialogWidth、dialogHeight。

编辑保留当前试玩状态；删除当前已选项会整批失败，调用方需显式提供合法当前状态。撤销恢复原规格和试玩值。
`PanelHost` 实例的 `setState()` 设置当前选择/复选框/弹窗，`setDialog(fieldId, boolean)` 提供弹窗专用入口；宿主写入不发玩家事件。用户操作通过已有 fieldId/value 事件接入业务端口，Dialog 的打开/关闭也遵循此规则。
UGUI 保留相同布尔/枚举 ID，使用 Toggle、选项 Buttons、ScrollRect 和独立 Dialog 对象，统一 PanelController 管理状态、禁用和生命周期。

## 可重跑验收

```sh
node --test tests/all-components.test.mjs
node --test tests/*.test.mjs
node scripts/build-all-components-review.mjs --output output/all-components-review
node scripts/check-all-components-browser.mjs --review output/all-components-review --output output/all-components-browser
```

生成/编辑替身走真实 native schema、上下文摘要、工作台、编译与打包。浅深色浏览器检查真实鼠标/键盘、列表末项滚动、模态阻挡、焦点恢复、宿主静默写入、实例关闭重开、JSON 验证、实际 ZIP 下载及离线刷新。
安装后的 SDK 另外使用锁定 Component 发布包验收，避免工作区依赖掩盖缺失能力。
所有这些确定性验收的真实模型及图片生成调用为 0，不把它们记作模型理解或用户美术批准。

## 本次交付验收（2026-10-13）

| 验收层 | 结果 | 工作区证据 |
| --- | --- | --- |
| 全量源码回归 | 1545/1545，通过；无跳过 | `output/full-components-regression-final-v2.log` |
| 安装后的 rc.5 SDK | 35 项，通过；10 次替身生成/编辑 | `output/all-components-sdk-installed-final-v2/installed-package-report.json` |
| 安装后 SDK 的 16 组件浏览器交互 | 浅、深色共 12 项，通过 | `output/all-components-sdk-browser-final-v2/browser-report.json` |
| SDK 原有 ESM/IIFE 与交付浏览器回归 | 17 项，通过 | `output/all-components-sdk-general-browser-final-v2/browser-report.json` |
| Unity 6000.3.7f1 原生导入和真实 Play Mode | 46 项，通过；新增四类各 1 个，11 个禁用控件；无意外错误日志 | `output/all-components-unity-v5/unity-validation.json`、`unity-smoke.json` |

Unity 本次使用隔离工程及无图形模式，验证原生节点、布局、控件回调、状态和生命周期；没有把它记作 Unity 画面渲染或人工视觉批准。浏览器截图已核对文字可读性和弹窗布局。原生 `.unitypackage` 中的本机测试字体仅用于隔离验收；可移植 SDK 不携带该字体。

前序失败目录保留：Unity v2 发现输入校验提示越界，已修复并加入节点边界回归；v3 是旧编辑器与启动检测不匹配；v4 是旧验收断言未适配“首次用户编辑后显示空值错误”的现有合同，修正后同时验证了编辑前隐藏、编辑后显示。v1 是编辑器授权启动失败，未作为组件结果。

全量回归的前次末轮日志 `output/full-components-regression-final.log` 保留了 Windows 临时测试目录重命名 `EPERM`；降低测试并发后全量 1545 项重新通过，没有跳过目录链接边界检查。

可试玩文件为 `output/all-components-sdk-installed-final-v2/all-components/index.html`，包含浅深色及实际下载包。本地候选为 `output/all-components-sdk-final-v2/ai-ui-panel-harness-0.1.0-rc.5.zip`，字节数与 SHA-256 由同目录 `package-report.json` 记录；当前工作树有未提交修改，候选未发布。

日常入口仍是 `npm run studio`。重新启动后，新生成使用 16 组件目录；已经运行的旧 Studio 不会自动替换。导入的旧面板继续按其原版本重放。
