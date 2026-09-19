# Reviewed reference coverage

Before a new assets-only freeze, independently inspect the reference and author
an inventory of important visible non-text elements. Include edge attachments,
fasteners, ties, ornaments, backplates and isolated symbols. A prior asset list
is not independent evidence: the element missing from that list is the failure
this review must catch. Ordinary text may be explicitly excluded by text policy.

Each element has a reference-pixel `[x,y,width,height]` region, a label, explicit
material owners, and the assets whose prompts remove it. Do not infer removal
semantics from keywords automatically. The reviewing Agent must cross-check the
actual prompts. Ownership must name the material that intentionally reconstructs
the element; spatial overlap with a large panel is not evidence of ownership.
Inventory `region` is not the plan's `source_region`: the latter uses
`[left,top,right,bottom]`. For example inventory `[1428,347,108,291]` corresponds
to source bounds `[1428,347,1536,638]`. Convert explicitly; do not copy the tuple.

During caller review, compare each element's region with its owner's source
bounds **and** placed output extent (`node.xy` plus `asset.output_size`). An owner
name alone is insufficient: a crest extending above the panel must expand the
panel source/output bounds or have a separate owner. Inspect seams between adjacent
materials too; a divider between an illustration's bottom and a strip's top must
belong to one declared owner. This is a required planning review. The separate
`planning-check` below checks declared geometry, not image semantics. Preserve rejected
drafts and record reviewer corrections instead of reporting first-pass success.

```json
{
  "kind": "ui_reference_coverage_v1",
  "sourceSha256": "<reference SHA-256>",
  "review": {"inventoryReviewed": true, "removalsReviewed": true, "basis": "Independent reference scan and prompt cross-check"},
  "elements": [
    {"id":"leather-clasp","label":"Leather leaf ornament and metal clasp","region":[80,20,18,30],"disposition":"unresolved","ownerAssets":[],"removedBy":["panel"],"reason":"Missing from the asset plan"}
  ]
}
```

Coordinates are illustrative. `disposition` is `material`, `excluded`, or
`unresolved`. Exclusions require explicit reasons and remain visible in the
check report. Every asset must own at least one declared element. Overlapping
element regions are allowed for nested artwork; they do not establish ownership.

```text
ai-ui-assets coverage-check --plan project/plan.json --coverage coverage.json --output coverage-check.json
ai-ui-assets planning-check --plan project/plan.json --coverage coverage.json --output planning-check.json
ai-ui-assets coverage-bind --plan project/plan.json --coverage coverage.json --output project/covered-plan.json
ai-ui-assets freeze --plan project/covered-plan.json --workspace workspace --run generation
```

For a reference-aligned target layout, `planning-check` aggregates the coverage
issues and checks each material element against the union of its owners' source
rectangles and placed output rectangles. A gap between adjacent owners is a gap,
even when their combined outer envelope contains the element. Reports bind the
plan and inventory digests, include each tested rectangle and distinguish
`PLANNING_SOURCE_GAP` from `PLANNING_PLACEMENT_GAP`. They never modify the inputs,
authorize compute or claim that generated pixels match those rectangles.
Run this explicit preflight on the target plan before freeze, not on intermediate
generation boards whose placements are transport-only. Existing `coverage-check`
and legacy validation retain their structural semantics; this is not a new
retroactive gate on old receipts. Rescaled/rearranged layouts require a separately
reviewed coordinate mapping and are outside this geometry profile. Undeclared
elements and prompt semantics still need the one consolidated visual review.

An optional element `reuse:{element,reason}` explicitly maps a repeated observed
instance to another canonical element in the same inventory. Both must be material
elements, have exactly the same single owner and equal observed width/height.
The canonical element cannot itself reuse another element; a nonempty reviewed
reason is required. All observation rectangles remain unchanged. Structural checks
validate the mapping; `planning-check` checks the canonical source rectangle and
the repeated instance's own placed rectangle. It also requires a node at the exact
source-to-instance translation and an output size equal to the source size.
`PLANNING_REUSE_TRANSFORM` reports invalid transforms. No scaling or inferred
visual equivalence is supported. The declaration survives board ownership remapping
and remains digest-bound in the target plan; generated board placements are not
subject to the target-layout geometry check.

Check aggregates unresolved elements, missing owners, removal-without-owner,
owner/removal conflicts, unaccounted assets and pending reviews. Bind succeeds
only after a passed check. The new plan must be beside the original to preserve
relative source paths. Its embedded `reference_coverage` participates in the
plan digest, so changed ownership requires a new frozen plan/compute decision.
Every subsequent plan validation rechecks it. Board compilation maps material
owners to generation boards while retaining the original target inventory;
recovery/materialization restores original asset ownership.

New `ai-ui-assets freeze`, `board-compile`, `board-freeze` and
`authorize-generation` require this reviewed inventory. Existing uncovered runs
remain readable, processable and exportable without inventing retroactive review.
Low-level shared APIs retain backward compatibility for existing component and
legacy workflows; they are not the new assets-only user workflow.

`ai-ui-assets auto-run` requires `--coverage` as well. The caller supplies the
reviewed inventory with expected material IDs and original input SHA. The job
binds its digest, maps the verified original image to its normalized reference,
and validates actual planned ownership before any image generation. Incompatible
provider planning fails rather than silently replacing the reviewed inventory.

This is **not automatic semantic recognition**. It verifies the inventory the
caller supplied; it cannot detect an element absent from that inventory or prove
that a generated image actually contains a named element. At final composite
review, compare each declared material element against the reference again.
Missing important artwork must be reported as incomplete reference coverage,
not reduced to a texture/style difference or approved because all planned files
exist. A draft label does not repair missing artwork. Structural coverage checks
never establish human visual acceptance or pixel-perfect restoration.
