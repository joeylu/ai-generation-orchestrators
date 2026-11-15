---
name: scene-kit-harness
description: Plan, run, review, or resume Scene Kit production, including reference-image depth, occlusion and editable-asset responsibility analysis for source generation and Studio recomposition.
---

# Scene Kit Harness

Follow the repository and Scene Kit `AGENTS.md` contracts. Use the local generation
CLI and its verified artifacts; Studio is a separate deterministic editor, not a
generation endpoint. Read [the Agent workflow](docs/agent-workflow.md) for the
current production sequence and commands. Use the CLI's own help and the relevant
versioned documentation for exact arguments and supported options. The checked
cross-project source rebind is a local programmatic API, not a documented CLI
command: inspect [its evidence and proposal implementation](src/generation/coherent-rebind-evidence.mjs)
and [commit entry point](src/generation/index.mjs) before using it.

## Choose the next step

- For changes to Studio editing, follow the [canvas interaction contract](docs/canvas-editor-v1.md).
  Exercise valid and interrupted input through the real browser with a synthetic
  project. Check the document and undo history for canceled gestures, text
  input, invalid fields, delayed imports and another window saving first.
  For edit latency, replay the same gestures on independent copies and measure
  compiler time and the wait until Studio is ready for the next edit. Check
  exact compiled digests and render behavior when reducing compile or draw work.
  For transport changes, measure response bytes, browser parsing and end-to-end
  wait on loopback. Smaller responses can add compression and decoding time.
- For [Studio environment generation](docs/environment-library.md), start from
  the requested foreground, platform environment, middle, far, or background
  group. Preserve the user's group through the frozen plan and project export.
  A missing visual layer is created when the asset is first placed.
- When reopening a scene for project editing with asset and animation
  generation, use `scripts/start-studio.ps1` and the project's local configuration
  described in [the local workspace contract](docs/local-workspace.md), with the checked kit
  and map, project workspace, matched style, and both local CLI workers.
  `coherent studio` is for delivery review. Before handing over the project URL,
  verify the running commit and project mode at `/api/studio-version`, then check
  the project identity, both generation entries and worker readiness without
  submitting a request.
- For [environment animations](docs/environment-library.md), distinguish first-pose
  registration from drift during playback. Preview the full loop against the
  static placement. When a tree, lamp, or similar object should stay grounded,
  select Fixed Base for that state and review the result before saving. The
  checked offsets translate whole frames against the first pose and preserve
  the original atlas. Leave original motion selected for intentional translation
  or a moving contact point. Reusing or aligning an existing frame sheet requires
  zero image calls.
- Match fidelity to the user's goal. Ordinary reference-inspired scene work needs
  recognizable masses, depth, recoverable occlusion and useful editable assets;
  it does not require matching every endpoint, span or minor architectural detail.
  Reserve tight coordinate tolerances for requested reconstruction or functional
  alignment. Do not escalate a harmless proportion change into another generation
  attempt. When the user changes the goal of an already frozen strict plan, keep
  its diagnosis and use an explicit [reference-intent review](docs/reference-intent-review-v1.md)
  for a fresh composition from the same checked PNGs. Inspect the whole result in
  Studio before judging whether the variation harms the scene.
  Record identity-bearing silhouette, dominant axis and material/color regions
  separately from minor seams or dimensions. Repeated family names do not prove
  interchangeable sources; distinguish visibly different members in their briefs.
  A compact volume becoming a long barrier is not merely a small detail change.
  When facing matters, record which visible face is on each side, the direction
  of projection or overhang, and the light direction separately. "The other
  side" does not preserve handedness; state the observed relation in the brief.
  Diagnose placement with a transform-only preview before attributing every
  mismatch to generation; a group translation cannot repair its internal spacing.
