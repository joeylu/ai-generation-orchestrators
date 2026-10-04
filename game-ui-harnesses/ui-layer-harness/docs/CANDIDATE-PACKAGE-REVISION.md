# Explicit candidate package revision

This operation produces a complete package for whole-image human inspection
when strict body registration is unresolved or blocked. It is separate from
`revise-package`: the strict operation and its gates are unchanged. A candidate
is never reported as observed-body registration, automatic DAG success or human
acceptance.

The public Python API is `candidate_package_revision.freeze(selection, output)`
followed by `candidate_package_revision.revise(frozen, expected_digest, output,
viewer)`. Both are deterministic and make zero media-generation or model calls.
The standalone module exposes these same two operations:

```powershell
python -m ai_ui_layers.candidate_package_revision freeze --selection selection.json --output frozen-selection
python -m ai_ui_layers.candidate_package_revision revise --frozen frozen-selection --expected-digest DIGEST --output candidate-revision --viewer BUILT_VIEWER
```

The selection uses kind `ui_candidate_package_revision_v1` and is validated
against the module's exported `SCHEMA`. Required top-level fields are
`sourceArchive`, `sourceArchiveSha256`, nonempty `replacements`, and nonempty
`knownDifferences`. Each replacement specifies `materialId`, `snapshot`,
`snapshotDigest`, `job`, `requestId`, `uniformAxis` (`width` or `height`), and
`edgeAnchor` (`top-left` or `bottom-left`). It must use a received singleton for
the same material. Existing cleanup bindings are replayed automatically.

Each replacement also supplies `hostReview`: the completed review `directory`,
`requestSha256`, `resultSha256`, and its original immutable `producerRuntime`
root. Historical source/runtime hashes, original schema, ownership coverage,
dispatch/return attestation and deterministic assessment are replayed read-only.
The operation does not rewrite old review runtime bindings to the new runtime.
Both passed and blocked completed reviews are retained.

`bodyEvidence` supplies `request`, `response`, `result`, and `schema`, each with
`path` and `sha256`. The generic request fingerprints must identify the same
material, snapshot, raw source, reference, ownership region and schema. Raw
answers are schema validated and result/response bindings are checked. Successful
registered results additionally replay the same-directory observation, typed
contract and preview chain. Unresolved and registration-blocked results retain
their original answer, status and reason; they never become strict successes.
Observer identity and local paths remain local provenance only.

Candidate placement uses the complete nonzero alpha support, including faint
pixels and disconnected decorations. It applies one uniform cubic scale,
computed solely from the chosen ownership-axis length, with two source pixels
and two destination pixels of transparent sampling guard. The selected-axis
canvas exactly matches the ownership extent. Its left edge and chosen top or
bottom canvas edge are anchored to the corresponding ownership edges. This is
an explicit geometric candidate; ownership and alpha support are not measured
body boxes. The other axis can extend beyond ownership. Support outside the
reference is rejected; no automatic shrink, clamp, contour threshold or alpha
clipping occurs. Hidden RGB is zeroed only on the derived in-memory/output image;
the received raw bytes remain unchanged. Resampling is not pixel-exact.

Before revision, ZIP checksums, inventory, PNG geometry and the old preview's
exact recomposition are verified. Every unmodified layer keeps its exact bytes,
coordinates, order and visibility. Pixels outside the union of old/new replaced
layer canvases are compared exactly. The shared deterministic package writer
generates the new manifest, checksums, preview and archive.

The public review includes candidate geometry, every original host/body result
and answer, inherited issues and known differences. Nonportable evidence text
is referred to local provenance. Full paths and model/observer identities are
kept only in local `revision-provenance.json` and `result.json`. Delivery status
is `pending-human-review`; `fullAutomaticDagPassed`, `strictBodyRegistrationPassed`,
`observedBody`, and `humanVisualAcceptance` are false. Inherited layer provider
lineage is not newly verified by this revision.

Offline fixture tests cover explicit axis/edge geometry, expansion compared
with containment, nonzero support and soft alpha, boundary rejection, unchanged
layer bytes and unrelated pixels, receipt/selection tampering, and a falsely
recomposed source preview. They do not establish visual correctness.
