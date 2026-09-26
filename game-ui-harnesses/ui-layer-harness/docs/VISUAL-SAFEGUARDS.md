# Visual safeguards

These rules apply to every new static-composite job, not a named reference image.
Shared M1/M2 prompts live in the adjacent planning-harness; generation geometry is
compiled in short_prompt.py. Never patch a frozen job to adopt a new rule.

| Failure | Prevention and evidence | Remaining acceptance requirement |
| --- | --- | --- |
| Icons move into removed text | M1 describes integrated symbols at their original offsets; M2 checks this; generation preserves empty text space and receives existing object anchors. Keep symbols within their controls. | Compare internal symbol positions in raw material, not only the placed control. |
| Repeated rows become wide/short | Compile the pixel aspect ratio for every foreground, using reference dimensions rather than normalized coordinates alone. Preserve existing row boxes and gaps at uniform scale. | Compare raw alpha bounds and internal layout before fitting; a fitted preview is not ratio evidence. |
| Small decoration disappears | Record important dividers, endpoints and central marks with explicit ownership; pass an anchored decoration's observed appearance alongside its box to the image request. A generic material label or an ID alone does not replace that evidence. | Inspect the raw material. Never draw replacement decoration in code. |
| Decoration at a material junction is cropped | Assign each protruding ornament to one owner, then check all four crop edges of that owner and its adjacent material. A one-edge repair does not establish complete coverage. | Review the clean reference after the patch; structural box checks cannot prove ownership or visible tips. |
| Fixed badge or hanging trim is over-split | Keep decoration attached to a panel in the panel material when the whole assembly can be drawn at one layer, even if it protrudes or covers the frame. | Split only for an independent editing/state requirement or actual interleaving with another independent material. |
| Parent crop remains too small after grouping | Recalculate the parent material and any supplied auxiliary boxes from the entire merged silhouette, including all protruding tips. | A correct materialId with an old body-only box still clips artwork; inspect the clean reference against both boxes. |
| One button becomes an icon layer plus a nameplate layer | Treat an attached caption plaque as part of its button unless the plaque has an independent control or visible state boundary. | Check the whole button silhouette and keep its fixed functional graphic and plaque together. |
| User-confirmed composite widget is fragmented | Honor an explicit request to deliver one widget as a static material while keeping its internal button/icon objects and anchors; do not generalize that merge across neighbouring widgets. | Confirm the requested static grouping before planning and preserve internal graphic positions after text removal. |
| A picture gains a decorative frame | M1 describes only visible border evidence; M2 distinguishes a picture edge/dark backing from a separate ornamental frame. Generation preserves only observed owned borders. | Do not rewrite an old plan's descriptive words and claim automatic planning success; validate a new plan and raw result. |
| Nested parts each become the entire control | Name each part independently. Foreign exclusions include reference regions; boxes locate artwork rather than assign every enclosed pixel. Non-carrier prompts do not ask for wholesale surface reconstruction. | Inspect both raw parts for duplicate frames, end ornaments and interiors before compositing. |
| Clipped contours or invented glow | Require transparent margins on all sides and prohibit added effects. Run existing whole-material gates before localization. | Keep continuous alpha; do not add padding to disguise an already clipped source. |
| Localization uses display coordinates | Create bounded observation attachments, fingerprint dimensions and bytes, and map their half-open coordinates deterministically back to original pixels. | Validate mapped boxes, coverage and local contours against the original raw image. Do not enlarge search limits to accommodate a wrong answer. |

Regression coverage includes portrait foreground geometry and ownership in
test_short_prompt.py; clipped-source fail-fast, oversized attachments, adjacent
coordinate boundaries, unchanged raw fingerprints and actual original-pixel
placement in test_automatic_registration.py. All fixtures are offline.

