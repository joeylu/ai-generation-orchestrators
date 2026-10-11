# Explicit host delivery

For final-composite human acceptance, new runs can set `visualReviewMode=warning`.
This freezes v5 visual findings as warnings throughout planning, material review
and measurable uniform fitting, and uses a shared prompt contract to prevent
duplicate ownership and surface/detail confusion. Technical integrity remains
mandatory; see [visual warning policy](VISUAL-WARNING-POLICY.md).

New fresh-reference host runs freeze
`planningCapacityPolicy=source-geometry-request-capacity-v1` and, for sheets,
default to `generationGroupingPolicy=compact-controls-context-grid-v5`.
The latter admits compatible complete cards that own illustrations, keeping
each card's frame, illustration and attached symbols together. These cards use
their own grouping family, conservative size/aspect compatibility, full reference
resolution, transparent margins and at most six members. Flat controls, scenes,
logos, unknown artwork and incompatible large materials do not join that family.
Explicit older grouping policies retain their original results.

v5 applies size/aspect compatibility to flat controls too, preventing a large
rail and tiny readouts from sharing one common-scale sheet. It permits one unused
slot to keep prime member counts in a balanced grid; the unused slot must still
pass the empty-cell gate. Some plans need more calls than v3. Actual counts are
reported before M2 and compute; the frozen budget is never increased silently.
All sheet sizes now budget the original context rim and board padding before
M2, so every planned sheet fits its combined input board at full resolution.
Explicit v4 grouping retains its previous dense-only board budget.

New context runs use `contextPromptVersion=v13`. Backgrounds receive the original
full reference once and a direct UI-removal edit prompt, with composition and
visible-subject positions held fixed. Scene descriptions and generic foreground
reconstruction guidance are omitted. `preserve-underlay` and exact `preserveText`
exceptions remain explicit; v1–v12 prompts retain their original bytes.
Foregrounds, sheets, cleanup edits and appended policy/layout instructions also
remove unnecessary elements and preserve the original assigned subject, without
reconstruction or surface-completion requirements. Owned width/height stays bound
before transparent padding. Foregrounds explicitly remove background-owned people
and scenery; owned illustrations retain their subjects. Sheet board prompt v5
places each cell's text-removal requirement before KEEP, including CJK labels
and glyph effects. See [fidelity fixes](FIDELITY-FIXES.md).

M1 receives the frozen image/review limits. After its original answer is verified,
the program writes `planning-capacity.json` from source pixel geometry **before
preparing or reserving M2**. `host-status.planningCapacity` reports material count,
actual grouped request count, sheets/standalone counts and downstream budgets.
The estimate does not certify visual correctness. If a true capacity shortage
remains, it is terminal before M2 or images: the program never silently raises
the budget, omits materials, downsamples them or retries a model. After M2, the
actual frozen groups must exactly match this report before image execution is
prepared. Historical jobs without this policy are not migrated.

New warning reviews bind `coverageTextPolicy=exact-fragments-occurrences-v3`.
Retained sign lettering and removed business titles can share word fragments.
The program preserves the original plan and response, records each overlapping
pair as `COVERAGE_PRESERVED_TEXT_CONFLICT`, and carries it into the delivery's
planning warnings under the explicit v5 policy. It never asserts a visual pass
or silently resolves that ambiguity. Invalid owners, missing fragments, invalid
schemas, evidence changes and accepted/indeterminate requests still fail.
Repeated fragments are retained as separate occurrences in their original order;
they are not deduplicated or repaired. Strict reviews and historical v1/v2 text
contracts keep their original behavior.

New local warning runs freeze `bodyReviewPolicy=final-composite-first-v1` and
`materialReviewPolicy=final-composite-once-v1` by default. After native images
arrive, the program checks sheets and exports the candidate layers, registered
viewport, comparison and ZIP before any visual material review. It then enters
`composite_review`, a single independent model scope (`maximumCalls=1`). No
per-request material model calls or body jobs are created. Placement uses
explicitly unobserved alpha proxies; completeness and
visual acceptance remain unverified. The terminal status is diagnostic, even if
all sheet cuts succeeded. Set `materialReviewPolicy=per-request-v1` for the
previous review protocol; additionally set `bodyReviewPolicy=every-reviewed-foreground-v1`
to request exhaustive body observations. Historical configurations missing the
new material policy retain their frozen per-request behavior.

