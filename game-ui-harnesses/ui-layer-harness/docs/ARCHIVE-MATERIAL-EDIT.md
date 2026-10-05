# Archive-bound native material edit

`archive_material_edit` is an offline one-shot exchange for an actual native
image edit. It never invokes generation, a model, a CLI or a provider service.
The host performs the explicitly authorized edit and supplies its real returned
PNG plus evidence. There is no automatic retry or resubmission.

`freeze(source_archive, layer_id, output, *, purpose, owned, delete,
reference_region=None, geometry_intent=None, input_policy=None)` requires a complete verified layer package and a fresh
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

The optional `geometry_intent='reference-visible-structure'` explicitly changes
the geometry contract for a source whose silhouette or proportions were confirmed
incorrect. The full original reference and optional local crop determine the native
visible body silhouette, proportions and internal relative layout. The source
supplies owned texture and detail evidence. The prompt requires replacing incorrect
old geometry, retaining only actually visible fragments and true original-canvas
clipping boundaries, and never inferring hidden edges or extending off-canvas
objects. An ownership or `sourceRegion` rectangle does not define the body.
Listed deleted children and their frames must not become baked body decoration.

For foregrounds, the body, genuine reference-supported soft shadow/glow and empty
canvas are distinguished explicitly. Only real reference soft light may remain
outside the body; isolated fragments and unrelated halos are forbidden. Remaining
canvas must have alpha zero, with natural continuous edges and faint genuine soft
light preserved. Backgrounds remain opaque and keep visible physical scene objects
in their reference positions. Neither intent permits hand-drawn geometry, forced
rectangular registration, mask edits or removal of weak alpha. Receive preserves
the original returned bytes and dimensions, and does not perform these operations
or establish human/strict geometry acceptance.

When selected, `geometryIntent` is bound in the request and its `args` and
`arguments.json`; the exact image tool prompt includes the explicit intent and is
bound by the frozen file SHA chain. The image tool argument schema remains
`prompt`, `referenced_image_paths`, `transparent_background`. Omission or explicit
`None` retains the original prompt bytes and request structure, with no new intent
fields; old frozen jobs remain valid. Other intent values are rejected. Changing
intent requires a fresh job and a new digest-bound compute authorization; updating
public frozen hashes cannot reuse an existing authorization. No call to generation
is made by freezing, validation or this exchange.

For this intent the exact tool input order is reference-first: with a crop it is
`[reference-crop.png, reference.png, source.png]`, and without a crop it is
`[reference.png, source.png]`. The prompt identifies image 1 as the primary visible
structure target, the full original reference as placement/clipping context, and
the last source image as texture/detail evidence, never the geometry or aspect
ratio target. `frozen_arguments` validates the exact selected order. The legacy
default retains its original source-first order.

`input_policy='reference-only-owned-extraction-v1'` freezes an extraction input
contract in which the image tool receives only original-reference evidence:
`[reference-crop.png, reference.png]` with a crop, or `[reference.png]` without one.
The old `source.png` is never included in native `referenced_image_paths` under
this policy. Its actual bytes, source archive identity, layer metadata and SHA
remain sealed as provenance and are still verified. `inputPolicy` is frozen in
the request, its `args`, and `arguments.json`; the exact native arguments and
prompt remain frozen by the file SHA chain. Verification checks this exact input
list even if someone refreshes public file hashes. Existing authorization cannot
be reused after changing the request.

The reference-only prompt makes original visible silhouette, proportions and
internal relative layout the sole geometry target. It removes each explicitly
deleted child, its whole frame and contents from the parent, and preserves exact
lettering, wordmarks and decorative text explicitly retained in `purpose` and
`owned`. Historical layer labels or package text-removal metadata supply no new
content instruction. Reference soft shadows and continuous natural alpha are
preserved; hidden edges are not invented. Backgrounds remain opaque. A conflicting
explicit keep/delete scope requires author review before freezing; this module
does not decide text ownership from natural-language lists.

This input policy works independently or with
`geometry_intent='reference-visible-structure'`. Omitted or `None` input policy
preserves existing prompt bytes, fields and tool arguments for both legacy and
geometry-intent jobs. Other policies are rejected. Receive and verified source
overrides continue to retain native returned bytes, dimensions and alpha without
fitting, mask editing or silent retries. A valid frozen chain proves identity and
input scope, not visual quality, exact lettering or correct child removal; those
remain subject to actual visual review and the unchanged acceptance gates.

`authorize(job, digest_value, actual_user_instruction)` writes a fresh single-use
authorization bound to the exact request digest. The instruction must be the real
human authorization, retained as local evidence. A saved host declaration cannot
cryptographically establish human authorship. Private user instructions and local
input paths are not public examples or publishable manifests.

`next_request(job)` reserves exactly one intent and returns `submissionDigest`,
`sourcePath`, `referencePath`, the frozen `prompt`, and `arguments`. The exact
image tool arguments can also be read with `frozen_arguments(job)`:
`prompt`, `referenced_image_paths` (the selected intent's exact order described
above) and `transparent_background`, false for backgrounds.
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
