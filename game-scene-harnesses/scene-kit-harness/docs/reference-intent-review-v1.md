# Reference-inspired composition review

Use this when the user wants the reference's scene intent and editable asset
responsibilities, with reasonable variation in positions, spans and small forms.
Tight feature reproduction is a separate goal. Register measurements when useful
for placement or diagnosis; do not make every visible detail an exact art target.
Gameplay contacts, essential openings, layer ownership and required independent
editing still matter even when visual similarity is approximate.

Judge approximate fidelity from the full reference beside the actual composition,
not merely from the presence of named assets or a technically valid layer order.
Check what is visible through each important gap across its full extent: a true
Alpha opening still fails the intended depth if it reveals sky where a continuing
rear mass should be visible. Preserve dominant massing, depth density and focal
hierarchy; smaller local coordinate errors are a separate, often acceptable issue.
When these observations change, retain the earlier review and append a bound
superseding Agent review. Technical readiness and editability are not art approval.
Compare equal-size views using the declared reference-to-viewport mapping before
changing material scale or object massing. Inspect representative broad forms as
well as small feature matches. Reusing an existing source as another editable
backing instance is a reviewable design inference; inspect repeated silhouettes,
finite cuts and feature density before calling the missing depth resolved.

For an existing strict v6 composition, `referenceIntentReview` is an explicit
authoring option for a new candidate. It changes the candidate's acceptance goal,
not the frozen generation request. It is supported for isolated feature groups,
not continuous bands or camera-coverage exceptions. No generation is needed.
The user's choice of approximate fidelity authorizes preparing this review; it
does not grant final human art acceptance or another image call.

The sealed `ai_scene_reference_intent_review_v1` record contains:

- `profile: 'reference-inspired-v1'`, the original `structureSha256`, the exact
  complete `measurementsSha256`, an `evidenceSha256`, `reviewer` (`agent` or
  `human`) and an `intentReason` explaining the chosen goal.
- `assets`: exact instance, source-plan and raw-PNG identities. Each row explicitly
  lists `acceptedFeatureIds` and `acceptedCheckIds` whose measured geometric
  differences are acceptable for this composition. Undeclared differences retain
  their original gate. Missing observations cannot be accepted as a variation.
- Each asset's `judgments` records a verdict and notes for `content-ownership`,
  `depth-and-occlusion`, `independent-editing`, `openings-and-contacts` and
  `composition-intent`. Every judgment must pass. An unresolved ownership leak,
  unusable opening or contact, lost editing freedom or impossible layer order
  still blocks the candidate. These are explicit observations, not machine vision.

Pass the record as `referenceIntentReview` to
`createFeatureCoherentComposition(..., options)`. Standalone
`reviewReferenceFeatureLayout` takes the same record as `intentReview`. Existing
`features-review`, `deliver` and `verify` commands consume the new composition;
there is no extra compute or approval command.

The result retains the original measured errors, tolerances, joint-fit placement,
strict review digest/status and each affected row's reference-match issues.
Only explicitly reviewed geometric variations become nonblocking for the new
goal. Technical PNG QA, identity, scale bounds, required observations and all
other candidate gates remain active. Without the option the historical strict
review remains byte-identical. Never relabel a historical failure as success.

Delivery exports `evidence/reference-intent-review.json` and the combined feature
review; deterministic verification replays both. Surface-review continuation
carries the intent review, original feature supplement and coordinate correction.
Final Studio inspection and human art acceptance remain separate.

`tests/reference-intent-review.test.mjs` covers an asymmetric synthetic industrial
frame: useful variation passes only with the exact reviewed policy, while stale
bindings, missing evidence, failed functional judgments and unaccepted changes
remain blocked. Candidate export and replay retain original sources and plans.