The final scope supplies `currentRequest.requestPath` pointing to
`final-review/request.json`. Its `packetPath` contains one inline prompt/schema
and three ordered images: full original reference, final recomposition, and
candidate material atlas. Known material IDs include excluded candidates so a
reviewer can report missing layers. Return the unchanged JSON answer with
`summary` and `findings` (`category`, `materialIds`, `evidence`). The response
schema is in the packet; do not invent acceptance fields or exhaustive per-item
observations. The independent call uses the frozen material model/reviewer.
An empty findings list never certifies every cutout or human acceptance.

The host attestation kind is `ui_host_composite_review_attestation_v1`, with
`requestSha256`, `responseSha256`, `reviewerId`, `materialAuthors`, `model`,
`effort`, `independentCall=true`, `hostAssertedModelResponse=true`,
`notProviderReceipt=true`, `notCryptographicallyPlatformVerified=true`, and
distinct `dispatchEvidenceSha256` / `returnEvidenceSha256`. Model review costs
one slot in `maximumMaterialReviews`; it does not consume one slot per image.
Visual findings are warnings; schema, identity, receipt and hash errors remain
terminal without resubmission. The immutable pre-review report is retained;
`final-composite-warning-report.json` adds the actual final findings. Review
never mutates the candidate artwork or ZIP. `host-status` reports
`compositeReviewCalls`, `compositeReviewCompleted` and
`perRequestMaterialReviewCalls=0` separately from visual acceptance.

New fast warning runs with fresh reference planning default to
`layoutPlanningPolicy=fresh-m1-layout-contract-v1` when no layout sidecar is
supplied. M1 then produces
`layoutRegistration` with its material plan, M2 checks the original declarations,
and the program freezes them before the first image reservation. This requires
no old layout sidecar or extra planning call. Declared panel structure also
enters the initial generation prompt, including section bands and surface gaps.
See
[automatic layout](HOST-LAYOUT-AUTOMATION.md).

New host planning reviews with `layoutRegistration` bind
`reviewIssueIdPolicy=declared-layout-issue-ids-v1`. Finding IDs may name materials,
objects or exact constraint IDs declared in that source plan. The response schema,
receiver and offline freeze verification share that whitelist; invented IDs still
fail. The review packet also binds a byte-identical clean full reference beside
its overlay and focus images. Geometry findings remain warnings only under the
explicit warning policy. Historical packets without this field retain their
original schemas and identifier scope; failed answers are never repaired or
received again in place.

The same new local warning configurations freeze
`materialPreparationPolicy=record-native-clipping-for-diagnostic-v1` and
`identityObservationPolicy=record-observed-subset-for-diagnostic-v1`. Only a
revalidated native-alpha `POSSIBLY_CLIPPED_SOURCE` suspicion may continue from
blocked preparation; its producer result remains blocked and receives no model
review. A truthful ordered unique subset of observed material identities is
retained as `diagnostic_unresolved_material_identity`, with complete schema,
ownership, original response and provenance checks. It cannot pass formal
extraction or supply body anchors. Wrong IDs, ordering, duplicate IDs, malformed
observations and changed evidence still stop. No retry or answer repair occurs.

Batch verification shares a verified source job and snapshot only within one
read operation, then hashes the input set again before returning. There is no
trust cache across operations.

The explicit `materialReviewPolicy=per-request-v1` path retains the following
per-request scheduling protocol. New local warning runs freeze `maximumConcurrentMaterialReviews=3`; other new
runs default to 1. An explicit integer from 1 to 4 overrides this limit before
the configuration and authorization scope are frozen. This changes dispatch
concurrency, not the number of model calls: every generation request, including
a whole sheet, still gets one independent review in this explicit profile.
Planning, final composite review and body observation retain serial reservations.

