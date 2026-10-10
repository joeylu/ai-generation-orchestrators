# Explicit host delivery

For final-composite human acceptance, new runs can set `visualReviewMode=warning`.
This freezes v5 visual findings as warnings throughout planning, material review
and measurable uniform fitting, and uses a shared prompt contract to prevent
duplicate ownership and surface/detail confusion. Technical integrity remains
mandatory; see [visual warning policy](VISUAL-WARNING-POLICY.md).

New local warning runs freeze `bodyReviewPolicy=final-composite-first-v1` by
default. Material review remains one call per generated request, including a
whole sheet. After those reviews the program exports all layers, viewport and
comparison directly, without a body job, authorization or per-material model
calls. Placement uses explicitly unobserved alpha proxies; completeness and
visual acceptance remain unverified. The terminal status is diagnostic, even if
all sheet cuts succeeded. Set `bodyReviewPolicy=every-reviewed-foreground-v1`
in a new configuration to request the exhaustive observation path. Historical
configurations missing this field retain that path.

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
grouped requests with context crops and v8 ownership-first prompts,
acquires all native images serially, reviews every
actual image request, extracts materials, observes foreground whole bodies,
preserves complete material storage, packages an original-size viewport, and
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
cells produce warnings for the affected requests. All other requests continue
their independent material reviews and, when explicitly requested, genuine body observations within the
frozen budgets. The program then exports a mixed diagnostic: reviewed sources
and observed geometry for unaffected materials, explicitly unverified candidates
and proxy placement only for unresolved materials. No generation is repeated.
It retains all original PNGs and pixel-exact capacity cells, including unused
sidecars, and produces an original-size viewport, comparison and ZIPs under
`diagnostic-output/`. The original raw alpha is retained; equal-grid diagnostic
crops may cross artwork and are explicitly **unverified candidates**.

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
resubmit a pending request. Fresh M1, planning review, native images, material review, and
body observation have separate fresh authorizations. Material review is one
aggregate scope frozen after all images are received; it binds every actual
request and attachment, then reserves one review at a time.

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

New image jobs pack context sheets with more than five reference crops into a
canonical source board before authorization. The board preserves every source
crop at one common integer scale and binds its PNG, metadata and ownership prompt
in `contextBoardReferences`. Request count and independent material ownership do
not change. Board bytes are rebuilt and verified before dispatch and receipt;
historical jobs retain their frozen transport. Received-bundle evidence records
the actual board prompt and descriptor instead of reporting the crop prompt as
the native prompt. This preparation performs no generation.
