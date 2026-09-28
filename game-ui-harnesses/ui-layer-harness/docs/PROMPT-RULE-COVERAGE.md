# Planning prompt rule coverage

This maps the M1/M2 templates at `c0154f2b` to their consolidated wording.
It is reviewer documentation, not an additional model input or a new quality policy.
Templates remain in the shared `ui-decomposition-harness/planning-harness/prompts/`.
The schema, deterministic validators, review records, call limits and authorization
boundaries are unchanged. Offline coverage is not evidence of model fidelity.

## M1

| Original rule group | Consolidated location | Retained decision |
| --- | --- | --- |
| Input and fixed target | Opening; 目标与记录 | Original image, static-composite, local explicit requirements, empty independentTargets still split; no OCR assumption or independent-assets mode |
| Record structure and classifications | 目标与记录 | Schema owns field/enum syntax, compact visual meanings retained; kind is not component/runtime/reuse; every material has an object |
| Background and drawing order | 目标与记录 | One full-canvas background and background object; foreground above it; equal nonconflicting layers allowed; unknown occlusion recorded, program owns drawIndex |
| Repeated instances and no canonical reuse | 目标与记录 | Unique observed instance IDs/ownership, no copied or averaged boxes, no pixel reuse |
| Complete visual units and local user grouping | 归属与拆分 | Default whole controls/cards; split only by independent content/state/control/slider or user evidence; no material-count goal |
| Buttons, integrated graphics and plaques | 归属与拆分 | Distinct buttons/tabs remain distinct, fixed symbols and plaques stay with their button unless independently bounded |
| Explicit static composite widget | 归属与拆分 | Only requested group combines; internal objects/anchors remain, neighbours unaffected |
| Replaceable list content and fixed card art | 归属与拆分 | Slot icons/content separate from surfaces/state; fixed icon frame retained; fixed card art/portrait may remain whole |
| Fixed row textures | 归属与拆分 | Parent texture may group without independent boundary; each row still observed |
| Visible state and fused selection | 归属与拆分 | Current selected/unselected, checked/unchecked, enabled/disabled evidence; checkmarks separate; no hidden variants or duplicate whole backings |
| Scrollbars | 归属与拆分 | Independent thumb separated, fixed end trim stays with track, end controls judged by evidence |
| Readout cards and progress controls | 归属与拆分 | Whole-card/track-plus-current-fill default; numbers/colours alone do not imply independent state or editability |
| Reviewed whole-card generation failure | 归属与拆分 | Existing reviewed evidence needed for empty-frame/rigid-icon/progress split; never recover transparent frame from opaque source by assumption |
| Fixed ornaments, actual interleaving and scene art | 归属与拆分 | Attached trim stays with parent; protrusion alone is not interleaving; complete scene/illustration retained |
| Scene/foreground junction | 归属与拆分 | Attachment/continuity/overlap evidence, not closeness or colour, determines vegetation ownership |
| Duplicate ownership and real gaps | 归属与拆分 | No double-owned graphics or invented bridges/objects; summary labels and overlapping boxes are not duplicate ownership |
| Material crop and merged silhouettes | 区域与定位 | Original normalized LTRB, full silhouette/extrema/glow/gaps, no generated padding or text-driven expansion, recalculate all edges after merge |
| Containers and auxiliary boxes | 区域与定位 | Full container contour remains; nullable auxiliary boxes cannot replace crop or hide incomplete parts |
| Separated controls and integrated icons beside text | 区域与定位 | Required complete non-null anchors; integrated icon object stays in same material; no additional overlapping material or shifted symbol |
| Label, position, colour and material | 外观与细节 | Direct visible evidence, no conflicting layout instruction, borrowed palette or state-derived colour |
| Border identity and nested parts | 外观与细节 | Image backing/stroke/ornamental frame distinguishable in both label types; parts describe themselves, not entire control |
| Progress extent | 外观与细节 | Empty/partial/nearly full/full, pixel evidence, rough extent and direction, no numeric inference |
| Tiny attached parts and fixed decoration | 外观与细节 | Attached tools/occluded shapes/marks retained, important decoration objects, complete ends/central marks/gradients; shadows/glow/dividers stay with owner |
| Thin low-contrast image boundaries | 外观与细节 | Observe colour/width/endpoints/connection; no invented bright HUD or end caps, visible pixels retain ownership |
| Program does not draw UI | 外观与细节 | Existing pixels only, no simplified redraw, surfaceDetails, font files or drawing instructions |
| Business versus decorative text | 文字、背景与不确定性 | Business text removed; preserveText sole permission, exact visible lettering, purpose and owner, unreadable exceptions block; no OCR/textRegions |
| scene-only versus preserve-underlay | 文字、背景与不确定性 | Explicit actual retained background scope, observed occlusion completion, underlay state/dimming retained, no repeated foreground or business-text exemption |
| Semitransparent panels | 文字、背景与不确定性 | Describe light transmission and separation, no baked-through scene or invented Alpha percentage; intrinsic Alpha ambiguity alone is post-generation review |
| Unknowns and response scope | 文字、背景与不确定性 | Real unresolved IDs/questions only, not policies or known grouping; uncertain classification supported; no extra decisions, receipts or acceptance claim |
| Existing simple-strip/frame-slice eligibility | 可选适配 | Original eligibility paragraph unchanged; explicit permission, default preserve, protected ends, plain middle, rigid/lettering exclusions and no missing-detail repair |

