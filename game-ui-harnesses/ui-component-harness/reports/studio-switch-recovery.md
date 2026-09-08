# Switch upload recovery

The reported source is a valid 152 × 83 PNG (12,701 bytes). Its retained provider
result already identified an enabled, checked `Switch`. Strict semantic
compilation and bundle creation accepted that exact response. Saved-result replay
also rendered it in the user's Codex in-app browser. No new model submission was
needed for those checks. The original low-level failure was not captured, so a
specific transport timeout is not established.

The original consumer catch handler incorrectly labeled downstream failures as
an unreadable image. Image decoding, recognition, bundle validation and canvas
creation now have separate errors. The supplied adapter supports a short POST
receipt followed by GET polling, with source/analysis identity checks and
cancellation. Matching private submissions can resume the same task or reuse the
completed response; unknown acceptance never silently creates another task.

The procedural Switch renderer is semantic/interactive output, not evidence of
pixel-identical reproduction of the source artwork's gloss and shading. Private
artwork, provider payloads, identifiers and configuration are excluded here.

Final executed regression and recovery evidence is recorded in the task ledger
and the accompanying `studio-switch-verification.json` report.
