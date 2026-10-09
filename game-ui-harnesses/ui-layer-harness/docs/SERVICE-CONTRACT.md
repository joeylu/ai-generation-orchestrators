# UI layer host contract v1 (preview)

## Optional protected source background

Fresh integrated host configs may bind `backgroundRegion`,
`backgroundRegionDigest`, and the explicit
`exact-source-canvas-protected-region-v1` background policy. The
[protected background contract](PROTECTED-HOST-BACKGROUND.md) requires independent
mask scope review, genuine raw acquisition, deterministic candidate replay and
final protected-pixel identity. Masks are declarations, not certified
segmentation or API inpainting parameters. Candidate seams and contamination
still require actual visual review; historical jobs and default behavior retain
their frozen policies.

## Optional explicit prototype instances

Fresh integrated host configs may bind `materialReuse` before planning review.
The [prototype contract](MATERIAL-REUSE.md) preserves complete layer identities,
requires independent equivalence evidence and instance material/body review,
and filters only real image requests. Copies receive no provider receipt.
Default behavior, historical frozen jobs and failed gates remain unchanged.
Fixture coverage does not constitute real generation or visual acceptance.

唯一公开入口：`python game-ui-harnesses/ui-layer-harness/ui_layer.py`。
每次命令 stdout 输出一个 JSON（`--help`/`--version` 除外），过程信息写 stderr。
退出码 0 表示命令完成或正常等待，不等于视觉通过；非零表示本次命令失败。

`prepare-material-cleanup` 可冻结一份真实收到的污染素材或合板单元作为新编辑来源，
绑定原图、归属目录和旧来源回执。准备不调用模型，也不授权生图；新作业最多一次
请求、零自动重试。旧状态不变，收到清理图仍须复审和主体归位。详见 [清理交换](MATERIAL-CLEANUP.md)。

新 `prepare-output-review` 冻结 V2 对象所有权目录及必需的逐对象观察，空 findings
不能代替检查。候选归位另提供显式 `measured-alpha-anchor-locked-v2`，支持画布不可
推动或缩小主体锚点；正式归位仍须真实主体观察。详见 [所有权及锚点合同](OWNERSHIP-AND-ANCHORS.md)。

所有权目录扩展 prompt/schema 后，确定性准备程序在同一未冻结事务中重建内层
`review/request.json` 的输入摘要，并纳入 `ownership-inventory.json`；随后外层请求
绑定这份最终内层请求及全部实际附件。重验同时检查内外两层，避免保留基础 prompt/schema
的过期摘要。已冻结的历史作业及固定运行时不原地改写。

显式候选整包路径使用 `prepare-candidate-delivery --snapshot SNAPSHOT --snapshot-digest SHA256
--output NEW_CANDIDATE` 冻结 `deferred-visual-review-v1` 与 `uniform-alpha-contain-v1`、
完整快照与当前公共运行时指纹。它不授权生图，也不修改默认严格审查路径。
可显式传 `--candidate-registration-policy measured-alpha-support-v1` 冻结独立候选归位策略；
默认仍为 `uniform-alpha-contain-v1`，交付时不能改变已经冻结的选择。
若修补候选尚未得到新 M2，可先使用 `freeze-candidate-plan --candidate PLAN.json
--image REFERENCE.png --source-sha256 REFERENCE_SHA256 --contract-dir FIXED_FAD597A0_CONTRACT
--max-calls N --output NEW_SNAPSHOT`。程序检查固定公开 schema 字节、来源、未知项、引用、
几何关系及有限调用预算，再调用原确定性编译/分组/参考生产程序冻结 sheets/context-crops/v8。
仅 SAME_LAYER_OVERLAP_REVIEW 且 requires=M2 的声明框视觉提示可明确留待人工整图检查；
它们原值进入 planningVisualFindings 与交付 review.json，未知引用和其他关系错误仍阻断。
snapshot 显式 policy=deferred-visual-candidate-plan-v1、planningReviewDeferred=true、
newM2ReviewPerformed=false，无伪造新 M2 结果。默认编译仍拒绝这些未审关系。
该候选冻结可显式选择 --generation-mode single|sheets，默认 sheets；single 继续使用同一原计划、
参考、视觉策略、纹理绑定、context-crops/v8 与确定性资产/归位结构，只改变生成请求分组。
可传 --visual-policy；有纹理区域时同时传 --visual-textures 与 --prior-texture-review：
旧实际来源绑定审查的 bytes、摘要和区域归属重新核验并保留，明确只是调用方提供的历史区域审查，
newTextureReviewPerformed=false，不声称新候选已完成 M2。区域所属 ID/框变化导致原审查不适用则拒绝。
随后 `deliver-candidate-layers --candidate NEW_CANDIDATE --job-digest CANDIDATE_DIGEST
--received-source REQUEST_ID=RECEIVED_JOB [...] --output NEW_EXPORT --viewer BUILT_VIEWER`
必须覆盖冻结请求全集；每份实际收到的图片仍严格重验授权、submission、receipt、原图摘要、
snapshotDigest 与 request 原值。旧 scene 只有原快照摘要和原请求完全相同才可复用；
不能为不同快照伪造新生成回执。原 job、审查终态、失败记录和授权均保持封存。
候选提取没有模型调用、不声明审查通过、不观察主体；合板非零 alpha 的透明分隔、
空单元、原生 alpha、路径、图层几何、完整集合、校验和及 ZIP 门仍阻断。
分隔/回执失败返回 `failedRequestIds`，不自动重投。
新候选冻结 `candidateSheetSplitPolicy=unique-nearest-frozen-grid-zero-alpha-seams-v1`。
先尝试原严格 cells/actual_gaps；仅原异常恰为 SHEET_AMBIGUOUS_EMPTY_BANDS 时，
可在原 axis_cuts 的名义位置±单元宽/高四分之一搜索范围内枚举至少连续两像素完全透明的空带。
每空带候选切线两侧整行/整列都必须 alpha=0，选距冻结名义切线最近且位置唯一的切线；
名义切线本身安全就优先，最近距离并列或没有安全空带仍失败。
不以非零 alpha 阈值清理噪点、不截断非零切线、不自选范围外边界；所有其余原生 alpha、
单元尺寸、非空素材、空余单元及边缘检查保持。程序按全部容量单元划分原 RGBA，
验证每个源像素恰好归入一个单元、整片像素重拼与原片 bytes 完全相同。
候选报告保留 strictExtractionIssue=SHEET_AMBIGUOUS_EMPTY_BANDS、实际切线与完整划分框，
标明 allSourcePixelsRetained=true、reconstructionPixelExact=true，并绑定源/重拼像素摘要。
这仅是显式候选提取，原严格空带歧义及待人工整图验收的事实不会改成通过。
新候选还显式冻结 candidateSourceBoundaryPolicy=preserve-faint-source-boundary-guard-v1。
仅原严格异常属于 SHEET_AMBIGUOUS_EMPTY_BANDS 或 SHEET_CONTOUR_TOUCHES_CELL_BOUNDARY，且原图真正外周存在非零 alpha、
所有外周非零 alpha 都≤1 时，才可保留这些弱像素并给每个原裁片四周增加2像素透明 guard。
guard 资格由原源外周像素事实决定，不受上述两种原异常的抛出先后影响；strictExtractionIssue 保留实际先发生的原异常。
任何外周 alpha≥2 仍阻断；内部切线仍须原搜索范围内唯一最近的双侧整行/列完全 alpha=0，
空余单元有任何非零 alpha 仍阻断。只允许原图真正外边缘弱 alpha 通过新增画布保留，
不删除、阈值化或改变任何原 RGBA 值；guard 内原裁片与原片逐像素复核，整源划分重拼保持 exact。
报告保留原 strictExtractionIssue、rawOuterBoundaryNonzeroAlphaCount/Maximum、
sourceBoundaryAlphaPresent、sourcePixelPartitionExact=true、samplingGuard=2、alphaQualityAccepted=false。
这是保留已有弱支持的显式候选画布扩展，不证明原严格 alpha 质量通过，也不能恢复原生成图中
已被裁掉或缺失的实体内容；旧原图、作业和候选策略目录不改写。
默认 uniform-alpha-contain-v1 每份前景以完整非零 alpha 支持框作等比缩放，居中放入原归属框；只清零 alpha=0 的 RGB，
不删除 alpha=1。desired/actual 尺寸、偏差、统一比例与没有主体观察的事实写入报告。
双侧源透明采样 guard=4 像素、输出 guard=2 像素，实际采样后检查透明边界与完整非零支持框，
不足以容纳 guard 的小目标或实际 alpha 触边会阻断，绝不以声称未裁断代替检查。
显式 measured-alpha-support-v1 仅用全部 alpha≥8 像素的共同外接框测量源几何，
不选最大连通部件；如果没有 alpha≥8，确定性回退完整非零 alpha 框。测量阈值只参与框计算，
原始 RGBA 不作阈值清理或掩膜，全部非零源支持与 RGBA 使用同一个均匀 affine 三次采样。
目标是原声明 ownership 框，不是观察到的 reference 主体。先将测量框等比居中 fit 到目标，
若完整支持越出 reference，优先作到安全可行区间的最小平移；支持连同采样 guard 大于 reference 时，
降低同一个统一比例后再作最小平移。输出画布取实际完整采样支持加2像素透明 guard 与 ownership 框的并集，
允许扩展 ownership，但必须完整处于 reference 内。源 guard=2、reference 安全 guard=2，
程序检查实际渲染支持，并重拼裁出的画布与完整渲染 RGBA bytes 一致后才发布。
报告记录 sourceFullAlphaBox、sourceMeasuredAlphaBox、measurementThreshold=8、fallback、
desiredScale/actualScale、translationDeviations、实际支持/画布框、sourceUnthresholded=true、
sourcePixelsUnchanged=true、observedBody=false、humanVisualAcceptance=false。
缩放后的八位 alpha 数值会受采样和量化影响，resampledAlphaValuesAreSourcePixelExact=false；
保留原源 bytes/摘要与未阈值化输入，不声称缩放结果逐像素等于原源，或严格主体/alpha 质量已通过。
背景也只等比缩放，比例不同时显式复制边缘像素补齐不透明画布，报告 backgroundEdgePadding；
这种候选适配不等于原像素画布相等或严格主体归位通过。原始来源 PNG 与回执留在原 job，
导出记录绑定原图/回执/提交摘要，公开包不包含私有 job 路径。
可重复 `--review-run REVIEW_DIR` 保留同来源的既有完整真实素材审查 findings，
包括 blocked_no_retry；重验来源与响应，不将阻断改成通过。全部实际 findings 和几何报告
进入 ZIP 的 review.json，最终状态为 `pending-human-review`，humanVisualAcceptance=false、
originalDagPromoted=false，包内仍为 review-required。导出位于 NEW_EXPORT/delivery/ui-layers.zip，
回拼为 NEW_EXPORT/delivery/package/preview.png。新候选导出不是旧失败作业恢复，
严格路径仍要求原有素材复审与主体证据，不自动选择此策略。

