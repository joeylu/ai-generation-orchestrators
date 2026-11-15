# 曲线与画刷地形的侧壁和顶部转角

0.61.0增加独立侧边来源计划和确定性裁接，补齐仅有顶部覆盖层时的竖切边。
本能力不是完整任意轮廓重建；真实素材的光照、笔触、岩块尺度和拼接仍须对照原参考。
0.62.0进一步区分严格接缝、原生近不透明接缝与显式渲染覆盖，并支持同尺度2倍字段。
0.63.0以显式v4网格并集配置将同材质岩体、表层和岩边接入真实画刷；旧v1—v3包保持原行为。
0.64.0以显式v5完整原生Alpha覆盖接合，保留被旧corner/wall矩形裁接截断的岩块；旧v1—v4输出保持。

## 来源与计算

`previewTerrainEdgeSources`只读准备，`freezeTerrainEdgeSources`冻结新计划v29及新批次。
每个主题可选择四种职责的非空子集：`left-wall`、`right-wall`、`left-top-corner`、
`right-top-corner`。一图只画一个职责。运行时完整左右收边需四种来源都收齐。

每份计划固定顺序绑定两张原生输入：已接受的完整参考、当前基础批次的材质。
材质只技术通过时明确标记美术未审。左右分别绘画，不镜像光照，不旋转顶部草皮。
岩块是竖边主要轮廓，根须/苔草只局部附着，转角连接薄亮顶和岩肩。

沿用原工作流的摘要授权、持久预留和终态未知；新批次必须新的一次性计算确认，
旧参考/九来源授权不可复用。程序不调用模型、不自动重试，也不自动授予美术接受。
所有来源技术通过后才可交给派生程序，混层由Agent及用户审阅，不声称自动语义检查。

`forkCompletedWorkflow`可将已完成证据导入独立工作区：程序核验旧日志和PNG，再建立
新项目标识与新哈希链，原记录内容保持。存在任何未使用或执行中的计划时拒绝导入，
已消耗授权在新工作区仍已消耗。这是本地证据导入，不是重跑旧请求。

## 显式坐标与接法

kit v4可选`terrainEdges`，绑定appearance v5/v6的原材质SHA和surfaceMapping SHA。
每侧分别声明wall/corner的PNG、原生尺寸、统一横纵scale、boundaryX和innerX。
wall另有半开repeatY区间，corner另有surfaceY和wallStartY。坐标由Agent在原PNG上
提供，程序不自动分割或恢复隐藏轮廓。

innerX三列接合带在使用行及线性采样相邻行中必须全不透明；wall和corner使用同一物理内缩深度。
该检查只防止底图漏出，不要求逐像素复刻参考。绘画不合用时应停止并另行规划，
不能手工擦Alpha、补画岩块或重新调色来绕过检查。派生保留原Alpha及非零像素颜色，
只把完全透明位置RGB清零；原始PNG另存，完整保留。

上述255检查属于`terrainEdges_v1`。真实首张来源技术通过，但石体Alpha主要252—253，
没有255像素，旧严格接合失败单独保留。`terrainEdges_v2`要求显式
`joinProfile:"native-near-opaque-underlap-v1"`，固定下限250，并在内侧接合处保留
一个原生像素对应宽度的原岩体承托。它不提高PNG Alpha，不声称外侧完全不透明，
也不自动从v1降级。每项实际接合列最小Alpha进入交付证据。

`terrainEdges_v3`还要求四项均提供`inboardBlend:{fromX,toX}`，只在内侧已有岩体
承托处从覆盖1过渡至0，并在toX后停止绘制，避免把原生PNG的笔直内画边贴进场景。
每段最多32条覆盖带；原PNG/原Alpha不变，**有效渲染Alpha会乘覆盖权重**，两者
分别记录，不能笼统声称最终Alpha未变。外侧轮廓权重恒1，不处理画布或擦除像素。
Pixi与CPU使用同一覆盖数据，CPU共享边不重复叠加。软过渡可能混合两套岩纹，仍需
实际参考对照，不以程序通过认证美术。

