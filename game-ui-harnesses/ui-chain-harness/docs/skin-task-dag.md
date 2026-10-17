# 固定皮肤任务 DAG

当前可执行入口包括已有四张组件原图与 metadata profile，以及完整生成批次的核验接入。批次可额外包含S05材质图；基础四图数量由冻结模板决定（修订3为32件，修订2为30件）。Studio和整批执行器已连接生成与后处理，但本DAG只执行确定性步骤。参考输入、计算确认和四次或五次模型提交属于其上游外部阶段。source-s01等节点表示文件完整性检查，不代表本任务调用模型成功。

维护图：configs/skin-task-dag.json。维护参数：skin-metadata-policy.json、skin-content-insets-policy.json及各皮肤metadata-profile.json。节点由固定处理器执行，不允许配置任意shell或provider调用。当前按拓扑顺序串行调度；四个源节点依赖独立，汇合节点必须等待全部源节点完成。尚无并发调度器或可视化编排器。

命令（在Harness目录执行）：

- npm run skins:task -- create --input work/skins/<id>/localization-input.json --profile work/skins/<id>/metadata-profile.json
- npm run skins:task -- resume --directory work/skin-tasks/<task-id> --until locate
- npm run skins:task -- resume --directory work/skin-tasks/<task-id>
- npm run skins:task -- status --directory work/skin-tasks/<task-id>

create 冻结四张组件原图和 profile；从含 S05 的批次创建时，还冻结材质原图、其独立模板及绑定描述，不调用模型。resume 复用摘要校验通过的节点回执，只运行未完成的确定性节点。各节点的输入依赖摘要、输出文件摘要、开始/失败记录保留；回执通过完整文件硬链接独占发布，不能手工改写。失败和中断不伪装成成功。

当前节点：四个 source → locate → metadata → content-insets → assemble → material-bind → consumer-build → postprocess（最终组件检查）。S05 不增加第五个组件 source 节点，也不混入四张组件图的 locate 节点；postprocess 在基础包完成后提取材质、绑定表面，再构建和检查最终消费包。S05 横向标题/分组材质在独立槽位定位中取得唯一归属、无冲突且全部提案不重叠时，保留超出 `bodyRect` 的完整轮廓并记录裁切依据；panel-fill 仍取固定 body 内部样本。四个后处理节点分别保存独立产物和摘要回执；后段失败时复用已完成节点，只重新运行失败及尚未完成的步骤。没有 S05 时，material-bind 保留基础包引用，不生成纹理。最终 postprocess 仍输出原有 run.json 和 evidence 路径。旧任务按冻结的旧图读取，不改写回执；工具指纹发生变化时仍需创建新任务。

恢复限制：

- 不包含生图处理器，恢复不可能提交模型。
- 工具/配置指纹变化需创建新任务；本版尚未实现跨任务选择性缓存失效或迁移旧回执。
- 硬退出可能留下 `.run.lock`；当前本机锁能在确认原进程不存在后回收。存活进程不会被抢占，归属无法确认、旧版空锁或回收保护锁异常时停止，不按锁的年龄推断。见[本地恢复](local-recovery.md)。
- 任务输入或已有产物被篡改会停止；不要通过删除回执绕过校验。
- 任务目录仅保存输入和回执，节点产物引用同一Harness work中的独立目录；尚非可以只搬走任务目录的完整可移植归档。

完成状态为 awaiting-visual-review、productionReady=false。result.md 集中链接参数/问题与横竖检查图；preview-runs.json 可交给已有 localization-trial-preview.mjs 预览。Studio 已提供项目进度、组件画布和经校验产物的本地下载；DAG CLI 本身不提供可视化编排或部署服务。

本流程不声称“参考图到可发布资产”的美术接受闭环。上游真实生成绑定已冻结批次与新鲜单次授权；可能已提交而结果不明的节点不能自动重试。程序检查通过后仍需外观核对。

## 生成批次接入

不必手写localization-input.json，可以从已有的整批目录建立任务：

