# 宿主接入 · 源码发布 0.7.1

新接入优先使用 [项目级 DAG](project-dag.md) 的核心函数或 dag-* CLI；下文的单面板和
plan-project 合同继续有效。DAG 是文件工作区中的确定性编排，不附带 Docker、WebSocket、
账号或队列。服务实现放在消费仓库，前端依据服务侧实际产出的 API 合同接入。
当前 Studio 为 UX 基准；无需把计划／授权拆成额外页面。

宿主用 CLI JSON 或 `src/index.mjs` 组织项目流程，生成由显式宿主图片工具或可选适配器完成。
本 Harness 提供本地文件合同，并有可选的 [本地参考图工作台](../web/README.md)：
项目与面板管理、默认／自定义风格、原型导入、冻结请求、单次生成交换、人工验收及 ZIP 下载。
工作台仅监听 127.0.0.1，直接复用核心，不提供部署、账号或任务队列。
生产安装须固定 `ui-reference-harness-v0.7.1` 及其源码附件 SHA-256，逐项验证 release-manifest.json；
保留附件原始字节及兄弟 Harness 目录关系。升级说明见 [0.7.1 发布说明](release-0.7.1.md)。
该补丁的面板可见性、下载命名与前端同步边界见下文；消费服务须实现自己的实际 API 合同。

## 0.7.1 宿主与前端同步

- 面板删除是宿主持久化的可恢复可见性，不删除核心注册原型、计划、会话、原图或验收记录。
  本地 Studio 提供 `POST /api/projects/:id/panels/:panelId/trash` 和 `/restore`，请求体为 `{}`。
  项目读取返回 `panels` 与 `deletedPanels`；后者附带 `deletedAt`。只读示例拒绝写入。
- 任意面板状态均可删除；已提交的任务继续收尾，不能取消、重投或使面板自动恢复。
  删除后拒绝新计划、生成、修改、草稿和验收，返回 `410 PANEL_TRASHED`；恢复沿用原会话与修改轮数。
  已验证任务的接收、收尾和终止记录仍可完成；固定项目锚点继续保留。
- 新导出按未删除面板显式选择核心子集，响应披露 `excludedPanelIds`；已有交付包不变。
  DAG 宿主也须在创建新 DAG 时选择可见面板，保留原冻结 DAG 和所有在途请求，不改写定义或历史。
  本补丁没有增加核心删除 API 或自动重建 DAG。
- `web/image-export.mjs` 导出 `projectExportFilename(projectName, format)`，`format` 为 `images` 或 `complete`。
  名称分别为「项目名称-reference-images.zip」和「项目名称-references.zip」，替换非法字符并限制长度。
  HTTP 下载可用 `attachmentDisposition(filename)` 保留 UTF-8；WebSocket／Blob 前端须使用相同规则设置下载名。
- 已完成的旧风格预览允许验证后读取和采用。旧计划继续禁止生成；升级前保留原始工作区和固定版本。
  已发布 0.7.0 的运行时摘要 `05670ece585e72d03092564678e49a4b6423e487bf8336c5b626d7faf50b818c`
  被明确识别为可复核、可交付的历史证据；未知摘要仍拒绝。
- 验收必须等待当前大图成功加载；切换结果、图片失败和旧界面操作应清除就绪状态。
  已归档未完成任务保持只读；报错及关闭按钮须在当前模态框之上显示且可操作。

以上 `/api` 路由是 loopback Studio 的参考接口。消费服务和 Web 独立同步各自的协议、持久化、
能力声明和界面；升级源码附件不会自动部署这些实现，也不允许修改安装的核心 vendor。

## 核心流程

| 阶段 | 入口 | 宿主需要呈现的内容 |
| --- | --- | --- |
| 选择项目 | init / status | 同一项目的面板、当前风格及待更新状态 |
| 选择风格 | presets / pack-check / style-create / style-show | 六种默认规则与可选已接受样本，或定制包／用户 PNG；展示确切草案 |
| 激活风格 | style-activate | 记录用户针对该修订的实际决定，不因此授权生图 |
| 导入面板 | import-panel | ui-panel 原型、当前可见状态及中性布局图 |
| 首张参考图 | plan | 单张冻结请求、有序输入、分辨率及摘要 |
| 首图接受 | review --anchor true | 展示结果；由人决定布局／风格／文案并明确选择项目样板 |
| 其余面板 | plan-project / inspect-project-plans | 待生成面板、共同风格及样板、逐份计划／请求摘要和完整请求 |
| 单次执行 | authorize → request/generate → receive | 明确计算范围，一份计划最多一次；结果或未知状态均保留 |
| 接受与交付 | review → status → export → validate | 每张参考图的真实决定和整套交付；任何显式子集准确披露 |

默认样本是项目主风格参考，项目样板是本项目同风格的已接受成图。
新项目不能直接把默认样本当作已接受项目样板；plan-project 在缺少样板时停止，先完成首张代表面板。
更换风格后沿用已有原型，但旧图标记 needs_style_update；新风格也须建立自己的样板。

首图接受后，宿主可运行：

```powershell
$ReferenceCli = "game-ui-harnesses/ui-reference-harness/ui-reference.mjs"
$ProjectRoot = "work/my-game-ui"
$Batch = node $ReferenceCli plan-project --root $ProjectRoot | ConvertFrom-Json
if ($Batch.status -ne "nothing_to_plan") {
  node $ReferenceCli inspect-project-plans --root $ProjectRoot --batch $Batch.batch
}
```

返回 batch 和 review 是项目内相对路径；plans 的 run 也是相对路径。
每份 `$ProjectRoot/<run>/plan.json` 保存确切 prompt、图片角色和 artifact 路径。
可用 `--panels main-menu,exit-confirm` 选择子集，`--intents FILE` 提供各面板的可选文字意图。
先读取返回值和进程退出码；nothing_to_plan 无集合文件。错误时不要盲目继续执行或自动重试规划。

宿主展示集合与完整请求后，用户可以一次明确授权列出的若干计划和总调用数；
核心仍为每份 planSha256 单独写一次性授权。集合 SHA 不能代替单份计划 SHA。
规划命令不会写这些授权，也不会调用提供商。已授权范围以当时冻结的具体计划为准，
新规划、优化、风格变更或源码变更不沿用旧决定。

宿主图片工具交换时先 request 保留，再按冻结顺序读取项目内图像字节，原样传递 prompt。
工具返回后按 requestSha256 接收原始 PNG。超时或未知结果以 stop 记录 indeterminate，
不能对该计划重新调用工具。可选 ESM 适配器的接口与约束见 [contracts.md](contracts.md)。
不要仅根据计划集合的 computeCalls=0 推断现在是否执行过：它只描述准备集合的时刻，
inspect-project-plans 返回每份已验证状态；currentContext/runtimeCurrent 为真也不解除保留。

最终交付的 reference.png 可作为 ui-layer-harness 输入；目前未实现自动导入 handoff。
下游关于普通业务文字的去除规则独立适用。真实试跑已验证概念图三面板的参考图用途，
宿主仍应展示新结果并收集实际接受决定，不宣称自动保证所有风格和控件的像素一致性。