When a decoration anchor lies within 12 source pixels of a large owner crop edge,
M2 and rereview may receive at most three bounded, two-times close-ups. Distinct
near edges of the same corner decoration remain separate evidence. Each pairs
the clean original with its review overlay, records the exact original-pixel
region and crop edge, and binds the images and metadata in the request. The
close-up is review evidence, not a new generation reference or an automatic
geometry correction. Untriggered jobs retain the full-image review only.
test_review_focus.py checks that an out-of-box decoration tip appears in the
evidence and that the resumed CLI receives it after the full reference/overlay.

These controls do not prove generative fidelity. Visual findings remain separate
from structural validation, with planning/generation/extraction/placement attribution.
Visual review reports correction suggestions; users decide whether to authorize
another generation. No automatic regeneration is introduced.

The one-shot planning repair explicitly receives the original material records
and all owned object records for material/object IDs cited by M2. The source
context, prompt and reference fingerprint are bound in the repair request.
Suggested changes must be checked against the clean reference; a suggestion to
add a fixed decoration does not automatically require an auxiliary box. Necessary
anchors must not be cleared to bypass review. Any supplied box covers the complete
named graphic, independently of its parent material's coverage. This input
handoff does not measure visual completeness; full rereview remains mandatory.

Independent buttons, replaceable list content and visible state boundaries take
precedence over static grouping. M1 records observed states and their evidence in
existing labels; M2 checks those distinctions. Integrated button symbols and fixed
portrait frames stay with their owner. State surfaces and separate checkmarks must
not be baked into replaceable content. A fused state surface may be delivered whole;
do not invent a transparent difference or unseen state variants. Scrollbar tracks
and thumbs are distinct when visible evidence supports them. These are planning
semantics, not a new runtime state-machine or variant API.

Progress tracks need their visible fill direction and approximate extent in M1
labels, with M2 checking the colored pixels against the reference. Empty,
partially filled and nearly full tracks are different observed states; nearby
numbers alone cannot establish the fill. A real nearly full green track was
generated at roughly three-fifths width when its frozen label said only
"filled with green". That raw is a generation result pending visual correction,
not a proportion that registration should stretch into agreement.

For repeated ornate card frames, compare each generated visible contour with its
own reference region before trusting a sheet extraction or a contained preview.
If a crop-reference edit still changes the width/height ratio, report the source
geometry error and keep the reviewed `preserve` placement policy; a technically
valid transparent crop is not a visual pass. Do not repeat the same edit prompt
automatically or reinterpret `simple-strip` as permission to stretch ornate cards.
If M1/M2 explicitly approve `horizontal-frame-slice` for a new plan, inspect
the derived frame's corner fidelity, middle texture and both seams before
registration; the raw generation's earlier ratio failure remains recorded.

Public CLI/state names and ui_layer_composition_v1 are unchanged. Observation
images and mappings are internal evidence, not a new consumer coordinate system.
Archived model responses use their original runtime; their coordinate semantics
must not be silently reinterpreted under a newer runtime.

## Known limitations requiring separate evidence

- Touching controls can share an opaque boundary. The current local contour search
  treats support at a neighbour-clamped search edge as an incomplete contour and
  stops. Correct observation coordinates alone do not solve this case. Distinguish
  an external silhouette from an internal ownership boundary before changing this
  behaviour; never enlarge the search or accept an arbitrary model cut to pass it.
- A container outline must retain its complete extent even when a child such as
  a scrollbar is delivered separately. Attached decoration on every side needs
  ownership; recording only the most prominent corner is insufficient evidence.
- Native alpha and valid bounds do not establish clean visual edges. Inspect
  coloured fringe pixels and altered border thickness in the raw result as well
  as the fitted result. Ratio warnings remain findings after frame-bounds fitting.

These are acceptance constraints and known limitations, not claims that the
current automatic planner or generator reliably resolves them.

An explicitly selected single empty button backing may use the existing
`frame-bounds` fit in a local preview when its material owns exactly one button
object and no preserved text. The processor only rescales received pixels and
records nonuniform stretching for visual review; it does not make the original
generation ratio accurate or approve the appearance. Multi-object controls and
standalone icons are not eligible for this override. The optional preview
contract is unchanged for callers that do not select it.

