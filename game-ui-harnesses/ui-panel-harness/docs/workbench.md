# 本地面板工作台

预览区新增「下载交付包」，包含可离线运行的 Pixi 预览、Unity 导入工具包与业务字段/事件说明。
共享接入 SDK 从「面板操作」单独下载，安装一次供多个面板复用，见 [交付流程](panel-delivery.md)。

工作台首页保留「需求描述 + 生成面板」「修改要求 + 修改面板」和交互预览。
可从折叠的口语示例开始。缺少业务信息时，支持点选推荐回答或自己填写；采用后再生成/修改，
不会自动调用模型。预览旁显示控件摘要，默认值与按钮行为可展开核对，见[需求引导](studio-requirements.md)。
需求可指定浅色／深色及薄荷绿、蓝、紫、橙主色；修改未提及时保持现有主题，见[主题选择](panel-themes.md)。
新目录按分区用途排版，表单输入标签在上，确认与取消采用底部按钮组，见[按用途排版](panel-presentation.md)。
资源检索、方案校验和确定性编译仍在后台执行；报错、进度与澄清问题就近显示。
打开/导出、Unity 下载和撤销集中到预览旁的「面板操作」。
规划文件往返、资源候选、属性编辑、补丁和事件证据位于菜单中的「高级工具」，默认不占首页。
输入表单可生成、修改、保留当前输入及导出原生 InputField，见 [输入表单](panel-forms.md)。
普通生成自动分配 `panel-<UUID>` 标识：需求或资源风格变化时使用新标识，相同输入重复准备时保留。
补充回答、示例载入沿用其来源标识；修改和撤销已有面板保留原 ID。
高级工具中手动填写标识会改为固定命名，清空该字段恢复自动命名。
PanelSpec 0.4 的容器布局、滚动区、静态文字与纯按钮菜单也可导入、编辑标签、撤销和导出，
见 [布局能力 v1](panel-layout.md)。可滚动预览会显示操作提示。
静态模式无需启动服务，使用外部 Agent 文件往返。可选的本地 Codex 模式直接调用已登录的
Codex CLI，以 `gpt-6-luna / xhigh` 生成方案；随后仍通过同一校验、编译与 Pixi 预览流程。
启用步骤见 [Codex 接入](codex-planner.md)，无需给网页填写模型密钥。

## 构建与使用

从 `ui-panel-harness` 运行，输出目录必须不存在：

```sh
node scripts/build-workbench.mjs --catalog examples/modern-adaptive.catalog.json --output output/my-panel-studio
```

上述版本可以使用程序控件；若需要资源检索，附加 `--assets <通用资源库目录>`。
完整示例工作台可这样构建：

```sh
node scripts/build-workbench.mjs --catalog examples/modern-mint-controls.catalog.json --assets output/generic-library-migrated-v1 --example-context output/settings-controls-context-final/planning-context.json --example-proposal examples/controls-planning/proposal.json --output output/my-panel-studio
```

需要时加 `--sharp-module <已安装的模块目录>`。脚本先用既有资源验证程序复验全库，再编译页面，
最后发布新目录及实际文件摘要。构建只读相邻组件源码和已安装 Vite/Pixi，不写入其源码或 dist。
这是工作区工具，尚不是生产 SDK 的不可变发行包。

用桌面浏览器打开 `index.html`；保持它与同目录 `workbench.js` 一起移动。
若要一键生成，请通过本地启动命令打印的网址打开；`file://` 页面不能直接启动 CLI。

1. **生成。** 填写「需求描述」，点击「生成面板」。程序重新检索、调用一次 CLI、校验方案并显示预览。
   无需手动准备规划或导入 JSON。需求最多 8000 个 Unicode 字符，原文完整保留。
   有缺失信息时显示具体问题；点击「补充回答」后再手动点击生成。补充答案不自动调用模型。
2. **修改。** 在「修改要求」填写变化，点击「修改面板」，自动准备当前面板上下文并取得有限补丁。
   应用保留当前试玩值；新默认值在面板中的恢复默认操作时生效，并在成功提示中说明。
   支持取消；失败或存在未决问题时保留旧面板，不自动重试。
   修改问题显示在描述下方，补充后再手动点击修改，见 [自然语言编辑](panel-editing.md)。
   明确无需修改时显示“无需修改，当前面板和输入已保留”，不刷新预览、不增加撤销记录。
3. **试玩。** 在右侧直接操作真实 Pixi 控件。处理期间锁定交互，结束后恢复。
4. **撤销与导出。** 打开「面板操作」。撤销恢复上一次修改前的方案和试玩状态。导出得到既有 PanelBundle，
   包含当前语义状态、原始创作初值、动作和实际选中的 PNG，可以重新打开。
   点击“下载 Unity 工具包”得到 ZIP，解压后按其中的 README 在 Unity 创建 Prefab。
   工具包包含点击时的试玩值、创作初值、实际选中的 PNG 与适配脚本，离线页面也可下载。
   原生创建、字体和宿主事件接入见 [Unity 导出](unity-export.md)。

需要外部 Agent 文件往返或精确属性编辑时，从同一菜单打开「高级工具」。其中保留
`planning-context.json` 和 `edit-context.json` 的准备、下载、方案导入以及表单/补丁修改。
技术工具也可通过 `#advanced` 打开，不会替换当前面板或发起模型调用；关闭后恢复精简首页。
离线文件页面会提示生成入口未就绪，仍可从菜单打开面板、载入示例并导出。

“载入完整示例”会走同一 prepare、proposal 校验和编译流程；该例子明确标为
`programmatic-fixture`，不代表任意需求都会被程序自动理解。
修改需求后必须重新准备上下文，旧方案不能覆盖新请求。原面板保留到新方案通过为止。

