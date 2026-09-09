# Implementation tasks

Approved scope: full UI mainline, separate component/canvas motion, local Web
acceptance, deterministic import/export and Agent entry. No remote publication.

The R00-Q61 table and `current-*` report names below are the initial historical
snapshot. Later dated milestones and the release-candidate verification record
the current implementation and test counts.

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
| K43 | ScrollView, List | C13/C15 | COMPLETE | clipping, wheel, content/thumb pointer drag, cancellation, item selection, repeated nodes and cleanup |
| K44 | Panel, Dialog, Tabs | C13/C15 | COMPLETE | composition, modal isolation, active-page visibility |
| A50 | Full interactive canvas and node inspector | K40-K44 | COMPLETE | 35-node / 16-type gallery and multi-control interactions |
| M70/M71 | Separate motion contract, reusable clips and playback | A50 | COMPLETE | explicit offsets, conflicts, seek/stop/replay, restore |
| H60 | CLI/library, Skill and source packaging | U20 | COMPLETE | fresh source install/build/test and installed CLI/library round trip |
| Q60 | Engineering end-to-end regression and review | all implemented | COMPLETE | 116 unit tests, 21 production browser tests and reviewed Button |
| L30 | Optional vision adapter and protocol | provider-neutral boundary | COMPLETE | local server adapter, strict contracts, offline doubles and separately recorded live evaluations; provider configuration excluded from releases |
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
| M96: real vision service acceptance | PARTIAL | Two explicitly authorized local-adapter submissions; the second Button + Image result completed click/comparison/export/restoration; uninterrupted fresh upload on the final adapter not executed |
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

## Generated-image intent baseline (2026-09-08)

| Task | Status | Acceptance |
| --- | --- | --- |
| M101: twenty-image coverage and live semantic evaluation | COMPLETE | Twenty reviewed generated images cover sixteen types; twenty single-submission jobs reached terminal states; 7 valid envelopes, 6 compiled results, only 2 semantic passes |

This is a completed evaluation with an adverse result, not acceptance of vision
stability. Twelve outputs contained invalid JSON, one failed the component
contract, four compiled as whole-image fallbacks, and one provider task failed.
No production logic was changed. See [baseline findings](../reports/intent-20-baseline.md).

## Flat vision protocol optimization (2026-09-08)

| Task | Status | Acceptance |
| --- | --- | --- |
| M102: flat v0.2 intent and deterministic compilation | COMPLETE | Explicit nodes/styles/layout, strict parent and semantic consistency gates, legacy compatibility and instruction-bound cache |
| M103: bridge and browser regression | COMPLETE | Exact final-envelope whitelist; build, 249 unit tests, self-test, doctor and 58 browser tests passed |
| M104: same twenty-image live comparison | COMPLETE | Twenty new single-submission results: 19 valid source-bound envelopes, 14 compiled, 11 with all expected types; zero malformed JSON |

These milestones complete the optimization and evaluation, not sixteen-component
vision acceptance. The source-hash mismatch, five compilation failures and three
compiled type misses remain failures. No failed output was repaired or
resubmitted. See [comparison and limits](../reports/intent-flat-live.md).

## Refined intent follow-up (2026-09-08)

| Task | Status | Acceptance |
| --- | --- | --- |
| M105: explicit type/structure instruction | COMPLETE | Visual distinctions, global IDs, direct-child tab content, style and source binding rules; bounded prompt with offline regression |
| M106: actionable strict rejection diagnostics | COMPLETE | Bidirectional observed-type equality and stable decoder codes preserved through recognition; build, 252 unit tests and 59 browser tests passed with self-test/doctor |
| M107: frozen twenty-image follow-up | COMPLETE | Twenty single submissions: 19 valid envelopes, 18 compiled and 12 complete expected-type sets; one provider task failed |

This improves structural success but does not establish stable recognition. The
ProgressBar regression and six compiled type misses remain recorded failures.
See [follow-up comparison](../reports/intent-refined-live.md).

