# 已审软构图输入与参考v32

0.70.0新增显式`referenceGuidanceProfile:'soft-composition-v3'`，创建project v7和参考
plan/request v32。它可以复用任何符合Scene Kit内容合同的已审构图图，不在core写死
城市形状或本案例坐标。原v4/v5/v6、v28/v31和两图默认保持原字节。

## 三类输入分开

前两张仍是V2投影与完整组件技术例。第三张为已审软构图原PNG，只提供相对摆位、
体量关系、开口与遮挡；第四张及之后才可作为风格输入。构图图的方盒、线条、颜色、
文字、窗口数和像素坐标不替代内容/画风，也不被编译成作者地图。主体身份、数量和
风格仍来自已接受spec/style，实际布局仍由生成后原图与人工粗观测确定。

该输入增加空间关系的正向示例，不保证模型遵守，不自动接受原图、来源或最终美术。
原色、单层职责v4、显示密度v2与显式材料量测要求继续保持。

## 接受、导入与回放

`ai_scene_coherent_composition_guide_v1`绑定guideId、已存在spec及requirements、原PNG
指纹、固定用途与真实accept回执。回执目标必须是原PNG SHA，只表示接受构图用途。
导入可绑定尚未激活的draft，generationCalls为0；v32编译才要求相同active spec和设计
审阅。原字节保存并回放，不清洗Alpha/隐藏RGB、不改图。

generation API提供import/getCoherentCompositionGuide、preview/freezeCoherentReferenceV3。
freeze/回放核验原图、设计、用途、回执和三图容量。guide/回执改变会改变新计划身份；
修订保留准确profile/guide并要求新计算授权。unknown仍为终态，不自动重试。

v7 wrapper绑定guide record SHA，匹配实际reference的profile/guide。已有guide但尚无
reference时也不能删字段降回v6；冻结后不能换guide或把v31工作流伪标v32。
没有guide的旧项目不增加state/status字段。

## CLI与主入口

在完整brief上显式添加profile，再用两个成对的本地输入初始化：

```text
coherent init --brief BRIEF_JSON --out NEW_PROJECT --composition-guide REVIEWED_PNG --guide-decision REVIEW_RECEIPT_JSON
```

guide-decision须来自实际人工审阅，accept只绑定PNG和构图用途，不是算力确认。
高层init检查PNG尺寸不超过4096、宽高比适合brief视口，保留全部原字节。请求和产物
只记录artifact指纹，不写本地绝对路径。API对应options.compositionGuide={bytes,receipt}。

设计继续由design命令或高层review接收，compute-review导出准确提示、全部三张图和
摘要；之后仍需新的单次计算确认。HTTP Studio没有新增生成/文件/命令端点。

## 验收边界

软构图接受与参考美术接受分开。参考必须实际满足前景体积/遮挡、背景纵深、主焦点、
主体完整和可拆性；不能只把未达成内容重新命名为某层而通过。来源完成后仍需显式
量测、真实Studio笔刷/镜头检查和参考对照，技术成功不代表整体美术通过。
