# UI reference contracts · source preview 0.6.0

## 合同职责

| 合同 | 生产者／用途 |
| --- | --- |
| ui_reference_project_v1 | 核心：项目、当前风格、原型、当前已接受结果与固定样板索引 |
| ui_reference_style_v1 | 核心接受规则草案：图片来源、视觉规则、明确优先级及摘要 |
| ui_reference_style_pack_v1 | 用户／目录：数据 JSON，UI 画风、控件细则、可选继承／PNG，不接受角色或执行配置 |
| ui_reference_style_v2 | 核心：原包／继承包／图片字节、解析规则、项目覆盖、优先级及不可变摘要 |
| ui_reference_local_sample_catalog_v1 | 外部本地样本包：六份已接受的默认风格交付及可移植图片／来源记录 |
| ui_reference_prototype_v1 | 只读上游适配器：校验过的来源、当前视图节点、画布及中性图 |
| ui_reference_intent_v1 | 用户／Agent：面板备注和已有可见节点的强调选择 |
| ui_reference_plan_v3 | 编译器：运行时、输入快照、分辨率策略、可选原图复用／局部修正来源、冻结请求及摘要；已知旧 v1/v2 只读兼容 |
| ui_reference_select_correction_v1 | 编译器：已验证成图来源、图片快照与可见 Select 目标 ID |
| ui_reference_project_plans_v1 | 编译器：同项目待生成面板计划集合、共同风格／已接受样板与逐份请求摘要；不包含计算决定 |
| authorization / attempt / receipt | 执行器：一次计算决定、提交保留与结果身份 |
| technical QA / human review | 程序记录技术证据；人决定布局、风格、文案是否接受 |
| provenance / handoff / manifest | 打包器：公开来源、下游 PNG 定位及交付校验 |
| ui_reference_coordinate_mapping_v1 | 核心：原型逻辑画布到实际图片像素画布的精确分数变换 |

schemas 描述外部草案和交换形状；精确提示词重建、图片、跨引用及状态以 src 运行时为准。
SHA-256 证明内容一致性，不证明作者身份或真实人工决定。本地工作区和显式配置的适配器由可信宿主管理。

## 风格与原型

风格通过内容摘要寻址。创建草案和审批激活分开；新计划冻结完整规则及图片字节。
规则字段：palette/material/shape/typography/icons/decoration/lighting，palette 可为空。
六种新预设是规则包，可以没有主图；请求最少只有一张 layout-reference。
新包冻结 render_style 的八个字段、ui_rules 六个字段、palette 和 negative_rules。
UI 适配 ID／版本与角色来源 ID／版本／SHA 分别记录，不继承角色重设计、透明底或多视角动画要求。
纯图片和旧开发预设保留 v1；旧指导板只展示配色关系，不作为模型效果证据。

定制导入最多 256 KiB JSON，字段白名单和有界文本，不支持 ZIP 执行、模块、提供商配置或任意文件继承。
base_style 只能指向六种不可变默认包的确切版本；基础包与原包均复制字节并核对摘要。
references.primary 仅接受安全相对 PNG，拒绝穿越、设备名、链接及与显式 --reference 并存。
导入时快照图片，后续生成不重新读取包外文件。无参考图不伪造语义分析或艺术样本。
--rules 将项目覆盖解析到最终 pack；同时保留 overrides，校验时从原包、基础包和覆盖重建整个 pack。
优先级为已确认项目规则、解析包、主图；激活前由人解决视觉冲突，不逐面板改变全局规则。
修改任何包字节、参考图、配色或 notes 都产生新 style SHA，已有风格更新策略继续适用。
新默认包版本一旦进入项目快照必须保持可验证；修改包规则须新增版本并保留旧版本解析支持。

