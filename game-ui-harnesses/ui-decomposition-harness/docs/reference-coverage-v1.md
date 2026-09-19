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
ai-ui-assets coverage-bind --plan project/plan.json --coverage coverage.json --output project/covered-plan.json
ai-ui-assets freeze --plan project/covered-plan.json --workspace workspace --run generation
```

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
