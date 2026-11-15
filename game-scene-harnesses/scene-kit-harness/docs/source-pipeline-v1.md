# 通用纯横版生成主链：0.28.0

本地生成 CLI 已实现从输入草案到可编辑候选资产包的整条调度。实际生图通过显式
选择的可选宿主适配器执行，核心保持提供商中立。本版固定一屏 1024×576、64 像素
网格；输入、主题、画风可换，默认地图使用版本化结构模板。它不会从参考图推断
精确可玩几何，也不声称生成结果自动获得美术或物理验收。

## 单命令使用

从本 Harness 目录运行，输出目录必须不存在，父目录已存在：

```powershell
npm run generate -- --brief examples/pipeline/forest-ruins.json --out ../../work/my-scene-pipeline
```

命令会依次完成：草案导入 → 显示结构/画风/分层要求 → 冻结参考图计划 → 确认一次参考计算
→ 调用图片适配器 → 保存原 PNG/技术检查 → 原图审阅 → 冻结全部来源 → 确认一次
完整来源批次 → 串行生成/技术接收 → 派生全部模块 → 组装默认地图 → 校验/导出
→ 在自动分配的空闲本机端口启动新场景编辑器。终端会显示地址；Ctrl+C 停止该预览，
关闭前保存地图。旧工作台不重启、不替换。

交互在真实终端执行；用户查看草案后输入 accept，查看完整冻结计划后输入 approve，
查看准确参考 PNG 后输入 accept/reject。每个决定绑定显示的准确摘要；不提供 --yes
或自动接受。拒绝或其他输入停止，不新增计算。恢复未完成项目：

```powershell
npm run generate -- --root ../../work/my-scene-pipeline
```

暂停前写出的冻结快照和原图在恢复时必须逐字节相同。已完成交付恢复时只校验原
交付，不重生成或覆盖。执行中断留下 reserved/submitted 时需显式核对结果，禁止
重新派发；确定无法取得结果时用 stop-unknown 记录终态。失败后的新计划仍须重新
规划与计算确认，本版不自动替换失败来源。显式修订入口为：

```powershell
npm run pipeline -- revise-reference --root ../../work/my-scene-pipeline --options reference-revision.json
npm run pipeline -- revise-sources --root ../../work/my-scene-pipeline --options source-revision.json
```

参考修订填写 planId/intent。来源修订填写 batchId 与 replacements，后者每项包含
slot/planId/intent；例如仅替换已失败的 sky。新批次绑定准确父计划，保留已完成来源，
其余未派发旧计划保留原单次授权；新计划仍须批准新批次后才执行，原未知尝试不重发。

## 输入与风格

[森林遗迹输入样例](../examples/pipeline/forest-ruins.json)可直接复制修改。description
非空或 inputs 至少提供一个；inputs 最多包含一张 scene-reference 和一张 layout-sketch。
每项形如 `{"role":"layout-sketch","path":"用户选择的本地 PNG 路径"}`。输入 PNG
可不透明；原文件保存在内容寻址工作流中。图片各自角色进入提示，不把手绘中的文字
作为操作指令，不把参考图坐标等同于地图坐标。

预设为 clean-handpaint、pixel-art、flat-color，属于画风规则，未伪装成已有样图。
自定义风格使用 mode=custom、preset=null，填写 name/rules，anchorPath 必须指定一张
场景风格锚点 PNG。宿主路径仅属于本地导入配置，不进入公开计划、提示或交付证据。

## 参考图阶段的完整分层

0.22.0 新建项目使用 project v2、参考计划 v10、来源计划 v11。旧 project v1 与
v9/v8 计划仍按原编译器重放，不补写提示、不迁移授权、不覆盖原图或审阅。

0.23.0 的新 project v2 默认冻结 v12 来源计划；参考仍为 v10。v11 原请求保留，
不会从已授权计划中悄悄删除上下文或改写提示。分步 API 可以显式选择
`freezeSceneSourceBatch(..., { ..., sourceCompiler: 'isolated-role-v1' })`；省略时保留
原兼容行为。批次结构不变，各项的版本、完整请求和准确摘要决定执行内容。