显式 --sample-catalog 只接受数据 JSON 与同目录的六份独立标准交付，不执行脚本、解压或访问网络。
目录必须按六种默认 ID 排列，名称／版本匹配内置包，样本使用同一原型及逻辑画布。
校验每份标准交付与确定性 ZIP，再核对目录的 PNG／style／manifest 字节及摘要、风格身份、
画布、原型摘要和接受状态；默认样本的规则必须为未覆盖的完整内置包，不能冒充其他版本。
目录路径受 local 路径约束，拒绝穿越、设备名和链接。catalog 自摘要不证明人工记录或发布者身份。
目录记录 sampleIsProjectAnchor=false；读取预览不产生审批或计算。style-create 必须同时指定默认 preset，
且不能同时指定 pack／reference；它把已验证 PNG 字节冻结成普通 v2 primary-style。
项目风格不依赖外部目录继续存在；公开快照包含 PNG 摘要和包身份，不包含宿主目录路径。
项目样板仍须来自本项目同一风格的接受结果，不能直接用样本项目的接受记录。

PanelBundle 使用上游 validatePanelBundle 重编译；PanelSpec + Catalog 使用 createPanelBundle。
不复制目录或按名称猜布局。公开投影只保留节点 ID、类型、累积画布矩形、裁切矩形、文字与可见值。
事件、业务绑定、完整状态和原型资源保留在私有原始 bundle，不导出。
图片槽位是有身份的占位节点，精确素材外观依赖可选截图；未提供截图不能宣称素材还原。
隐藏视图应在上游另存独立 panelId 后导入。

0.4 编译时对 Select 再投影可见语义：按 selectedId 查找唯一选项，只输出 selectedLabel，
不把完整 options 或内部 selectedId 作为可见文案。presentation 明确 dropdown、popup=closed、
visibleOptionCount=1、down-chevron。Tabs／RadioGroup 保留自己的语义，不互相转换。
已有原型快照和中性图不被重写；已知 0.2/0.3 的历史提示词仍由冻结兼容编译器重建。

intent.emphasisIds 必须存在于当前可见节点，note 可空且完整保留。无 provider 字段或面板级风格覆盖。
自然语言语义冲突由 Agent／用户在规划前处理，提示词约束不证明生成模型服从。
已接受面板可以固定一次样板，绑定源任务、同风格身份、人工审查和图片摘要。
改变固定样板创建新的风格修订，例如修改风格 notes 再审批激活，不覆盖旧样板。

## 同项目计划集合

`plan-project` 只准备本地计划，不选择样板、不记录授权、不调用提供商。
默认选择所有未达到 accepted_current_style 的注册面板；显式 panelIds 必须非空、不重复、属于待生成面板，
最多 64 个。全部完成返回 nothing_to_plan。没有当前风格已接受样板时要求先用单面板流程完成首图。
可选 intents 是现有意图对象数组，仅针对选中面板，不重复；每个强调节点须存在于对应原型。
集合统一使用 native 或 exact。一个项目 mutation.lock 覆盖校验、请求编译和计划发布，
全部请求校验成功后才写 run；I/O 中断可能留下未授权计划，核心不提交或自动清理／恢复它们。

集合冻结 projectId、runtimeSha256、styleSha256、样板的图片／计划／审查摘要，selection、
各面板的原型／计划／请求摘要、相对 run 路径，以及 maximumCalls 和准备时 computeCalls=0。
集合 JSON 自摘要之外，还须由 inspect-project-plans 校验全部计划重建、来源及共同身份；
currentContext 比较当前风格／原型／样板，runtimeCurrent 比较当前源码，runs 返回已验证状态。
旧集合不因项目更新而改写。集合的 SHA 不能作为单份授权 SHA；每个请求继续沿用独立单次执行边界。
准备时的 computeCalls 不表示后续运行状态，也不证明生图发生。重复规划永远不能重启已保留尝试。
外部结构见 [project-plans.schema.json](../schemas/project-plans.schema.json)；接入顺序见
[host-integration.md](host-integration.md)。

## 生成交换与适配器

请求 schema 见 [generation-request.schema.json](../schemas/generation-request.schema.json)。
v2 请求在生图前冻结完整 prompt、图片顺序、逻辑画布与分辨率策略。模型和提供商设置由外部适配器私有维护；
改变配置需新计划、新决定，不能重新派发已保留计划。

可选 ESM 接口：

```typescript
export async function generate(request: {
  prompt: string;
  images: Array<{ role: string; sha256: string; bytes: Uint8Array }>;
  width: number;
  height: number;
  resolution: { mode: 'exact' } | {
    mode: 'native'; minEdge: 256; maxEdge: 4096; maxAspectRatioErrorBps: 100;
  };
  output: { format: 'png'; opaque: true };
  requestSha256: string;
}): Promise<Uint8Array>;
```