交付controls可显式指定`materialDensityProfile:"reference-native-2x-v1"`：appearance v6
直接从原材质重新采样1010×506 body和双高cap，物理窗口、尺度、512×256周期及
cap深度/标准化UV保持。源行原点翻倍，按506归一化。不会放大旧505×253图；原生
像素不够则拒绝。旧47角色网格贴图仍保持1倍，报告不把它们误称为2倍。原字段与
新派生记录同时保留。加密度用于缩小清晰度差，不是修复笔直画边的替代方法。

编译器将body和顶部cap裁到内侧接合线，再放置转角、沿Y重复明确的wall中段，
末段裁短。基础横纵倍率相同；各绘画列的竖向原点随已编译地表采样点偏移，因而
转角能接到轻微起伏的地面。此网格投影可能剪切局部绘画，报告明确记录偏移范围，
不能宣称最终网格仍是无形变的矩形贴图。原PNG像素不改，基础显示密度目标为2倍，
实际倍率及是否达到目标分别记录。外轮廓由原生Alpha呈现，凹口后不残留原直切边。
CPU和Pixi使用相同几何，侧边采样双轴clamp；转角、竖边与地形共同移动，图层显隐
仍是编辑状态。碰撞轮廓和可行走表沿使用原作者几何，不随视觉收边改变。

首轮v1—v3支持v6曲线地形的完整露出竖边，不支持mixed patch。世界边界跳过；曲线或
网格相接/部分遮挡的侧边明确记为不支持并跳过，不宣称自动处理任意轮廓。世界
边界使用1 world容差容纳参考最后一像素端点，规则不随浏览器镜头变化。旧v1—v3网格
画刷仍按原拼片呈现，不隐式改变历史导出。竖向重复接缝、转角笔触和内侧贴合仍须实际目检。

## v4：画刷实心并集

`ai_scene_terrain_edges_v4`保留v3的四份来源、接合与覆盖参数，另需明确
`gridProfile:"grid-solid-union-native-v1"`。完整来源派生的新controls可加入同名字段，
`buildTerrainEdgeDelivery`直接产出v4；旧controls的字节重放不变。现有v3包可通过
`upgradeTerrainBrushKit`零生图升级为新revision并绑定作者副本，原包与原PNG保持。
升级和新来源计算是独立操作，不消耗或续用图片授权。
0.63之后的新主题若交付可编辑画刷，应默认在新controls中包含gridProfile；缺失字段的
历史重放或仅曲线交付必须说明未启用网格岩边，不能凭默认曲线截图宣称画刷能力已完成。

普通画刷格子按四连通实心并集生成`gridTerrains`；body按真实格子铺面，L形与洞不取
包围矩形填充。cap只放真实朝上的露出面。两者使用当前v5/v6量测字段，平顶相邻格
共享world UV与深度，不再以旧低密度47拼片承载新外观。旧节点仍保留逻辑身份，
Pixi与CPU根据`source.gridCells`抑制这些节点，避免直切底图穿过透明岩边凹口。

左右竖面合并成连续区间，只在外轮廓放岩边；叠高或延长不会留下内部竖缝。顶部
真实露出时放转角，下凹口或被遮挡后的侧段使用wall。曲线和网格接触区间两侧相减，
保留仍露出的上下段；顶角外挑还会扣除相邻曲线的真实实体。世界左右边界跳过，
固定平台terrainSkin继续使用完整原图，不被网格材质替换；mixed patch仍属原不支持范围。

窄柱的覆盖网格向内适配到实心横向半幅，外侧坐标不改；报告明确记录向内X压缩。
这不是改变源PNG或将全部绘画做等比缩放。局部覆盖被裁到所属实心格，避免穿洞或
跨到对岸；有效Alpha仍乘显式覆盖权重。地形移动预览、提交、擦除、撤销和重开都消费
同一编译结果，作者格子、曲线和碰撞建议不随视觉装饰改变。

每列连续实体按本列顶面定位body深度；不同高度台阶可能有纹理相位变化。材质周期
自身的接缝、岩块重复节奏和局部角墙过渡仍需实际目检，不声称任意拓扑或美术无缝。
每patch覆盖网格、竖向重复和局部占格查询都有固定预算；测试只用合成图与软件WebGL。

## 接口

