# Explicit planning text contracts

These ui-layer contracts apply only when the immutable new job configuration
explicitly selects them. Historical jobs without the fields retain their original
schema validation and conservative mixed-text rejection. Shared planning-harness
contracts remain unchanged and must be copied from committed `fad597a0` for this
release's isolated fixtures.

## Coverage text

`coverageTextPolicy: exact-fragments-v1` requires every excluded business text
instance to identify its exact lettering in `textFragments`, with its real material
owner and original-image evidence. After review resolution, the entry carries these
strings as `businessText`; graphics carry null. The review's existing artwork
description is not parsed to infer lettering. The reviewed original image remains
the evidence of what text exists: these fields do not prove visual truth by themselves.

An owner may retain a separately identified decorative phrase while removing
nonoverlapping business copy. Each excluded fragment is checked against the owner's
retained strings after Unicode NFKC, case folding, and whitespace removal. Equality
or containment in either direction is a conflict. For example, `Recipes` may coexist
with `Happiness in Every Roll`, but not with `RECIPES` or `My Recipes Today`.
This conservative comparison can block short shared phrases; a reviewer must supply
unambiguous complete lettering, rather than bypass the conflict. Material ownership,
text policy, graphic coverage, unknowns, and all other release gates still apply.

## License set normalization

`normalizationPolicy: preserve-text-set-v1` permits duplicate exact strings only
inside `materials[].preserveText` (including the scene material). A future schema
with a separate `scene.preserveText` uses the same rule. The provider schema is a
copy with only those arrays' `uniqueItems` removed. All lengths, item types,
required fields, and other constraints remain enforced.

The deterministic producer verifies the raw model transport and response digest,
validates the raw response against that provider schema, keeps first occurrences
in original order, and validates the derived plan against the unchanged strict
storage schema. It publishes `normalized-plan.json` and `normalization-report.json`
to fresh paths. The report binds the raw response, transport document, storage
schema, derived file, and each removed index. Exact strings alone are deduplicated:
case, whitespace, spelling, order of distinct strings, and other plan fields remain.

The raw `draft.json`, transport response digest, events, and original failure records
are never rewritten. Downstream planning must use `verified_plan_path` and pin the
returned derived file digest. The reader recomputes the derivation and validates
both report and plan. Legacy jobs return the strictly validated raw draft path.
Normalization is not a new compute authorization or a failed-job recovery mechanism.

## Source-bound visual textures

A fresh run may select `--visual-textures REGIONS.json`. This optional input treats
explicitly identified, unreadable microprints as visible artwork: preserve their
ink shapes, density, spacing, orientation and placement without inventing a
transcription or adding a brand. Readable lettering outside these regions retains
the existing exact text contract. This policy does not remove unknowns about
ownership, contours, layer structure or other visual evidence.

The input has exactly these fields:

```json
{
  "kind": "ui_visual_texture_regions_v1",
  "referenceSha256": "<64 lowercase hexadecimal characters>",
  "canvas": [1024, 1024],
  "regions": [{
    "id": "small-print",
    "sourceBox": [200, 300, 220, 310],
    "appearance": "Two short rows of pale, glyph-like ink marks.",
    "protectedArtwork": "Preserve the label substrate and surrounding contour."
  }]
}
```

Coordinates are integer half-open original-image LTRB bounds. There must be 1..32
unique, nonoverlapping regions, each at most 1% of the canvas and together at most
5%. Appearance and protected-artwork descriptions are nonempty and at most 1000
characters each. The deterministic reader verifies the original PNG dimensions
and SHA-256 before creating a run. It does not edit source pixels or derive OCR.

The input bytes and `visualTexturePolicy: source-bound-visual-textures-v1` are
pinned in both delivery and planning configurations and each model request. M2
and every rereview supply `visualTextureAudit`, keyed by exactly the input region
IDs. Each entry contains `status` (`confirmed` or `uncertain`), `materialId`,
`objectId`, `sourceEvidence` and `preservationEvidence`. A confirmed entry must
identify a real material and object with matching ownership and an object box
containing the whole region. Uncertainty remains a blocker.

Compile/freeze derive `visual-texture-bindings.json` from the final verified review,
then bind it and the input into the snapshot. Generation and material-review
prompts carry the visible preservation requirements only for their actual owners,
including local-reference coordinates for crops and sheet cells. Snapshot replay
checks both fingerprints and the final review lineage. Business-text removal,
alpha, containment, relationship and package gates remain in force.

This first version supports fresh default-chain runs only. Revision/refreeze and
experimental prompt/group variants reject texture-policy jobs before creating a
derived job. Historical jobs and raw receipts are unchanged; selecting this input
does not authorize any external model or image request. Offline fixture tests
establish contract integrity, not visual fidelity of generated textures.
