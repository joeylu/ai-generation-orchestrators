# 城市人工材质与局部发光

0.68.0为新城市样本增加显式工程分支。它复用完整参考、单层来源、量测派生和独立
Studio链路，不自动把自然岩土的正向描述换几个主题词。真实城市生图、回拼和美术
对照仍需后续准确计算确认与独立审阅；离线测试通过不代表新主题已经验收。

## 启用方式

新brief的`visualObservations.sceneFamily`可明确填写`engineered-city`。不从描述中的
“城市”或“赛博朋克”自动猜测家族。其他可选观察仍为lighting、brushwork、materialScale、
depth。未知家族拒绝；缺省保持旧project v4、观察v1、视觉合同v1及旧提示字节。

城市创建project v5、观察v2，绑定`ai_scene_visual_coherence_policy_v2`。
参考接受后，默认驱动将同一`ai_scene_visual_coherence_v2`带入每份来源。单层职责
仍为`isolated-layer-v4`、基础来源计划仍为v27；显示密度策略不变。合同绑定准确
spec/style/参考原PNG/接受布局，不能在一个批次混用或把一项降回无合同。

城市规则把backdrop解释为远处楼群、valley解释为后方城市纵深；landmark保留自身
基础/安装脚。材料强调连续踏面、包边和结构体，允许制造接缝与工业直角。面板跨度、
紧固件和管径按参考显示尺度判断。局部霓虹只属于相应灯具，不自动全图染色、泛光或
夹带邻层背景。透明开口、光晕边距及原PNG仍由技术与人工审阅分别检查。

`source-review`和`coherence-review`对城市项目保留城市家族；来源覆盖说明或补充
视觉观察不能悄悄导出旧自然模板。预览零计算、不冻结、不授权；旧项目按原字节重放。

## 城市侧边

`previewTerrainEdgeSources`与`freezeTerrainEdgeSources`的options明确增加：

```json
{"surfaceFamily":"engineered-city"}
```

它与原有baseBatchSha256、四种职责和subjectBrief等字段一起传入，不是完整options。
城市产物为plan/request v30、`ai_scene_terrain_edge_source_policy_v2`、batch v2与QA v2。
输入仍严格按顺序为已接受完整参考原PNG、当前完成材料原PNG；每份最多一次，透明。
职责仍为左右竖边、左右顶部转角的非空子集，完整运行收边要求四项齐全。

城市提示使用混凝土/金属板的露出截面、完整附着区和局部转角，保留工业接缝与小倒角，
不要求苔草、根、叶盖或不规则岩轮廓。若当前材料来自城市视觉合同，缺少surfaceFamily
即拒绝，不能默默回到自然v29。城市与自然边缘不能混批；错参考、错材料、篡改家族或
policy仍由exact验证和程序重放拒绝。旧缺省v29/policy v1/batch v1字节保持。

## 运行时与边界

派生、曲线/网格并集、实际画刷和ZIP继续消费同一套验证结果。城市家族本身不自动
开启`terrainStepCorners`或`terrainMaterialLoop`；草沿缓坡和岩纹裁接不是通用城市
默认值。需按新参考重新量测表沿、接合列、密度和循环，不能复制水车主题参数。
当前量测合同中的`rockFeaturePairs`是历史字段名；城市可用它量测对应的面板跨度等
实际材料特征，字段名不要求生成岩石，也不意味着自动识别了面板。

此分支没有增加HTTP生成端点、任意路径、命令、队列或自动重试。参考、基础来源、
补充侧边各有自己的新鲜准确预算；原PNG、终止失败和独立人工美术决定保持。