v5另需`junctions`，由`buildTerrainEdgeJunctions`从四张原PNG及准确坐标构建，绑定源SHA、
尺寸、控制参数与重放摘要。profile为`native-alpha-complete-overlap-v1`。完整wall按低处
到高处绘制，完整corner最后绘制；既有横向内侧覆盖仍保留，没有竖向模糊、二值切石、
补画或抬高源Alpha。原PNG/原Alpha不变，渲染层间采用实际Alpha的source-over合成，
不能把它称为有效Alpha从未变化。源画布透明边也保留，底边和遮挡仍按作者实体裁切。

每侧可显式提供`firstWallNativeOriginWorld`和`wallStepWorld`，否则使用旧坐标的原生
原点映射与重复长度，并在记录中写出实际值。不能把水车主题左45/右30、步长300
硬编码为通用默认。完整corner尾部最多扩展80world，同时原生wall覆盖层数最多8。
程序按三条内侧接合采样线及半最小原生像素的Y步长计算原Alpha合成支撑，低于250
拒绝；不会用底色、透明度修补或改PNG绕过。source-over采样通过不等于全宽美术无缝。

现有v4包可用`upgradeTerrainEdgeJunctionKit`/`verifyTerrainEdgeJunctionKit`在新目录
升级新revision，作者仅变kitRef，所有PNG与碰撞保持。新来源交付可在controls中加入
`gridProfile`及`junctions:{...}`直接产出v5，无需特定地图补丁。首次放置与源上下文
不合适时仍需显式校准；无法匹配的不同岩块不能由程序恢复成同一块石头。主岩体周期
接缝、台阶水平底边和整体美术接受不由此接合程序自动解决。

```text
npm run terrain:edges -- fork --source-workflow COMPLETED --out NEW_WORKFLOW --project-id ID
npm run terrain:edges -- preview --workflow WORKFLOW --options JSON
npm run terrain:edges -- freeze --workflow WORKFLOW --options JSON
npm run terrain:edges -- compute-review --workflow WORKFLOW --batch SHA --out NEW_DIRECTORY
npm run terrain:edges -- authorize --workflow WORKFLOW --batch SHA --decision JSON
npm run terrain:edges -- reserve --workflow WORKFLOW --batch SHA --out NEW_EXCHANGE
npm run terrain:edges -- receive --workflow WORKFLOW --exchange DIRECTORY --file NATIVE_PNG
npm run terrain:edges -- stop-unknown --workflow WORKFLOW --exchange DIRECTORY
npm run terrain:edges -- deliver --workflow WORKFLOW --base-kit KIT --batch SHA --controls JSON --out NEW_DELIVERY
npm run terrain:edges -- verify --workflow WORKFLOW --base-kit KIT --batch SHA --controls JSON --out DELIVERY
npm run terrain:edges -- enable-grid --kit VERIFIED_V3_EDGE_KIT --document AUTHOR_JSON --out NEW_GRID_DELIVERY
npm run terrain:edges -- verify-grid --kit VERIFIED_V3_EDGE_KIT --document AUTHOR_JSON --out GRID_DELIVERY
npm run terrain:edges -- enable-junctions --kit VERIFIED_V4_EDGE_KIT --document AUTHOR_JSON --options JSON --out NEW_JUNCTION_DELIVERY
npm run terrain:edges -- verify-junctions --kit VERIFIED_V4_EDGE_KIT --document AUTHOR_JSON --options JSON --out JUNCTION_DELIVERY
npm run terrain:edges -- enable-union-material --kit VERIFIED_V5_EDGE_KIT --document AUTHOR_JSON --out NEW_UNION_DELIVERY
npm run terrain:edges -- verify-union-material --kit VERIFIED_V5_EDGE_KIT --document AUTHOR_JSON --out UNION_DELIVERY
npm run terrain:edges -- enable-material-loop --kit VERIFIED_V6_EDGE_KIT --document AUTHOR_JSON --options JSON --out NEW_LOOP_DELIVERY
npm run terrain:edges -- verify-material-loop --kit VERIFIED_V6_EDGE_KIT --document AUTHOR_JSON --options JSON --out LOOP_DELIVERY
npm run terrain:edges -- enable-step-corners --kit VERIFIED_V6_EDGE_KIT --document AUTHOR_JSON --options JSON --out NEW_CORNER_DELIVERY
npm run terrain:edges -- verify-step-corners --kit VERIFIED_V6_EDGE_KIT --document AUTHOR_JSON --options JSON --out CORNER_DELIVERY
```