同一份版本化分层定义贯穿参考提示、来源角色绑定和默认地图的绘制层序：
sky → far-backdrop → distant-scenery → far-structure → valley-detail → middle-scenery
→ structure-a → structure-b → terrain → platform → foreground。这些是绘制角色，
不是十一等分的景深；地面与悬浮平台处于同一玩法空间，谷底环境按当前模板位于
可玩地形后面。material 是 terrain 的材料来源，不是另一个绘制层。

每层明确内容、位置、对比、尺度与遮挡边界。参考图要求所有层均有可辨认的可见
形态，仍输出一张完整自然构图，不画标注、分格或拆解展示图。前景应位于可玩地形
之前，不能只是长在地表的小装饰；实心地形延伸至底边，谷地露出对应环境，禁止
无设计用途的灰色封底或空条。保持适度遮挡和清晰轮廓，不遮住关键玩法边缘。

输入可选 layerContents 对象，必须完整填写上述十一项且内容非空；不允许漏项、
额外层或宿主路径。省略时使用按审核主题解析的通用角色描述，不固定森林元素。
[雪山古堡输入样例](../examples/pipeline/snow-castle.json)展示了每一层的具体主题内容。
程序输出 layers-draft.json，其内容与固定层序/构图规则共同进入准确参考计划摘要。
分层要求在设计停点展示，并在准确参考计划确认时冻结；不会自动接受任何实际图片。

原图审阅同时展示 reference-layer-checklist 文件，逐项检查可见性、遮挡、前景、
底部和一致性。清单始终标注 not-assessed，不伪装成自动图层识别或人工审阅结果。
PNG/Alpha 技术检查不能证明层次齐全。

### 来源提示的作用范围

v12 保留准确原图和完整分层绑定作为计划证据，但只向图片请求传入当前角色的
输出要求。整图的“画齐十一层”、完整构图、地形封底和相邻景层内容不会进入单层
任务。连续材料源更进一步排除场景布局描述，仅以参考图确定材质外观；明确要求
横贯画布的表沿与连续岩土主体，不画天空、谷地、台阶或独立悬浮台。其他来源
保留目标层描述、主题和画风，排除邻层、遮挡者与照片式虚化。

这些是提示合同与人工审阅检查项，不是自动语义检测。PNG 合格仍可能画错用途；
发现错误必须保留原图并取得准确视觉决定，不能把技术通过代写成材质来源接受。

只读 `previewScopedSceneSources` 可在接受参考图后输出十一项提案，不写计划事件，
不可授权或派发。`sourceParents` 可显式列出 slot/planSha256，将新 v12 计划绑定
同角色的已失败/未知/拒绝终态父计划；不允许借此覆盖已授权但未执行的父计划。
同一批次里未改动的旧计划只能按原请求执行。若给未执行来源换了新提示，应冻结
新计划并取得新批次授权，不能借用旧授权。

后续每张来源绑定接受原图的 plan/raw 摘要，以及同一分层设计摘要和准确角色。
只重新生成目标层，排除相邻层与遮挡物；material 专门重建 terrain 的表沿与岩土
实体。完整复原被遮挡部分不作承诺；这仍是按参考重新生成资产，不是确定性抠层。
候选包保留分层定义、逐层来源绑定和原始审图清单，最终美术/几何仍需独立验收。

`previewLayeredSceneReference` 提供零计算只读提案，既不写计划事件，也不可直接
授权或派发。只有显式冻结后的计划能取得单次计算授权。旧图若仍待审阅，不允许
以修订父计划绕过原图决定；旧失败/拒绝图升级时仍保留原计划与原 PNG。

## 完整资产清单与派生

参考图单独生成一次、审阅后冻结 11 张来源：

