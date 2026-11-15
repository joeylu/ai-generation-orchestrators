# Explicit background-band feature relations

For a new reference-led source plan, an explicitly authored `bandFeatureRelations`
object can accompany `backgroundBand` in a source scope override. For a revised
individual scope use `withBandFeatureRelations`; this creates a new scope, not a
new authorization or a modification to an existing frozen plan. The reference
SHA must equal the actual accepted reference at compilation. Only same-band
features described by the scope belong here; image understanding, feature
identification and ownership remain the reviewer's judgment.

The versioned object has `format: "ai_scene_band_feature_relations_v1"`,
`referenceRawSha256`, 2–12 named `features` (`featureId`, `description`) and
1–24 `relations` (`from`, `to`, `axis`, `min`, `max`). On x positive means
right; on y positive means down. Deltas are fractions of the **entire source
band width or height**, not reference pixels or author-world coordinates.
For example, `{from:"peak",to:"tower",axis:"x",min:0.12,max:0.20}`
requests the tower to the right by approximately 12–20% of the source width.
The finite range is a soft observed target, not pixel matching. Duplicate,
unknown, self-referential, out-of-range and mathematically contradictory
relations fail validation. Bounds of [-1,1] do not prove real visual feasibility.

Translate reference observations into asset-relative ranges only after considering
the intended full-native placement, source aspect, finite camera domain, possible
scales and uncertainty; a reference viewport percentage is not automatically an
asset-width percentage. Check whether desired relationships and coverage can
coexist, then inspect the source and real Studio recomposition. The original
technical guide, alpha rules, source checks and separate final human art review
remain unchanged. This feature does not detect landmarks, compare images, prove
the model followed instructions, or guarantee that a valid placement exists.

Old scopes, prompts, guides, plan identities and existing authorizations retain
their original behavior. A changed source scope always needs a fresh frozen
plan and its own single-use compute decision.

`reviewBandFeatureRelations` in `src/generation/band-feature-relation-review.mjs`
accepts the sealed source plan, its sealed technical QA, native PNG bytes and
explicit feature observations. For each feature use `{featureId, x:[min,max],
y:[min,max]}` with normalized full-native coordinates and include the full
measurement uncertainty. The program computes the widest possible signed delta
interval: wholly inside the declared interval is satisfied, disjoint is
violated, overlap is uncertain, and a missing endpoint is missing. Any missing
feature, violation, uncertainty or non-passing technical QA blocks the report.
`assertBandFeatureRelations` replays the inputs and rejects stale/blocked reports.
The sealed QA and plan are integrity records, not signed provenance; callers
must independently replay the actual workflow to obtain them. A measurement
can still be wrong, and passing does not establish model semantics, actual Studio
composition or human acceptance.

For new plans that explicitly declare these relations, coherent candidate
construction now requires a reviewed report for each such source. Run
`coherent band-relations-review --root PROJECT --source PLAN_SHA256
--observations OBSERVATIONS.json --out NEW_REPORT.json`; the command reads the
actual plan, result, native bytes and technical QA from the workflow. A blocked
report is written and the command exits nonzero, so rejection evidence is kept;
do not alter it or turn it into an acceptance. For a checked rebind, use its
current rebind plan SHA as `--source`; the report itself binds the target v27
plan and its replayed target QA. Create an array of rows
`[{"planSha256":"CURRENT_BATCH_PLAN_SHA", "observations":[...], "report":{...}}]`
and pass it as `--band-relations-reviews` to `coherent deliver` alongside the
required composition. Any missing, blocked, uncertain or stale row stops before
the delivery directory is created. `continue` returns
`awaiting-band-relations-review` when rows are missing; it does not invent a
measurement. The candidate stores the rows in its checked evidence and verify
replays them against the actual workflow; no manual modification to attempts or
QA is allowed. Old plans without this opt-in field keep their prior behavior.
For a relation-bearing source this gate currently accepts direct v27 plans or
checked rebind records. Other preparation record types stop closed and require
an explicitly supported evidence path; do not substitute their parent PNG or
invent a report for a different plan.

These checks are a gate on explicit measurements, not automatic vision. The
reviewer must actually identify each feature in the exact source; a false point
or an omitted visual issue can still produce a reviewed report. Source rejection,
Studio composition, brush operation and final human acceptance remain separate.
