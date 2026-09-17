# Reference handoff v2 consumer

The consumer uses the producer's existing `ai_ui_component_handoff_v2`,
`ui-reference-state` v1 and `ui-acceptance-scope` v1 contracts unchanged. See
`../../ui-decomposition-harness/docs/reference-handoff-v2.md`. No reference
values are inferred, generated or promoted from runtime defaults.

## Saved schemes and transferable exports

Consumer **UiBundle 0.3** extends the existing portable bundle with the required
`componentHandoff: {sha256, base64}` attachment. It contains the exact validated
source ZIP, including original image bytes, derivatives, coordinate mappings,
observed/unknown states, acceptance scope and upstream decomposition/binding.
It may also contain the existing optional `motion` and `motionSystem` fields.
Bundles 0.1/0.2 retain their existing meaning and cannot carry the attachment.

Every load validates the attachment digest and recompiles the complete original
handoff. The current document and resource bytes must match that compiled source,
except for the existing control value fields (checked, selectedId, activeId,
scrollX/Y, value, open). Changes to structure, IDs, options, layout, canvas,
appearance, text or resources reject with `REFERENCE_EVIDENCE_STALE`. Motion
remains a separate attachment; reference replay uses the static presentation.
Invalid evidence is never silently dropped or patched. The inner semantic bundle
cannot itself contain a handoff attachment, preventing recursive archives.

Re-export preserves the original sampling semantic bundle and appearance binding
bytes. Current control values and motion are saved in the authenticated
`runtime.ui-bundle.json` member of a **handoff 2.1 draft**, according to
[the existing runtime snapshot contract](runtime-handoff-v2.1.md). This prevents
edited selection values from invalidating the original sampled appearance binding.
The exporter writes deterministic ZIP_STORED and runs the official importer/compiler
again. Original/derived images, reference state, mapping, acceptance scope and
nested decomposition bytes are unchanged. The inner semantic/runtime bundles use
0.1/0.2; consumers limited to handoff 2.0 must reject 2.1. Raw original images are
never recompressed or replaced by screenshots.

## Commands

From this directory, with dependencies and a local browser already installed:

```sh
npm run build
node scripts/cli.mjs component-handoff input.zip --output saved.ui-bundle.json
node scripts/cli.mjs reference-export saved.ui-bundle.json --output exported.zip
node scripts/cli.mjs reference-accept exported.zip --output new-acceptance-directory
```

`reference-accept` needs only the ZIP and a new output directory. Its parent must
exist. It uses the bundled static `dist/reference-acceptance.html`, starts an
ephemeral loopback static server, launches local Playwright (Edge on Windows,
Chromium elsewhere), prohibits external browser requests, captures actual PixiJS
at native canvas pixels, and closes its browser and server on success or failure.
It never runs Vite's vision bridge, downloads a browser, or contacts a provider.
The package includes the acceptance page/assets; local `@playwright/test` and its
browser are prerequisites. Windows rendering uses software WebGL. Capture is
limited to 8192 pixels per axis and 16,777,216 total pixels; oversized canvases
fail explicitly rather than being silently resized.

The directory is reserved exclusively and cannot be overwritten. `report.json`
always records a terminal result once a directory was created. Exit 0 means
`technical_passed`; exit 2 means `blocked` or `failed`. Syntax/existing-output
errors exit nonzero without touching the existing output. Reports include input,
package and screenshot SHA-256, runtime state, unknown fields, pixel comparison
policy and actual per-component results. `roundtrip.*.draft.zip` is a validated
portable **draft**, not proof of visual acceptance; it may accompany a blocked
report for further inspection. Browser/decoder failure cannot produce a passed
report. Reference replay is explicitly not reported as real-input interaction
acceptance.

## Preview and comparison

Studio ZIP import and saved scheme import populate the reference panel below the
live canvas, at the same display scale. The toolbar exports the complete handoff
ZIP; the usual scheme export saves bundle 0.3. A fresh sampling ZIP restores known
reference states (including an observed open Select). A saved scheme or handoff
2.1 retains saved runtime values rather than silently replaying source state.
Runtime screenshots and explicit reference replay remain available through the
official acceptance/workbench APIs. Original and derivative evidence remain
separately identified in the package; derivatives do not replace the original.
Workbench exports preserve the attachment and expose `replaySavedReferenceState`
and `exportReferenceHandoff` in addition to the existing low-level replay API.

