# 整体观感优先的参考图主链

入口始于0.46.0，当前源码0.89.0。新项目首批来源使用[单层职责v4](layer-source-v4.md)，
历史项目、旧计划与原始图片保留。

0.84.0新增显式[有限背景景带](background-band-v1.md)：远山/林谷按声明镜头域规划
侧下延续，原生frame单独量测后派生；不迁移旧单体默认，也不把透明范围视作绘画
连续性或最终美术证明。

0.83.0为完整包边提供显式[自适应底角覆盖v2](terrain-bottom-adaptive-v2.md)，修正
短跨度在淡出前硬裁、底角竖臂突然出现及顶部覆盖物被下缘提前切回的问题。它改变
受支持的渲染覆盖和绘制顺序，不重新生成或改写来源，不替代真实样本美术验收。

0.82.0另为[原生地形包边的低Alpha留白失败](terrain-edge-canvas-gutter-v1.md)提供独立
2px零调用准备；它不扩大coherent v27旧补框资格。原生消费frame和坐标不因追加画布
改变，原失败与PNG保持，准确预览采用与最终美术仍分开。

0.81.0提供[单项职责决定的承托提示](scope-owned-grounding-v1.md)，显式新scope v4/
groundingProfile与isolated-layer-v4共存。通用接地提示只引用brief允许的自身基底及
接点，不再无条件建议根脚或基座。新提示身份仍须新准确确认，旧默认字节保持。

0.79.0增加[参考决定的自然覆盖物职责](reference-defined-natural-cover-v1.md)。它在
基础来源齐套后的独立完整包边批次中显式选择v37，不将自然家族默认成叶土/草苔；
首批v4来源、参考流程与历史请求保持。设计、计算、实际原图及最终美术接受仍分开。

0.74.0通过[一次完整校验的只读快照](coherent-read-view-v1.md)减少历史批次增长后重复
重放PNG的开销；未缓存状态或放宽写入校验，既有快照/计算包输出保持原字节。

0.73.0可为选定前景显式绑定[固定深阴影技术输入](source-visual-guide-v1.md)，用两张
输入分别说明材质/笔触与大面阴影/完整接口。旧scope和默认单输入请求保持原字节。

0.72.0可为[未提交的v4来源另冻新计划](unsubmitted-source-revision-v1.md)，旧计划和授权
不改写，新提示不得继承旧授权；已预留请求不能伪装为未提交后修订。

0.70.0可显式选择[已审软构图指导](soft-composition-v3.md)，由project v7/参考v32绑定
第三张构图图，前两张仍是技术例，后续图片才是风格。图只指导相对位置与遮挡，不锁
作者像素几何。接受构图不会接受生成参考或计算，旧v28/v31不隐式升级。

0.69.0可显式选择[独立组件指导v2](reference-guidance-v2.md)，创建project v6/参考v31。
缺省v4/v5与旧v28保持。该选择改变技术输入和参考提示，仍须准确单次确认与实际原图审阅。

0.68.0增加显式[城市人工材质分支](engineered-city-v1.md)：project v5、视觉规范v2与
城市侧边v30。它改变来源职责和制造接缝提示，不自动启用自然草沿或岩纹循环，
也不代表城市新样本已经完成真实生图、美术验收或Studio对照。

这是新项目的默认工程入口。目标是主题、画风、主要层次、可玩表沿和可编辑场景
协调一致；不要求枝条、雪尖或材质分区逐像素复刻。旧 v21—v26 试验、已冻结计划、
拒收和未定状态保留，不因切换目标而通过。

## 内容与布局

用户文字决定场景内容。上传图、手绘图和自定义锚点提供风格；完整参考图仍按
侧视、分层、画框完整、地形清楚、前景清楚、风格一致、可拆性七项规范生成。
两张确定性的中性样块提示正立面投影和前景清晰度；样块不是雪地、石材或关卡
布局。它们属于软引导，不保证新图一定满足要求。

`requirements.layers` 和 `subjects` 是本次设计数据，允许更换主题、数量和层数。
通用角色为 `sky/backdrop/landmark/scenery/valley/ground/platform/foreground`，
分别用于规划来源与组装；这组角色不是固定场景模板。

