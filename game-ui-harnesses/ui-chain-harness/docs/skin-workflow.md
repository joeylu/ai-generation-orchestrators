# 可恢复的皮肤后处理流程

本文的 `skins:workflow` CLI 将已有源图和完整 `assembly.json` 冻结为一次独立运行，再执行检查、组装、独立消费包和浏览器验证。这个入口不调用模型，也不负责从未知图集建立定位配置。当前已有独立[定位流程](skin-localization.md)和 [Studio 任务 DAG](skin-task-dag.md)，可从四张组件原图开始派生定位、切线与内容安全区。含可选 S05 的整批材质提取和绑定应使用任务 DAG；这个细分阶段 CLI 没有 `--material-input` 参数。

在 Harness 目录运行：

```powershell
npm run skins:workflow -- create --config work/skins/orbital-hangar/assembly.json
npm run skins:workflow -- resume --directory work/skin-workflow/<返回的运行ID>
npm run skins:workflow -- status --directory work/skin-workflow/<返回的运行ID>
```

需要分阶段运行时，给 resume 增加 `--until inspect`、`assemble`、`consumer` 或 `check`。再次 resume 会验证并跳过已有成功阶段；失败阶段产生新的尝试目录，保留此前失败证据。全部完成后重复 resume 不重复执行阶段。

## 输入、输出与维护

- `input/`：配置与被配置引用的原图副本；摘要写入程序生成的 `request.json`。
- `attempts/`：每次阶段尝试及其输出，含失败记录。组装复用现有实现，不另维护裁切、端帽或九宫格算法。
- `receipts/`：按阶段关联的成功记录和文件摘要；由程序写入，不手工修改。
- status 返回每阶段输出的相对路径。check 阶段保留 `checks.json`、`wide.png`、`tall.png`；consumer 阶段提供可独立消费的组件包。

日常继续维护原模板、风格、组件合同与源 `assembly.json`。运行快照和报告不是新的维护源。修改源配置后 create 新运行，不改旧快照。实现、配置、合同或锁定依赖发生变化时，恢复会拒绝混用版本，也应 create 新运行。

## 状态与恢复边界

技术阶段全部通过后返回 `awaiting-visual-review`，并保持 `productionReady: false`。`visualReview.mode: external` 表示本 CLI 不记录正式美术接受或生产发布；Studio 已有真实 PNG 预览与组件检查，但不将它们写成 accepted。不能把技术检查通过当作美术合格。

捕获到的失败及主动分阶段暂停可再次 resume。本细分阶段 workflow 仍使用独占空文件 `.run.lock`；强制终止可能留下锁，须由维护人员确认原进程及子进程已停止后处理，再恢复，不能按时间猜测锁已过期。Studio 所用任务 DAG 则采用带进程归属的本机锁，能够在确认原进程不存在后回收，并有限恢复暂时性本地错误；两者不能混同。详见[本地恢复](local-recovery.md)。

源文件或成功产物摘要变化会阻止恢复；不要通过编辑记录绕过。并发运行同一个目录会被锁拒绝。该入口只重跑明确失败或未完成的确定性后处理，完全不涉及模型请求的重试授权。

现有[一次性后处理入口](skin-postprocess.md)仍可使用；已有 assembly 配置需要细分检查点时使用本入口。既有独立消费预览的启动快照不会被新运行自动替换。当前 [Studio](local-studio.md) 已提供本地项目进度、组件预览和产物下载；本 workflow CLI 不提供部署、远程 Web 服务、后台队列或数据库。
