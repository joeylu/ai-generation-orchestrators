# 短跨度共享表层：职责量测与可选覆盖包络

最小跨度尺寸预检通过，不代表共享表层和原生上角已经适配。两侧内伸通过collar检查后，
中央剩余区域仍可能很窄；同一源覆盖在其中会呈长柱。先区分名义共享区、实际覆盖权重
和素材中被画出的覆盖物，不把整个cap采样窗口的深度叫作雪/草的厚度。

## 先量测，保留原资格门

`reviewTerrainSurfaceSpan` 接收与footprint相同的grid、terrainEdges、terrainBottomEdges、
policy，以及准确appearance；`reviewTerrainSurfaceKitSpan(handle, policy)` 从已验证kit
解析当前实际cap及其v1接口，包含可选surfaceCycle的准确输出绑定。

报告独立列出原尺寸预检结果、名义共享区、覆盖/淡出深度、深度与名义宽度之比、原生
上角的内伸与fade距离。它返回`measured-not-qualified`，不设全主题的薄唇/比例默认，
不识别覆盖物，不检查像素Alpha或授予美术接受。若有span companion，会另外给出声明
最短跨度上的覆盖量，不把它伪装成实际曲线/接合处的可见范围。

缩窄内伸时必须联合重放左右墙、上角、下角、底缘及原墙上游接片。保留实际native frame、
等比尺度、repeat、原RGBA与独立技术QA；不能只挪上角或取某个局部Alpha列。实际能用的
公共接合距离来自这一族源的全部collar与完整source-over检查，而非图宽比例或另一主题。
检查body/cap的世界采样密度和原生重复相位，明确下角横向交接点调整造成的相位变化。
有余量的有效参数也只是候选，不自动选最窄列或变小岩块来通过尺寸门。

实际职责可用生产Pixi消费器的只读隔层诊断比较：原色全组、仅surface、仅upper/step。
受控内存页面还可把mesh显示为黑色、背景设白，仅测原Alpha与coverageOpacity；这类
黑白图不是新素材或美术图，禁止替换原PNG。共享表层的潜在最终贡献为其Alpha乘随后
upper/step的透过率；记录采样相机、阈值、积分和范围。它不等于白色/雪层厚度，不能
以隐藏RGB、改Alpha或填原生轮廓的方法造出接合。

## 显式的span companion

若来源和参考支持短台面采用较浅覆盖、长跨度保留完整覆盖，可在新交付中显式传入：

```js
controls.surfaceSpanEnvelope = {
  shortWidthWorld: reviewedShortSpan,
  fullWidthWorld: reviewedFullSpan,
  capEndRow: reviewedShortEndRow,
  fadeRows: reviewedShortFadeRows,
};
```

它保留原`world-body-native-lip-v1`接口和完整端/fade行，另写
`kit.terrainSurfaceSpanEnvelope`，profile为`native-lip-continuous-span-coverage-v1`。
本地程序入口为`buildTerrainSurfaceSpanProfile` / `validateTerrainSurfaceSpanProfile`；交付API
`buildTerrainEdgeDelivery` / `verifyTerrainEdgeDelivery`会创建、保存并重放记录。记录绑定
实际cap PNG、映射与准确v1接口，包含surfaceCycle时绑定其已经重放的输出。
它不冻结生成请求、授权或预约compute，没有新HTTP/CLI生成入口。

- 两个宽度均须显式提供，介于1与4096 world，full严格大于short。行数来自当前源。
- 短跨度结束行不得晚于完整接口，开始淡出的行也不得晚于完整接口；只允许减少原有
  覆盖，不扩大原cap、抬高Alpha或新增paint。其他字段或虚假接受不能通过独立重放。
- 在已连接的实体组内，按相接的真实暴露顶面段组成连续的水平投影跨度，跨越作者/
  网格/曲线分段；不能按每格或每个采样段重新决定深度。台阶、空隙和不同实体组不相连。
- endpoint容差为1e-7 world，仅用于识别连接，不挪顶点。分叉、歧义或无效段拒绝。
  最多16384段，拓扑工作计入原有surface-clip预算；不增加三角形或原生mesh上限。
- 在short与full宽度之间线性插值源行的结束与fade；长跨度完全保留原接口。UV仍按
  原capDepth/capUvEnd计算，只裁覆盖和调整有效透明度，不压缩cap UV或改变body世界UV。
- 它只管共享表层。原生上角、侧边、底缘和独立凹角ramp保留自己的职责，不据此宣称
  所有材质/岩形、侧边重复或凹角接片均已修好。

这是一项明确记录的显示近似：短跨度可能省略源中的深覆盖，并不是精确还原。必须在
新输出构建候选，检查最小平台、长桥、曲线连接、窄槽、四个网格相位、实际新画和撤销/
重开，以及预算拒绝与刷卡示例。对照“不适配”“统一变薄”“只缩窄内伸”和此companion，
防止一个案例的改善在另一处变成横带。旧kit缺少字段时保持旧编译和绘制结果。

本功能不授予美术接受。最终人类判断独立绑定准确kit摘要；旧工程与用户编辑不得覆盖。

独立凹角ramp不会自动采用上述覆盖。若隔层确认它重新带回完整cap，可在新候选显式
选择[step-surface绑定](terrain-step-surface-v1.md)，仍保留原ramp几何及完整cap支撑探针。