- For reference-image decomposition, read [the responsibility review](docs/reference-responsibility-review-v1.md)
  before choosing sources. Inspect the exact original image and inventory visible
  masses, negative spaces, contacts, local occlusions and independent editing
  needs. Decide source sharing separately from instance placement. Carry owned
  content/exclusions into final source scopes, source-owned features into the
  structure contract, and cross-source relations into the composition review.
  Register the backing visible throughout each major opening, not just its rim
  or a named far layer. Verify supported placement and collision behavior before
  relying on Studio to recover a source's massing. Compare the final reference
  and composition at the same display scale before changing material density.
  Inspect the compiled reference usage and group wording too; for a new fixed
  group without a measured reconstruction goal, use the explicit
  [scope-owned content profile](docs/source-content-v1.md) when a role or material
  template would add foreign subjects or discard owned members. It does not add
  coordinate tolerances or waive independent-editing needs. For a measured fixed
  group with multiple owned parts (including opposite-side parts), explicitly use the structure contract's
  `source-owned-feature-group-v1` option to retain those parts in the prompt.
  Missing ownership, impossible interleaving or a consequential unresolved hidden
  continuation stops the affected new plan before freeze. This is an Agent review;
  the literal observation-coverage checker does not implement an occlusion gate.
  After generation, compare every visible part against the owner list in both
  directions. Record foreign-owner content as a failed structure check and block
  adoption/recomposition even when PNG QA or feature fitting passes.
  After a source replacement, recheck its affected contacts, opening coverage and
  drawing order in the new composition. Earlier transforms or ordering may have
  hidden unwanted content; they are not evidence that the replacement fits.
  Preserve untouched sources and review the new native contour before placement.
  Calibrate complete sources from visible features and contacts, since inferred
  completion and weak Alpha tails can make an envelope fit misleading. Inspect
  the compiled platform placement too: grid snapping and initial clearance rules
  may shift it from the intended opening. Use supported undoable author edits
  and retain the candidate and edited-map identities separately. Fractional
  surface observations require explicit [author calibration](docs/coherent-surface-calibration-v1.md),
  never a silent rewrite of accepted coordinates.
  The older pixel-decomposition/GrabCut/SAM2 branches only propose visible ownership.
