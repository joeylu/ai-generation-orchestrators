# 短跨度原生底角的自适应覆盖

0.83.0提供显式 `native-bottom-adaptive-coverage-v2`，作为native bottom v2的新增
junctionProfile。旧 `native-bottom-endpoint-underlap-v1`、未选择profile的旧包、
原生来源计划/图片请求及已导出交付保持；新profile仍须显式选择并重新派生独立kit。

## 为什么需要

完整PNG、真实透明边距、不透明collar及world UV都通过，短高/短宽地形仍可能出现
矩形接界。三个可复现原因分别是：底角上行竖臂在wallStart处突然出现；原始内侧
淡出点在40world但64world短台已在半宽32world硬裁；下缘切回在顶部覆盖物原淡出
之前截断cap。它们属于通用覆盖/绘制顺序，不能用单张PNG技术通过来认证观感。

## 显式选择与流水线

在既有七角色全周controls的bottom中选择：

```json
{
  "nativeSizeProfile": "bounded-native-4m-v1",
  "renderEnvelopeProfile": "visible-alpha8-outward16-native-rgba-v1",
  "junctionProfile": "native-bottom-adaptive-coverage-v2"
}
```

同一bottom对象仍需实际量测的edge/leftCorner/rightCorner控制点。SDK/CLI继续使用
terrain-edge delivery或原三下缘升级入口，原native source接收、技术QA、准备/接受
记录和最终美术评审保持分离。选择此profile不生成图片，不授权、预留或重试任务。

## 新有效覆盖

- 下角竖臂在wallStart起2world淡入，原侧边端点underlap继续成立；仅真实solid内
  保留必要旧侧面底衬到下缘切回，外侧旧轮廓仍按原生端点移交。
- 下角在真实可用reach结束前至多8world淡出，包含其横臂；水平下缘以同一原生
  比例、相位和repeat窗延伸到淡出之下。短span不把尚未淡出的100%覆盖直接截断。
- 凹角向上延展的同一原生侧边保留相位，并在顶端至多8world淡入，避免新stub横线。
- union material保留原solid三角形中的原始exposed cap bands。CPU与Pixi在同层全部
  下缘之后、凹角surface ramp之前绘制这些受支持覆盖；中央cap同时遵循原side的
  职责裁切，不能重新填满顶角和侧面已让出的区域。原生上角从早绘队列移动到
  单次晚绘队列，原位置、UV与源Alpha保持。绘序为body/侧面/下缘、中央cap、
  原生上角、step ramp；洞口和空气不增加三角。
  短高若碰到真实bottom cutback，在其顶线前至多8world淡出、cutback区为0，保留
  下缘原生Alpha让出的凹槽；普通浅覆盖保留，深唇不足空间时如实记录覆盖变浅，
  不以晚绘完整opaque cap重新填出底缘已让出的空气。cap采用一次source-over，
  不能因早/晚重复绘制把原有淡出加深。

Pixi入口跳过没有三角形的mesh，非空非法position/UV/index仍报错。零索引片段
不能交给自动batching充当零尺寸draw，否则其后可能读到过期index buffer。
CPU预览不能发现此类GPU告警，需另以软件WebGL回归验证。

源PNG及native UV不改，Alpha仍是原值；改变的是mesh有效coverageOpacity。此能力
不是抠图、补画、镜像、旋转、调色或轮廓恢复。原side/end-point来源与准备nativeFrame
继续验证，collar≥250、Alpha8/outward16、同原生等比尺度及显式工作/三角预算保持。
支持的top band副本同样计入原union输出三角预算，不能绕过复杂度门。

同一原生placement内互不重叠的覆盖分片，可在相同material/source/coverageOpacity
下合并indexed draw。v2水平下缘同一chain的相邻半开repeat窗也可合并；各窗原
origin/interval保存在精确vertex/index range的`coverageGeometryParts`中。
每个原三角、位置、UV及常量opacity保持，不跨重叠source层调整source-over顺序，
也不合并旧版全RGBA重叠repeat。此整理减少draw mesh，不减少三角、放宽复杂度门
或把超限案例改判成功。

## 独立水平薄台的顶沿

如果圆角旁留出方形边，先用相同源图、台面几何和接合坐标，对照是否启用了
`author-solid-world-body-v1`。它保留作者实体内的原始体材，因此可能在原生
圆角让出的区域留下底衬。按当前素材决定是否采用，并用最薄台和桥洞复查顶沿、
实体内搭接和空气区域。独立薄台顶沿选项依赖该底衬。

底缘淡出进入作者台面高度时，底缘有可能抹掉一整个薄台的顶沿。量测底缘原生内伸，
扣除两逻辑单位搭接，并将裁剪及淡出深度和设计最薄台厚度一起验证。先在实际
Studio 核对该厚度的可见顶沿。更浅的原生取样也须通过原有不透明搭接校验。

启用 `bodySupportProfile: 'author-solid-world-body-v1'` 的新交付可同时显式选择
`thinPlatformTopProfile: 'isolated-flat-platform-top-v1'`。当底缘覆盖完整宽度、台面
水平且属于单独的曲线实体，且淡出触及台面时，保留已由原实体支持的中央顶沿。
原生上角在顶沿实测深度内保留其实体内片段，其他片段沿用底缘淡出。保留部分仍在
原有三角、网格与工作预算内。通过 `retainedThinPlatformTops` 核对实际应用范围。
此选项保留原始取样、底缘网格、碰撞与台面外空隙。窄平台的端部轮廓仍需独立美术
审阅，特别是上角源本身的外露笔触。

## 验证与边界

回归需用高对比合成素材重现短高台/短跨度、桥腹/洞口，至少比较雪色和工业两种
palette；语义规则不检查或猜测颜色。检验角Y淡入、淡出前半span、顶部实际颜色
保留、原solid/洞空气、UV/碰撞/原PNG、旧v1内容SHA及CPU/Pixi绘制顺序。
真实素材只用于独立实际画布验收，不能进入生成或软件WebGL自动回归fixture。

coverage改善不意味着不同生成来源的岩块尺度、明暗或笔触自动一致。新样本仍须
独立测量、回拼并检查1倍整体及4倍接头。源生尺度不匹配不能靠放宽frame、删Alpha、
改变颜色、伪造源图测点或声明全部主题通过来掩盖。所有最终人类美术接受另行记录。

冰雪实测22个组合中21个可编译；25格棋盘点接触仍需要355002个相关三角，超过
原262144上限，因此明确以`TERRAIN_BOTTOM_BUDGET`拒绝。它不是已支持的第22个
渲染案例。保持原UV场的精确局部重三角化收益不足，已移除实验代码，未改像素、
UV精度或覆盖分带来擦线通过。编辑器必须在提交作者/历史/版本号前检查可编译性，
超限失败后上个有效地图仍须可读、可继续编辑。
