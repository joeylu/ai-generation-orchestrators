# SDK 示例原型

默认样本采用用户选定的组合：设置使用旧版流式设计，开始页增加居中底板，加载页保留圆形加载占位并合并状态文案，暂停与结算按 Geminant WebView SDK 默认 skin 的明确尺寸与位置转录。固定坐标样本采用公共 ui-panel-harness 的 `fixed-reference-1` 只读原型模式完整重放。此前流式版本保存在 `examples/sdk-panels.mjs`，完整 SDK 几何版本位于 `examples/sdk-fixed-panels.mjs`，选定的表现层调整位于 `examples/presentation-layouts.mjs`；`template-previews.mjs` 统一选择预览与导入来源，两份原始样本均保留。

| 类型 | 原型 ID | 内容 |
| --- | --- | --- |
| 开始页 | sdk-ready | 居中520×300底板；游戏标题与开始按钮居中，宽度适应较窄画布 |
| 设置 | sdk-settings | 600×472；旧版三个开关、语言下拉、底部居中关闭按钮；仅保留一个设置标题，不含关闭分组标题 |
| 暂停在线 | sdk-pause-online | 520×228；已暂停、继续 |
| 暂停本地／离线 | sdk-pause-local | 520×308；已暂停、继续、菜单 |
| 完成结算 | sdk-result-complete | 560×448；通关标题、得分、用时、完成状态、再来一局 |
| 失败结算 | sdk-result-failed | 560×448；未通关标题、得分、用时、完成状态、再来一局 |
| 加载中 | sdk-loading | 紧凑600×208底板，进度条位于画布与底板正中；只读 60% 进度、正在准备图片 |
| 加载失败 | sdk-loading-failed | 600×300底板，进度条与加载中共用居中位置；只读 40% 进度、失败提示替换阶段文案、重试、返回 |

所有样本使用同一 960×800 逻辑画布。五类入口下切换状态，选中的具体原型 ID 决定预览和导入；变体各自可作为项目内独立参考图。开始页不假设商城、退出或存档功能。多语言例子使用简体中文／English；单语言游戏可以按 SDK 合同隐藏语言行。结算三项指标只用于展示动态指标区，实际游戏只渲染 registry 声明的指标。

系统文案采用 SDK 简体中文默认词条。用时按数值加「秒」单位展示，不假设 SDK 会自动转成分秒计时格式。设置使用独立的 `ui-reference-settings@0.2.0` 数据主题，将关闭按钮并入设置内容底部，复用公共生产器的现有最简标题策略，仅保留面板标题；原始控件、状态和关闭动作保留。关闭按钮为112×56，底部居中；不修改原始流式样本、catalog 或生产器。

这是一套美术参考输入，不运行 bridge、SDK 设置写入、单局重开或资源下载。固定布局样本没有交互会话或动作接线；旧版设置保留公共流式原型的状态和示例动作。状态由样本明确给定，进度不自动增长。加载进度为 ProgressBar，选定原型保留静态圆形 spinner 占位，位于底板顶部与进度条之间的中间位置；加载中和失败的进度条及状态文案共用位置，失败仅保留错误文案，下方显示重试和返回。SDK FancyButton 的0.5锚点在原始对照中转换为左上角矩形。字体字形、浏览器默认行高及动态效果不属于几何复现保证。

原始 SDK 对照的尺寸来源：Settings `scripts/runtime-generators.mjs` 的默认 SettingsPanelSkin；UI `scripts/install.mjs` 的 `makePausePanelSkinTs` / `makeResultPanelSkinTs`；Preload `scripts/create-geminants-webview-skeleton.mjs` 的 `.game-ready`；Scene Loader `scripts/runtime-generators.mjs` 的默认 SceneLoaderSkin。它们均来自初始包对应的公开模块；只转录所需的布局常量和公式，不执行安装器或复制业务实现。开始页与加载页的当前默认布局包含明确的用户定制，不再宣称与 SDK 默认几何相同。这里使用960×800是固定对照视口，不代表SDK固定分辨率。

固定布局模式只用于参考输入，可上传完整 `*.panel.bundle.json`。不宣称支持 Panel Studio 流式编辑、交互试玩或 Unity 原生导入。设置仍使用原有流式 PanelSpec/Bundle；编译器和归档指纹保持原语义。用户可见 `sdk-settings` 已选择旧版，`fixed-sdk-settings` 只保留 SDK 几何对照；已有项目不自动迁移。

`scripts/write-sdk-comparisons.mjs <新输出目录> <显式Sharp模块入口>` 可确定性生成八组旧／新PNG对照、完整新版Bundle、总览和HTML索引；模型调用为0。输出目录必须不存在，不覆盖原始样本。

首屏 Boot Loader、受管理运行错误面板、初始化失败提示不进入普通示例选择。新入口不展示旧的游戏大厅／退出确认／通用控件展示例子，但旧模板 ID、原始样本与已有项目保持兼容。风格确认用的统一对照原型和已接受六种风格样本本轮不重新生成。

回归覆盖公共生产器完整 Bundle 往返、可见范围、控件数量、模式差异、SVG 预览、所有新样本的 API 导入及冻结计划；测试不提交生成请求。实际图片仍须用户显式生成并验收。
