# 凹角墙端的连续覆盖

先隔离原色 `step-corners`、no-step 和原生墙。v1 ramp将8-world墙端重叠分为四列，
每列取一个常量透明度；源Alpha、采样与支撑都正确，仍可能有四条突变。保留同相机的
四列/细分诊断，确定跳变随绘制分段改变，再判断原生岩肩和材质接片的剩余问题。
不要为一个量化过渡重生上角，或用淡出隐去错误来源职责。

新交付可显式选择：

```js
controls.stepSurfaceProfile = 'native-lip-linear-step-end-v2';
```

它沿用[表层绑定v1](terrain-step-surface-v1.md)的native行数、完整相邻span、完整cap
支撑/空气/边界探针及几何范围。新增绑定记录为`ai_scene_terrain_step_surface_v2`，
由同一`buildTerrainStepSurface`创建并独立重放；默认及v1选择的记录、编译和像素不变。

## 绘制合同

- 墙端仍只有原四列、原8-world范围和原顶点/UV/三角形。每个顶点存
  `vertexCoverage`，配合固定`coverageInterpolation: 'linear-vertex-coverage-v1'`。
  末端系数按world X从接触墙处1线性到外端0，再乘原native行fade的带状系数。
- 将同一角的墙上重叠四列/各行带合成一个indexed mesh，最多400顶点。空气中的
  ramp、body wedge、原生上/侧/底和shared cap保持。合并不改变各quad坐标或源采样，
  mesh数减少；原三角形、顶点、角点、拓扑/探针预算不增加。
- CPU按三角形重心坐标插值覆盖；Pixi固定shader以同一顶点覆盖乘原premultiplied
  RGBA和标准颜色/变换。重复U、clamp V、原PNG Alpha与颜色保持。只有typed数值，
  没有请求提供的shader、代码、命令或路径。缺失覆盖字段的旧mesh走原uniform路径。
- 这是8-world重叠内的**透明度重新分配**，不是相对v1逐像素只减Alpha。旧常量的
  一部分位置提高、另一部分降低，端点变为准确的1/0；不得把整景Alpha积分或岩形
  连续性说成自动保持。PNG Alpha不变，重叠以外不新增paint，原支撑与碰撞不变。

新kit编译为`ai_scene_compiled_v8`，防止旧消费者忽略新顶点字段而画成不透明块。
更新的Pixi消费器仍支持v1..v7；v7冒充的新覆盖、错误位置/形状、非有限或越界系数
明确拒绝。保存/导出仍由当前编译器重放，不把手写compiled数据当作作者文档。

验证应包括双方向、native行fade叠乘、相机平移、原色CPU/软件WebGL一致，以及销毁
新资源后旧像素恢复。再看真实来源的短/长凹槽、grid/curve、原预算负例、刷卡、实际
擦画、撤销/重开与导出。no-step和空气ramp须保持，差异应限于原墙上重叠区域。
较平滑的透明度不修复两张原图的岩缝、形体、尺度或光照；人类美术接受仍独立记录。