当前约束：一个最底层天空主体、至少一个主地形主体，主地形使用同一地形层；
只有 ground/platform 属于地形层。沿用参考合同的最多24个实际主体与48条表沿。
不是每个角色都必须出现。平台可省略；不支持的角色在初始化时拒绝。

生成前不锁关卡像素坐标。准确参考 PNG 技术接收后，由 Agent 或显式选择的宿主
分析器输出粗包络、层次、锚点、可见表沿和七项观察。它们是类型化数据，不是
Alpha 分割、完整几何或可执行代码。用户接受准确图片和标注 packet 后冻结目标。

## 来源、派生与验收

一个连续地形材料源供全部主地形使用。其他已确认的实际主体各规划一个来源，
因此来源数是 `1 + 非ground实例数`，并非固定11张。每项只传入同一张准确参考图，
在自己的画布上重绘完整主体，补全不可见部分属于设计推断。程序用确认包络定位、
等比例容纳，避免要求生图模型同时硬锁画幅坐标与细枝像素。

v2及后续项目在设计时保存单层内容、排除项及父级职责；首批默认用v4编译，坐标与
粗包络只留在回拼元数据中，完整参考只供材质/风格/光照。可选sourceScopes为每个
主体提供单体正向说明；未提供时继承subject.content并标注来源，不假装自动语义
改写了“两侧”等场景措辞。具体字段、角色边界和零生图source-review入口见
[单层来源v4](layer-source-v4.md)。

新 CLI 项目还要求 ground 的 sourceScopes 明确
[`terrainIntent` v2](terrain-completion-v2.md)，并在素材校准时绑定 `terrainRendering`。
完整画刷须提前登记七个边角职责，交付再核验相应原生来源和拼接控制；有限材质
候选另行声明。它把参考判断带入来源摘要及交付，缺失或冲突时阻断；
已有无该策略的项目仍可按原合同重放。

0.59.0新project v3另绑定[共享视觉规范](visual-coherence-v1.md)，每个来源使用同一份
参考相对约束及可选人工观察，禁止混批。新默认composition v3使用实际表沿曲线、
声明接地与同源32px过渡；下述格子吸附与旧8px派生继续适用于历史v1/v2交付。

0.59水车地表随后被用户拒收。0.60新project v4保留共享视觉规范，但改用
[显式参考量测](measured-surface-v1.md)：Agent准备地表/岩肩与宏观岩面观察，程序
固定统一倍率和来源区间，使用composition v4及appearance v5。缺测量不悄悄采用
32px策略。这个确定性校准不增加生图确认；旧项目、旧策略与拒收证据保持。

- 原生 PNG 字节保留。天空/材料不透明，其余透明；空图、伪透明、尺寸不符、
  主体真实触边等技术失败仍阻止交付。隐藏 RGB 只作为原生诊断。
- 原生边缘两像素的最高 Alpha≤1/255 是诊断项，不触发原图修复；更高 Alpha
  视为可能裁切而失败。派生图保留连续 Alpha，透明像素 RGB 归零，添加2px透明边。
- 素材裁取实际非零 Alpha 范围，再等比例缩小以适配包络，不放大来源 PNG。
  天空按视口生成不透明背景。显示画布放大与生成更大素材分开记录。
- 主地形按确认表沿吸附64px网格，连续材质派生47角色×32取样相位；模块数不是
  图片调用数。独立平台使用既有皮肤/对齐约束；吸附后若邻接地面，最多搜索两格
  曼哈顿距离内的独立位置，记录偏移；无可用位置则停止。
- 远景、地标、中景、谷底、前景按层序与视差组装。地标提示包含承托岩基，避免
  悬空；干谷不默认生成水。默认图、组合预设、kit、可重开导出和 ZIP 一并生成。

技术通过允许制作待验收的整场景候选，不自动接受单项来源美术。最终对准确
`delivery.json` 单独记录整图决定；不反写任何旧来源或严格试验的美术结论。

### 验收口径与允许偏差

