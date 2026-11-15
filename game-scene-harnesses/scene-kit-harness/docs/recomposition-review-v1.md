# Explicit recomposition review

The standalone `checkRecompositionReview` and `assertRecompositionReview` APIs
record and replay a structured visual comparison before a consumer moves a
candidate to human review. They do not inspect image content. The CLI can produce
a report; for new projects explicitly initialized with the policy described below,
`art-review` must replay a passing report before recording `accept`. Existing
projects and default initialization have no such gate, and an optional report
alone does not block technical delivery or Studio export. The standalone checks
do not generate images, mutate projects or create attempts.

Inputs are the actual reference PNG bytes, Studio capture PNG bytes, SHA-256s
of the exact map and kit, and explicit observations. Every observation has a
unique ID, one of `background`, `midground`, `foreground`, and a check of
`depth`, `composition`, `source-content`, `joins` or `brush`. Reference and
capture regions are normalized `[x,y,width,height]` rectangles within the image.
Write concrete findings on both sides and use `match`, `mismatch` or `uncertain`.
Review all three areas and all five checks, including composition and source
content in each area (describe intentionally empty depth explicitly); missing coverage, any mismatch or
uncertainty blocks the assertion. More observations can identify distinct
features within the same area/check. A broad rectangle is legal, so the review
operator must choose meaningful regions and must not simply fill a checklist.

The report binds the exact PNG fingerprints, map and kit identities and all
observation data; replay rejects changed data or tampered reports. The caller
must independently prove that the capture is from that exact Studio map and kit
and verify brush interaction, reload and import/export: the API cannot infer
those facts from PNG bytes or supplied hashes. A matching observation is an
explicit reviewer judgment, not an automatic measurement, an exhaustive visual
comparison, or a human art acceptance. A pass is called `reviewed`, not a claim
of production readiness. The separate final human acceptance and existing source,
technical and delivery checks remain required.

```js
import {checkRecompositionReview, assertRecompositionReview} from './src/generation/recomposition-review.mjs';
const inputs = {referenceBytes, studioCaptureBytes, mapSha256, kitSha256, observations};
const report = checkRecompositionReview(inputs);
// At the consumer boundary, recompute from the real candidate and observations.
assertRecompositionReview(inputs, report); // throws if stale, incomplete, or blocked
```

This contract catches unreviewed declared areas and explicit defects; it cannot
find a defect omitted from the supplied observations. Future automation needs a
separately evaluated visual observer and trustworthy Studio capture provenance;
changing only the skill cannot turn these assertions into image recognition.

For an unmodified coherent CLI delivery captured by `captureCoherentStudio`,
`reviewCoherentStudioRecomposition` and `assertCoherentStudioRecomposition` in
`src/coherent-recomposition-review.mjs` additionally replay the delivery and
check the recorded capture's delivery, author, PNG bytes and capture checks.
They require the exact output directories, and do not apply to a later edited
Studio project. Capture records are content-addressed integrity evidence, not
signed attestations; trust in the local capture producer is still required.
Existing projects and default initialization keep their previous behavior. To
require this check before an `art-review` accept for a **new** coherent project, set
`--final-review-policy studio-recomposition-required-v1` at `coherent init`.
The sealed project records the policy. Capture a verified delivery with
`coherent capture`, write observations, and run `coherent recomposition-review`
with the exact delivery, capture directory and observations to produce a new
report. For an `accept` decision on `art-review`, provide `--capture-dir`, `--observations`, and
`--recomposition-report`; missing, stale, blocked or mismatched inputs stop the
review. A `reject` decision can be recorded without a passing report and does
not claim a recomposition review. The assertion replays the delivery and verifies capture and PNG identity.
It does not prevent export of a technical candidate, retrofit old projects, or
make the observations objective or complete. The capture does not perform a
brush gesture; that remains a separate real interaction check. A local sealed
record is not signed and is not proof against a malicious local writer.