## Two-stage experiment (2026-09-09)

| Task | Status | Acceptance |
| --- | --- | --- |
| M108: observation and contract pipeline | COMPLETE | Strict source/identity/property binding; persistent single-submission stage guards; legacy adapter retained |
| M109: offline staged verification | COMPLETE | Build, 268 unit tests, self-test, doctor and 63 browser tests passed |
| M110: frozen twenty plus four live trial | COMPLETE — ADVERSE RESULT | 24 observation and 11 contract tasks; original-set end-to-end 2/20, independent set 0/4; no retries |

The staged adapter remains experimental and off by default. This did not improve
recognition acceptance over the refined single-stage 12/20 result. Observation
and rendering remain too coupled; explicit preview runtime policy is still
needed. See [staged findings](../reports/intent-staged-live.md).

## Pure semantic observation follow-up (2026-09-09)

| Task | Status | Acceptance |
| --- | --- | --- |
| M111: versioned pure observation and explicit preview policy | COMPLETE | v0.2 excludes render fields, supports bounded semantic parenting, and rejects missing/conflicting preview settings; v0.1 preserved |
| M112: instruction identity and downgrade protection | COMPLETE | New pipelines require observation v0.2; actual cached stage instructions are bound to current instruction digests; mocked tampering regressions passed |
| M113: final offline regression | COMPLETE | Final 278 unit tests and build passed; 64 browser tests, self-test and doctor passed |
| M114: frozen semantic v0.2 live retest | COMPLETE | 24 observations and 24 contracts completed without retries; original-set end-to-end 13/20, added-set 4/4; previous trial records unchanged |

See [revision evidence and limits](../reports/intent-semantic-v2.md). The default
remains the refined single-stage adapter: the original-set net gain is only one
sample, with Switch/Slider/ScrollView regressions. See [live retest](../reports/intent-semantic-v2-live.md).

## Deterministic semantic compilation (2026-09-09)

| Task | Status | Acceptance |
| --- | --- | --- |
| M115: observation-only adapter and deterministic compiler | COMPLETE | One observation task, no model contract; strict v0.4 envelope, measured layouts, explicit neutral preview policy, aggregate missing facts |
| M116: original-observation offline replay | COMPLETE | Zero provider calls; 18/24 compiled, 17/24 expected-type passes, six incomplete, zero compiler rejections; 18 validated bundles |
| M117: local correction and preview integration | COMPLETE | Type/scalar corrections recompile locally; missing and empty distinct; edits clear prior preview; neutral notice and export provenance |
| M118: final regression and local entry switch | COMPLETE | 291 unit tests, 66 browser tests, build, self-test and doctor passed; concurrent polling coalesced; local observation-only adapter restarted and health check configured=true |

The neutral structural preview is not artwork reconstruction. Tabs remain
Unresolved without a defined content mapping. Model accuracy has not changed;
the original CheckBox and form Dialog omissions remain. See
[compiler contract](studio-semantic-compiler.md) and
[offline replay](../reports/intent-deterministic-replay.md).

## Decomposition and appearance handoff (2026-09-09)

| Task | Status | Acceptance |
| --- | --- | --- |
| M119: offline public PNG ZIP import | COMPLETE | Stored ZIP and force-ZIP64 local headers; strict inventory, CRC/SHA/digest, scene/receipt and draft/QA checks; importer mutation and malformed-input regressions |
| M120: engine-neutral appearance binding | COMPLETE | All 16 role definitions; exact document/ZIP/scene/delivery fingerprints; explicit non-cropping registration; complete declared part mappings and top-left Switch thumb endpoint geometry |
| M121: local Studio handoff | COMPLETE | Original composite PNG preview; explicit target capture and exact target bundle export; binding JSON import/export/restoration; failed replacement clears stale output; zero vision requests in new browser cases |
| M122: final offline regression | COMPLETE | 305 unit tests, 68 browser tests, build, self-test and doctor PASS; independent Python stored force-ZIP64 writer interoperability PASS |
| M123: real decomposition artwork and textured control runtime | COMPLETE | Legacy r004 has textured Button/Switch/Select controls; r005 rebuilds Select through the current decomposition ZIP + 0.2 binding + automatic application path |

