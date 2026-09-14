# Reusable Studio and composition checks

These are producer-only local checks. They neither extend the consumer contract
nor generate art. Both commands require fresh output directories and preserve
`human_visual_acceptance: false`. They do not replace full stateful acceptance or
the final strict `delivery-check`.

## Studio entry

```sh
ai-ui-decomposition studio-acceptance --source handoff.zip --component-root local-consumer --output new-studio-receipt --timeout-seconds 600
```

Use the current built local consumer. The entry opens the actual Studio, imports
the ZIP, discovers ScrollViews by semantic ID, and uses real wheel/drag/keyboard
input. Its supported profile is vertical, always-visible, inset-decorated
ScrollViews with at least one content child. Missing profiles fail explicitly;
it does not silently skip those ScrollViews. Nested moving/animated viewports and
horizontal scrolling have not been established by these tests.

Checks include top/middle/bottom and repeated boundaries, finite bounded values,
events, content translation, proportional thumb geometry, track-end containment,
unchanged List selection, and no outer-page scrolling. Zero range is tested with
the same real inputs. Other component states remain the responsibility of
`ai-ui-stateful`; the report states this coverage boundary.

All document/resources and new appearance fields must survive Studio save/reopen,
full ZIP export, official CLI import and Studio reimport. Reference members and
acceptance-scope must additionally remain byte-identical. Legacy packages without
reference evidence are labelled as such, never upgraded to visual readiness.

DPR is fixed to 1. Coordinates come from the current canvas bounding box and
document dimensions; CSS is never resized to force pixel matching. A point outside
the visible page fails. Screenshots at Studio display scale are visual evidence,
not an exact PNG source-pixel oracle. Run native-size stateful image comparison
for material pixels and transparent caps. The deadline closes the browser and the
CLI subprocess uses the remaining budget; the wrapper allows 10 seconds for
teardown. No automatic retry or passing-receipt reuse occurs.

## Composition entry

```sh
ai-ui-decomposition composition-check --bundle consumed.json --screenshot native.png --plan composition.json --output new-composition-receipt
```

Producer plan 1.0 contains exactly `version`, `screenshotSha256`, `backgrounds`
and `rowSpacing`. This is an evidence plan, never a consumer props extension.

Each background entry contains `componentId`, `ownerId`, nonempty `reason`,
`parentOnly: {path, sha256}`, `points: [[x,y], ...]`, and integer `tolerance` (0–255).
The owner must be self or an ancestor. For ancestor ownership, explicit
`props.drawBackground:false` is mandatory. Conflicting ownership fails even if the
colors happen to match. Exposed points are compared with the digest-bound
parent-only baseline at identical native-canvas coordinates. Unexpected paint at
those points fails. The baseline must be an independently captured deterministic
parent-only composition, not a copy of the candidate labelled as expected output.
Keep its generation/capture provenance with the evidence. No automatic ownership,
border detection or arbitrary baked-icon detection is claimed. Sampling proves
only the declared exposed locations, not every pixel of every component.

Each row-spacing entry contains `componentId` (List), `state`, nonempty `reason`,
`paintBounds: [[x,y,width,height], ...]` in top-to-bottom screenshot order and
`preferredGap: [minimum,maximum]`. Measure actual visible borders, including
texture-internal padding, not just itemHeight/rowGap or opaque alpha bounds.
Measurements are explicit screenshot-bound evidence; the tool does not discover
them from pixels. Run separate plans/captures for normal and selected rows.
Negative gaps fail as overlap. Positive spacing outside the explicitly chosen
range is `ROW_DENSITY_ADVISORY`: it does not block export, trigger regeneration,
change layout or invent content. There is no universal density threshold.

Invalid IDs, missing evidence, stale digests, illegal paths and resized screenshot
inputs fail. Reports list unchecked Tabs/List/ScrollView backgrounds and unchecked
List spacing, so a partial plan cannot claim full composition coverage.

## Normal delivery integration

After initial native runtime composition, execute composition checks for exposed
background ownership and visible row-spacing evidence. Resolve structural
failures; report cosmetic warnings and unchecked coverage. Once stable, run full
stateful acceptance, this reusable Studio entry for its supported profiles, and
final `delivery-check`. For other profiles, preserve the explicit unsupported
result and use the established specialized adapter with separately stated scope.
Do not change acceptance-scope to erase differences. Existing ZIPs are unchanged.

Regression sources: `test_composition_checks.py`, `test_studio_acceptance.py`,
`studio-fixture.mjs`. Enable local browser tests using `UI_STUDIO_BROWSER_TESTS=1`.
They use synthetic local pixels and the current consumer; they install nothing.
