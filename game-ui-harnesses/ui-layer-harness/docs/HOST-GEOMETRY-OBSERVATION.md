# Host geometry observation

This offline exchange freezes real independent PNG layers from a complete archive
that passes `validate_archive`. It never generates artwork, creates a generation
receipt, or changes the original package or quality gates.

`prepare(source_archive, output_directory, material_ids=None,
observation_policy=None)` creates a batch index at `request.json` and individual
`items/000`, `items/001`, … directories. Omitted IDs select all layers. Unknown,
duplicate and empty selections fail. Each item includes `request.json`,
`preparation.json`, `schema.json`, `prompt.md`, `source.png` and `reference.png`.
The reference is the complete original archive reference, copied byte for byte;
it is never the recomposed preview or an ownership crop. `source-package` preserves
the complete original manifest and artifacts. Requests bind archive, manifest,
input, schema and prompt hashes, dimensions and original layer placement.
The source archive location is a private local input parameter; do not publish
private request files in public examples or fixtures.

An optional keyword `source_overrides={layerId: editJobPath}` binds a genuine
`archive_material_edit.verify_received` return from the same archive and layer.
Its native bytes and size become the source, with typed `sourceOverride` provenance
and a frozen copy of the verified edit chain under `edit-evidence`. Reference and
ownership remain bound to the original archive. Every verification replays the
original edit job and the copied chain; unbound replacements are rejected.

`policy` is `host-observed-geometry-candidate-v1`. Each item has at most one host
observation and no automatic retry. Freezing a request does not authorize compute.
A host must inspect both images and supply its actual answer and exchange evidence.
No CLI process, provider service or model is invoked by this module.

The answer has `kind: ui_host_geometry_answer_v1`, `layerId`, `boundaryStatus`,
`sourceBodyBox`, `targetBodyBox`, `landmarkPairs`, `geometryIssues`,
`materialIssues` and `evidence`. Boxes use `[left, top, right, bottom]` in image
edge coordinates. Source coordinates are local PNG pixels; target coordinates
are global original reference pixels. Coordinates must be finite, within image
bounds, and have positive box extents. Placement and `sourceRegion` describe
ownership only. They are never observed body boxes, and alpha bounds must not
be relabeled as observed geometry.

`complete` requires both genuinely visible complete body boxes. Every other
boundary status requires null boxes. `visible-landmarks` requires at least three
actually visible corresponding landmarks, each with `id`, `source`, `target`
and visual `evidence`. Both point sets must contain a non-collinear triangle
with pairwise separation of at least one pixel. Hidden edges must not be inferred.
`uncertain` and `not-whole` remain unresolved. Structural validation cannot prove
that a host's visual assertion is correct; human acceptance is still required.

`geometryIssues` block candidate geometry use. `materialIssues` are retained in
full and do not block otherwise usable geometry. Consumers must retain these
material findings in candidate provenance. No observation passes strict body
registration, establishes human visual acceptance, or promotes the original DAG.

`receive(directory, response_path, *, host_attestation_path,
dispatch_evidence_path, return_evidence_path)` reserves the item before ingesting
a return. A failed receive consumes that item too. The exact host attestation is:

```text
kind = ui_host_geometry_attestation_v1
requestSha256 = SHA-256 of item/request.json
responseSha256 = SHA-256 of the original response bytes
inputsSha256 = request.inputsSha256
reviewerId = independent opaque host reviewer identity
materialAuthors = nonempty unique list of opaque author identities
hostAssertedModelResponse = true
notProviderReceipt = true
notCryptographicallyPlatformVerified = true
dispatchEvidenceSha256 = SHA-256 of original dispatch evidence bytes
returnEvidenceSha256 = SHA-256 of original return evidence bytes
```

The reviewer must differ from every declared material author. Dispatch and return
hashes must differ. These declarations are host assertions, without cryptographic
platform verification. Original bytes and evidence are sealed under `answer/`.
The result is `geometry_usable_candidate` or `unresolved` and retains all findings.

`verify_response(directory)` replays archive identity, manifest and complete
package bytes, frozen images, schema, prompt, request, answer, host hash chain and
result assessment. It returns `(request, answer, source_path, reference_path)`.
Downstream candidate registration owns its transform residuals and tolerances;
this exchange establishes observation provenance and coordinate validity only.
It must not substitute landmarks for a fabricated complete body box.

Offline regression fixtures use the existing deterministic package writer and
host evidence test doubles. No test calls generation or a private service.
