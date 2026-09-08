# Implementation tasks

Approved scope: full UI mainline, separate component/canvas motion, local Web
acceptance, deterministic import/export and Agent entry. No remote publication.

| ID | Deliverable | Dependencies | Status | Acceptance |
| --- | --- | --- | --- | --- |
| R00 | Allowlisted migration, root exception, Button repair and baseline | audit | COMPLETE | legacy tests, production browser input and 14 probes |
| C10 | Strict v0.2 document/intent/policy with v0.1 preservation | R00 | COMPLETE | valid/invalid types, paths, IDs, limits |
| C11/C12 | Image and Text with explicit font/layout/resource rules | C10 | COMPLETE | actual PixiJS rendering, crop and failure checks |
| C13/C14 | Container tree and deterministic intent compiler | C10 | COMPLETE | nested layout, stable identity, fact checks |
| C15/C16 | Atomic tree runtime and composite fixture | C11-C14 | COMPLETE | shared resources, reload, teardown, composite browser |
| C17 | Composed Button with Image/Text children | C16 | COMPLETE | one activate, no duplicate baked text |
| U20 | File/intent/contract import, verified portable bundle and reload | C16 | COMPLETE | fresh page round trip, checksums, path safety |
| L31 | Supported/Composite/Unresolved/Custom-required analysis ledger | C10 | COMPLETE | source-bound caller records and explicit retry budget; 5 tests |
| K40 | Switch, CheckBox, RadioGroup | C15 | COMPLETE | actual mouse state changes, enable/disable and events |
| K41 | ProgressBar, Slider | C15 | COMPLETE | ranges, step, cancellation and explicit program values |
| K42 | Input, Select | C12/C15 | COMPLETE | keyboard, read-only, disabled input, synthetic composition, popup |
| K43 | ScrollView, List | C13/C15 | COMPLETE | clipping, wheel, item selection, repeated nodes and cleanup |
| K44 | Panel, Dialog, Tabs | C13/C15 | COMPLETE | composition, modal isolation, active-page visibility |
| A50 | Full interactive canvas and node inspector | K40-K44 | COMPLETE | 35-node / 16-type gallery and multi-control interactions |
| M70/M71 | Separate motion contract, reusable clips and playback | A50 | COMPLETE | explicit offsets, conflicts, seek/stop/replay, restore |
| H60 | CLI/library, Skill and source packaging | U20 | COMPLETE | fresh source install/build/test and installed CLI/library round trip |
| Q60 | Engineering end-to-end regression and review | all implemented | COMPLETE | 116 unit tests, 21 production browser tests and reviewed Button |
| L30 | Real online vision provider | configured provider | BLOCKED | no provider/model/auth selected; never fake success |
| E80 | Other engine adapters | selected engine/version | BLOCKED | no engine selected |
| Q61 | Real composite artwork, physical devices, visual signoff | user material/devices | NOT_RUN | procedural fixtures do not prove these |

The original source snapshot and its audit reports are historical evidence.
The original mainline reports use the `reports/current-*` prefix. The later
Motion Skill extension is recorded in `reports/motion-skill-*`.

## Executed evidence

- `npm run verify` records real exit codes, source fingerprints and results in
  [current-verification.json](../reports/current-verification.json): 116/116 unit
  tests, build, self-test, doctor and 21/21 production-preview browser tests passed.
  Environment: Windows, Node 25.9.0, Edge with software WebGL (SwiftShader).
- Browser cases cover the 16-type gallery, trusted mouse/keyboard, read-only and
  disabled Input, synthetic composition, modal isolation, popup interaction,
  scroll/list/tabs, bundle restoration in a fresh page, missing/corrupt resources,
  font failure, text overflow, concurrent requests, repeated reload, shared-image
  destruction, strict value mutation and motion reset. Screenshots are local
  visual evidence; there is no pixel-difference quality gate.
- [Reviewed original image](../reports/current-reviewed-image.json): the supplied
  347×133 Button was visually inspected in conversation, its baked text confirmed
  as “确定”, then imported and compiled from the existing strict intent. Trusted
  click/outside release, 14 original probes, disabled-state export, embedded
  resource restoration and unchanged original SHA-256 passed. This is one real
  whole-image Button, not a second image or a decomposed composite.
- Repository public-boundary checks passed 8/8. The full Python repository suite
  was not established in this environment: two unrelated test modules require an
  uninstalled `ai_frame_animation` package. Other Harnesses were not modified.
- Skill metadata was validated with the skill-creator validator. CI now includes
  Node installation, unit/build/self-test and Chromium production browser checks;
  that remote Linux CI job has been authored but has not run here.
- [Fresh source installation](../reports/current-source-install.json) passed
  `npm ci --ignore-scripts`, 116 tests, build and self-test after extraction into
  a new directory. The final source archive additionally carries these reports
  and completed task status; implementation files remain the tested versions.
