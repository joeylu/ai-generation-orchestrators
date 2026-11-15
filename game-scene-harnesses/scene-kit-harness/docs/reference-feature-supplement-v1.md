# Reviewed additions to a frozen reference structure

Use a source scope's explicit `featureSupplement` only when reference review finds
an omitted visible feature or structure check for an already declared owner. It
strengthens the original sealed `referenceStructure`; it does not replace that
record, change existing feature coordinates/tolerances, remove checks, invent a
new owner, change source grouping or accept a failed image. Coordinate errata still
use the separate `featureCorrection` contract.

This is a local programmatic API, not a new CLI command. A supplement has
`{proposal, decision}`. The sealed proposal contains:

```js
{
  format: 'ai_scene_reference_feature_supplement_v1',
  structureSha256: originalStructure.sha256,
  evidenceSha256: independentlyReviewedReferenceEvidence.sha256,
  additions: [{
    instanceId: 'rack.actual',
    features: [{
      featureId: 'inner.crossbar', description: 'Visible internal bar center',
      target: {x: 125, y: 65}, toleranceWorld: 1
    }],
    checks: [{
      checkId: 'opening.partition',
      description: 'Keep the internal bar in the upper part of the opening.'
    }]
  }]
}
```

Inspect the exact original and document native observations, integer contain
mapping and uncertainty before choosing targets. Do not choose positions by
minimizing a generated image's residuals. Functional uncertainty is compatible
with a visible position observation. The acceptance receipt targets the sealed
proposal digest and concerns only additional reference registration, not artwork
or compute. Evidence accuracy remains an explicit human/Agent responsibility.

Only new feature/check IDs are accepted. Each addition must target an existing
owner and add something. The combined structure keeps the existing limits of
16 features and 16 checks per owner; duplicate or replacement IDs, wrong base,
invalid coordinates/tolerances and stale receipts are rejected.

`withReferenceFeatureSupplement(existingScope, supplement)` prepares a new item
scope. Initial source overrides may use the same field. The compiler resolves
the original structure, its explicit coordinate correction, then the additions.
Prompt instructions contain the combined features and checks. An existing source
frame guide must be regenerated and independently reviewed with
`previewSourceFrameGuide({..., supplement})`; an old guide receipt is invalid.
The source retains its original reference, ownership, Alpha policy and boundaries.

The new plan needs a fresh exact compute confirmation. Once bound, a direct
revision cannot drop or swap the supplement. This v1 supports one immutable
supplement per source; it is not an unlimited revision chain. Different bundles
cannot coexist in one batch. Review all missing obligations before selecting it;
further changes need a separately reviewed supported contract, never removal of
the existing obligation or a new project to evade it.

For v6 composition, pass `featureSupplement` to
`createFeatureCoherentComposition(..., {featureSupplement})`. For standalone
diagnostics pass `supplement` to `reviewReferenceFeatureLayout`. The exact bound
bundle is mandatory downstream. All added points and check verdicts must be
measured; missing or failed observations block. Delivery exports the original
structure and separate `evidence/reference-feature-supplement.json`, and verification
replays them. Calibration uses all points while retaining every original tolerance.

A stronger prompt or guide does not guarantee that the next image preserves
previously successful relationships. Re-observe the original and added features
on the exact new PNG and evaluate them together. Improvement of an internal
member cannot substitute for the original group's checks, and a passing fit from
another image cannot transfer. A reversed endpoint ordering or changed span may
require source correction rather than another placement transform; keep the
failure visible and do not split a fixed group solely to make the fit pass.

An old failed image may receive an explicitly labeled stronger standalone
diagnostic. This neither modifies its frozen plan nor bypasses technical rejection.
Retain the earlier report beside the new diagnostic. No source generation, Alpha
cleanup, automatic retry, final human art acceptance or Studio import is implied.

Regression: `tests/reference-feature-supplement.test.mjs` uses a synthetic
industrial frame to cover additive-only validation, reviewed guide regeneration,
source revision and replay, new authorization, mandatory downstream observations,
candidate rejection and exact delivery evidence export/reverification.
