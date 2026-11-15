# 有限背景景带的边界与原生回拼

0.84.0新增显式 `background-band-v1`，供需要有限镜头覆盖的 `backdrop` / `valley`
来源选择。v4单层职责继续生效：远山、后方林谷、天空和玩法地形仍分别归属各自
来源。独立树、岩、建筑等完整单体继续使用原闭合轮廓规则。旧scope、计划、授权、
PNG、kit和默认行为不迁移；不能在旧冻结提示中直接改掉边界要求。

0.85.0另加 `background-band-guided-v2`，显式选择
`format: ai_scene_background_band_v2` 和
`guidanceProfile: three-edge-continuation-v1`。camera、parallax、有限覆盖框和量测门
继续相同；旧v1提示、请求及摘要不变。

0.86.0新增 `background-band-coverage-v3` / `ai_scene_background_band_v3`，将素材
自身画幅、上沿所处区域与主要结构频率组成明确的软覆盖预算。选择
`guidanceProfile: normalized-three-cut-coverage-v1` 及
`boundaryProfile: natural-top-finite-three-cuts-v1`，同时声明
`coverageBudget: {profile: normalized-relative-coverage-v1,
upperContourPercent: {min: 4, max: 12}, majorFeatureWidthPercent: {min: 22, max: 32}}`。
它不是场景像素复制或固定峰数，仍须保持主题、原色、层级和实际回拼的整体观感。

v3的固定程序图按本素材canvasAspect生成真实同比画布，指导相对覆盖及主要结构
频率；仅不复制准确轮廓、峰数、灰色和示例笔触，不再用“不要复制比例”抵消该
技术指导。上沿以上真实透明、自然轮廓不触顶；同层侧下绘画允许到native有限截边。
此新QA仅检查顶端外两圈Alpha≤1和既有真实透明/尺寸/内容门，三条声明截边的
强Alpha属于有限素材终止，并不是独立单体遗漏的完整轮廓。所有原RGBA保持，
不补边、不修Alpha、不恢复隐藏部分；旧v27的四边QA和两张历史失败原样保留。

## 开放纵深景带v4

显式 valley 子型 `open-valley-irregular-coverage-v3` 提供另一张固定透明中性示意：
同一深度的不规则实体与真实空域，不绘制桥塔、细柱或题材纹理。来源 brief 决定
是否存在自身桥梁及其遮挡，真实结构可以分隔空域；本子型不把四连通透明通道
设为验收门。示意仍有两侧实体和中央空域的构图暗示，不能保证模型的主体纯度。
它不替换 v1/v2 guide、不修改历史计划或授权；新计划仍需准确单次授权，并分别
检查原始连续 Alpha、来源职责、有限镜头覆盖、尺度及实际画面。技术成功不授予
最终美术接受。

0.88.0增加显式`ai_scene_background_band_v4` / `background-band-open-depth-v4`，
适合同层实体之间有真实水域/空域的海沟、遗迹或其他开放纵深，不隐式替代实心山体
的v3。选择`guidanceProfile: open-depth-three-cut-coverage-v1`，沿用同一有限camera、
parallax、coverageFrameWorld、canvasAspect、coverageBudget和
`boundaryProfile: natural-top-finite-three-cuts-v1`。

固定新guide是原生RGBA透明PNG：中性灰只表示若干抽象同层纵向实体，内部有真孔洞，
主体之间有贯通上下、中部和底边的大空域；没有opaque灰色surround、全宽波浪上沿
或连续封底。最高实体可进入上4–12%软区，但不要求每列都有上沿或实体；22–32%
只指导主要大形频率，不指定形状或计数。实体穿过左右/底有限cuts则延续自己的材质，
空域穿过cuts仍保持真正透明，不能用水色、天空、波纹、雾幕或共同底座把它们连满。

新prompt不继承v3的“余下高度为连续实心body”说明。第一输入仍为完整接受参考，
第二输入为按真实画幅和角色生成的固定open-depth图，recipe和PNG digest分别绑定。
公有输入导出、预约和model重放核对准确顺序/字节；单输入适配器、篡改guide或混用
v3 profile不成立。可与source-owned-appearance-v1 scope v6组合，两条整景文字泄漏
路径仍被隔离，暗前景/地标等独立来源不因景带升级改变职责。