补充回答绑定当前需求与当前问题方案，两者任一变化都不能沿用旧绑定。
每个问题须有且仅有一条非空答案，每项最多 2000 个 Unicode 字符；原文与问答合计仍受
8000 字符上限约束，不自动截断。校验失败会保留已经填写的答案，重新准备成功才清空问题表单。
回答是提供给 Agent 的业务资料，不是已经通过语义校验的新方案。

## 修改边界

表单操作生成绑定当前 Spec 摘要的 PanelPatch。高级折叠区可直接提交已有的有限 Patch 操作，
并导出最后一份补丁。操作按稳定 ID 定位，不支持任意脚本或数组路径。
增加状态行时必须明确提供状态定义；按钮使用 `state:null`。

每次修改先校验整批操作、完整状态、配方、资源和几何，并实际渲染候选，再提交。
文字测量溢出或图片解码失败时保留原面板、试玩状态与修改历史；仍可继续编辑、撤销和导出。
处理期间暂时禁用预览交互并取消尚未提交的拖动，结束后恢复各控件原有启用状态。
已显示面板若发生 WebGL 上下文丢失，会明确报错并停用编辑/导出，可重新打开面板恢复。
最多保留 16 次修改，达到上限会明确拒绝；可撤销，或导出后重新打开以开始新的修改记录。
当前版本没有 redo，也不会在浏览器存储中自动持久化。刷新或关闭前请导出。
原 proposal/规划报告作为历史依据保留，修改记录另行保存；原资产证据的 selectedKeys
不冒充修改后的当前选材结果。当前面板的资源由 PanelBundle 重编译验证。

## 离线资源池的验证范围

工作台打包完整 `asset-library.json` 与其全部去重 PNG。保留完整索引是为了重新计算检索排名，
避免只嵌入局部候选后漏掉更高版本或更相关素材。不会嵌入源 SVG 文件、预览图或机器路径。

- Node 构建阶段：原资源库文件、图片、源渲染与预览重放由 `verifyAssetLibrary` 验证。
- 浏览器阶段：复验完整索引摘要、元数据、PNG 集合、规范 base64、字节摘要、字节数和 PNG 头尺寸，
  并针对当前需求从整个索引重算候选。选中的 PNG 由实际浏览器渲染器解码。
- 浏览器不会重跑 Sharp 或源 SVG；报告使用独立的 `EMBEDDED_POOL_CHECKED`，
  `sourceReplay: NOT_RUN`，不冒充原 CLI 的全库源重放报告。

摘要证明内容一致性，不是数字签名或作者认证。索引里保留的历史验证字段不是浏览器的新验证。
资源池最多 512 条记录、512 份 PNG，索引最多 4 MiB，每张 PNG 最多 1 MiB，PNG 合计最多 16 MiB。
实际单个 PanelBundle 继续只选必要 PNG，合计上限 1 MiB；面板/方案文件导入上限仍为 2 MiB。
完整资源池嵌在静态页面中，不扩大原通用 `readJson` 和 PanelSpec 的边界。

## 验证

当前工作区构建为`output/panel-studio-visual-v3/`，本地入口为4198；移到其它工作区时按[启动说明](start-here.md)重新构建并使用实际打印的地址。新版主题见[视觉样式](panel-visual-style.md)，分页和输入表单能力见[Tabs](panel-tabs.md)与[Input](panel-forms.md)。
使用带布局能力的目录和 0.4 设置示例。
单元/集成测试、旧版浏览器回归及新版布局/工作台的实际验证范围见 [任务证据](tasks.md)。
调用浏览器回归使用规划替身。用户随后真实 CLI 声音设置草稿已通过公共提案检查并在网页
显示；同一成功方案经确定性构建产生修正版独立按钮面板，另有 6 项实际浏览器交互检查。
这证明该需求的规划和下游链路，不表示任意自然语言需求或 Unity 原生导入都已验收。

随后按用户要求，用对话 subagent 生成了新的真实方案，工作台导入、渲染、导出和重开
5 项检查通过；独立静态预览另通过 15 项交互检查。该样本保存在 `output/subagent-settings-v1/`，
预览为 `output/subagent-settings-preview-v1/index.html`。这验证了 Agent 方案的下游流程，
网页直接调用 subagent 尚未实现，Codex CLI 的连通状态不因此改变。

```sh
npm test
node scripts/check-workbench-browser.mjs --workbench output/my-panel-studio --output test-results/my-panel-studio
node scripts/check-simple-workbench-browser.mjs --workbench output/my-panel-studio --output test-results/my-panel-studio-simple
```

浏览器验收使用已安装的 Edge/Playwright 和真实 Pixi，通过可见按钮、文件导入与下载执行流程。
旧文件/属性验收明确打开高级工具；精简页验收使用本机服务和注入的规划、编辑替身，
不启动模型进程或访问私有服务。报告另存，构建清单不被手动改成浏览器已验收。
固定样本验收不代表任意布局或用户视觉确认。[Unity UGUI 适配器](unity-export.md) 可通过工作台
下载导入工具包，也可从 CLI 处理通用包；Prefab 在 Unity 中创建。Cocos/Godot/UE 原生导出未实现。

界面按本地 `ui-ux-pro-max` 的通用可访问性与表单反馈规则实现：显示标签、可见键盘焦点、
按钮忙碌态和就近错误；采用本项目薄荷色系与系统字体，没有 CDN 字体依赖。
此次搜索命中表单反馈与关联标签规则；双栏布局由生成、修改和预览的实际操作顺序决定。
