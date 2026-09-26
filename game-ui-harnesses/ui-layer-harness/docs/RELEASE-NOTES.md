# Release notes

## Unreleased dense-plan and foreground extraction prompts

- Planning prompts now keep bounded material labels short and place distinct visible details in object records. M2 may accept coverage across those records, while its existing coverage audit and two-repair limit remain blocking. A landscape dialogue sample first stopped on repeated omissions and truncated 200-character labels; a fresh planning run reached M3 after two reviewed repairs, with no generation submitted.
- New background requests deduplicate object descriptions and omit redundant per-object coordinate JSON when the full reference is already the layout authority. Generic foreground panels preserve observed translucency in alpha. An illustration crop no longer implies that surrounding scene pixels belong to the illustration; owned painted interiors and frames remain eligible.
- Offline tests cover the free-standing portrait, translucent panel, and dense background prompt paths. Existing frozen requests and received media remain immutable; no tag is published.
- If the first local patch introduces a renderable structural issue, its report remains bound and the existing rereview and second-repair slots can correct it. The final patch and freeze still require zero structural issues; non-renderable plans, unresolved unknowns, and exhausted repair limits still stop.

## Unreleased singleton delivery review gate

- New single-mode delivery runs review each raw foreground after all raw technical checks and before adaptation, registration or packaging. The existing material reviewer and severity policy are reused; a blocker, invalid response, transport failure or interruption stops the DAG without automatic redispatch.
- Successful review evidence is bound by the raw_complete checkpoint. Minor warnings retain their material and review digest in the package; status adds materialReview. Background and final-composite visual acceptance remain outside this gate, and all deliveries still require visual acceptance.
- Offline regressions cover major visual blockers, transport failures, invalid identities, interruption, raw clipping before model calls, warning propagation, changed evidence and idempotent resume. Sheets, explicit review-required recovery, immutable old runs and generation approvals remain unchanged. No tag is published.

## Unreleased review transport path resolution

- Resolve the review evidence directory before invoking the read-only Codex adapter in its temporary working directory. Relative `review-material` output paths previously caused local schema loading to fail before model review; schema, image attachments and response paths now keep their intended location.
- An offline regression reproduces the failure with relative paths containing spaces, using the real command builder and a filesystem-only transport double. No prompt, severity, generation authorization or retry policy changes. Existing failed reviews and pinned runtimes are not rewritten or automatically rerun.

## Unreleased small-material boundary evidence

- A real portrait hero-selection run froze after one repair while its exit-symbol crop still omitted the top outline. M2 and rereview saw only an enlarged candidate crop in their local evidence and missed the clipping; no image generation was authorized.
- New small-material contact sheets pair an expanded original context (with a diagnostic candidate boundary) and the unmarked crop. Each review records boundary completeness and source evidence; clipped or uncertain owned contours become geometry blockers through the existing bounded repair path, even with no ordinary issues. The program does not assign new bounds or infer ownership from surrounding pixels.
- New internal review responses require the boundary observation. CLI/status/composition remain unchanged, generation prompts are unchanged, and existing pinned runs remain untouched. Diagnostic evidence does not guarantee that a model will detect every clipped contour.

## Unreleased plan-bound coverage routing

- Fix small-material audit findings with a nonempty quote absent from the owning plan: M2 already detected these, but repair routing and M3 rechecked them without the plan and could silently freeze. Routing, repeated-finding checks and final freeze now use the exact plan reviewed at each stage.
- Explicit child revisions use the same derived blockers for parent eligibility, local patch scope and final freeze. Repeated unresolved findings still stop, and new findings can use only the existing second repair; no extra calls or retries are added.
- Offline regression fixtures cover initial review, second repair, repeated failure, direct freeze and explicit child revision. This fixes enforcement, not the model's ability to observe every small detail. Public CLI/status/composition contracts are unchanged; old pinned runs and generation approvals remain unchanged. No tag is published.

## Unreleased complete singleton bundle recovery