QA仍保留顶外两圈Alpha≤1、真实透明、尺寸、非空、blank和reference-reuse等门。
三边强Alpha只允许新v4显式截口，不要求每个截口像素填满；没有自动孔洞或水色
语义检测。full-native量测与有限镜头域不变，原RGBA全部保留。范围通过只说明
范围，实际实体/空域、无虚构水面顶沿、原色、尺度、接缝和Studio仍需独立看图。
不能后期抠除蓝水、改Alpha、裁空角或放大把坏边藏起来；失败需新的准确请求。

旧v1/v2/v3的prompt、plan/request SHA、固定guide PNG和历史失败QA保持，不把旧图
重新解释成局部雾采纳。新profile也不保证生成遵从或授予最终美术接受。

### 开放海沟拓扑子型v2

0.89.0在同一band-v4合同内增加显式
`guidanceProfile: open-trench-three-cut-coverage-v2`，仅允许`valley`职责。未知子型、
把它用于backdrop或其他角色均拒绝；原open-depth-v1仍支持backdrop/valley且字节
不变。没有按主题词或自由文本自动选子型的分支。

新固定透明图展示宽大、连接侧边/底边的阶状实体与中央贯通上中底的沟槽，所有
空域是真Alpha0；不含封闭孔、拱洞示例、细高孤柱、灰色背景或全宽封底。它教的是
素材自身的“宽侧体／开沟”拓扑，不是完整场景的左右可玩台、中央浮台、固定位置、
实体数量或形状。最高部分4–12%与主要大形约四分之一仍为软预算，不锁像素。

新schema只扩展已声明guidanceProfile的枚举。scope/plan runtime与固定guide helper
都独立校验valley角色；compiler、第二输入role、recipe/PNG摘要与model重放绑定新
子型。旧v4开放体块示例、完整prompt/plan/request/guide SHA均有固定回归，不把
原示例中的细块或孔洞静默删掉。

同一自然顶门、有限三截边、原RGBA、source-owned-appearance、full-native frame及
有限camera域继续保持。测试能验证程序合同与合成来源的回拼重开，不能保证真实
生成不画高柱或桥群；真实结果仍需先正确Alpha合成，再审内容、拓扑、尺度与接缝。

新QA通过依然不等于可用。full-native量测须验证各camera模式下侧下终止位于
声明视域以外，主要结构的量级/位置/对比与参考整体协调，实际原生密度单独报告。
不足时须新的冻结方案，不能用非等比拉伸、重复山片、改色遮掩或缩窄已声明相机
域来冒充通过。工具的建议分辨率也不能当作返回尺寸保证。

## 固定中性覆盖示例

guided-v2每项恰好两输入：第一张完整已接受参考负责原色、笔触、光照与内容；第二张
由版本化程序生成的backdrop/valley角色示例，只表达上沿自然开放、同层实画持续到
左右及下端小技术边框的相对关系。固定recipe和PNG摘要随准确计划冻结，公有导出、
预约、接收与重放核对顺序和字节；不接受调用者自选图、角色互换或一输入适配器。

第二图的浅灰外围是技术展示区域，输出仍须真实透明；不复制灰色、精确轮廓、峰数、
构图或扁平画风。提示明确下方必须有新同层绘画，不能在山脚下再留大块透明，也不
以放大主峰、透明补框或环绕羽化替代延续。示例不能保证模型遵从，原技术门、原生
量测及独立图审继续生效；实际失败仍停止，新提示/第二输入须新计算确认。

## 边界的用途

景带上沿保留真实透明天际线或树冠；左右和下方把本层内容延续到声明镜头范围
之外。此版仅支持 `transparent-silhouette` 顶边及三条 `camera-overdraw` 边，
`repeatAxis`固定为`none`，不提供遮挡认证或自动横向循环。

v1/v2来源仍需通过原v27透明PNG技术门，包括外两圈最大Alpha≤1、尺寸、非空和真实
透明比例。2px透明技术边框和侧下12%艺术留白的用途不同：新景带不再要求三边
自然收成孤岛，不以环绕雾化收口代替场外山坡、沟壁或景深内容。旧来源的技术
结论保持；透明补框不能补出新绘画内容。

## 有界镜头范围

`backgroundBand`结构化绑定参考中心、镜头中心域、实际世界视口、相机模式、
真实层视差、目标覆盖框及素材自身宽高比。它随scope v5和准确请求摘要冻结，
首批 `sourceScopes` override与来源修订都须显式选择。

当前Pixi的Play视差偏移是 `(C-C0)*(1-p)`，因此景层局部镜头中心为：

```
editor-unparallax: C
play-parallax:     C0 + p * (C-C0)
```

