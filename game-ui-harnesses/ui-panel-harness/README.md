# UI Panel Harness · 0.1.0

从自然语言需求生成可交互的游戏UI面板：检索自有PNG/SVG资源，校验结构化方案，由确定性程序编译引擎无关的PanelSpec，使用Pixi预览并导出交付包。
第一版以Web/Pixi为主要验收入口，提供Unity UGUI导入工具包；无MUIP运行时依赖。

## 从这里开始

- [使用与启动](docs/start-here.md)：构建Studio、生成、修改、试玩、撤销和下载。
- [本地第一版交付目录](output/ui-panel-closeout-v1/index.html)：已接受的16类面板、5种同轮组合和10步真实修改，含预览及实际下载ZIP；本地产物不随Git提交。
- 本工作区当前Studio：`http://127.0.0.1:4197/`。这是运行中的本机地址，其他工作区使用启动命令打印的地址。
- [本版范围及验收](docs/first-version-closeout-2026-10-07.md)，[历史任务和失败记录](docs/tasks.md)。

## 当前能力

| 能力 | 说明 |
| --- | --- |
| 控件 | Slider、Switch、Select、Button、静态Text、Progress、单行Input |
| 布局 | 横排、纵排、双列、嵌套分组、垂直滚动、2–8页签Tabs |
| 局部修改 | 默认值、名称、启用状态、范围、输入约束、有限增删、重置/提交字段和布局；存活试玩值保留 |
| 撤销/文件往返 | 整批撤销恢复修改前规格与试玩值；PanelBundle可以导出后重新打开 |
| 资源 | PNG/SVG增量入库、语义标签与文本排序、精确版本引用、选材摘要绑定、PNG内嵌 |
| 组合/宿主 | 确定性组合器、实例隔离、显式事件及业务端口绑定 |
| Web交付 | 离线Pixi预览、可挂载适配器、字段/事件接线说明 |
| Unity交付 | 原生UGUI控件、共享状态/事件适配脚本、Prefab与unitypackage的编辑器导入工具；统一Assets/PanelHarness目录 |

Studio首页保留需求描述、生成按钮、修改要求和修改按钮；右侧是实际Pixi交互预览。
打开、下载和撤销位于「面板操作」，规划/资源/属性及调试工具折叠在「高级工具」。
当前生成运输格式为PanelIntent 0.8，编辑为CodexEditDraft 0.3；已保存协议继续按其版本严格校验。
核心检索、结构、状态、布局、校验及打包不依赖模型提供方，可选本地Codex适配使用`gpt-6-luna / xhigh`。

## 验收证据

| 验收 | 已执行结果 | 说明 |
| --- | --- | --- |
| [16类两轮真实结果](docs/panel-title-stability-results-2026-10-06.md) | 32份真实来源、每轮5种组合、898项浏览器检查、42份实际ZIP离线往返 | 新v2期望显式接受画质grid外的等价单子column；原批31/32及FAIL保持 |
| [10步真实连续修改](docs/edit-chain-results-2026-10-06.md) | 10/10、123项浏览器检查、10份实际ZIP及逐步/整链撤销 | 实际10次、无重试，仅最新声音来源的固定修改链 |
| 授权前单元回归 | 727/727 | 测试使用夹具/替身，不提交模型请求 |
| [原生Unity接入](docs/unity-game-integration-acceptance-2026-10-06.md) | 先前隔离环境的UGUI与宿主业务验收 | 不替代上述最新批次的原生验证，普通下载包仍标NOT_RUN |

这些成绩只证明报告中指定的请求、构建和来源。程序夹具、保存结果重放、原生引擎和人工视觉分别记录；历史失败不回填为成功。
最新生成及修改包的Unity原生导入本轮未运行，Cocos/Godot/UE适配尚未实现。

## 快速构建

需要Node >=22.18和同仓库`ui-component-harness`源码；Vite/Pixi等开发依赖由相邻Harness提供。
在`ui-panel-harness`目录运行；输出目录必须不存在：

```sh
node --test tests/*.test.mjs
node scripts/cli.mjs validate examples/audio-settings.panel.json
node scripts/build-workbench.mjs --catalog examples/modern-mint-forms.catalog.json --output output/my-studio
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
修改历史最多16步，无redo或自动持久化；刷新前应导出。默认值存于PanelSpec，试玩值存于PanelBundle，恢复默认才应用创作初值。
`output/`、`.tmp/`、浏览器结果和模型运行记录保持为忽略的本地产物；源码提交不包含机器配置、认证文件或临时代理设置。