- A single owned icon with no separate object box now uses a short extraction prompt for newly frozen requests; one composite icon with anchored decorative lettering uses the same prompt while naming the retained text. It identifies the reference region, asks to remove the panel/background and nearby labels, and avoids semantic object descriptions, ratio instructions, and long negative lists that encouraged redraw. Existing frozen requests and receipts stay immutable; prompt wording does not guarantee pixel-identical generation.
- Wormux local-play icon trials confirmed that both a short full-reference extraction prompt and a one-sentence crop-only prompt can still redraw a small icon. A nearest-neighbor enlargement of the 60×71 source corrected an initial human misreading of its gun-shaped tool: the crop-only result retains that tool category but changes facial, body, pose, and tool details. Treat the trials as visual-review candidates even when request, receipt, alpha, and extraction checks pass. Do not automatically promote sibling icons on the strength of prompt brevity or a cropped reference alone.
- A second isolated crop-only trial on the Wormux settings icon kept the hammer-and-wrench assembly and avoided the old raw output's broad dark halo, but still changed edge weight, highlights and soft shadow. This supports crop-only as a conditional small-icon reference experiment, not a general replacement for full references or visual acceptance.
- Add optional `finish-bundle` for a complete set of previously received single-material requests from multiple jobs. It requires a fresh frozen singleton snapshot and an explicit `ASSET=JOB` source for every request, then verifies exact request fields, original and crop images, prompts, approvals, receipts and raw hashes before processing.
- The command reuses existing deterministic extraction, adaptation, material gates, registration and package builder. Missing or changed sources stop before packaging; a failed stage writes an independent blocked result. It submits no image request, does not modify the original DAG, and leaves visual acceptance pending.
- Existing CLI actions, state names and `ui_layer_composition_v1` remain compatible. Docker/Web consumers have no required migration; hosts opting into this recovery action need to retain the source-job mapping and independent review-required status. No tag is published.
- An optional `--accepted-prompt-variant ASSET=SHA256` binds an explicitly authorized single-material prompt variant to the same frozen request. The variant must have an exact one-call audit and matching raw hash; default prompt identity remains required for every other material. The bundle records both prompt fingerprints and keeps all visual gates unchanged.
- The same recovery action can now accept one explicitly approved `crop-only` singleton variant. It requires the exact original crop in the recorded image-tool request, the same frozen snapshot, a one-asset job, an allowlisted prompt fingerprint, the original receipt and one-call audit. Mixed nine-layer Wormux recovery passed without image or model calls; the package remains pending full visual review. CLI syntax, states, and composition v1 are unchanged, so Docker/Web has no required migration.

## Unreleased M2 coverage audit

- New planning runs require a nine-region visual coverage record in M2 and each rereview. Artwork the model marks visible but absent from the material/object descriptions becomes a semantic blocker and enters the existing maximum-two-repair path even if the ordinary `issues` list is empty.
- Small planned foreground materials are shown in a bound enlarged reference contact sheet during review and repair so attached details can be examined without adding image-generation references. Missing coverage data or unresolved findings stop before freeze. This does not claim that a vision model can never overlook artwork.
- Internal model schema and evidence change for new runs only. The public CLI, status names and `ui_layer_composition_v1` remain compatible; Docker/Web consumers need no migration. Existing pinned runs cannot resume under changed runtime files.

## Unreleased received-variant recovery

- Add optional `finish-variants` to replay a complete selected set of previously received material variants from multiple jobs. It verifies submission/receipt/raw hashes, sheet cells, deterministic adaptations, processed materials, frozen layer order and exact candidate composite pixels before producing a review-required package.
- With `--snapshot`, `--preview` and `--jobs-root`, the same action discovers the unique exact source for each layer from verified received jobs, writes a bound selection, then finishes the package in one CLI invocation. Missing or ambiguous matches stop; no hand-authored per-layer source map is required.
- With `--received-job` and `--job-digest`, it can now prepare the complete deterministic preview from one fully received job, including sheet cells and frozen adaptations, before exact-source discovery and replay. This produces a review-required package after a strict visual-review stop without altering the failed DAG or calling a model. Historical sheet prompts remain usable only through an exact two-template compiler compatibility check.
- The package keeps `ui_layer_composition_v1`; private lineage stays outside the ZIP. `sourceReceiptReplayPassed` and `candidatePreviewMatched` describe deterministic checks, while `originalDagPromoted=false` and `humanVisualAcceptance=false` remain explicit. No model or image request is submitted.
- Existing CLI actions and status names remain compatible. Docker/Web final-package consumers need no migration; hosts exposing this optional operation must keep its result separate from the original DAG and display visual review as pending. No new tag is published.

## Unreleased serial CLI image receipt handling