适配器负责映射 API，原样传递提示词和有序图像，不换图、重排、缩放或自动重试。
width/height 为原型逻辑尺寸；native 模式交由提供商选择同宽高比的原生像素尺寸。
这些逻辑值不是 native 模式的强制输出尺寸。适配器不得把 native 偷换成缩放到原型尺寸。
导入适配器不得提交任务；核心先写不可复用 reservation，再调用一次 generate。
端点、凭证、模型／工作流／主机路径和私有回执不进入核心日志或公共交付。
源码没有内置提供商，测试替身不作为真实插件。
适配器异常正文不输出；抛错、超时、返回无效字节均保守记为 indeterminate。
宿主工具交换也先 request，再调用一次，按同一 requestSha256 receive。
该摘要绑定本地请求身份；实际外部执行证据由宿主负责，核心不伪造模型回执。

授权绑定 planSha256，最多调用一次；排他创建 attempt.json 防止重复派发。
在途结果即使项目已换风格仍保存，但人工接受和交付要求匹配当前风格及原型。

## 状态与恢复

| inspect status | 含义／动作 |
| --- | --- |
| awaiting_authorization | 展示本地冻结计划，取得明确计算决定 |
| ready_for_reprocess | 新的零调用本地处理计划；核对来源、策略和摘要后执行 reprocess |
| authorized | 已记录决定，尚未保留请求 |
| reserved_no_resubmit | 已保留请求；等待结果，禁止再次提交 |
| raw_received_needs_finish | 对同一个 raw SHA-256 确定性恢复 |
| pending_visual_review | 技术完成，等待人工判断 |
| accepted | 本次图片已接受；仍须用项目 status 检查当前风格 |
| rejected_visual | 明确拒绝；可显式 optimize 建新计划 |
| failed / indeterminate / rejected_technical | 终止，禁止换 raw 或重投，需新用户决定 |

状态由不可变文件导出，不让 Agent 写状态标签。完整性失败直接阻断。
进程在保留后中断也不自动解除保留；不编辑旧 attempt，必要时保留工作区并创建新计划。
只有已有原始图片的确定性处理可以重放，不增加 provider 调用。

尺寸拒收的原图复用使用独立 `reprocess-plan`。源任务必须是完整可验证的 exact 终止拒收：
原计划与请求可重建，一次授权与 attempt、receipt、terminal 摘要匹配，原图 SHA 匹配，
像素尺寸确实不符，而同一原图满足 native 的格式、宽高比、不透明和非空检查。
新计划冻结 `rawSource`（源任务、计划／请求／原图摘要），继承相同原型、风格、意图与原先样板，
`parentPlanSha256` 指向原计划，阶段为 raw-reuse，`maximumCalls=0`。
它不创建计算授权；authorize/request/generate 明确拒绝它。
reprocess 由程序创建独立本地 attempt、复制相同 raw 字节并写 QA，不改写源失败记录。
可重放相同字节；仍须新的显式人工图像验收。不能用于换风格／原型、修字、缩放、未知结果，或串接复用链。

## QA 与交付

分辨率策略是计划的一部分，默认 native，也可显式 exact：

- exact：实际 PNG 尺寸必须等于原型逻辑画布。
- native：保留实际像素尺寸，短边至少 256、长边最多 4096，
  `abs(pixelWidth * logicalHeight - pixelHeight * logicalWidth) * 10000 <= pixelHeight * logicalWidth * 100`。
  以整数交叉乘积核对相对宽高比误差 ≤ 1%，不使用浮点阈值或事后变更容差。

不透明、格式正确、非单色仍是共同技术门；错误宽高比不能靠裁切或补边放行。
技术 QA v2 包含真实 dimensions 和 coordinateMapping：逻辑与像素画布、左上原点、零偏移、
精确的 x/y 分数缩放。这里映射坐标，不修改图片，也不证明控件布局服从；布局须人工验收。
非单色检查只排除明显空白，不证明正确控件。视觉门为显式人工 layout/style/copy 三项。
后处理只移除元数据并重编码，逐字节比较 RGBA；不改字、裁切、拉伸或换风格。
原图保留，审查绑定最终图片摘要。每任务只有一个不可变人工决定。
拒绝后的修正新建含 parentPlanSha256 的 plan；optimize 不生图，需重新授权。
当前不调用自动视觉模型、不循环优化，不声称模型可稳定精确生成文字。

