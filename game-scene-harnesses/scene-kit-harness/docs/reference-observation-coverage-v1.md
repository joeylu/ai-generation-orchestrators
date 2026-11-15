# Explicit reference observation coverage

`checkReferenceObservationCoverage` checks a human- or Agent-authored observation list against **existing validated requirements and source scopes** before preparing new source plans. It does not inspect pixels, recognize objects, determine semantic correctness, or grant design/source/final-art acceptance. Old plans and historical batches are unchanged; invoking this check is explicit and adds no generation calls.

Provide the original reference bytes, sealed requirements and `createLayerSourceScopes` result, a separately authored `requiredObservationIds` checklist, observations, and assignments. Each observation contains `observationId`, `description`, `layerId`, and the existing policy's `parentRole`. Each assignment contains `observationId`, `subjectId`, and `scopeQuote`: an exact, at-least-two-character shared phrase in the observation description and the responsible scope's `content`. This proves only a literal declaration, not that the phrase fully describes the object or that a generated image contains it. Callers must choose meaningful identifying phrases, review exclusions, and check actual generated artwork independently.

The result binds the reference-byte SHA-256, requirements SHA-256, scope SHA-256 and all checklist/assignment data via `inputSha256`. It reports missing checklist observations, unknown observations or subjects, wrong layer/parent, absent shared phrases, and observations without a valid assignment. A pass means only that this explicitly supplied list is internally covered: omissions from both the checklist and the observation list cannot be detected. A human/Agent must inspect the reference and compile a complete checklist; counts, transforms, visible footprint, actual source content, composition, and Studio acceptance need separate review.

```js
import {checkReferenceObservationCoverage, assertReferenceObservationCoverage} from 'ai-scene-kit-contracts/generation';
const report = checkReferenceObservationCoverage({
  referenceBytes, requirements, sourceScopes,
  requiredObservationIds, observations, assignments
});
if (report.status !== 'pass') { /* stop and revise the source planning data */ }
// Before adopting a passed report, replay the same explicit inputs:
assertReferenceObservationCoverage({referenceBytes, requirements, sourceScopes,
  requiredObservationIds, observations, assignments}, report);
```

## Agent preflight for a new reference-led source plan

First apply the [responsibility review](reference-responsibility-review-v1.md):
inventory visible masses independently of existing subjects, and resolve local
occlusions, editable parts and consequential hidden assumptions. Carry these into
the final scopes and composition review. This v1 checker does not accept or check
an occlusion graph; a literal coverage pass cannot waive those Agent stop rules.

Inspect the accepted reference first. Separately write the required checklist and
observations, including major visible masses as well as props; assign each to the
intended source subject and layer. This small JSON is illustrative, not a default
scene template:

```json
{
  "requiredObservationIds": ["foreground.rock"],
  "observations": [{"observationId":"foreground.rock","description":"深色岩石主体","layerId":"foreground","parentRole":"foreground"}],
  "assignments": [{"observationId":"foreground.rock","subjectId":"foreground-rock","scopeQuote":"深色岩石主体"}]
}
```

For a new coherent project, opt in **when accepting the reference**, before the
old default `review` can freeze a source batch:

```sh
node scripts/coherent.mjs review --root PROJECT --analysis ANALYSIS_JSON --decision REVIEW_DECISION_JSON --defer-source-plan true
node scripts/coherent.mjs source-review --root PROJECT --out NEW_SCOPE_REVIEW_DIRECTORY
node scripts/coherent.mjs observation-coverage --root PROJECT --observations LOCAL_OBSERVATIONS_JSON
node scripts/coherent.mjs advance --root PROJECT
```

The deferred review records an opt-in marker before registering the reference
decision. It leaves the project at `source-batch-needed`. The scope review is
read-only and shows the exact final source scopes; coverage recomputes those
scopes and the accepted reference bytes. A failed coverage returns exit 2 and
does not create the accepted report. Once coverage passes, `advance` replays
the saved data against the current reference, requirements and final scopes;
missing, malformed, changed or failing evidence stops source freezing. The
single-entry `continue --defer-source-plan true` uses the same opt-in and
returns `awaiting-observation-coverage` before source planning; it does not
automatically author or approve observation data. Legacy default review/continue
and already frozen plans remain unchanged. For revised source requests outside
this initial gate, run the explicit checker on the exact new request inputs.

From the Harness directory, the checked-in runnable adapter builds sealed
requirements and source scopes directly from a new brief's `requirements` and
`sourceScopes` overrides, then emits the exact objects and coverage report:

```sh
node scripts/reference-observation-from-brief.mjs --brief LOCAL_BRIEF_JSON --observations LOCAL_OBSERVATIONS_JSON --reference ACCEPTED_REFERENCE_PNG
```

Use the **returned** `sourceScopes` unchanged in the subsequent scoped source
planning call; verify the requirements fingerprint matches the plan's spec and
the reference fingerprint matches its accepted reference. If later changes add
coherence, guide, appearance or other scope options, run the general checker
again with the exact final scopes and compare the fingerprints. Rebuild the
coverage data and rerun after any reference, requirement, scope, checklist or
assignment change. If exit status is 2, source preparation, freezing,
authorization and dispatch for the affected new plan stop until the omission is
resolved and the check passes. Exit 1 means malformed input or an operational
failure and also stops that plan. Do not mark old plans failed or mutate their
history; continue independent tasks that do not depend on the new plan.

For the general CLI, input JSON contains exactly `requirements`, `sourceScopes`,
`requiredObservationIds`, `observations`, and `assignments`:

```sh
node scripts/reference-observation-coverage.mjs --input EXACT_INPUT_JSON --reference ACCEPTED_REFERENCE_PNG
```

A checked pass exits 0, uncovered observations exit 2, and malformed inputs exit
1. Both standalone commands use stdout, do not write plans or authorize compute.
Only the explicit deferred coherent review/continue described above activates
the persistent initial-source gate; a caller bypassing that opt-in receives no
automatic coverage guarantee. The package import above is verified by Node's
package self-reference when running in the `scene-kit-harness` package directory;
it requires the package to be installed or resolvable outside that directory.