- Each authorized Codex CLI image request now stores its session evidence below
  `generation-sessions/<submissionDigest>/`, so a second request in the same job
  cannot collide with the first session directory. Existing one-request
  `generation-session/` evidence remains readable.
- The collector resolves the one pending submission and checks its binding to
  the session record. Received sheets defer material processing to the existing
  sheet extraction and review; individual materials use separate postprocess
  directories. This fixes a sheet request ID being mistaken for a material ID.
- A nonzero or timed-out CLI process now records a terminal indeterminate
  submission after retaining its session evidence; the next request cannot be
  dispatched and the failed request is never automatically submitted again.
- The CLI session wrapper now names two attached source crops correctly for an
  explicit `sheet-crops-only` variant. It no longer describes the first crop as
  a full reference image, which contradicted the frozen edit request. This is
  isolated to the already supported reference mode; the default full-reference
  request is unchanged.
- A real two-button sheet was received with valid alpha and an exact prompt
  audit, but its icons moved to the center and grew while the button contours
  widened. Early isolated sheet review stopped further generation. The generic
  correction route is an explicitly authorized crop-edit variant for integrated
  controls with deleted labels; no automatic regeneration or weaker review gate
  is introduced.
- No provider retry, quality-gate change, public CLI/status change or
  `ui_layer_composition_v1` migration is introduced. A real multi-request image
  run is still required to validate the CLI transport and generated imagery.

## Unreleased evidence-backed status-card split planning

- Fixed status readout cards still default to one material. A new planning run
  may separate a stretchable empty frame from rigid icon and current-progress
  artwork only when reviewed whole-card generation failures are supplied as
  evidence. M2 checks ownership, position and frame-slice eligibility; a split
  does not itself repair or approve a failed generated card.
- This is a planning prompt/contract clarification. It does not add drawing,
  source-pixel extraction from opaque screenshots, CLI actions, statuses or a
  `ui_layer_composition_v1` migration. Existing frozen runs stay unchanged.
- A new bounded M2 close-up is attached when at least three aligned card
  material boxes have one markedly taller member. It shows each clean source
  row beside its box overlay and asks M2 to verify ownership rather than
  automatically rejecting different heights. A second real planning run
  reproduced the same missed ownership even with the close-up attached.
- The repeated-card geometry suspicion now also enters the program relation
  check. If M2 returns no issue, the DAG still sends the three affected owners
  and their objects to its bounded repair; an unchanged outlier blocks
  repair-check and freeze. This is a conservative planning review trigger, not
  proof that every taller selected-state card is wrong. The threshold requires
  three horizontally aligned, nonoverlapping card materials and one height at
  least 15% and 0.015 canvas-height above the median. No quality gate was
  relaxed, and old snapshots are not relabeled or resumed under changed code.
- Public CLI, statuses, and `ui_layer_composition_v1` are unchanged. The new
  check can cause more planning repairs or a stopped run; Docker/Web consumers
  need no schema migration but should surface that existing failed status.
- A real run exercised that gate: M2 incorrectly treated the tall card as
  intentional, repair retained its outer box, and repair-check stopped before
  freeze. The model also left exact composite-derived Alpha as an unresolved
  planning question. New generic prompts distinguish uncertain ownership from
  inherently unknowable exact Alpha (checked after generation), and the card
  evidence gives both peer-height edge alternatives as search anchors. The
  program does not assign either edge or clear a real ownership uncertainty.
- A later real run initially planned all three card frames at comparable
  heights and cleared the Alpha unknown. M2 found a separate progress-track
  placement error, which one patch corrected. Rereview then misread a nearby
  container rule as the first card's own top, and its second patch was stopped
  by the geometry gate. New runs attach one bounded clean-source/overlay
  comparison for any three aligned card frames, including equal-height groups,
  so rereview still sees the separate neighboring line. This adds diagnostic
  evidence only; it neither changes a box nor declares a visual result.

## Unreleased sheet close-up review evidence

- A real three-card sheet review overlooked visibly thicker bright borders and
  newly beveled corners while reporting only a minor progress fill difference.
  New runs bind a third image pairing each frozen reference crop with its received
  cell after transparent padding is excluded. The review prompt explicitly checks
  outlines, corners, line weight and internal layout. The model may still miss
  visual defects; technical success remains pending human visual acceptance.
- The built-in CLI adapter forwards the third image. Custom internal sheet-review
  adapters must forward it and budget the larger input. Public CLI, statuses and
  `ui_layer_composition_v1` are unchanged; old runtime-pinned jobs remain frozen.