| 来源 | 交付用途 |
| --- | --- |
| material | 地形表沿与实体材料；程序派生 47 邻接 × 32 相位，共 1504 模块及曲线材质 |
| sky | 不透明天空 |
| far-backdrop / distant-scenery | 远处地貌与远景轮廓 |
| far-structure / middle-scenery | 远处地标与中景组 |
| structure-a / structure-b | 两种近景建筑或自然结构 |
| foreground | 低矮前景框景 |
| platform | 三格完整平台外观，附着到原逻辑格子 |
| valley-detail | 静态谷底环境细节 |

角色提示从审核过的主题和风格取得外观约束，没有固定森林配色。总计 1514 模块来自
11 张来源，不是 1514 次模型调用；参考图另计一次。相位按世界坐标选择，曲线和格子
共享材质。默认地图包含谷地曲线、格子连接和固定三格平台组合，并附全 47 形态检查图。

原生 PNG 允许有界 caBX，Alpha=0 的隐藏 RGB 只诊断。原 PNG 不改；透明来源必须保留
完整轮廓、实际空背景和边距。派生只执行已冻结的 Alpha 加权缩小、空边裁取、补齐目标
画布和平台表沿测量；材料执行现有版本化相位派生。不会抠白底、默认补框、补画或阈值
删除微弱边缘。技术拒收保留原图与 QA，整批停止；不靠重试或占位图凑齐清单。

所有远景为有限景片，无循环接缝承诺。固定一屏结构不是 AI 自由布局能力。平台仍为
三格，碰撞为逻辑格子建议；角色运动、四屏覆盖、任意平台宽度和最终美术另验。

## 适配器与计算边界

默认可选适配器位于 adapters/codex.mjs，显式复用仓库 UI Reference 已有的本地 Codex
图片传输：无图不透明参考用原生工具传输，有图不透明/透明来源用准确参数 relay。
选择发生在派发前，失败后没有传输切换或重试。需要本机 Codex CLI、ChatGPT 登录、
图片工具、代码模式与已支持的 hook 配置。源码开发检出需要同时保留兄弟 Harness，
不能单独复制这个适配器文件。检查入口：

```powershell
npm run pipeline -- doctor --root ../../work/my-scene-pipeline --adapter codex
```

doctor 只检查环境，不调用生图；失败明确报告适配器配置缺失，不把它记作图片质量问题。
核心也支持宿主传入 `{preflight, generate}` 或显式 `--adapter-module`；模块导出
createAdapter({workspace})。generate 接收冻结 request、plan/attempt/request 摘要及
逐项验证的输入 bytes，返回唯一原 PNG 字节。宿主必须执行一次请求，不自行重试。

程序在派发前持久化单次预留和提交记录。超时、异常、结果不唯一或失去回执均保守
记为 indeterminate；该计划永不重发。技术失败为 rejected-technical，原图仍可读取。
批次确认只授权该准确批次的每项各一次；参考图接受不授权来源计算。

Studio HTTP 宿主没有新增生成或任意执行接口；地图编辑与图片计算仍是两个独立入口。

## 图片已完成但外层会话中断的零生图回收

0.24.0 提供单独的显式回收路径，既不重发请求，也不把原 indeterminate 改成成功。
适配器 inspectSceneCodexRecovery 只读核对原冻结请求/输入、唯一原生输出、准确
relay 程序及前后工具门，生成不含宿主路径、会话或私有尝试字段的
ai_scene_completed_image_handoff_v1。缺少完成证据、输入变化或多张结果均拒绝。

核心 proposeSourceRecovery 独立验证该宿主证据、PNG 与原未知计划，并输出准确
零生图提案；它不写工作流。宿主证据由确定性适配器提供，与 generate 返回原始
字节一样属于显式宿主信任边界；Agent 不手写或修复其指纹。经用户对提案摘要明确
接受后，registerRecoveredSource 才新增 ai_scene_source_recovery_v1 独立记录。
原尝试保持未知，新记录 pending-visual-review，原图不编辑，无法用于授权计算。