New local warning runs also freeze `maximumConcurrentImageCalls=3`; other new
runs default to 1. An explicit integer from 1 to 4 overrides the image limit.
In the image stage, `host-next --count 3` reserves up to three distinct image
requests with individual frozen arguments and submission digests. The host
dispatches those image-tool calls concurrently and receives each original PNG
separately, in any order. `availableImageSlots` exposes free usable slots.
One receipt frees only its own slot; pending requests are never eligible again.
The total `maximumImageCalls` budget and sheets grouping remain unchanged.
An unknown or failed request stops new dispatch; preserve late actual results
at the host without resubmitting. Historical image jobs missing a concurrency
field remain serial. Direct experimental jobs are serial unless prepared with
`--max-concurrent-calls`; their `next --count` uses the same bounded reservations.

Use a rolling host loop rather than a barrier after each group of three. Call
`host-receive --run RUN --digest SUBMISSION --response ORIGINAL.png --refill-images`
as soon as one native image returns. After committing that receipt, if the image
scope has another ready request, the result includes `nextImageRequest`: a new
reservation with exact frozen arguments and its own submission digest. Invoke it
once immediately while the other calls continue. The final image receipt advances
to the usual downstream stage and has no refill. This flag grants no authorization
and does not change prompts, reference boards, counts or concurrency limits.
The returned status describes the receipt; use `host-status` when a fresh snapshot
after the refill reservation is needed. Keep one coordinator per run.

Python hosts can use `host_image_dispatch.run_images(run, invoke)` for this loop.
Its explicit async adapter receives the reservation and returns the original PNG
path; the host remains responsible for invoking its configured tool, time bounds
and original tool evidence. The helper uses at most three calls or the smaller
frozen limit. It never authorizes a scope or replays an outstanding reservation.
Adapter failure stops refilling, drains other original returns, then terminalizes
the run. A failure observed during receipt verification prevents invocation of a
refill already reserved in that interval; its digest is reported separately.
Interrupted/invalid receipts remain subject to the existing terminal rules.

Host operations reuse pure snapshot, preflight and board-building results within
that one operation. Every reuse hashes the current complete input tree, including
optional file inventory; size/mtime alone never establishes identity. Changed,
added or removed inputs invalidate reuse. Linked trees fall back to full checks.
The cache is discarded at operation end; attempts, receipts, authorization and
final package/checksum checks are never cached. M1/M2 content and review coverage
are unchanged. This optimization is not cross-run planning/material reuse.

New runs also freeze `materialReviewDispatchPolicy=inline-material-review-packet-v1`.
Each material scope row supplies `reviewPacketPath` and `reviewPacketSha256`.
The program-produced `dispatch.json` contains the exact frozen prompt, response
schema, comparison metadata and ordered image list with fingerprints. The host
passes its contents and **all** listed images directly to one independent visual
call. The reviewer returns JSON; it does not need a shell, Python discovery,
repository reads or local schema validation. The receiving program validates
the original answer bytes. Ownership evidence remains mandatory for every
assigned object; keep each observation concise and concrete. Protected regions,
texture exceptions, reuse rules and extra diagnostic images remain bound.
The host must bind the actual outer request hash and preserve the genuine
dispatch, return and original response evidence as before. A packet is input
preparation, not proof that any model executed or accepted the result.

After authorizing the scope, `host-next --run RUN --count 3` reserves up to three
distinct available material requests under one lock and checkpoint. It returns
`reservations`, each with its own `currentRequest` and `submissionDigest`.
Without `--count`, the single-request response shape is unchanged. The host may
dispatch reserved reviews concurrently and call `host-receive` separately in any
return order. `host-status` exposes `outstandingRequestIds`,
`unreservedRequestCount` and `availableReviewSlots`; `ready` can coexist with
outstanding calls when another unreserved request fits the bound. Once all slots
are occupied it reports `awaiting_result`. Never submit an outstanding request
again. A count exceeding free concurrency slots fails before any reservation;
fewer remaining unreserved requests yield a smaller batch. Unknown acceptance,
timeout or technical failure remains terminal for the run, including when other
reviews are outstanding. Preserve late answers at the host; do not redispatch.

To retain serial dispatch and separate reviewer files in a new run, set
`maximumConcurrentMaterialReviews=1` and
`materialReviewDispatchPolicy=separate-material-review-files-v1`. Historical
configurations/scopes without these fields retain their serial behavior and are
never migrated. The CLI prepares reservations only; the host must actually use
concurrent calls to realize the wall-clock improvement.

