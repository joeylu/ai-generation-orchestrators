# Source-bound regrouping

`compact-controls-context-grid-v2` also admits UI surfaces whose owned object
kind is `card`. This includes a slider rail or readout frame when M1 chooses
that valid kind. The previous compact policy remains reconstructible and still
excludes those objects. Mixed illustration/logo/unknown ownership stays outside
compact control grouping. Pixel resolution, padding and six-member limits stay
the same. Material identities and ownership never merge.

Fresh host reference runs now default to `compact-controls-context-grid-v3`.
It adds a separate family for a single complete card with owned illustrations,
icons, badges or decorations. Cards must also pass conservative pairwise size
and aspect compatibility; panels, logos, unknowns, pure illustrations and
backgrounds remain excluded from that family. The original per-material pixel
resolution, margins and six-member ceiling are retained. V1/v2 replay and the
regrouping command below retain their original semantics.

To reuse already completed planning after a budget-only failure, first preserve
its verified reviewed snapshot. The deterministic command below creates a new
snapshot and never submits a provider request:

```text
ui_layer.py regroup-reviewed-snapshot --source PARENT --digest PARENT_DIGEST --output NEW --max-calls 6
```

This narrow route accepts reviewed host context snapshots using v7–v10, without
texture/reuse/protected-background extensions. It verifies the parent and its
archived original M1/M2 evidence, rebuilds only the grouping, sheet prompts and
requests, preserves original answers, placements, crops and reference bytes,
and runs normal execution preflight. Budget failure occurs before output is
created. The new manifest binds grouping lineage and preserved file hashes.
It never modifies, resumes or promotes the failed host run.

A new fast warning host can select
`reviewedSnapshotPolicy=verified-planning-snapshot-reuse-v1`, the new
`reviewedSnapshot` and digest, the unchanged original `seed`, and the matching
`generationGroupingPolicy`. Bind the original warning policy exactly. This
route requires an actual source-bound M1 and retains M2's original evidence.
It does not make a new model call or assert a new M2 review. A layout sidecar may
be extracted unchanged from that original plan's declared layout contract.

Construct a new configuration rather than copying the frozen host configuration
unchanged. In particular omit the fresh-only `planningMode`, `m1Planner`,
`layoutPlanningPolicy` and `planningCapacityPolicy`, along with old `planningNotes`
and the producer-owned `digest`. The reviewed-snapshot workflow does not execute
fresh M1 or its pre-M2 capacity stage; passing that stage policy remains an error.

The new image job starts unauthorized. A fresh immutable compute proposal and
user authorization are still required. Parent attempts and prior approvals are
never reused as image compute authorization.