同时声明两种模式时必须取所有采样视窗的并集。透明天际线上方可以是天空，
不要求整幅矩形填色；三条终止边必须超出各模式的镜头采样域。真实层视差不能
用默认值猜测，纵向视差为1时纵向行程须全计入。

镜头/视差数字属于规划与审阅元数据，不能变成旧参考构图的硬像素复制指令。
生成提示只给单层内容、素材自身画幅比例、边的用途和同层延续要求。画外新内容
标为设计推断。实际来源仍须单独检查内容连续、画风、远近对比和整体回拼。

当前Studio的Play游戏窗会受地图边界夹紧；一屏大小地图的默认游戏窗只能停在
中心。扩大后的声明域需要自由预览或固定世界视口探针验证，不能把声明当作已
改变相机。无限编辑器拖动、额外缩小、改视口或扩建关卡均超出该有界保证。

## 原生量测与派生

选用景带的来源禁止走旧 `observedEnvelope` contain。未给量测记录的候选必须
报 `COHERENT_BACKGROUND_BAND_CALIBRATION_REQUIRED`，普通transform/contact不能绕过。

新measured composition v5的 `bandPlacements` 每项绑定：

```json
{
  "instanceId": "ridge.actual",
  "sourcePlanSha256": "<exact-plan-sha256>",
  "sourceRawSha256": "<exact-native-png-sha256>",
  "nativeFrame": {"x": 0, "y": 0, "width": 3328, "height": 1408},
  "sourceToWorld": {"numerator": 1, "denominator": 2},
  "positionWorld": {"x": -320, "y": 64},
  "backgroundBandSha256": "<exact-band-contract-sha256>"
}
```

坐标仅示范一份有限覆盖设计，不是跨主题通用裁剪坐标。完整native frame必须
保留，不能用裁图或透明补框伪造内容范围；原生像素不按旧包络缩小。派生不产生
虚构高分辨率，Alpha>0的RGBA保持；Alpha=0仍按既有kit约定归零RGB，原PNG全字节
保留。实际px/world与2px/world目标分别报告，显示缩放不能冒充已生成更多像素。

程序核对来源/计划/边界摘要、full frame、视差、有限镜头并集，以及画框和Alpha≥8
实画包络的侧下极值。包络范围通过只证明范围条件，不能证明每段终止轮廓均在
视外、山坡和林谷内容连续，也不认证语义纯度、美术或接地。新来源返回后仍需准确原图/摆位/
镜头移动的独立视觉审阅；编辑改变摆位或相机条件后应重新核验。

若实画包络离原图底边较远，先算是否能以目标景深比例满足范围。原生画框的顶端
必须不低于设计框顶。取允许的最靠下原点 `Ymax`、原生 `Alpha≥8` 包络的下边界
`B`（末行加一）和镜头并集下沿 `V`，实际缩放 `s` 须满足 `Ymax + B × s > V`。
先比较这个下限与按参考选定的比例，再在接近下限的少量摆位上看正常镜头和两端
视差。可分别量桥洞上部留白和主通道可见山体。若范围通过的摆位失去参考中的
层次，将实际山脊和同层下部延伸的位置写回修订 brief。原生高度、像素范围和
美术结果分别记录。下部延伸应由本层可见形体承担，保留真正空域。

## 已有完整地形包只替换背景

`buildVerifiedBackgroundBandVariant` / `verifyVerifiedBackgroundBandVariant`提供受限的
零生图新revision路径。输入精确pin的完整kit与其祖先bundle、新coherent candidate
的workflow/batch/composition/expectedBundleSHA，以及明确的景带asset白名单。
新candidate通过公有API独立重放，旧/新来源只允许声明的背景项变化；reference、
target、材质及其他来源身份保持。不能用普通prop、额外文件或重新seal祖先元数据
绕过。程序生成新catalog/kitRef/manifest，并导出重开校验；旧snapshot不被覆盖。

保留旧terrainAppearance、七项包边、其他PNG、原作者地形和碰撞，只替代这两个
背景模块、对应PNG与默认摆位。它不将旧edge批次重绑成新base，也不声称重跑旧
生成或继承美术接受；诊断地图作者数据保留，不保证任意复杂地形均低于原预算。

## 计算与历史

新景带必须通过新准确计划的一次性生图确认。只重画明确列出的来源，保留旧图、
旧QA、旧kit与用户工程。失败、未知或明显混层仍停止，不自动重试；测试使用
synthetic/doubles，实际图片另作独立案例。技术通过和人类最终美术接受分开。
