# Scene Kit 本机运行目录

Scene Kit 的参考规划、来源拆分、地形派生、交付与 Studio 代码均在本 Harness 的
`src/`、`scripts/`、`schemas/`、`adapters/`。工作步骤见
[Agent 执行入口](agent-workflow.md)。

Windows 项目从本 Harness 目录使用 PowerShell 7 启动。

```powershell
pwsh -NoProfile -File scripts/start-studio.ps1
```

启动器读取 `.local/studio.json`，也可用 `-Config LOCAL_JSON` 显式指定本机配置。
它核对固定提交、当前 Scene Kit 与可选适配器源码、工具文件摘要、项目 ID、风格锚图和
动画进程，按配置启动一个回环编辑器及两个独立 CLI 工作进程。已有端口的提交或项目
不匹配时报告错误。启动核对完成后输出编辑器 URL。

配置示例为 [studio.local.example.json](../examples/studio.local.example.json)。
将示例中的零值改为实际的完整 Git 提交、已有项目 ID 和已安装工具的 SHA-256。
所有文件路径相对于配置文件所在目录解析。工具由本机安装方准备，启动器只验指纹。
生成采用 Codex CLI 的 ChatGPT 登录，每次生成仍走对应的确切计划确认和持久预约。

本机素材和项目默认按下列结构保存，整个 `.local/` 已加入 Git 忽略。

| 目录 | 内容 |
| --- | --- |
| `.local/studio.json` | 本机项目、工具和固定提交配置 |
| `.local/samples/<sample>/source-project/` | 原始工作流、计划、来源 PNG 和决定 |
| `.local/samples/<sample>/delivery/` | 已校验的素材包、默认地图、对照图和 ZIP |
| `.local/samples/<sample>/reviews/` | 独立人类美术决定与技术审阅原件 |
| `.local/projects/<project>/workspace/` | 当前项目素材快照与自动保存的地图 |
| `.local/projects/<project>/environment/` | 素材生成的交换记录与原始输出 |
| `.local/projects/<project>/animation/` | 动画生成的交换记录与原始帧表 |
| `.local/projects/<project>/private/` | 本机适配器执行记录 |
| `.local/tools/` | 已安装并验指纹的可选 CLI 工具 |
| `.local/logs/` | 本机启动日志 |

升级代码时先完成相应回归并提交，再更新本机配置中的 `releaseCommit`。
更新正在编辑的项目时先核对自动保存已完成、生成工作进程空闲，再重新启动。
导出项目 ZIP 可备份当前地图和素材，原始工作流和审阅记录须另外备份。
验收决定随其原对象保存，搬迁目录时逐文件核对摘要，保留原记录。