Review, repair and rereview now receive the clean full reference alongside the
overlay in the existing session. Inspect small-symbol tips, icon frames and the
complete container contour on the clean image; annotation labels can hide them.
Rereview examines the entire candidate, including unchanged regions. Fixed panel
ornaments default to their panel and must not be described as owned twice.
When a localized ornament anchor nearly meets a large material edge, M2 and
rereview first inspect a bounded original/overlay close-up. An annotation that
spans almost the entire parent is not a useful local edge witness, so it cannot
displace the localized ornament close-up. With only two slots, equally near
ornaments are ordered by their localized footprint, and a single ornament gets
only one slot. This is review evidence, not a
deterministic visual verdict: the model still has to report a cropped tip.
An isolated few-pixel uncertainty at a decorative tip is a recorded raw-material
inspection risk when ownership and the main silhouette are sound; it need not
force another planning run. Missing controls, wrong ownership, substantial crop
loss, or a distorted parent aspect remain planning blockers. Do not mark raw
generation or recomposition visually accepted before inspecting those outputs.

The CLI image-session envelope ends with the frozen image prompt itself; it has
no closing delimiter for the model to accidentally forward into the image tool.
Audit the actual tool-call prompt against the frozen request before receiving a
PNG. Any extra marker or other prompt difference is terminal for that reserved
submission, even if the image looks usable; never retry it automatically.

A toggleable checkmark is state evidence, not an integrated functional symbol.
An unused state material may indicate a wrongly assigned object: review ownership
before deleting it. All visible peers need observed state labels. These prompt
clarifications still require real-run verification; structural gates cannot infer
visual state semantics from free-text labels.

The public planning DAG prepends the actual reference width and height to the
M1 request, bound by its prompt hash. Normalization uses the full source canvas,
not a displayed preview or assumed square. This supplies missing context; it
does not correct model coordinates or relax object containment checks.

Non-null object anchors describe the complete named artwork, including fading
extensions, not only its most salient center. The parent material containing the
whole artwork does not excuse an incomplete anchor. Color/material words must
follow direct visual evidence, not neighbouring controls or presumed states.
Uncertain color names can be omitted; unnecessary anchors remain null.

Single anchored icons/decorations covering their entire material and preserving
no lettering now use a compact single-artwork template. It retains full-reference
identity, ownership exclusions, complete contours and transparent padding, but
omits multi-object layout and deleted-label reflow clauses. The exact pixel size
uses the compiler's floor/ceil conversion. Selection is structural, never based
on sample IDs or words such as thumb. Offset anchors, multiple objects, panels,
cards, buttons, illustrations and text exceptions keep their existing contracts.
Sheet prompts retain cell-layout rules; this change only affects single requests.
This is a prompt hypothesis backed by earlier short-prompt observations, not
proof that future generations will exclude foreign borders. Visual review stays
required; non-uniform adaptation cannot cure incorrect ownership.


Real single-part comparisons did not establish that shortening a prompt alone
solves foreign-assembly leakage. Adding an unchanged local crop alongside the
full reference improved one nested-strip result, while a thin rim and edge specks
remained. Keep full-reference input as the default. Consider a local reference
only after observed localization/ownership failures, with a new bound request
and authorization. Inspect the crop first: neighboring pixels at curved ends
are context, not owned artwork. Do not silently trim coordinates or claim a
rectangular crop is a clean mask. Report original ratio error separately from
explicit strip adaptation, and keep visual acceptance pending after adaptation.

Repeated-row experiments did not establish that concise prompts or local crops
alone stabilize proportions. A single-row crop edit reduced the observed error,
but still needed disclosed whole-frame fitting before user acceptance. Treat
sheet layout as a testable hypothesis, not a proven cause; do not switch every
material to individual generation or append sample-specific prompt rules.

Generation and review must use the same ownership boundaries. Review receives
per-material foreign-artwork exclusions: an overlaid control owned by another
material must be absent from the row surface, while the row's owned icon remains
required. Missing foreign controls are not lost decoration. A sole card/button
may omit its outer auxiliary box under v5; bounded owned icons can still travel
with its declared material bounds. Separate controls and unknown/outside child
bounds must not silently qualify. Whole-frame placement can resample axes
differently; report its stretch warning separately from raw generation accuracy.

