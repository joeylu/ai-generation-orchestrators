# Explicit content-bottom whitespace

Every new ScrollView plan must explicitly decide its content bottom whitespace,
including zero with a reason. Missing is not zero. The producer
`layout_spacing.check_layout_spacing(document, plan)` checks the full ScrollView
inventory, List painted extents and resulting contentHeight, without adding any
consumer padding field. Its footer checks use explicitly measured Panel-local
inner-border positions and minimum child gaps; outer-frame containment is not
sufficient. Declare affected footer child IDs and preserve text/button separation.
Unknown ornament geometry requires inspection, never automatic guessed bounds.
Run the offline check with `python -m ai_ui_decomposition.layout_spacing
--document APPLIED_BUNDLE.json --plan SPACING_PLAN.json --output FRESH_REPORT.json`.
The producer spacing plan is version 1.0 with panelFooters (panelId, direct-child
componentIds, innerBottom, minimumGap, evidence) and scrollBottomSpaces
(componentId, bottomWhitespace, reason). Coordinates use the owning Panel/List
units. Every ScrollView must occur exactly once; only the existing single-List
content profile is supported. This is not an appearance-binding extension.

Producer bottom-space plan version 1.1 additionally requires
`previousBottomWhitespace`: previousContentHeight must equal the painted extent
plus this declared existing whitespace. New contentHeight is extent plus the NEW
bottomWhitespace, never previousContentHeight plus bottomWhitespace. This supports
replacing a proven existing gap without silently accumulating padding. Version
1.0 keeps its original zero-existing-space precondition. Consumer fields unchanged.

This is an offline producer planning rule, not a new consumer contract. Propose
the known painted content extent, viewport height, desired bottom whitespace and
resulting range before applying it. Require explicit user authorization for that
layout adjustment. Never default every sample to 20px overflow or derive content
height from an observed short thumb.

The current bounded implementation supports one existing List child:
`extent = list.y + max(0, itemCount * itemHeight - rowGap)`;
`contentHeight = extent + explicitlyApprovedWhitespace`;
`range = max(0, contentHeight - viewportHeight)`.
Other content models fail with EXTENT_UNSUPPORTED until their extent checks are
implemented. The source contentHeight must equal the known extent; repeated
application cannot accumulate invisible space. The plan is bound to the input ZIP
SHA-256 and expected geometry. Negative, nonfinite, boolean or stale values fail.

Use `python -m ai_ui_decomposition.scroll_bottom_space --source ZIP
--component-root CONSUMER --output FRESH_DIR --plan PLAN.json`.
The explicit plan has kind `ui-scroll-bottom-space-plan`, version `1.0`,
sourceSha256, componentId, previousContentHeight, viewportHeight,
bottomWhitespace and a nonempty authorization record describing the user's
actual approval. The record is not permission to perform model calls.

This CLI currently requires the existing always-visible scrollbar profile and
rejects a visibility change. Only existing contentHeight is emitted; there is no padding property in the
consumer bundle. Items, local coordinates, viewport, raster bytes and track
geometry stay unchanged. The tool replaces the superseded component entry in
acceptance-scope.derivedTestStates, retaining compared regions and original
reference state/mapping/image bytes. It refreshes document and archive references
and runs official CLI import before and after export.

Acceptance requires real wheel, thumb drag and keyboard input at top/middle/bottom,
bounded values and no duplicate boundary events. Inspect content movement, last
item visibility, reachable blank space, proportional thumb and end ornaments.
At positive scroll offsets the first row may be clipped at the viewport top;
check all six complete rows at the top and reachable bottom content at the end,
not simultaneous full visibility at every offset. Regress other controls and
save/reopen/export/official reimport. Unknown original scroll values still block
same-state visual acceptance; technical checks never grant human approval.

## Required standard-entry gates

freeze --capabilities requires --component-document DOCUMENT_OR_BUNDLE.json and
--layout-spacing PLAN.json when the inventory includes Panel or ScrollView. It
checks before creating a run/request. All capability IDs/types must match the
semantic document. Document, spacing plan and report are hashed snapshots;
batch.load rejects tampering. Old batches remain readable. New freezes without
semantic preflight explicitly record legacy_not_checked, not spacing coverage.

component-handoff --layout-spacing PLAN.json and its Python export API check the
actual exported document automatically. ScrollView or direct Panel Button children
cannot export without a plan, including after legacy freeze. Failure creates no
new handoff ZIP. No relevant controls means not_applicable. Old opaque documents
are legacy_not_checked. Existing archives and consumer imports remain unchanged.

Both standard gates require producer spacing plan 1.1: standalone 1.0 plus required
nonFooterButtons, a mapping from direct Panel Button ID to a nonempty reason (such
as header close). Each direct Panel Button must occur in panelFooters or this map,
never both. Missing classifications, scroll decisions, invalid gaps/extents and
conflicting IDs fail. Explicit classification and measured ornament geometry are
still caller evidence, not automatic pixel interpretation.

Export receipts include the report, documentDigest and planDigest. These fields
are producer records, not consumer manifest or props extensions. Standalone 1.0
remains available for old plans but cannot satisfy the new standard gate.

```sh
ai-ui-decomposition freeze --plan plan.json --workspace work --run new-run --capabilities capabilities.json --component-document component.json --layout-spacing spacing.json
ai-ui-decomposition component-handoff --delivery delivery --component-bundle component.json --appearance-binding binding.json --layout-spacing spacing.json --reference-original original.png --reference-state state.json --acceptance-scope scope.json --reference-mapping mapping.json
```