- A later one-call, three-card crop-edit sheet was reviewed with this third image.
  Codex CLI identified broader beveled corners on all three cards and stopped
  extraction; this is one real detection, not a claim of universal visual accuracy.
  The generation prompt already forbade that bevel, so the remaining failure is
  image fidelity rather than missing wording.

## Unreleased edge hairline planning check

- M1/M2 prompts now verify pixel color, thickness, endpoints and ownership for
  faint lines at the canvas edge before naming them as independent decorations.
  This addresses a real case where a dark one-pixel scene line was described as
  a bright HUD rule with invented end tabs. Only new planning runs receive this
  wording; old snapshots and their image approvals remain unchanged. There is
  no CLI or final composition migration.

## Unreleased explicit opacity correction

- Add `adjust-opacity` for hash-bound, user-selected whole-layer alpha reduction.
  Preserve geometry/RGB, raw bytes and correction evidence; reject empty results
  and reused destinations. No model calls, gate promotion or automatic adoption.
  Existing CLI actions/composition are unchanged. Optional host operation only.

## Unreleased received-job continuation

- Add public `finish-received` for complete received jobs following an explicit
  planning revision. It verifies digest and full receipt coverage, preserves
  extraction/registration/package gates, and records failures without promoting
  the parent DAG. It never generates media or retries. Existing composition and
  commands remain compatible; adoption is optional for Docker/Web consumers.

## Unreleased integrated surface localization

- A sole card/button with a null optional outer auxiliary box and bounded owned
  icons/decorations now uses the existing whole-material placement route. Missing
  child geometry, outside children and separate controls remain ineligible. This
  prevents contradictory non-overlapping fragment requests for an integrated icon.
  Existing frame fitting warnings and visual acceptance remain required; placement
  does not prove generated proportions accurate. No composition schema migration.

## Unreleased sheet review ownership

- Sheet review now receives per-material foreign-artwork exclusions from the same
  ownership plan used for generation. Separately owned overlaid controls must be
  absent from a backing surface, while owned icons and decorations remain required.
  Geometry, alpha and receipt gates are unchanged. Existing failed reviews remain
  evidence; the prompt fix does not promote old candidates. No composition or
  required Docker/Web migration.

## Unreleased offline reviewed-plan freeze

- Add optional `freeze-reviewed --planning-run ... --output ... --max-calls N`
  to create a fresh snapshot from verified completed planning without model or
  media calls. It preserves the original generation mode and failed DAG record;
  a higher media request capacity never authorizes generation. Existing commands
  and composition v1 stay compatible; no required Docker/Web migration.
- Explicit `--regroup-generation-mode` can instead compile a new single/sheet
  request layout from the same reviewed material plan. This enables one-material
  crop experiments after a grouped sheet failed without changing old receipts.
  The new snapshot has a new digest and requires its own generation approval;
  hosts using this optional flag must display the new request count and not
  conflate it with the old DAG.
- The isolated `experimental_executor review-material` command checks one
  received single-material variant, then makes one bounded Codex CLI visual
  review with original/raw/close-up evidence. Its structured geometry findings
  can block the variant; it does not package or promote the parent run. Public
  delivery CLI and composition v1 are unchanged. Hosts using this experimental
  path need to support its separate review result.
- If the CLI transport fails, its verified request and transport are recorded as
  `indeterminate_review_no_retry`; no model finding or acceptance is invented.

## Unreleased horizontal frame-slice adaptation

- Add opt-in `horizontal-frame-slice` for reviewed wide card/panel frames. End
  bands keep uniform scale while only the plain center stretches horizontally;
  source identity, clipping, excessive scale and seams are checked. Grouped
  sheets are split and adapted before their existing model identity review, so
  the review sees the derived candidates and can still stop delivery. No raw
  receipt or old failed verdict is overwritten. See
  [Horizontal frame-slice adaptation](HORIZONTAL-FRAME-SLICE.md).
- M1/M2 and the shared planning schema recognize the optional policy. Old
  frozen plans retain `preserve`. Public CLI, DAG states and composition v1 are
  unchanged; planning-schema consumers need the new enum before using it.

## Unreleased Codex CLI model update