- Decompose appearance as well as geometry. Register each major depth group's
  broad-face value, color cast, internal contrast, edge/detail strength and any
  directional background gradient against the exact reference. Separate observed
  paint from inferred hidden lighting. Assign each effect to source paint, an
  independently editable atmosphere source or an explicit Studio operation; do
  not assume later assembly will restore it. Use the additive
  [reference atmosphere prompt](docs/source-appearance-v1.md#reference-atmosphere-prompt)
  when generic material wording would neutralize the selected appearance or add
  irrelevant detail to the sky. Review final compiled prompts for missing or
  contradictory layer rules before freeze. Compare native sources and the actual
  composition at the same scale: reasonable shape variation does not waive a
  lost depth/value hierarchy. Never prescribe dark foreground or blue distance
  universally; they must be observations of this reference.
- For new isolated transparent source requests, select
  `framingProfile: 'complete-silhouette-v1'` in the source-scope override (or
  `withSourceFraming` for an item revision). Reserve space for the actual contour,
  soft edges and owned effects; do not impose a universal margin percentage.
  Follow [source framing](docs/source-framing-v1.md). Historical frozen prompts
  remain unchanged, and continuous bands retain their own coverage contract.
- Translate the request into a brief and distinct asset/layer responsibilities.
  The reference constrains the intended style and scene; it does not make every
  source responsible for the whole picture. Record visible depth ordering,
  relative scale and important occlusions as well as named objects: a single
  complete source cannot be interleaved with another layer unless that relation
  is already in the artwork. Plan independently placeable sources where the
  reference or editing goal needs such interleaving. Keep inferred or unseen
  content clear.
- For continuations that need measured reference reconstruction, freeze named features and source-owned
  checks with [reference structure and feature calibration](docs/reference-feature-layout-v1.md)
  before changing source responsibilities. Carry the same sealed structure through
  revisions and cross-project continuations. A new support form that changes the
  canyon, opening or other dominant composition is a design change, not merely a
  grounding fix. Do not initialize a different workflow to evade a failed review.
  Measure homologous native features; missing or uncertain matches block the
  candidate. Use v6 composition and cheap `features-review` before full delivery.
  These checks evaluate supplied observations, not automatic vision.
  Cover significant internal members and the way they divide visible openings,
  not just the outermost feature points. An uncertain object's function does not
  make its observed position optional. A few well-fitted points cannot certify
  unregistered internal layout; failed visual structure checks still block it.
  If an existing frozen structure omitted a visible feature for a known owner,
  use a separately reviewed [feature supplement](docs/reference-feature-supplement-v1.md)
  to strengthen a new source plan. Retain the original structure and correction,
  regenerate the reviewed guide, and carry the supplement into v6 composition.
  It cannot change old points, tolerances, ownership or prior failure records.
  Re-measure all original and added features on each new output: improving an
  added member can still worsen the original group. Compare the complete joint
  fit and structural checks; never carry forward a previous image's passing fit.
- If an isolated fixed group needs a visual registration hint, use the optional
  [source frame guide](docs/source-frame-guide-v1.md). Review a frame containing
  all owned masses and named features, with explicitly inferred completion room.
  Bind any independently reviewed coordinate correction into the new source scope
  and carry it through the guide and v6 composition. Keep the full original as
  input 1. Do not impose continuous-band coverage on an isolated group to obtain
  a guide; its four-edge transparency and original feature tolerances still bind.
- For new landmark, scenery and foreground sources, select
  `scope-owned-support-v1` in the initial subject scope so support instructions
  remain subordinate to its actual content. Review the final source scopes before
  freezing; a temporary source-review preview does not change project inputs.
- When a continuous background band needs specific same-layer relationships,
  use [band feature relations](docs/band-feature-relations-v1.md) in a fresh
  plan. Convert observed reference distances only after considering the whole
  asset frame and finite camera coverage; review the generated source and
  recomposition, since the declared ranges are not automatic image analysis.
  For a source with such relations, use the documented interval review with
  measured feature locations and uncertainty before accepting the source;
  missing, uncertain or violated relations block that review.
- For a new landmark, scenery or foreground source, select
  `groundingProfile: 'scope-owned-support-v1'` in its explicit `sourceScopes`
  brief override before the first source freeze. This constrains generic support
  to the declared asset; it does not guarantee the image follows that scope.
  See [scope-owned grounding](docs/scope-owned-grounding-v1.md).
- If feature placement remains unreliable, a new v3 band can opt into the
  [feature-envelope guide](docs/band-composition-guide-v1.md). Review the exact
  neutral guide and feasible frame before freezing; after reception measure the
  actual source and use both required source reviews with the real placement.
  The guide is a hint, not proof that the model followed it or that the scene
  passes Studio review.
  Its explicit v2 spec also supports v4 open-depth bands and up to 12 numbered
  centers. If the model still changes the feature group size or closes the band
  into an island, reject it before downstream generation or packaging. Inspect
  the reference-to-source representation before proposing another compute plan;
  another guide or longer prompt alone does not establish a corrected stage.
  When the reference and source use different frames, the explicit v3 spec can
  map the accepted reference window into the actual band canvas and mark the
  unobserved reserve. Inspect its exact new raster before freezing. Preserve the
  original structure/targets and all later checks; this guide does not segment
  layers or guarantee that the model keeps registration. Distinguish identifiable
  source features from visibility boundaries caused by another layer. A hidden
  or uncertain source correspondence still blocks the candidate.
  For a reviewed v3 window spec with no `instructionProfile`, explicitly select
  `scope-owned-band-registration-v1` when the brief and reviewed feature ranges
  own registration. This uses the reviewed guide bytes and binds the reference
  structure for later placement. Use the brief to name only the actual layer
  and its inferred continuation.
  If the full-scene window causes neighboring depth layers to appear in the
  native source, use the v4 feature-markers guide for a new plan. Keep the
  bound source-owned landmarks and their placement tolerances. The raster
  supplies only numbered locations. The single-layer brief owns the silhouette,
  real openings and inferred extension to the finite cuts. Review the exact
  guide before freezing and recheck the original Alpha, source ownership and
  the actual camera range after reception.
- For a reviewed background master that already preserves reference registration,
  consider the [single-input master edit](docs/registered-layout-master-v1.md)
  instead of combining extraction and reframing in one request. Choose continuous
  painted depth versus real transparent openings from the artwork; pale canyon
  atmosphere is not automatically an Alpha hole. Inspect actual master feature
  crops before freezing native ranges. Retain the original structure/camera,
  source reviews and actual Studio acceptance; the master itself is not a final
  independent layer. Reuse unchanged accepted stages.
  When the transparent band has the right content and a specific feature is
  misplaced, use the documented local edit with its native parent and one
  bounded edit region. Check feasibility with the other observed features and
  finite cuts before freezing. Compare outside the region after reception and
  rerun feature, camera and composition checks.
  If a one-pixel canvas difference is the sole technical failure, preview a
  native-frame preparation with the unchanged raw PNG, measured feature
  intervals and a uniform placement. Keep the frozen world targets and check
  the original relative distances in world scale. After exact proposal review,
  adopt the preparation and continue with any unused source authorizations.
- When a new source must fit an already reviewed source, use the supported
  [source dependency](docs/coherent-source-dependency-v1.md) rather than
  describing an unbound PNG in the prompt. Freeze its source identity and
  intended transform; independently verify the final placement and contact.
- For a source used only as an appearance reference, select the separate
  `ai_scene_source_appearance_dependency_v2`: the source brief owns atmosphere
  and glow constraints. Existing v1 plans retain their original bytes.
- For a new reference-led source plan or an explicitly revised source brief,
  inspect the actual reference and run the explicit observation-coverage preflight
  before freezing or authorizing that source plan. Follow the executable template
  and stop rules in [reference observation coverage](docs/reference-observation-coverage-v1.md).
  For a new coherent project, opt in to the deferred-reference-review gate;
  it replays the exact reference and final source scopes before freezing. Recheck
  revised requests against their actual scope inputs. A missing observation or wrong responsibility blocks the
  affected new plan until corrected; do not apply this retroactively to old plans.
  This checks declared data, not automatic image understanding or art acceptance.
- When resuming, inspect the existing workflow, frozen plans, attempts and review
  evidence first. Separate sample production from general development. Reuse an
  unchanged artifact only after checking its identity and relevant evidence, using
  the supported rebind or preparation flow where applicable. Choose checks by the
  affected contract; see [incremental verification](docs/incremental-verification.md).
  Identify reused sources in the result; do not describe a rebind as a sample
  whose assets were all newly produced.
- If the first technically received reference exposes a missing source subject,
  use the bounded [same-project decomposition revision](docs/observed-reference-design-v1.md)
  before reference acceptance or any source freeze. Review its explicit spec
  decision, then reassess the exact original PNG and run deferred observation
  coverage. Never hide a missing major mass in an unsuitable neighboring scope,
  edit the original descriptors, or initialize another project to discard history.
- For a new image or changed request, review and freeze a new exact plan. Follow
  the user's existing authorization and the repository's single-use confirmation
  rules; reserve each request once before dispatch. Never transfer an old intent,
  alter a frozen plan, or retry a possibly accepted request automatically. Treat
  unknown outcomes as terminal and preserve their records. Stop the affected
  batch on technical failure or unknown outcome and retain unused authorizations.
  A new attempt after an unknown outcome requires a new user decision and plan.
- New coherent native terrain perimeter plans treat a sole Alpha=1 border
  touch as `TERRAIN_EDGE_ALPHA_ONE_GUTTER` when the outer two-pixel band has
  maximum Alpha 1 and the image contains an Alpha >= 8 body. Continue with
  the original PNG and record the warning. Use `gutterPolicy: 'alpha-one-gutter-warning-v1'`
  in direct native terrain plan options. Keep other failures blocking.
- For a historical strict-gutter result, follow the [separate preparation
  rules](docs/terrain-edge-canvas-gutter-v1.md) and retain its original QA.
  Measure controls and world scale in the original native frame.
- For one known technical failure in a current full native perimeter batch,
  use the explicit [single-role recovery](docs/terrain-edge-recovery-v1.md).
  Freeze one distinct plan with the exact same request, retain checked sources
  and unused authorizations, and obtain fresh digest-bound confirmation for the
  additional call and any increased budget. The replacement must pass before
  original unused requests continue. A painted nonzero-Alpha canvas is not a
  weak-tail gutter failure and cannot qualify through padding or Alpha cleanup.
- For a terminal unknown in a full native perimeter batch, the same recovery
  entry point requires the exact `terminalSha256` to freeze a separate
  replacement plan. Show that batch for a fresh single-use decision. Resume
  the original unused requests only after technical reception of the new plan.
- Review the actual native source for its intended content and composition as
  well as technical QA. A valid alpha or package does not establish semantic
  suitability, seamless joins, camera coverage or art acceptance. Record the
  relevant separate decisions through supported flows, without presenting an
  Agent observation as a human acceptance.
- Compare the complete reference with the actual Studio recomposition before
  presenting a production candidate: inspect the foreground, middle and distant
  depth separately, their relative scale, occlusion, contrast and required
  landmarks, plus brush use. Trace each material mismatch to its source scope,
  placement or rendering, and fix the affected stage. Check occlusion against
  the actual author/compiled draw stack and Studio output; asset-library content
  categories are not rendering order. Preserve the user's intended editing
  groups and align the author order with their intended front/back relationship
  through explicit undoable edits. An absent or uncertain
  observation blocks a quality claim; a source or package pass is not a visual
  pass. Use [recomposition review](docs/recomposition-review-v1.md) to record
  evidence and understand its limits; it does not recognize images or enforce
  a delivery gate by itself.
- For a new production workflow, opt in at initialization to
  `--final-review-policy studio-recomposition-required-v1`. Follow the linked
  review procedure to bind the real capture and observations to the exact
  delivery before final acceptance. Rejection remains available when the review
  fails; this policy does not verify brush gestures or prove visual judgments.
- Build and verify a fresh candidate from checked inputs, then inspect actual
  Studio output when available. Report missing checks and limitations separately
  from final human visual acceptance. Preserve originals, prior candidates, failed
  QA and attempts; do not edit logs or manifests to manufacture success.
  To resume the [coherent CLI](docs/coherent-v1.md) after source reception, give
  `continue` the measured composition, native perimeter controls and required
  band reports. Verify the exported archive and use `--capture true` to check
  the same delivery in Studio. Use offline fixtures to test this path end to end.
  For a cave or overhang, use the checked author terrain layout in the feature
  composition. Verify the opening and collision boundaries after compiling the
  actual candidate. A single measured top surface alone cannot encode an opening.
  After adopting an author layout, recheck terrain-bound props against the
  compiled surface. Use the visible base of each derived sprite and the chosen
  world contact to author an explicit transform. For a cropped foreground
  group, inspect how it enters the frame at the default camera.
- For a brush that must support a declared short span, run the explicit
  [brush footprint preflight](docs/terrain-brush-footprint-v1.md) before full
  delivery. The edge delivery APIs accept `footprintPolicy` to stop before
  material derivation and packaging. Keep that design budget fixed across source
  replacements. This only measures control dimensions; inspect actual material
  scale, corner/cap joins, a full repeat, short spans and real Studio separately.
- Before changing sources or seam parameters, follow the zero-generation
  [terrain join diagnosis](docs/terrain-join-diagnosis-v1.md). Isolate the actual
  shared surface, native upper corners, world body, walls and bottom groups.
  Include late supported top cover in surface isolation. If a thick cover or
  repeated lobe remains in the upper-corners-only view, shortening the shared
  cap cannot remove that source-owned form. Measure feature size after each
  source's native scale; equal texture density or scale fractions do not imply
  matching rock forms. Review a complete body and side repeat separately.
  Carry local cover/shoulder, bare-wall and underside responsibilities into
  new briefs without imposing another theme's cover substance or pixel rows.
  Preserve the minimum-span budget and distinguish source suitability from
  geometric continuity. An isolated diagnostic is not a new delivery or Studio
  acceptance; retain current user maps and separate human art review.
  When a reviewed material field mixes shallow cover with local deep overhangs,
  the optional [source-pixel surface cycle](docs/terrain-surface-cycle-v1.md) can
  test a selected native window without another image call. Keep its original
  row/column density, inspect closure and all grid phases, and record omitted
  cover and the shorter repeat rhythm. For a new checked candidate, use the
  explicit delivery surfaceCycle option and independent replay described there;
  preserve the base cap and its measurements, bind the effective render output,
  and keep `productionKit:false`. A same-source upper-pair replacement must use
  the delivery's checked upperReplacementBatchSha256 selection, retaining each
  source's original batch/preparation lineage. Never hand-edit cap references or
  turn a two-role replacement batch into a fictitious seven-role compute batch.
  Inspect internal selected-column stitches as well as the repeat wrap with the
  explicit surface-cycle review. Compare horizontal and depth-branch contrast
  with the original endpoint gradients, retaining raw and fade-weighted values.
  A quieter stitch can still produce a thicker shared-cover column on a short
  span; check cover depth and native-corner ownership separately. Theme-specific
  search scores must not become automatic window selection or artwork gates.
  For a narrow central cover column, follow the [short-cover contract](docs/terrain-short-cover-v1.md):
  measure nominal and actual source-over ownership, and recheck all seven roles
  before narrowing a join. Preserve native scale and PNGs. If uniform thinning
  creates a bridge band, an explicitly reviewed surfaceSpanEnvelope companion
  may reduce short-span coverage while retaining the v1 interface on long spans.
  Measure the whole continuous exposed top across grid/curve author boundaries;
  never restart the decision per cell. Keep old kits unchanged and review the
  resulting display approximation independently of source QA and human art acceptance.
  If a continuous material has arrived before its perimeter sources, run a
  material-only comparison at the target platform dimensions. Measure the
  visible accent separately from the sampled shoulder. Compare the full cap,
  measured lip and short-span coverage with the same body, UV density and
  contour. A source-wide accent can remain too thick after the shoulder is
  removed. Check exposed short-platform body paint and the reference at the
  same display scale before carrying a span setting into perimeter calibration.
  The authored opening can be verified at this stage. Its side and underside
  finish still needs the matching native sources.
  If deep cover returns only at a concave ramp, follow the separate
  [step-surface binding](docs/terrain-step-surface-v1.md). The old ramp still uses
  the complete cap. A new candidate may explicitly bind its coverage to the same
  native lip and complete adjacent span, retaining legacy full-cap support probes,
  geometry, original UV density and budgets. Never infer the span from ramp width
  or silently rewrite old kit behavior; check the remaining contact visually.
  If the remaining wall end has four constant-opacity stripes, compare its
  isolated source-over result before changing artwork. An explicit
  [linear end-fade v2](docs/terrain-step-end-fade-v2.md) preserves source quads,
  native UVs, row depth, support and budgets while interpolating coverage within
  the original wall overlap. It requires compiled v8, preserves old choices and
  can raise or lower coverage locally; do not describe it as Alpha-only reduction
  or as repair of native rock structure.
- Record the intended terrain contour independently of its material: straight
  manufactured edges, designed curves and irregular natural boundaries need
  different geometry. Trace both painted cells and authored curves through the
  selected derivation; a material brief cannot override a hard-coded contour.
  Review a newly painted span and its seams in Studio as well as the default
  scene. After changing the terrain renderer, check the brush card and its
  examples too: they must use the active compiler rather than stale tile artwork.
  Any inherited inset or texture displacement must match that contour
  intent before calling the brush visually accepted.
  For new coherent projects, follow [terrain completion](docs/terrain-completion-v2.md):
  put v2 `terrainIntent` in every ground source scope, explicitly choose a limited
  material study or a complete brush, then bind measured `terrainRendering` in
  composition. The CLI requires this for new projects; programmatic initialization
  must select `explicit-terrain-completion-required-v2`. Existing v1 plans retain
  [their contour-only contract](docs/terrain-intent-v1.md).
  Use `reference-defined-manufactured-v1` for new manufactured perimeter plans.
  Match the front-face substance, seams and attached details to the accepted
  scene reference, checked native material and each role brief. Review all seven
  prompts for conflicting material defaults before freezing. Use identical
  profile arguments for preview and freeze.
  Missing intent or an incompatible shared-material responsibility stops freeze.
  Rigid/authored contours require zero procedural inset; natural irregularity
  requires an observed bounded choice. Never infer it from the material name.
  Missing render settings stop delivery rather than restoring legacy tiles.
  Contour control and perimeter artwork are separate responsibilities. A shared
  body/cap field can remove unwanted ripples while still exposing straight cut
  sides and undersides. Before promising a reusable brush, inspect both side
  terminations, top-to-side corners, underside and bottom corners. Record exposed
  segments and the source/profile that finishes each one; a cropped field edge
  is not a finished manufactured end. Straight industrial geometry may still
  need painted thickness, a modest bevel and an attached cap termination.
  For arbitrary painting or visible undersides, declare seven native roles, their
  content/exclusions and source-owned appearance before freeze. A missing role
  blocks a new complete-brush plan. Delivery also requires the matching checked
  native sources and measured union/side/bottom controls; a limited material study
  must be explicitly scoped as such, never used to downgrade a complete brush;
  a shared-field test pass cannot close that gap. Reuse the checked body/top
  material and original reference, preserve lighting handedness, and review the
  native-edge renderer separately before replacing a shared-field candidate.
  Test free ends, side contacts, narrow spans, concave turns and bottom contacts:
  only exposed boundaries receive a finish; adjoining solids must not retain an
  internal seam. Do not mark this complete from a flat-span screenshot alone.
  Inspect the generated material too: the contract cannot straighten a wavy seam
  already painted into the source. Preserve old plans and separate art review.

For alpha or perimeter issues, use the applicable diagnostics and explicitly
reviewed preparations in [Scene Kit's contract](AGENTS.md). The optional
[perimeter topology guides](docs/terrain-perimeter-topology-guide.md) are hints,
not proof of model compliance, native collar quality or seamless artwork.

When independently generated perimeter rock forms cannot share the body's
material scale or registration, the explicit
[shared-material grid prototype](docs/shared-terrain-field-v1.md) can isolate
that structural question using existing checked materials. Keep it in a fresh
kit/project and label its contour as designed geometry. Its current grid-only
scope, raw-source preservation and `productionKit:false` must remain visible;
smooth shared sampling is not proof of natural relief or final Studio art.

For remaining bridge/side rock-scale or long-wall repeat defects, follow
[form-scale and repeat review](docs/terrain-form-scale-repeat-v1.md). Separate
world/texel from observed rock size and intended cliff/platform hierarchy.
Scaling native edges requires the complete joint, envelope and short-span checks.
For complete-source native walls, distinguish source height, repeat window and
the recorded wallRepeat.stepWorld; a longer checked step changes copy density,
not the forms already repeated inside the PNG. Inspect the wall repeats for
painted top or bottom trim. Assign horizontal terminal trim to the native
corner or bottom role unless the reference shows it repeating up the wall.
When existing walls contain suitable middle rows, select
`junctions.wallRepeatProfile: 'native-alpha-repeat-window-v1'` and measure
each wall's `repeatY` on the original PNG. Compare both ends of the window,
the first corner overlap, any bridge underlap and a long repeat in Studio.
For a dark stripe across the body, inspect the nearby rows on both sides of
the repeat boundary. Matching the first and last row can still leave a band
inside each repeat. Use the checked rigid row selection when the actual
manufactured body contains a compatible interval.
If only a wall needs revision,
use [checked side subsets](docs/terrain-side-source-selection-v1.md) to retain
the other original roles and their preparation evidence. This does not extend
to new bottom-role subsets or transfer a generation or art decision.
At bridge openings, identify the native source roles that actually draw the
contact before targeting a corner source. A concave endpoint can extend a wall
under the bottom cutback while convex lower corners remain at the pillar base.
Use the [role-level diagnostic](docs/terrain-join-diagnosis-v1.md#同一绘制组内再按来源角色隔离)
when whole-group omission mixes these responsibilities. Compare a normal view
and a contact-only camera; an unchanged omission view is local negative evidence,
and removing a contributing edge is a diagnosis rather than a repaired opening.
For a fixed phase counterfactual, use the read-only body-phase diagnostic so
body wedges and shaded body bands move with the main body. Keep cap/native UVs
fixed and compare several contacts; local improvement can disrupt body/cap
registration and does not establish a usable global phase or matching rock forms.
For a body loop, review its internal source-row cuts, horizontal cut branches and
shifted source X wraps as well as the output wrap. Three translated phases retain
one finite source's forms; a longer full period does not establish new variation
or continuous broad rock structure. Keep measured contrast advisory.
At the measured rock scale, record how much continuous source depth is available
before the first repeated-fill row. Compare the unmodified field and a small set
of explicit loop hypotheses at the same density. Keep a loop provisional when
it removes straight bands but replaces them with visible cuts through broad
faces. Set any revised material brief from the needed usable body depth and the
shape progression at that scale. Image height alone does not establish usable
depth.
If the checked PNG has more usable rows beyond the standard body window,
sample the extension at the same X window, origin and world units per texel.
Compute its display period from the retained sample count and that density.
Compare direct repeat and any loop across their full display periods. For a
fixed map, also compare a contiguous window that contains all rendered body
positions with room for filtering. Record its world bounds and test the actual
short platform and opening with the same cap. This verifies vertical wrap
avoidance for that map. Arbitrary brush edits and horizontal wraps still need
their own evidence.
When measured sampling needs a different canvas or transition depth, set
`contentProfile: 'scope-owned-material-sampling-v1'` on the explicit ground
brief. Describe the target aspect, the thin cover and its attached shoulder,
the continuous body depth and the broad-face scale in that brief. This option
lets those observations control the request instead of the template's fixed
surface fractions. The model's native PNG still needs measured source review
at the intended scale before the perimeter is planned.

For a complete checked scene that retains authored curves as well as grid
painting, use the explicit [v2 terrain delivery](docs/shared-terrain-delivery-v2.md)
through `scene terrain-deliver` and `terrain-verify`. Bind the resolved material
and reviewed profile, keep the whole default scene and environment layout, then
check actual brush/curve edits, undo, reload, browser download and independent
project import. The v1 grid prototype does not gain curve support retroactively.
Mixed patches remain unsupported. Reused sources stay identified as reused;
technical closure never records final human art acceptance on the user's behalf.

For new reference-led v2 candidates, select `placement-required-v1` and
record meaningful source and frame regions for required visible forms. Run the
placement check on the exact final author map after all scale, depth and layer
edits. A blocked report keeps the candidate out of the delivery ZIP. If an
opaque neighboring layer hides an inseparable required feature, correct source
responsibility or placement before proposing a new candidate. Inspect exposed
curve sides and a full material repeat in the real Studio, including world edges
and painted contacts, before reporting the visual result.
When the author has free framing, choose `framingPolicy: 'report-only'` and
review depth and visible details independently from cropping. Record which
forms are expected to sit behind, touch or overlap each other in the reference.

When a checked brush is used in a level, walk the authored route with the
normal game viewport. Inspect short landing surfaces, underpasses and long
walls at their intended camera distance. Use the [single-map export](docs/authoring-v1.md#4-便携目录包)
to bind the scene and original kit for handoff. Geometry checks use declared
character dimensions and paths. Verify movement and jump feel with the target
game's character controller and collision settings, and keep the level review
separate from the source kit's human art acceptance.

## Record a timed sample

For a new timed sample, use an independent sample and project; when resuming a
timed sample, preserve its existing identity and history. Record start/end
timestamps and elapsed time for each observed stage, image-call count
and tool round-trip time, and distinguish execution from review or investigation.
Identify overlapping and unclassified time rather than attributing it by guess.
Keep technical, semantic, Studio and human acceptance outcomes separate. State
the sample and conditions for comparisons; a single observation does not prove
an end-to-end speedup.

The deterministic programs own state, reservations, processing, validation,
checksums and packaging. Do not bypass a gate, repair a ledger by hand, or imply
that a candidate or a historical result has passed a check that was not run.