候选导出显式冻结 candidateMaterialSubstitutionPolicy=complete-sheet-fresh-singletons-v1。
可重复 `deliver-candidate-layers --received-material MATERIAL_ID=FRESH_SINGLETON_JOB`，
只允许完整替换一个原 sheet 的全部 materialIds；部分替换、重复 MID 或替换原 singleton 均拒绝。
原 --received-source 仍须覆盖请求全集，原 sheet 的实际授权、提交、receipt、raw 摘要和请求值仍验证，
并对原片只读记录严格提取的实际失败原因；替换不把该失败改成成功，也不恢复或重投旧作业。
每份新来源必须是独立新 job、一次调用预算、单 MID、真实收到的原生 PNG 及独立摘要授权/回执，
其快照明确是新 candidate single，sourcePlanSha256、referenceSha256、视觉策略/纹理/绑定摘要、
完整编译资产结构、placements 和 context references 都与原 candidate sheets 保持一致。
请求分组可以改变，但不能借其他计划/参考的任意图片替代；未授权、未收到、回执或请求改动均拒绝。
原 sheet 严格失败、原来源链、新单图来源链与完整替代关系进入报告和 ZIP review.json，
originalSheetDelivered=false，原 alpha 像素继续按完整支持与透明采样 guard 等比归位，
不阈值清理或裁切弱 alpha。最终仍 pending-human-review，不声称新 M2、主体观察或视觉通过。
不直接调用内部 Python 函数，内部 M1/M2 文件不作为 Web 合同。

离线候选可通过 `prepare-host-review --candidate PLAN.json --image REFERENCE.png
--contract-dir PLANNING_CONTRACT_DIR --output NEW_RUN --max-calls 128` 准备独立完整复审。
必须传 `--seed-author OPAQUE_ID`，多个候选作者须重复该参数；这些 ID 是抽象来源标识，
不得填文件路径、凭据或私有服务地址。
可附加 `--planning-notes`、`--visual-policy`、`--visual-textures`。输入候选必须满足
v5 存储 schema；非空 unknowns 可准备供审查，但冻结仍阻断。合同目录中的 schema 与
两份规划／审查 prompt 仅接受固定共享合同 fad597a0 的公开字节指纹并按字节快照，
不得通过外部弱 schema 放宽 v5 验证；运行时公共程序代码指纹也绑定配置。仅生成确定性
附件，默认冻结 sheets、context-crops、v8、typed-review-v4 与 exact-fragments-v1。
候选明确标记 offline seed，既不调用模型，也不声称原 M1 运行成功。

宿主读取返回的 `requestSha256`、`m1/reference.png` 与 `m2` 全部请求附件，独立调用
模型并在运行目录之外保存真实 JSON 响应，再执行 `receive-host-review --output NEW_RUN
--response RESPONSE.json --request-sha256 SHA256 [--response-sha256 SHA256]`。
receive 还必须提供 `--host-attestation ATTESTATION.json --dispatch-evidence DISPATCH_FILE
--return-evidence RETURN_FILE`。attestation 严格包含 kind=`ui_host_review_attestation_v1`、
requestSha256、responseSha256、seedSha256、candidateAuthors、reviewerId、
hostAssertedModelResponse=true、notCryptographicallyPlatformVerified=true、
dispatchEvidenceSha256、returnEvidenceSha256。作者列表必须与准备请求一致，reviewerId
不得属于作者列表；摘要须匹配请求、响应、候选和宿主实际派发／返回观察文件。
派发与返回指纹必须不同。私有规划运行与冻结快照原样封存派发和返回证据，并重验内容摘要；
这些文件可能含宿主运行上下文，不能作为公开 release 示例或公开素材交付包。现有素材
packager 的公开 PNG/ZIP 结构不包含规划原始证据。来源仍只是宿主声明。
非法声明同样封存失败，不能用任意外部 JSON 自动取得模型来源断言。程序按完整
schema、四列表覆盖、所属原文、边界坐标、逐对关系与纹理审查合同重新校验并保存
assessment。缺项／格式非法响应封存失败，禁止再次 receive 或改写输出；有真实问题的
完整响应可接收，但 blockers、关系阻断和 unknowns 不会被清空，冻结仍拒绝。
代码版本或快照输入变化必须新建运行。

证据使用 `exchange-provenance.json`，明确标记 host-attested-model-response、
notProviderReceipt=true、cliSessionAsserted=false；它是宿主声明及内容指纹，
没有平台认证或模型会话验证能力。程序不会创建 transport.json、events.jsonl 或
sameSessionVerified 断言。该来源声明不是加密验证的平台证明；程序验证的是宿主声明
与提交内容的一致性。`freeze-reviewed --planning-run NEW_RUN --output NEW_SNAPSHOT
--max-calls 128` 从有效、完整、无阻断的新复审生成真正冻结快照，保留全部审查附件和
输入指纹并支持已完整复审的纹理合同；inspect 重验冻结证据。原 CLI 规划门保持原要求，
其含纹理旧运行仍不支持 offline refreeze。以上动作均无媒体生成或自动重投；后续生图
继续使用现有确定性 executor 的独立授权合同。

`status-host-review --output NEW_RUN` 只读核验运行与输入。尚未收回应答时返回
awaiting_host_review；封存的非法回应返回 review_receive_failed 和原失败记录，不再解析
无效 raw JSON；有效回应复算后返回 review_blocked 或 ready_to_freeze。所有状态均不调用模型。
host 入口拒绝 CLI-only model/effort/timeout、context 版本和生成策略覆盖，不默默忽略这些设置。

新 `run` 可显式传 `--planning-model MODEL --planning-effort EFFORT
--planning-timeout SECONDS`。默认仍为 `gpt-6-luna`、`xhigh`、900 秒；timeout
必须为 1..86400 的整数。参数绑定根与嵌套规划配置摘要，M1、M2 与所有修补／复审
使用相同模型、effort 和每次 timeout，并保持原同会话核验。仅影响规划调用，不改变
生图、素材审查、定位或主体观察参数。非新 run 拒绝这些覆盖参数；历史配置缺 timeout
仍按 900 秒解释，运行时指纹校验和失败后禁止重投不变。超时诊断记录实际冻结上限；
不会恢复旧超时任务或沿用其调用授权。

可选离线主体定位入口为 `register-materials --config CONFIG.json --output NEW_DIR`。
配置必须显式选择 `reference-body-v1` 或 `reference-body-support-v1`，绑定冻结快照和
每份前景的原图／生成图主体观察合同；具体字段及边界见 [BODY-REGISTRATION.md](BODY-REGISTRATION.md)。
素材裁片仅作归属边界，不再作可见主体缩放目标；前者沿用裁片画布，后者在原图范围内
派生保存全部 alpha 支持的画布。证据缺失、比例不符或相应策略的画布截断非零 alpha 时停止，
不回退旧 contain/frame-bounds，不调用模型或生图。该入口不修改旧作业和质量门；
输出仍待视觉验收。未选此策略的历史入口保留近似裁片适配行为，不能宣称已有参考主体测量。
新 `run` 的自动主体观察与支持画布策略见 [BODY-REGISTRATION.md](BODY-REGISTRATION.md)：
真实素材收到后另行冻结摘要和一次调用预算，等待授权再观察，不复用生图或旧作业授权。

新 `context-crops` run 默认冻结 `contextPromptVersion: v8`，可显式传
`--context-prompt-version v1|v2|v3|v4|v5|v6|v7|v8`；根与嵌套规划版本必须一致。
v8 在每格 KEEP 前逐对象编译 DELETE；外来对象只传身份、类别、关系及定位，
不把其完整外观描述带入绘制指令。父底板排除独立子单元，子层排除独立父底材；
合板和复杂素材均不回退 v6。所属外观、装饰、锚点、许可文字与真实开孔不删减。
此规则仍须实际素材归属复审及整图验收，不能保证生成模型服从。
`full` 拒绝显式 context 版本；历史配置缺版本仍按 v3 冻结，旧 snapshot 字节不转换，
`freeze-reviewed`、显式恢复和修订继承原策略。

新交付 run 默认 `registrationPolicy: reference-body-auto-v1`，
`maximumBodyCalls` 默认 12，可通过新任务参数 `--max-body-calls N` 明确设为 1..128。
实际每份前景最多 1 次，背景不调用；前景数超过预算在生图 job 创建前停止。
实际生成、提取、适配、既有视觉审查完成后，`body_prepare` 冻结完整输入，
状态为 `awaiting_body_authorization`。`authorize-body` 需要 `--job-digest` 和非空 `--approval`，
只记录已取得的宿主授权，不代替平台的对外发送审批；随后 `resume` 执行 `body_observation`。
该观察使用一个新的持久 Codex CLI session，后续素材复用同 session，每次核对 thread ID。
输出 uncertain/not-whole、无效或不确定回执、主体或 alpha 技术检查失败即停止，不重投或修补。
全部观察成功后配置转为 `reference-body-support-v1`，归位不追加模型调用，包仍为
`delivered_pending_visual_review`。可在新 run 显式选择 `legacy-region-fit`；不提供自动失败回退。

可选 CLI 适配器的新传输失败响应附加 `failureDetails`；规划 status 可附加
`modelCallFailures`，按 M1/M2/修补/复审阶段名称索引同一诊断对象。
`failureCode` 区分 TIMEOUT_NO_RETRY、PROCESS_START_FAILED、INVALID_MODEL_EVENTS、
CLI_EXIT_FAILED、NO_FINAL_MODEL_RECEIPT、UNEXPECTED_MODEL_EVENTS；未知传输原因
统一为 TRANSPORT_OR_ISOLATION_FAILURE，不输出原始消息。诊断还可含已记录的
elapsedSeconds、timeoutSeconds、exitCode、turnCompleted 和 transportNotices。
字段只暴露类型核验后的数字和布尔值，不含路径、会话、端点或 stderr。
已恢复的连接通知本身不算失败；超时仅说明未在截止前取得有效完成回执，不证明根因。
原状态名、非零退出、900 秒上限和失败后禁止重投不变。
半条或无效事件流仍阻断，保留原始字节并写失败回执，不截断或修复日志。
本补充仅作用于新固定运行时；旧任务与授权保持原样，不用新代码恢复旧失败任务。

## 输入与任务寿命

