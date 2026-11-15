# 参考图输入对照合同（0.33.0）

这是定位结构遵从问题的显式试验路径，不是默认忽略用户风格图的新主链，也不证明
图像模型具有像素锁定能力。v1—v16 的计划与请求不变。

## 条件与不变项

baseline 必须是同一当前 spec/style 下已技术接收的 v16 参考图，状态为待美术审阅
或美术拒收。已接受图片不作为此试验的可计算基线。只允许无额外锚点的 preset
画风；custom 锚点和带锚点的 preset 都不能被静默省略。

v17 复制基线已接受的蓝图、底图、文字画风、画幅、能力声明和容差；基础提示
（INTENT 之前）必须逐字一致。只省略 request.images 中的 style-reference，保留
一个原字节 layout-reference。INTENT 明确更正单输入角色，前后摘要都记录。
图像模型采样未锁定，因而不是能够证明唯一因果的统计实验。

spec 中原风格图继续作为来源记录保存；v17 的 inputPolicy 显式列出 omittedStyleImages，
避免把“来源存在”误解为“本次已经传给模型”。原 PNG、原计划、原请求、未知/拒收
及人类接受记录不修改。新计划的 baseline 是对照证据，不是重写原尝试的父指针。

## 计算与结果

计划格式为 ai_scene_generation_plan_v17，请求为 ai_scene_image_request_v17。
新计划仍需新的准确摘要单次计算确认，预留后才能提交，不能借用基线授权。
unknown 仍为终态；显式修订产生新计划并再次确认，不自动重试或回退。

接受基线美术会使尚未花费的试验机会过期，不能在已有正式参考后悄悄继续实验。
试验输出依旧需要技术接收、完整布局/美术 packet；不能直接接受 raw PNG，也不能
进入旧固定地图组装器。一次试验无论美术看起来如何，都不能放宽原几何容差。

## API 与 CLI

`./generation` 导出 previewReferenceInputExperiment/freezeReferenceInputExperiment，
参数严格为 `{planId,baselinePlanSha256,intent}`。只读提案不进入日志或授权计算。

```sh
npm run reference:standard -- input-experiment-preview --root PROJECT --options OPTIONS
npm run reference:standard -- input-experiment-plan --root PROJECT --options OPTIONS
```

之后 authorize/run/assess/review 复用现有独立 CLI。输入图片仍由精确请求和摘要控制，
Studio HTTP 不增加生图入口，测试只用合成 PNG 和决定测试替身。

## 首次真实试验

同一雪山设计的单输入试验已按用户准确批准调用一次，原生 PNG 技术通过；右地形
与平台的横向位置更接近目标，但三个关键锚点的高度仍偏高约 65/63/70 基准像素，
超过 12px 容差。没有冻结还原目标、接受美术或开始素材生成。不能将“去掉整图
风格输入”视为本问题的充分修复；记录和后续模式讨论见执行文档第 66 节。