See [handoff contract](decomposition-appearance.md),
[evidence and limits](../reports/decomposition-appearance.md), and
[final verification](../reports/decomposition-appearance-verification.json).

## Legacy layered pilot runtime (2026-09-09)

| Task | Status | Acceptance |
| --- | --- | --- |
| M124: legacy r002 ZIP compatibility | COMPLETE | Bounded Node-only stored/deflate reader; 22 manifest files verified; legacy metadata retained without synthetic current receipts; explicit layer-to-Button conversion |
| M125: transparent images and textured Buttons | COMPLETE | Optional Button backgroundImage and Image drawBackground=false; resource ownership, label suppression, transparent pixel/browser regression and bundle restoration passed |
| M126: real settings pilot | COMPLETE | Three Buttons × four schemes = 12 target-specific activations; each scheme export/restoration passed with exact source resources; native-size screenshot max channel error 1, alpha error 0; no provider calls |
| M127: full regression | COMPLETE | 312 unit tests, 69 browser tests, build, self-test and doctor PASS |

See [legacy case contract and evidence](legacy-layered-case.md) and
[final regression](../reports/legacy-layered-verification.json). Business actions
are NOT_WIRED. Toggle/Select interactivity and state-part decomposition remain
NOT_RUN; source pixels include raster text and approximate legacy coordinates.

## Remaining external acceptance

Additional real-input acceptance (2026-09-08): the new 272×128 “购买” Button was
reviewed by the requested Luna xhigh subagent, compiled, rendered, clicked, tested
with 14 probes and restored after a full page reload from its portable bundle.
See [second Button acceptance](../reports/purchase-button-review.md). This extends
real Button evidence; it does not resolve the composite-artwork requirement.

Historical local-adapter evidence is recorded above; it does not select a public
provider or assert current service availability. A second engine/version remains BLOCKED.
Complete composite controls with clean state-specific layers, physical touch/pen and native IME panels,
additional browsers, narrow physical devices and user visual signoff are NOT_RUN.
Explicit CORS/timeout/WebGL-context-loss fault injection and long-duration memory
pressure are NOT_RUN; implemented handling is not a claim those injections passed.

## Layered raster Switch runtime (2026-09-09)

| Task | Status | Acceptance |
| --- | --- | --- |
| M128: transparent Toggle part assets | COMPLETE | Music and Sound each provide a registered RGBA track and thumb; technical Alpha/zero-RGB/canvas checks passed; generated occlusion fill is recorded rather than claimed as source-identical |
| M129: portable Switch appearance contract | COMPLETE | Optional track/thumb resources, source canvas and explicit off/on positions validate strictly; ordinary procedural Switch documents remain compatible |
| M130: PixiJS interaction and export | COMPLETE | Both real settings Toggle controls move on click, all four schemes retain appearance data, exported bundle validates, runtime provider calls remain zero |
| M131: regression | COMPLETE | 313 unit tests, focused raster Switch browser test and production build passed; the focused Playwright runner reported its test passed before its Windows web-server teardown was manually stopped |

The r003 case replaces the two legacy static Toggle layers with live Switch nodes.

## Layered raster Select runtime (2026-09-09)

| Task | Status | Acceptance |
| --- | --- | --- |
| M132: transparent Select part assets | COMPLETE | A 300×100 field, 30×21 arrow and 300×225 three-row popup are registered RGBA assets; the original visible label stays semantic text |
| M133: portable Select appearance contract | COMPLETE | Optional field/arrow/popup resources, source canvases and explicit label/arrow layouts validate strictly; existing procedural Select documents remain compatible |
| M134: PixiJS popup interaction and export | COMPLETE | Real r004 starts at 高清, opens three rows, selects 中等, and closes with updated semantic state; all four schemes preserve the three appearance resources and export valid bundles |
| M135: regression and real-case acceptance | COMPLETE | 314 unit tests, production build, all 71 browser tests and Edge real-case acceptance passed; no runtime provider calls or console errors |