adoptRecoveredSource 产生 ai_scene_source_batch_recovery_v1，只替换原批次中对应的
未知来源引用，newImageRequests=0；保留其他已完成图、未派发计划及其授权。新用户
决定若同时要求继续剩余原请求，可执行 runScenePipeline，它跳过已接收的材料和
回收图，仅调用尚未派发的原授权。回收记录不能当作新生成计划重试，重复回收同一
未知来源被拒绝。来源美术、模块几何与整包验收仍然独立。

该流程没有提供任意路径或执行的 HTTP 接口，也没有自动接受未知产物。回收前
必须保留并展示原 PNG、准确提案和技术核验；实际未产图的连接失败不能回收。

## 分步与宿主 API

### 批准后的限定透明外框规则（0.25.0）

`proposeNativeBorderPolicy(root, batchSha256, sourcePlanSha256s)` 只读冻结准确批次的
透明来源清单、固定规则与现有失败样例。样例必须仅 ENVIRONMENT_ALPHA_MARGIN
失败，外两像素带最高 Alpha=1/255，四边补两像素后仍符合原尺寸上限并通过 QA。
提案保留原/新 PNG 和 RGBA 指纹，不修改来源，不授权计算。

用户明确接受准确提案后，`approveNativeBorderPolicy(root, proposal, receipt)` 记录
一次批准。`prepareNativeBorderSource(root, {preparationId, approvalSha256,
sourcePlanSha256})` 仅对该清单内、后来实际符合相同门的失败执行准备：完整原 RGBA
复制到偏移 (2,2)，外框 RGBA 为零；不调整任何原像素或重生。每个来源只能准备一次。
原 PNG 与 rejected-technical 保留；新 ai_scene_native_border_preparation_v1 记录
maximumCalls=0、pending-visual-review，不能充当新计算请求。

`adoptPreparedSource(root, parentBatchSha256, preparationSha256, batchId)` 只替换
该来源的批次引用，生成 ai_scene_source_batch_preparation_v1，newImageRequests=0；
其他未用授权保留。后续是否继续须符合用户的批次指令。Alpha>1/255、其他技术失败、
越出清单或尺寸上限均停止，不能自动扩阈值。当前会话交换示例将此准确批准用于
远山/古堡；中景 Alpha=2/255 被拒绝，后五项未派发。语义串层和整包美术仍须独立审阅。

### 明确主体的单来源修订（0.26.0）

reviseSceneSourceBatch 的 replacement 可显式增加 sourceCompiler='explicit-role-v1'
与 subjectBrief={content, exclusions}，生成 ai_scene_generation_plan_v13。content
是最多 2000 字符的具体主体描述，exclusions 为 1—24 个非空、唯一的排除项，每项
最多 200 字符；拒绝操作 URL/宿主路径。v13 只支持已有透明环境来源的终态修订，
父计划须 v11/v12/v13、同角色同参考图、failed/indeterminate/技术或视觉拒收。

主体内容和绑定层的具体内容以普通文本置于提示开头，移除整场景主题描述和 JSON
整图构图；参考图仅匹配指定主体的外观。要求四边至少 10% 空透明边距，仍使用
原生环境技术 QA。该边距是模型指令，不是已实现的自动占比验收或语义识别。
新计划绑定 subjectBrief、准确参考 PNG 与旧失败父计划，需新单次计算授权。
批次只替换该来源，其他已完成来源、零计算准备、未用授权和所有旧记录保留。

此编译器为显式修订入口，没有改变新项目默认 v12 路径。旧 v11/v12 提示不会重写。
旧补框政策按原计划摘要限定，不自动覆盖新的 v13 计划；如需准备须新的准确批准。
生成成功、技术通过与人工美术接受继续分开。

以下为既有 CLI 与宿主入口。

```powershell
npm run pipeline -- init --brief examples/pipeline/forest-ruins.json --out ../../work/my-scene-pipeline
npm run pipeline -- inspect --root ../../work/my-scene-pipeline
npm run pipeline -- plans --root ../../work/my-scene-pipeline
npm run pipeline -- --help
```

