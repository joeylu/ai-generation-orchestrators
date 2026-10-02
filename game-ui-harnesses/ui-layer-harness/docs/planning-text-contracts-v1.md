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
