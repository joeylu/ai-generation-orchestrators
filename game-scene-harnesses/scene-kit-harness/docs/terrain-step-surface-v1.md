# 凹角 ramp 的显式表层绑定

先按[接合诊断](terrain-join-diagnosis-v1.md)隔离 `step-corners` 与 shared surface。
旧 `concave-source-surface-ramp-v1` 独立采样整个 cap，包括附着岩肩和末端淡出；shared
surface 已采用 native lip 或短跨度浅覆盖，并不会自动改变 ramp。若深覆盖只在 ramp
恢复，不应再生成上角、缩小主体或清理 Alpha。

新交付可显式增加 `controls.stepSurfaceProfile = 'native-lip-bound-step-coverage-v1'`。
必须已有 dense union、v1 native-lip 接口与 stepCorners；原 stepCorners 的宽、高、16段
和五字段几何合同不变。交付程序另写 `kit.terrainStepSurface` 与独立证据，绑定实际
cap PNG/映射、完整接口、准确 step profile，以及存在时的连续 span companion。
包含 surfaceCycle 时绑定已验证的有效 cap；不改原图、旧生成计划或历史接收记录。

程序入口 `buildTerrainStepSurface` / `validateTerrainStepSurface` 返回/重放封闭记录。
kit 加载、编译、Studio 快照、导出与交付独立验证均检查绑定。缺失字段的旧 kit 仍使用
完整 cap，不能把这个选择悄悄追溯到历史 candidate 或用户项目。

- 覆盖跟随相邻的**完整连续暴露顶面跨度**，跨网格/曲线及作者分段，与 shared surface
  的 span 选择重放一致。不能用 ramp 的32-world局部宽度、最后一格或匹配采样段来
  重新决定深度。没有 companion 时明确使用完整 native-lip 接口行数。
- 原 capDepth/capUvEnd 到源行的密度保持，仅裁绘制覆盖及淡出；不把整张 cap 压进新
  深度。body wedge、原生墙/角/底、shared cap、作者形状与碰撞保持。墙上原8-world
  overlap 和末端 fade 也保持，不能借此修补独立来源的岩形或光照。
- 这是保守的只减覆盖版本：完整 lip 的末端须位于旧完整 cap 的全不透明区内，避免
  改变带状淡出的量化后在某些点增加 Alpha。不适合这一条件的接口明确拒绝，不自动
  截短、换图或放宽检查。短跨度 envelope 仍须通过自己的只减覆盖约束。
- **保留旧的完整 cap 支撑/空气/世界边界探针**。实际绘制变浅，不据此自动允许新
  ramp、跨过薄天花板、填洞或借用无关实体支撑。可能保守地跳过本可放下浅覆盖的
  位置；本版本不扩展几何适用范围。
- 拓扑重放工作计入原 step candidate budget；mesh/三角形/角点/探针上限不变。
  每角 `surfaceCoverage` 记录行数、完整跨度、实际深度、fade与旧支撑深度。report
  原 `capFadeWorld` 是 legacy full-cap 参数，新绑定的实际值以每角记录为准。

比较两侧台阶、一格凹槽、grid/curve错台、短/长相邻跨度；特别检查仅改变深度后是否
露出竖条或岩肩接片。隔层证明非 step 图层不变，软件 WebGL 合成检查覆盖单调减少，
再用准确候选核验组合预算、实际擦画、撤销/重做/重开、刷卡与导出。技术绑定正确
不能证明轮廓自然；最终人类美术接受仍独立记录。需要修来源时另冻准确计划、取得
新摘要绑定单次授权、持久预约后调用，失败/未知即停。

若深覆盖已正确而墙端仍出现四列透明度突变，另看[连续末端v2](terrain-step-end-fade-v2.md)。
它不静默改变本v1，只为新候选显式重新分配原8-world重叠内的覆盖，并要求compiled v8。
