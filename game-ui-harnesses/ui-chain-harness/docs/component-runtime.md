# 组件候选运行时与离线验收

本文主要记录早期 fixture 组件验收入口：全部 16 类已有可执行适配，覆盖实例化、交互、销毁和三档尺寸/适用状态恢复。当前同一运行时也已接入核验过的真实 PNG 皮肤、字体、材质及 Studio 面板编辑；当前全链路入口和验收边界见[验收指南](acceptance.md)，早期阶段记录保留在[执行文档](execution-plan.md)。

## 查看与重建

在 ui-chain-harness 目录执行：

```powershell
npm run components:check -- --browser chrome
npm run components:status
```

使用已安装的 Chrome、Edge（msedge）或 Playwright Chromium；不自动安装浏览器。验收页面通过内存 bundle 加载，阻断网络请求，软件 WebGL 渲染，不监听端口。字体来自 lockfile 锁定的 @fontsource/noto-sans-sc@5.3.1，内联加载后才创建文字；不依赖机器的系统中文字体。

[current.json](../previews/components/current.json) 是唯一当前入口。status 返回 current/stale/corrupt/missing；current 只说明产物完整且与当前工程源一致，不代表完整 P1 通过。查看返回的 builds/UUID/overview.md，其中提供 16:9 与 9:16 PNG、四张 1440×1440 尺寸/状态对照 PNG 和逐项断言。

check 同时写出冻结输入 inputs.json、report.json 和包含来源/文件摘要的 build-record.json。PNG 为 PixiJS 实际渲染结果。皮肤的 1:1 独立部件模板仍在 previews/skin-templates；这里的横竖版和方形图均是已组装组件的工程验收图。每张方形图放 4 类 × 3 档尺寸/状态，图的数量按类型数量派生。

每次先写 .staging/UUID。断言失败、越界、浏览器错误或构建期间来源改变不切换 current；成功版本保留在 builds，失败候选保留在 .staging。只有在确认没有检查进程仍在运行后，才可清除异常退出留下的 .build.lock 文件。不要手改报告或指针。

只跑交互而不生成版本产物：

```powershell
$env:UI_CHAIN_TEST_BROWSER = 'chrome'
npm run test:components
npm run test:render
npm test
```

## 维护边界

| 源 | 负责内容 | 修改后的检查 |
| --- | --- | --- |
| configs/skin-template-set.draft.json | 部件身份、形状、尺寸与分板；程序皮肤也读取这些部件 | templates:validate/build；contracts:validate；components:check |
| configs/component-registry.draft.json | 配方、默认属性、事件、角色和验收规格 | contracts:validate/build；components:check |
| configs/skin-usage.draft.json | 角色到资产的候选映射及正式使用元数据草案 | contracts:validate/build；components:check |
| fixtures/neutral.skin.json | 工程测试的配色、固定字体、间距与几何参数；由 fixture-profile.schema.json 校验，不覆盖正式源中的 null | npm test；components:check |
| fixtures/component-cases.json | 每类一个示例的文字、数据与尺寸；独立测试输入，不是生产默认值副本 | components:check |
| fixtures/component-matrix.json | 三档尺寸、长文本与适用更新值；测试与方形对照图共同消费 | components:check |
| src/runtime/ | 交互、资源生命周期、几何计算，以及程序皮肤和核验 PNG 皮肤的适配 | npm test；test:components；components:check |
| tests/runtime/checks.mjs、matrix-checks.mjs | 独立操作及预期断言；增加能力时补测试 | test:components；components:check |

已有类型的新配方可共用类型夹具，运行器遍历注册配方进行挂载，并另外验证新增 Button 配方能消费自己的默认变体。新增真正的组件类型须增加适配器、类型样例和独立行为断言。不能只改 JSON 声称获得新交互。

这三份 fixtures JSON 分别维护测试皮肤、基础场景与展示矩阵。尺寸扩展或测试文案变更不需要同步改测试和出图程序中的两份名单；新的行为断言仍需代码实现。真实风格、字体资源、资产几何、面板预设和项目版本分别由对应皮肤、规划和 Studio 合同维护，不能把所有配置塞进模板 JSON。

## 代码与 API

| 模块 | 职责 |
| --- | --- |
| src/runtime/skin.mjs | 从模板构造共享程序纹理、测试切片、文字测量；统一销毁资源 |
| src/runtime/geometry.mjs | 校验夹具配置，按类型/属性推导最小尺寸，在创建或 resize 前拒绝非法尺寸 |
| tools/panel-slicer/src/ | Panel 与单素材预览/导出共用九宫格、单位转换和原图绑定；旧 src/runtime/sliced-background.mjs、src/slicing/ 为兼容转发；见 [Panel Slicer](../tools/panel-slicer/README.md) |
| src/runtime/controls.mjs | PixiUI 的小范围扩展：标签重排、输入清理与遮罩、步长/取消、竖向滚动条、下拉列表、Dialog、浮层所有权 |
| src/runtime/basic.mjs | 基础控件、Image/Text、Layout Container 和 Panel |
| src/runtime/collections.mjs | List、ScrollView、Tabs、Select、Dialog 的组合与稳定 ID 映射 |
| src/runtime/runtime.mjs | 配方分派、句柄与内容槽、属性校验、状态/事件隔离、生命周期 |
| src/runtime/runtime.mjs | 鼠标/触摸交互与 Input 文字编辑；不提供组件键盘导航或额外焦点框 |
| src/contracts/props.mjs | Node 与浏览器共用的纯属性校验、默认值与语义规则 |
| tests/runtime/ | 内存浏览器页面、测试输入装配和独立交互断言；不是应用前端 |
| scripts/components.mjs | 验收、来源绑定、历史构建和状态查询 |

