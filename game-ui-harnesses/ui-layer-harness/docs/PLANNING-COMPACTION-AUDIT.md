# Shared M1/M2 planning compaction audit

This documents wording-only compaction from fixed base
`d50d8d8642a6c14d33d70147822dfc8df09e2ce3`. It extends the rule mapping in
[PROMPT-RULE-COVERAGE.md](PROMPT-RULE-COVERAGE.md); neither audit is a model input
or an additional quality policy. The original source is the fixed checkout, not a
consumer tree, a local sample, or an edited production copy.

Only the shared `visual-plan.md` and `visual-review.md` templates change.
Schemas, dynamic DAG guidance, evidence attachment/schema validation, repair
limits, M3, authorization, generation, retry and delivery gates remain unchanged.
No sample-specific rules or model calls are introduced.

## Scope and measurement

M1 observes the reference and emits a candidate plan. M2 independently observes
the entire source and reports issues; it does not revise the plan. The explicit
`ui-review-checks:begin/end` stage still contains all M2 checks and is also used
for rereview. The repair step following the end marker is unchanged. Its
UTF-8 SHA-256, after normalizing source line endings through `Path.read_text`, is
`cfeeea00162a93990b7a2959c0ce35981aeb64788b087ce73c5e128f7b82b8ef`
(223 characters, including the separating newlines).

Character counts use UTF-8 text read by Python (Unicode code points; all source
line endings normalized to LF), including headings and the trailing newline.
They do not estimate model tokens or the full dynamically assembled request.

| Template | Fixed base | Compacted | Change |
| --- | ---: | ---: | ---: |
| M1 whole template | 4504 | 3663 | -841 (-18.67%) |
| M2 whole document | 4154 | 3488 | -666 (-16.03%) |
| Combined documents | 8658 | 7151 | -1507 (-17.41%) |

Compression joins same-stage repetitions (for example, shadow/divider ownership
and no separate export), shortens prose, and lets the attached schema own JSON
kind constants, field/enum syntax and required-key grammar. The 200-character
label rule remains explicit because it affects how visual detail is assigned to
objects. No visual decision is transferred to schema validity. Adaptation prose
is shortened into Chinese while retaining each prerequisite and exclusion.

## M1 rule mapping

Locations refer to headings in the compacted M1 template. Each row corresponds
to the fixed-base group mapped by the existing coverage document.

