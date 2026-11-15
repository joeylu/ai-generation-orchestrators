# 按参考量测的地表派生

0.60.0新增显式测量映射。它修正0.59.0把固定32px过渡当作通用改善的错误：旧材质
裁法从原图高1/16处取表沿，可能丢失顶部亮面；扩大该区间只会放大暗苔/岩面，
并不等于更接近参考。0.59水车候选已被用户拒收，原候选和决定保持。

## 输入与比例

`compileMeasuredSurfaceMapping({reference,target,material,observations})`绑定已接受参考、
target和当前批次原材质PNG。Agent提供的近似原生像素观察包括：

- 参考地表上沿到首排岩肩接合处的多处样本；排除树根等遮挡，不把最长苔尾当整层厚度。
- 原材质的表面起点、岩肩起点、水平取样窗口中心；表面起点允许0，保留已有亮顶。
- 同一材质家族若干宏观岩面宽度对。它们不是同一块石头的像素对应。

程序以岩面比例的下中位数确定统一有理数倍率，两轴及地表/岩体共用，不单独拉伸
亮顶来满足目标。深度差异进入兼容报告，保留人工观察的不确定性，不自动授予美术
通过，也不设精细像素对齐前置门槛。参考的像素只供观察和身份校验，不成为kit贴图。

`deriveMeasuredField(raw,mapping)`输出body505×253及可变高度cap，保留原上沿到相邻
岩土的连续绘画。cap全不透明，只含1 field像素同源采样交叠，没有固定8行渐隐。
浅实体裁短几何与UV。顶部亮面、垂挂和岩肩是否自然，仍由参考与实际画布对照决定。

body源行不足253时，按原倍率采完可用整行，再周期补足；报告bodySampleHeight、
bodyFill和重复区间，不缩放源来掩盖尺寸不足。只有声明的水平周期collar和最终
底部4行闭合；首部相接源行保持。内部重复位置需要视觉检查，深岩壁可能出现重复。
不调色、不画草/阴影、不做语义分割或Alpha清理，原PNG保持。

## 组装和运行

composition v4内嵌完整sealed mapping，继承v3的实测表沿曲线、接地、层序和显示密度。
编译器重新核对真实reference/material字节和target，拒绝旧映射套新材质。kit的
appearance v5绑定mapping SHA、源行原点、有理数capDepth与capUvEnd。
CPU与Pixi消费同一几何和材质；技术接缝检查不认证画风或自然感。

project v4是新项目默认，保留单层v4和显示密度v2。它不再悄悄选用固定32px地表。
原图技术收齐后，Agent准备测量数据，再交给程序派生；这不是新增生图或用户审批。
缺测量时driver返回awaiting-surface-mapping，不生成一个伪完成的包。SDK可通过
operator.calibrateSurface提供类型化观测，程序不自动调用模型。

```text
coherent surface-review --root PROJECT --observations JSON --out FRESH_DIRECTORY [--base-composition JSON]
coherent deliver --root PROJECT --delivery FRESH_DELIVERY --composition FRESH_DIRECTORY/composition-profile.json
```

surface-review保存准确原参考/原材质、观测、映射、配置和可重放校验清单，零工作流
事件、零图片调用。可从经验证的旧配置保留布局，旧美术接受不会传给新候选。
新的图片生成仍要求新冻结计划与一次性确认；本确定性派生不使用或增加旧预算。

旧project v1—v3、composition v1—v3及旧appearance保持原语义。自然端帽、任意转角、
源图未提供的顶面结构不由裁切补齐；如果已有来源不能提供所需结构，必须另行规划。