Sparse translucent overlays must not inherit a neighboring panel's complete
border style. A rectangular source crop locates the overlay; visible scene
pixels behind it do not belong to the UI material. Similar source surfaces
may legitimately look alike: duplication findings must identify a missing
source-specific distinction, while ratio and invented-outline errors remain
independent defects. Recovering exact foreground alpha from one opaque
composite is underdetermined; a crop-reference experiment is not ground truth.


### Contour evidence before proportion blockers

Reference boxes localize materials; their aspect ratio is not necessarily the
visible artwork ratio. A sheet proportion blocker must describe the owned outline
on all four sides in both images, excluding padding and independently owned nearby
lines while retaining attached decoration. A box/ownership conflict is a separate
planning/localization issue, not proof of generation distortion. Unresolved ownership
still blocks. Neither this distinction nor a manual comparison promotes old reviews.


New sheet severity is program-owned: model observations use the structured schema
in `sheet_review_policy.py`. Full/near-full differences are advisory for static
composition. A disputed outline is a planning/localization blocker, not evidence
of generation distortion. No text matching or retroactive downgrade is performed.
Structured facts can still be misobserved; do not repeatedly review until a pass.


### Static readout grouping before internal state descriptions

A fixed readout card owns its backing, functional icon, progress track and current
fill in one material, with separate objects where needed. A standalone progress
control similarly owns its track and current fill. Describing fill amount does not
request an editable state component. Split only for explicit independent editing,
actual independent controls, replaceable content slots, selection markers or
scrollbar thumbs; different cards remain separate. M2 reports unsupported internal
splits with IDs and local regrouping evidence. Do not reduce material count to meet
a budget, or infer these exceptions from runtime behaviour absent in the image.
This is shared M1/M2 guidance, not a deterministic merger or a claim that models
will always follow it. Old plans and failed runs remain immutable.


### Deleted-label layout fallback evidence

When a full-reference result recenters an icon into removed lettering or changes
the owned button contour, an explicitly authorized local-crop edit is a candidate
fallback. Inspect that the crop includes the whole owned outline and original
label space. Keep the icon and backing as one rigid group; remove lettering
without collapsing its space, and do not treat scene pixels behind translucent
backing as owned artwork. Bind the changed inputs and concise edit prompt to a
new job and preserve the failed parent evidence.

A two-button crop-edit experiment passed one sheet review and extraction without
axis fitting or icon relocation. Both reference scope and prompt changed, so this
is not an isolated causal comparison or proof of general reliability. Full-image
reference remains the default. Material validation, composition and user visual
acceptance remain separate; an isolated repair does not promote a failed DAG.

A later one-card crop edit with an explicit 364:115 target still produced a visible
outline around 3.82:1 instead of the target's 3.17:1. Its transparent-margin gate
passed, but an aspect-preserving fit left the card too short. Crop-only input is
therefore not a general ratio fix. Report raw source geometry separately from the
fitted display; do not stretch an integrated icon-bearing card to conceal a
generation error. A read-only model review of that material failed on transport,
so it supplies no visual approval and must not be silently repeated.

An independently authorized follow-up supplied both the full reference for
context and the original card crop as geometry master. The raw visible outline
improved only to about 3.70:1, still 17.0% wider than the target ratio. A single
read-only visual review blocked its larger corner cuts and card proportions,
icon offset, and reported stray marks. Adding a crop alongside the full image
is therefore a candidate input change, not a guaranteed geometry correction.
Keep the generated outline and icon group intact for assessment; do not use a
nonuniform fit to make a failed integrated card look acceptable. Preserve the
failed review and obtain a fresh job authorization before any new generation.

