# Explicit host delivery

For final-composite human acceptance, new runs can set `visualReviewMode=warning`.
This freezes v5 visual findings as warnings throughout planning, material review
and measurable uniform fitting, and uses a shared prompt contract to prevent
duplicate ownership and surface/detail confusion. Technical integrity remains
mandatory; see [visual warning policy](VISUAL-WARNING-POLICY.md).

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

The new workflow performs independent planning review, freezes stock sheets with
context crops and v8 ownership-first prompts, acquires all native images serially, reviews every
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
missing artwork and source/cell boundary alpha still stop preparation. No noise
pixel above the existing floor is erased or relocated. A hashed partition proof
reconstructs every prepared RGBA pixel, including unused cells, and is bound into
the independent material review inputs. That review must still establish cell
identity and ownership; a transparent partition does not certify correct artwork.

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

Return genuine original bytes using `host-receive --run RUN --digest
SUBMISSION_DIGEST --response FILE`. Model responses additionally require
`--host-attestation`, `--dispatch-evidence`, and `--return-evidence`; their typed
formats are the existing host review/material/body protocols. Host attestations
are explicitly local assertions, not cryptographically verified provider
receipts. Response construction belongs to the independent host, never this
workflow. A failed or unknown dispatch is terminal through `host-fail --run RUN
--digest SUBMISSION_DIGEST --reason TEXT`.

## Formal body observations and uniform fitting

New host runs freeze `bodyObservationPolicy=host-body-observation-alpha-v2` at
initial preparation. Each foreground request binds the raw source, full reference,
ownership crop, actual-alpha checker/light/dark RGB composites, alpha display,
schema, prompt and coordinate mapping. Verification reconstructs the display
pixels from the unchanged native PNG. Alpha extent never defines semantic geometry.
The v2 answer adds required `geometryDifferences` and `materialIssues` arrays.
Measurable size/aspect differences and permitted minor appearance differences are
retained with their response SHA in the output configuration and package review.
Unreliable/incomplete correspondence, missing/repeated content, wrong ownership
and major/uncertain deformation remain blocking `issues`.

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
