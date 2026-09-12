# Reference visual observations gate v1

New reference-driven stateful deliveries must provide visualObservations in their
ui_state_evidence_v1: {path: 'observations.json', sha256: '...'}.
Legacy evidence remains accepted for runtime-only compatibility; absence does not
establish reference layout coverage or human visual acceptance.

The referenced ui_visual_observations_v1 contains texts with componentId, observed
text, world-coordinate region and minimum font size. Its dialogs specify whether
body is required, explicit backdrop parameters and minimum bottom content inset.
Author these observations while reading the original, before accepting a sample.
They are not generated-text guesses or states inferred from a runtime screenshot.

The deterministic stateful command verifies and copies the observation bytes,
imports with official CLI, captures default-inspection.json in real PixiJS, and
checks the observations before publishing its accepted draft ZIP. Failure writes
visual-observation-check.json and rejects with VISUAL_OBSERVATION_REJECTED.

Checks cover missing/truncated runtime strings, actual Arial font size and text
bounds, overlapping observed text, duplicate body ownership, native/raster scrim
ownership and bottom action clearance against the frame's real Alpha support.
Unit fixtures reject missing text, undersized type, misplaced/overlapping text,
extra body, incorrect backdrop and insufficient bottom clearance. The native
Dialog browser fixture also verifies source-over pixels and modal input.

Limits: the catalog is explicitly authored, not automatically complete OCR. Frame
ownership is checked against the declared structure; arbitrary duplicated painted
ornaments are not recognized. Strict original-image pixel diagnostics remain
separate. Default Arial identity is allowed to differ from source typography;
size, layout, content and color still require review. No technical receipt grants
human_visual_acceptance. No acceptance-scope exclusions are added to hide failures.
