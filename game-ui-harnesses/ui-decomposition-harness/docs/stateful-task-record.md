# Stateful appearance hardening — 2026-09-12

Implemented a strict, reusable stateful acceptance command rather than editing
Quest Journal delivery records. Existing archives remain compatible inputs.
Only successful official import, deterministic matrix QA and real PixiJS state
checks publish the draft ZIP copy into a new receipt directory. The legacy
packager alone does not establish stateful acceptance.

Implemented profiles: Tabs, Button, CheckBox, RadioGroup, Select, Switch, List.
Unimplemented profiles and extra requested states fail explicitly. See
[stateful delivery](stateful-delivery.md) for roles, evidence, errors and the
bounded template/opaque-core checks; these are not final human visual approval.

Actual validation on this checkout:

* Decomposition full unittest discovery, including `STATEFUL_BROWSER_TESTS=1`:
  **126 passed** (23.792 seconds).
* Isolated snapshot of exactly the staged harness (excluding other unfinished
  workspace changes): **107 passed**, including real-browser state tests
  (21.771 seconds). Wheel build from that snapshot passed and includes the
  browser driver, new entry point and evidence schema.
* UI Component full unit suite: **337 passed**. TypeScript/static build passed.
* Persisted stateful regression: **7 successful component cases / 16 state
  screenshots**, plus one expected `STATE_DISTINCT_DUPLICATE` rejection after
  successful official import. Every source ZIP remained byte-identical.
* UI Component full browser suite: **75 passed, 6 failed**. This is not a green
  full-suite claim. Two existing decomposition tests expect the old 17 resources
  (now 21 with per-tab icons) and old 50px scroll result (now about 26px with
  semantic thumb sizing). Four workflow tests hardcode the unavailable local
  port 4173, ignoring the externally configured ephemeral preview port. This
  task does not modify the component runtime or those pre-existing tests.
* `git diff --check`: passed.

Fresh local evidence is under `work/stateful-acceptance-20260912-02` at repository
root. `regression.json` records actual case results; each successful case has its
own `acceptance` directory with ZIP, matrix, browser receipt and screenshots.
The synthetic fixtures are deliberate local regression controls, not a visual
acceptance claim about Quest Journal artwork. The reproducible fixture and
runner sources are checked in; generated local evidence is not a release input.

Historical Quest Journal ZIP digests were checked unchanged:

* r006: `41c577aa0c92292b09178f8e0c76c3cef4fc9c1068f6a6acd772f9add27ff445`
* r007: `37bba2823d5db10cd08622a1c574afbde51862300170872f927e122c8844dac0`

All new receipts keep `human_visual_acceptance: false`. No model/service calls,
retries, private provider state or old-record modifications were involved.
