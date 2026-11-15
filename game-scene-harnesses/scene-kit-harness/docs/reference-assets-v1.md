# 按确认图重新生成素材：0.43.0

本入口连接已接受的reference-led target v2与独立素材生图，复用现有单次授权、
预留/提交、原PNG接收和未知终态。它不需要CPU分割先通过，不调用分割模型，
不使用旧固定地图模板组装新目标。当前提供来源候选和参考帧对照，完整可编辑
资产包、材质扩展及正式还原验收仍未完成。

```text
npm run reference -- asset-preview --root PROJECT --options FILE --out NEW_REVIEW
npm run reference -- verify-asset-preview --root PROJECT --options FILE --out REVIEW
npm run reference -- asset-plan --root PROJECT --options FILE
npm run reference -- asset-inspect --root PROJECT --batch DIGEST
npm run reference -- asset-authorize --root PROJECT --batch DIGEST --decision FILE
npm run reference -- asset-run --root PROJECT --batch DIGEST --adapter-module FILE
npm run reference -- asset-proof --root PROJECT --batch DIGEST --out NEW_PROOF
npm run reference -- verify-asset-proof --root PROJECT --batch DIGEST --out PROOF
```

./reference-assets公开对应的build/verifyReferenceAssetProposal、freeze/inspect/
authorize/runReferenceAssetProject和build/verifyReferenceAssetProof。生成也可通过
现有./generation的外部交换API执行，由宿主在预留并提交后调用内置图片工具。
CLI执行需要显式宿主适配器，不能从预检、预览、冻结或复检隐式生成。

## 输入与冻结

OPTIONS为batchId与assets；每项含planId、parents、instanceId、subjectBrief（content/
exclusions）和intent。主体必须存在于已接受实测目标；完整帧、原PNG、样式和能力
由当前已接受工作流取得，不能使用文件路径替换来源、借旧图接受或改写target。
允许选择实际实例的子集，不强制固定十一角色。新能力以单独v21计划保存，不改
写v11—v20的请求、旧图、授权或审阅。

每项固定三张输入：准确完整参考、由其原像素产生的主体上下文局部、粗位置图。
局部保留邻层，是上下文而不是抠层结果。位置图来自已审粗包络，不认证Alpha或
精确轮廓。宿主必须声明至少三图输入和透明能力；不提供硬几何锁定的虚假参数。

存储框在基准参考窗四边各外扩八分之一，原参考窗不缩放地放入其中。例如
1024×576参考窗对应1280×720存储框，窗原点为128,72。模型请求保持窗内原有
位置、尺度、明暗与主体轮廓，排除邻层；框外延续为新推定。请求与QA的原生
最小尺寸不低于存储框，最大边4096，画幅误差最多2%，不承诺模型必定满足。

## 执行和接收

批次只授权列明计划，每项最多一次。授权绑定准确批次摘要；参考接受不授权
素材计算。先持久预留，再提交，再调用已选图片适配器；失败/未知或技术不通过
停止后续，未知不重发，修订保持原终态且需新的准确授权。批次规划在全部记录
校验通过后追加，重复planId/batchId不会留下部分计划事件。

原PNG逐字节保存。技术检查复用原生环境PNG/Alpha策略并检查画幅：非空、真正
透明、可见比例、边距和尺寸。隐藏RGB仅诊断，不清除。通过只能进入未审来源，
不自动证明位置、轮廓、框外补全或美术。v21要求四边透明；实体裁切会拒收，
不能用透明补框伪装成完整主体。额外准备不由计算批准自动授予。

## 参考帧对照

整张原生输出按固定存储框等比缩小，再截取原参考窗，不按Alpha边界重新居中、
放大或加tint。原生PNG和框外推定区保留。对照左侧是确认图，右侧仅为本批实际
生成且技术通过的素材；其余实例保持透明，没有原图底图回填。原始计划、实际
floor尺寸、offset和映射进入报告。技术失败可另做明确标注的诊断，不能进入
正式候选proof或静默弱化验收。

首轮雪山左前景已真实生成，但未遵守位置/留边，四边完整源策略拒收；右前景
按本批停止规则尚未派发。该实测不证明软位置图有效。后续的原画布编辑式单层
方案已在0.41.0以独立v22实现，见下节；没有因此追认旧图通过。

## 原画布编辑式可见单层（v22）

OPTIONS显式增加mode="original-canvas-layer-edit-v1"，每项增加clippedEdges数组。
其余资产选项、CLI命令与单次授权流程复用上述入口。不指定mode继续编译v21，
保留历史计划、提示、QA和审阅包的字节重放；v22使用新批次v2与全新计算授权。

输入1为准确整图，角色是编辑目标；输入2为原像素局部，仅定位实例，不是输出
画框。不再传位置图、不加外扩存储框。请求保持整图画布比例、主体原位、尺度、
可见轮廓、附着细节与明暗，其他图层及空隙透明。本入口目前只生成透明主体，
天空仍使用其独立来源模式。