Image decode strips orientation metadata from an in-memory copy only. Mapping
applies crop → flips → clockwise quarter-turn with translated bounds → independent
x/y scale → offset. PNG, static GIF, JPEG, WebP and BMP can be displayed. Animated
references are blocked: the current handoff contract does not specify a frame.
Derivatives retain their declared original-to-derivative mapping and are shown
as separate evidence, never substituted for the original.

Comparison policy `ui-reference-rgba-comparison` v1 uses premultiplied RGB plus
alpha, channel tolerance **8/255** and at most **1%** differing pixels per compared
component. It measures primitive bounding rectangles in actual renderer paint
order, intersects renderer mask bounds, includes Select popups and foreground
chrome, and assigns overlapping pixels to the last painted primitive. Transparent
texture margins are included; an excluded component removes only its owned
pixels, not its entire subtree. This is a conservative rectangular region policy,
not semantic segmentation or a perceptual texture metric. The runtime currently
uses rectangular clipping masks. Reports retain the rectangles, counts, thresholds
and screenshot digest so the exact scope can be audited.

Any unknown field blocks full same-state comparison. Observed fields must also
match actual runtime inspection after replay; clamping or a different current
value blocks comparison. Excluded rows keep their reasons. Compared components
without visible owned pixels or outside mapped reference coverage are blocked,
not silently passed. Empty compare scope is blocked. Pixel differences within a
`compare` row count against the fixed threshold; prose reasons never override it.
Legacy packages still render with an explicit missing-reference-evidence warning.

All reports and exports retain **human_visual_acceptance: false**. Technical
comparison is neither a subjective visual verdict nor a reconstruction of unknown
scroll positions, hidden content or backend behavior.

## Offline regression

```sh
npm test
npx playwright test --config playwright.reference.config.ts
```

The browser config writes a fresh timestamped output directory by default.
`UI_REFERENCE_TEST_OUTPUT` can select a new evidence directory. Tests use local
procedural fixtures, including a reference rasterized independently of PixiJS.
They cover scheme reopen/export/import, byte identity, stale references, unsafe
paths/digests/mappings/options, unknown values, idempotent Select replay, real
mouse/keyboard value-event-visible feedback in Studio, all coordinate operations,
legacy warning, isolated ZIP-only execution, pixel mismatch, decoder failure,
cleanup and overwrite refusal.

## Partial reference comparison (report/policy 1.1)

The consumer continues comparing independent known regions when reference state
contains local unknown ProgressBar values. Unknown component bounds mask all
intersecting owners; their regions are unverified even if scope excludes them.
Unknown non-ProgressBar state (scroll, selection, popup, etc.) conservatively
blocks comparison because descendants/occlusion may change. No values are inferred.
Observed/runtime state mismatches and missing evidence still block replay comparison.

Report statuses: technical_passed (exit 0); partially_verified (exit 3, some known
scopes passed and none failed, incomplete coverage); visual_failed (exit 2, actual
known pixel differences; coverage may also be partial); blocked (exit 2, insufficient
verifiable scope/evidence); failed (exit 2, execution/cleanup error). Automation may
continue delivery on exit 3 only as an explicitly partial result, never full approval.
Artifacts are retained for all completed captures. Read comparison.counts and each
scope's reason; human_visual_acceptance remains false. This versions consumer
report and comparison policy to 1.1; producer handoff/state/scope fields are unchanged.

## Studio static artwork policy
All four Studio schemes keep only the first full-canvas Image (global origin 0,0, dimensions equal to the canvas) and its transform ancestors static. This is the explicit Studio backdrop convention; when absent, no images are excluded. The policy traverses Container/Panel/Dialog structure without matching IDs or filenames. Images owned by interactive controls remain part of control feedback. Imported motion-system bindings and timeline tracks targeting protected nodes are filtered for Studio playback and export; empty animation documents are omitted. Source UI, original reference evidence and the input ZIP remain unchanged. Explicit low-level runtime motion APIs outside Studio retain their authored semantics. Other decorative images and panels retain their motion. This is a Studio scheme policy, not a new handoff field.