这些命令不调用图片工具。reserve在返回准确exchange前持久预留并记录提交边界，
失败/未知或未完成的请求会阻止继续批次。receive保存原PNG和独立QA，重复接收只
接受相同票据与字节。compute-review保存准确提示、计划和两张输入，零工作流事件。

deliver重放验证基础候选、绑定四份新来源与显式controls，导出新的kit、地图、PNG、
ZIP及校验记录；verify重新派生并逐字节核验。原交付和已运行Studio不会被替换。
实际Studio对照须另行捕获，CPU预览不冒充浏览器截图，整景美术始终单独审阅。

## 原生竖壁中段重复

人造竖壁的源图如果带有水平端头，可在新交付的 `junctions` 选择
`wallRepeatProfile: "native-alpha-repeat-window-v1"`。每侧的 `wall.repeatY`
指定原 PNG 的半开行区间。步长等于所选行数乘原生比例，单次投影沿用原 UV。
`firstWallNativeOriginWorld` 仍指原图第 0 行在上角下方的相对坐标，
实际首段从该坐标加 `repeatY.from × scale` 开始。

完整上角在竖壁之后绘制，程序按原 Alpha 复验接合和完整重复周期。凹角底缘继续用
首段原位置前紧邻的已校验源行做实体内搭接。原 PNG、等比尺度和作者碰撞保持。
按参考量测中段的接头，并分别检查整段长墙、窄台和桥洞。原先冻结的完整源重叠
继续按其原 profile 重放。

## v6向上增刷与相接实体

`ai_scene_terrain_edges_v6`继承v5，另需封闭`materialProfile:"union-world-body-local-surface-v1"`。
`compileTerrainUnionMaterial`以固定world X/512、Y/256映射body；任何同位置都取同一
材质坐标，不按每列顶面或各作者对象重新开始。body的dV/dY严格为1/256、dV/dX为0，
不拉伸岩纹。加高、擦除会改变真实露出表层和岩边，已有岩体的世界相位保持。

同组只包含共享正长度实体边界的普通格子/曲线；独立曲线的旧材质保持，固定平台
原图仍排除。被另一实体底面盖住的上表沿不继续生成。局部cap保留原图的垂直深度
与world-X采样，最后min(12,capDepth/2)world按24段覆盖权重source-over接到body。
这个过渡会混合两份原色样本，不是原PNG改色、修改Alpha或同一 source 行逐像素对齐。
capBands与body、cap、左右岩边同时裁切；Pixi mesh.alpha与CPU opacity采用相同顺序。

新样本须分开量测薄覆盖、附着岩肩与完整cap采样窗口；`capDepth`可包含整段过渡，
不能直接当作覆盖物厚度。按参考与实际来源选择原有full-cap或
[`world-body-native-lip-v1`](industrial-material-interface-v1.md)，薄唇的终止/淡出行
须绑定自己的cap来源。没有全局固定20行或所有材质必须薄唇的规则；保留cap UV深度，
不把整块岩肩压薄或调色来遮横带。旧计划、来源、失败记录和控制点不被改写。

`compileTerrainUnionEdges`将曲线和网格同X相接的外侧区间合并，一条原生corner/wall
序列可跨越原作者边界；不在埋藏的grid顶部重启转角。绘制覆盖物放在同组最后的
实体上，避免后绘body盖住它。短台阶末端允许完整corner尾石叠入同组实际支撑，
只在原实体内延长，不填空气、洞或悬挑下方。原PNG和碰撞建议保持。

现有v5通过`upgradeTerrainUnionMaterialKit`/`verifyTerrainUnionMaterialKit`导出
新revision与作者副本；新来源交付controls可同时声明gridProfile、junctions和上述
materialProfile直接产v6。所有入口零生图，HTTP宿主不增加生成或路径接口。旧v1—v5
仍按原规则重放。表层/几何工作和原生mesh总量有固定预算，超出直接拒绝，不交付半成品。

