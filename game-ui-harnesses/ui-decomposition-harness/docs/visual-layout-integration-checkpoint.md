# Visual layout and linkage integration checkpoint

2026-09-16. Producer changes integrate content-gap extraction 1.1/1.2,
explicit shared Image sources, measured frame fitting, processed-material refits,
visible material geometry checks, and the consumer's existing componentLinkages
and List.itemContents contracts. No new consumer synonyms are introduced.

The Expedition Supplies sample exposed narrow visible frames despite correct
PNG dimensions, price/selection ornament collisions and independently generated
state silhouettes. Fixes now verify declared Alpha extents and reserved paint
areas before packaging, reject same-item child overlap before generation, and
support source-bound nine-slice refits and explicitly evidenced monochrome state
derivation. The latter is derived artwork, not recovered reference observation.

The final sample used existing materials only. Full state/layout acceptance
passed 35 scenarios across nine interactive components; linkage acceptance passed
1,789 checks and produced 24 screenshots. Actual Studio save/reopen, ZIP export,
official CLI and Studio reimport passed, preserving reference members and mapping.
The successful local acceptance took 744.323 seconds, excluding generation and
earlier repair/failed attempts; this is not an end-to-end service latency promise.

Original reference comparison remained blocked by five unknown Input fields;
all 43 comparison scopes were unverified. Human visual acceptance remains false.
Texture/ornament differences and the authorized derived Name ordering remain
documented. Shared currency sources are implemented and fixture-tested but were
not retroactively regenerated in this sample.

Verification before this checkpoint: 517 offline tests, 498 passed and 19 skipped.
The final screenshot driver additionally passed its opt-in real-browser fixture.
Linkage screenshots use the complete measured canvas rectangle, check geometry
before/after capture, and have a bounded timeout with no automatic retry.

Consumer linkage/item ownership implementation is a separate consumer change;
this producer checkpoint does not commit or release that implementation. Public
consumers must use a compatible immutable consumer release before these profiles
can be advertised as available in a released installation.

Next test: a fresh reference with repeated same-size ordinary icons and compound
List rows, validating visible frame extents, icon reuse, text/ornament spacing,
real input and evidence-preserving roundtrip without sample-specific patching.
Freeze a fresh plan and obtain its compute authorization before new generation.
