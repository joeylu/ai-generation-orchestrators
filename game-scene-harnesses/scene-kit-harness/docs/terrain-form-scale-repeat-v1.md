# 岩形尺度、接片与循环审阅

复用准确来源与[接合隔层诊断](terrain-join-diagnosis-v1.md)，分别检查连续主体、侧壁、
下缘及转角。原生 Alpha/collar 连续只证明有 paint 接住，不证明岩块构造、长轴、受光
或岩缝在接触处延续。对参考允许的比例与细节变化保留余地；桥腹小石与主崖大岩可能
是设计层级，不能仅凭它们大小不同就判为失败。

原生侧壁的完整 PNG 高度、repeatY 窗口和实际完整源重叠步长也要分开。
有 junctions 时，实际排布间隔来自 `wallRepeat.stepWorld`，可与窗口跨度不同；按
编译后的 nativeOriginWorld 核对，不能把窗口长度当实际复现周期。适度增加步长
只减少复制密度，不增加原图内部岩形；原图已有等距凸起时仍会重复。新步长必须
独立重放完整上角/侧墙原生 Alpha 支撑、尾部、两方向、短台和桥柱，不能保留旧证据。
只在新的候选中比较固定少量假设，不按 Alpha 通过或周期更长自动采用。

## 先量实际物理密度与特征

- 从有效 material 读取 body PNG 尺寸和实际 world period，分别算 X/Y world/texel。
  有 loop/rigid repeat 时使用其已重放输出和有理周期，不用默认 512×256 代替。
  包边的显式 uniform scale 是投影前的基轴密度；窄台内伸适配、曲面投影与裁切还会
  改变局部显示，须检查实际编译结果和正常镜头。
- 密度比不是岩块尺寸比。同一材质的两个 PNG 可以在原画中画了不同大小、数量或
  朝向的石头。注明具体可见特征、原生范围、方向与是否裁断，换算到同一 world 和
  显示比例再比较；不要由相同 scale、分辨率或材质锚点推导形体匹配。
- 试图放大包边时，联合复核完整上角尾部/侧墙叠合、七项 collar、下缘外伸/淡出、
  最短跨度与原预算。若保持短跨度而缩窄 native collar，重新读准确源 Alpha；不能
  沿用另一尺度的通过记录。单侧或一条 collar 通过，不代表完整角色组通过。
- 若主体尺度合理、包边放大又超出有证据的适配范围，保留源适用性缺口。重复贴片、
  填 Alpha、扩大支撑、移动相位或全局缩小 body 都不能重新绘制跨来源岩缝；缩小
  body 还会增加同一画面的出现频率。不要为统一大小破坏参考的主崖/小平台层级。

## 接触处的相位反事实

若尺寸和支撑已有证据，仍须区分“主体某块岩石恰好接不上”与“包边自身的岩形和
节奏不同”。可固定少量相位假设，用只读 `createTerrainBodyPhaseDiagnostic` 比较
同相机的完整图、body 与原生层；不按色差分数扫窗选一个看起来最佳的接片。

```js
import {createTerrainBodyPhaseDiagnostic, TERRAIN_RENDER_DIAGNOSTIC_GROUPS}
  from '../src/index.mjs';
const diagnostic = createTerrainBodyPhaseDiagnostic(compiled, {
  groups: TERRAIN_RENDER_DIAGNOSTIC_GROUPS,
  phase: {u: 0.25, v: 0},
});
```

`phase` 只有有限的 `u/v`，每轴限制在 -1..1；一单位是当前 checked body PNG 的
实际 UV 周期，不能套用旧 512×256 world 周期。该函数先执行原隔层选择，再同步
平移所有保留的 body 纹理消费者：主体、fieldBoundaryBands 的阴影采样、凹角
`materialKind: 'body'` 补体。遗漏补体会制造人为的静止三角接片，遗漏阴影采样也会
混入两种相位。cap、step-cap、原生侧/上下角/底缘 UV、位置、索引、覆盖和相机不变。
原图和作者/compiled 输入不修改，诊断 frame 没有 compiled contentSha256，不能导出
为已验 kit。报告绑定原 compiled、隔层和显式相位，列出各类消费者数量。

非整周期偏移也会改变原本接受的 body/cap 注册，局部接片变柔和不能证明这个偏移
适合交付。比较台阶、桥柱/桥腹和长墙等不同接触；原生隔层应逐字节相同，剩余岩形
在这些局部同时可辨时，保留来源适用性问题。少量相位不能证明所有参数都无解，
更不能重画原图中的岩缝、长轴或明暗。最终美术决定继续独立记录。

若接触证据最终支持仅修订一侧墙，可用
[侧边子集选源](terrain-side-source-selection-v1.md) 将新已验来源与旧上角/其余角色组合；
先冻结受影响来源的准确新计划，不因旧入口只支持成对上角而重生全部角色。

## 周期边界与内部切片分开

现有 `source-pixel-closed-overlap-cycle-v1` 选择原 RGBA 像素，保持基轴采样密度。
三相方案对同一有限来源作水平平移，再在原生重叠内选择切线；不是三份新岩形。
完整输出周期、相位步长、侧墙自身周期及原图内部已经重复的形体分别记录。
相位步长不能当成纯纵向复现周期，延长完整周期也不证明“大岩形不重复”。

```js
import {reviewTerrainMaterialLoop} from '../src/terrain-material-loop-review.mjs';
const review = reviewTerrainMaterialLoop(kit.terrainMaterialLoop, {
  appearance: kit.terrainAppearance,
  readAsset: path => checkedFiles.get(path),
});
```

该只读 API 先完整重放旧 loop 的原图、输出和 provenance，再量一个完整输出周期内
全部非连续 source-neighbor：纵向切线、切线路径变化产生的横向分支，以及相位平移
搬到输出内部的原图横向 wrap。分别报告实际 RGB-L1 和相对两端原生非 wrap 梯度的
超额、最坏位置及来源坐标；同时保留输出四周的 wrap 量测。只把输出首尾相邻行接成
原图连续两行，仍可能在内部从远处跳回；旧四行带状量测也可能稀释一小段切口。

这些值不是语义岩形检测、美术分数、技术放行门或自动选窗。柔和 RGB 仍可能截断
整块岩形，高梯度也可能是正常岩缝。不要按分数扫窗直到“通过”。保留明确负例，
对固定的少量假设比较同相机 body-only 与整合结果，再检查至少完整实际周期的 Studio
长墙、桥洞、短台、曲线及原预算负例。隔层无变化应逐字节验证；任何候选继续独立
记录最终人类美术决定，既有工程与原图保持不变。
