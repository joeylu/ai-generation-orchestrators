# Native background region exchange

`ai_ui_layers.archive_background_exchange` is an offline exchange contract. It
does not invoke generation or approve visual content. It accepts a standard
layer archive or an independently validated viewport wrapper through
`archive_component_exchange.load_archive`. For wrappers, the reference is the
authentic `original-reference.png`, never the extended world reference.

## API

```python
freeze(source_archive, layer_id, output, *, purpose, edit_region, owned, delete)
frozen_arguments(job)
authorize(job, digest_value, actual_user_instruction)
next_request(job)
receive(job, submission_digest, actual_returned_path, native_tool_evidence)
verify_received(job)
```

The selected background must be a normally oriented, fully opaque PNG whose
storage size equals `originalSize`. Its original coordinates must be `(0, 0)`
after subtracting `worldShift`. No crop, fit, resize, orientation repair, alpha
processing or synthetic drawing makes an incompatible input acceptable.

`edit_region` is an explicit half-open integer `[left, top, right, bottom]`
rectangle within the original canvas. The caller declares a scope containing
both misplaced content and its intended position; the rectangle is not an
inference of an occluded object's boundary. Purpose and nonempty owned/delete
lists are frozen with the archive, layer, original reference, region crop,
prompt, typed return description and native arguments. All inputs have SHA-256
bindings and the request has a canonical digest.

Native image arguments contain the current background, full authentic original
reference and the original reference's region crop, in that order. They request
an opaque PNG at exactly the original pixel dimensions. `authorize` requires an
actual user instruction for that digest. Authorization and submission are
created once; `next_request` reserves the only submission. It never resubmits.

The host supplies the actual returned file and an exact typed evidence document:

```json
{
  "kind": "ui_native_background_edit_return_v1",
  "submissionDigest": "<submission digest>",
  "layerId": "<background layer ID>",
  "sourceSha256": "<frozen source PNG SHA-256>",
  "referenceSha256": "<authentic original PNG SHA-256>",
  "returnedSha256": "<actual native PNG SHA-256>",
  "hostObservedNativeReturn": true,
  "notCryptographicallyProviderVerified": true
}
```

Unknown kinds, extra fields, mismatched identities, wrong PNG orientation/size
and any nonopaque pixel are rejected. A receive reservation is terminal even
when return validation fails. Evidence is a host assertion, not a provider's
cryptographic receipt. The program preserves the native PNG and evidence bytes
as `raw.png` and `native-evidence.json` without transformation.

## Pixel contract and consumption

The program copies native RGBA pixels inside the declared rectangle onto the
current source RGBA canvas. Every outside RGBA pixel remains identical to the
source. This produces `candidate.png` and `region-proof.json`; the proof records
inside/outside and full raster SHA-256 values. PNG encoding may differ, but the
native file bytes remain separately authoritative.

`verify_received` revalidates the archive and the full frozen authorization,
submission, raw, evidence and receipt chain; it repeats the pixel copy and
compares candidate pixels and the proof. It returns `layerId`, `candidatePath`,
`editRegion` and `binding`. The binding includes archive/inner archive,
parent/source, reference, raw, candidate, request, authorization, submission,
receipt, native evidence and region-proof SHA-256 identities. A consumer must
bind this result to its same archive and exact receipt digest.

Canvas identity derives only from original dimensions and source identity. It
is not a material-body observation and proves nothing about corrected object
placement, texture or content quality. `strictBodyRegistrationPassed`,
`humanVisualAcceptance` and `originalDagPromoted` remain false. No visual quality
success or DAG promotion is implied.

Offline tests cover wrong size/alpha/orientation, scope and storage identity,
native argument and hash changes, authorization changes, single-use terminal
behavior, unchanged outside pixels, replay tampering and authentic original
reference selection from viewport wrappers. Tests do not call a provider.