```text
npm run skins:task -- batch-status --batch work/skins/<id>/batches/<digest> --sha256 <digest>
npm run skins:task -- create --batch work/skins/<id>/batches/<digest> --sha256 <digest> --profile work/skins/<id>/metadata-profile.json
```

批次沿用已有目录约定：同一皮肤下的 batches/<digest>、plans/<plan-digest>、attempts/<plan-digest>。`--input` 与 `--batch` 互斥。四张组件图缺失、批次所含 S05 尚无完整回执或摘要不一致时，不能创建下游任务。摘要关联覆盖批次、全部计划、参考图、风格与冻结资源、预留记录、提交结果、接收声明、原图、检查报告、回执和补图链。生成证据原字节复制到任务 input/generation 中并纳入后续恢复验证；外部原目录之后变化不影响已冻结任务。

含 S05 时，`input/materials/source.png`、`template.json` 和 `material-atlas.json` 共同冻结有效材质来源、最终计划摘要和模板摘要，全部进入任务输入 inventory。补图后取验证通过的最新来源，不将旧坏图混入有效源清单。材质提取不会改基础部件，也不会手工补写 manifest。

S05 提取若发现 alpha=0 的不可见 RGB 非零，postprocess 保留冻结 raw 和其原 SHA-256，另写规范化派生 PNG，只将这些不可见像素的 RGB 清零。可见 RGB、所有 alpha、尺寸和源采样均不变；材质绑定派生摘要，报告记录原始/派生源、变更像素数及可见 RGB/alpha 变更均为 0。恢复与验证从冻结 raw 重放派生字节、裁切和摘要，不用派生图替换原始生成证据。详见[材质合同](skin-surfaces.md)。

这是历史证据核验，不要求历史计划的工具版本等于当前版本，也不授予新的计算权；当前模板必须仍匹配。新调用仍需原有计划新鲜度检查及新的明确授权。

| 证据 | 状态与处理 |
| --- | --- |
| 没有预留或接收记录 | awaiting-authorization；不调用模型 |
| 已预留但无完整回执 | reserved-outcome-unknown，批次indeterminate；不自动重投 |
| 完整接收回执且关联摘要一致 | received；独立保留原图检查状态 |
| 原图或回执摘要不符 | 报错停止 |

旧记录没有可信的“已提交/供应商失败”事件时，不推测这两个状态。[外部执行协议](skin-batch-execution.md) 为新批次记录调用前独占登记和观察结果，当前整批执行器与 Studio 已有可选模型适配。batch-status 仍只读外部记录，不创建授权，不写尝试记录。

原图检查 rejected 时，CLI 默认阻止创建。明确使用 `--allow-rejected-localization` 才允许建立定位候选（例如允许同宽高比的源分辨率差异）；它只允许进入既有定位、参数与消费检查，不修改原始失败、不跳过下游检查、不代表视觉接受。任务记录 originalChecksPassed=false，最终仍为待验收候选。Studio 自动处理采用其已声明的候选策略，不向普通用户增加这个技术开关。S05 缺槽、全画布不透明、纵横比或源摘要不符仍会拒绝；仅 alpha=0 的非零 RGB 可按上述规则规范化到派生源，不自动抠底或改写原始检查。

用户显式确认单张补图时，程序派生新计划摘要和单次授权，原始记录保持不变；`received` 但检查 `rejected` 的图也可走此入口。整批摘要不变时，Studio 仍根据最终计划/原图摘要识别来源修订。未完成旧任务不会被拿来处理新原图：程序创建新冻结任务，保留旧任务和失败证据；来源未变时继续受原来的有限本地恢复规则约束。已完成包不被自动重建。详情见[本地恢复](local-recovery.md)。

维护入口：src/skin-generation/batch-intake.mjs负责只读核验；scripts/skin-task.mjs负责冻结及对接DAG；既有attempt.mjs继续唯一负责预留和接收。不要为接入历史批次手工编造回执。