Fresh approximate runs use [body observation v3](BODY-SOFT-EFFECTS.md), separating
the semantic body anchor from explicitly observed external shadows/glow. The
frozen `bodyCoveragePolicy=observed-external-soft-effects-v1` is rechecked during
receipt, processing and packaging. Strict and explicit v1/v2 profiles retain
their coverage gates; old failed jobs are never migrated.

`ui_layer.py host-run --config CONFIG.json --output NEW_RUN` prepares a separate
provider-neutral workflow. Set `planningMode=fresh-host-m1-independent-review`
to start with a new model-generated M1 plan from the original reference. The
host dispatches M1 explicitly and returns its original answer before the program
prepares independent M2 review. Omitting this mode retains the explicit offline
seed workflow; that mode never claims M1 model execution. Existing DAG commands,
strict runs and candidate runs retain their behavior.

For new workflows, explicitly set `generationMode=sheets`, which is also the
runtime default. The workflow performs independent planning review, freezes
grouped requests with context crops and v12 reference-edit prompts,
acquires native images within the frozen concurrency limit and follows the
frozen review profile: one final composite review for new fast warning jobs,
or explicit per-request review and exhaustive foreground body observation.
It preserves material storage, packages an original-size viewport, and
creates a three-way comparison. It never calls a model or native generation tool.

The JSON configuration requires `original`, `contract`, `viewer`,
`candidateAuthors` and `materialAuthors` arrays of opaque identities. For each of
`planning`, `material`, and `body`, provide `Reviewer`, `Model`, `Effort`, and
`Destination` fields with that prefix. Reviewers must be independent of the
corresponding authors. Provide an explicit `imageDestination` and finite integer
`maximumImageCalls`, `maximumMaterialReviews`, and `maximumBodyCalls` (1–128).
Optional `planningNotes`, `visualPolicy`, and `visualTextures` are snapshotted.
The offline mode additionally requires `seed`. Fresh M1 instead requires an
opaque `m1Planner` identity and `candidateAuthors=[m1Planner]`. It forbids seed,
reviewed snapshot, material reuse, preplanned texture regions and preplanned
background regions. Its initial model request contains only the original PNG,
locked v5 schema and a prompt compiled from the locked planning contract,
explicit policy and notes. It supplies no old plan, layer count, coordinates or
generated image. M1 uses the configured planning model, effort and destination.
`maximumModelCallSeconds` defaults to 1800 and `maximumImageCallSeconds` to 900;
both must be positive integers no greater than 3600. The host enforces these
deadlines. Timeout or unknown acceptance consumes the reserved invocation and
requires terminal failure reporting; it never permits another submission.

New host runs freeze `sheetSeamPolicy=nearest-unique-transparent-seam-v2`.
After the existing alpha-0/1 preparation, each seam must have two adjoining
full-span transparent pixel lines within the original quarter-cell search range.
When noise divides a gap, select the uniquely nearest safe cut to the nominal
grid seam. Equal-distance ties, no transparent cut, nonempty unused cells,
missing artwork and source/cell boundary alpha fail independent extraction. No noise
pixel above the existing floor is erased or relocated. A hashed partition proof
reconstructs every prepared RGBA pixel, including unused cells, and is bound into
the independent material review inputs. That review must still establish cell
identity and ownership; a transparent partition does not certify correct artwork.