- [Installed package verification](../reports/current-installed-package.json)
  passed library import without a source tree, all Skill links, all seven CLI
  commands, composite document/motion round trip and both resource checksums.
  Installation may fetch public npm dependencies; the tested CLI commands run
  offline. Neither package has been published to a registry or deployed.

## Motion Skill extension (2026-09-08)

| Task | Status | Acceptance |
| --- | --- | --- |
| M72: independent UI Motion Skill and 16-component coverage matrix | COMPLETE | Skill validator passed; machine-readable 16-type and actual-node capabilities share validator rules |
| M73: offline preset compiler, CLI and reusable examples | COMPLETE | Five explicit presets, 80 type/recipe combinations, five offline commands; immutable UI and strict failures |
| M74: engine semantics and adapter boundary | COMPLETE | Explicit units, transforms, easing, clock and lifecycle; only PixiJS implemented |
| M75: preset/browser/package checks | COMPLETE | 136 unit + 23 production browser tests; installed package works without src and all Skill links resolve |

Earlier release reports above describe the pre-extension snapshot. Executed
extension checks and fingerprints are in
[motion-skill-verification.json](../reports/motion-skill-verification.json).
The browser addition checks centered pulse/reset on all 16 node types (including
hidden nodes numerically), plus real Button activation/replay/disabled behavior.
It does not establish every preset's visual quality, all specialized feedback,
transformed Slider gestures, Select/Dialog overlay correctness, or another engine.
The source build and Skill metadata validator also passed.

## Three-style component motion system (2026-09-08)

| Task | Status | Acceptance |
| --- | --- | --- |
| M80: versioned Playful/Premium/Corporate profiles and 16-type action registry | COMPLETE | Strict compiler/catalog, all 48 style/type pairs; 35 explicit gallery node bindings per full-canvas profile |
| M81: interruptible concurrent presentation scheduler | COMPLETE | 56 focused core tests; fake-clock cancellation/reentrancy and shared scheduling; batched drawing for system channels |
| M82: Pixi control-specific feedback | COMPLETE | 10 motion + 6 lifecycle browser cases pass; real controls, composite Button pixels and Tabs indicator pixels |
| M83: workbench, CLI and portable system bundles | COMPLETE | Three new CLI commands, style controls and coexisting timeline/system bundle 0.2; six IO regressions pass |
| M84: Skill and generated examples | COMPLETE | Skill validator and independent offline forward test; original Lottie Button references distinguished from Harness extensions |
| M85: integrated acceptance and package review | COMPLETE | 198 unit + 39 production browser tests; zero retries/skips/failures; installed package without src passes all 15 CLI commands |

Earlier motion-skill reports describe the historical whole-node recipe snapshot.
The new system owns a separate presentation layer, including generated parts and
composite children; manual previews do not override host visibility/business
state. Strict review led to regressions for subset action ownership, Input/Slider
programmatic changes during real input, hidden overlays, modal z-order and nested
portal transforms. No provider or media generation was used.

Executed commands, all 39 browser case results and implementation fingerprints:
[motion-system verification](../reports/motion-system-verification.json).
The library, all eight motion commands, all seven component commands, both
attachment types, 35 gallery bindings, original resource bytes and the Skill's
11 reachable reference documents were checked in a fresh installed package:
[installed-package verification](../reports/motion-system-installed-package.json).
Execution reports ship with the source archive; the npm package contains the
runtime contracts, CLI, Skill, examples and documentation.

The reviewed local purchase artwork also received an explicit v0.2 Button + Image
adaptation and all three styles. Browser checks confirm real image pixels and
child bounds scale on press, exactly one activation, preserved system bindings
and unchanged original resource SHA-256. Its image/bundles remain local; the
public package contains only the [numerical check result](../reports/motion-system-purchase.json).

## Component and motion workflow integration (2026-09-08)

| Task | Status | Acceptance |
| --- | --- | --- |
| M86: formal main-Skill motion stage and strict workflow compiler | COMPLETE | Both Skills validated; nine focused compiler/runner tests pass; static and legacy command routing preserved |
| M87: unified local run command and browser gate | COMPLETE | Intent, both attachments, real target activation, pixel changes, fresh-page restoration and resource-cache teardown pass |
| M88: failed-run isolation and bounded local resources | COMPLETE | Contract, traversal, junction and byte-limit failures tested; failed interaction/decode/overlapping-target cases produce no success bundle; reruns cannot overwrite |
| M89: independent forward test and installed distribution | COMPLETE | Independent composite workflow passes four checks; installed CLI without src passes original purchase press/click and preserves resource SHA-256 |
| M90: complete regression and evidence | COMPLETE | Build, 207 unit tests, 43 browser tests, self-test and doctor pass; zero skipped/flaky/retried browser cases |

The workflow accepts reviewed explicit inputs; it does not run image recognition
or provider generation. Declared browser checks are scoped evidence, and the
run report keeps `humanVisualReview: NOT_RUN`. Existing source/package snapshots
above remain historical evidence.