最初试算的最近北面欧氏距离场虽通过位置连续检查，却在真实台阶处把岩纹拉长，已
明确排除；它不是当前profile。最终回归另检查每个body三角形Jacobian及旧位置UV，
防止用坐标变形消除切线。固定body保留原材质本身的周期重复痕，不能据此宣称所有
画面横带消失。单独拖动几何相接的不同作者对象时，共用岩边仍按绘制owner预览，
松手重编译恢复；本轮真实验证聚焦增刷、擦除、撤销、重开和导出。

## 原色岩体循环

`terrainMaterialLoop`是kit v4的显式可选、封闭记录，格式
`ai_scene_terrain_material_loop_v1`，profile为`source-pixel-closed-overlap-cycle-v1`。
它只适用于已校验的v6网格并集及dense v6基础材质；不改基础terrainAppearance、原PNG、
原控制点或碰撞，不隐式升级旧包。实际出现的横带主因是派生字段可用行不足却硬回头
补齐，并非证明原始绘画有一条直线；精确根因和实测在执行计划第146节。

`buildTerrainMaterialLoop(inputPNG,{source,outputPath,usableRows,overlapRows,phaseCount})`
返回record和新的PNG。输出每个RGBA完整复制自已校验body-field的实际可用行，来源
字段此前的面积采样和横向collar仍是历史，不能声称直接等于原始绘画每个像素。
不缩放、旋转、镜像、模糊或新混色。三相位仅采用整数X平移，在重叠窗口按RGB差、
梯度和暗部偏好求有界路径；端点严格闭合，路径每列最多移动2像素。优化器只搜索
最多32个起点，明确为近似优化，不是语义识别岩缝或保证全局最优。

记录绑定原body来源/尺寸、usableRows、重叠行数、1或3相位、全部路径、代价、像素
来源摘要和输出PNG。`validateTerrainMaterialLoop`从原PNG完整重算，与输出逐字节
一致才通过。限制包括最大原尺寸2048、重叠256行、3相位、268435456次DP转移、
输出8388608像素/高度4096、PNG16MiB；宿主启动校验重放，编辑时不重复执行拼接。

基础appearance仍保留原body-field供重放，另加`materials/body-loop.png`。渲染用
`resolveTerrainMaterialAppearance`生成明确的effective v7，bodyPeriod保存有理数。
输出宽不变，world X周期512；world Y周期=输出高度×256/原字段高度。应检查
纹理像素/世界单位的Jacobian保持，不能硬套旧normalized V每256world重复一次。
独立曲线同样显式使用新循环与局部capBands；原body、cap和四边源PNG保持。

旧v6通过`upgradeTerrainMaterialLoopKit`/`verifyTerrainMaterialLoopKit`导出新revision，
options必须明确usableRows、overlapRows、phaseCount；原PNG全保留，只新增1张PNG。
新来源交付controls可声明materialLoop:{overlapRows,phaseCount}，实际usableRows从
当前绑定的density派生证据读取，拒绝请求任意指定usableRows。必须同时启用dense、
gridProfile、junctions和materialProfile。新、旧交付和计算授权分开，以上全部零生图。

循环仍有重复岩块，局部切合仍可能可见；低整行跳变和工程重放不能代替实际Studio
及人工美术审阅。没有将老补行失败、试验图或旧项目悄悄替换成新结果。

循环质量须跨完整显示周期检查较宽岩块的走势及周期内部每个拼接位置。首末行
L1=0或端点像素相同只证明行闭合，不证明岩形、纹理方向或明暗自然延续。移动
body origin只会移动接缝，不能据此宣称修复；完整组合矩阵与实机仍须另验。

## 台阶凹角

kit v4的可选`terrainStepCorners`显式启用`concave-source-surface-ramp-v1`。配置由
`buildTerrainStepCornerProfile({widthWorld,heightWorld})`产生，包含format/profile、
widthWorld、heightWorld和固定segments16。宽8—48world，高4—min(24,width×.75)。
现有v6有无materialLoop均可使用；未声明的旧包不改变输出。