New `visualReviewMode=warning` runs additionally freeze
`sheetFailurePolicy=continue-reviewed-materials-on-sheet-warning-v2`. After all native
images arrive, the program checks every sheet before reserving material reviews.
Contour/boundary contact, ambiguous gaps, nearest-cut ties and nonempty unused
cells produce warnings for the affected requests. With `materialReviewPolicy=per-request-v1`, all other requests continue
their independent material reviews and, when explicitly requested, genuine body observations within the
frozen budgets. The program then exports a mixed diagnostic using reviewed
sources and available observed geometry for unaffected materials. New local runs
freeze `sheetCompositePolicy=detect-alpha-floor-preserve-raw-sheet-cells-v2`:
sheet checks and diagnostic splitting share `sheet-alpha-floor-v1`, clearing
only alpha 0/1 pixels in a detection copy before finding seams. Material sources
retain every nonzero raw RGBA pixel, including alpha=1 glow tails, with two-pixel
transparent guards; hidden RGB at alpha zero is cleared. Raw sheets/capacity crops,
detection sheets/cells and guarded rendering cells are archived separately;
both raw and detection partitions have reconstruction evidence. Explicit
historical `exclude-uncertain-sheet-cells-v1` retains its raw partition behavior.
Failed candidate
partitions are preserved as evidence, excluded from the composition and listed
in `excludedUncertainMaterialIds`. Constraints requiring those missing materials
remain unresolved. No generation is repeated.
It retains all original PNGs and pixel-exact capacity cells, including unused
sidecars, and produces an original-size viewport, comparison and ZIPs under
`diagnostic-output/`. Original raw alpha is retained in evidence; equal-grid diagnostic
crops may cross artwork and are explicitly **unverified candidates**, never
normal independent layers under the new policy. Older contracts without this
field retain their previous diagnostic rendering. Missing materials do not count
as a complete delivery; see [fidelity fixes](FIDELITY-FIXES.md).

The terminal status is `diagnostic_complete_pending_visual_acceptance`, with
`diagnosticExecutionCompleted=true`, `independentMaterialDeliveryComplete=false`
and both `FullAutomationExecutionCompleted` and
`FullReferenceToDeliveryExecutionCompleted` false. `visual-warning-report.json`
identifies affected request/material IDs, continued review/body call counts and
the genuine observations replayed. The export/replay itself makes no calls.
This is a reviewable diagnostic delivery, not a passed independent-material
package. Missing artwork, invalid PNG/alpha, source/receipt/hash/path failures
still stop. A new strict run defaults to `sheetFailurePolicy=stop-v1`; an explicit
`stop-v1` also retains this behavior in warning mode. Historical configurations
without this field retain their original stop behavior and are never migrated.
Explicit `diagnostic-on-sheet-partition-warning-v1` retains the old immediate
zero-compute diagnostic branch. It skips all downstream reviews and uses proxy
geometry; it is no longer the default. Diagnostic body subsets cannot finish
the formal body-delivery API. Invalid review or observation evidence remains terminal.

New v2 warning runs also freeze
`bodyUnresolvedPolicy=record-unresolved-body-for-diagnostic-v1`. A genuine,
schema-valid `uncertain`/`not-whole` body answer is consumed once and retains its
`blocked_no_retry` seal. Other materials continue; this owner receives no invented
body contract and remains a proxy in the final diagnostic. The same disposition
applies when every sheet cut succeeded. Missing declarations, invalid coordinates,
wrong reviewer/hash/attestation, timeout and unknown transport still stop. A body
job with unresolved owners cannot finish formal delivery. Historical jobs without
the field keep their existing terminal behavior.

New v8 background prompts lock the original full-canvas composition, camera and
visible subject scale; UI removal must not enlarge or relocate scene subjects.
Continuous-panel prompts distinguish panel tint/alpha from scenery seen through
it. These instructions require new generation to evaluate; offline regressions
verify their frozen presence, not image-model compliance or visual equivalence.

Explicit `sheetSeamPolicy=strict-unique-empty-band-v1` retains the one-band rule.
Old host configurations without the field replay v1; standalone extraction and
existing frozen evidence retain their existing rules. Failed runs are not resumed
under this new runtime.

Set `canvasPolicy` to `expanded-support-original-viewport-v1`,
`canvasPolicyInstruction` to the actual approved user instruction, and
`canvasPolicyInstructionSha256` to SHA-256 of its raw UTF-8 bytes. Set
`backgroundPolicy` to `uniform-whole-canvas-opaque-contain-edgepad-v1` to freeze
uniform whole-background containment with source edge extension. The viewer
directory must supply `viewer.html` and `viewer.js`. Only locked planning schema
and prompt files are imported from the contract.