The generated field and popup fill are visually reviewed local pilot assets, not
claims of exact recovery for pixels hidden by baked text. Automatic application
is covered below.

## Automatic appearance application (2026-09-09)

| Task | Status | Acceptance |
| --- | --- | --- |
| M136: application-ready binding contract | COMPLETE | 0.1 stays validation/export-only; 0.2 requires explicit Button/Switch label geometry, Switch endpoints, Select popup layer and below-start placement |
| M137: deterministic appearance compiler | COMPLETE | Reauthenticates target/ZIP/binding; applies Button, Switch and Select; full archive SHA namespace; preserves source resources and motion; rejects stale geometry and overwrite |
| M138: Studio direct application | COMPLETE | “应用绑定并预览” compiles and mounts locally; live Button/Switch/Select interactions, four schemes and export work without model calls |
| M139: current-format real pilot r005 | COMPLETE | Real Select layers packaged as a current decomposition draft ZIP, applied from target + 0.2 binding, changed 高清→中等, and exported under all four schemes |
| M140: regression | COMPLETE | 316 unit tests, 72 browser tests and production build passed; r005 Edge acceptance recorded zero provider calls and zero console errors |
| M141: first additional-control binding schemas | COMPLETE | CheckBox box/mark, per-option RadioGroup layers and hit areas, Input value/placeholder layouts, full-fill clips, and Slider endpoints are explicit in 0.2 |
| M142: five runtime texture adapters | COMPLETE | CheckBox, RadioGroup, Input, ProgressBar and Slider preserve semantic state, dynamic text, clipping, hit testing and drag projection |
| M143: deterministic first-batch application | COMPLETE | Five component types authenticate exact target/ZIP geometry, copy only bound bytes, reject overlap/stale state/existing appearance, and export portably |
| M144: first-batch regression | COMPLETE | 319 unit tests, all 73 browser tests and production build passed without a vision-provider request |
| M145: remaining appearance contracts | COMPLETE | Image, Text, Container, ScrollView, List, Panel, Dialog and Tabs have explicit 0.2 bindings with dynamic semantic content preserved |
| M146: full PixiJS runtime coverage | COMPLETE | All 16 component types support deterministic appearance application; repeated rows/tabs, scroll thumbs and modal overlays use explicit geometry |
| M147: second-batch regression (2026-09-10 snapshot) | COMPLETE | 323 unit tests, all 76 browser tests and production build passed without a vision-provider request |
| M148: visible interaction feedback | COMPLETE | All ten directly interactive types pass both state-change and canvas-pixel-change checks; unbound Button press and RadioGroup/List/Tabs redraw fallbacks are covered |
| M149: full 16-type E2E case | COMPLETE | One portable bundle contains all 16 types, exercises all ten interactive types, preserves three authenticated layered-source identities, exports a preview and passes with zero provider calls |

## 0.2.0 release candidate (2026-09-10)

| Task | Status | Acceptance |
| --- | --- | --- |
| M150: `0.2.0-rc.1` freeze | COMPLETE | 16 component contracts and deterministic appearance application frozen; ten interactive types have state and visible-pixel feedback; Playful/Premium/Corporate profiles cover all 16 types |
| M151: release boundary | COMPLETE | PixiJS/Web is the only accepted renderer; provider configuration, runtime state, user media and execution reports are excluded from release archives |
| M152: release verification and artifacts | COMPLETE | fresh build, 323 unit tests, self-test, doctor and 76/76 browser tests passed; deterministic source ZIP, npm package and verification evidence are bound by `release-manifest.json` |