## M2 and rereview

| Original rule group | Consolidated location inside the explicit review stage | Retained decision |
| --- | --- | --- |
| Complete review and program issues | Opening | Clean source first, six dimensions, no early stopping, unchanged regions included, program warning is an entry point |
| Nine-region coverage | 覆盖与小素材 | Ordered regions, actual observed artwork, complete owned descriptions, no full-background-box shortcut, missingFromPlan becomes blocker |
| Small-part observation and evidence quote | 覆盖与小素材 | Attached/occluded parts and surface marks, name uncertainty does not remove observations, literal relevant label evidence required |
| Controls, static user groups and fixed plaques | 归属与粒度 | Separate independent buttons; fixed parts retained; local grouping exception does not merge neighbours |
| List content, row texture and fixed illustration | 归属与粒度 | Replaceable content/state versus parent surfaces; fixed portraits/frames not mechanically split, repeated rows observed |
| Readout cards and reviewed failure exception | 归属与粒度 | Group default, independence exceptions, actual prior failure evidence, source-relative geometry, no unsafe rigid-middle adaptation |
| Attached ornaments and junctions | 归属与粒度 | Real interleaving/attachment evidence; no over-split fixed ornaments or scene vegetation mistaken for crop tips |
| Duplicate ownership and independent currency | 归属与粒度 | No double-owned graphics or cross-area fusion; material summary is allowed; fixed functional symbols differ from state marks |
| Background and Alpha scope | 归属与粒度 | Correct underlay/dimming/scene policy, no repeated foreground or scene baked into translucent panel; geometric uncertainty still blocks |
| Contours, merged crops and container boundaries | 轮廓、定位与层级 | Full all-edge contour, fixed extensions, explicit owner, actual container edge, no child-edge substitution |
| Auxiliary/locator completeness | 轮廓、定位与层级 | Null alone not error; complete non-null anchors, independent check even when parent encloses contour, no text-layout box shortcut |
| Image envelopes and unnecessary padding | 轮廓、定位与层级 | Gaps are not shrink evidence; concrete edge/extrema/excess strip required, no clipping another extension or arbitrary warning-driven shrink |
| Same-layer overlap | 轮廓、定位与层级 | Check each program-reported pair, distinguish real occlusion from estimated-box error, no ID-based order |
| Repeated-card aspect attribution | 轮廓、定位与层级 | Actual closed contours and four edges, gaps/neighbour lines/ornaments distinguished, planning/placement errors not called generation deformation |
| Actual colour, line and border identity | 外观、装饰、状态与文字 | Visible palette and thin-line evidence; both material/object labels checked; nested parts cannot imply duplicate whole control |
| Small decoration and program boundary | 外观、装饰、状态与文字 | Complete divider/end/centre/outline/gradient/glow observations, meaningful ownership, no program redraw or invented art |
| State, empty state material and scroll thumb | 外观、装饰、状态与文字 | Current visible distinctions, independent checkmark, wrong ownership checked before deletion, fused state not duplicate whole backing, no unseen variant |
| Progress fill | 外观、装饰、状态与文字 | Empty/partial/nearly full/full and direction/extent verified from pixels, not nearby numbers |
| Text and unresolved uncertainty | 外观、装饰、状态与文字 | Sole preserveText permission, source-exact lettering, purpose/ownership, no unknown business-text object or known-policy unknowns; genuine questions block |
| Adaptation and repeated equivalent frames | 适配与输出 | Original eligibility paragraph unchanged; visual slice eligibility, protected ends, default preserve and explained repeated-frame exceptions |
| Severity and response | 适配与输出 | Only two established cosmetic codes; substantive colour/state/ownership/geometry/omission stay blocking, evidence and local advice, no second plan/freeze/acceptance claim |
| Repair instructions | Outside review stage | Original second-step text unchanged and excluded from M2/rereview dispatch |

Dynamic DAG guidance and evidence are separate: actual canvas dimensions, original
reference and overlays, focus attachments, small-part/boundary schemas, literal
evidence validation, user notes and compact prior findings remain unchanged.
M3 still compiles only a reviewed candidate. This consolidation has no generation,
extraction, localization, packaging or retry-policy change.

Enum/type descriptions and prohibited extra fields were shortened where the
attached schema already enforces their syntax. Visual interpretation, uncertainty
and ownership decisions were retained in the model instructions; schema validity
cannot establish that those decisions are correct.
