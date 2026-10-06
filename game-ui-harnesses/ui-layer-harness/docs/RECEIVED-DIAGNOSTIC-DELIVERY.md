# Received-source diagnostic delivery

This optional local export preserves genuine received PNGs for final whole-image
inspection. It does not resume a failed host run, perform a model review, accept
alpha quality, certify an uncut subject, or pass the automatic DAG. Its status is
always `diagnostic-pending-human-review`.

Use `ui_layer.py prepare-received-diagnostic --received-job JOB --job-digest SHA256
--canvas-policy-instruction ACTUAL_USER_STORAGE_INSTRUCTION --output NEW_CONTRACT`,
then `ui_layer.py deliver-received-diagnostic --contract NEW_CONTRACT
--diagnostic-digest CONTRACT_DIGEST --viewer BUILT_VIEWER --output NEW_EXPORT`.
These commands submit no provider requests and authorize no generation or model
calls. The contract binds the complete frozen snapshot, current runtime, genuine
authorization/submission/receipt/raw evidence, and explicit original viewport
storage policy. All frozen requests must be received. Identity, path, profile,
canvas, native alpha, complete layer set, and archive checks still fail closed.
Background color profiles are checked by the protected-background contract;
unprotected and foreground transforms do not certify color metadata equivalence.

The existing strict and candidate extraction policies are unchanged. Diagnostic
sheets first try candidate extraction. On failure they retain a complete,
pixel-exact partition using the frozen grid. Every capacity cell is saved,
including unused cells with unexpected pixels. Internal nonzero seams, source
boundary alpha and previous extraction failures remain findings. No threshold
removal, silhouette reconstruction or pixel cleanup occurs. The source evidence
ZIP contains every unchanged original PNG and every cutout; reconstruction SHA
checks cover all RGBA pixels. Grid cuts may divide a subject, so these partitions
must never be imported as a passed strict extraction or material review.

Explicit source-bound, previously reviewed prototype reuse is expanded by byte
copy. Each instance retains its own ID, owner and position. A protected background
is replayed from its frozen mask/weights and verified after rendering; the mask is
a declaration, not a certified segmentation. Foreground registration uses alpha
at least 8 only as a geometry proxy. All original RGBA enters a uniform transform;
alpha values may quantize during cubic resampling. Support cannot move or shrink
the proxy to fit the viewport. The complete rendered support is stored in an
expanded world and the preview is an exact original-size viewport slice.

The standard inner ZIP contains every planned independent layer. The viewport
wrapper is validated independently. `diagnostic-sources.zip` retains the original
source and cell evidence, including unowned residual cells. Packaging integrity
and source identity do not imply visual equivalence, ownership purity or human
acceptance. No diagnostic result is a review receipt or a strict success.

## Source-bound singleton cleanup replacements

Preparation optionally accepts `--cleanup-jobs SELECTION.json`, a nonempty JSON
list of `{materialId, cleanupJob, cleanupJobDigest}` records. This creates a fresh
v2 diagnostic contract. Each selected material must be an original foreground
singleton and its cleanup job must already have a genuine received PNG. Sheet,
background, duplicate, reuse prototype and reuse instance selections are rejected.
An arbitrary PNG or ordinary image-acquisition job is not a cleanup replacement.

Preparation and delivery replay the complete original receipt set and each
cleanup's source, snapshot, authorization, submission, receipt, raw identity,
catalog and prompt. The cleanup must edit this exact original job and singleton
request, with the same snapshot and original raw fingerprint. Every cleanup file
is additionally frozen by hash; a subsequent change prevents export. Replacement
occurs before reuse derivation, while all original source files remain retained.
The source ZIP contains both `raw/` and `cleanup-raw/`. Public replacement evidence
contains material IDs and artifact hashes; local job paths remain in the private
contract. Both v1 and v2 retain the same diagnostic flags and pending review
status, protected background, complete layer set and original viewport. Receiving
a cleanup still does not establish correct foreign removal or owned preservation.
