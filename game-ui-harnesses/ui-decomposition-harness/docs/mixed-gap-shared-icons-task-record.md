# Mixed-size board spacing and shared Image sources

2026-09-16: user requested repair of Expedition Supplies' returned icon board and
one reusable currency source instead of repeated generated currency drawings.

Implemented explicit content-gap policy 1.2 (mixed-height separation) and native
sharedSource 1.0 for same-size ordinary Images. See
[spacing contract](content-gap-extraction-v1.2.md) and
[shared source contract](shared-image-materials-v1.md).

Existing raw board retains ten parts and its original 1.1 failure. The explicit
revision extracts all ten, preserves alpha and records a revised receipt. No new
generation occurred. Offline output is under
`work/ui-decomposition/expedition-supplies-mixed-gap-20260916-r001`.

A separately compiled proposal changes four 35×35 currency sources to one plus
three bound instances; the 37×36 balance icon remains independent. Image board
parts reduce 10→7; document still has 43 components. The proposal preserves layout,
reference bytes and evidence, and does not replace the frozen generation batch.

This is source reuse, not screen-instance removal or semantic equality detection.
Do not reuse different state images on appearance similarity alone. Do not claim
five saved calls: the original redundant coins were already in one board request.
Source files may still be copied to individual component resource paths so the
consumer requires no new contract. Identical SHA-256 checks guard the copies.

No complete sample ZIP or Studio acceptance is claimed by this repair.
`human_visual_acceptance=false`; remaining generation and delivery stay separate.

Final offline suite: 506 tests, 487 passed, 19 skipped. Shared-source integration
covers both normal and sourced joins. Failed intermediate fixture run is retained
beside the final test log; no private services or media generation were used.