Executed regression commands and source fingerprints are in
[workflow verification](../reports/workflow-verification.json); the installed
library/CLI and original-resource check are in
[installed-package verification](../reports/workflow-installed-package.json).
The independent forward run exposed ambiguous `targets: "all"` guidance:
it is now explicitly scoped to `run.json`'s workflow wrapper. The direct motion
CLI still takes an explicit array. Final Skill checks and the forward-run
evidence are recorded in [workflow delivery checks](../reports/workflow-delivery.json).

## Consumer preview studio (2026-09-08)

| Task | Status | Acceptance |
| --- | --- | --- |
| M91: consumer page and separate engineering workbench | COMPLETE | Root UI contains reference upload, canvas, scheme comparison and export; workbench moved to its own page; desktop and narrow viewport screenshots reviewed |
| M92: reference and scheme lifecycle | COMPLETE | Whole-image preview, explicit Button mode, independent comparison canvases, bundle restoration and selected-scheme export verified |
| M93: consumer and existing workflow regression | COMPLETE | Build, 207 unit tests, self-test, doctor and 50 browser tests passed, including seven consumer cases and the existing workflow cases |

Evidence: [studio verification](../reports/studio-verification.json). Consumer coverage includes actual downloads with exact source bytes, timeline and system replay together, failed imports, latest-input ownership, reset and narrow viewport layout.

## Semantic upload correction (2026-09-08)

The prior M91–M93 upload-as-Image implementation did not perform semantic
recognition. It is superseded by the following work; its previous test report
remains historical evidence, not proof of online vision.

| Task | Status | Acceptance |
| --- | --- | --- |
| M94: upload through semantic compilation | COMPLETE | Removed Image/Button selector; source-bound strict model envelope supports all sixteen types; eight browser cases verify semantic results, export, uncertainty, errors and stale responses |
| M95: optional local MCP adapter | COMPLETE | Server-only configuration, bounded transport, persisted submission and receipt, no automatic resubmission; eight bridge tests and four MCP adapter tests pass with test doubles |
| M96: real vision service acceptance | PARTIAL | Business key configured; two real submissions, second Button + Image result normalized and accepted through click/comparison/export/restoration; uninterrupted fresh upload on the final adapter not executed |
| M97: live-response reliability fixes | COMPLETE | Strict recorded one-brace normalization, preserved raw result, at most three read-only queries of the same task after transport errors; 225 unit and 51 browser tests pass; final configured preview restarted |

Executed [semantic upload verification](../reports/studio-vision-verification.json):
build, 222 unit tests, self-test, doctor and 51 browser tests PASS. Browser tests
used the existing local development server; production assets also build. Direct
browser inspection of the actual unconfigured bridge returned `configured:false`
and upload displayed the service-configuration error with zero canvases and export
disabled. This is historical failure-path acceptance. Subsequent real-model
evidence and its explicit recovery limits are recorded in
[real MCP acceptance](../reports/studio-mcp-live.md).

## Switch upload error and result recovery (2026-09-08)

| Task | Status | Acceptance |
| --- | --- | --- |
| M98: stage-specific upload errors and short-request polling | COMPLETE | Image decode, recognition, bundle and canvas failures are distinguished; Pending POST followed by GET polling, identity drift and cancellation covered |
| M99: reuse existing accepted vision work | COMPLETE | Exact source/instruction/bytes reuse completed raw output or the same pending task; repeated completed GET and submission records above 1 MiB covered; actual retained Switch returns Ready with zero provider calls |
| M100: regression | COMPLETE | Build, 230 unit tests, self-test, doctor and 55 browser tests PASS; no skipped or retried cases |

Evidence: [Switch recovery](../reports/studio-switch-recovery.md) and
[executed verification](../reports/studio-switch-verification.json). The valid
152 × 83 source was already recognized as a checked Switch. Saved-result replay
passed in the Codex in-app browser. No new model job was submitted for this fix;
the original low-level failure remains unknown. After restarting the final preview,
the original Switch image was uploaded through the normal root page in the
Codex in-app browser. It recovered the saved result, displayed the Switch
recognition, and enabled preview, comparison and export. Private submission count
remained unchanged at three. The final screenshot approval timed out, so no new
screenshot is claimed. This does not change M96's
uninterrupted fresh-provider-upload limitation.

## Remaining external acceptance

Additional real-input acceptance (2026-09-08): the new 272×128 “购买” Button was
reviewed by the requested Luna xhigh subagent, compiled, rendered, clicked, tested
with 14 probes and restored after a full page reload from its portable bundle.
See [second Button acceptance](../reports/purchase-button-review.md). This extends
real Button evidence; it does not resolve the composite-artwork requirement.

The optional online vision adapter is now configured locally with real Button
evidence as recorded above. A second engine/version remains BLOCKED.
Real composite artwork/clean layers, physical touch/pen and native IME panels,
additional browsers, narrow physical devices and user visual signoff are NOT_RUN.
Explicit CORS/timeout/WebGL-context-loss fault injection and long-duration memory
pressure are NOT_RUN; implemented handling is not a claim those injections passed.
