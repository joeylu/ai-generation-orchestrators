# 规范参考图合同 v1（0.31.0）

本文保留 0.31.0 的 v1 蓝图/v15 请求语义。0.32.0 的专属构图、硬结构与软美术区域
另见 [v2 合同](reference-layout-v2.md)；旧计划不会被自动升级。准备脚本从 0.32.0
起须明确 `--brief` 或 `--example`，固定旧雪山样例用 `--example snow-castle-v1`。

本入口实现从明确场景设计到已审阅规范参考图的第一段。用户上传 PNG 和手绘 PNG
仅供风格，不默认继承图内地形、物件、构图、镜头和遮挡。内容来自明确文字或
明确选择的配方；空间结构来自绑定蓝图及其程序底图。模型是否遵守结构，必须
检查生成的准确原图。参考图接受之后的实例拆分与高保真回拼尚未实现。

入口为 `src/standard-pipeline.mjs`，包导出 `./standard-reference`，CLI 为
`npm run reference:standard -- COMMAND`。HTTP Studio 不增加生图或任意路径接口。
旧 `./pipeline`、v1—v14 计划及输入角色保持原含义，新链不会调用旧固定组装器。

## 设计与图片身份

- `ai_scene_spec_v2`：非空内容、纯横版、最多两张 `style-reference`、基准视口及
  `referenceLayout`。后者绑定完整蓝图摘要和确定性底图摘要；描述须等于蓝图的
  `sceneDescription`，不能出现两个相互竞争的内容来源。
- `ai_scene_style_v2`：预设或自定义风格，自定义仍需要一张锚点。此版允许经过
  现有 PNG 解析器验证的有界 caBX 元数据，保留原字节；不信任元数据内文字。
  v1 的解析范围不变。当前入口支持 PNG，不做 JPEG/手绘自动语义解析。
- `ai_scene_reference_blueprint_v1`：封印摘要的结构记录。视口 256—2048×144—1152，
  总像素不超过 2097152；1—16 层、1—24 实例，层序严格递增。角色可缺省，同角色
  可多实例；左右前景分别有稳定实例 ID，不要求任意主题都画齐固定十一角色。
- 每个实例含 `layerId/role/content/polygon/anchor`。polygon 为基准帧内的单个简单
  多边形包络，可为凹多边形；不支持内洞或多连通遮罩。它是设计/观测包络，不是
  自动分割结果、精细 Alpha、碰撞体或资产局部像素。拱门开口可用凹轮廓表达。
- `protectedRegions` 绑定区域、多边形、禁止覆盖它的实例 ID 与最大覆盖千分比；
  对设计本身也先检查。当前只计算这些实例的标注包络，不检测图像中的隐含物体。
- `tolerances` 显式给出锚点最大像素误差、包络最小 IoU 千分比、画幅比例最大误差
  千分比。容差属于待审设计，不是已经跨主题校准的通用美术标准。

结构底图按层从浅到深填充中性灰，不复制上传图的几何或配色。它是图像输入中的
第一个 `layout-reference`；上传图、风格锚点分别为 `style-reference/style-anchor`。
生成前在提示中明确三者权限，不能把提示或底图本身当成硬控制能力的证明。
所有输入 PNG 的字节、尺寸和摘要都先验证并以内容寻址保存，公开记录不含本机路径。

## 计划、计算与接收

`preview` 输出不可执行提案、完整提示、蓝图与底图，不增加事件或授权。
设计分别接受 spec/style；spec 摘要同时绑定蓝图和底图。随后 `plan` 产生
`ai_scene_generation_plan_v15`，计算确认绑定它的准确摘要，最多一次。

运行顺序仍为显式适配器 preflight → 单次预留并 fsync → 提交记录 → 调用 → 接收。
失败或未知不重发，unknown 为终态。原生 PNG 保存原字节；技术检查尺寸、画幅比例、
不透明与非空白，不声称识别物体或判断画风。原生图不得小于基准帧，允许按声明容差
接受近似比例；检查用图按 `uniform-contain-no-crop-floor-v1` 等比缩小、整数取整、
居中留边。映射记录原生尺寸、精确比例分数、缩后尺寸和偏移，不裁掉原图。
留边只存在于对照证据中，不替换原生 PNG。