design/authorize/review 接收明确的用户决定 JSON，字段为 decisionId、decision、
targetSha256、notes；design 使用 spec/style 两个决定。计算 decision=approve-compute，
参考图或来源美术使用 accept/reject 并绑定 raw SHA。调用者负责取得真实人工决定；
程序不会根据技术通过伪造接受。review-set 可导出原图与准确摘要用于人工审阅。

`run` 只执行已授权阶段；参考图等待原图审阅，全部来源技术通过后进入 ready-to-assemble。
`deliver --out 新目录` 自动重放派生、严格加载 kit、导出并重开验证。所有步骤也在
`./pipeline` 包入口提供函数，已有离线交换 API 保持兼容。

## 交付与验证状态

delivery/ 包含 candidate/（原图、计划、QA、可选来源审阅、派生证据）、export/
（严格运行包）、scene-kit.zip 和 delivery.json。来源未获人工接受时允许输出明确
标注的候选包；任何缺失或技术失败均禁止输出完整包。productionKit=false、派生/
平台几何/整包美术 not-assessed 始终明确保留，不能把技术可携带当成生产验收。

测试仅使用合成 PNG、人工决定替身和适配器替身，覆盖完整链、换主题、输入角色、
单次批次确认、准确图像绑定、失败/未知终止、导出重开与无回退传输；不生成真实图片。


## 明确列出来源子集的补框提案（0.27.0）

proposeNativeBorderSubsetPolicy(root, batchSha256, sourcePlanSha256s) 只读产生 v2 提案，
scope='listed-sources-only'。清单必须是该批次透明来源的非空、去重、按批次顺序
排列的子集；每份选中来源仍须原生来源计划、有效设计、authorized 或技术拒收，
且至少一个实际失败样例符合仅边距问题/最大 Alpha=1/255/补后 QA 通过。
已接收或已准备的其他来源不自动进入这份批准。v1 的全透明来源清单规则保持原样。

v2 仍需 approveNativeBorderPolicy 对准确提案的新用户决定，然后才能独立准备和
采用。已有政策只能覆盖原列出的摘要，不能用于修订后的新计划；补框操作、阈值、
逐像素保留、终态、美术门与零新生图边界均未改变。没有政策批准就不能准备来源。


## 生成前审阅条件准备规则（0.28.0）

proposeNativeBorderFuturePolicy(root, {batchSha256, sourcePlanSha256s,
examplePreparationSha256}) 只读冻结 v3 提案。目标必须为该准确批次中未预留的
planned/authorized 透明环境来源，清单非空、去重、按批次顺序；例证必须是同一
准确参考图下已获用户批准并实际登记的 scene-native-border 准备。程序重放原样例
RGBA 复制与新 PNG 指纹；未准备例证、不同参考、旧设计或已派发目标均拒绝。

提案仅将固定规则预先绑定到列出的计划摘要，不继承例证来源的批准，不授权图片
计算，不接受未来美术。用户可一次审阅准确生成批次及该准确准备提案，核心分别
记录 compute 与 preparation 两份绑定决定，之后才预留派发。

未来实际来源仍先保存原 PNG 并执行原严格 QA。仅透明边距单项失败且外两像素
最高 Alpha=1/255 时，才可按已批准规则新增独立准备；Alpha>1、实体裁切、其他
失败或未知均停止。全部原 RGBA/原拒收保留，准备来源仍待美术审阅。未知终态
不能走该准备路径，修订新计划也不在旧批准内。v1/v2 行为和旧摘要保持原样。

## 显式构图修订（0.29.0）

`./pipeline` 提供 `deliverSceneComposition(projectRoot, plan, freshOutputRoot)` 和
`verifySceneCompositionDelivery(projectRoot, outputRoot)`。这是已齐套来源候选的独立
确定性后续步骤，不修改原批次、原候选、原 PNG 或 Studio 的内存地图，不写生成事件。

