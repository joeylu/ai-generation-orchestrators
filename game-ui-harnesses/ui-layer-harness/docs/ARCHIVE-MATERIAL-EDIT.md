# Archive-bound native material edit

`archive_material_edit` is an offline one-shot exchange for an actual native
image edit. It never invokes generation, a model, a CLI or a provider service.
The host performs the explicitly authorized edit and supplies its real returned
PNG plus evidence. There is no automatic retry or resubmission.

`freeze(source_archive, layer_id, output, *, purpose, owned, delete,
reference_region=None)` requires a complete verified layer package and a fresh
directory. `owned` and `delete` are nonempty lists of explicit material details.
The source is the authentic existing independent archive layer. The reference is
the full original archive reference, never the preview. An optional integer crop
is deterministically derived from that original reference. All original package
artifacts and its genuine manifest, inputs, arguments, schema and exact edit
prompt are pinned by hashes. The request includes an immutable canonical digest.

The deterministic prompt preserves the owned silhouette and texture, deletes
entire children and their empty frames, and recovers the underlying owned surface.
Foreground returns require nonempty RGBA with native transparency; a background
return may be RGB or fully opaque RGBA. Raw bytes and dimensions are preserved.
No alpha cropping, preliminary fitting or programmatic surface drawing occurs.

`authorize(job, digest_value, actual_user_instruction)` writes a fresh single-use
authorization bound to the exact request digest. The instruction must be the real
human authorization, retained as local evidence. A saved host declaration cannot
cryptographically establish human authorship. Private user instructions and local
input paths are not public examples or publishable manifests.

`next_request(job)` reserves exactly one intent and returns `submissionDigest`,
`sourcePath`, `referencePath`, the frozen `prompt`, and `arguments`. The exact
image tool arguments can also be read with `frozen_arguments(job)`:
`prompt`, `referenced_image_paths` (source, full original reference, optional
original-reference crop) and `transparent_background`, false for backgrounds.
Background prompts preserve the original reference aspect ratio. Authorization
returns `authorizationDigest`, the SHA-256 of the immutable authorization file.
Submission status is
`awaiting_result_no_resubmit`. Another call fails, including after a lost or
indeterminate native return. A new attempt requires a new frozen job and new
authorization; authorization must never be invented or inferred by this module.

`receive(job, submission_digest, actual_returned_path, native_tool_evidence)`
consumes one actual return. `native_tool_evidence` is the path to the host's
declaration of its observed real tool return, with exactly these fields:

```text
kind = ui_native_material_edit_return_v1
submissionDigest = reserved submission digest
returnedSha256 = SHA-256 of actual native returned PNG bytes
hostObservedNativeReturn = true
notCryptographicallyProviderVerified = true
```

This declaration is not permission to simulate a return. The host must preserve
its actual native tool evidence outside the public package. The program validates
the binding and PNG/alpha, copies the original bytes, and writes the deterministic
`ui_host_observed_native_edit_receipt_v1`. It explicitly sets `notProviderReceipt`
and `notCryptographicallyProviderVerified`. Failed receive consumes the reservation
and never creates a successful receipt. Human acceptance, strict body registration
and original DAG promotion remain false.

`verify_received(job)` replays complete archive, frozen request, authorization,
single submission, original native evidence and raw SHA chains. It returns a
dictionary with `layerId`, `rawPath`, `referencePath` and `binding`. An actual
returned temporary file may subsequently disappear; the sealed `raw.png` retains
the exact received bytes, and its receipt retains the original private path.

`host_geometry_observation.prepare(..., source_overrides={layerId: editJobPath})`
accepts only these verified returns from the same source archive and layer ID.
The original archive still owns reference, layer metadata and placement. The
new observation source is the genuine native edited PNG at its original native
size. `sourceOverride.kind` is `ui_verified_archive_material_edit_source_v1`;
its binding and copied edit chain are frozen and reverified. An edited source can
have a different SHA or dimensions from the old layer, without creating an
unbound replacement. Geometry must be observed again on the actual edited PNG;
previous geometry cannot be silently reused.

Offline tests construct public image/package fixtures and host evidence doubles.
They do not call any image model or native image tool.
