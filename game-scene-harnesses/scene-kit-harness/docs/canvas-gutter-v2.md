# 低Alpha尾迹的零生图画布留白准备

0.80.0新增显式`low-alpha-margin-v2`，使用独立proposal/preparation/result/review包v2。
它不改变[canvas-gutter v1](canvas-gutter-v1.md)或[2px补框v1](coherent-border-v1.md)
的默认行为、资格和历史字节。未显式选择时仍为canvas-gutter v1；失败后不自动切换。

## 资格与边界

来源须是当前批次内已接收的v27透明生成来源，状态rejected-technical。重新读取原PNG
并复算完整QA摘要，原QA必须fail且唯一issue为COHERENT_CLIPPED_SILHOUETTE。
外两圈像素的最高Alpha须大于1且不超过7，并与原QA一致；Alpha≥8的非空包络四边
至少留2px。任一条件不满足即拒绝，不清除尾迹以满足资格，也不以统计认定主体完整。

单层职责、原主体及外端的视觉判断仍独立进行。低Alpha与主体余量只说明可以提出
准确透明画布扩展，不证明未见山脚、根脚或被裁部位已经完整。此入口不能补回几何。

## 固定操作与采用

固定追加左右各ceil(W×12/76)、上下各ceil(H×12/76)的零RGBA画布。原图每一个RGBA
以整数偏移原样复制，包括Alpha0的隐藏RGB与所有微弱尾迹；不裁剪、不缩放、不删
Alpha、不重画、不调色。原PNG、原尝试及原失败QA始终保留。原/新PNG各不超过
16MiB，新宽高须在原计划sourcePolicy的maximumWidth/maximumHeight内，策略本身
不超过4096。新PNG须通过原计划同一技术检查，超限或失败停止。

公开入口导出原图、准确preview-padded.png、正确按Alpha合成的棋盘格诊断、原计划/结果、
提案与校验包；提案绑定原/新PNG与RGBA摘要、原失败QA、Alpha证据、像素偏移、
参考/设计/父批次。诊断图不是权威透明来源。必须收到指向准确proposal SHA的用户
accept回执，程序复算并核验整个包后，才采用ai_scene_coherent_canvas_gutter_preparation_v2。
准备maximumCalls=0，不能授权或预留为图片请求，也不授予source-art接受。

采用产生独立子批次，仅替换指定来源视图。其他已收结果、准确未提交计划及其未用
授权保持身份；不重新授权或提交。父分支改变时旧预览不能覆盖新状态；同源/同父
批次只准一条准备。相同采用参数支持严格重放，不追加第二条准备。

```sh
node scripts/coherent.mjs canvas-review --root PROJECT --source PLAN_SHA256 --out NEW_REVIEW_DIRECTORY --profile low-alpha-margin-v2
node scripts/coherent.mjs canvas-apply --root PROJECT --review REVIEW_DIRECTORY --decision ACCEPT_RECEIPT_JSON --preparation-id prepared.source --batch-id prepared.batch
```

SDK的exportCoherentCanvasGutterReview与flow.proposeCoherentCanvasGutterPreparation
接受末尾options={profile:'low-alpha-margin-v2'}；apply入口按提案版本精确回放。
派生和交付延续v1的双重来源证据，重放原RGBA复制，crop只增加内容偏移；原生主体
尺寸与最终摆放不因透明画布扩大而缩小。低Alpha尾迹造成的包络偏差仍须实际特征
量测，不能用补框替代尺度校准。

该能力只属于本地确定性CLI/SDK，不增加Studio HTTP生成或任意路径/命令入口。
测试使用合成RGBA和替身，覆盖阈值边界、像素保留、防篡改、旧版本字节、剩余授权、
持久重放及交付；真实图片不进入测试。