New UI layer planning, same-session review/repair, sheet identity review,
material registration and optional CLI image sessions use `gpt-6-luna` at
`xhigh`. The model and effort are defined once for these call sites. Existing
session recovery rejects a different pinned model; frozen jobs still require
their original runtime fingerprint. This does not change the public CLI or
`ui_layer_composition_v1`.

## Unreleased selected-sheet review experiment

A separately received one-sheet prompt variant can now enter the existing
sheet pixel and read-only identity review gates through the experimental
`review-sheet` command. Successful output contains only the selected sheet's
independent, hash-bound material crops and remains pending material validation;
it cannot create or impersonate the full composition. A failed transport or
visual review stops with evidence and no automatic retry. The public delivery
CLI and `ui_layer_composition_v1` are unchanged.

## Unreleased sheet prompt comparison

- Add an explicitly bound one-sheet prompt variant route and reusable compact
  sheet compiler. Existing frozen prompts, image receipts and final composition
  remain unchanged. The variant is experimental until visual review.

## Unreleased atomic artwork prompts

- Compile a concise prompt for one fully anchored icon/decoration with no text
  exceptions; preserve composite layout rules and sheet contracts elsewhere.
  Target ratio now uses frozen pixel dimensions in this branch. Existing frozen
  prompts are not rewritten; CLI and composition v1 remain unchanged.

## Unreleased explicit strip preparation

- Integrate frozen per-material `adaptationPolicy` into delivery raw collection;
  default `preserve`, explicit `simple-strip` uses target dimensions and keeps
  provenance in checkpoint-bound adaptation evidence. Reject clipped inputs and
  structurally ineligible materials before adaptation. Visual review remains pending.
  New planning schema consumers must accept the optional field; composition v1,
  CLI and node names remain unchanged.

- Add standalone `ai_ui_layers.adapt_strip` for user-approved non-uniform resizing
  of simple strips, with preserved raw bytes, source/output hashes and X/Y scale
  evidence. This is not automatic DAG acceptance. See
  [Simple strip adaptation](SIMPLE-STRIP-ADAPTATION.md).

## Unreleased opt-in generation sheets

- Separate delivery materials from image requests with `run --generation-mode sheets`.
  Freeze compatible grid groups and prompts before authorization; image call limits
  count requests while material identities and final layers remain independent.
- Bind one raw receipt per sheet, check transparent cell boundaries, review identities
  through Codex CLI, and crop verified prepared pixels into independently validated materials.
  New planning prompts distinguish observed picture edges from decorative frames;
  generation exclusions include source regions and limit nested parts to their
  own artwork. Continuous backing reconstruction remains specific to carriers.
  Sheet preparation preserves raw receipts, clears only alpha 0/1 pixels in a
  fingerprinted copy, and finds unique nearby full-span transparent seams.
  Ambiguous/missing seams and visual issues still block. Old frozen jobs require
  their original runtime; final composition and existing CLI remain compatible.
  Errors stop without repeated image or review calls. No visual content is drawn.
- Add non-dispatchable `preview-groups` for verified snapshots. Existing default single
  mode, state names and final composition format remain; opt-in hosts must handle
  request-to-material mappings. Real sheet generation is not yet visually validated.

## Unreleased planning and registration safeguards

- Resend the clean full reference alongside the overlay in same-session review,
  repair and rereview calls. Inspect full contours and unique decoration/container
  ownership across the complete candidate; overlay labels are not edge evidence.

- Replace default row/list grouping with independent control, replaceable content
  and visible-state boundaries. M1 describes observed state evidence; M2 checks it.
  Fixed card artwork and portrait frames remain integrated where appropriate.
  No unseen state generation or runtime state/variant API is introduced.

- Clarify static card/illustration ownership and exclude resolved policy notes from planning unknowns.
- Require M2 to review the reference independently of program diagnostics.
- Compile foreground pixel aspect ratios and available object anchors into generation
  prompts; preserve internal offsets after text removal and prohibit invented effects.
- Bind bounded localization observation images to original dimensions and fingerprints,
  then map model coordinates back to the original pixels before existing validation.
- Apply existing whole-material processing gates before control-group localization calls;
  a clipped or otherwise invalid whole material stops without spending a localization call.
- Public CLI, state names and `ui_layer_composition_v1` remain unchanged. Existing runs
  remain bound to their original runtime fingerprints; these changes apply to new runs.

## Unreleased CI compatibility fixes

