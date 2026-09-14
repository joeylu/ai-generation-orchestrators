# Input acceptance and Create Hero v2 — 2026-09-13

Producer baseline ed20860. Added bounded text Input state adapter using existing
consumer appearance fields, true keyboard probes, focus snapshots, rendered text /
color checks and background-template checks. Independent readonly/disabled fixtures
preserve values and reject spurious input/change events. Non-text types, >256 limit
probes, IME/selection/caret/error skins remain explicit unsupported coverage.

Producer full suite224 passed. Create Hero24 state checks and actual Studio7 checks
passed. Official deterministic rebuild fixes delivered preview composition identity;
original reference bytes preserved. Runtime Slider64 is not reference evidence;
original numeric value remains unknown. Reference-visible TITLE caret is unsupported.
Full visual QA remains blocked/failed; human acceptance false.

Artifact: work/ui-decomposition/input-reference-upgrade-20260913-r001/create-hero-acceptance-r002/ui.component-handoff.draft.zip
SHA256: 485d5344e99868a1f36e6ccc85871e1126ac85778972c362348b7a63c9768218.
See audit.json and 中文报告.md beside the receipt. No consumer source changes or
media/model calls. Current real-sample v2 presence is15 types; Panel remains a gap.