plan 为带 canonical SHA-256 的 `ai_scene_source_composition_plan_v1`，正文精确包含：
`studyId`、`sourceBatchSha256`、`baseCandidateId`、`baseBundleSha256`、`moduleStyles`、
`terrainTint`、`map`（以及 `format`）。先从工作流重建原来源候选，匹配准确批次、
候选 ID 和包摘要，再验证新数据。`map` 是完整 v3 author document，kitRef 必须为
`{kitId: studyId, revision: 'composition-study-v1'}`；范围、默认镜头、规则引用与原包一致。
地形、曲线接头、组合和环境位置通过同一语义门校验，不允许越界锚点或非法邻接。

`moduleStyles` 是去重的 `{assetId, renderStyle}` 数组，只能指向既有 environment
模块，复用 kit 的有理数等比缩放、RGB tint 和 opacity 合同。固定宽度平台不可改变
测量绑定的缩放比例；`terrainTint` 为 null（保留）或合法 RGB 值。所有 PNG 字节均
与重建来源候选比较；计划、原包证明和原 readiness 进入独立证据文件。

新输出包含候选、完整运行导出、ZIP、composition-plan.json、delivery.json；复核时
重建构图证明、严格加载、重开运行导出，并比较 ZIP 字节与摘要。来源美术决定保持
原状，平台几何、整包美术仍 not-assessed、productionKit=false、generationCalls=0。
它接受显式布局数据，不承诺从参考图自动提取比例，也不修复 PNG 内部的串层内容。

## 雪沿派生与来源替换候选（0.30.0）

构图计划 v2 额外要求 `terrainSurface: {profileSha256, sourceSha256}`，目前只支持
`sideview-snow-full-upper-eighth-depth16-v1`。必须绑定同一批次的材料 PNG 和准确
配置摘要；原 v1 计划与默认 8px 派生输出不变。新派生重新取原图完整上部八分之一，
保留原宏岩壁场、47×32 相位、Alpha 占用和碰撞建议，只生成独立雪沿与地形拼片。
侧边两像素明暗仍保留；内角/底边额外阴影不进入这份雪沿配置，保证共同材质边界。
全部 47 邻接、直段、台阶、断崖、长条、孔洞和悬浮拼法仍须零通道差、至少 48/64
可比边界像素；没有降低旧门槛。边界装饰差异仍待人工审阅。

kit v4 另接受 `ai_scene_continuous_terrain_appearance_v3`，仅允许准确雪沿配置摘要
与 505×16 cap 场配对；v2 仍必须绑定原摘要和 505×8 cap 场。验证器拒绝格式、摘要
和尺寸的混搭。曲线及混合链使用 16 单位内沿，雪沿 UV 绑定世界 X/512；表面、
逻辑占用、碰撞轮廓不变。较宽内沿仍须通过折叠/形状边界检查，编辑失败原子撤销。
导出包含新材质与曲线几何，重开复算，不依赖 Studio 的外观切换状态。

`reviseSceneSourceBatch` 的显式 `sourceCompiler: 'alternative-role-v1'` 生成 v14
请求。它用于已经技术通过、pending-visual-review 或 accepted 的来源候选，可指向
原生来源或经准确批准的来源回收/补框记录。它不将旧图改为拒收、取消接受或复用
旧计算授权；新计划记录 `alternativeOfPlanSha256`，旧图及审阅保持原状。v13 仍只
接受终态前驱，旧冻结提示和摘要不变。

v14 将具体主体和排除内容前置、去掉整图主题、要求四边至少 15% 透明空白，复用
同一准确参考和风格。新批次只替换列出的来源，其他条目原样保留；新计划须重新
授权后单次预留。未知仍终态，不自动重发。限定补框/回收也必须遵循原独立决定，
不因候选身份而扩大 Alpha 阈值。程序没有新增语义识别，是否真的没有山体仍需看图。