`correct-select-plan` 是显式单次局部修正：先 verifyResult，再快照 reference.png，绑定来源计划摘要、
相同项目／panel／原型／风格、非空唯一可见 Select 目标集合，parentPlanSha256 指向来源。
它不要求来源人工通过，也不将其升级为样板。请求中 correction-source 位于第一张，
随后仍按原顺序附带布局与风格上下文；完整角色顺序、图片字节和修正目标进入摘要重建。
局部保留指令在目标之外优先于一般布局／风格指令。新计划要求新授权，maximumCalls=1。
禁止与 rawSource 同时使用、引用自身、串接修正链或把修正结果作为零调用复用来源。
模型仍可能改变其他区域；程序没有自动宣称修正或区域像素一致性通过，仍由人验收。
接受后的公开 provenance 可附 correction（种类、来源计划摘要、原图 artifact、目标 ID），
原成图 PNG 随包核对字节与摘要，不包含私有 run 路径、授权或人工审批文本。

导出要求所选面板匹配当前 styleSha256、当前原型和完整已接受证据。
默认全部注册面板，显式子集在 manifest 披露。未更新面板阻断整套交付。
公开内容只含图片、可见投影和中立来源，不含授权、私有业务、适配器路径或提供商配置。
v2 style.json 包含解析后的 UI 包身份与来源；交付同时包含原始 UI 包和可选基础包 JSON，
校验逐字节核对来源，再重建解析规则，禁止只重算 manifest／ZIP 后篡改规则。
复用上游公开 createStoredZip，不复制其实现。固定排序和时间；
manifest 覆盖全部有效载荷，ZIP 覆盖载荷与 manifest，验证禁止多余文件并重建 ZIP 比较。
ZIP 自身摘要由 export 返回，避免自引用。

ui_reference_handoff_v2 指向同目录 reference.png，canvas 表示实际 PNG 像素画布，
logicalCanvas 表示原型逻辑画布，另含 resolution、coordinateMapping、风格和接受状态。
provenance v2 同时记录映射、策略与可选 rawSource 摘要，不输出源任务私有路径。
delivery v2 校验重算映射，核对图片尺寸、逻辑尺寸、原型图尺寸及 handoff/provenance 一致性；
即使 manifest 与 ZIP 一起重算，也不能接受错误映射。
现有 ui-layer 仍使用 PNG 图片入口；未新增下游 API、未执行下游生成，也未改文字政策。

## 分发和验收范围

源码预览需要保留兄弟包关系，没有独立 npm 发布、站点或服务。
自身 src、CLI、预设、package 与 ZIP writer 指纹进入冻结计划；变化后拒绝恢复旧计算任务。
已知 0.1.0 源码指纹保留旧请求编译规则，用于只读检查及尺寸拒收原图接入。
已知 0.2.0 的 v1 风格／v2 计划保留请求编译语义；完整结果可验证、人工审核、用作同风格样板并导出。
已知 0.3.0 的包风格／v2 计划及 0.4.0 的 v3 计划／局部修正结果保留各自请求编译语义，亦仅供只读证据使用。
inspect 将旧计划标为 executable=false；不能 authorize/request/receive/finish 旧计划。未知指纹拒绝读取。
样本准备生成六个未激活项目，统一原型摘要；样本计划先验证六份风格审批和无样板条件再冻结。
准备／冻结都不调用模型、代写人工意见或自动登记样本图片。已接受的本地六风格包可经显式目录入口装载，图片不随源码发布。
上游另记录 PanelSpec／编译器版本及校验后 bundle 摘要。生产使用固定标签与归档摘要。
测试使用程序图形和模型替身。已完成宿主交换、六份默认样本人工验收，以及概念图风格同项目三面板的真实生成、接受锚点继承与完整导出。
三面板按美术参考图用途接受，保留字号与布局比例的已知偏差；不等于所有风格、复杂原型或像素级几何均已验证。
