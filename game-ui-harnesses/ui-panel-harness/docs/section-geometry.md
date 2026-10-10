# Recipe-aware section geometry (SDK rc.3)

## Root cause and minimal fix

The published rc.2 archive (4,168,482 bytes, SHA-256
`a790474578bf72d9067c68d8b64633628a364752d3c7d2626d3f9ed628d01edf`)
reproduces `RECIPE_GEOMETRY` for a single Select with label 性别, choices 男/女
and initial 男. The semantic proposal is valid. The concise-v1 policy collapses
the section title and measures a 56px group, but the unchanged
settings.section@0.1.0 recipe requires 80px. With the title visible the group
measures 100px. Switch and Progress share this failure; the previous Slider
fixture measured 80px and did not reveal it. This is a local compiler failure,
not missing user information or grounds for another model request.

The shared presentation policy now applies the resolved section recipe minimum
to its final measurement for concise-v2 and visible-v2. Flow layout, native
intent arrangement, explicit composition and compilation use that same catalog
and measurement. `flow-layout.mjs` already consumes the measured section height
and needs no separate change. The compiler's geometry checks remain unchanged:
too-narrow sections and undersized controls still fail. The floor is read from
the actual pinned recipe, rather than hardcoded as 80.

For the reported Select, section height is 80px and the first row remains y=0.
The 24px needed to meet the minimum is below the row; no title node or 44px title
band is restored. Options, initial/current values, IDs, labels, bindings, events,
assets and valid play state are preserved. Multiple groups, Tabs, distinct
multi-control headings and explicit visible headings retain their rules.

## Versioning and recovery

The SDK default is `examples/modern-menu-headings-v2.catalog.json`, catalog
modern-menu-headings@0.20.0, compiler 0.28.0. Eight concise-v2 themes are 0.20.0;
the eight otherwise matching visible-v2 themes are 0.20.1. Recipes and visual
tokens are identical to rc.2. PanelSpec/Bundle fields and the `loadPanelSdk()`
return contract do not change. Both offline ES/IIFE runtimes recognize 0.28.0;
UGUI source remains 0.1.5. Use the matching pair of runtime digests supplied with
the release instead of retaining old runtime bytes under a new bundle.

Old catalog versions, heading policies and compiler 0.27.0 remain available.
Loading, validation, JSON roundtrip and unrelated edits do not silently upgrade
a saved bundle. Actual rc.2 Slider and visible Select golden bundles recompile
identically, as does the existing rc.1 fixture. A failed concise-v1 Select spec
still reproduces its old failure until the caller explicitly adopts the new
version; changing only a bundle's compiler version is not a migration.

For an existing valid bundle, use the existing
`model.adoptSectionHeadings('auto', currentPlayState)` or `'show'` operation with
the new SDK seed. It selects the otherwise identical v2 theme and records the
catalog/compiler transition and patch receipt. Legal state/assets/history are
retained. Success consumes one of the original ten edits; undo does not refund
it. Old-only seed catalogs continue to select their v1 policy.

For a saved rc.2 proposal that never compiled, there is no valid bundle to import.
Retain the original proposal and planning receipt, and explicitly apply the
existing `applyPanelPatch` set-theme operation to its spec using its current
spec digest. Select only the same theme ID/color/mode in the rc.3 seed catalog
(for example modern-mint-light@0.20.0), then compile against that catalog and
retain the new patch receipt. This deterministic recovery does not require a
model call. It changes the version reference, not the user choices or defaults;
it must not relabel the original planning receipt as a new real-model result.
Consumer integration of this operation is separate from the upstream fix.

## Verification and limits

`tests/section-geometry.test.mjs` covers all seven public row kinds, Select
choices/default, Slider 57, exact reported request through acceptProposal,
recipe-dependent height (including a 140px test recipe), strict negative
geometry gates, headings/multiple groups/Tabs, rc.2 replay, ordinary edits,
explicit adoption and history/budget preservation. The checked-in rc.2 bundles
were produced through the verified installed rc.2 SDK, not hand-authored.

The existing installed-SDK check uses explicit fake generation/edit transports,
compiles outside the checkout with no adjacent sources or node_modules, checks
Bundle JSON roundtrips and re-reads actual Web and UGUI ZIPs with byte/SHA-256
verification. Geometry checks cover seven row kinds, dark Select and two rc.2
goldens. Offline browser checks open those exported ZIP files, compare nodes
and state, exercise Select male-to-female and Slider 57-to-58, reload defaults,
check desktop/mobile scaling, cleanup, console and network requests. This is
upstream acceptance, not consumer Web acceptance or mobile typography approval.

Real model calls: 0. Unity native import: NOT_RUN. No Docker/Web project changes,
deployment, temporary vendor patch, model retry or new tool installation is part
of this release. Release assets include exact archive/runtime digests and
program-generated installation, geometry, heading and browser reports. Install
the complete new archive by tag and digest; rc.2 is never overwritten.