Use `host-status --run RUN` to inspect the next stage and its scope digest.
`host-authorize --run RUN --digest DIGEST --approval TEXT` binds explicit approval
to that exact scope. `host-next --run RUN` reserves one exact request before the
host independently invokes its configured tool. Repeated `host-next` cannot
resubmit a pending request. Each enabled stage has its own bound scope authorization.
The new final composite policy creates one model reservation after packaging.
Under the explicit per-request policy, material review is one
aggregate scope frozen after all images are received; it binds every actual
request and attachment, then reserves distinct reviews within its frozen
concurrency limit. Every request remains single-use.

New material review reference/generated observation attachments display native
PNG alpha composited on an opaque neutral checkerboard. Their mapping metadata
and PNG bytes are fingerprinted; the original PNG and continuous alpha remain
unchanged pixel authorities. This prevents hidden RGB or nearly transparent
fringe from appearing as solid extra artwork in an alpha-ignoring viewer. Review
findings still describe visible missing, foreign or distorted artwork under the
frozen policy. Existing frozen requests and failed runs are not changed or
reclassified by this display preparation.

For a new plan of simple UI controls, opt in with
`generationGroupingPolicy=compact-controls-context-grid-v1`. It keeps delivery
identities separate but packs up to six owners per fully occupied equal-cell
sheet by geometry: narrow strips, wide controls, compact controls or continuous
surfaces. It allows different control kinds on the same sheet and keeps a common
uniform scale with 10% free space on every cell side. A candidate group is rejected
if any owner would fall below its reference pixel size at the planned 1536-pixel
canvas limit. Backgrounds, illustrations, cards, logos and unknown objects remain
standalone. Large panels may therefore remain standalone for resolution, rather
than because their kind forbids grouping. This opt-in does not establish visual
fidelity; genuine request review and final composite acceptance still apply.
An absent field retains the historical same-kind, four-owner context strategy.

Return genuine original bytes using `host-receive --run RUN --digest
SUBMISSION_DIGEST --response FILE`. Model responses additionally require
`--host-attestation`, `--dispatch-evidence`, and `--return-evidence`; their typed
formats are the existing host review/material/body protocols. Host attestations
are explicitly local assertions, not cryptographically verified provider
receipts. Response construction belongs to the independent host, never this
workflow. A failed or unknown dispatch is terminal through `host-fail --run RUN
--digest SUBMISSION_DIGEST --reason TEXT`.

## Formal body observations and uniform fitting

Diagnostic placement gaps are now measured after rendering and recorded as
nonblocking warnings. For an existing sample, the independent
[`revise-layout-candidate` step](DECLARED-LAYOUT-CANDIDATES.md) can reuse verified
sources with explicitly declared frame sizing, internal row landmarks and
related-control constraints. This candidate does not replace formal body
observation or alter a historical frozen run's preserve-sizing contract.
New fast warning runs can now execute it automatically using a frozen
[`layoutContract` planning sidecar](HOST-LAYOUT-AUTOMATION.md), with no additional
model calls. The selected delivery path and final comparison follow the corrected
candidate; absent declarations retain the base diagnostic with a warning.

Fresh approximate host runs default to
`bodyObservationPolicy=host-body-observation-soft-effects-v3` and the explicit
exterior-support contract described in [body effects](BODY-SOFT-EFFECTS.md).
Strict runs and explicit v1/v2 profiles retain their corresponding rules.
Each foreground request binds the raw source, full reference,
ownership crop, actual-alpha checker/light/dark RGB composites, alpha display,
schema, prompt and coordinate mapping. Verification reconstructs the display
pixels from the unchanged native PNG. Alpha extent never defines semantic geometry.
The v2 answer adds required `geometryDifferences` and `materialIssues` arrays.
Measurable size/aspect differences and permitted minor appearance differences are
retained with their response SHA in the output configuration and package review.
Unreliable/incomplete correspondence, missing/repeated content, wrong ownership
and major/uncertain deformation remain blocking `issues` under bound v1–v4
policies. Explicit v5 records visual findings as warnings while inability to
reliably establish and measure a complete corresponding body produces no body
contract. A bound body-unresolved diagnostic policy retains that original seal
and continues; without that policy it still stops.

