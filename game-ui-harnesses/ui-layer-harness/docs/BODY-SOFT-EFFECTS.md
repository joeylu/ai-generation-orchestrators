# Whole-body anchors and separately observed external effects

Fresh approximate integrated host runs default to
`bodyObservationPolicy: host-body-observation-soft-effects-v3` and freeze
`bodyCoveragePolicy: observed-external-soft-effects-v1`. Strict runs retain the
v2 opacity coverage rule. Explicit v1/v2 profiles and historical failed jobs
retain their semantics and cannot acquire v3 declarations.

One uniform scale and translation still fit the measured body, with the frozen
corner residual and native measurement margin. External effects do not define
scale. Complete nonzero-alpha support defines storage; the viewport remains the
original screenshot size. This policy never removes alpha, crops by the body
box, slices a material or stretches axes.

## Independent semantic observation

V3 retains actual-alpha checker/light/dark/opacity attachments. The original
model answer additionally requires `outsideBodySupport`: four unique records
with `side` left/top/right/bottom, `classification` and concrete `evidence`.
Classification is `none`, `external-soft-effect`, `owned-artwork` or `uncertain`.
Only an external soft shadow/glow may use the second classification. Translucent
owned surfaces and outlines, missing parts, foreign objects and duplicates
cannot use it. Under default and explicit visual policies v1–v4, owned or
uncertain exterior support remains unresolved. Explicit visual policy v5 records
that same classification and evidence as a warning; it does not relabel artwork
or uncertainty as a shadow.

The measured body includes all owned artwork. Observers must not enlarge it to
absorb a shadow or shrink it to an inner icon. Evidence is an observer assertion,
not certified segmentation or machine proof of visual fidelity.

## Deterministic coverage constraints

The program uses the existing small measurement envelope around the body box:

- A solid core (alpha>=240) must exist inside the observed body. Every alpha>=240
  pixel must be inside its measurement envelope. A smaller internal icon cannot
  hide an opaque or nearly opaque backing, even with a shadow declaration.
- Exterior dense support (alpha128..239) beyond that envelope requires the
  corresponding independent `external-soft-effect` declaration. Top/bottom
  cover full width outside the envelope; left/right cover the intervening
  vertical interval. The partitions do not overlap.
- Every dense exterior component must connect by a four-neighbor alpha>=128
  path to a dense pixel inside the envelope. Detached dense islands reject.
- Unknown/owned exterior, omitted or duplicate sides, missing declarations,
  changed source/evidence and technical alpha failures still stop.

The semantic exterior and connectivity gates above retain their original
severity for default/v1–v4 policies. With an explicitly frozen v5 warning policy,
owned/uncertain classifications, nonopaque dense exterior without a shadow
declaration, and detached nonopaque dense components become
`visualCoverageWarnings`. The solid-core and alpha>=240 envelope constraints,
complete unique side declarations, reliable body correspondence, source/evidence
identity and schema checks remain mandatory. This distinction applies equally
to fixed/support processing, viewport delivery and source replay.

V5 reports also include `externalNonzeroAlphaPixels` and `externalAlphaMaximum`,
measured outside the frozen envelope, alongside the unchanged original
classifications. There is no new alpha cutoff or image cleanup. Faint owned
antialiasing/residue does not require null body boxes when the complete visible
body can be reliably measured. These warnings reach package review evidence and
the host's aggregate warning report, with human acceptance still pending.

The fixed alpha240 constraint bounds an explicit semantic exception; opacity
alone does not prove shadow ownership. Fully translucent anchors require
another reviewed method. No threshold is applied to the rendering image: all
source support, including faint or remote alpha below128, remains stored.
Reports include dense/solid support boxes, actual excursions, side counts and
observations, `semanticClassificationProven: false` and `alphaPixelsRemoved: 0`.

## Evidence and replay

V3 produces typed `ui_body_observation_soft_effects_v2` and
`ui_whole_body_registration_soft_effects_v2` documents. Both bind identical
`outsideBodySupport`, boxes, source/reference hashes and scope. The host checks
original response evidence and writes these documents itself. They require the
explicit coverage policy; legacy answers/contracts are not rewritten. Receipt
checking, fixed/support processing, viewport packaging and accepted-source
replay recheck the same policy and declarations.

Offline fixtures cover dense-shadow conflicts, faint-alpha preservation,
omitted opaque backing, detached islands, translucent owned artwork, uncertain
returns, old answer rejection and replay. These are not new real observations,
generation results, full-chain success or human visual acceptance.
