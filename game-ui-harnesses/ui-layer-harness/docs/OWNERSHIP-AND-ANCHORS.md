# Exclusive output ownership and fixed placement anchors

An assembled reference contains independently owned content inside parent
panels. A reference crop or a correct plan does not prove that generated pixels
follow those assignments. A clean plate retains only its own substrate and
decorations; it must not retain child artwork that will be drawn independently.
Missing business lettering follows the frozen text policy and is distinct from
missing owned graphics. Genuine holes and translucency remain intact.

## New host output reviews

`prepare-output-review` now freezes `ui_host_output_review_request_v2`.
The deterministic producer writes `review/ownership-inventory.json` using the
same owned objects, intersecting foreign objects and context selection as the
generation compiler. Each entry binds independently named instances and their
original owner. Source plan, original reference, generated source and inventory
are pinned through the review request and its immutable inputs.

The response requires `ownershipObservations` for every material. Each owned
object has `objectId`, `state` (`complete`, `missing`, `uncertain`) and concrete
`evidence`. Each foreign object also names its actual owner `materialId`, with
`state` (`absent`, `present`, `uncertain`). Material and object sets must match
exactly; duplicate or missing declarations cannot become a complete review.

An empty `findings` array does not replace these observations. Missing or
uncertain owned content and present or uncertain foreign content prevent strict
review acceptance. Receipt replay revalidates the inventory against the frozen
plan and repeats the coverage/state decision. Accepted observations are visual
declarations, not machine proof of pixel ownership or human acceptance.
Earlier frozen V1 exchanges retain their original pinned runtime and schema.
Candidate exports preserve the V2 observations and blockers in their diagnostic
evidence, including foreign content recorded with an otherwise empty findings
array. This does not promote the candidate or its blocked review to acceptance.

This contract uses the existing host response/attestation exchange. It adds no
model call, automatic image retry or new built-in model execution adapter.
An observer must actually view the bound generated output and reference.

## Candidate placement without support-induced drift

Fresh explicit candidate preparation can select:

```
--candidate-registration-policy measured-alpha-anchor-locked-v2
```

This policy retains the candidate's measured-alpha proxy scale and translation.
Nonzero alpha support and sampling guards may enlarge the stored PNG canvas,
but may not relocate or shrink that anchor. If complete support cannot fit in
the reference, the producer reports `CANDIDATE_ANCHOR_SUPPORT_OUTSIDE_REFERENCE`.
It does not delete faint pixels, change coordinates or publish a displaced layer.
The older `measured-alpha-support-v1` remains an explicitly labelled legacy
candidate policy; its support-driven translation and scale reduction are not
suitable evidence of reference placement.

The locked candidate policy still uses an alpha proxy, not a semantic observed
body. Correct production registration continues to require matching observed
source and reference bodies through `reference-body-support-v1`. The body
decides the uniform transform, ownership constrains the assigned target, and
full support determines storage. A wrong material aspect, dense foreign content
or multiple independent anchors needs source/ownership correction, not fitting
the crop rectangle or altering the transform to make packaging succeed.

## Bounded repair order

1. Derive the ownership catalog from the reviewed plan.
2. Generate and inspect clean parent plates before spending on their children.
3. Use the complete per-object observations to identify the exact contaminated
   source. Preserve that attempt and freeze any authorized new cleanup separately.
4. Observe the same complete body in source and reference, then register with a
   fixed uniform transform. Diagnose incompatible support without moving it.
5. Draw cleaned parents with their independently owned children and inspect the
   composite. Package integrity and exact recomposition are separate checks.

This ordering is the intended orchestration discipline. The new review contract
and explicit candidate policy are implemented; automatic cleanup/retry scheduling
and a new body-observation host adapter are not implemented by this change.