冻结用于绑定准确需求、输入、版本和计算范围。美术观察按用户接受的目标执行，
不把提示中的每个形容词自动升级为独立否决项。以整体观感为目标的横版场景，
可明确允许背景建筑的绘画透视、少量不改变玩法平面的局部顶面，以及轮廓、
位置和遮挡差异。仍须检查玩法边沿清楚、单层职责、尺度接地和实际Studio回拼。
具体允许范围写入本次需求与审阅说明；参考可用于规划不证明尚未生成的来源纯度。

用户在生成后调整口径时，保留旧计划、原图、技术结果及旧美术观察。可在独立
新项目中使用修订需求，通过零计算candidate入口导入同一原PNG，再重新绑定
粗布局和准确审阅packet；不得原地改写已封印spec或将旧fail改成历史通过。
用户接受新的准确图/布局后才冻结来源批次，来源计算仍须准确新批次确认。

这种美术口径调整不放宽原生Alpha、校验和、路径安全、单次提交或未知终态规则。

参考取景可裁切而来源要求完整时，默认observed-envelope contain会将完整单体缩进
局部可见包络，不能直接当作最终尺寸。须按实际来源的可见特征与接触点量测，使用
明确composition transforms；v2密度采样按最终displayScale直接取原生crop，避免
先缩小派生再放大。未见基底/承托仍是设计推断，最终接地与尺度需实际Studio检查。

边缘技术问题应记录实际Alpha与位置，区分低Alpha尾迹和实体轮廓截断；明确的
确定性准备需要自己的版本、精确原图/预览批准与可重放证据，不能临时改PNG后
再次receive，也不能将画布补框宣称为恢复缺失轮廓。

0.58.0提供[显式低Alpha画布补框](coherent-border-v1.md)：仅对指定资格的已技术拒收
透明来源，按准确预览决定追加2px零RGBA外框，完整保留原像素与原失败。准备来源
为零调用记录，与原生生成分列；未使用的原计划授权保持各一次。

0.71.0另提供[完整来源的12%画布留白准备](canvas-gutter-v1.md)：仅对技术通过的v27
透明来源，在接受准确预览后追加固定比例零RGBA外框；不复用2px资格，不修改原PNG、
任一原RGBA或参考美术决定。新零调用准备与其余未用授权分列，派生主体尺寸不变；
单层/完整性和最终美术仍独立检查。

0.80.0增加独立[低Alpha尾迹留白v2](canvas-gutter-v2.md)：显式选择后，仅对原QA唯一
轮廓边界失败、外两圈Alpha≤7且Alpha≥8主体四边仍有2px余量的v27透明来源生成
零调用准确补框预览。旧两种准备的资格与产物不变；全部原RGBA及原失败记录保留，
用户接受准确proposal后才采用，补框不恢复缺失轮廓。

本版交付是一张有限地图。没有认证无限长地图接缝、主题泛化成功率、角色物理、
目标游戏工程接入或生产发布。曲线编辑能力仍由既有 Studio/编译器承担；CLI 默认
预览渲染器只渲染新生成的网格默认图，遇到曲线或混合网格编辑图会拒绝冒充截图。

## CLI 与宿主接口

```sh
npm run coherent -- init --brief examples/coherent/desert-citadel.brief.json --out /local/fresh-project
npm run coherent -- inspect --root /local/fresh-project
```

初始化只准备草案，不接受设计、不冻结计算、不生成媒体。`design` 接收分别绑定
spec/style SHA 的人类决定后，`advance` 冻结 v28 参考计划；参考图及粗布局接受后，
再冻结动态 v27 来源批次。`compute-review` 导出全部准确提示、输入 PNG 和摘要。
`authorize` 接收准确目标摘要的一次性计算决定。未知或失败停止，`revise` 只准备
新计划，绝不自动重发。

显式修订失败前景时，`replacements` 可为该项增加选择值
`"intent":"complete-framing-v2"`。它只适用于有终态父计划的foreground：新提示
排除后方主地形墙/可玩长表沿，并要求四边至少12%透明空白和完整居中轮廓。
旧空intent计划逐字重放不变，新请求仍需新准确批次授权；技术标准没有放宽，
不修旧Alpha、不自动重试。这是软构图提示，不保证模型结果通过。