新 `run` 可选 `--visual-textures REGIONS.json`，按[视觉纹理合同](planning-text-contracts-v1.md#source-bound-visual-textures)
冻结原图中明确指认的少量微小印记。仅保留可见墨迹形状与布局，不要求猜出无法读清的字串；
已读清及其他业务字继续原文字规则。输入须绑定 PNG 的 SHA-256、画布与非重叠整数裁框；
M2/复审核对素材及对象归属，冻结、局部参考、合板与实际素材复审传递同一保留要求。
非新 run 拒绝该参数，修订、refreeze 和实验提示词/分组变体暂拒绝该策略。
输入方向确认不代替实际模型、生图或主体观察的摘要授权，也不改变已有未知项、视觉质量门或旧回执。

简单滑块等素材可由用户确认后在新规划中声明 `adaptationPolicy: simple-strip`；
经 M2 复核的宽卡片/面板框可声明 `horizontal-frame-slice`，仅缩放中段并保护两端装饰。
默认或缺省为 `preserve`。DAG 在 raw_complete 阶段按冻结目标尺寸适配，保留原图、
派生图和变换证据，状态可附带 `adaptation`。分组图先审查派生候选，再进入注册。
裁断、归属和视觉问题不能因此豁免。
共享规划 schema 消费端须同步支持该可选字段；最终 composition v1 和 CLI 参数不变。
详见 [简单长条适配](SIMPLE-STRIP-ADAPTATION.md)与[横向框体适配](HORIZONTAL-FRAME-SLICE.md)。

`run --image PNG --output NEW_DIR --target frozen|ui-layers --max-calls N`。
ui-layers 还需要 `--viewer BUILT_VIEWER_DIR`，包含 viewer.html/viewer.js。
输入为 EXIF 方向 1 的 PNG；每个任务新建目录；不得复用其他用户目录。
N 为生图请求上限 1..128，不是所有规划调用的 token/费用上限。
可选 `--generation-mode single|sheets`（新任务默认 sheets）；N 为生图请求上限，
一张板只算一次请求，最终素材数可更多。只用于新任务，不能修改旧任务模式。
宿主须按请求 ID 和 materialIds 接收合板回执；只支持逐素材请求的宿主须显式传 single。
已有配置保留其原模式；缺少模式字段的历史记录仍按 single 解释。
详见 [素材板合同](GENERATION-SHEETS.md)。
新 run 可选 `--planning-notes UTF8_FILE`（非空、最多 16 KiB），传入用户确认的拆分约束。
内容按字节快照并绑定输入摘要，传入 M1、M2、修补及复审，不作为模型观察结论或质量豁免。
旧作业不能追加或修改；不改变 CLI 默认行为、状态或最终 composition 合同。
Docker/Web 宿主若使用此可选能力，须提供用户确认的 UTF-8 文件；本仓库不实现宿主改造。
run/resume 可执行模型调用；status 为只读。模型网络授权及服务访问权限由宿主负责。
新冻结的生成提示词仅在素材总标签与已经渲染的所属对象描述逐字相同时省略重复总标签；
背景则保留总标签、从细节清单去除相同文本。不做近义合并，不删对象记录、独立实例、
定位、状态、文字许可或外来素材排除。原 M1/M2 计划与证据标签不改写，审查范围不缩减。
合板 preflight 仍逐字校验当前及两种既有编译格式，并绑定冻结文件摘要；不接受任意精简。
旧冻结提示词和授权不变，运行时指纹不同的 DAG 仍须使用原版本；CLI 与交付合同不变。
内部 M2/复审在大素材的装饰辅助框贴近裁切边时附带有原图坐标与摘要的局部对照图；
这些诊断图只供视觉检查，不进入生图参考或公开 composition，CLI/状态字段不变。
M1/M2 固定模板按规划与检查职责集中表达通用规则，字段/枚举语法由原 schema 提供。
视觉归属、轮廓、状态、文字和不确定性判据仍须模型按原图判断，不能以结构通过替代；
详见 [规则覆盖](PROMPT-RULE-COVERAGE.md)。修补输入和 M3 冻结门不变。
共享 M2 模板以 `ui-review-checks:begin/end` 显式标记本阶段检查范围，修补指令在范围外。
适配资格和重复卡片比例仍是原有检查规则，不能因文档位置而遗漏。
标记残缺、重复、倒置、空范围或混入第二步修补标题会在调用前阻断；
历史无标记模板保留原标题截取方式，旧固定运行不会改写或重放。
新规划配置显式冻结 `reviewEvidenceProtocol: typed-review-v4`，M2/复审逐区提交九宫格可见图形审查。
每区必填 `coveredArtwork`、`unresolvedArtwork`、`optionalShadowArtwork`、`businessText` 四列表及
`emptyRegionEvidence`。已覆盖与可选柔影条目只含 artwork、materialId、objectId、evidence，
schema 禁止 disposition 和 suggestedChange；已有素材归属必须非空。可选柔影只绑定所属
materialId，objectId 必须为 null，不能用按钮/面板主体对象代指柔影；其主体仍须另列覆盖记录。
显式可选柔影策略与不豁免实体描边/高光的校验保持不变。待修订条目还含
disposition（仅 missing/uncertain）及非空 suggestedChange，未知归属可为 null。
有裁框、层级或描述修订需求的条目必须放入待修订列表，不能同时声称完整覆盖。
程序仅在内存中按所属列表确定性补处置、null 建议或原修订建议，再进入相同覆盖、归属及修补质量门。
四列表均空才允许非空 emptyRegionEvidence；否则为 null。原始模型答复及回执保持不变。
这不接受或修正旧失败响应，不增加调用次数，不豁免实际图形问题。

历史无选择器的规划配置仍使用 V3；编译/冻结重建时，V4 必须有配置选择器，显式选择器与
响应及 schema 协议不一致即拒绝。历史 `typed-review-v3` 每区必填
`observedArtwork` 图形数组、`businessText` 业务文字数组及 emptyRegionEvidence；无对应内容填 []。
`observedArtwork` 的 disposition 仅 covered、missing、uncertain、optional-shadow，
每项包含 artwork、disposition、materialId、objectId、evidence、suggestedChange；
`typed-review-v3` 与 `coverage-owner-v2` 不让模型重复填写覆盖项的证据编号或引文。
历史编号格式含 planEvidenceId，逐字引文格式含 planEvidenceQuote，读取规则不转换。
历史混合数组格式的 disposition 还包括 business-text，仍按原协议读取。
covered 必须绑定已有素材和可选的同属对象，程序从当前目录解析指定对象，未指定对象时解析素材；
程序还原该记录的原始 label。来源只证明出处，模型仍须确认其描述本项结构，
不得用有效归属、框包含或泛称主体替代图形记录。
missing/uncertain 即 semantic 阻断，未知归属可以为 null，不能编造 ID。新 businessText 条目只含
artwork、materialId、evidence：完整原文、已知所属素材和原图依据均非空；没有 objectId、
disposition、建议、引文或编号字段。程序在内存中派生 business-text、null 对象／引文／建议，
再进入原文字排除判据。business-text 仅限删除策略允许的
普通业务文字，须绑定已有素材，artwork 写完整文字实例的逐字内容。当前同素材有非空 preserveText 时
保守拒绝 business-text 排除：自由描述不能证明文字身份，混合保留字/业务字的素材仍有误拒限制，
不能通过空归属或模糊文字放行；归属不明走 uncertain。
不豁免保留文字或邻接图形；optional-shadow 仅限显式允许的所属孤立柔影。
非问题建议填 null。两个数组都为空的区域必须给非空 emptyRegionEvidence；任一非空则该字段为 null。
历史编号协议中非 covered 的 planEvidenceId 仍须 null，不自动修正旧响应。
新 schema 不接受旧 missingFromPlan 或自由观察文本，程序读取历史审查时仍保留旧判据；新旧九区不得混用。
字段使用 nullable 基础类型，关联判据由程序核验，不增加条件组合关键字或模型调用。
标为“原图可见、计划未描述”的图形由程序转为 semantic 阻断并进入原有最多两轮局部修补；
小前景素材附一张有摘要的原图
放大对照，供检查附属细节。缺失覆盖审查记录不能冻结；复审仍检查完整候选。
新复审的历史输入只携带上一轮待核销的全部阻断和轻微告警，不重复已通过的详细观察。
程序按上一轮实际审查的计划派生遗漏、裁框和小素材描述问题，不能用新候选提前消除旧问题。
当前完整候选仅压缩 JSON 空白；原图、叠图、局部附件、审查 schema 和质量门保持不变。
完整旧审查留存本地；派生问题记录绑定原计划与审查摘要，作为复审输入核验并进入冻结证据。
仍沿用同一会话、最多两轮修补和原有重复阻断/失败停机规则，不增加模型调用。
这提高漏项检出可审计性，但模型若连原图图形也未观察到，结构化记录不能证明绝对无漏项。
仅影响新任务的内部模型输入/输出；CLI、状态名及 `ui_layer_composition_v1` 不变，
Docker/Web 无迁移要求。既有运行受运行时指纹保护，不在原目录用新代码续跑。

### 版本绑定的规划证据编号

新固定运行时的每次 M2/复审由当前完整候选生成 `plan-evidence-catalog.json`：
`ui_plan_evidence_catalog_v1` 包含完整计划值的规范 JSON SHA-256、按 ID 排序的原文记录及目录摘要。
素材编号为 `m:<materialId>`，对象编号为 `o:<objectId>`；记录保留 materialId、objectId 和原始 label。
目录作为带哈希的本轮请求输入，并进入冻结证据。修补后的复审重建目录，不能借旧摘要沿用新候选。

新模型原始响应必填冻结配置选择的 `planEvidenceProtocol`（新配置为 `typed-review-v4`）和 `planEvidenceCatalogDigest`，
后者等于当前目录摘要。覆盖项没有 planEvidenceId 或 planEvidenceQuote；程序根据已必填的
materialId/objectId 解析 covered 的原文，未知素材、未知对象或对象错属立即拒绝。
非 covered 在内存中派生 null 引文，仍按原处置、归属、文字许可和不确定性规则评估。
小素材 part 仍填 `planEvidenceId`，只能是目录编号或 null，来源只能来自该素材
或同属对象；无描述依据填 null，仍产生原有未描述部件阻断。未知、错属、混合格式或旧目录摘要立即拒绝。

程序仅在内存中用编号还原对应原文后进入既有判据，不改写 raw draft、回执、状态或计划。
编译、冻结及两条规划修订入口根据当前候选重建目录和完整审查 schema，重验文件、请求哈希、摘要与编号枚举；
小素材清单由当前计划和原图尺寸独立重算，不能删除焦点输入、九区审查、小素材语义或轮廓必填字段来跳过核验。
仅重算文件哈希不能替换目录或候选。历史没有协议字段的编号 v1 记录仍要求精确匹配的覆盖编号，
非 covered 的编号仍须 null；无编号标记的逐字引文记录继续按原规则读取，
不自动升级或修正。该变化不增加模型调用、不重启旧失败作业，不改变 session 或单次冻结作业授权。

新 v3 必填 issues 和 cosmeticIssues 两个数组。issues 只接受 semantic/geometry 分类；
cosmeticIssues 不填写 category，code 只接受 MINOR_COLOR_TONE 或 DESCRIPTION_WORDING，
其余字段仍为 ids、description、suggestedChange。程序在内存中补 cosmetic 分类再合并评估，
不自动降低语义、几何、显著外观问题的级别，minorColor=strict 仍按原规则阻断。
小素材 parts 只观察图形结构和外观；普通业务文字列入所属九区的 businessText，不作为无出处的图形部件。
所有新列表和枚举由完整 schema 核验，不能删列表来省略审查。v2 仍使用原混合数组和原 issues，
不自动升级旧审查，旧失败不改判。

程序派生出处和小部件编号只减少自由抄写及重复身份字段，不证明原文足以描述观察，不自动判 consistent 或 complete。
数量、身份、状态、归属、连接、显著外观、裁切、不确定性和最终视觉审查仍由原质量门处理。
目录可能增加输入长度；不能据此宣称提示词整体变短、视觉规划更好或真实回拼已通过。

### 显式视觉策略

仅新 `run` 可选 `--visual-policy FILE`；不提供文件时保留既有提示词、字段和判据。
文件是非空、最多 4096 字节的 UTF-8 JSON，必须精确包含下列四个字段，不补默认值：

```json
{"kind":"ui_visual_policy_v1","appearanceEvidence":"bound-reference","minorColor":"record","shadow":"optional"}
```

`appearanceEvidence` 可为 `text-complete` 或 `bound-reference`；后者仅支持
`context-crops` 新规划。`minorColor` 为 `strict|record`，`shadow` 为
`preserve|optional`。示例中的容差必须由使用者明确选择，不能推断为所有任务默认值。
初始化在建目录、调用模型之前核验输入；原始字节及 SHA-256 绑定配置，M1/M2/修补/复审
请求使用同一摘要。冻结保存 `visual-policy.json` 并在 snapshot、requests 和编译报告
绑定 `visualPolicySha256`；预检重建提示词，不能靠重算文件哈希替换策略或指令。
生成作业及同尺度参考板继承该摘要，不接受提示词覆盖或删掉参考的裁片变体。
显式修订仅继承父策略，旧失败作业不因此重审或提升。

`bound-reference` 仍要求所属短描述覆盖结构、身份、数量、状态、连接和显著材质；
只有细微表面可由绑定参考承载。对应小素材 schema 增加 `reference-bound` 状态，须附
非空 `deferredAppearance`，且 `planEvidenceId` 须选择所属非空原文记录；
历史逐字引文格式仍要求 `planEvidenceQuote` 为所属记录的非空逐字子串。
新显式策略的传输 schema 不使用条件组合关键字：`deferredAppearance` 必填且可为 null，
仅 reference-bound 允许并要求非空字符串，其余状态填 null；关联判据由程序 split 核验，
不会因 schema 改为可空而豁免。动态 M2 schema 保存前须经过已有传输子集检查。
程序记录 `REFERENCE_BOUND_APPEARANCE` 警告；missing/conflicting/uncertain、非法引文、
可见缺件、归属、九区覆盖及 clipped/uncertain 轮廓仍阻断。该状态是模型的明确断言，
程序不从文字推断其视觉真实性；真实输出仍需对照参考复审。

生成提示词继续要求移除普通业务文字、保持比例及真透明 alpha。显式输出审查
额外逐条填 `styleAspect: color-tone|shadow|other`：仅清晰归属的 minor 色调可在
`record` 下记录，仅孤立柔影可在 `optional` 下记录。major、uncertain、缺件、
裁切、错状态/归属、描边、高光、显著渐变或材质损失均不豁免；阴影可选不改变规划
裁框检查。显式策略下 `styleAspect=other` 的样式差异保守阻断，不能代替明确的色调或
阴影归因。轻微色差和柔影记录仍进入输出警告，不能冒充逐像素复原。

用户明确接受轻微外观偏差时，新作业可使用独立版本的显式策略：

```json
{"kind":"ui_visual_policy_v2","appearanceEvidence":"bound-reference","minorColor":"record","shadow":"optional","minorStyle":"record"}
```

v2 必须完整填写上述五个字段，`minorStyle` 为 `strict|record`。`record` 仅将清晰归属、
`category=style`、`styleAspect=other`、`magnitude=minor` 的轻微表面渲染差异记录为警告，
例如主体与纹理类型完整时的细微高光强弱、纹理颗粒呈现或边缘处理差异。所有观察、
证据和建议仍保存并进入交付警告。色差和阴影继续分别受 `minorColor` 与 `shadow` 控制。
major、uncertain、归属不清、缺件、重复、裁切、轮廓破坏、错误状态/归属、位移及材质缺失
仍阻断；不能把这些问题归入轻微样式。v2 沿用原始字节与 SHA-256 绑定、提示词重建及
新摘要授权，不对已冻结作业热更新。v1 的字段、提示词与保守判断保持原有语义，历史失败
审查不因新策略重新解释或提升。此选项是外观容差，不是新交付的人工视觉验收。

当使用者的目标为整体基本还原，可在新作业显式选择 v3：

```json
{"kind":"ui_visual_policy_v3","appearanceEvidence":"bound-reference","minorColor":"record","shadow":"optional","minorStyle":"record","minorGeometry":"record"}
```

v3 精确要求六个字段，新增 `minorGeometry: strict|record`。`record` 将清晰归属的
`geometry/other + magnitude=minor` 记录为 `minor-geometry-deviation` 警告；包括主体完整、
身份/数量/状态/连接不变时的轻微宽高比例、圆角或轮廓差异。模型应依据整体可见影响判断，
不以肉眼估计的像素或 2%/5% 数值决定是否继续。major、uncertain、归属不清、缺件、
重复、错状态、实心裁切以及 `layout` 内部图形位移仍阻断。模型的 minor 声明不是
像素测量，完整原始观察和证据进入交付警告，最终人工验收仍待执行。

主体归位从同一冻结 snapshot 读取该策略。v3/v4 `minorGeometry=record` 允许整体
等比 contain 缩放后的宽高残差超过原来的 1 像素，并在归位证明中记录源/目标比例、
实际缩放后尺寸及残差。中心按真实主体框对齐；两轴使用同一 scale，不拉伸、不移动内部
图形、不重绘、不删弱 alpha。对称宽高比差 `max(rSource/rTarget,rTarget/rSource)-1`
超过 25% 且尺寸残差超过量化的 1 像素时，仍以 `BODY_PROPORTIONS_GROSSLY_DIFFER`
停止。这是防止主体锚点或整体形状严重失配的粗略护栏，不是视觉精确还原指标；较小
差异若真实复审判定 major/uncertain 也仍阻断。未选择 `minorGeometry=record` 时沿用 1 像素门槛。

v3 继承原始字节/SHA 绑定、提示词重建、单次新摘要授权及不重投规则。标准 support、
host 主体交换、完整存储/原尺寸 viewport、离线 preview 和素材来源回放均继承同一
冻结策略；旧 v1/v2、历史固定运行时、已消费授权和失败作业不改判。不将粗略护栏、
回拼一致或程序测试称为用户视觉通过。

使用者也接受轻微内部布局偏差时，新作业可显式选择 v4：

```json
{"kind":"ui_visual_policy_v4","appearanceEvidence":"bound-reference","minorColor":"record","shadow":"optional","minorStyle":"record","minorGeometry":"record","minorLayout":"record"}
```

v4 精确要求七个字段，新增 `minorLayout: strict|record`。只有清晰归属、
`layout/other + magnitude=minor` 的观察在 `record` 下成为 `minor-layout-deviation`
警告。例如完整条板内符号的轻微间距、位置或相对尺度变化，且身份、数量、状态、连接、
先后/左右关系仍保留。观察必须建立两图的完整归属边界，按整体可见影响判断；
不以猜测像素或百分比决定，不改填 geometry/style 隐藏布局变化。
明显位移、关系反转、错层填 major；无法判断或多锚点对应不清填 uncertain。
major、uncertain、归属不清、缺件、重复、错误身份/状态、实心裁切和技术失败仍阻断。
独立 owned/foreign 完整观察、真实 alpha、来源指纹和主体证据要求不变。

完整原始观察、证据、建议和布局警告进入交付报告；不会为消除警告重绘、移位内部图形，
也不改变同一主体的等比归位或 support 存储规则。`minorLayout=strict` 保持布局阻断；
该字段不影响 `minorGeometry` 或其他选项。v1/v2/v3 的提示词与判定语义保持原样。
新策略同样绑定原始字节/SHA、所有提示词、冻结请求和新范围授权；已冻结或已失败作业
不热更新、不重判、不恢复。此容差不代表程序确认像素保真或人工通过。

显式策略的完整 mixed 请求中，每个 singleton 经真实 `single_material_review`：
先重放相同冻结 snapshot 的作业、授权、提交和接收回执，核对 raw SHA-256，再按
background／foreground 技术门禁准备比较图；每项最多一次只读模型调用，合板继续
独立复审。新自动 DAG 与 `finish-received` 传入真实收到的作业。程序提取入口需显式
提供 `received_jobs`；只有 PNG 或缺少真实回执时仍以
`VISUAL_POLICY_SINGLE_REVIEW_ROUTE_REQUIRED` 停止，不创建替代作业或回执。
singleton 的阻断、无效响应、运输失败及输入／回执变更终止整次提取，不自动重试；
警告与判定摘要进入提取记录。通过时仍为待人工视觉验收，原 raw 保留用于后续归位。
历史无策略任务沿用既有路径；选定合板复审无需提供 singleton 作业。
离线验证仅证明策略传播和门禁；实际模型遵循、生成保真及最终回拼尚需单独实验验收。

### 可见轮廓、实例覆盖与短标签

未选择上述 bound-reference 策略的新运行，小素材部件审查在所属证据编号之外必填 `descriptionStatus`：consistent、missing、
conflicting、uncertain，范围沿用现有最多 12 项详细聚焦素材，其余小素材仅查轮廓；
全图仍由九区覆盖与 issues 审查。引文只证明出处；模型仍须对照原图核对数量、形状、连接/间隙及显著
外观，等价措辞可判 consistent，不能用审查自己的观察补足模糊计划。有效引文下的其余
状态由程序派生 semantic 阻断，沿用既有最多两轮修补、重复问题停止和冻结门；缺少字段
或非法状态在新 schema 下拒绝。程序不以类别关键词或文字相似度代替视觉判断。
历史审查缺此字段保留绑定格式和原判据，不改写或重放旧运行。未见结构且模型误判
consistent 仍可能漏检；离线合同通过不证明视觉正确。CLI、生成分组和交付合同不变。
重复检测沿用部件/外观表述的现有签名，改述同一问题可能未被识别；无论措辞如何，
最多两轮修补和未解决问题不得冻结的总门仍不变，不宣称程序能判定语义同一性。

新固定运行时的规划/复审以原图可见自有轮廓检查候选裁片：complete=全保留，
clipped=候选额外丢失可见部分，uncertain=无法确认。原图在画布边缘截断或被遮挡，
不要求猜测补全不可见部分；候选贴画布边也不豁免其他边的漏像素或归属疑问。
clipped/uncertain、原文引用、九区遗漏、重复问题终止门保持不变；程序不通过解析
evidence 文句把阻断改为成功。先从干净原图清点重复组全部实例，再核对已有 ID。
素材短标签概括身份，既有同素材对象承载细节；每条 200 字符上限不变，背景细节
不产生第二个背景或额外素材。字段、枚举、CLI 和 composition v1 不变。
离线替身只验证合同及门禁，真实模型遵循尚待新授权验证；不续跑旧失败作业。

新 M2 与复审的小素材边界记录还须原样返回程序提供的 `sourceBox`：原图像素的
半开框 `[left,top,right,bottom)`，不得从归一化框重新取整或使用附件显示坐标。
`clipped` 必须给 `omittedSourcePixel: [x,y]`，其位置在对应原图上下文内、实际裁框外；
`complete` 和 `uncertain` 必须填 null。像素归属及真实轮廓仍由模型对照原图判断。
程序核验实际候选框、字段及区间关系；错框、框内“遗漏点”或上下文外的点使审查无效，
在修补前停止，不把矛盾改判 complete，也不自动扩框。有效 clipped/uncertain 仍阻断。
离线编译、冻结及显式修订复核同一绑定；历史无此字段的存储 schema 保留原判据。
该合同仅约束已聚焦的小素材边界记录，不保证所有视觉漏检或自由 geometry issue 均被消除；
不增加调用、不改变会话或最终图层合同，不重审旧失败作业。

### 外扩局部生成参考

新 `run` 和内部规划初始化默认 `--generation-reference context-crops`，可显式选 `full`。
旧配置没有该字段时仍按 `full` 解释；`freeze-reviewed` 缺省继承源模式，低层编译/冻结缺省不变。
局部参考模式冻结原图、外扩裁片、局部目标位置与素材/单元格顺序，预检从原图重建核对；
目标素材 bbox、输出尺寸和回拼坐标不因扩图而改变，原 bbox 裁片继续用于审查。
背景仍使用整图；局部合板最多四份，独立图层身份不合并。生成提示词由程序从已复审
计划编译，保留带辅助框对象的外观描述，不增加模型分组或提示词改写调用。
既有质量门、Codex CLI session 与单次冻结摘要授权规则不变。新冻结作业不接受参考或
提示词覆盖，不能借此转换旧快照、提升旧失败状态或自动重投。
内部请求增加参考证据，采用此选项的宿主需按冻结顺序传递全部图片；CLI/status 的既有
含义及最终 `ui_layer_composition_v1` 不变。离线验证不证明生成保真或视觉验收。
完整规则见 [局部参考合同](CONTEXT-REFERENCES.md)。

规划框与其 `artworkPixelSize` 描述原素材区域，不等于生成 PNG 画布或实测 alpha 主体。
外扩参考框只提供上下文；生成后主体测量和最终放置变换应分别核验，不能把透明留白
撑满规划框来证明比例正确。原图不透明时，颜色阈值只能作为有适用范围的诊断证据，
不能把单样本颜色判据固化为通用分割，也不能自动改框或跳过视觉审查。

显式 policy=deferred-visual-candidate-plan-v1 的候选纹理快照现在也可派生
`sheet-layout-board`，原严格纹理快照仍返回 VISUAL_TEXTURE_VARIANTS_UNSUPPORTED。
仅单张已冻结 sheet、单个新 job、一次独立授权调用；不能覆盖 prompt 或复用旧授权重投。
程序读取已验证的纹理输入与来源绑定，每项所选素材的纹理 sourceBox 必须完全位于该素材
context cropRegion 中，再按整数比例与 boardCropBox 唯一映射到 boardBoxNorm。
metadata 绑定原 reference SHA-256、visualTexturesSha256、visualTextureBindingsSha256、
regionId/materialId/objectId、原 sourceBox 与映射像素/归一化框；只输出所选素材已绑定的区域。
ownership actions v2 之后附加这些纹理的整板归一化定位与数量、布局、墨迹保真要求，
沿用已许可 preserveText，删除其他普通业务文字，不猜 OCR 字串、不借原 context 坐标作为整板定位。
新 M2/纹理视觉审查仍未执行；这不宣称旧或新素材通过视觉验收。
build/verify 重演完整 metadata、PNG 与 prompt canonical bytes；绑定、原裁片或映射被修改时拒绝，
即使重新计算存储摘要也不能替代原来源像素/区域和确定性映射。准备/核验均无模型或媒体调用。

内部独立交换可显式从该快照派生一份 `sheet-layout-board` 单板实验作业：程序统一比例
排列原裁片，编译板上坐标和编辑要求，并绑定新作业摘要；不接受任意提示词覆盖。
这是新授权的独立输入实验，父快照、旧失败状态、最终素材尺寸和审查门保持不变。
不增加公开 run 参数或 Docker/Web 接口，见[布局参考板合同](SHEET-LAYOUT-REFERENCE.md)。

新准备的参考板作业使用逐格 KEEP／REMOVE／AFTER REMOVAL 提示词 v2：几何保留仅作用于
自有图形，移除动作优先，外来素材的对象级说明和文字例外完整传递。旧 descriptor 未带
promptVersion 时逐字重建 v1；新 descriptor 绑定 v2，重验拒绝改版或重哈希后的指令替换。
板像素、分组、目标尺寸和已有 context 提示词版本不变，离线通过不能代表生图执行正确。

## CLI 操作

### 已有候选包的离线图层修订

`revise-package --selection SELECTION.json --output NEW_DIR --viewer VIEWER`
绑定既有标准 ZIP 的精确摘要，仅替换由真实回执重放的 support 前景层。
原包须通过 PNG、alpha、摘要和原预览逐像素重拼；未替换层的字节、身份、顺序及坐标
保持不变，原 review 问题完整继承。替换坐标只取自核验后的支持画布报告，不接受手填。
结果为 `candidate_revision_pending_visual_review`，只声明替换层回执重放，
`sourceReceiptReplayPassed=false`；旧层是 package-derived 来源，不升级其生成谱系。
生图/模型均零，不恢复旧作业或声明新自动链路通过。见 [候选包修订合同](PACKAGE-REVISION.md)。

### 已冻结规划的显式裁框拒收修订

`revise-frozen-crops --planning-run PARENT_PLANNING --rejection REJECTION.json --output NEW_DIR`
执行新作业的一次局部修补和一次完整候选复审，最多 2 次模型调用、生图 0 次。
该命令可能调用外部模型，宿主必须先取得绑定父摘要、拒收文件、当前固定运行时与调用上限的
新授权；它不是离线 `plan`/`inspect`，也不沿用父作业或诊断审查的授权。

拒收文件为 `ui_frozen_crop_rejection_v1`，包含精确的 `parentSnapshotDigest`、
`referenceSha256` 和非空 `findings`；每项只含已有前景素材 `materialId` 与非空
`sourceEvidence` 原图观察。不得重复 ID、选择背景、传入外来 ID 或伪称提供方 M2 记录。
文件是显式反馈，不能证明观察一定正确，仍须模型从完整原图核查。

父规划须通过其绑定输入、完成回执、选中候选/复审及冻结快照重验。父证据只读；
输出目录必须独立且不存在，不能删除父 frozen、伪造旧 blocker、改旧终态或恢复旧会话。
新作业保存完整父候选、原复审与拒收文件及其摘要，从修补启动新持久 Codex CLI session，
复审沿用这个新 session。父代码版本可不同，但父数据与冻结格式须能只读核验；新作业
绑定当前运行时和模型设置，不能把父运行时配置静默改成当前版本。

补丁只能改变选中素材的 `bboxNorm`，且必须有实际裁框变更。ID、数量、标签、归属、
对象辅助框、层级、状态、适配与文字策略均不允许改变；不能删除或新增记录。
范围或关系不合法即停止。完整复审沿用全部覆盖、描述一致性、轮廓与不确定性质量门，
并核销明确的拒收反馈；任何未解决问题、重复阻断、传输失败或回执不确定都停止，
不追加修补或自动重投。不得把顶层 issues=[] 当成忽略派生问题的依据。

只有新复审及冻结重验通过才生成新快照；继承父生成模式、参考模式、裁片提示词版本与请求预算，
重新计算布局、尺寸、坐标与摘要。新冻结仍不是人工视觉验收，也不授权生图。
父终态保持不变；既有失败规划的 `revise_plan` 行为与最终 composition 合同不变。
不增加 Docker/Web 或发布流程。

### 显式背景编辑区域

可选离线命令 `freeze-background-region` 冻结原图、二值许可区、连续混合权重及其摘要；
`inspect-background-region` 只读重验；`apply-background-region` 将同尺寸不透明候选应用到
许可区，保护区逐像素保持不变。区域由调用方明确提供，不从素材 bbox 推断真实遮挡。
无新模型、生图、自动扩边/羽化/调色、定位或打包，不改变旧 DAG 或质量门。
候选仅为 `candidate_pending_visual_review`，仍需检查接缝、范围覆盖、残留 UI/阴影及背景连续性。
详细参数与证据见 [背景区域合同](BACKGROUND-REGIONS.md)。现有命令、状态和 composition v1 不变；
Docker/Web 无强制迁移，采用可选命令的宿主须区别候选与交付，不将离线图像输入冒称生图回执。

### 单素材生成后的审查门

新 `single` 任务收齐回执后，在 `raw_complete` 节点内先对全部原始素材做技术检查，
再逐份调用既有只读前景审查器；每份最多一次，首个阻断、无效响应或传输失败即停止。
审查针对原始前景，发生在冻结适配、定位和打包之前；适配不会豁免原始图的审查阻断。
近景附件同时展示原图裁片、原始生成前景和确定性目标尺寸处理图，以区分生成差异与缩放造成的纹理变化；
目标尺寸图仅作审查证据，不改变原始前景门禁或补造缺失像素。
背景只经过技术检查，本门不等于背景或最终整图视觉验收。`sheets` 保持既有合板审查路径。

有阻断或审查未完成时，不创建定位输入或交付包，状态为 `stopped_no_retry`；
恢复不会重发已开始的审查。成功的审查及附件受节点摘要保护，后续篡改会拒绝恢复。
轻微告警带素材 ID 与审查 SHA-256 进入包内 review.json，仍不表示人工视觉验收。
状态可附加 `materialReview`（状态、调用数、逐素材结果、告警和审查范围）。
此门最多新增“前景素材数”次只读模型调用；`--max-calls` 仍仅限制生图请求。
公开节点名、CLI 参数、composition v1 及待验收语义不变。

不导入先前独立审查结果，也不修改旧任务；运行时摘要不同仍要求旧任务使用原固定版本。
显式 `finish-variants` 的待验收恢复路径保持独立，不调用模型或将严格 DAG 阻断改为成功。

`finish-variants --selection SELECTION.json --output NEW_DIR --viewer VIEWER`
可从多份已接收的素材变体逐层重放回执、合板裁切、适配和处理，再与显式候选回拼逐像素比对并打包。
也可传 `--snapshot SNAPSHOT --preview PREVIEW --jobs-root JOBS_DIR` 代替 `--selection`，按指纹自动发现唯一来源；找不到或多重匹配即停止。可选 `--issues-file FILE.json` 保存已知视觉差异。
完整生图作业可直接使用 `--received-job JOB --job-digest DIGEST` 代替上述两种输入：
程序核验全部回执，确定性切出合板格位并执行冻结的适配策略，生成完整预览，
仅在每份素材的技术处理通过后自动发现来源、逐像素重放并打包。此模式不调用视觉模型，
因此即使已有严格 DAG 视觉审查阻断，产物也只供用户验收；原阻断记录保持不变。
只读模型/生图调用均为零；结果仍是 `review-required`，不更改原 DAG 状态或宣称视觉通过。
输入和边界见 [变体恢复合同](REVIEW-REQUIRED-VARIANTS.md)。现有动作、状态与
`ui_layer_composition_v1` 不变；Docker/Web 消费端无需迁移，若开放本可选动作则需保存独立结果并展示待验收状态。

`adjust-opacity --source PNG --source-sha256 SHA --opacity FACTOR --reason TEXT --output NEW_DIR`
显式调整单张独立图层的整体 Alpha（0 < FACTOR <= 1），不裁切、缩放或绘制。
保留原始字节与变换摘要，结果为待视觉验收的修正 PNG，不提升旧 DAG 或失败门禁。
详见 [整体透明度修正](OPACITY-CORRECTION.md)。现有 composition 和消费端无需迁移。

`finish-received --received-job JOB --job-digest DIGEST --output NEW_DIR --viewer VIEWER`
为已收齐的独立生图作业接续后处理。它校验完整回执与冻结输入，依次运行现有
素材板检查/提取、适配、定位和打包；可能调用已授权的视觉模型，不生成图片。
输出必须为新目录，失败即停止并写 result.json，不支持原地重试，不改写父 DAG。
宿主须区分此显式恢复与原 DAG 自动完成；成功仍为 delivered_pending_visual_review。
原 CLI、状态和 composition v1 不变；Docker/Web 无强制迁移，使用新入口的宿主
需保存独立恢复结果，不能把它送入旧 DAG 的 resume/status。

`finish-bundle --snapshot SNAPSHOT --snapshot-digest DIGEST --received-source ASSET=JOB`
（每份请求重复 `--received-source`）`--output NEW_DIR --viewer VIEWER` 是可选的多作业恢复入口。
仅接受重新冻结为逐素材请求的快照；逐项严格核对旧作业的原图、裁片、请求字段、
提示词、授权、回执和原始 PNG，并将完整已收件集合复制到新目录。随后走相同的
确定性提取、适配、技术门禁、自动定位和 composition v1 打包；不会补造回执或重生图。
若某份素材使用单图提示词变体，必须额外传
`--accepted-prompt-variant ASSET=SHA256` 明确列出该作业中已授权变体的指纹；
程序仍要求同一冻结快照、相同请求和参考图、精确模型调用提示词审计、原始图指纹与回执。
未列出的变体或列出但未使用的变体均阻断；输出单独记录冻结提示词与变体提示词指纹，
不能冒充默认提示词收件。此选项只影响来源绑定，不放宽素材或打包质量门。
对于一份明确授权的单素材 `crop-only` 变体，恢复入口还要求来源作业只选中这一素材、
来源快照与目标快照摘要相同，并从实际工具请求核验唯一参考路径就是冻结的原始裁片、
提示词与提交摘要一致、零自动重试及单次调用审计通过。来源记录写入参考模式和裁片指纹。
其他参考模式仍按原有条件处理；合板请求不使用此单素材例外。
失败在新目录留存阻断结果，成功仍为 `delivered_pending_visual_review`，不提升旧 DAG
状态或代表用户视觉验收。CLI 仅增加可选动作，旧命令及 composition v1 不变；
Docker/Web 无强制迁移，采用此入口的宿主需展示独立恢复状态、来源作业和显式变体指纹。

`freeze-reviewed --planning-run COMPLETED_PLANNING_DIR --output NEW_SNAPSHOT --max-calls N`
是可选离线恢复入口：已完成的模型规划/复审通过，但冻结容量不足时，校验配置、输入、
已完成节点输出、模型回执与修补谱系，沿用原 generationMode，在独立新目录重新冻结。
若明确传 `--regroup-generation-mode single|sheets`，可从同一份已复审素材规划重新编译
生图请求布局，例如把合板素材改为逐素材请求；这是全新快照和摘要，不复用旧授权、回执或
审查结果。`max-calls` 必须覆盖新布局的全部请求，之后仍可只选其中一份做独立实验。
不调用模型或生成服务，不改写原 DAG 状态，不授予生图权限；仍拒绝有未解决问题的复审。
它以当前代码创建新快照，不是跨运行时恢复旧任务；输出 originalDagPromoted=false。
旧 CLI 和 composition v1 不变，Docker/Web 无必需迁移，采用此可选入口的宿主需区分
生图请求容量 max-calls 与模型调用次数，且不得把恢复快照当作旧 DAG 自动跑通。

以下参数均加在 `ui_layer.py` 后：

| 操作 | 额外参数 | 含义 |
| --- | --- | --- |
| status | --output RUN | 读取状态，不推测成功 |
| resume | --output RUN | 继续尚未执行节点；不自动重试不确定请求 |
| authorize | --output RUN --job-digest DIGEST --approval TEXT | 记录用户对冻结摘要的真实授权 |
| authorize-body | --output RUN --job-digest DIGEST --approval TEXT | 记录实际素材主体观察 job 的单次授权，不复用生图摘要 |
| next | --output RUN | 预留一次请求，返回 asset、submissionDigest、arguments |
| receive | --output RUN --submission-digest DIGEST --source PNG | 校验并接收真实生图结果 |
| fail | --output RUN --submission-digest DIGEST --reason TEXT | 记录失败或不确定结果，禁止自动重发 |
| preview-groups | --snapshot SNAPSHOT --snapshot-digest DIGEST --output NEW_DIR | 只读验证旧快照并预览分组；无模型/生图，不可授权派发 |

`arguments.prompt`、`arguments.referenced_image_paths` 是宿主生图输入。
宿主自行映射提供商参数，保留原提示词和参考图；路径是执行环境本地路径，不直接发给 Web。
每个 next 后必须有对应 receive/fail；响应丢失时先查状态，不再次 next/重新生图。
可选本地 Codex CLI 生图适配器把 `next` 参数编成有摘要的只读数据，经本次调用的
stdio MCP 工具和固定 JavaScript 直接传给内置生图工具，模型不重抄提示词。
接收前核验原冻结来源、参数文件、单次读取记录、转发代码、参考数量及透明度模式；
读取或转发失败不能降级为文本重抄、自动重投或提升旧失败记录。
该工具只读取当前预留请求，不接受路径或覆盖参数，不联网、不生成媒体；
用户/项目配置和登录方式不变。旧会话保留原字面量回执核验，新适配器仍需真实作业验证。
素材板请求的 asset 是请求 ID，附加 materialIds/grid；宿主仍原样提交 arguments，
不能把该 ID 当最终图层 ID。授权 maximumCalls 是请求数，status 的 materialCount 是素材数。
素材板回执接收后，resume 在 raw_complete 节点逐板执行只读语义核对与确定性提取，
再执行原有 registration/package；需要宿主允许对应 Codex CLI 调用。extraction 字段报告该阶段结果。
读取状态不能凭空判定远端已失败或安全重试。

## 状态

status 响应 kind=`ui_delivery_dag_status_v1`，包含 status、target、nodes、nodeSeconds、
failures、automaticRetries=0、humanVisualAcceptance=false。planning/generation/package 按阶段出现。
这是预览状态合同：消费端应忽略未知附加字段，遇到未知状态停止自动推进并显示诊断。

| status | 宿主动作 |
| --- | --- |
| incomplete | 展示阶段；无运行进程且没有不确定调用时可 resume |
| frozen | 仅规划目标完成 |
| awaiting_authorization | 展示 generation.jobDigest 和 maximumCalls，等待用户授权 |
| awaiting_body_authorization | 展示 bodyObservation.jobDigest、maximumCalls 和冻结输入，取得对应授权后 resume |
| ready | 可 next 取一份生图请求 |
| awaiting_result | 已预留请求，等待对应结果；不可重新派发 |
| raw_complete | 可 resume 进入定位与打包 |
| blocked_no_resubmit / stopped_no_retry | 展示失败，等待明确的新处理决定 |
| delivered_pending_visual_review | 技术交付完成，等待用户视觉验收 |
| stopped（错误响应） | 命令退出非零；保留 reason，不能当成功 |

interrupted_or_running 节点不能仅靠文件判断是否仍有进程；进程生命周期由服务掌握。
正在运行的同一任务不能并发 resume。运行时或输入指纹变化将拒绝继续。

## 图层交付（Web/Pixi 消费边界）

成功输出 `RUN/delivery/ui-layers.zip`；`package-result.json` 为宿主记录。
ZIP 中包含 composition.json、manifest.json、review.json、reference.png、preview.png、
layers/*.png、viewer.html、viewer.js、README.txt。仅相对路径，无私有 session/凭证。

composition.schema 位于 `../../ui-decomposition-harness/planning-harness/schemas/layer-composition.schema.json`。
kind=`ui_layer_composition_v1`；画布单位为原图像素；原点左上；layers 数组从后向前。
每层 id/name/role/path/x/y/width/height/visible；PNG 已是实际归位尺寸，不再按 bbox 猜测缩放。
textPolicy/backgroundMode 显式给出。用户上传的业务文字默认去除，不保证可编辑文字层。
manifest 校验字节数和 SHA-256；review 始终披露视觉待验收，不因校验通过而升级成视觉成功。
Web 应验证图层合同和资源摘要，不执行上传包内脚本；可复用本仓库构建的可信 Pixi 查看器。

## 服务端负责的映射

显式接受的变体素材可经独立离线入口接纳并打包，见 [ACCEPTED-MATERIALS.md](ACCEPTED-MATERIALS.md)。
该入口重放回执到PNG的确定性处理，并逐像素核对用户接受的预览；不改原DAG的失败状态。
输出仍为同一图层包合同，用户决定和私有溯源单独保存在包外，不要求现有最终包消费者迁移。

服务可以自定 taskId、上传和下载接口、进度通知及视觉验收 API；这些不是拆分核心字段。
保留核心版本、任务目录映射、冻结摘要、请求摘要和产物摘要；对 Web 隐藏本地路径及会话细节。
用户提出追加修正时新建绑定计划和授权，不手改旧回执/交付清单，不自动无限重生。


### Sheet visual review severity

New runtimes attach a third, fingerprint-bound review image: paired close-ups of
each frozen reference crop and received sheet cell. The built-in Codex CLI adapter
forwards all three images. A host that substitutes its own sheet-review model
adapter must forward this close-up as well and budget the larger review input;
otherwise it has not exercised the documented visual review. The sheet prompt
requires comparing each owned outer contour, corners, line weight and icon layout.
This changes internal model input and the runtime fingerprint for new jobs, not
the public CLI, status names or `ui_layer_composition_v1` package. Existing frozen
runs stay pinned to their prior runtime and cannot be resumed with these edits.

New sheet reviews separate blocking `issues` from structured `warnings`. Only
`minor-progress-deviation` (small fill differences without meaningful state change)
and `minor-style-deviation` (border/glow/brightness differences with artwork intact)
are advisory. Each warning carries material identity, evidence and an optional
correction suggestion; review fingerprints remain in extraction and package notes.
Missing/foreign/duplicate artwork, uncertain identity, clipping, lost decoration,
major geometry/text-space loss and meaningful state reversal still block. There is
no universal fill-percentage tolerance; visual estimates are not measurements.

Warnings continue to registration and packaging, never imply human acceptance and
never trigger automatic regeneration. Technical alpha, dimensions, identity,
receipt and fingerprint checks are unchanged. Legacy `issues` remain blocking;
old failed runs are not relabeled. A fresh explicit review uses the new policy.
CLI/status names and `ui_layer_composition_v1` remain compatible. DAG extraction
status gains additive `warnings`; package `review.json.issues` includes advisory
text and review hashes. No Docker/Web migration or deployment is introduced.


### Program-owned sheet severity (observation policy v1)

New live sheet responses use `materialIds` and structured `findings`; the model
reports category, observed states, magnitude, ownership, evidence and suggestion.
It cannot choose severity. The program writes fingerprint-bound `assessment.json`.
For static-composite, full/near-full differences are advisory in either direction;
other differing progress states or unknown states block. Within the same state,
only minor progress differences are advisory. Minor style differences are advisory;
identity, missing/extra artwork, clipping, geometry, layout and text-policy findings
remain blocking. Ambiguous ownership blocks with attribution
`planning-or-localization-unresolved`, never automatic generation blame.

This supersedes model-selected issues/warnings for new live sheet requests.
Legacy adapters retain conservative validation and their textual issues always
block; archived responses are not migrated or reclassified. Invalid categories,
foreign material IDs, state/category mismatches and model-supplied severity fail
closed. Visual observation itself can still be mistaken; this policy stabilizes
severity for identical structured facts, not perception accuracy. No retries or
new generation are triggered. DAG status adds `extraction.decisions`; prior status
names, package review notes, CLI and composition v1 remain compatible. Internal
model adapters must emit the new schema. Existing runtime-pinned runs require a
fresh explicit review, not an in-place resume under changed code.


### Bounded planning convergence

New planning prompts consistently limit `static-composite` to the current visible
appearance. State means observable selection marks, checks, highlights, fill and
control surfaces; screenshot evidence does not establish whether a click executes
business logic. Such unobservable behavior is not a visual-planning unknown.
Uncertainty about visible artwork, bounds, count, occlusion, ownership, layering or
explicitly requested output states still blocks. The unknowns and unresolved-issue
gates remain unchanged; historical unknowns and failed runs are not cleared.

Both repair rounds require one complete upsert record per material or object ID.
Changes from multiple findings must form that one complete record; there is no
first-record or last-record override. Duplicate IDs remain a program error. This
clarifies the existing array protocol, without introducing a keyed patch protocol,
automatic deduplication or another model call. These prompt changes alter the
runtime fingerprint for new runs only; existing pinned runs keep their original
prompts and cannot resume under this version.

New planning DAGs allow at most two local patch/review pairs (M1 + M2 + up to
four patch/review calls: six planning model calls total). The first pair keeps
`repair`, `repair_check`, `rereview`; an optional second pair uses `repair2`,
`repair_check2`, `rereview2`. New-run configs pin maximumRepairs=2. Never resume an
old runtime-pinned run with edited inputs/configs; previous four-call approval does
not authorize a six-call run. Transport failures/uncertain nodes remain terminal;
these bounded repairs are new calls for validated feedback, not request retries.

M2 scans ownership, contour, decoration, layout, appearance and state before
reporting. Rereviews receive previous findings and the complete current candidate.
A repeated blocking code + ID set stops immediately; a second unresolved rereview
stops regardless of code. Paraphrased contradictions are not reliably detected;
the fixed ceiling bounds them. Each patch is merged against its own source digest;
freeze verifies both chains and preserves both rounds' evidence.

When a planning review has small foreground-material crops, M2 and every
rereview receive paged, fingerprint-bound context/crop evidence for all of them.

Aligned small foreground-material groups also receive up to two continuous,
unmarked source-corridor boards. The corridor spans the complete source axis;
bounded overlapping segments retain gaps and source-axis ends rather than
stopping at the first or last planned crop. Only coordinate labels are drawn
outside source pixels. Metadata binds the reference, corridor, segments and
image digests; repair receives identical evidence bytes. Geometry chooses
context, not visible-instance count or ownership, and cannot detect arbitrary
unplanned groups. Existing coverage review must still check all visible units.
These boards add review image input without new prompt rules, response fields,
model calls, generation permission or gate exemptions. Old immutable runs
continue to require their original runtime.

Eligible crops are ordered by ascending original-pixel area (plan order breaks
ties), so early larger slot faces cannot displace smaller artwork from the
bounded detailed review. The first 12 receive component and boundary audits; every remaining small crop
receives a boundary-only audit rather than silently dropping out of review.
New M2/rereview responses use objects keyed by the exact required material IDs
for `smallMaterialAudit` and `smallBoundaryAudit`. The attached schema requires
each key and forbids extra keys; values contain component/boundary evidence,
without another `materialId`. Shared `$defs`/`$ref` entries avoid repeating the
full evidence schema for every key. Duplicate JSON keys fail parsing. Missing, extra
or colliding IDs cannot be filled, removed or inferred to repair a response.
Existing array records remain readable by the review policy with their duplicate
and quote gates intact, but new model responses must satisfy the keyed schema.
Raw responses and receipts remain unchanged; programs derive the same blockers
directly from either evidence format. Pinned historical runs require their
original runtime and cannot resume or inherit authorization under this change.
Each detailed visible component records a literal quote from its owning material
or object description, or an empty quote and a local correction. Missing or
nonmatching quotes become semantic repair blockers. This is internal planning
evidence; it does not alter the public CLI, status names, or
`ui_layer_composition_v1` package format.
Repair routing and freeze re-evaluate those quotes against the exact reviewed
plan, including each repaired candidate. Repeated-finding checks use the prior
review's own plan. Explicit child revisions apply the same derived blockers to
parent eligibility, permitted patch scope and final freeze; an empty top-level
`issues` list cannot override an unmatched small-material quote.
The component observation includes visible shape, color, pale highlights, dark
pixel details and surface marks before the reviewer assigns an object name.
These local light and dark details must not be reduced to a main-color label.
A color-diverse crop among the first 12
detailed small materials is attached once more as a deterministic enlarged
original-image detail. If none meets the color threshold, the smallest crop is
used so gray or pale pixel marks still get a close-up. This one detail image uses
unmarked original context rather than the candidate crop, retaining source pixels
outside an incorrect bound and under the contact sheet's diagnostic line. Its
`sourceBox` and separate `candidateBox` use original pixel coordinates and are
bound with the image digest. Context pixels do not change ownership; no bounds
are expanded automatically. It is review evidence, never a generated layer or
program-drawn replacement. No additional image or model call is added.
Without the explicit bound-reference policy above, for each observed small part,
a nonempty `planEvidenceQuote` must cover its
distinctive visible colors, highlights and marks, not merely name the overall part. An
incomplete quote is reported as a missing-description finding for the existing
bounded repair path; the program still checks only exact quote presence, so
the model's semantic judgment remains subject to visual review.

New small-material evidence pairs unmarked expanded original context with the
candidate crop at its original offset in an equally fitted coordinate viewport.
The crop viewport's neutral surround is diagnostic, not source pixels or alpha;
no boundary line overwrites the context, including the first excluded row/column.
Metadata binds both display boxes and their common source viewport; crop bounds
are half-open and remain unchanged. Nearby pixels do not change ownership, and
the bounded 768x384 cells use integer nearest-neighbor scaling when context fits,
otherwise a reduced fit can lose fine pixels and does not prove completeness. This applies to every small
material, including boundary-only overflow pages; the extra detail choice and
image/call counts are unchanged. Historical evidence is not rewritten. Internal
adapters must return `boundary.status` as
`complete|clipped|uncertain` and nonempty `boundary.evidence` for each small
material, including boundary-only overflow pages. Clipped or uncertain owned contours produce geometry blockers in the
same bounded repair path. No bounds are automatically changed. This changes the
runtime fingerprint for new runs only, not public CLI/status/composition fields.
Additional pages increase review image input but do not add planning calls.

M1, review and repair share the same object-locator scope: material bounds own
crop, size and placement; object bounds are optional auxiliary locators, defaulting
to null. The two mandatory cases are separate controls within one material and
integrated retained icons beside removed text within that same control material.
An independently separated icon does not require an extra object box merely
because external text is adjacent; any other location ambiguity needs original-image
evidence. Required internal locators remain required, and provided boxes must cover
their full referenced artwork within the owner. No geometry issue is automatically
ignored or downgraded because a box is null. Historical evidence is unchanged.

Review and repair prompts distinguish axis-aligned graphic envelopes from text
removal masks. Ordinary glyphs in unavoidable gaps inside a correct material or
auxiliary-object envelope alone do not justify shrinking it and clipping artwork.
Avoidable bounds expanded by external labels still need correction, and required
internal locators must not be cleared to evade review. Actual text removal and
complete contours still require post-generation review or visual acceptance.
This clarifies planning evidence; no blocker code, severity or repair limit changes.

Under the historical policy, planning category `cosmetic` is advisory only with code `MINOR_COLOR_TONE` or
`DESCRIPTION_WORDING`. Unknown cosmetic codes fail closed. Missing/duplicate
artwork, ownership/state changes, substantial wrong colors and clipping remain
semantic/geometry blockers. Structural issues and unknowns remain blockers.
Legacy semantic/geometry responses remain conservative. The model still owns
observation accuracy; classifying a serious defect as cosmetic is not made safe
by a code alone and remains a real-world validation risk.
An explicit `minorColor=strict` policy retains `MINOR_COLOR_TONE` as a blocker;
it does not reinterpret archived warnings.

The final warning list and review hash are frozen in planning-warnings.json and
included in package review notes. No human acceptance is inferred. CLI action and
status names and composition v1 are unchanged. Consumers must tolerate additive
planning nodes, reviewWarnings and the optional frozen evidence file, accept the
new review category in internal adapters, and explicitly budget up to six planning
calls for new runs. No Docker/Web code or deployment is introduced.

## Actual received output: independent host review

The public CLI also supports a separate material exchange. It never launches Codex
CLI or a model and does not resume, upgrade or modify the planning runtime or the
received image job. A frozen host planning snapshot from an older runtime can be
inspected and consumed as immutable evidence; each new output review binds its
own installed runtime fingerprints. Freeze that new runtime before preparing
reviews. Changing it requires a new authorized scope, not replay of a failed call.

```
python game-ui-harnesses/ui-layer-harness/ui_layer.py prepare-output-review --received-job JOB --request-id ID --output NEW_REVIEW --material-author AUTHOR --review-registry REGISTRY
python game-ui-harnesses/ui-layer-harness/ui_layer.py receive-output-review --output NEW_REVIEW --response EXTERNAL.json --request-sha256 REQUEST_SHA --response-sha256 RESPONSE_SHA --host-attestation ATTESTATION.json --dispatch-evidence DISPATCH_FILE --return-evidence RETURN_FILE
python game-ui-harnesses/ui-layer-harness/ui_layer.py extract-reviewed-output --snapshot FROZEN --snapshot-digest SNAPSHOT_SHA --review-run REVIEW_1 --review-run REVIEW_2 --output NEW_EXTRACTION
python game-ui-harnesses/ui-layer-harness/ui_layer.py package-reviewed-output --extraction NEW_EXTRACTION --preview SUPPORT_PREVIEW --viewer BUILT_VIEWER --output NEW_PACKAGE
```

Repeat `--material-author` for all actual generated-material authors. Opaque author
and reviewer identities are explicit host declarations. The independent reviewer
must differ from every author. The host freezes one shared `--review-registry` for
this authorized received-job scope; exclusive reservation binds job, request and
submission identity before preparation. A reserved request cannot be prepared
again in that registry, including after interruption or failure. This enforces
single use within that registry; it does not prove global uniqueness across copied
registries. Hosts must not change registries to evade a failed review.

Host preparation accepts an explicitly selected `raw_received` request before
the rest of its batch has been generated. Review it and stop on any blocker
before requesting the next image; a later request adds its own immutable files
and does not change the already bound review evidence. The historical CLI
material review retains its complete-batch `raw_complete` prerequisite.

Preparation validates the real experimental executor receipt/submission/
authorization chain, frozen source, PNG dimensions and alpha. Single materials use
the existing deterministic material gate, original reference crop, actual raw PNG
and raw/processed comparison. Sheets reuse alpha preparation, actual-gap cuts,
empty placeholder and unclipped cell gates, explicit frame adaptation and the
existing original/cell detail comparison and complete prompt. Owned artwork,
foreign exclusions, exact preserved text and protected visual textures retain
all existing rules. All prepared files, original producer files, actual ordered
material IDs, policy schema and reservation are hashed. Preparation makes zero
model calls. Each host dispatch has a one-call maximum and no automatic retry.

The external attestation must contain exactly:
`kind: ui_host_output_review_attestation_v1`, `requestSha256`, `responseSha256`,
`rawSha256`, `submissionDigest`, `materialAuthors`, `reviewerId`,
`hostAssertedModelResponse: true`, `notProviderReceipt: true`,
`notCryptographicallyPlatformVerified: true`, `dispatchEvidenceSha256`,
`returnEvidenceSha256`. Digests must match the prepared request, raw receipt,
response and actual host dispatch/return observation files; dispatch and return
must differ. Response and evidence files must be outside the review directory.
Receive seals their original bytes before JSON/schema/provenance validation.
Duplicate JSON keys, incorrect IDs/order, invalid schema or assertion failures are
terminal `indeterminate_review_no_retry`; repeat receive is forbidden. Findings
are classified by the same existing severity policy; visual blockers remain
`blocked_no_retry`. A passed review is only `reviewed_pending_visual_acceptance`,
with `modelCalls: 1`, `humanVisualAcceptance: false`. The sealed exchange says
`host-attested-model-response`, `notProviderReceipt: true` and
`notCryptographicallyPlatformVerified: true`; it has no CLI transport/events or
model-session assertion. These are content fingerprints and host declarations,
not authenticated platform receipts. Private host evidence is excluded from the
public PNG/ZIP package.

Extraction requires exactly one successful review for every frozen generation
request, preserving each raw/receipt identity and the complete material set.
It produces the existing `materials`, `adaptations`, `records`, `warnings` and
`decisions` fields, then runs the existing deterministic `adapt_materials` policy
internally. `rawMaterials` records extracted sources; `materials` contains the
actual final adapted PNGs, with all adapter files/reports and final PNG hashes
bound. No extra visual/model call occurs. Separate explicit body observations
must inspect these final PNGs and supply the existing body contract to
`register-materials` with `reference-body-support-v1`; this exchange does not
claim automatic CLI body observations. Pass its `preview` directory to packaging.
Packaging revalidates the complete review set and extraction, deterministically
recomputes adapter outputs for comparison, requires registration source hashes
to match the final reviewed/adapted PNGs and uses existing
`sources_from_preview`/`build` validation. The package remains pending human
visual acceptance. Arbitrary external processed PNGs, incomplete reviews or
hand-authored sources/manifests cannot be substituted through this route.
# Protected background observations deferred to final composite

New integrated `host-run` configurations may explicitly freeze
`generationMode="single"` to request one complete PNG per material. The default
remains `sheets`. The selected mode is bound before M1, carried through independent
M2 and deterministic freezing, and reported by host status. Single requests retain
context crops, ownership instructions, native-alpha checks, independent material
review, body observation and package validation. Their count equals the complete
material count and must fit the authorized image/review budgets. Switching modes
requires a fresh job and approval; it is not an automatic retry or a way to promote
a failed sheet extraction.

New `host-run` configurations may explicitly freeze
`backgroundVisualReviewPolicy="record-until-final-composite-v1"` only with a
verified `backgroundRegion` / `backgroundRegionDigest` and
`backgroundPolicy="exact-source-canvas-protected-region-v1"`. The default remains
strict. Only the bound background request receives this policy. Foreground
observations and the real body observation stage retain their existing gates.

The independent background reviewer still reports actual findings and complete
owned/foreign observations, including missing, present and uncertain states.
Schema, exact ownership coverage, receipt/source hashes, native alpha, protected
pixel replay, extraction, geometry and package checks remain mandatory. The
program first performs the original classification, preserves blocking decisions
and ownership observations, then records their unresolved visual disposition in
`deferredVisualFindings`. The explicit review status is
`background_observed_pending_final_composite`, never a passed visual review.
Warnings carry the complete structured evidence and review SHA through extraction
and into the final package's `review.json`. Host status exposes
`deferredBackgroundVisualReview=true` and
`finalCompositeVisualAcceptancePending=true`; inspect the full original/material/
composite comparison before judging visible duplicates or omissions. A technical
package completion does not settle these observations or assert human acceptance.

This opt-in may additionally supply both `reviewedSnapshot` and
`reviewedSnapshotDigest`. This reuses only an exact formally frozen, independently
reviewed planning snapshot (`planningDriver=host-model-exchange-v1`, normal
`visual-plan-v5-experiment-v1` policy, sheets/context-crops/v7 or v8, retaining the exact selected version). Full M2 evidence,
current deterministic preflight, the source seed/reference and optional visual,
texture/reuse inputs, region digest and all downstream capacities are reverified.
`planningNotes` is forbidden in this mode. Only the snapshot's bound file allowlist
and `snapshot.json` are copied to a fresh run and reverified; no source host state,
image authorization, reservation, raw image or receipt is imported. The new image
job requires its own fresh authorization. Status honestly declares
`planningMode=verified-prior-independent-host-review`,
`newM2ReviewPerformed=false`, and `m1ModelExecuted=false`; config records the prior
snapshot digest and actual M2 response SHA. Deferred candidate plans, altered
snapshots, unreviewed plans and changed input scopes are rejected. Existing failed
runs and reviews remain terminal and sealed; this does not authorize historical
raw-image receipt repair or new receipts for old provider calls.
# Optional received-source diagnostic export

`prepare-received-diagnostic` and `deliver-received-diagnostic` produce an
independent, zero-compute `diagnostic-pending-human-review` artifact from genuine
received sources. They preserve unresolved extraction findings and every original
pixel in separate source evidence; they never change the existing strict/candidate
gates or promote a failed host DAG. See [the diagnostic delivery contract](RECEIVED-DIAGNOSTIC-DELIVERY.md).

Before recommending a candidate replacement for an existing accepted delivery,
compare its complete structure and final viewport with that selected baseline.
The optional local `compare-package-baseline` command binds both archive hashes
and reports cross-version differences; see [the baseline audit contract](PACKAGE-BASELINE-AUDIT.md).
The accepted package remains the recommended delivery while replacement visual
acceptance is pending. Local cleanup or package integrity alone does not promote
a candidate or preserve prior wordmark/component-split approvals automatically.
