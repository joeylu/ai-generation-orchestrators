# UI Panel Harness · 0.1.0

从自然语言需求生成可交互的游戏UI面板：检索自有PNG/SVG资源，校验结构化方案，由确定性程序编译引擎无关的PanelSpec，使用Pixi预览并导出交付包。
第一版以Web/Pixi为主要验收入口，提供Unity UGUI导入工具包；无MUIP运行时依赖。

## 从这里开始

- [使用与启动](docs/start-here.md)：构建 Studio、生成、修改、试玩、撤销和下载。
- [文档索引](docs/index.md)：按生成编辑、资源交付和历史验收查阅。
- [目录与依赖边界](docs/structure.md)、[命令索引](docs/commands.md)：维护入口及只读依赖预检。
- [本次源码收尾](docs/v1-candidate-2026-10-08.md)：此前版本的范围、验收与保留边界。
- 本地第一版交付目录（本地产物：`output/ui-panel-closeout-v1/index.html`）：历史面板、组合和修改预览；本地产物不随 Git 提交。

Studio 网址以启动命令打印的地址为准，旧静态页面不会自动更新。

## 当前能力

| 能力 | 说明 |
| --- | --- |
| 控件 | Slider、Switch、Select、Button、静态Text、Progress、单行Input |
| 主题 | 浅色／深色 × 薄荷绿、蓝、紫、橙；在需求描述中指定 |
| 自定义样式 | 已生成的modern-v3面板可编辑不透明颜色与统一圆角；生成仍使用预设主题 |
| 布局 | 横排、纵排、双列、嵌套分组、垂直滚动、2–8页签Tabs |
| 面板尺寸编辑 | 已生成的modern-v3面板支持精确比例和固定宽高；画布同步调整，过小尺寸整批拒绝 |
| 局部修改 | 默认值、名称、启用状态、范围、输入约束、有限增删、重置/提交字段和布局；存活试玩值保留 |
| 撤销/文件往返 | 整批撤销恢复修改前规格与试玩值；PanelBundle可以导出后重新打开 |
| 资源 | PNG/SVG增量入库、语义标签与文本排序、精确版本引用、选材摘要绑定、PNG内嵌 |
| 组合/宿主 | 确定性组合器、实例隔离、显式事件及业务端口绑定 |
| Web交付 | 离线Pixi预览、可挂载适配器、字段/事件接线说明 |
| Unity交付 | 原生UGUI控件、共享状态/事件适配脚本、Prefab与unitypackage的编辑器导入工具；统一Assets/PanelHarness目录 |

Studio首页保留需求描述、生成按钮、修改要求和修改按钮；右侧是实际Pixi交互预览。
打开、下载和撤销位于「面板操作」，规划/资源/属性及调试工具折叠在「高级工具」。
Studio的modern-v3生成运输格式为PanelIntent 0.10 / PlanningContext 0.9，静态正文可直接多段换行；编辑为CodexEditDraft 0.3。已保存协议继续按其版本严格校验。
modern-v3 的新编辑使用 EditContext 0.12，可选择单控件，并独立核对明确的属性与完整指定的修改范围；统一自定义样式使用 Spec/Bundle 0.8，同组按钮排列使用 0.9，单按钮样式使用 0.10，独立按钮文字／符号字号使用 0.11 与编译器 0.11.0；标题对齐与底板使用 0.12 与编译器 0.12.0；正文换行使用 0.13 与编译器 0.13.0；面板比例与固定尺寸使用 0.14 与编译器 0.14.0；保存的旧上下文和交付包保持原版本。详见[独立字号](docs/panel-button-font.md)、[正文换行](docs/panel-text-wrap.md)、[面板比例](docs/panel-frame.md)、[组合布局编辑](docs/panel-layout-details.md)和[修改结果核对](docs/panel-edit-request-checks.md)。
核心检索、结构、状态、布局、校验及打包不依赖模型提供方，可选本地Codex适配使用`gpt-6-luna / xhigh`。

## 验收证据