The screenshot crop in this case has alpha 255 at every pixel, including the
outside scene and the translucent card interior. Its clean foreground layer
cannot be recovered by copying source pixels alone. The existing horizontal
frame-slice policy excludes a card with an integrated icon and progress group;
whole-card axis fitting would deform those rigid details. A future reviewed
plan may instead separate a stretchable empty backing from rigid icon and
progress artwork, then group compatible materials into generation sheets. This
is an evidence-backed fallback, not a change to the default static card split.
The backing still requires real generation and visual review; splitting itself
does not repair the previously blocked raw image or the canvas-edge lines.

One subsequent planning pass separated three aligned status-card frames but
placed the first frame's top edge on the status panel's separate header line.
Its 137-pixel material box was much taller than the other two 107/110-pixel
boxes; M2 returned no issue. A bounded repeated-card close-up now presents
source and overlay rows when one aligned box is markedly taller. It asks the
model to verify the real silhouette and owner, without treating size variation
alone as failure. This is a planning-evidence improvement, not a correction of
that already frozen snapshot.

A second planning pass bound this close-up to M2, yet M2 again returned no
issue for the first frame spanning the panel's header separator. An attachment
alone is therefore insufficient. For a new run, a strong repeated-card height
outlier is also a program relation issue. It triggers the existing bounded
same-session repair even when M2 is silent, supplies all three card owners and
their objects as context, and keeps repair-check/freeze closed until the
geometric suspicion is resolved. The check is deliberately narrow and remains
a suspicion about source ownership, not a programmatic verdict about visual
truth; a legitimately taller state may need an explicit planning decision.
The original runs, responses, and frozen artifacts remain untouched.


The first real run with this program gate stopped in repair-check: M2 asserted
the tall first card frame was correct, and repair preserved it. The failure is
safe but not yet an automatic visual correction. For future runs the bounded
card evidence also supplies two candidate edges derived from peer median
height (retain the outlier's bottom or retain its top). These are inspection
anchors only; the model must trace the card's own connected border in the clean
source and distinguish nearby container rules. A separate generic prompt
clarifies that exact Alpha cannot be recovered uniquely from one composite
screenshot and belongs to generation/composition visual review when ownership
and geometry are already clear. Genuine uncertainty about boundaries, overlap,
or ownership remains blocking. No run has been silently reclassified.

A subsequent run began with three well-aligned frames, so the outlier-only
focus was absent from M2 and rereview. M2 correctly found a separate progress
group misplaced over text, and the first patch fixed it; rereview then
mistook the first card's parent-container line for its own top. The second
patch recreated the height outlier and repair-check stopped safely. For new
runs, three aligned card frames receive one bounded row comparison even when
their heights match. The crop includes a small neighborhood above and below
each frame so nearby container lines remain visible beside the card's own
connected border. This is planning-review evidence, not an extra generation
reference, deterministic visual edit, or acceptance override.

### Canvas-edge hairlines

Do not infer a bright decorative frame or terminal tab from a faint horizontal
line at the viewport edge. M1 records only visible color, thickness and endpoints;
M2 compares these against the clean source and checks whether the line belongs to
the scene or a foreground owner. A real source had a dark, roughly one-pixel line
with strong local contrast while its generated scene lacked that line; the
foreground sheet instead invented thick cyan angular shapes. This is both a
planning-description and generation failure. Copying one exact reference row was
useful diagnosis, but its artwork reached the source boundary and triggered
`POSSIBLY_CLIPPED_SOURCE`. Adding transparent padding makes that generic gate
return processed without resolving provenance or restoring missing edge pixels;
it cannot be accepted or packaged. Any future source-derived path needs its own
explicit contract and validation for viewport-edge ownership. Existing image
requests, failed reviews and receipts remain unchanged.

### Translucent fields with luminous detail

Review the backing field and its owned bright lines, nodes and border
separately. A whole-layer Alpha multiplier may reveal more scene through the
field, but it also fades those highlights. Keep that diagnostic as a candidate,
not a generic automatic fix or evidence that the generated layer has correct
native Alpha. If the intended contrast cannot survive whole-layer fading,
correct the generated asset or revisit ownership; do not paint highlights back
in the compositor. The existing prompt already requests observed translucency,
so repeating that sentence alone is not evidence of a fix.