- Import Pillow's `Image` explicitly so Python 3.10 can evaluate key-evidence annotations.
- Emit public CLI JSON as UTF-8 even on Windows hosts with a legacy console encoding.
- Fail test jobs on the first unsuccessful command on both Linux and Windows.
- Normalize Windows short-name aliases when checking generation results, delivery artifacts,
  and checkpoint overlap; retain traversal, symlink, and byte-identity checks.
- Bring offline board fixtures into agreement with their declared visible dimensions;
  the runtime size gate and thin-button rejection remain unchanged.

## 0.1.0a2 preview

整理为 src/ai_ui_layers、tests、docs 目录；修正包内导入、仓库资源定位、测试发现、CI 与文档链接。
根目录 ui_layer.py 的命令、stdout JSON 和图层包合同保持兼容，不修改旧正式链路。
固定标签为 ui-layers-v0.1.0-alpha.2；alpha.1 不覆盖。
本轮 113 项 Python 离线测试通过，包含从仓库外工作目录调用入口读取真实初始化任务的回归。
原任务绑定旧代码指纹，应继续用旧版本运行；本轮不迁移已有任务。

## 0.1.0a1 preview

从实验链路收口为独立源码入口 `ui_layer.py`。旧正式 CLI 不覆盖。
支持规划冻结、生图请求/回执交换、自动定位、回拼及独立 UI 图层包；服务接入合同见 SERVICE-CONTRACT.md。
增加 CLI 单 JSON 输出边界、独立 Pixi 图层查看器；去字保位和装饰唯一归属约束保留。

本地验证（Windows，Python 3.14，Node）：
- 112 项 Python 离线测试（包含规划、授权、指纹、失败阻断、归位、打包、CLI、色键证据）。
- 10 项图层/旧导入合同测试。
- TypeScript noEmit 和独立查看器构建。

不包含用户参考图、生成素材、会话或私有工具配置。没有本次 Linux、Docker 或真实模型端到端验收。
视觉保真仍待迭代，技术交付保持 delivered_pending_visual_review；不自动批准用户视觉验收。
发行标识预留为 ui-layers-v0.1.0-alpha.1；只有远端标签和校验过的归档实际发布后才能作为生产依赖。
# Unreleased: explicit accepted material sets

- Added an offline accepted-material packaging entry point. It replays verified
  received variants through existing extraction/adaptation/material gates and
  checks the complete layer set plus pixel identity with the accepted preview.
- Preserves original failed DAG/review evidence; user acceptance and private
  lineage are recorded outside the portable ZIP. Existing composition and
  review/status contracts remain unchanged. See [ACCEPTED-MATERIALS.md](ACCEPTED-MATERIALS.md).
- No new release tag or Docker/Web implementation accompanies this change.


### Sheet visual review severity

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

M2 now audits every small foreground-material crop by visible component and
requires a matching literal quote from its material or object description.
Absent or fabricated quotes become semantic blockers in the existing bounded
repair path. This addresses a Wormux planning run that froze after two repairs
while its contributor icon still omitted a visible palette. The reviewer can
still overlook a component entirely, so the frozen plan is not human visual
acceptance. Existing pinned runs remain unchanged; the internal review schema
changes for new runs only, with no public CLI or composition migration.
The first real six-call run with this audit stopped at the second rereview:
the model continued to call a colored palette a pale paper sheet, and a later
patch corrupted part of the scene description. The next audit revision asks
for visible shape, color and surface marks before naming each component and
adds a bounded enlarged original crop for the most color-diverse small
material. This improves evidence but does not certify model perception.

The experimental Codex CLI image-session collector now recognizes a static
`String.raw` prompt literal, rejects interpolation or backslash escapes, and
still requires exact equality with the frozen request before receiving a PNG.
This corrects a false `UNSUPPORTED_PROMPT_ENCODING` stop on a real Chinese
status-panel request. Its already terminal attempt remains terminal; the fix
does not resubmit or retroactively receive it. The public CLI/status and
`ui_layer_composition_v1` contracts are unchanged; Docker/Web consumers need no
migration for this collector-only fix.

The experimental single-material visual reviewer now includes the frozen
owned-object list and overlapping foreign-material exclusions, matching sheet
review semantics. This avoids false missing-artwork blockers when an isolated
backing correctly omits child cards, icons, progress bars or buttons visible in
its original rectangular crop. Existing review results remain immutable; a
corrected review uses a new output directory. The public composition and CLI
status contracts do not change.
