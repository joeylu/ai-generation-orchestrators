# 参考图主导：显式风格输入隔离对照（0.35.0）

本入口用于已被用户拒收的 v18 参考图。保持已接受的内容、七项规范、画风文字和
输出政策，显式省略全部上传风格图片，再冻结一个独立 v19 请求供用户计算确认。
它是预设画风的诊断入口，不是自动重试，也不是默认删除图片输入。

## 输入和不变项

baseline 必须是当前设计下的 v18、原图技术通过、用户已记录 rejected-visual。
未审图、候选导入、未知尝试、其他格式或已经纯文字的计划均不能作为该对照基线。
画风必须为 preset 且 anchors 为空；custom 不能用此入口移除其必要风格锚点。
宿主须声明 textToImage，不能从原请求支持 imageToImage 推断出文本生图能力。

`{planId, baselinePlanSha256, intent}` 是新请求选项。程序重编译原计划，并逐项保持
spec/style/capability、requirements、target、pixelPolicy 与主提示。intent 可保持
原文；若显式修改，仅容许该字段差异且记录前后指纹，不允许改动主体或其他字段。
实际请求的 images 始终为 `[]`，maximumCalls 为1。原输入仍在旧计划/Blob中保留，
省略图指纹、原raw/technical/拒收记录及不变项都绑定到新计划。

这不宣称从图片自动提取了风格；实际使用的是已经接受的预设文字，具体视觉风格
能否保留仍须看产图。本次真实对照保持 intent 和完整提示逐字不变，只去掉原图
输入。单次随机采样不能证明唯一原因或普遍改善，且仍可能出现模型自身的虚化、
透视或附加主体。

## 执行、审阅与兼容

preview 只读；freeze 只追加1条计划，不授权、不预留或生成。准确计划需全新
单次确认，然后按现有程序预留/提交并调用显式宿主。未知终态，任何后续尝试都
须新的准确计划与用户决定；旧拒收不改写。修订 v19 仍保持同一基线和不变项。

v19 使用与 v18 相同的原生PNG技术检查、七标准/数量/表沿/证据检查和准确实测
packet 接受门，仍输出 target v2。接受 raw PNG 绕门及把目标交给旧固定组装器
的路径均被阻止。它没有实现自动分割、遮挡补全或忠实资产回拼。

默认 v18 保留图片风格输入；自定义风格仍需要独立锚点。后续可规划只含笔触/
材质信息且不含完整场景构图的风格样本，需独立审阅其提取范围与实际效果；本版
没有自动裁图、调色、替换样本或保证语义风格隔离。

## API 与 CLI

底层 `./generation` 导出 `previewReferenceLedIsolation`、`freezeReferenceLedIsolation`；
项目入口 `./reference` 导出 `previewReferenceLedIsolationProject`、
`planReferenceLedIsolationProject`，其余 authorize/run/assess/review/target 沿用。

```sh
npm run reference -- preview-isolation --root PROJECT --options OPTIONS_JSON
npm run reference -- isolation --root PROJECT --options OPTIONS_JSON
```

CLI 不提供自动批准或 `--yes`。Studio HTTP 宿主没有新增任何生成能力。