createRuntime 接受 app、registry、usage、skin、onEvent。create 接受 `{id, recipeRef, props, size, layout?, position?}` 和命名 slots，返回组件句柄。内容槽接收已创建的子句柄；同一个子句柄只能有一个所有者。适配器消费 registry 的默认值与事件声明，未知属性、资源和适配器明确失败。

runtime.mount 挂载句柄。句柄支持 readState、setState、resize、setEnabled、setVisible、snapshot、dispose。setState 仅写运行值并静默更新，不把用户试玩的值写回创建属性。snapshot 返回单节点创作字段，**不含内容树或资源包，也不是 PanelDocument 导出**。setEnabled/setVisible 则直接修改句柄的创作属性，目前不是编辑事务。

resize 先检查类型的最小尺寸与 Text 的溢出规则，再更新几何；这些已知失败不改变当前对象与快照。标签使用原始全文重新测量/省略，保持字号，按钮背景单独拉伸。它还不是能回滚任意内部异常的完整事务。

Panel 支持可选 pixelsPerUnitMultiplier，默认 1、范围 0.125–16。皮肤通过 backgroundSpec 提供纹理及逻辑切线；也可通过 backgroundRef 引用 createRuntime 的可选 panelBackgrounds Map，未知引用在创建前拒绝。背景倍率不改变原图取样边界、文字大小或内容 padding。既有皮肤 minSize 与倍率后的边框下限都需满足。父布局计算好尺寸后调用组件 resize。可移植资源的解码与引用释放由 src/panel/background-pool.mjs 管理，见 [九宫格维护](slicing.md)；Image 与其他控件未作统一抽象改造。

runtime.setMode('edit') 会挂起原生输入、浮层交互和拖动，阻断控件事件；setMode('play') 恢复输入资格。隐藏、禁用、切页、模态遮挡和销毁都参与资格判定。Dialog 的逻辑打开状态与模态占用分离：禁用或切换到 edit 时保留窗口外观，释放模态占用；隐藏时整个窗口隐藏，恢复资格后按原打开状态重新挂接。共享纹理由 skin 所有，销毁组件不会销毁其他组件正在使用的纹理；最后释放 runtime 后再释放 skin 和 Application。

文字使用 pixi.js Text，遵循用户指定的场景文字技能；pixijs-scene-text 是技能名，不额外安装同名包。行为基于 @pixi/ui；Image/Text/Container/Panel 使用 PixiJS 与 @pixi/layout 的基础对象组合。不是给每一种类型套一个不存在的 PixiUI 类。

## 组合与剩余边界

- 早期 62 项是当时的断言子集，不能折算成 G01–G07 / T01–T16 全部通过，也不是当前测试总数。三档宽度、长内容、状态恢复等覆盖以本次生成报告为准；跨主题与设备矩阵仍须单独验收。
- List 支持原有 Button 数据条目，也支持 items 槽中的显式复合子树。条目数量与 itemRecipeRef 必须逐一匹配；single 模式由整行拥有选择操作，none 模式允许内部组件独立交互。工程资源引用由 PanelDocument 递归收集，生产资产闭包另验。
- 早期 fixture 使用 body 文字样式与固定测试字体；当前真实 PNG 皮肤包含显式字体、部件切片和材质资源清单。程序核验不授予人工美术接受。
- 原生 Input 保留桌面文本写入和模拟 composition；按用户要求已移除组件键盘导航与金色焦点框，测试覆盖快捷键不改变状态/不发事件。真实中文输入法、移动键盘和触摸仍待真机验证。
- 夹具几何与最小尺寸集中管理；真实皮肤的切片和安全区由核验后的皮肤元数据提供。句柄 resize 的已知失败前置检查不等于通用回滚；画布事务通过构建完整候选树后替换旧树实现失败保留。
- PanelDocument 编译、自由区域权限、撤销重做、JSON 保存/重开和画布操作已接入[本地编辑器](canvas-editor.md)。Studio 也已接入 AI 面板生成、皮肤消费包与保存副本；完整流程和实际接受要求见[验收指南](acceptance.md)。

本轮通过范围、浏览器版本、来源摘要和余项由 report.json 记录。正式生产配置的待定值和三个结构标记的生产方式保持待定，不由这套程序皮肤替用户做最终决定。
