# Archive component exchange

`archive_component_exchange` is a separate offline foreground-child extraction
and original geometry observation exchange. It calls no model, image tool, CLI
or provider. A host must perform the real authorized native extraction and supply
its actual PNG and native-return evidence. This module does not revise a package,
remove parent contents or establish visual/strict acceptance.

`load_archive(path)` validates a standard layer ZIP or the existing viewport
wrapper contract. It returns `sourceArchiveSha256`, `innerArchiveSha256`,
`composition`, `files` (the complete inner ZIP bytes dictionary),
`referenceBytes`, `originalSize`, and `worldShift`. For a wrapper, layer storage
and parent metadata come from `world-ui-layers.zip`, while `referenceBytes` is
the authentic outer `original-reference.png`, never the extended world reference.
Loading a wrapper proves integrity, not authorization for a new viewport export.

`freeze(source_archive, parent_layer_id, component_id, output, *, name, purpose,
owned, delete, reference_region)` requires an existing parent and a new child ID
which does not collide with any archive layer. IDs allow ASCII letters, digits,
underscore and hyphen and cannot represent paths. `owned` and `delete` are
explicit nonempty lists; `reference_region` is `None` or an integer half-open
rectangle in the authentic original reference coordinates. It is context, not a
body box. Every output directory must be fresh.

The parent PNG and complete original package are retained as SHA-bound provenance.
Native tool references are exactly `[reference-crop.png, reference.png]` when a
crop is selected, otherwise `[reference.png]`. The parent PNG is never sent to
the tool. The frozen prompt defines the visible child silhouette and relative
layout, explicitly retained exact lettering, complete excluded child frames,
reference-supported soft light and continuous natural alpha. It prohibits hidden
edge inference, rectangle fitting and faint-alpha erasure. Input files, component
parameters, exact native arguments and prompt are frozen by file hashes and a
canonical request digest. New request kind is `ui_archive_component_request_v1`;
`parentLayer` is real world metadata and is never presented as the child's
`originalLayer`.

`authorize(job, digest_value, actual_user_instruction)` retains the actual human
instruction and binds one native call to the exact request. `next_request(job)`
reserves one submission, returning `submissionDigest`, `arguments`, `prompt`,
`referencePath`, and `parentPath` (provenance only). `frozen_arguments(job)` returns
the verified native tool arguments. A reserved submission cannot be repeated.
Authorization also seals `authorization-binding.json` with the authorization's
exact byte SHA and request/parent/child identity. Every dispatch and received-chain
verification checks that seal; editing authorization text before the first
dispatch is rejected, even if the replacement text is nonempty.

`receive(job, submission_digest, actual_returned_path, native_tool_evidence)`
requires a genuine oriented transparent RGBA PNG and a host evidence JSON with
exactly these fields:

```text
kind = ui_native_component_return_v1
submissionDigest = reserved submission digest
parentLayerId = frozen existing parent ID
componentId = frozen new child ID
referenceSha256 = authentic original reference PNG SHA-256
returnedSha256 = actual native returned PNG SHA-256
hostObservedNativeReturn = true
notCryptographicallyProviderVerified = true
```

The native PNG bytes, size and faint alpha are preserved exactly. No geometry fit,
mask edit, alpha cropping or retry occurs. A failed receive consumes its terminal
reservation and cannot create a successful receipt. A host declaration is not a
cryptographic provider receipt or permission to simulate a native return.

`verify_received(job)` replays the archive, parent/child/reference, arguments,
authorization, submission, native evidence and raw receipt chain. It returns
`layerId` (child ID), `parentLayerId`, `rawPath`, `referencePath`, `binding` and
`component`. The component is `{name, role: "foreground", referenceRegion,
owned, delete, purpose}`. Binding contains source and inner archive SHA,
parent/child IDs, reference SHA, request/authorization SHA, submission digest,
raw/native evidence SHA and receipt SHA. Cross-archive and renamed-child evidence
cannot be substituted. Original temporary returned files may disappear after
receipt; sealed raw bytes remain authoritative.

`prepare_observation(job, output)` freezes one new typed component observation
item. Its request includes `editJobPath`, `layerId = componentId`, `componentId`,
`parentLayerId`, `parentSha256`, both archive SHA values, native source and original
reference SHA/size, `inputsSha256`, `component`, `scope`, and `editBinding`.
`scope.kind` is `ui_component_owned_target_v1`; parent bounds are explicitly not
component body geometry. Source coordinates are native local pixels, and targets
are authentic original-reference pixels without the world's storage shift.
The prompt directs attention to the owned child and its lettering. It reuses
`host_geometry_observation.schema()` and `assess()` without weakening their complete
body/visible landmark requirements. This request contains no invented
`originalLayer` and is not an existing whole-layer observation override.

`receive_observation(item, response, *, host_attestation_path,
dispatch_evidence_path, return_evidence_path)` retains one original host answer
and dispatch/return evidence with the existing independent host-attestation
contract. The answer is sealed as `answer/response.json`; the result records its
files and original request SHA. Failed receives are terminal. Uncertain or
material-fault observations retain their actual status and faults.
Successful receive also creates the single-use `observation-receipt.json`, whose
canonical digest binds the original result byte SHA, all original answer/host
attestation/dispatch/return byte SHA values, request/input SHA and genuine edit
binding. Verification rejects result-only whitespace changes and replacement
answers even when someone refreshes the mutable host answer/result hashes. This
is local sealed evidence, not a cryptographic platform signature; consumers must
freeze its bytes together with the full observation directory.
`verify_observation(item)` returns `(request, answer, sourcePath, referencePath)`
after replaying the genuine edit and original observation chains. No answer is
rewritten or promoted to strict success.

Offline tests use only deterministic public image/package fixtures and host
evidence doubles. They cover parent/child identities, reference-only native
arguments, wrapper original-reference identity, invalid paths and collisions,
tampering and cross-archive substitutions, terminal failures, continuous faint
alpha, original answers, and legacy edit defaults. Existing APIs and frozen
historical runtime jobs remain unchanged.
