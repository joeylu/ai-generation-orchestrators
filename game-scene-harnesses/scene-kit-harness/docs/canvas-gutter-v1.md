# 完整透明来源的零生图画布留白准备

0.71.0提供独立的canvas-gutter准备合同。它处理原始透明PNG主体完整、技术通过，
但源画布留白不足的情况；不会把语义混层、截断主体或缺失轮廓修复成正确素材。
旧coherent-border的特定低Alpha技术拒收/四边2px合同保持原字节，不扩大其资格。

## 固定像素操作

来源必须是当前批次内、已技术通过的v27透明生成来源。原始计划、结果、PNG、
spec/style、接受参考、目标及当前批次都绑定到独立提案。完整性与单层职责仍须查看
准确原图，不能由PNG技术pass或程序统计自动认证。

新合同固定要求每边至少12%透明画布，不接受任意裁图、缩放、滤镜或用户选择代码。
对原宽W、高H，左右各追加ceil(W×12/76)像素，上下各追加ceil(H×12/76)像素。
百分比相对于扩展后的画布；原整幅内容无论Alpha多小均被包在新透明边内。
输出不超原计划sourcePolicy边长与16MiB预算，超出时停止，不自动缩小原图。

原RGBA以整数偏移完整复制，包括Alpha0的隐藏RGB与连续Alpha尾迹；新增区全部为
零RGBA。不裁包络、不删Alpha、不重绘、不恢复隐藏形状、不调色，也不修改原PNG。
准备PNG由同一Coherent技术规则复查；原技术通过仍属于原生成结果，准备的通过
属于准备来源，不伪造原技术失败或新生成成功。

## 准确预览与采用

只读预览导出原图、准备图、正确按Alpha合成的棋盘格诊断、原计划/结果、提案与
校验包。棋盘格图只是诊断，不是透明权威来源；隐藏RGB不得被误读为可见雾层。
提案记录原/新尺寸、每边追加像素与内容偏移、原/准备PNG和完整RGBA指纹。
导出、重放和检查均为零图片调用，不产生provider attempt。

只有用户接受准确proposal SHA后，程序才可采用独立的
ai_scene_coherent_canvas_gutter_preparation_v1，maximumCalls=0。准备记录不能被
授权或预留成图片任务。收到准确接受并不等于主体完整性、分层或整景美术自动通过。

采用生成新的Coherent v2批次，只把指定来源换为准备视图，原始生成和原PNG保持
权威来源证据。其他已收结果、未提交计划及其未用授权保持摘要和身份，不重复提交。
计算快照把零调用准备来源与图片请求分开，列明剩余的同准确计划未用授权。

本地CLI入口：

```sh
node scripts/coherent.mjs canvas-review --root PROJECT --source PLAN_SHA256 --out NEW_REVIEW_DIRECTORY
node scripts/coherent.mjs canvas-apply --root PROJECT --review REVIEW_DIRECTORY --decision ACCEPT_RECEIPT_JSON --preparation-id prepared.source --batch-id prepared.batch
```

接受回执的targetSha256必须是proposal.json的sha256，不是校验包摘要或父批次摘要；
decision为accept，decisionId须未使用，notes说明本次准确画布准备的范围。
采用时复算整个包，改动原图、预览、提案或上下文即拒绝。相同采用参数可验证后续接，
不会追加第二条准备记录或重新提交图片。准备尚未采用而父批次已更新时，旧提案和
旧准备不能覆盖新分支；必须导出绑定新父批次的新提案并重新接受。同来源/同父批次
只允许一条准备；新父批次的准确接受与准备是独立记录。

## 派生与交付

派生仍按原Alpha内容范围采样。扩边只使来源crop.x/y增加内容偏移，crop.width/height、
逻辑主体尺寸、采样尺寸和摆放不因此改变；不得把新增透明外框当作更大的主体再缩小。
交付保留原PNG、准备PNG、原计划/技术结果、准确提案/接受与双重来源身份，重放时
从原RGBA重建并比对。旧v1批次、旧v27请求及旧2px准备不会被回写。

该入口是本地确定性准备能力，不增加Studio HTTP生图/文件/命令端点，也没有新图片
预算、自动重试或模型/分割服务调用。测试只用合成素材与替身。
