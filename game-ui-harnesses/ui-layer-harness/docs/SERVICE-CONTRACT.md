# UI layer host contract v1 (preview)

唯一公开入口：`python game-ui-harnesses/ui-layer-harness/ui_layer.py`。
每次命令 stdout 输出一个 JSON（`--help`/`--version` 除外），过程信息写 stderr。
退出码 0 表示命令完成或正常等待，不等于视觉通过；非零表示本次命令失败。
不直接调用内部 Python 函数，内部 M1/M2 文件不作为 Web 合同。

## 输入与任务寿命

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
可选 `--generation-mode single|sheets`（默认 single）；sheets 下 N 为生图请求上限，
一张板只算一次请求，最终素材数可更多。只用于新任务，不能修改旧任务模式。
详见 [素材板合同](GENERATION-SHEETS.md)。
新 run 可选 `--planning-notes UTF8_FILE`（非空、最多 16 KiB），传入用户确认的拆分约束。
内容按字节快照并绑定输入摘要，传入 M1、M2、修补及复审，不作为模型观察结论或质量豁免。
旧作业不能追加或修改；不改变 CLI 默认行为、状态或最终 composition 合同。
Docker/Web 宿主若使用此可选能力，须提供用户确认的 UTF-8 文件；本仓库不实现宿主改造。
run/resume 可执行模型调用；status 为只读。模型网络授权及服务访问权限由宿主负责。
内部 M2/复审在大素材的装饰辅助框贴近裁切边时附带有原图坐标与摘要的局部对照图；
这些诊断图只供视觉检查，不进入生图参考或公开 composition，CLI/状态字段不变。
新规划的 M2/复审还须逐区提交九宫格可见图形覆盖审查。标为“原图可见、计划未描述”的图形
由程序转为 semantic 阻断并进入原有最多两轮局部修补；小前景素材附一张有摘要的原图
放大对照，供检查附属细节。缺失覆盖审查记录不能冻结；复审仍检查完整候选。
这提高漏项检出可审计性，但模型若连原图图形也未观察到，结构化记录不能证明绝对无漏项。
仅影响新任务的内部模型输入/输出；CLI、状态名及 `ui_layer_composition_v1` 不变，
Docker/Web 无迁移要求。既有运行受运行时指纹保护，不在原目录用新代码续跑。

## CLI 操作

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
| next | --output RUN | 预留一次请求，返回 asset、submissionDigest、arguments |
| receive | --output RUN --submission-digest DIGEST --source PNG | 校验并接收真实生图结果 |
| fail | --output RUN --submission-digest DIGEST --reason TEXT | 记录失败或不确定结果，禁止自动重发 |
| preview-groups | --snapshot SNAPSHOT --snapshot-digest DIGEST --output NEW_DIR | 只读验证旧快照并预览分组；无模型/生图，不可授权派发 |

`arguments.prompt`、`arguments.referenced_image_paths` 是宿主生图输入。
宿主自行映射提供商参数，保留原提示词和参考图；路径是执行环境本地路径，不直接发给 Web。
每个 next 后必须有对应 receive/fail；响应丢失时先查状态，不再次 next/重新生图。
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
rereview must audit each listed material separately. Each visible component
records a literal quote from its owning material or object description, or an
empty quote and a local correction. Missing or nonmatching quotes become
semantic repair blockers. This is internal planning evidence; it does not alter
the public CLI, status names, or `ui_layer_composition_v1` package format.
Repair routing and freeze re-evaluate those quotes against the exact reviewed
plan, including each repaired candidate. Repeated-finding checks use the prior
review's own plan. Explicit child revisions apply the same derived blockers to
parent eligibility, permitted patch scope and final freeze; an empty top-level
`issues` list cannot override an unmatched small-material quote.
The component observation includes visible shape, color and surface marks before
the reviewer assigns an object name. A color-diverse small crop may be attached
once more as a deterministic enlarged original-image detail; it is review
evidence, never a generated layer or program-drawn replacement.

New small-material evidence pairs expanded original context with the unmarked
candidate crop. Its magenta boundary is diagnostic; nearby pixels do not change
ownership. Internal adapters must return `boundary.status` as
`complete|clipped|uncertain` and nonempty `boundary.evidence` for each audited
material. Clipped or uncertain owned contours produce geometry blockers in the
same bounded repair path. No bounds are automatically changed. This changes the
runtime fingerprint for new runs only, not public CLI/status/composition fields.

Planning category `cosmetic` is advisory only with code `MINOR_COLOR_TONE` or
`DESCRIPTION_WORDING`. Unknown cosmetic codes fail closed. Missing/duplicate
artwork, ownership/state changes, substantial wrong colors and clipping remain
semantic/geometry blockers. Structural issues and unknowns remain blockers.
Legacy semantic/geometry responses remain conservative. The model still owns
observation accuracy; classifying a serious defect as cosmetic is not made safe
by a code alone and remains a real-world validation risk.

The final warning list and review hash are frozen in planning-warnings.json and
included in package review notes. No human acceptance is inferred. CLI action and
status names and composition v1 are unchanged. Consumers must tolerate additive
planning nodes, reviewWarnings and the optional frozen evidence file, accept the
new review category in internal adapters, and explicitly budget up to six planning
calls for new runs. No Docker/Web code or deployment is introduced.