With an explicitly bound visual policy selecting `minorGeometry: record`, new
v2 host runs also freeze `bodyFitPolicy` as
`{"kind":"uniform-observed-body-residual-v2","maximumResidualPixels":32,"denseBoundaryMarginPixels":4}`.
The program fits the four observed body corners by one least-squares scale and
centered translation. Maximum corner residual is measured in reference pixels;
excessive residual or a gross aspect mismatch above the existing 25% guard fails.
The dense-alpha guard permits only the frozen small native-pixel boundary margin
and records all four actual excursions. It does not expand or alter observed
coordinates, delete alpha, slice a material, or stretch axes independently.
Complete nonzero-alpha support is rendered into storage; the viewport stays at
the original reference size. Observation validation and final packaging use the
same frozen fit policy and record the actual residual and margin.

New approximate runs may instead freeze the explicit
[relative fit policy](BODY-RELATIVE-FIT.md), including its fraction, pixel floor,
absolute cap and native measurement margin. It is not an implicit change to the
32px default. V5 retains measurable fit, exterior classification and high-opacity
anchor-envelope differences as warnings, including actual edges, counts and sides;
it does not remove pixels or replace the measured body with an alpha extent.
Reliable correspondence, observable solid core, complete side declarations,
source identity and package integrity remain required. See
[visual warning policy](VISUAL-WARNING-POLICY.md) for the policy-specific gates.

Strict visual policies keep their original fit and zero boundary margin.
Explicit `bodyObservationPolicy=host-body-observation-v1` retains the old answer
and display protocol; explicit `bodyFitPolicy: null` retains historical fitting.
Historical configurations missing these fields retain old semantics. A changed
runtime requires a fresh run and new actual scopes; failed runs, old responses and
authorizations are never migrated or promoted.

Fresh M1 uses `ui_host_m1_attestation_v1`, with exactly `kind`,
`requestSha256`, `responseSha256`, `plannerId`, `model`, `effort`,
`hostAssertedModelResponse`, `notProviderReceipt`,
`notCryptographicallyPlatformVerified`, `dispatchEvidenceSha256`, and
`returnEvidenceSha256`. All three booleans are true; the model and effort match
the request and the two evidence hashes are distinct. The program preserves and
validates the raw answer and source evidence. M2 copies that evidence and binds
the candidate bytes and author to it; frozen snapshots recheck the same chain.
An actual schema-invalid answer remains terminal with its original source
evidence preserved. A reservation alone never counts as M1 execution.

Fresh v4 review schemas encode the existing deferred-appearance invariant:
`reference-bound` requires nonblank `deferredAppearance`; all other description
statuses require null. The program does not rewrite contradictory model answers.

`host-resume --run RUN` advances deterministic completed stages and returns pending
requests unchanged. Interrupted transactions are preserved and terminalized;
they never replay a model invocation. Program-owned control pointers are atomic
and bind immutable chained journals. Runtime, inputs, requests, original answers,
delivery outputs, and checkpoints are fingerprinted; changed files are rejected.

Only a successful new integrated run reports `FullAutomationExecutionCompleted:
true`. `visualAcceptancePending` remains true and `humanVisualAcceptance` remains
false. The packages and `delivery/comparison/three-way-comparison.png` await human
visual acceptance. The comparison atlas uses actual stored package layer PNGs.
`FullReferenceToDeliveryExecutionCompleted` is true only after a complete fresh
M1 workflow with verified original model-source evidence. Offline seed workflows
report it as false even when their downstream delivery finishes.

## Native reference attachment capacity

Every sheet in a new context job packs its reference crops into one canonical
source board before authorization, whether it has two, three, four, five or six
materials. Jobs bind `sheetReferencePolicy=all-context-sheets-board-v1` and an
exact `contextBoardReferences` entry for every selected sheet. Missing or changed
boards fail verification; the runtime never falls back to separate attachments.
The board preserves every source
crop at one common integer scale and binds its PNG, metadata and ownership prompt
in `contextBoardReferences`. Request count and independent material ownership do
not change. Board bytes are rebuilt and verified before dispatch and receipt;
historical jobs without this policy retain their frozen transport, including
multiple attachments for smaller sheets. Received-bundle evidence records
the actual board prompt and descriptor instead of reporting the crop prompt as
the native prompt. v12 jobs use edit-only board prompt v3; historical prompt
versions retain their exact bytes. Background and standalone foreground requests
keep their existing references. This preparation performs no generation.
