# Independent asset boards

Generate explicitly grouped similar materials together, then extract separate
PNGs using existing board strategies. No UiDocument, consumer or Studio required.
Input is a complete ordinary PNG asset plan with a bound
[reviewed reference inventory](reference-coverage-v1.md), plus this group file:

```json
{"kind":"ui_assets_board_groups_v1","groups":[{"id":"task-icons","assetIds":["book","leaf"],"packingCanvas":[512,512],"extractionPolicy":{"version":"1.0","mode":"relative-cell","target_padding":2,"max_canvas_aspect_error":0.15}}]}
```

Groups contain 2..16 distinct generated keyed important components, without cached
results or resize recipes. Widths and heights may differ by at most 2x. Review
semantic suitability, disconnected strokes and whitespace, not size alone.
`extractionPolicy` is the existing board policy (versions 1.0..1.5), with unchanged
restrictions. For uncertain row packing consider the existing content-gap policy.
Backgrounds and ungrouped assets retain separate requests. Original source
rectangles, prompts, target sizes, nodes and groups remain explicit.
Compiled prompts distinguish search boundaries (left, top, right, bottom) from
suggested drawing rectangles (left, top, width, height). Each part retains its
target aspect ratio; unused window space stays empty. A search window must not
be interpreted as a rectangle to stretch the artwork into. These instructions
reduce ambiguity but do not establish that generated geometry will be correct.

```text
ai-ui-assets board-compile --plan project/covered-plan.json --groups groups.json --output compiled-r001
ai-ui-assets board-freeze --compiled compiled-r001 --workspace workspace --run generation
```

Compilation emits `target-plan.json`, intermediate generation-only `plan.json`,
strategies and a digest-bound `material-catalog.json`. Generation prompts bind
the target plan and strategies. Never deliver the intermediate board placements.
Freeze verifies compilation and selects deferred preflight. Review the actual
request count and plan digest, obtain fresh user authorization, then use the
existing `authorize-generation` and `export-loop` asset commands. None of these
planning commands generates or authorizes media.

For `export-loop`, `--output-root` must be the existing directory where the
image tool actually saves returned PNGs, not a desired delivery directory.
Export does not configure the tool's output destination. A missing source root
is rejected before the host script is written; an existing directory alone
does not prove that the tool will write there. Confirm it from host evidence.
Subagents can have a different output directory from their parent task. If a
tool response is already durably recorded but receiving it failed, do not repeat
the call. Export a new loop with `--returned-response OLD-JOURNAL-EVENT.json`
and the verified actual `--output-root`. This bounded recovery requires exactly
one reserved request matching a `tool-returned` event. It binds the event file
hash, verifies actual PNG bytes against the saved inline result, receives that
image and calls only the remaining requests under the original authorization.
Keep the old journal. Missing/uncertain tool returns are not recoverable by this
option. A changed event or already received request is rejected. Local commands
that yield a session are polled to completion, never executed again.
When a host places images in separate agent session directories, explicitly set
`--output-root-mode session-child` with the verified common image-output root.
Only one session-directory level is allowed; deeper paths, sibling roots,
symbolic links and mismatched inline/file bytes are rejected. The default remains
`direct`. Neither mode changes the image tool's destination.

After all images have been received:

The tool loop writes `completion.json` beside the exported entry after persisting its complete
execution summary, then emits `completion-ready`. A coordinating Agent can read
this small file as soon as it appears instead of waiting for a second narrative
handoff. It binds the full journal entry by SHA-256 and separates tool generation
time from loop elapsed time. Recheck official `generation-status` before processing;
the summary is a notification, not authorization or receipt evidence. An absent
summary never authorizes resubmission: inspect the existing journal and official
request state. Keep the parent task as the sole owner of the total timeline.
Before delegation provide the frozen run, digest, exact exported entry and verified
output-root mode once. The executor still performs the host's fresh-state check;
it must not repeat planning, rewrite prompts, or wait to compose a narrative after
the loop reports completion.

```text
ai-ui-assets board-preflight --compiled compiled-r001 --run-dir workspace/runs/generation --output preflight-r001.json
ai-ui-assets board-process --compiled compiled-r001 --run-dir workspace/runs/generation --output processed-r001
ai-ui-assets review-template --run-dir processed-r001/workspace/runs/materialized
ai-ui-assets finalize --run-dir processed-r001/workspace/runs/materialized --output delivery-r001 --draft
ai-ui-assets export --delivery delivery-r001
```

