# 可恢复的皮肤后处理流程

本地入口将已有源图和完整 `assembly.json` 冻结为一次独立运行，再执行检查、组装、独立消费包和浏览器验证。它不调用模型，不定位未知图集，也不代替视觉验收。

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

技术阶段全部通过后返回 `awaiting-visual-review`，并保持 `productionReady: false`。`visualReview.mode: external` 只是显式预留的审查边界：目前未接 session，也未实现审查接受或生产发布命令。不能把技术检查通过当作美术合格。

捕获到的失败及主动分阶段暂停可直接恢复。强制终止进程可能遗留 `.run.lock`；程序不会猜测锁已过期或自动抢占。维护人员应先确认原进程及其子进程已停止，再清理该运行目录的锁并恢复。当前不是具备崩溃自动恢复能力的后台任务系统。

源文件或成功产物摘要变化会阻止恢复；不要通过编辑记录绕过。并发运行同一个目录会被锁拒绝。该入口只重跑明确失败或未完成的确定性后处理，完全不涉及模型请求的重试授权。

现有 [一次性后处理入口](skin-postprocess.md) 仍可使用；需要检查点时使用本入口。既有4194验收快照不会被新运行自动替换。未来服务可对接此类阶段合同，但当前未实现Docker、Web服务、队列或数据库。