| 验收 | 已执行结果 | 说明 |
| --- | --- | --- |
| [16类两轮真实结果](docs/panel-title-stability-results-2026-10-06.md) | 32份真实来源、每轮5种组合、898项浏览器检查、42份实际ZIP离线往返 | 新v2期望显式接受画质grid外的等价单子column；原批31/32及FAIL保持 |
| [10步真实连续修改](docs/edit-chain-results-2026-10-06.md) | 10/10、123项浏览器检查、10份实际ZIP及逐步/整链撤销 | 实际10次、无重试，仅最新声音来源的固定修改链 |
| 授权前单元回归 | 727/727 | 测试使用夹具/替身，不提交模型请求 |
| [视觉主题优化](docs/panel-visual-style.md) | 734项回归、518项浏览器检查、24份实际ZIP离线往返 | 保存的16份真实面板换主题、3份程序夹具及5种组合；本轮新增模型0 |
| [浅深模式与四主色](docs/panel-themes.md) | 749项回归、701项浏览器检查、32份实际ZIP离线往返 | 八主题夹具与保存结果重编译；本轮新增模型0 |
| [按用途排版](docs/panel-presentation.md) | 764项回归、443项浏览器检查、26份实际ZIP离线往返 | 表单、对话框、菜单、设置与组合夹具，修复连续中文输入；本轮新增模型0 |
| [用途排版真实复验](docs/visual-smoke-acceptance.md) | 5/5真实调用、五份390宽度布局、实际ZIP校验及重导入 | 无重试；769项回归证据绑定该批次源码，窄屏仅检查可见布局 |
| [原生Unity接入](docs/unity-game-integration-acceptance-2026-10-06.md) | 先前隔离环境的UGUI与宿主业务验收 | 不替代上述最新批次的原生验证，普通下载包仍标NOT_RUN |

这些成绩只证明报告中指定的请求、构建和来源。程序夹具、保存结果重放、原生引擎和人工视觉分别记录；历史失败不回填为成功。
最新生成及修改包的Unity原生导入本轮未运行，Cocos/Godot/UE适配尚未实现。

## 快速构建

需要Node >=22.18和同仓库`ui-component-harness`源码；已安装的Vite/Pixi/Playwright版本由[开发依赖合同](src/workspace/requirements.mjs)明确限定。预检不会安装依赖或调用模型。
在`ui-panel-harness`目录运行；输出目录必须不存在：

```sh
node scripts/check-workspace.mjs
node --test tests/*.test.mjs
node scripts/cli.mjs validate examples/audio-settings.panel.json
node scripts/build-workbench.mjs --catalog examples/modern-adaptive.catalog.json --output output/my-studio
node scripts/serve-workbench.mjs --workbench output/my-studio --output-root output/my-codex-runs --port 0
```

构建和启动不会调用模型。直接打开静态`index.html`可以导入、试玩和导出；点击生成/修改须使用本地服务打印的网址，并先安装、登录Codex CLI。
每次点击最多提交一次调用；失败、取消、超时或结果不确定后不自动重试。批量真实验收必须事先冻结计划并取得该摘要的单次授权。
需要完整自有资源池时，构建命令加`--assets <已验证资源库目录>`；Sharp无法直接解析时再加`--sharp-module <已安装的模块目录>`。
资源目录和本机CLI/模块路径只作为显式本地输入，不进入公共面板包。

## 文档入口

- [通用资源增量导入](docs/asset-import.md)、[纹理重绘与筛选](docs/texture-library.md)、[面板选材](docs/asset-planning.md)
- [布局](docs/panel-layout.md)、[进度条](docs/panel-progress.md)、[Tabs](docs/panel-tabs.md)、[输入表单](docs/panel-forms.md)
- [自然语言编辑](docs/panel-editing.md)、[Codex接入](docs/codex-planner.md)、[PanelSpec/事件映射](schemas/panel-spec-v0.7.schema.json)
- [确定性组合](docs/panel-composition.md)、[多面板宿主](docs/panel-host.md)、[Web业务绑定](docs/game-binding.md)
- [面板交付包](docs/panel-delivery.md)、[Unity导出](docs/unity-export.md)、[Unity业务SDK](docs/unity-game-binding.md)
- [16类评测方法](docs/panel-evaluation.md)、[修改链计划](docs/edit-chain-plan-2026-10-06.md)、[完整历史证据](docs/tasks.md)

## 交付边界

本版是同仓库的工作区开发集成，尚未发布独立生产SDK。生产消费仍需另行发布并核验不可变标签和摘要。
固定画布缩放与有限布局规则不能替代任意响应式设计；未嵌入字体，不保证跨设备字形一致。
矢量检索、动态图标、任意控件皮肤、任意脚本/表达式、嵌套Tabs和其他引擎适配不在第一版范围内。
Studio每个面板最多成功修改10轮，失败、澄清与无需修改不计数；撤销、恢复旧版本和同地址重新打开同一面板不返还轮次，成功生成新面板后重新开始。高级属性和补丁入口共用上限；达到上限仍可试玩、撤销和导出，无redo。Studio自动保存需求/修改草稿、轮次、最近面板和试玩值，跨刷新最多保留8个面板版本；容量不足时减少旧版本。入口在「面板操作 → 历史版本与本机存档」。记录仅限当前浏览器与地址，长期备份仍应导出；撤销栈、未完成的生成和方案上下文不跨刷新恢复。详见[Studio本机保存](docs/studio-storage.md)。
默认值存于PanelSpec，试玩值存于PanelBundle，恢复默认才应用创作初值。
`output/`、`.tmp/`、浏览器结果和模型运行记录保持为忽略的本地产物；源码提交不包含机器配置、认证文件或临时代理设置。