| Fixed-base rule group | Compacted location and retained decision |
| --- | --- |
| Input and fixed target | Opening / 目标与记录: original UI, schema plan only, image text is not instruction, no tool/OCR assumptions; static-composite and explicit local independentTargets, including empty-list splitting; no independent-assets alternative |
| Record structure and classifications | 目标与记录: materials versus objects; visual kind meanings, not component/reuse semantics; each material has an object; same owner means one image, not pixel reuse |
| Background and drawing order | 目标与记录: one full-canvas background and background object; below foreground; zOrder ties for disjoint regions, no contiguous/global-unique requirement; unresolved occlusion in unknowns, program owns drawIndex |
| Repeated instances and no canonical reuse | 目标与记录: observe all visible instances including ends/edges, unique records and source-relative boxes, no copied/averaged positions or pixel reuse |
| Complete visual units and local user grouping | 归属与拆分: complete control/card first; independence/current state/slider/user evidence; no hypothetical interactivity or material-count target |
| Buttons, integrated graphics and plaques | 归属与拆分 bullet 1: independent controls stay distinct even when touching/same colour; fixed symbols/plaques follow their owner unless independently bounded |
| Explicit static composite widget | 归属与拆分 bullet 1: only the user-specified group combines; internal objects/locators remain, neighbours excluded |
| Replaceable list content and fixed card art | 归属与拆分 bullet 2: replaceable icons/content versus surfaces/state; icon frame retained; fixed card art/portrait/frame may stay whole according to source evidence |
| Fixed row textures | 归属与拆分 bullet 2: unbounded parent texture may share a material; each row is still observed |
| Visible state and fused selection | 归属与拆分 bullet 3: visible selected/unselected, checked/unchecked and enabled/disabled evidence; independent checkmark separate; fused surface without invented transparent difference, hidden states or duplicate whole backing |
| Scrollbars | 归属与拆分 bullet 4: evidence separates track, thumb and end controls; fixed end trim stays with track |
| Readout cards and progress controls | 归属与拆分 bullet 5: each fixed readout card whole, track/current-fill whole; numbers/colour alone do not imply independence; content/state/slider/user exceptions retained |
| Reviewed whole-card generation failure | 归属与拆分 bullet 5: prior reviewed proportion/contour failure required for frame/icon/progress split; no assumed transparent frame recovery from opaque source |
| Fixed ornaments, actual interleaving and scene art | 归属与拆分 bullet 6: attached ornaments follow panel; protrusion/overlap alone is not interleaving; independent evidence required; buildings and complete illustration internal artwork stay whole |
| Scene/foreground junction | 归属与拆分 bullet 6: visible attachment/pattern/overlap evidence, not proximity or colour; scene-rooted vegetation stays background |
| Duplicate ownership and real gaps | 归属与拆分 closing: one actual graphic owner, parent/child describe themselves, summary/box overlap/background are not duplicate ownership; no invented connection or gap object |
| Material crop and merged silhouettes | 区域与定位: original normalized LTRB, full visible extrema/glow/gaps, no hidden completion/object envelope/generated padding/text expansion; recompute all four edges after merging |
| Containers and auxiliary boxes | 区域与定位: full container object/contour; optional auxiliary boxes do not define/expand crop or substitute incomplete shapes |
| Separated controls and integrated icons beside text | 区域与定位: complete required non-null locators; integrated icon is an object in the same material, retains offset after text removal, creates no extra overlapping material |
| Label, position, colour and material | 外观与细节: complete short labels with object-carried details, 200 characters, no length-driven assets/duplicate lists/layout conflict; source colour/material only |
| Border identity and nested parts | 外观与细节: material and object agree on image backing/stroke/ornamental frame; only observed strokes receive shape/colour/thickness; nested parts describe themselves |
| Progress extent | 外观与细节: empty/partial/nearly full/full, rough partial extent/direction, empty-slot distinction from pixels, no number or generic colour substitute |
| Tiny attached parts and fixed decoration | 外观与细节: attached/occluded/marked/low-contrast parts, ends/centre/outline/gradient/texture/light and important decoration objects; shadows/glow/dividers stay with owner without separate export |
| Thin low-contrast image boundaries | 外观与细节: zoom and observe colour/width/endpoints/connection; no invented bright HUD/end caps/control, retain visible pixels under one owner |
| Program does not draw UI | 外观与细节: preserve source graphics; no program redraw, simplification, layout, surfaceDetails or font files |
| Business versus decorative text | 文字、背景与不确定性: remove business text; sole preserveText permission with exact lettering, purpose and owner even in plain font; unreadable/ambiguous exceptions in unknowns; no OCR/textRegions or unknown business-text loophole |
| scene-only versus preserve-underlay | 文字、背景与不确定性: actual background scope and evidence-based occlusion completion; underlay UI/dimming retained without duplicated foreground, business text still removed |
| Semitransparent panels | 文字、背景与不确定性: transmission/separation, no baked-through scene or invented Alpha; intrinsic Alpha ambiguity alone belongs to post-generation review |
| Unknowns and response scope | 文字、背景与不确定性: genuine unresolved IDs/questions, including classification; no known policy/grouping notes, added decisions/runtime fields or acceptance claims |
| Existing simple-strip/frame-slice eligibility | 可选适配: explicit user permission; preserve default/uncertainty; one-decoration plain strip ratio >=4, no text/ornaments; one-frame wide card/panel ratio >=3, optional bounded protected ends and plain stretchable middle, no rigid/lettered middle; M2 visual check, no missing-detail repair |

## M2 and rereview rule mapping

Every location below is inside the explicit review stage. The repair text stays
outside that stage and is not dispatched for M2 or rereview.