`compileTerrainStepCorners`只匹配同一连通实体的真实露出竖段终点与低台平坦北面
端点，不把凸角、分离对象或斜曲线近似成直角。实际宽受低台跨度一半限制，高受竖段
高度一半限制。表面按smoothstep曲线抬起，body仅添加空凹角的有界视觉楔形，采用
原world物理纹理坐标；cap原图各X列垂直平移，允许局部剪切，未旋转或缩放整张图。
cap底部保留24段短覆盖过渡，靠墙另覆盖8world真实岩壁后渐隐，避免直条收头。
原PNG/源Alpha不变，source-over的有效Alpha和混合像素会改变。

候选整个空矩形先按网格正面积及曲线surfaceMinimum检查，碰到其他占用区保守跳过，
防止薄顶棚处增加视觉形状。cap需要完整深度实际支撑，墙内覆盖也必须落在原实体；
世界边界、窄台、低墙或支撑不足不强制生成。预算固定限制owner、边界比较、空间
探测、覆盖mesh和triangle；超过预算拒绝，不能以部分成功跳过剩余请求。

作者格子、曲线轮廓及碰撞建议保持。新增视觉楔形确实进入原逻辑空角，不能声称
所有显示像素都在原碰撞实体内。CPU/Pixi统一在同地形层的body/cap/native之后绘制
cornerMeshes；自动笔刷、擦除、撤销和重开每次按当前作者重编译，不是地图贴纸。

`upgradeTerrainStepCornerKit`/`verifyTerrainStepCornerKit`提供零生图、新revision的
确定性副本、导出、ZIP和篡改重放检查。原PNG一张不增；新来源controls.stepCorners
可直接显式启用，必须已声明union材质，不能通过HTTP选择路径或生成命令。

这会软化墙脚接壤，不会自动生成新的凹角绘画或测得真实碰撞圆角。当前先支持平坦
低台的明确内角，斜坡低台、遮挡复杂的洞口及浅支撑可能跳过；整景美术仍另审。

## v6可选外露侧边终止（0.75.0）

工业端包边可显式设置`sideTerminationProfile: "exposed-side-only-v1"`，使完整角图
在真实外露竖段结束处停止，不把长板皮继续贴到下层墙。它沿实体并集判断接壤，
同一外露链跨作者对象仍连续，不退回逐格贴图。缺省旧v6仍保留自然支撑尾部。
来源RGBA、作者几何与碰撞不变，新设置生成独立revision。字段仅允许v6，未知值
拒绝；新来源交付controls同名显式选择，不按主题名称静默修改旧包。

城市`engineered-city`来源仍需独立完整竖边/转角、真实坐标与尺度量测；通常配合该
终止profile，省略自然materialLoop和stepCorners，保留工业直角。此选择处理边界
终止，不保证任意高度的fascia与world body板缝同相位，也不替代实际新刷/加高/
台阶审阅。具体合同见[外露侧边终止](terrain-side-termination-v1.md)。

## 显式单源外观规则（0.87.0）

新来源可在`previewTerrainEdgeSources`/`freezeTerrainEdgeSources`的每个`items[]`
中显式声明`sourceAppearance`：

```json
{
  "format": "ai_scene_source_appearance_v1",
  "profile": "source-owned-appearance-v1",
  "rules": ["Crisp broad painted stone faces with the original material colors.",
            "Match the native feature scale and upper-left light direction."]
}
```

这些1至16条明确选择的规则只描述该来源的外观。启用时，编译器以共享单源外观
段替换整景`style.rules`，不继承其中的主体数量、台面布局或前景必须出现等要求；
不按词表猜测、过滤或修改已冻结整景样式。内容、支撑、边界朝向仍由本项brief及
角色合同拥有，完整参考与完整材质两张输入及原色/笔触/光向用途保持。

声明绑定到新plan recipe与sourceScope证据，其规则变化会形成新计划和新摘要，
需要独立的一次计算决定。规则由调用者明确选择，合同不证明文本已经语义纯净。
未声明此选项的旧v29至v37提示、请求与计划字节保持。原有全周角色、原生尺寸、
透明边距、RGBA保留、接缝量测、重放及失败/未知终态门均不改变。