`"intent":"isolated-foreground-v3"`另要求`subjectBrief:{content,exclusions}`，
将单项素材的正向内容与整场景主体描述分开。它不把原实例包络、场景坐标或
两侧前景的共同描述传入提示，整图输入明确只供画风/材质/光照参考。新提示
要求独立近景装饰组，明确排除主崖壁与可玩连续平台，独立检查是否混层；不以
事后Alpha遮罩、颜色阈值或轮廓清理补成正确来源。旧计划和旧空intent默认规划
不变；历史v1项目与旧低级调用仍须显式选择。本段描述旧v3修订模式，新v2项目
已经默认使用v4，不需要先制造失败。

该模式也允许为已技术接收、处于待美术审阅/已接受状态的前景规划替代源，
保留前驱原图、QA和审阅状态。`revise`在`ready-to-deliver`下只开放这一明确
模式；其他角色与旧修订模式仍遵守原状态限制。不需要为了准备新方案而代替
用户把旧图标成拒收，新请求仍需准确批次的一次性计算授权。

这是提示与输入职责的改进，不是硬投影控制或自动语义识别；完整参考图仍可能
诱发内容照搬。原PNG需看图验收，技术透明通过不能证明分层正确。若混层，应
拒收该用途并走新计划/新授权重生，不能自动重试或把程序清理当作生成成功。

```sh
npm run coherent -- continue --root /local/fresh-project --adapter codex --planner-module /local/host-planner.mjs --capture true --browser-channel msedge --studio-port 4300
```

`continue` 交互推进设计、参考计算、参考分析与审阅、基础来源批次计算。地表标定、
谷地位置量测和完整画刷的七项包边使用各自的审阅入口。收到素材后，可以通过同一
`continue` 接续交付、校验以及可选的实际 Studio 截图和启动。基础阶段分别确认参考
和来源批次的准确计算摘要，完整画刷的原生包边另有一次批次确认。整场景美术独立审阅。

```sh
npm run coherent -- continue --root PROJECT --delivery DELIVERY --composition COMPOSITION_JSON --terrain TERRAIN_JSON --capture true --browser-channel msedge
```

`--composition` 接收 `surface-review` 输出的 `composition-profile.json`。也可用
`--surface-observations JSON` 和可选的 `--terrain-rendering JSON` 计算地表标定。
需要具体摆位的场景使用已经绑定摆位的 `--composition`。完整画刷传入 `--terrain`，
有谷地量测要求时传入 `--band-relations-reviews` 和 `--band-guide-reviews`。
基础来源齐备后，这条命令可以省去分析器和图像适配器。交付输入通过现有的身份、
材质、原生包边和摆位校验。可用 `continue --root PROJECT --delivery DELIVERY`
复验已有交付，或用 `capture` 写到新的审阅目录。

有桥洞、悬挑或薄平台时，可以给 `createFeatureCoherentComposition` 传入
`terrainLayout: {terrainRuns, curveTerrains, terrainConnections}`。这三个字段使用
本项目作者地图的格式，随后由地图编译器校验范围、曲线和实体重叠。采用显式布局时，
地表量测仍用于材质，环境素材使用显式变换或各自包络摆位。贴地装饰需要用派生
素材中可见的根部和作者地图上的落点复核，必要时以 `transforms` 绑定摆位。
从画框外进入的前景装饰按默认镜头检查裁边。候选中保留布局证据，可逐项检查
桥洞、碰撞和笔刷表现。

`--adapter codex` 显式选择已有可选本机图片传输，并把私有传输状态隔离到项目
`private-transport/`；也可用 `--adapter-module` 的异步 `createAdapter()`。公开核心
不自动发现凭据、服务或模型。适配器需要 `preflight()` 与 `generate(input)`，后者
返回原生 PNG 字节；程序先持久化预留和提交，再调用一次，不在错误后切换传输。

宿主分析器不是内置模型：`--planner-module` 导出 `createPlanner()`，返回
`{analyze({request, bytes})}`。输入为准确参考与需求，输出为已封装的
`ai_scene_measured_reference_layout_v1`，详见 [实测合同](reference-led-v1.md)。
每个显式 analysis ID 先预留；成功结果验证后可复用，未知结果不重调同一 ID。
未配置分析器时，由当前 Agent 观察并通过 `assess/review` 提交同一类型数据，
无需按主题编写组装脚本。没有配置和实测分析器时，不宣称无人值守全自动。