clippedEdges只能声明实测包络触及的原画框边，且实例须标注frame-clipped；
例如左前景声明left/bottom。该边可以保留原图已有裁切，其他边仍要求2px透明。
PNG/尺寸/透明和可见面积、画幅均检查；隐藏RGB只诊断。新规则仅绑定新请求，
不会重检旧图使其通过，不自动补框、改Alpha或恢复框外几何。

这一步的产物是可见图层，不是完整独立模块。遮挡和框外仍未知；外扩补全与可
复用模块化需另行规划。原位、尺度、轮廓和美术仍是软约束，技术通过不认证
忠实还原。proof只将整张输出画布等比映射到原参考框，原生PNG逐字节保留；
其他层透明，无居中修正、Alpha边界缩放、tint或原图回填。新模式已完成替身测试。
首张真实左前景经准确授权生成一次，技术通过，但主体相对原粗范围约放大2倍，
未保持原位与尺度。用户已拒收还原用途，程序记录视觉拒收；没有自动重试或
摆放修正。这次试验不证明该软引导模式能稳定还原，不能扩大为完成资产包的声明。

## 单整图输入编辑对照（v23）

显式mode="original-canvas-single-input-edit-v1"编译独立v23计划、请求与批次v3。
只将已接受整图传给图片适配器；原像素局部改为context-review-only.png，仅用于
人类审阅。编译器移除INPUT 2角色段落，其余提示段、目标/输出与边距QA保持。
主体、样式、原有裁边和原图绑定不变；能力声明至少支持1张输入即可。

该入口用于定位局部图片是否影响构图，不宣称解决原位控制。v21/v22原计划、
请求、QA和提案仍可按原字节重放。v23可基于已终止的v22/v23同实例计划修订，
仍需新的准确批次单次授权；旧未用右图授权不能转用。未知/技术失败停止，无
自动重试、图像摆放修正或CPU分割。对照仍按整张输出画布映射，未生成层透明，
技术通过与人类还原接受分开。首张经新准确授权的真实对照已执行1次，技术通过，
但将明确排除的主地形与前景合在一起，仍未得到纯前景层。用户已拒收其用途，
无重试或自动摆放修正。移除局部图不足以证明解决了位置/归属问题。

## 同画幅区域指示设计与v24输入合同

内部离线渲染器reference-region-guide.mjs可以把手工正负示例绘在准确原图副本上，
导出同画幅标注PNG与摘要绑定的设计审阅包。绿色粗范围/示例点定位目标，红区
和表沿线标出排除的相邻地形示例；粗范围不成为mask或每像素归属，不生成资产。
原PNG保持，双列对照仅供人审阅，不作为工具输入。

v1提案包中的未接入字段是设计阶段的冻结快照，原字节保留。0.43.0另以v24计划/
请求、batch v4接入运行时，不回写原包。SDK先importRegionGuideControls导入已
重放的允许文件，再reviewRegionGuideControls记录对准确packet的用户决定；导入
和设计接受不授权计算。基线须是同目标、技术通过并被用户视觉拒收的v23素材。

OPTIONS显式mode="original-canvas-region-guided-edit-v1"，每项在原位编辑选项上
增加regionControlsSha256，parents绑定拒收基线或同控制的已终止v24计划。编译器
要求已接受控制设计，目标/主体/intent/裁边与设计基线相同；原图、标注和提示都
按已审包重放，不能换成双列总览或局部。能力须支持2张图和透明输出。新计划仍
需准确批次的单次计算确认，先预留/提交后执行；未知/失败停止，不重试。

既有asset-preview/plan/inspect/authorize/run/proof入口复用。readRegionGuideImage
只读取注册控制的标注字节，不能按请求路径选图；控制导入/审阅目前提供generation
SDK入口。v24沿用v22原生PNG/透明/尺寸/声明裁边QA及固定画幅对照，不放宽旧QA，
不自动修图、摆放修正或接受美术。首张经独立授权的真实图已执行一次，技术通过，
但仍保留主地形与台阶，未达到纯前景还原目标，用户用途决定待审。当前软引导
没有证明可靠分层，也不构成硬mask、Alpha或原位锁定。完整包与还原验收未完成。

## 能力审计后的设计方向（草案，未实现）

[官方遮罩说明](https://developers.openai.com/api/docs/guides/image-generation#edit-an-image-using-a-mask)
仍将API mask归为模型引导，不承诺精确轮廓；换API不能自行满足硬几何合同。
当前独立mask通道未接入，图片模型身份也未从会话结果建立。

下一草案让生图负责新外观，让独立审阅的连续Alpha、局部画布/原点与坐标变换
约束派生结果。参考图先接受，素材仍由模型绘制，不用原参考像素冒充重生，
不要求CPU分割模型。精细轮廓和派生规则须另审，粗包络不作mask；裁剪不能让
错误内容通过美术验收。此设计未接受/实现，当前v21—v24合同和旧图状态不变。
