# 来源深阴影与完整接口技术输入

0.73.0为明确需要大面积深阴影的前景提供显式可选技术输入，避免只靠完整参考图
加文字描述传达不同曝光设计。此能力不自动判定语义或保证生成成功。

唯一固定profile为deep-shadow-complete-fixture-v1，对应lightingProfile为
majority-surfaces-deep-shadow-v1。固定程序生成1024×576不透明中性示例：正面灰26、
侧面18、顶面30，只有少量细灰边55及tiny点64，完整回环、闭端口和短挂件。没有
主墙、地板、比较分格、主题色或文字。浅灰空处是技术展示背景。示例不是最终美术、
源图改色或用户构图；制作与验证为零图片调用。

v1 PNG SHA为43f8b69d4d2bcea1e947167d678c6b1f4c48cda8c2edd96bc5a602535f20dbff，
固定recipe SHA为ee3f8bba8c9f2d483648101bc09e58f9eae8fce74db91712b9f8ed4a3b3c5991。
recipe与用途文字也必须保持；未来变更须另加版本，不能回写已冻结请求。

## 明确的两输入职责

Input1仍为同一完整接受原参考，负责材质色相、笔触、主光方向/色温；guided请求用
accepted-scene-style-material-light-direction-temperature-reference角色，不把旧前景曝光
当新曝光目标。Input2为固定中性图，角色neutral-deep-shadow-complete-fixture-example，
只指导多数正/侧/顶面深阴影及闭合轮廓/接口。主体身份、内容、数量、附件及摆位由
已接受的source brief决定；不复制示例几何、灰色材料、平涂画风或浅色背景。

真实PNG必须新绘其自身材质暗面，保留实心Alpha、原色相和暗面结构；不允许用后期
乘黑、滤色、降透明度或删Alpha达标。技术例不授予来源或整景人工美术接受。

## 版本化选择与重放

新增集合/单项scope v3，只允许显式选中的foreground绑定两个固定profile，可保留
原visualCoherence。SDK的withSourceVisualGuideScopes(requirements,scopes,subjectIds)
用于初始来源选择，withSourceVisualGuide(scope)用于单项新计划修订。其他subject不
隐式绑定技术例，旧v1/v2 scope、v27请求、默认路径及角色保持原字节。

0.81.0的[职责内承托profile](scope-owned-grounding-v1.md)另用scope/集合v4，与本技术
输入共存；它仅调整通用承托文字，不改变这张固定中性图、recipe或两输入用途。

guided计划仍为v27，但compiler增加-shadow-guide-v1后缀，严格要求透明目标、至少
2图能力、Input1接受原PNG、Input2准确artifact/role/recipe，次序不可交换。新输入改变
请求摘要，必须新准确计算确认，旧未用授权也不能转用。未知/失败仍停止，无自动重试。

preview只在内存生成计划与示例，不写workflow或blob。freeze/revise对全部新记录用
dryStore验证后才保存唯一固定guide blob并追加记录，错误ID不能留下半批或新blob。
model回放重新产生canonical guide并逐字节比对实际blob，不只信声明的SHA。compute
审阅包和离线exchange按顺序导出两个准确输入；Agent不手写或修复manifest/attempt。

入口仍为本地CLI/SDK，Studio HTTP没有图片/文件路径/命令端点。测试仅合成替身，
覆盖预览只读、绑定/顺序/用途/能力/角色拒绝、字节篡改、独立新授权及原字节重放。
