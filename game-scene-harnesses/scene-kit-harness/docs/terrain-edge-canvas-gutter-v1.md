# 原生包边低Alpha尾迹的2px透明画布准备

0.82.0新增独立`native-terrain-edge-transparent-canvas-2px-v1`。它不修改旧coherent
border/canvas或terrain native-size size-only准备的资格、默认和历史字节。导出预览
不生成图片。人工采用入口要求接受准确 proposal。

## 严格资格与固定操作

只处理当前full-perimeter批次内已接收的v35/v36/v37透明原生来源，原请求明确选
bounded-native-4m-v1及visible-alpha8-outward16-native-rgba-v1。来源仍为
rejected-technical，原PNG/SHA与重新计算的完整QA一致，且唯一issue必须是
TERRAIN_EDGE_NATIVE_GUTTER。外两圈maxAlpha须大于0且不超过7，非空Alpha≥8包络
四边至少留2px；这些统计不认证主体身份、预期轮廓或艺术完整性。即使边缘≤7，
若原QA还报其他裁边等问题仍拒绝，不能用本准备绕过第二门。

固定四边各加2px全零RGBA，原图逐行按整数偏移(2,2)完整复制，包括Alpha0隐藏RGB
及全部Alpha1..255。原PNG、尝试与失败QA保持，新PNG必须通过同一原计划QA，仍受
原4096单边/4194304总像素/16MiB上限约束。超限就停止，不缩放、裁旧图或删尾迹。
这满足实际最小透明边，不宣称已达到原提示preferred12%。

## 准确预览、采用与剩余授权

独立proposal绑定父批次、原计划/结果/失败QA、原/新PNG与RGBA摘要、尺寸、2px偏移、
body/border诊断以及nativeFrame。公开导出包含权威PNG、正确Alpha合成的棋盘格
诊断及校验包。Alpha0隐藏RGB不能在诊断中被当作实色雾底。

SDK由`./generation`提供：

```js
proposeTerrainEdgeCanvasGutterPreparation(workflow, sourcePlanSha, parentBatchSha);
prepareTerrainEdgeCanvasGutterSource(workflow, {preparationId, proposal, receipt});
prepareAndAdoptTerrainEdgeCanvasGutterSource(workflow, {
  preparationId, proposal, receipt, parentBatchSha256, batchId
});
```

`./terrain-edges`导出准确包接口：

```js
exportTerrainEdgeCanvasGutterReview(workflow, sourcePlanSha, parentBatchSha, output);
applyTerrainEdgeCanvasGutterReview(workflow, reviewDirectory, receipt, {preparationId,batchId});
```

对应CLI：

```sh
node scripts/terrain-edges.mjs canvas-gutter-review --workflow WORKFLOW --plan SOURCE_SHA --parent-batch PARENT_SHA --out NEW_REVIEW
node scripts/terrain-edges.mjs canvas-gutter-apply --workflow WORKFLOW --review EXACT_REVIEW --decision EXACT_ACCEPT_JSON --preparation-id ID --batch-id ID
```

accept回执targetSha256必须是准确proposal SHA。采用复算整个包，变更原图、预览、
上下文或任一绑定即拒绝。部分提交及相同采用参数支持严格续接，不创建第二条
准备或重复图片请求；旧父分支不能覆盖新分支。

准备记录为ai_scene_terrain_edge_canvas_gutter_preparation_v1，maximumCalls=0，
不能授权/预留成图片任务。独立child batch只替换指定失败来源，其余已收来源和
同准确plan/request的未用授权保持。child的maximumCalls/newImageRequests为本次
新增0，remainingAuthorizedCalls单列原未用请求数；compute-review v2只列仍可执行
的原authorized请求，completed/prepared分别列示为0，不重新授权或提交已调用项。

## 新计划的 Alpha=1 警告

Coherent 的新原生包边计划默认冻结 `alpha-one-gutter-warning-v1`。
最外边触发边距检查时，若外两圈最大 Alpha 为 1，且图中有 Alpha≥8 的主体，
这项检查记为警告。其余技术检查通过时，原始 PNG 可直接通过技术回收。
`TERRAIN_EDGE_ALPHA_ONE_GUTTER` 会出现在回收记录和 CLI 状态中。
实际透明边距仍照实记录，尺寸、原生坐标和原像素沿用原图。
直接编译原生包边计划时可在 JSON 选项中设置
`"gutterPolicy": "alpha-one-gutter-warning-v1"`。
复现旧 Coherent 预案时，预览和冻结均使用 `--gutter-policy strict`。

## 历史严格边距计划的自动准备

用户启用自动处理后，已授权全周七项批次可在 `run-codex` 或 `receive` 加
`--auto-weak-gutter true`。已回收并暂停的单项可用
`canvas-gutter-auto --workflow WORKFLOW --plan SOURCE_SHA --parent-batch PARENT_SHA`。
仅当透明边距是唯一失败且外两圈最大 Alpha 为 1 时，自动执行同一份 2px 逐像素
补框及完整复验。可见轮廓间距、最大尺寸、像素数和字节上限仍适用。程序记录
`alpha-one-transparent-canvas-2px-v1` 和实际准备证据，保留原 PNG、失败 QA
及原坐标。按返回的续批摘要继续，只能使用原有且未用的授权。遇到更高 Alpha、
其他技术问题或未知结果，批次保持停止。整景和来源的美术接受均独立记录。

## 原生尺度与交付证据

新PNG保留完整扩框，但消费者使用显式nativeFrame `{x:2,y:2,width:originalW,
height:originalH}`。这个视图只排除新加的零画布，读取全部原RGBA，绝不裁原主体
或去掉旧尾迹。由它派生的资产保持原尺寸及控制点坐标，因此原1024宽×1/4=256world
仍成立，不会被补框1028宽误算为257world，也不会强迫改变纹理/岩块尺度。

prepared PNG是新零调用来源证据；消费frame不是重新接收的生成成功或原QA改判。
交付保留原PNG/失败结果、prepared PNG/新技术结果及准确proposal/accept/nativeFrame
三条来源证据，重放逐RGBA恢复/核对。实际collar、重复窗、等比尺度、outward16及
组合接缝仍需实测；原生技术通过不代替美术接受。

本能力只在本地SDK/CLI，不增加Studio生成、任意路径或命令端点。测试用合成RGBA
和替身覆盖边界、完整像素保留、摘要/父分支篡改、半途续接、零调用禁止生成、原
授权继续、原frame预算/渲染及交付重放，真实图片只用于独立人工预览。
