# 保留原齐套来源，修订单个侧边

若真实诊断把问题定位到一侧墙，不需要为了交付入口重新生成全部七项。已有
`freezeTerrainEdgeSources` 可以冻结 `explicit-subset-replacement`，每项仍须独立
准确计划、摘要绑定授权、预约和一次调用。准备计划与选择既有来源都不计算。

`buildTerrainEdgeDelivery` / `verifyTerrainEdgeDelivery` 的新程序 API 选项为：

```js
replacementBatchSha256s: [checkedUpperPairSha256, checkedLeftWallSha256]
```

基础 `batchSha256` 仍是准确七项齐套批次。该选项支持至多四个互不重叠的侧边/上角
子集，角色限于 left-wall、right-wall、left-top-corner、right-top-corner。三个底缘角色
沿用原批次；该入口不承诺新底缘子集的准备/接收链。它是程序 API，没有新增 CLI
参数、HTTP 生成或任意路径/命令入口。原 `upperReplacementBatchSha256` 仍只用于
成对上角，记录与交付字节保持；新旧两个选项同时给出会拒绝。

每份输入必须由 workflow 的 checked read API 重放为技术 pass。参考原图/完整计划、
材质原图/计划、目标、基础来源批次、质量策略、native-size、render-envelope 和
reference-defined-cover 必须一致。子集必须声明 explicit-subset-replacement，重复
批次、冲突角色、未变计划、错源或未通过来源均拒绝，不使用“最后一个覆盖前一个”。
新记录按批次摘要排序，同一集合与参数得到同一交付，不依赖数组顺序。

新候选保存 `evidence/side-source-selection.json` 和各替换批次；readiness 的
`sideSourceSelection` 逐项记录实际批次、计划、结果、技术 QA、原 PNG 及被替换计划。
每项原生 canvas/native-size/rebind 准备仍从自己的准确来源批次和父链核验，不借用
基础批次的批准。原批次、PNG、失败和旧交付保留；独立 verify 重做选择和全交付。

技术 pass 和来源齐套不证明新墙与原上角/下角、任意 body 相位都适配。收到新 PNG
后重新量原生 collar、全尾部、短跨度和边界，再做全组合及实际 Studio；不得盲用旧
坐标、放宽门或裁图掩盖不兼容。只有检查后的候选可展示，最终人类美术接受独立。

该非执行选源不新建 workflow 批次，不授予、消费或恢复旧生成授权；最终交付仍
`productionKit:false`。新来源的单次生成失败/未知会停止，不自动补画或重试。