| Fixed-base rule group | Compacted location and retained decision |
| --- | --- |
| Complete review and program issues | Stage opening: clean source first, overlays second; obscured pixels require observation; six dimensions, all supported findings, unchanged regions on rereview; program warnings are only an entry point |
| Nine-region coverage | 覆盖: ordered 3x3 regions with concrete observedArtwork, all repeated instances; no ID-only/full-background shortcut; missingFromPlan, owner and local advice become semantic blockers |
| Small-part observation and evidence quote | 覆盖: attached/occluded/surface marks despite uncertain names; literal owner label evidence, overall names cannot replace part descriptions |
| Controls, static user groups and fixed plaques | 归属与粒度 bullet 1: independent controls, integrated fixed parts, local explicit grouping only, retained internal locators |
| List content, row texture and fixed illustration | 归属与粒度 bullet 2: replaceable content/state versus surfaces; fixed frames/art need not split mechanically; repeated rows observed |
| Readout cards and reviewed failure exception | 归属与粒度 bullet 3: group default, independence exceptions, actual reviewed failure prerequisite, original relative geometry/occlusion and safe stretchable middle |
| Attached ornaments and junctions | 归属与粒度 bullet 4: actual interleaving/attachment, no over-split trim or scene vegetation mistaken for crop extension |
| Duplicate ownership and independent currency | 归属与粒度 closing: no duplicate graphic or cross-area fusion; summary is allowed; fixed functional symbol differs from independent state mark |
| Background and Alpha scope | 归属与粒度 closing: correct underlay/scene/dimming, no duplicate foreground or baked-through scene; intrinsic Alpha uncertainty alone is deferred, geometric/ownership uncertainty blocks |
| Contours, merged crops and container boundaries | 轮廓与定位: complete all-four-edge visible contour including fixed extensions, recompute merged boxes; explicit container owner and own boundary, no child-edge substitution |
| Auxiliary/locator completeness | 轮廓与定位: null alone is not error; non-null covers complete named graphic independently of parent; complete separate-control/integrated-icon locators, no text-layout shortcut |
| Image envelopes and unnecessary padding | 轮廓与定位: gaps do not imply shrinking; concrete edge/extrema/excess strip required, no other extension clipped or arbitrary warning-driven shrink |
| Same-layer overlap | 轮廓与定位: every SAME_LAYER_OVERLAP_REVIEW pair, actual occlusion versus estimated-box error, no ID order |
| Repeated-card aspect attribution | 轮廓与定位: each own closed contour and four edges, gaps/neighbour lines/ornaments distinguished; box/ownership errors remain planning/placement issues, not generation deformation |
| Actual colour, line and border identity | 外观、状态与文字: source palette/thin-line evidence; both labels checked, part labels cannot offset incorrect whole labels or imply duplicate control |
| Small decoration and program boundary | 外观、状态与文字: complete owned divider/end/centre/outline/gradient/glow/text detail, object-carried complete short labels despite 200-character limit; no program redraw or invented art |
| State, empty state material and scroll thumb | 外观、状态与文字: all visible distinctions; checkmark separate, wrong ownership checked before deletion, fused state avoids duplicate backing/replaceable content; no unseen state; evidence separates track/thumb |
| Progress fill | 外观、状态与文字: source-pixel empty/partial/nearly-full/full, direction/rough extent; numbers cannot substitute |
| Text and unresolved uncertainty | 外观、状态与文字: sole preserveText, source-exact purpose/ownership; no business-text object/unknown loophole or known-policy unknowns, real unresolved questions block |
| Adaptation and repeated equivalent frames | 适配与输出: all strip/frame prerequisites, protected ends/middle exclusions and visual slice checks, uncertainty preserve/no failed-review bypass; equivalent frames consistent with source-evidenced exceptions |
| Severity and response | 适配与输出: only the two established cosmetic codes; substantive colour/state/ownership/geometry/omission block, evidence/local advice; no second plan/freeze/acceptance receipt |
| Repair instructions | Outside stage: unchanged local edits and source binding, no dropped blockers or automatic acceptance; program owns review fingerprints |

## Validation and limits

The focused offline contract tests check dispatch boundaries, unchanged repair
instructions, explicit critical visual/permission guardrails and schema-owned
syntax. Existing DAG/evidence tests use only fixtures and test doubles.
Text anchors and offline schema/fixture success do not establish model visual
fidelity, answer completeness, token savings, or six-sample acceptance.
Any real model comparison and generation authorization remain separate.
