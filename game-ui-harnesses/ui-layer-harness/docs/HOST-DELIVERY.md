# Explicit host delivery

`ui_layer.py host-run --config CONFIG.json --output NEW_RUN` prepares a separate
provider-neutral workflow. Its planning seed is an explicitly supplied offline
Agent plan, not a claim that M1 ran as an external model. Existing DAG commands,
strict runs and candidate runs retain their behavior.

The new workflow performs independent planning review, freezes stock sheets with
context crops and v7 prompts, acquires all native images serially, reviews every
actual image request, extracts materials, observes foreground whole bodies,
preserves complete material storage, packages an original-size viewport, and
creates a three-way comparison. It never calls a model or native generation tool.

The JSON configuration requires `seed`, `original`, `contract`, `viewer`,
`candidateAuthors` and `materialAuthors` arrays of opaque identities. For each of
`planning`, `material`, and `body`, provide `Reviewer`, `Model`, `Effort`, and
`Destination` fields with that prefix. Reviewers must be independent of the
corresponding authors. Provide an explicit `imageDestination` and finite integer
`maximumImageCalls`, `maximumMaterialReviews`, and `maximumBodyCalls` (1–128).
Optional `planningNotes`, `visualPolicy`, and `visualTextures` are snapshotted.
`maximumModelCallSeconds` defaults to 1800 and `maximumImageCallSeconds` to 900;
both must be positive integers no greater than 3600. The host enforces these
deadlines. Timeout or unknown acceptance consumes the reserved invocation and
requires terminal failure reporting; it never permits another submission.

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
resubmit a pending request. Planning review, native images, material review, and
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

`host-resume --run RUN` advances deterministic completed stages and returns pending
requests unchanged. Interrupted transactions are preserved and terminalized;
they never replay a model invocation. Program-owned control pointers are atomic
and bind immutable chained journals. Runtime, inputs, requests, original answers,
delivery outputs, and checkpoints are fingerprinted; changed files are rejected.

Only a successful new integrated run reports `FullAutomationExecutionCompleted:
true`. `visualAcceptancePending` remains true and `humanVisualAcceptance` remains
false. The packages and `delivery/comparison/three-way-comparison.png` await human
visual acceptance. The comparison atlas uses actual stored package layer PNGs.
