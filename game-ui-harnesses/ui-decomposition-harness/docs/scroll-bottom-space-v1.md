# Explicit content-bottom whitespace

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