SDK 从包入口 `./coherent` 使用 `initCoherentPipeline`、`driveCoherentPipeline`、
`deliverCoherentPipeline`、`verifyCoherentDelivery`。`drive` 的 operator 回调只是
人类决定的传递边界，生产宿主不得把测试里的自动接受替身当真实用户决定。

## 内置图片工具与离线交换

没有可靠 CLI 图片传输时，保留同一冻结计划，使用正式离线桥接，不临时改提示：

```sh
npm run coherent -- reserve --root /local/project --out /local/new-exchange
# 已授权的 Agent 严格执行 exchange.json 的提示、输入顺序和透明参数，一次调用。
npm run coherent -- receive --root /local/project --exchange /local/new-exchange --file /local/native.png
```

`reserve` 仅预留/记录提交，不调用图片工具；Agent 随后只执行该票据一次。
`receive` 保存原生字节并技术检查；同票据同字节的中断后重复接收不新增事件。
未知调用须 `stop-unknown` 保留终态，不用同一授权再发一次；也不跨终态接收。

## 回拼后的显示摆放

新交付默认使用[显示密度v2](coherent-sampling-v2.md)，以最终显示尺寸决定派生分辨率，
原生来源不足时不放大造像素。下面的v1仍支持历史重放；新显示配置应使用v2并绑定
`sourceSampling: "display-density-2x-v1"`，其他摆放字段保持相同。

初次粗包络居中组装不保证完整构图。Agent可以观察候选后提供独立封装的
`ai_scene_coherent_composition_v1`数据，绑定准确`batchSha256/targetSha256`，通过
`deliver --composition JSON`写入全新交付目录；SDK为
`deliverCoherentPipeline(root, output, {composition})`。旧候选保持。

`transforms`每项包含`instanceId/x/y/scale/tint/opacity`，只作用于已有非地形、
非平台主体。位置是显示内容原点，负值以显式visualOffset表示，逻辑锚点仍在
世界内；比例为有界均匀显示缩放，不创建放大的来源PNG。没有Alpha、像素裁图、
任意路径或代码字段。可选`layerOrder`必须为全部冻结层ID的完整排列，用于新
作者构图，不修改已接受原图或实测目标的历史数据。

v4不透明背景允许有界均匀显示缩放，但必须维持全不透明、白tint；旧v1—v3
背景和地形不开放该显示样式。所有原有透明度、PNG、校验和、平台物理约束保持。
来源及派生PNG保留，变更仅在版本化目录的显示属性/作者文档，新的kit revision
携带配置摘要。`verify`从交付绑定的`composition-profile.json`重放新候选与导出。

这是Agent看图后的可重放作者数据入口，不代表程序自动识别所有主体或模型
必然产出纯净分层。沙漠试验曾出现来源混入主墙、初次漂浮/底部露空；摆放改善
了整体画面，未把这些来源追认为精确分离成功。

## 对比和 Studio

`deliver` 的 `reference-vs-reconstruction.png` 是完整参考与确定性默认图渲染的
并列对照，明确标注为 CPU 合成结果，不能冒充实际 Studio。`verify` 重放来源、
派生、kit、导出、ZIP 与预览，任何字节变化均失败。

`capture` 启动只读配置的临时本地 Studio，使用已安装的可选浏览器与软件 WebGL，
输出编辑页、预览页、实际游戏视口和 `reference-vs-studio.png`；检查图层显隐不
改作者地图、JSON保存、浏览器/CLI ZIP一致及页面错误。静态工具和浏览器由宿主
显式提供，不自动下载。`studio` 则保持本地编辑器供用户继续搭图。

Studio HTTP 仍只有固定 kit 和确定性编辑接口，没有生图、任意命令或路径端点。
原生媒体、作者文档、相机/选择/显隐状态、技术验证与人类美术决定分别保存。

实现有合成素材、含显示配置的真实浏览器验证及沙漠主题的真实完整单次链路。
图片使用本会话内置工具交换执行；真实外部分析器/独立Codex CLI执行可靠性和
任意主题稳定性没有因这次成功得到证明。详见 [执行文档](execution-plan.md)。