Review contact sheet and composite. `--draft` requires the original plan's draft
policy, and never grants human acceptance. For reviewed plans obtain acceptance
of the exact contact sheet and omit `--draft`.

Preflight validates every board part, including relative-cell 1.0, and aggregates
quality failures. Failed quality blocks materialization. Sources, original batch,
target plan and extraction strategy are reverified before extraction. The existing
processor handles independent materials; extracted parts restore the exact target
nodes/groups in a separately frozen imported-material batch. Its imported origin
is retained honestly; no new successful generation receipt is invented.
`lineage.json` binds the source batch, extraction/raw fingerprints, extracted PNG
hashes, target plan and materialized batch. Keep it with compiled and raw records.

Final ZIP inventory is unchanged: individual placed PNGs, scene, preview and
delivery receipts. Boards are not final layers. Semantic identity, perceived size
and state registration still require review. All failed runs are retained; no
automatic retries, guessed extraction or weakened checks. Changed grouping needs
a fresh compile/freeze and compute approval.

## Reviewed recovery without new generation

For a completed batch whose board canvas or layout differs from its planned
windows, use the existing [source-region revision](source-region-revision-v1.md)
measurements. Preserve the original failed preflight and run:

```text
ai-ui-assets board-recover --compiled compiled-r001 --run-dir workspace/runs/generation --specification recovery.json --output recovered-r001
```

The specification has `version:"1.0"`, the exact `batchDigest`, and a `revisions`
mapping keyed by generation asset ID. A board entry has `kind:"board-regions"`,
`rawSha256`, a nonempty `reason`, and complete `sourceRegions`; existing optional
`sourceAlpha` and `measuredFrames` retain their contracts. Explicit regions can
replace failed canvas-aspect or cell-clipping decisions only after fresh coverage,
clear-border, matte, target-geometry and source-identity checks. This is reviewed
measurement, not automatic semantic detection. No raw receipt is rewritten.

The shared reviewed-recovery material producer also supports its existing bounded
single-material revisions. A failed unaddressed material still blocks the whole
package. In particular, do not apply an empty-frame refit to compound artwork
whose symbols would be stretched. The new output retains `recovery-lineage.json`
and links it from `lineage.json`, then freezes an imported-material batch using
the original target nodes. Continue ordinary review/finalize/export from the
returned run directory. No component construction or browser is invoked.

A separately authorized, received and quality-passed single-material replacement
can use `kind:"verified-replacement-source"`. Supply the old `rawSha256`, a
`reason`, and the replacement's `sourceRunDirectory`, `sourceAsset`,
`sourceBatchDigest`, `sourceRawSha256`. Both original and replacement receipts
are verified. Original reference identity, source rectangle, target size, role,
output mode and processing geometry must match. Prompt text may differ because
the replacement has its own frozen plan and receipt. This revision supports
single materials, not board substitution; the old recoverable quality failure
is limited to the long-control aspect gate. Replacement quality must pass, and
its pixels are processed under the same geometry gate again. Lineage records
both sources separately; the old successful receive and failed quality remain
unaltered. Processing does not authorize or invoke replacement generation.

For independent diagnosis or partial progress, add `--materials-only`. Only the
named revisions are authenticated and reproduced. The response explicitly reports
`partial_materials_recovered`, `remainingAssets`, and `completePackage:false`;
it emits material PNGs and their recovery lineage, not a final plan or ZIP. This
does not approve failed unselected assets or relax the full-package requirement.

Recovery regressions cover a received board with a changed canvas, full PNG
export, unchanged failed quality bytes, rejected raw fingerprint changes and
absence of consumer processes. Source bindings compare the original plan source;
the separately normalized frozen reference is verified by the batch loader.

Offline verification (2026-09-19): 7 new board bridge cases, 12 existing board
cases, 7 asset generation cases, 7 deferred-preflight cases and 4 asset CLI cases
passed. Synthetic sources test final named PNG export and preserve the target
layer count; failed boards and changed target plans cannot be materialized.
No live-provider result or human visual acceptance is established by these tests.
