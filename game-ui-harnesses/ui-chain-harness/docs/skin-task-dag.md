# 固定皮肤任务DAG（第一阶段）

当前可执行入口包括已有四张原图与metadata profile，以及已有完整生成批次的核验接入。参考图风格推导、计算确认、四次真实生图提交仍是外部阶段，未实现统一生图调度。source-s01等节点表示原始文件完整性检查，不代表本任务调用模型成功。

维护图：configs/skin-task-dag.json。维护参数：skin-metadata-policy.json、skin-content-insets-policy.json及各皮肤metadata-profile.json。节点由固定处理器执行，不允许配置任意shell或provider调用。当前按拓扑顺序串行调度；四个源节点依赖独立，汇合节点必须等待全部源节点完成。尚无并发调度器或可视化编排器。

命令（在Harness目录执行）：

- npm run skins:task -- create --input work/skins/<id>/localization-input.json --profile work/skins/<id>/metadata-profile.json
- npm run skins:task -- resume --directory work/skin-tasks/<task-id> --until locate
- npm run skins:task -- resume --directory work/skin-tasks/<task-id>
- npm run skins:task -- status --directory work/skin-tasks/<task-id>

create冻结四张原始图和profile，不调用模型。resume复用摘要校验通过的节点回执，只运行未完成的确定性节点。各节点的输入依赖摘要、输出文件摘要、开始/失败记录保留；回执通过完整文件硬链接独占发布，不能手工改写。失败和中断不伪装成成功。

当前节点：四个source→locate→metadata→content-insets→postprocess（复用现有组包/消费/63项检查工具）。postprocess整体仍为一个节点，内部失败后可能重做该确定性节点；细粒度assemble/consumer/check恢复可用既有skins:workflow，但本版尚未与其嵌套贯通。

恢复限制：

- 不包含生图处理器，恢复不可能提交模型。
- 工具/配置指纹变化需创建新任务；本版尚未实现跨任务选择性缓存失效或迁移旧回执。
- 硬退出可能留下.run.lock；先确认进程已停止，再由维护者处理遗留锁，不自动抢锁或启动后台worker。
- 任务输入或已有产物被篡改会停止；不要通过删除回执绕过校验。
- 任务目录仅保存输入和回执，节点产物引用同一Harness work中的独立目录；尚非可以只搬走任务目录的完整可移植归档。

完成状态为awaiting-visual-review、productionReady=false。result.md集中链接参数/问题与横竖检查图；preview-runs.json可交给已有localization-trial-preview.mjs预览。尚无Web任务页、统一ZIP下载或部署服务。

此阶段实现DAG执行与恢复骨架，并不声称“参考图到可发布资产”的完整自动闭环。后续接入真实生成时须绑定已冻结批次与新鲜单次授权，可能已提交而结果不明的节点不能自动重试。

## 生成批次接入（0.80）

不必手写localization-input.json，可以从已有的整批目录建立任务：

```text
npm run skins:task -- batch-status --batch work/skins/<id>/batches/<digest> --sha256 <digest>
npm run skins:task -- create --batch work/skins/<id>/batches/<digest> --sha256 <digest> --profile work/skins/<id>/metadata-profile.json
```

批次沿用已有目录约定：同一皮肤下的batches/<digest>、plans/<plan-digest>、attempts/<plan-digest>。`--input`与`--batch`互斥。四张缺失或摘要不一致时不能创建下游任务。摘要关联覆盖批次、四份计划、参考图、风格与全部冻结资源、预留记录、接收声明、原图、检查报告和回执。生成证据原字节复制到任务input/generation中并纳入后续恢复验证；外部原目录之后变化不影响已冻结任务。

这是历史证据核验，不要求历史计划的工具版本等于当前版本，也不授予新的计算权；当前模板必须仍匹配。新调用仍需原有计划新鲜度检查及新的明确授权。

| 证据 | 状态与处理 |
| --- | --- |
| 没有预留或接收记录 | awaiting-authorization；不调用模型 |
| 已预留但无完整回执 | reserved-outcome-unknown，批次indeterminate；不自动重投 |
| 完整接收回执且关联摘要一致 | received；独立保留原图检查状态 |
| 原图或回执摘要不符 | 报错停止 |

旧记录没有可信的“已提交/供应商失败”事件，因此不推测这两个状态。0.81已增加[外部执行协议](skin-batch-execution.md)，可记录新批次的调用前独占登记和观察结果；实际模型适配仍待实现。batch-status只读当前外部记录，不创建授权，不写尝试记录。

原图检查rejected时，默认阻止创建。明确使用`--allow-rejected-localization`才允许建立定位候选（例如用户已允许同宽高比缩放的历史素材）；它只允许进入既有定位、参数与消费检查，不修改原始失败、不跳过下游检查、不代表视觉接受。任务记录originalChecksPassed=false，最终仍为待验收候选。普通用户界面不新增此技术开关。

维护入口：src/skin-generation/batch-intake.mjs负责只读核验；scripts/skin-task.mjs负责冻结及对接DAG；既有attempt.mjs继续唯一负责预留和接收。不要为接入历史批次手工编造回执。
