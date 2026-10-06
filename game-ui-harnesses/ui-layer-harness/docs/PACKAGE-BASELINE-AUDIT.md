# Compare a candidate with an existing delivery baseline

`ui_layer.py compare-package-baseline --baseline BASELINE_WRAPPER --baseline-sha SHA
--candidate CANDIDATE_WRAPPER --candidate-sha SHA --output NEW_DIRECTORY` is a
local, zero-model, read-only audit. Both inputs must be immutable original-viewport
wrappers with the same original reference fingerprint and display dimensions.
Each exact input byte set is checked by the existing wrapper/package validator.

The report lists missing and new independent layer IDs, changes to roles and
visibility, common-layer order changes, and PNG artifact identities. Coordinates are
converted back to original space by subtracting each wrapper's world shift.
Geometry differences describe stored support, not observed subject bodies; no
numeric visual tolerance is inferred or used as an acceptance threshold.

This detects omissions that a single-package integrity check cannot detect:
approved wordmark layers may disappear despite an unchanged text policy, or
independent icon/meter parts may be recombined. A renamed layer is also a
reported difference; the audit does not infer semantic equivalence. It emits a
reference/baseline/candidate image for whole-image inspection.

The audit never modifies input packages, claims human approval, promotes a
candidate, creates observation receipts, resumes a failed DAG, or certifies
visual similarity. A structurally unchanged candidate still needs visual review.
Bind any genuine human acceptance evidence separately. Keep the accepted package
as the recommended delivery while a replacement remains unaccepted. Compare
against the accepted baseline, including previously approved wordmarks and
component splits, before describing a local repair as an overall improvement.