## 布局和准确图审阅

操作者实际查看生成图后，在基准帧坐标标注每个实例的实际包络与锚点。观测记录：

```js
const observation = seal({
  format: 'ai_scene_reference_observation_v1',
  planSha256, rawSha256,
  coordinates: 'canonical-reference-frame',
  instances: observedInstances, // 实测 {instanceId, polygon, anchor}，不是复制预期结果
});
```

`seal` 使用 `src/generation/common.mjs` 的规范 JSON 与 SHA-256。观测必须完整、
无重复或额外实例，绑定准确计划和原 PNG。生成程序不会自动复制蓝图当成观测。

`assess` 产生原图、基准帧图、预期绿线叠图、实测红线叠图、蓝图、观测、指标与
`review-packet.json`。程序核验包络 IoU、锚点距离和保护区域覆盖，无法代替看图。
用户接受针对整个 packet 摘要，它同时绑定准确 PNG、技术检查、观测和全部证据。
用户还须确认标注确实对应画面、主体身份/数量和左右关系正确，以及画风/完整性。
指标失败时不能接受；可记录拒收，或重新实测后形成新 packet。新生图仍需新计划
和新计算确认。通用 raw PNG 接受对 v15 禁用；明显不合格时允许直接拒收准确原图。

`verify-assessment` 从工作流和原始 PNG 重建并逐字节核验所有证据。它不读取一个
“通过”字段就信任报告。接受后状态是 `reference-accepted-reconstruction-pending`，
不能作为旧十一来源批次的输入，也不能标为已交付高保真资产包。

## CLI 与 API

CLI `init --brief FILE --out NEW_DIRECTORY` 的 brief 严格包含
`projectId/blueprint/inputs/style`。inputs 项为 `{role:'style-reference',path}`；路径
只属于本地选择，不进入公开计划。style 字段沿用显式
`mode/preset/name/rules/anchorPath`。可从 `examples/standard-reference/snow-castle.mjs`
的明确配方开始。辅助命令 `reference:standard:prepare` 只建立待审草案和提案。

```sh
npm run reference:standard -- preview --root PROJECT --out NEW_PROPOSAL
npm run reference:standard -- design --root PROJECT --decisions USER_RECEIPTS
npm run reference:standard -- plan --root PROJECT --options PLAN_OPTIONS
npm run reference:standard -- authorize --root PROJECT --decision USER_COMPUTE_RECEIPT
npm run reference:standard -- run --root PROJECT --adapter codex
npm run reference:standard -- assess --root PROJECT --observation ACTUAL_OBSERVATIONS --out NEW_PROOFS
npm run reference:standard -- verify-assessment --root PROJECT --observation ACTUAL_OBSERVATIONS --out NEW_PROOFS
npm run reference:standard -- review --root PROJECT --observation ACTUAL_OBSERVATIONS --decision USER_PACKET_RECEIPT
```

`PLAN_OPTIONS` 可为 `{}` 或含 `planId/parents`；修订可绑定终态父计划，任何新尝试
都须重新授权，不能重复派发旧尝试。
也可显式 `--adapter-module FILE` 选择宿主的 `createAdapter`；不自动探测、回退或重试。
`stop-unknown` 只把已预留/提交的当前尝试记录为未知；`reject` 只接受拒收原图的决定。
所有 receipt 均沿用 `decisionId/decision/targetSha256/notes`，由真实用户决定提供。

API 对应导出 `init/inspect/previewStandardReference`、`verifyStandardPreview`、
`reviewStandardDesign`、`plan/authorize/runStandardReference`、`assessStandardReference`、
`verifyStandardAssessment` 和 `reviewStandardImage`。原子记录由 `./generation` 管理。
本合同不证明模型生成遵从率、自动语义检测、遮挡补全或长地图可用性。
