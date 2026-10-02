# Candidate-bound relation review

New planning jobs freeze `relationReviewPolicy: ui-relation-review-v1` in their
configuration. A missing field retains the historical strict relationship gate.
The shared planning schema and prompts are unchanged. Raw model replies and
transport receipts remain authoritative and are never rewritten.

`check_relations` still reports every same-depth AABB intersection. A box
intersection is a review hint, not measured alpha overlap. The local review
catalog binds the canonical full candidate digest, original reference SHA-256,
and exact pair issue records. M2 and each rereview must return exactly one
judgment per catalog pair, including concrete source contour/gap evidence and
independent ownership evidence. No pair may be omitted, duplicated or added.

Only `non-occluding` discharges its own `SAME_LAYER_OVERLAP_REVIEW` hint.
`real-occlusion`, `ownership-conflict`, and `uncertain` remain blockers.
All other deterministic relationship errors remain blockers. Missing, stale,
extra or whitespace-only evidence fails closed. Evidence never licenses smaller
incorrect boxes, arbitrary depth changes, or removal of independent controls.

Repair uses `relationRepair` with the same source catalog binding. Its judgments
explain the source pairs and cannot authorize the patched candidate. The next
rereview uses a newly derived catalog for the complete resulting candidate.
The last repair check may pass AABB hints to that rereview, while unresolved
issues and other deterministic errors still stop the job. A second repair with
unchanged boxes can succeed only after a real final review supplies complete
non-occluding judgments; a zero-issue answer alone is insufficient.

The program derives `relation-assessment.json` without modifying the reply.
Run verification rebuilds the catalog and assessment and checks bound inputs and
original transport response fingerprints. Compile and draw-order construction
consume that assessment. Freeze copies the raw review, request, catalog,
transport and assessment; snapshot inspection and execution preflight rebuild
the same relation result before compiler replay. Independent amendments without
fresh relation evidence retain the strict gate rather than inheriting a review
for a changed candidate. Historical failed jobs are not restored or resumed.

This is planning evidence. It does not measure generated alpha, establish final
visual acceptance, or bypass the later generated-material and package gates.
All tests use offline fixtures and model test doubles.
