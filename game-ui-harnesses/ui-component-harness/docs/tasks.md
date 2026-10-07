# Implementation tasks

## 2026-09-19 Independent asset ZIP build

Added `assets-build` and `compileDecompositionAssets`: existing PNG ZIP + explicit
target bundle + existing appearance binding compile without an upstream run or
outer handoff. Import, geometry and coverage gates are shared with the current
consumer; no asset format changes or inferred states. Consumer build passed,
3 new tests and 11 existing component-handoff tests passed. The producer's real
PNG export also passed an isolated CLI bridge test with two Button nodes, exact
PNG byte preservation, rejection of incomplete bindings and no overwrite.
No provider, browser/Studio or human visual acceptance was performed.

Historical-artwork follow-up: Quest Journal material reuse produced 47 PNG layers;
the isolated ZIP built 41 nodes and 62 resource entries through `assets-build`.
ZIP bytes, component document, resources and motion matched the existing handoff
path. Fresh browser default and mouse-opened menu captures each differed by zero
pixels between the two paths. Evidence: `work/ui-decomposition/quest-journal-assets-isolation-20260919-r001/`.
Existing icon/label/backplate defects remain; no new generation or full
Studio/state matrix rerun. This proves this sample's transport/build equivalence,
not fresh reference planning/generation fidelity or human visual acceptance.

## 2026-09-18 CI repair

CI now prepares Chromium before Node browser-backed fixtures and builds the local
consumer for the offline Python integration matrix. The four Python matrix jobs,
dependency audit and release build passed in run 35343685393. Browser CLI paths
are resolved relative to the test module, and source-import contract probes use
the development server in CI and `npm run verify`. Motion profiles run as separate
cases with unchanged assertions and timeouts. Local baseline motion: 16 passed;
targeted follow-up and Linux CI results are recorded in
`work/ci-repair-20260918-r001/`. No provider calls or visual acceptance claims.

Follow-up: 30 targeted browser cases passed locally. Linux run 35350858313
passed 131/134 cases with full headless Chromium; remaining failures were two
combined-flow timeouts and a transient recoil screenshot. Lifecycle scenarios
now have separate contexts; bundle import closes the original page first.
Recoil pixel sampling uses the browser test clock with native wheel/drag input,
while other motion checks retain native RAF. All 23 affected local cases passed.

Run 35353800471 passed 137/138 browser cases. The remaining Button assertion
received real press input but native RAF delivery paused for 11.7 seconds until
the failure screenshot requested a compositor frame; the resulting pressScale
was the correct 0.97. Button checks now save the presented pressed frames before
inspecting feedback, without advancing a test clock or changing runtime state.
Focused remote run 35361306509 passed. Unhelpful headed/vsync experiments were
removed; full headless Chromium remains. Manual browser_filter diagnostics are
explicitly partial; an empty filter runs every CI job. Full verification follows.

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

## Self-contained decomposition handoff (2026-09-10)

| Task | Status | Acceptance |
| --- | --- | --- |
| M153: authenticated outer handoff archive | COMPLETE | One archive binds the unchanged decomposition ZIP, exact semantic component bundle and explicit 0.2 appearance binding; nested and outer SHA-256 values are verified before use |
| M154: direct component compiler entry | COMPLETE | `importAndApplyComponentHandoff` and `ai-ui-component component-handoff ... --output ...` validate and apply the package without provider calls or filename inference |
| M155: offline regression | COMPLETE | 326 unit tests and production build pass; success and stale component-bundle digest paths are covered, including the CLI output path |
| M156: invisible-root handoff guard | COMPLETE | Producer packaging and consumer library/CLI reject a semantic v0.2 root with opacity 0 before a blank runtime bundle can be delivered; 87 decomposition tests, 328 component tests and the production build pass; regression includes output non-creation |
| M157: invisible-interactive handoff guard | COMPLETE | Producer packaging and consumer library/CLI reject opacity-0 interactive nodes so a static screenshot cannot masquerade as an interactive handoff; 88 decomposition tests and 330 component tests pass; regression includes output non-creation |
| M158: complete interactive appearance coverage | COMPLETE | The one-file component handoff producer and consumer reject every interactive semantic node missing from `appearance-binding.json`; standalone appearance bindings may remain partial for authoring, while a complete handoff cannot silently substitute generic controls; 89 decomposition tests, 332 component tests and the production build pass |

## Input interaction semantics (2026-09-11)

| Task | Status | Acceptance |
| --- | --- | --- |
| M159: text-field pointer behavior | COMPLETE | PixiJS Input uses a text cursor and focuses its hidden native editor on pointer tap without Button press/release events or fallback press scaling; 334 unit tests, 6/6 runtime-edge browser tests, 9/9 component browser tests and the production build pass |

## Create Hero r002 handoff acceptance (2026-09-11)

| Task | Status | Acceptance |
| --- | --- | --- |
| M160: authenticated r002 case import | COMPLETE | Outer/nested checksums and safe paths pass; the official handoff compiler emits a valid 0.2 bundle with 10 nodes and 19 resources; all eight interactive nodes have complete appearance bindings and exact source/target canvas geometry; Studio browser evidence confirms Input, RadioGroup, CheckBox, Slider and Button state feedback. The static scene matches the original closely, while regenerated control regions retain documented visual deltas; upstream status remains `unreviewed_draft` pending visual acceptance. |
## Text background opt-out and geometry fixture (2026-09-11)

- Text supports optional `drawBackground: false`; absent fields retain legacy
  paint. 335 unit tests and the production build pass. The dedicated browser
  pixel regression confirms preserved underlying pixels, visible glyphs, and
  unchanged legacy paint.
- Local Quest Journal draft: 37 nodes, 21 appearance bindings, 31 decomposition
  layers. Official ZIP reverse import reproduces the prepared Bundle exactly.
  Browser acceptance exercises Tabs, CheckBox, Select, List, ScrollView and Button.
  The first independent Chromium run reproduced both supplied runtime screenshots
  byte for byte. Follow-up review found the supplied 90 px ScrollView thumb
  inconsistent with a 596/600 visible-content ratio; the runtime now expands
  undersized raster thumbs to their semantic track ratio while preserving larger
  authored thumbs. All six controls still pass and no page errors occur.
  This is a geometry-first widget fixture, not a completed game: only the six
  observed tasks are supplied, scrolling is bounded to their known content, and
  filters do not invent unavailable task datasets. Texture and font matching,
  missing decorative details, and final human visual acceptance remain outside
  this technical pass. No new generation was used.
## State-color handoff compatibility (2026-09-12)

- Corrected binding validation so Tabs.activeTextColor is optional, matching the
  interface and legacy behavior. Exact hex validation rejects trailing newlines.
- Select/Tabs color passthrough and omission tests pass; browser pixel checks
  verify light active/field labels with dark inactive/menu labels. Scroll browser
  test dispatches a DOM wheel event through Pixi, avoiding headless OS wheel-target
  timing on its tiny fixture; the full sample also passes mouse wheel input. Existing proportional
  runtime thumb sizing is retained.
- 337 component unit tests and production build pass. Quest Journal was exported
  to a fresh draft and reverse-imported using the official component-handoff CLI;
  its colors, semantic dimensions and widget interactions passed. Human visual
  acceptance remains false. No new media generation or old artifact edits.

## Quest Journal tab-icon handoff acceptance (2026-09-12)

- Package SHA-256 `41c577aa0c92292b09178f8e0c76c3cef4fc9c1068f6a6acd772f9add27ff445`
  passes authenticated `component-handoff` reverse import and bundle validation:
  37 nodes and 38 resources.
- Tabs supplies `icon` and `active-icon` bindings for `active`, `completed`, and
  `archive`, with explicit target-item-local geometry. Browser interaction confirms
  all three icons remain visible while ACTIVE, COMPLETED, and ARCHIVE become active.
  Visual review then rejected the state artwork: each tab's normal and active icon
  resources have identical SHA-256 values, while the reference requires dark
  inactive icons and light active icons. The consumer contract/runtime are ready;
  the decomposition handoff must export distinct state rasters.
- The package remains an `unreviewed_draft` with `human_visual_acceptance: false`.
  Structural and interaction checks pass, but state-color visual acceptance fails.

### r007 state-color correction

- Package SHA-256 `37bba2823d5db10cd08622a1c574afbde51862300170872f927e122c8844dac0`
  passes authenticated reverse import and bundle validation with 37 nodes and
  38 resources. Each normal/active icon pair now has distinct content digests.
- Browser interaction confirms the selected ACTIVE, COMPLETED, or ARCHIVE icon
  is light while both inactive icons are dark, with stable geometry and alpha.
  The package remains `unreviewed_draft` with `human_visual_acceptance: false`.
- Browser regression maintenance now counts all 21 second-batch appearance
  resources, derives ScrollView drag results from semantic viewport/content and
  track geometry, and passes the configured preview URL to workflow CLI tests.
  The production build, 337 unit tests, and all 81 browser tests pass against the
  external `http://127.0.0.1:4273` preview.

## Chain audit and import regressions (2026-09-12)

- Fixed missing required-resource enumeration for ScrollView, List, Dialog and
  Tabs, including optional overlays and both icon states. Removing each of 21
  applied fixture rasters now fails both bundle creation and validation.
- Handoff visibility checks now reject interactive nodes under a fully
  transparent ancestor. Library and CLI regressions preserve positive-opacity
  wrappers and verify that rejected imports do not create an output bundle.
- Fixed partial JSON publication in the optional staged adapter's exclusive
  gates. Complete temporary files are published without replacement; 16 concurrent
  mocked polls still create one contract task and leave no temporary files.
- Production build, 340 unit tests, CLI self-test and doctor pass. The original
  81-case browser run passed 80 cases; a rebuild during execution invalidated a
  hashed renderer module in the ScrollView case. That case passed after builds
  stopped. Two new Studio cases also pass: real mouse/keyboard input on a
  1536x1024 canvas with normal page chrome, and stale-preview clearing when an
  inactive tab icon is missing. These are 83 distinct passing cases across runs,
  not a single clean full-suite run. Local evidence is retained under
  `work/ui-component-harness/audits/chain-audit-20260912/`.
- No new media, live provider request or sample visual approval. Pending sample
  acceptance and `human_visual_acceptance: false` remain unchanged.
- A concurrent task changed Dialog header layering in `tree-runtime.ts` during
  the audit. That change was preserved and is not included among these fixes;
  the executed checks do not certify subsequent concurrent source edits.

## 2026-09-12 Dialog header child visibility regression

The isolated decomposition Dialog fixture reproduced a raster header covering a
Close child button while that invisible button still accepted pointer input.
Dialog header art now renders with the background/body before semantic children;
its title remains in the foreground. Panel/ScrollView layer order is unchanged.

Executed: production `npm run build`; two local deterministic fixture imports
through the official component-handoff CLI; real PixiJS candidate Dialog
acceptance for raster and native modal overlays, each with 15 state captures
(three Dialog states and four Buttons with default/hover/pressed). The fixtures
verify modal blocking/restoration, child activation/hidden suppression and
RGBA source-over pixels. The Close raster regression failed before the fix and
passed afterward. Fresh evidence resides in
`work/ui-decomposition/reward-dialog-fullchain-20260912-r001/` under the
`candidate-acceptance-*-r003` directories. These are synthetic local regression
fixtures using proposed decomposition dispatcher hooks, not generated sample
deliveries or integrated main-CLI acceptance. No provider requests occurred.

## Audit follow-through: local import and keyboard workflow (2026-09-12)

- Bundle validation and Pixi resource preparation now share the DOM-free
  `treeResourceReferences` enumerator. The existing per-raster omission regression
  remains in place; legacy v0.1 resource validation is unchanged.
- Studio directly opens a component-handoff ZIP through the same compiler and
  guards as the official CLI. It displays authenticated SHA-256 and upstream
  review state, distinguishes local unconfirmed visual review, and clears old
  previews/disclosures on failure. It does not import external acceptance files.
- Workbench defaults to fit-to-width within the center pane. Numeric zoom uses
  an isolated scroll area. A 1536x1024 fixture passes real mouse input at its right
  edge while the inspector remains available; Studio has separate layout tests.
- Added visible Pixi keyboard focus, Tab/Shift+Tab traversal, Button press/release,
  toggle keys, choice/Slider/ScrollView arrows and Home/End, Select Escape, and
  native Input editing. Runtime values, keyboard event sources, visible press
  pixels, hidden/disabled/modal isolation, held-press cancellation and mouse vs
  keyboard focus attribution have browser coverage.
- Actual text input exposed an existing trimmed-value bug: typing a space could
  make getDocument fail and clear the preview. Input now preserves exact string
  whitespace while retaining maxLength validation.
- Executed build/type checks and 341 unit tests pass. An isolated production
  build on port 4274 passed all 87 browser cases without skips or retries.
  The final pointer-focus attribution adjustment and its new regression then
  passed all five targeted keyboard/Studio/workbench cases on the current build
  (88 distinct cases now exist; no single 88-case run is claimed).
- Logs and screenshots: `work/ui-component-harness/audits/chain-audit-20260912/`,
  with `improvements-browser.log`, `final-targeted.log`, `next-unit.log`, and
  `improvements.md`. Parallel Dialog and Tabs work was preserved. No commit,
  provider call, media generation or human visual signoff was performed.

## 2026-09-12 native unequal Tabs continuation

- Added optional `states.tabs.items` and consumed `appearance.items`: explicit
  per-tab native cell rectangles, normal/active base pairs and local text/hit
  regions. Legacy equal-cell import and rendering remain compatible.
- Import validates unique complete tab IDs/base roles, non-overlapping in-bounds
  cells, exact source geometry and icon placement. Direct bundles and runtime
  decode validate each per-item resource/canvas. Gaps do not select a tab.
- `tests/native-tabs.test.ts`: four tests passed, covering import, negative
  contracts, resources and uniform 2x registration. The prior appearance apply
  and binding tests passed with the new tests. `npm run build` passed.
- Real PixiJS `native-tabs.spec.ts` imports through the official CLI and checks
  three unequal cells, each base/icon state, gap clicks and the former equal-cell
  boundary. It and existing `tabs-icons.spec.ts` printed `ok`, but the Windows
  Playwright webServer teardown stalled and required interruption; this is not a
  successful whole-run exit. Fresh stateful receipts are tracked by the primary
  decomposition task. Fixtures are local procedural pixels, not generated HUD
  artwork or human visual acceptance.

### Stateful main CLI integration follow-up — 2026-09-12

- Pointer-down now renders immediately after clearing the keyboard focus ring,
  preserving the current capture/pointerFocus logic. Without this, Button
  pressed screenshots could retain a stale ring despite a cleared focus record.
  Existing textured Button and Dialog fixtures reproduce the pixel failure.
- Current component build passed. The sibling decomposition main CLI full suite
  passed 163 tests with real browser cases, including native Tabs, Slider,
  ProgressBar, Dialog and native Image children under Button press transforms.
  See sibling `docs/stateful-parallel-integration-task-record.md` for exact logs.
  This is local fixture acceptance, not generated artwork or human approval.

### 2026-09-12 Inventory external scrollbar binding

The actual Inventory reference has a 463px content viewport and a separately placed scrollbar. The previous binding, application, and direct bundle validators incorrectly required the thumb and track inside the viewport. ScrollView now permits the explicit external track, keeps its registered layer inside the target canvas during application, and validates both thumb endpoints against the track. Nested coordinates and uniform registration are covered.

Executed: `node --test tests/scrollview-external-track.test.ts tests/appearance-binding.test.ts tests/appearance-apply.test.ts` — 17 passed; `npm run build` — passed. Inventory `assembly/fixture-r002` imports/validates/applies 65 nodes and 20 bindings using synthetic local fixture pixels. This is contract preparation only; it is not generated sample acceptance or human visual approval.

Inventory follow-up: external track was drawable but blocked by viewport-only Pixi hitArea. Runtime now uses viewport union explicit track with an inert gap; four local external-track tests and build pass. Actual newly generated Inventory `acceptance-r004` passed official reverse import and 26 browser states. Its fully covered viewport records occluded/null, not pixel success. Final `delivery-check-r001` remains failed_visual_qa with strict regional mismatches and missing font/alternate-state evidence; human_visual_acceptance remains false.

Merged verification after the parallel sample repairs: 349 component unit tests
passed without skips, and 180 decomposition tests passed with real browser
fixtures enabled. Logs: `work/ui-decomposition/parallel-keyed-component-tests-20260912-r001.log`
and `work/ui-decomposition/parallel-keyed-full-tests-20260912-r002.log` in the
repository root. Generated Reward Dialog separately passed 19 actual PixiJS
states using its official imported handoff; strict reference-region comparison
remains failed. Neither this test count nor actual screenshot checks establish
human visual acceptance. No changes were committed.

HUD corrected full chain: `battle-hud-fullchain-20260912-r001/acceptance-r008-01` passed official reverse import and48 actual PixiJS states, including rendered ON/OFF text/geometry for both Switches. Uses freshly authorized full-range squad-fill replacement and zero-compute310px Slider fill derivation. Final `delivery-check-r008` remains failed_visual_qa (15 strict reference regions plus font/alternate-state evidence gaps); human_visual_acceptance:false. RESULT-r008.md lists source/candidate hashes and remaining radar crop seam and source-value interpretation limits.

## Reference handoff v2 — 2026-09-12

Added compatible v2 archive import, authenticated original/derived reference files,
explicit mapping, typed observed/unknown state and acceptance scope. The CLI exposes
portable reference evidence via `--reference-output`; v1 remains importable but
explicitly reports missing reference evidence and false visual-comparison readiness.
Real PixiJS reference replay supports explicit Select popup open/close and discloses
unknown fields rather than assigning invented source values.

Executed: 372 component tests passed, 194 decomposition tests passed with browser
fixtures enabled, build passed, and the dedicated real-browser reference replay
test passed (including idempotent replay and distinct open/closed screenshots).
Logs: repository `work/ui-decomposition/reference-contract-component-tests-r002.log`,
`reference-contract-decomposition-tests-r002.log`, `reference-contract-build-r002.log`.
Quest Journal v2 was imported from an isolated ZIP, all 38 runtime resource hashes
verified, and a reference-state screenshot captured with Select open. Original
bytes and prior bundle/binding/decomposition bytes were preserved exactly.
Its scrollX/scrollY reference values remain unknown; full same-state visual
comparison is blocked and human visual acceptance remains false. No media service
was called and no changes were committed.
# Reference v2 persistent consumer and unattended acceptance — 2026-09-12

Implemented consumer bundle 0.3 with the authenticated original v2 ZIP attachment,
scheme save/reopen and deterministic full-handoff re-export. Current value changes
are retained; component/layout/options/canvas/resource edits invalidate evidence.
Original/derived/reference-state/scope bytes survive export unchanged. The producer
v2 delivery contract is unchanged; exported inner semantic bundles remain 0.1/0.2.

Added `reference-export` and `reference-accept`. The latter owns a bundled static
PixiJS renderer, ephemeral loopback server and browser, captures native pixels,
compares observed state and painter-order clipped primitive regions with a named
RGBA threshold policy, retains unknown/failed/empty-scope blockers, and always
reports `human_visual_acceptance: false`. Studio retains evidence on reopen,
supports mapped original/derivative inspection, reference replay, full-width
side-by-side captures, native-size inspection, PNG download and complete ZIP export.
Reference replay is not labelled real-input interaction acceptance.

Executed: full offline suite **383 passed**; final focused reference/CLI suite
**34 passed**; browser suite **5 passed**, with **2 passed** again after the final
full-width panel change. Real Studio mouse/keyboard checks assert values, events
and distinct visible captures. Mapping tests cover crop, both flips, quarter turns,
nonuniform scale and offset. Standalone command tests cover independent procedural
reference matching, isolated ZIP-only execution, old packages, unknown values,
empty scopes, pixel mismatch, decoder failures, cleanup and overwrite refusal.
Build passed. Windows Playwright shell-server teardown hung during two early runs;
only those test-owned servers were stopped. The dedicated regression config now
owns Vite in process and exits naturally; the formal acceptance CLI already owned
and cleaned its separate static server without that workaround.

Evidence root: `work/ui-component-harness/reference-v2-consumer-20260912-r001/`.
Logs: `unit-tests.log`, `reference-release-tests.log`, `build-ui-final.log`;
browser records: `browser-final/results.json`, `browser-layout-final/results.json`.
`isolated-known/capture/report.json`: technical passed, zero differing pixels.
`isolated-quest/capture/report.json`: blocked on `quest-scroll.scrollX` and
`quest-scroll.scrollY`, with a real 1536x1024 runtime screenshot. Original input
SHA-256 matches `ff17baf3366e681a40e9f6939f96b72513232cc6c10ba93f365fd62707dcb56a`.
Final transferable draft ZIPs and their hashes are in `delivery-index.json`.
No media/provider calls, commits, branch changes or rollback of other work.

Comparison is explicitly a conservative primitive-rectangle policy, not semantic
segmentation; invisible/no-owned-pixel compared scopes block. Animated references
need a future frame-selection contract; the current command rejects them. Capture
limits and local browser prerequisites are documented in `reference-consumer-v2.md`.

## Battle HUD reference v2 consumer acceptance — 2026-09-12

Tested the user-specified interaction-acceptance-r001 handoff (SHA-256
`f02320b24294e08a6399052e15eb0376e201eb54b11cbbd77a7e91c4b2d25050`).
Official import, 115 resources / 62 nodes, save/reopen, full ZIP re-export and
official re-import passed with byte-identical reference evidence. The 48 upstream
state screenshots and manifest/matrix/browser digest links match; 121 checked
parts passed, while 8 invisible and 5 occluded parts remain separately classified.

Independent Studio acceptance: **22 checks passed**, including 20 real input
checks with observed values/events/visible feedback, reference state restoration,
and save-close-reopen-export. No provider requests. Full same-state comparison
remains blocked by four unknown squad meter values; no numeric estimates were
promoted to observations. Slider value 99 with static Text `70%`, substituted fonts,
button label positioning and reference texture differences are reported upstream.
RESET/APPLY business behavior and unprovided tab page contents were not invented.

Fixed a consumer layout bug exposed by the large canvas: the canvas was resizing
the same auto-sized host used by fit(), producing ResizeObserver loop warnings.
Size containment on the main/comparison canvas hosts breaks that feedback without
changing logical coordinates. Added a large-canvas / four-scheme regression.
Build and **6 browser regression tests passed**; HUD rerun reports no window errors.

Evidence: `work/ui-component-harness/battle-hud-reference-v2-20260912-r001/`:
`acceptance-summary.md`, `acceptance/report.json`, `studio-r002/interaction-report.json`,
`studio-r002/studio-page.png`, `upstream-repair-request.md`,
`roundtrip-verification.json`, `regression-final/results.json`, and `build.log`.
All human visual acceptance flags remain false. Upstream input and other sample
work were not modified; no changes were committed.

## Switch state images v1 consumer support — 2026-09-12

Implemented the versioned `stateImages` extension in appearance binding validation,
application, UI tree validation, resource enumeration, PixiJS loading and semantic
state texture selection. Save/reopen and v2 complete ZIP export retain both state
pairs. Legacy single-pair behavior remains compatible; no sample names/colors are
hardcoded. Producer integration and Battle HUD replacement artwork remain pending.
Contract: [switch-state-images-v1.md](switch-state-images-v1.md).

Validation: 386 Node tests passed; existing reference/Studio browser suite plus
new real-input test passed (7 tests), followed by two focused final browser tests
covering mouse/keyboard values/events, exact track/thumb pixels, persistence and
invalid dimensions. Build passed. The local v2 procedural fixture completed the
formal reference-accept CLI with technical_passed and human_visual_acceptance=false.
Evidence: `work/ui-component-harness/switch-state-images-20260912-r001/`, including
`unit-tests.log`, `browser-final/results.json`, `browser-verified/results.json`,
`acceptance/report.json`, runtime.png and roundtrip.ui.component-handoff.draft.zip.
No producer files or historical sample archives changed; no commit made.


## 2026-09-12 Inventory visual layout policy

Implemented opt-in List rowGap/drawBackground, ScrollView drawBackground and
scrollbarVisibility:auto, including no-overflow import and zero-range arithmetic.
List import validates painted height separately from interval. ProgressBar import
accepts a contained inner fillClip while rejecting clips outside its texture.
Absent optional fields preserve legacy behavior. Runtime uses the existing
rectangular clip; curved/alpha cavity masks are not implemented.

Evidence: 390 consumer unit tests passed; build passed. Producer 201 tests passed
with local browser regressions enabled. Inventory new self-contained handoff passed
26 real PixiJS state checks. Its standalone ZIP passed official import, save/reopen,
reexport/reimport reference-byte preservation and screenshot capture. Reference
comparison remains blocked by unknown original scrollX/scrollY; human acceptance
remains false. No media generation or private services were called.

Artifacts are in work/ui-decomposition/inventory-shop-fullchain-20260912-r001/
acceptance-layout-policy-r001 and isolated-layout-policy-r001/acceptance.

## Inventory sample independent consumer audit — 2026-09-12

Tested acceptance-layout-policy-r001 ZIP (SHA256 4d17fa9406524b74e2934e2c1ed2c8cb2fde94188497ccf4e91e875d50d40647). No Switch components. Official reference-accept import/roundtrip/capture completed; full comparison blocked by unknown inventory-scroll.scrollX/scrollY. All 26 upstream screenshot hashes and handoff/browser/matrix hashes matched. Independent actual Studio mouse/keyboard audit passed 19 checks, including list image hit delegation, single-option popup bounds, no-overflow wheel behavior and button cancellation. Runtime window errors empty. No business/detail data inferred. Local preview :4284.

Evidence: work/ui-component-harness/inventory-shop-20260912-r001/acceptance-summary.md, acceptance/report.json, upstream-chain.json and studio-final/interaction-report.json. Human visual acceptance remains false. Existing source changes from the layout-policy task were preserved, no commit made.

## Battle HUD Switch replacement package — 2026-09-12

Imported acceptance-r002 SHA256 e2025048c6a5e64bd93793f1ba68379d4a29d25a98618a005740aa24793a0266. Independent Studio 26 checks passed, including both switches with mouse and keyboard, declared ON/OFF assets, labels/events and save-close-reopen-export. Actual screenshots confirm blue ON and gray OFF. No runtime errors. Formal full reference comparison stays blocked on four unknown squad values; human_visual_acceptance=false. New preview :4285; old :4283 remains historical. Evidence: work/ui-component-harness/battle-hud-switch-20260912-r001/acceptance-summary.md and studio-r001/interaction-report.json. No sample archive or consumer runtime code changed in this reimport task.

## Raster Tabs motion consumption — 2026-09-12

Fixed runtime raster Tabs ignoring tabProgress: declared inactive/active backgrounds,
icons and text now crossfade with existing style progress. Original/no-motion stays
instant. Interrupted transitions retain current per-tab weights before retargeting.
No new assets, colors, handoff fields or package changes. Existing hit rectangles,
selection values and content visibility remain unchanged.

Validation: build passed; 60 motion-system/native-tabs unit tests passed. Browser
regression uses real mouse clicks and keyboard End with a paused Playwright clock:
original frame is immediate; all three styles have different 50ms intermediate
frames and settle correctly; rapid retargeting ends at the requested tab. Evidence:
work/ui-component-harness/raster-tabs-motion-20260912-r001/results-verified.json
and browser-verified/ PNGs. Initial unpaused-clock retry retained separately.
Live Battle HUD :4285 uses source runtime; refresh to inspect. Human visual
acceptance remains false; no Git commit or upstream archive modification.

## Partial reference scope comparison — 2026-09-12

Replaced whole-package unknown-state short-circuit with conservative local
ProgressBar uncertainty masks. Unknown scroll/choice/popup still globally blocks;
state mismatches and stale evidence remain blocking. Known failures take precedence
over partial status. Policy/report version 1.1, CLI distinguishes visual_failed
from failed, partially_verified exits 3. Studio shows passed/failed/unverified counts.

Build passed; 3 browser tests and 6 CLI tests passed. Local browser cases cover
partial success, known pixel failure, unknown dependency and overlap blocking.
Real Battle HUD: visual_failed with partial coverage, 5 compare scopes passed,
49 failed the existing pixel threshold, 4 unknown meters unverified. This exposes
previously uncomputed visual differences, not import failure or human rejection.
Evidence: work/ui-component-harness/reference-partial-20260912-r001/battle-hud/report.json,
browser/, cli-tests.log and build.log. Human visual acceptance remains false.


### 2026-09-12 ScrollView reference-visible no-overflow repair

Existing scrollbarVisibility:always now passes appearance binding for no-overflow
content. No-op wheel input no longer emits scroll. Build and 390 unit tests passed;
2 browser regressions passed (Studio real input and existing proportional thumb).
Inventory sample was uploaded through Studio as a v2 ZIP: 8 checks retained zero
range and no scroll events. Track/thumb painted at 24x640 / 18x640. Original short
thumb and baked end ornaments remain an explicit unsupported appearance gap.
Evidence: work/ui-decomposition/inventory-shop-scrollbar-always-20260912-r001/
studio-r003/report.json and 中文报告.md. No human visual approval or provider calls.

## Inventory always-scrollbar package independent audit — 2026-09-12

New ZIP f0f5b28f22297ae35bf48ad2e851af0ed78ea277b22a2521fd544ff0b44fbfab imported and roundtripped. 20 independent Studio real-input checks passed, including no-overflow wheel/drag with zero coordinates and no scroll events. Scrollbar now visible; full-height proportional thumb and missing source end ornament fidelity remain unresolved. Unknown scroll reference still blocks dependent visual comparison. Human acceptance false. Evidence: work/ui-component-harness/inventory-scrollbar-20260912-r001/acceptance-summary.md and studio-r001/interaction-report.json. Preview :4286. No runtime code or upstream package modified.


### 2026-09-12 Reward Dialog reference comparison repair

Dialog runtime inspection now exposes open as value, fixing false reference-state
mismatch while retaining genuine closed/open mismatch. Occluded compare scopes
count as unverified and partial coverage. Four local reference browser regressions
passed; build and 390 unit tests passed. Real Reward v2: 19 interaction states and
Studio mouse/keyboard/modal probes passed. Isolated official comparison returns
visual_failed (9 failed, 7 unverified), not visual approval. Evidence resides in
work/ui-decomposition/reward-dialog-reference-v2-20260912-r001/.

## Scrollbar end insets v1 consumer support — 2026-09-12

Added optional versioned scrollbarInsets top/bottom to binding and runtime contracts,
strict shared validation, single-scale import and proportional thumb geometry within
the usable track. Drag mapping uses the same travel distance. Old packages retain
legacy behavior. No sample archive modified; producer integration still required.
Contract: docs/scrollbar-insets-v1.md.

Build passed; 7 focused unit tests passed (legacy, invalid insets, scaling, persistence,
small/zero overflow geometry). Real Studio browser regression passed for wheel and
thumb drag with 20px and zero overflow, verifying scroll values/events and renderer
paint bounds outside protected ends. Evidence: work/ui-component-harness/
scrollbar-insets-20260912-r001/browser and build.log. No media generation or commit.


### 2026-09-13 Reward visual composition repair

Dialog body is optional; positioned background need not fill the component canvas.
Explicit native backdrop color/opacity preserves old defaults and rejects raster
conflicts. Own Pixi text bounds/font metrics support reference-layout checks.
Consumer tests: 393 passed. Producer fixture additionally tests optional body,
inset background and black 60% modal source-over behavior with real input.
Actual Reward: 19 states and Studio mouse/keyboard passed. 26 text observations,
frame/scrim ownership, text overlap and action clearance passed. Strict pixel
comparison remains failed (9 failed / 27 unverified); no human approval.
Evidence: work/ui-decomposition/reward-dialog-visual-repair-20260912-r001/.

## Reward dialog independent acceptance — 2026-09-13

acceptance-r004 input 4fe9077754cb8e2052286264cdc4e52d0c68ef5380af0ba416323594492abb01 imported and roundtripped. Six independent Studio mouse/keyboard checks passed, including modal blocking of currency and button cancellation; no backend/close behavior inferred. Known reference state; visual_failed with 9 differing scopes and 27 scopes without independent owned pixels. Scope does not exempt font/ornament differences. Human acceptance false. Evidence: work/ui-component-harness/reward-dialog-20260913-r001/acceptance-summary.md. Preview :4287 uses isolated cache. No runtime code or package changes.

## Reference panel vertical layout — 2026-09-13

Simplified the reference panel to one delivery ZIP export action and a static
mapped reference below the existing live canvas, matching its displayed width.
Removed manual replay/compare, screenshot download and evidence-selector controls
from this panel. CLI automation and workbench APIs remain available. Fresh handoff
imports replay known reference fields automatically; saved bundles keep saved
values. Reference text does not claim automated/human visual approval.

Build and two browser regressions passed, including vertical position/equal-width
assertions, single panel action, real pointer/key feedback, save/reopen and full ZIP
export/reimport. Evidence: work/ui-component-harness/reference-layout-20260913-r001/
browser. Existing :4287 source preview updates on reload. No media generation or
upstream package modification.

## Inventory insets replacement independent audit — 2026-09-13

Input ff2c8ad7c7adf75c98f86cecfe196d63ff7db51f107329b675ba3f3116a90a41 passed official import/roundtrip/capture. Four targeted Studio checks passed: top36/bottom40, viewport629/content649, real wheel0–20 clamp, thumb drag back to0, keyboardEnd/Home, scroll events and protected paint bounds. Actual image confirms visible end ornaments. Full reference comparison still blocked by unknown original scroll coordinates. Human acceptance false. Evidence: work/ui-component-harness/inventory-insets-20260913-r001/acceptance-summary.md. Preview :4288; no runtime edits.

## Scroll boundary style feedback — 2026-09-13

Added local vertical wheel boundary recoil for bound ScrollView motion: playful
up to10px (85ms outward/220ms return), premium up to3px (110/180ms). Amplitude is
capped at half the real scroll range. Original/corporate, reduced-motion and zero
overflow do not recoil. Only clipped content presentation moves inward within
valid scroll limits; thumb geometry and semantic values are unchanged. Repeated
boundary wheel input emits no fake scroll event. Drag remains direct manipulation.

Build passed. Independent Studio browser regression passed across four schemes,
checking actual wheel input, intermediate screenshots, semantic values, event
counts, unchanged thumb paint regions and zero recoil after settling. Test evidence:
work/ui-component-harness/scroll-recoil-20260913-r001/browser-verified. Earlier
attempts retained: live preview auto-import/clock interference; final uses an
isolated local Vite server and real time. Human acceptance unchanged, no new media
or upstream package edits. Preview :4288 loads updated source on refresh.

## Drag release recoil and native wheel containment — 2026-09-13

ScrollView release now uses the existing style boundary feedback after actual
vertical drag displacement. Cancel restores origin without recoil; a new drag
cancels pending recoil. Semantic values and thumb geometry remain bounded.
Pixi uses a passive wheel capture listener: hit-tested consumed native events are
now canceled by a separate non-passive canvas listener, removed during teardown.
Handled events stop Pixi propagation; outside input retains native page scrolling.

Build passed. Real Studio browser regression passed across all four schemes:
wheel boundary values/events/pixels, native page scroll containment, real thumb
movement and mouse scroll event, release presentation and settled zero, plus
outside-page wheel scrolling. Evidence: work/ui-component-harness/scroll-drag-20260913-r001/browser-r002.
First test attempt used a content drag that did not change value; retained as
failed evidence; final explicitly tests the user's thumb-drag path. Human visual
acceptance remains false. Preview :4288 uses updated source on refresh.

## Runtime state export repair — 2026-09-13

Fixed selection-dependent List binding rejection by preserving the original
sampling bundle and appearance binding. Export emits handoff schema 2.1 with
runtime_bundle using existing UiBundle fields. Both bundles are authenticated;
only declared mutable state and validated motion may differ. Geometry, resources,
IDs and options remain protected. Studio reimport preserves saved state instead
of automatically replaying the reference over it. v1/2.0 remain supported.

Validation: build passed; 6 persistence, 33 handoff/reference, 6 new runtime-bundle
and 1 producer-schema/gate regression passed. Real inventory Studio mouse selected
mana, downloaded ZIP, reimported and retained mana. Official CLI import passed.
All original ZIP members except the versioned manifest are byte-identical.
Evidence: work/ui-component-harness/export-state-20260913-r001/r002;
byte-report.json and cli-import.ui-bundle.json in parent. First browser attempt
exported successfully but sampled remount too early; retained. Final waits ready.
Human visual acceptance remains false; original unknown scroll coordinates remain
unknown. No upstream package changes, no commits. Both sides document 2.1.

## Create Hero v2 independent acceptance and Input editing — 2026-09-13

Source SHA 485d5344e99868a1f36e6ccc85871e1126ac85778972c362348b7a63c9768218.
Isolated reference-accept completed import/roundtrip/capture; visual blocked by
unknown voice-pitch.value (10 unverified scopes). Studio-r004 passed 11 real-input
and persistence groups; separate real Tab/Home/End Slider check passed. Source
members except versioned manifest byte-identical; exported ZIP reimported by CLI.
NAME Aria/TITLE empty retained. No original image/state edits or human acceptance.

Input now draws native-editor-driven caret and selection, supports pointer placement,
keyboard offsets, readonly/disabled and deterministic reference phase. Fixed native
capacity replacement dropping first character with selection-aware length handling.
Reference-state1.1 reuses observed/unknown envelopes, with both validators/schema;
authoritative docs/input-editing-reference-v1.1.md. Old1.0 stays compatible.

Build, 35 consumer units, 3 producer units and multi-scenario real browser regression
passed. Evidence and retained failures: work/ui-component-harness/create-hero-20260913-r001/acceptance-summary.md.
Visual typography/edge differences and IME/grapheme/mobile/email/number limits remain
explicit. Preview4289, no commits or model/media calls.

## 2026-09-13 Panel single-frame acceptance

Panel header is optional with semantic title retained; legacy split surfaces remain supported. Build and 408 local tests pass. Evidence: work/ui-decomposition/panel-reference-20260913-r001. Studio real input and isolated CLI import pass; original-reference visual comparison fails. No human visual approval. See panel-composition-v1.md.

## CHARACTER Panel value-to-text binding — 2026-09-13

Implemented optional UiDocument.valueTextBindings version1.0. Explicit numeric source
Slider.value or ProgressBar.value/max -> Text with literals and bounded fraction/group
formatting. No scripts, inferred names, reverse writes or target events. Derived text
is presentation only; authored text/reference observations remain intact. Initial
load, drag preview/commit, keyboard and formal setValue share the renderer path.
Bindings persist in document/bundle and authenticated handoff; new bind-value-text
CLI verifies and writes a fresh package. Source/target types prevent cycles; duplicate
targets and invalid fields/formats fail. Bound node deletion is rejected before mutation.

Panel source a95caaabe5809ab385a4ce6fb4a2d8dfa0d76d1a46d789c64e9a93eb23baae74.
New package abdc247c528263a83873380674469f59bd81d873e7d97087380393a7aebbaae9.
Real Studio 70->89->88 with matching visible text; ProgressBar3500 displays3,500/5,000
with one source event. Save/reopen/export/Studio reimport/official CLI all passed;
reference/material bytes and unknown Input fields unchanged. Twelve other real input
checks passed. 419 offline tests, browser regression and final build passed.
Evidence: work/ui-component-harness/character-panel-20260913-r001/acceptance-summary.md.
Contract: docs/value-text-bindings-v1.md. Preview4291. Visual remains draft/unconfirmed;
no media/private services and no commits.


## Select per-option menu icons — 2026-09-13

Implemented optional optionIcons version 1.0 in Select state appearance and runtime
appearance. Authoritative integration doc: docs/select-option-icons-v1.md. Explicit
optionId -> authenticated layer/image plus icon and label row rectangles; every
option declared once, null is the only no-icon marker. Shared strict geometry /
version / ID validation, resource collection and contain rendering preserve bytes,
alpha and aspect. Popup rows own hits and complete popup surface blocks lower
controls, including its decorative gutters. No icons transfer into closed fields.

Build and 438 offline tests passed (19 new Select tests). Two actual Studio/browser
scenarios and five existing keyboard/reference-replay/handoff regressions passed.
Real mouse red->green and keyboard green->blue->green each emit exactly one change;
no duplicate boundary/same-choice change, no lower Button activation, no closed
icon residue. Actual screenshot pixels, alpha padding, ratios and row mapping checked.
Studio save/reopen/export/CLI reimport remains interactive. Final ZIP isolated alone;
original members byte-preserved, source unknown state retained. No human acceptance.

Evidence: work/ui-component-harness/select-option-icons-20260913-r001/acceptance-report.json
and 验收说明.md. Final fixture ZIP isolated-delivery/ui.component-handoff.draft.zip
SHA-256 a47a88817c6fb590461ca4bd54e36b7a889e4737dd64a7af9b94f30337429575.
Preview 4292. Procedural geometry only, no Quest Journal generation or business inference.
Historical test failures retained; branch tony, no commits or unrelated modifications.


## Quest Journal new keyed handoff independent acceptance — 2026-09-14

Input 90e06ac1ba23593c76ec06308d459731d40d16862437271037572e40994e7477
was copied alone to a fresh isolation directory and imported by current official CLI.
41 nodes and all reference/resources resolved. Actual Studio replayed known state
with Select open; 21 real pointer/keyboard value changes and 2 Button activations
passed with value/event/visible feedback evidence. Ten zero-range ScrollView inputs
(2 wheel, 2 drag, 6 keyboard) retained x/y=0 with no scroll event or page wheel leak.
Track600 with 33/34 insets yields actual 533px thumb, ornaments remain visible.

Studio save/reopen/export/reimport and subsequent true input passed; official CLI
reimport passed. Every original ZIP member except upgraded manifest byte-identical;
all appearance/value-text bindings, original1740bf09..., mappings and unknowns retained.
Output SHA-256 1e0ddce5448228fa0a34d137d69a14b1ac5b81862cdb4751e85499e87d09be2f.
Evidence: work/ui-component-harness/quest-journal-20260914-r001/acceptance-report.json
and 验收说明.md; preview4293. Build438 offline tests and4 procedural browser regressions
passed. Initial120s Studio timeout retained; second300s-budget run passed in121s.

No reproducible runtime bug found. Corrected obsolete reference-consumer-v2.md
export/UI prose to existing handoff2.1 and vertical reference layout; no schema or
source artwork changes. Reference visual result remains blocked:41 unverified scopes,
zero exclusions. Original short/proportional long thumb difference disclosed.
Four FONT_METRICS_MISSING retained; REGION_QA_STATE_MISMATCH stems solely from unknown
reference scroll versus runtime0, not a Select mismatch. Human visual acceptance false.
No added business data, model/media calls, commits or unrelated workspace changes.

## Quest Journal authorized bottom-space handoff acceptance — 2026-09-14

Input SHA-256 758f29d9add5e4765012ba5cdea62dbd15b424b69386058b54e87e21fcd2ce2e.
Independent comparison confirms only contentHeight594->616; viewport596 gives
20px real travel, 22px added bottom whitespace, unchanged six tasks and 33/34 insets.
Source images, reference states and materials byte-identical; mapping unchanged,
zero excluded scopes. Added whitespace is an authorized derived layout.

Official isolated ZIP import and actual Studio comprehensive test passed (121s).
Sixteen real scroll inputs: ten changes and six boundary no-ops, finite 0..20 values,
no duplicate boundary events or outer-page wheel movement. Middle drag position and
20px content displacement verified. Proportional thumb515.695 fits usable533px.
Other controls:21 real value changes and2 button activations; Select icons/keyboard,
CheckBoxes/Tabs/List and programmatic progress text checked. Studio save/reopen/export
and subsequent input plus official CLI reimport passed. All evidence/resource bytes,
appearance/value-text bindings and unknown reference fields preserved.

Evidence: work/ui-component-harness/quest-journal-bottom-space-20260914-r001/
acceptance-report.json and 验收说明.md. Output delivery/ui.component-handoff.draft.zip
SHA-256 f226a4bf36b1fbb1656dea824f6efdd845791ab6d85697dd6fb387f9efead2ff.
Preview4294. No runtime changes needed; no repeated full offline suite this round.
Official visual acceptance remains blocked by unknown source scrollX/Y; short-thumb
difference retained, human_visual_acceptance=false. Branch tony; no commits or media.

## ScrollView content drag / click arbitration audit — 2026-09-14

User-reported content drag reproduced in actual Quest Journal Studio: scrollY20
also selected friend instead of retaining grove. Pixi pointertap followed the drag;
prior acceptance covered thumb dragging but missed content-start dragging.
Added generic 6 CSS px content threshold and native release tap suppression,
including cancel/zero-range cases. Child presses yield after threshold; Slider
and nearest nested ScrollView retain drag ownership. Scrollbar foreground now
shields overlapping content hits; ornament/empty track does not pan. Thumb drag
keeps immediate fine movement. Wheel/programmatic assignment cancels stale drag.
No document/schema/source ZIP/reference changes. Runtime behavior documented.

Build and438 Node tests passed. Final source:10 relevant browser regressions,
1 scaled-canvas/1px-thumb test,2 actual Quest Journal scenarios passed (13 total).
Real drag now retains grove with zero extra List changes; fresh click selects once.
Complete Studio controls, sixteen scroll inputs, save/reopen/export/reimport passed.
Evidence: work/ui-component-harness/scroll-gesture-audit-20260914-r001/
acceptance-report.json and 审计说明.md;46 screenshot hashes. Historical reproducer,
test-coordinate error, one transient recoil screenshot failure and intermediate
compile error retained. Subsequent unchanged recoil assertions passed twice.
Physical touch/pen and non-pixel wheel deltaMode remain unverified; line/page unit
normalization remains a recorded cross-device gap. Human visual acceptance false;
unknown source scroll remains unknown. Preview4294; tony; no commits or media calls.

## ScrollView wheel deltaMode normalization — 2026-09-14

Closed the line/page unit gap recorded in the preceding gesture audit. Added a
pure scroll-wheel helper: pixels unchanged, lines40 logical units (shared keyboard
step), pages receiving viewport width/height. Signed/fractional values preserved;
invalid modes/nonfinite/overflow conversions ignored, valid deltas bounded before
addition. Existing hit containment, no-op event suppression and recoil maintained.
Runtime policy documented; no package/schema/artwork/reference state changes.

Build and442 offline tests passed (4 new unit cases).14 browser scenarios passed,
including prior gesture/insets/keyboard/four-style recoil regression. Three wheel
scenarios rerun successfully after adding screenshot-difference and actual text
position assertions. Pixel wheel used real browser mouse input; line/page modes
used explicit untrusted standard WheelEvent into actual Studio/Pixi dispatch.
Do not claim physical device testing for simulated modes. Zero-range/nested views
retain values and contain events; repeated boundary input emits no extra scroll.
Evidence: work/ui-component-harness/scroll-wheel-units-20260914-r001/
acceptance-report.json, 修补说明.md, browser-r001 and visual-r002. Preview4294;
human_visual_acceptance=false; tony; no commits, media or private service calls.

### 2026-09-14 — Vertical native Tabs layout policy

Implemented [tabs-layout-v1](tabs-layout-v1.md): exact optional layoutPolicy on
the existing native items, explicit vertical x=0 / ordered y geometry, unchanged
legacy horizontal packages, Up/Down/Home/End navigation and Left/Right no-op.
Existing per-tab bases, normal/active icons, hit areas and independent child page
layouts are preserved through compiler and bundle validation.

Executed: build passed; 445 offline tests passed; six Studio browser cases passed
(vertical standalone and Dialog, existing horizontal native Tabs and keyboard
regressions). Actual pointer/key input checked values, event counts, visible pages
and base/icon pixels. Save/reopen/export and official CLI reimport preserved the
layout and complete v2 reference evidence. Three-state producer Pixi acceptance
also passed. Evidence: work/ui-decomposition/tabs-layout-v1-20260914-r001/
acceptance-report.json and browser-r004. Earlier r001–r003 fixture failures are
retained separately; final r004 has zero failures. These are procedural fixtures,
not generated Settings artwork. human_visual_acceptance=false; tony; no commit.


### 2026-09-14 — 16-component capability audit and Slider portability

Audited all 16 component types and documented bounded producer/consumer profiles.
Fixed Slider fractional origins, scientific steps and off-lattice endpoint handling;
pointer/keyboard now share snapSlider and preserve valid saved values. See
[Slider lattice](slider-step-lattice.md). Build and 446 offline tests passed.
27 browser cases passed, including real Studio raster Slider input/events/pixels
and save/reopen, all-type gallery, modal/focus, scroll-child gestures, Select icons,
Switch states and vertical Tabs. Producer full suite with opt-in browsers: 275 pass,
zero skipped. Evidence: work/ui-decomposition/component-capability-audit-20260914-r001/
audit-report.json and browser-r003. Earlier Dialog failure was a source-test/static-
preview server mismatch, resolved on Vite source server; no Dialog product patch.
New producer capability-check and optional freeze --capabilities reject unsupported
requirements before requests are created. Legacy batches remain compatible. No
media calls, no commit, tony, human_visual_acceptance=false.

## Select explicit menu highlights v1.0 — 2026-09-14

Published unique docs/select-menu-highlights-v1.md; author field is
bindings[].states.select.menuHighlights. Shared strict binding/document validator,
registered inset/radius conversion, and Pixi state-only background painting.
Selected wins over hover without stacking; icons/text remain untinted. Keyboard
selection updates the open popup without losing its current hover. Absent extension
retains historical green/stacking behavior; invalid declarations fail explicitly.
Documentation included in package files; no producer implementation changes.

Build468 offline tests passed, including22 highlight cases;9 unique browser
scenarios passed (2 highlight/legacy,6 existing icons/keyboard/replay,1 Settings).
Real pointer/keyboard input, values/events, actual background/icon/text pixels,
close/reopen and Studio save/export/official CLI reimport verified. All source
reference/material members except authored appearance and manifest byte-preserved.
Settings blue #168ADD selected0.45/hover0.20 is a declared derived choice; final
insets1/8/1/8 respect the padded texture border, not a claim of recovered source art.
First un-inset draft and connection/test-position failures retained in fresh outputs.

Evidence: work/ui-component-harness/select-menu-highlights-20260914-r001/
acceptance-report.json and 验收说明.md (26 screenshot hashes). Final delivery-r002 ZIP
SHA-256 c84ffed922a8f42cc7d665b696c108fde1ecc56ccd33fb9bd725a2c7cb7879ba.
Studio roundtrip SHA-256 6d6384c3b13dce1130d47b3e1ba6798b627f9a90ce13f8ac79a58bcffff099a9.
Preview4299. Original7 unknown fields retained, visualComparisonReady=false,
human_visual_acceptance=false. No media/model/private service calls, no commits.

## Latest upstream Settings full-stateful-r003 independent acceptance — 2026-09-14

Input SHA-256 05e0033a0dd9a280b321d5cc0e6d654da4f784bc13c46c83202e91d4f42a4b7a.
Fresh isolated ZIP imported with official component-handoff CLI and actual Studio.
Two real Edge/PixiJS browser scenarios passed: Select three choices/icons/highlight
pixels, mouse/keyboard values and event counts; Switch/CheckBox bidirectional
mouse/Space, Input edit/clear, RadioGroup, vertical Tabs, Slider 65 -> 81 -> 80
with visible value-text synchronization, and Button activation. Studio save/reload,
full ZIP export, official CLI reimport, and actual Studio ZIP reimport passed.
All 16 appearance objects, 50 resources, valueTextBindings, 7 original non-manifest
members and original reference descriptors/mappings/unknowns retained unchanged.
No product patch needed. New build passed. Official reference-accept ended blocked
with 28 unverified scopes, 7 unchanged unknown fields; cleanup completed.
human_visual_acceptance=false. No new offline unit suite claimed for this audit.
Evidence: work/ui-component-harness/settings-full-stateful-r003-20260914-r001/
acceptance-report.json and 验收报告.md, 36 image hashes. Studio roundtrip ZIP SHA-256:
acd084b0256f6bd66d178e6068a6ff6eebb8c509cd28021174d5183b2f173284.
Local preview 4300 serves this exact isolated input. Branch tony; no commit.

## List selected-item text binding v1.1 — 2026-09-14

Extended existing UiDocument.valueTextBindings only. Unique authoring document is
value-text-bindings-v1.md (versions1.0/1.1), now included in package files. List
selectedId uses a complete explicit itemId/text map plus required emptyText.
Strict source/target types, map coverage, duplicates, unknown fields/versions,
invalid references, conflicting targets and literal bounds are validated.
Text remains presentation only; existing source event semantics are unchanged.
Old numeric1.0 and mixed numeric/List1.1 supported through the same render path.

Build passed;495 offline cases passed, including27 new List cases;38 targeted
List/legacy cases passed. Two real Edge/PixiJS browser scenarios passed: six mouse
choices, Tab/arrows/Home/End, public setValue including null and repeated null,
values/rendered text/event deltas, numeric regressions, Studio save/reload/export,
official CLI reimport and actual ZIP reimport with continued keyboard selection.
Initial test expected no replay change event; corrected baseline assertion and
retained browser-r001. Product API behavior was not changed to fit the test.
All6 non-manifest source members, reference descriptors,
original bytes and8 resources retained; binding and saved runtime document equal.
Evidence: work/ui-component-harness/list-text-bindings-20260914-r001/
acceptance-report.json and 验收报告.md;16 state screenshot hashes plus Studio page.
Fixture ZIP SHA-256 dce576473ce006ef09f214e7f04c88557cc606ef29af5ad5e3543863528bf656.
This is a procedural fixture, not a generated Skill Library delivery or visual
acceptance. No upstream files/artwork/reference unknowns edited, no private/model
calls, no commit, tony; human_visual_acceptance=false. Local preview4301.

## Skill Library r008-02 independent consumer acceptance — 2026-09-15

Latest ZIP isolated and official CLI imported. Input SHA-256:
0aec7a54d926218c6c9e77b892607726c98535e9b962541fdc432f0ff0fbeed1.
Two actual Studio browser scenarios passed: six icon-area mouse selections,
keyboard/API/null value-text projection and event counts, save/reload/full ZIP
export/CLI and Studio reimport with continued keyboard binding; CheckBox/Tabs/
Button events and zero-range scroll wheel/drag/keyboard without fake scroll or
List selection. Seven source non-manifest members and32 resources byte preserved.
No product patch or full offline suite rerun needed.23 actual browser screenshots.
Reference acceptance blocked:33 unverified scopes, scrollX/Y remain unknown;
human_visual_acceptance=false. Visible typography differences remain (Shadow
Step description wrapping and selected-name emphasis). No source art changed.
Evidence: work/ui-component-harness/skill-library-r008-02-20260914-r001/
acceptance-report.json and 验收报告.md. Preview4302. tony; no commit.

## Skill Library r009-01 independent acceptance — 2026-09-15

Input SHA-256 ce7c8fb4f99e78ca84ac02127dc3cb44d2f50df0217d36fc27e510a650a14543.
Official isolated import and two actual Studio browser scenarios passed. Explicit
contentHeight874 vs viewport850 provides24px bottom space; wheel/thumb/keyboard
reach bottom, Home restores0, with no outer-page wheel scrolling or List misselection.
Six choices/text/events and save/reload/export/official CLI/Studio reimport passed.
Reference bytes and binding preserved. No consumer patch. Reference comparison
blocked with33 unverified scopes; scrollX/Y unknown retained, human_visual_acceptance=false.
Typography fields for description-shadow and selected-name unchanged from r008.
Evidence: work/ui-component-harness/skill-library-r009-01-20260915-r001/
acceptance-report.json and 验收报告.md. Preview4303. No commit; tony.

## ScrollView vertical thumb slices v1.0 — 2026-09-15

Unique docs/scrollbar-thumb-slices-v1.md and author field
states.scrollView.scrollbarThumbSlices. Source-pixel integer top/bottom caps,
positive middle, explicit existing track insets required; legacy absence unchanged.
Shared strict binding/document validation, appearance persistence, vertical-only
Pixi slicing and paint-region inclusion implemented. No producer/sample artwork edits.
Build and504 offline tests passed (9 new);2 actual Studio browser tests passed,
covering six length/scale combinations, RGB pixels, wheel/drag/keyboard, zero-range
events, save/reopen/export and official CLI/Studio reimport. Source reference bytes
and unknowns retained. Earlier fixture/test failures preserved, final browser-r004
passed. Windows sandbox account1909 required authorized host execution.
Evidence: work/ui-component-harness/scrollbar-thumb-slices-20260915-r001/
acceptance-report.json, 验收报告.md and 拆分端口令.md. Fixture ZIP SHA-256:
bf7177a06911e3fc9e010e92fd24ee8ba1b75ed2d4e5591bf6deb1cedb9f488d.
No real sample slice coordinates inferred; tony, no commit, human_visual_acceptance=false.

## 2026-09-15 Tabs background ownership

Implemented optional semantic Tabs.props.drawBackground. False skips only the
Tabs rectangle; absent/true preserves legacy behavior. Boolean validation and
Bundle/application roundtrip are covered. Contract: tabs-background-v1.md.
Build and508 offline tests passed. Browser fixture verifies actual parent pixels
for false and old plate pixels for absent/true, plus mouse selection. Skill Library
r011:38 PixiJS checks passed;37 Studio checks completed before a15s reimport wait
timeout, then4 isolated reimport/document/resources/real-tab checks passed.
All receipts retained separately; no human visual acceptance, commit or release.

## Skill Library thumb-slices acceptance-01 — 2026-09-15

Independent isolated ZIP and official CLI import passed. Input SHA-256:
84f6689ee46facb214501e82ea6fd183493d5db9cae35dc901fdfcec8f437b8a.
Explicit thumb source12x60 uses fixed6px top/bottom,48px stretch middle; track
insets32/32 and24px scroll range unchanged. Compared with r009-01, only appearance
binding and handoff manifest changed; all other6 members byte identical.
Two actual Studio browser scenarios passed: six choices/text/events, null/API,
mouse/keyboard, check/tabs/buttons,24px wheel/drag/keyboard without outer scrolling
or list misselection, save/reopen/export/official CLI and Studio reimport.
New slice declaration and all resources/reference evidence retained. No new patch.
Reference comparison blocked,33 scopes unverified, original scroll unknowns remain;
human_visual_acceptance=false. Typography differences unchanged.
Evidence: work/ui-component-harness/skill-library-slices-20260915-r001/
acceptance-report.json and 验收报告.md. Preview4304. tony, no commit.

## Bilingual Expedition assembly-r003 independent audit — 2026-09-15

Input SHA-256 9565f9e765897d6fb91eba93698548f103bf533f4c88f86aae2a606510e0911b.
Isolated official import and actual Studio real inputs/save/reopen/export/CLI and
ZIP reimport passed. Two Inputs edit/clear/64-char cap, mixed text insertion,
Select mouse/keyboard, CheckBox and Button events checked. Physical IME not tested.
Visual issues found: form-panel lacks authored appearance; reference badge/border
missing under procedural panel; authored18px Input/Select/Button text visibly small.
Source evidence and upstream repair instructions saved, no silent material fallback
accepted as visual restoration. Scope includes affected components. Official visual
comparison blocked with21 unverified scopes and10 unchanged Input editing unknowns.
Evidence: work/ui-component-harness/bilingual-expedition-20260915-r001/
acceptance-report.json, 验收报告.md, 拆分端修补建议.md. Initial test assertion failures
retained; final settings-r004 passed. No source patch, tony, no commit,
human_visual_acceptance=false. Preview4305.

## Bilingual Expedition r007 independent audit — 2026-09-15
Isolated CLI import and one actual Studio input/save/reopen/export/CLI/Studio reimport test passed. All non-manifest package members byte-preserved. Crest/frame restored; remaining Text background patches, small labels and left-aligned buttons recorded. Reference comparison blocked by original Input editing unknowns; human_visual_acceptance=false. No consumer source patch. Evidence: work/ui-component-harness/bilingual-expedition-r007-20260915-r001/acceptance-report.json and 验收报告.md. Preview4306; tony; no commit.

## Bilingual Expedition r008 independent audit — 2026-09-15
Isolated CLI import and actual Studio real-input/save/reopen/export/CLI/Studio reimport passed (1 E2E test). All non-manifest members byte-preserved. Text background patches removed, typography enlarged and buttons centered. Reference comparison remains blocked by original Input editing unknowns; human_visual_acceptance=false. No source patch. Evidence: work/ui-component-harness/bilingual-expedition-r008-20260915-r001/acceptance-report.json and 验收报告.md. Preview4307; tony; no commit.

## Producer layout-gate inspection support — 2026-09-15

Added optional readonly popupItems.textBounds (actual Pixi text, world bounds,
font family/size). No appearance/ZIP contract or runtime drawing change. Build
passed; 2 Select option-icon browser tests passed in 8.6s with an ephemeral local
static server, mouse/keyboard and existing roundtrip assertions. The initial
Playwright-managed server run completed both test bodies but stalled in teardown;
it was interrupted, not recorded as a clean run. A subsequent external-server
attempt without a live server failed and is retained. Final evidence is
work/ui-decomposition/layout-gates-verification-20260915-r001/consumer-browser-r003
and consumer-browser-r003.log. Separate producer benchmark-r003 uses actual CLI,
stateful and Studio: technical checks pass; two unknown reference fields keep
blocked_reference and human_visual_acceptance=false. This does not reaccept the
Bilingual Expedition sample or establish a 20-minute generation SLA. No media,
provider calls or commit; existing unrelated task changes retained.

## Button per-line labels and Bilingual Expedition r009 — 2026-09-15

Implemented the optional version 1.0 contract in docs/button-label-lines-v1.md:
states.button.labelLines, target-component-local geometry, exact label join,
per-line size/weight/alignment and strict validation. Import/application/runtime
and saved appearance retain the same field; old single-label Buttons remain
compatible. Actual Pixi text overflow fails instead of silently shrinking.

Build passed; all 511 offline tests passed. One dedicated browser scenario passed
with mouse/keyboard activation, enabled/disabled and default/hover/pressed labels.
The new Bilingual Expedition draft passed 26 stateful result rows / 187 checks,
Studio save/reopen/export/official CLI/Studio reimport, plus a separate actual
Studio menu/Button input probe. The generic Studio helper also passed a normal
procedural Select run including roundtrip (2 checks). Evidence:
work/ui-decomposition/bilingual-expedition-layout-r009-20260915-r001/.

Draft revision-r006 SHA-256:
8f308f9822b6eb612c0e760a68fb1a50ef82409c7aeb0b74475ab4491bb8d44d.
The original reference and observations remain unchanged. Ten unknown Input
editing fields keep reference comparison blocked; human_visual_acceptance=false.
No media/service calls, no commit. This technical acceptance is not visual signoff.

## Bilingual Expedition r010 deterministic layout revision — 2026-09-15

No consumer source changes in this round. Producer draft SHA-256
e8dd5bac9ea9186e9741d0be0a4cedc58a6c73342f517e31a04e997b76ecdeaa
passed official import,26 stateful rows/187 actual Pixi checks and6 Studio checks
covering real Select opening, both Buttons via mouse/keyboard and full
save/reopen/export/official CLI/Studio reimport. Evidence:
work/ui-decomposition/bilingual-expedition-layout-r010-20260915-r001/acceptance-r001/.
Reference evidence bytes survived roundtrip. Original10 Input editing unknowns
keep reference comparison blocked; human_visual_acceptance=false, no commit.

## Bilingual Expedition layout r010 independent audit — 2026-09-15
Isolated official import and actual Studio real-input/save/reopen/export/CLI/Studio reimport passed (1 E2E, 2.3m). Non-manifest package members byte-preserved, including reference evidence and labelLines. Button bilingual sizing and revised layout visible; no obvious new overlap observed. Reference comparison blocked by original Input editing unknowns; human_visual_acceptance=false. No source patch or commit; preserved shared changes on tony. Evidence: work/ui-component-harness/bilingual-expedition-r010-20260915-r001/acceptance-report.json and 验收报告.md. Preview4308.

## Black Hole independent acceptance — 2026-09-16
Input 0a3309b78e60e34532c8674b397b052dfd122b239d65fd299b193e708188190e verified. Isolated CLI and actual Studio mouse/keyboard Button events, save/reopen/export/CLI/Studio reimport passed (1 E2E, 1.4m). Non-manifest members byte-preserved. Actual text geometry and screenshots recorded. Pixel comparison visual_failed:21 failed,1 unverified; no scope edits; human_visual_acceptance=false. Explicit labelLines centers offset -3px in both axes from whole button bounds, reported for upstream review; no consumer patch. Evidence work/ui-component-harness/black-hole-20260916-r001/验收报告.md and acceptance-report.json. Preview4309; tony; no commit.

## Studio static backgrounds — 2026-09-16
Added studio-static-images policy to scheme creation, imported systems, timeline playback and saved/exported motion. Standalone Image and transform ancestors excluded; control-owned icons retain feedback. No component-ID special cases or reference edits. Two offline tests passed, build passed; actual Studio four-style switching/exported config and mouse activation browser test passed (34.3s). Evidence: work/ui-component-harness/static-background-20260916-r001/settings-r001. Initial unit assertions exposed control-owned image distinction and were corrected with explicit policy. tony, no commit, human_visual_acceptance=false.


### Scope correction: background only
User clarified only whole-page background stays static. Narrowed policy to first Image at global(0,0) matching canvas dimensions plus its transform ancestors. Other Image/Panel bindings retained; control-owned artwork unchanged. No matching ID or sample-specific branch. Two unit tests and build passed. Browser settings-r002 passed across all four schemes, asserts iconSurvival/mainPanel motion retained and background/root excluded, mouse activation and exported config checked. Prior broad policy superseded. Evidence work/ui-component-harness/static-background-20260916-r001/settings-r002. No commit.


## Component linkages 1.0 — 2026-09-16
Implemented explicit integer quantity, bounded total multiplication, shared dataset search/category/sort List projection, empty selection purchase gating; reuses valueTextBindings1.1. Engine-neutral validation/projection/transition; visible List hit/keyboard filtering; independent linkageState runtime quantity preserved by Bundle/ZIP/CLI. Source props/resources/reference evidence not replaced. Full offline530 passed; final targeted27 passed; build passed; final Studio real-input/save/reopen/export/CLI/Studio reimport test passed. Evidence work/ui-component-harness/component-linkages-20260916-r001/acceptance-report.json, final settings-r010; earlier failures retained. Sole contract docs/component-linkages-v1.md. No upstream modification, generation or services; tony, no commit, human_visual_acceptance=false. Prior static-background edits preserved.


## Composite List item contents1.0 — 2026-09-16
Added explicit List.props.itemContents ownership of direct Image/Text by stable itemId, row-local layouts, native row clipping/movement/visibility and suppression of default labels. Linked composite List missing ownership now rejects; unlinked legacy unchanged. Source appearance geometry accounts for declared row ownership without changing runtime initial sorting. Six-item/30-child fixture verifies mouse icon hits, real keyboard, filtering/classification/sorting/empty/restoration/stable ties, quantity/total/name/events and actual image pixels/child coordinates. Studio save/reopen/export/CLI/Studio import passed; original nonmanifest bytes retained. Full542 tests; final targeted38; build; final browser1 passed. Evidence work/ui-component-harness/list-item-contents-20260916-r001/acceptance-report.json; final settings-r003. Sole contract docs/component-linkages-v1.md with complete JSON in docs/examples/list-item-contents-v1.document.json. tony, no commit, no generation, human_visual_acceptance=false.


- 2026-09-16: Expedition Supplies visual-repair-r003 independent acceptance: official isolated import, real Studio composite row filtering/sorting/quantity input and save/reopen/ZIP/CLI/Studio roundtrip passed (1 browser test, 2.8m). Reference blocked: 5 unknown Input fields, 43 unverified scopes. No consumer code change. Evidence: work/ui-component-harness/expedition-supplies-r003-independent-20260916-r001/验收报告.md; human_visual_acceptance=false.

- 2026-09-17: List backgroundPolicy 1.0 own/parent implemented and documented in docs/list-background-v1.md. Legacy preserved; parent forbids independent background and uses registration. Offline552 passed + final12 targeted; build passed; actual Studio4 passed48.8s including pixels, composite linkage real input and save/ZIP/official CLI roundtrip. Evidence work/ui-component-harness/list-background-20260917-r001/验收报告.md. human_visual_acceptance=false.

- 2026-09-17: Skyport isolated-r005 independent consumer acceptance: isolated official import and actual Studio input/save/reopen/ZIP/CLI reimport passed (1 test, 2.9m). List parent background observed without duplicate panel; all original payload entries retained byte-for-byte. Reference blocked with 5 Input unknowns and45 unverified scopes; human_visual_acceptance=false. Evidence: work/ui-component-harness/skyport-r005-independent-20260917-r001/验收报告.md. No consumer code changes.

- 2026-09-17: Skyport selected-row repair consumer acceptance: 1493 real-input linkage checks, 37 state/interaction records, 11 Studio input/save/reopen/export/CLI/Studio checks and isolated official CLI import passed. Reference remains blocked by five original Input unknowns; original/state bytes and mapping unchanged. No consumer code changes. Evidence: work/ui-decomposition/skyport-supplies-live-20260916-r001/visual-repair-20260917-r001/list-selected-repair-20260917-r003/integration-r001/验收报告.md. Draft SHA-256 c615b20f45a9283c2792f2b07511b7e79d74425497e4c6e4acd7b01204c13855; human_visual_acceptance=false.

- 2026-09-17: Skyport selected-row r003 independent consumer audit: isolated SHA-256 c615b20f45a9283c2792f2b07511b7e79d74425497e4c6e4acd7b01204c13855 and official import passed. Build and 2 actual Edge/Studio tests passed (full real-input/save/reopen/export/CLI/Studio roundtrip; quantity upper bound 9 and all four sorts). Original non-manifest members byte-preserved. Selected-row appearance follows selection; empty results reveal parent without residual rows. Reference blocked with 5 unknowns / 45 unverified scopes; typography/coin differences remain, human_visual_acceptance=false. No consumer code patch or commit. Evidence: work/ui-component-harness/skyport-selected-r003-independent-20260917-r001/验收报告.md. Preview4317.

### 2026-09-20 Expedition PNG ZIP consumer compatibility probe

- Re-ran `test_assets_component_bridge`: 1 passed; synthetic offline fixture only.
- Actual isolated Expedition full-recovery ZIP SHA-256 `c01f1952b55177bc3bcfe4c5ca0e33e7121c887ffdff099d1177dc296db6f991`: consumer authenticated all 27 layers; official `assets-build` and `validate` passed for an explicitly authored two-Button compatibility target (layer-26, layer-27). Bound PNG bytes were identical. Missing binding and overwrite rejected.
- Evidence: `work/ui-decomposition/expedition-full-recovery-20260920-r001/consumer-check-r001/` (check.mjs, target.json, built.json). The binding.json is intentionally mutated to a missing-binding negative case by the test; it is not a production binding.
- No generation, browser/Studio interaction, full Expedition semantic build or reference comparison performed. Runtime acceptance remains not_run. This establishes ZIP/build compatibility only.

### 2026-09-20 Expedition full consumer readiness check

Full historical semantic target + current isolated PNG ZIP partial-binding probe rejected by official assets-build with COMPONENT_LAYER_GEOMETRY_MISMATCH (search). Inventory additionally lacks complementary tab states, Select popup, separate quantity controls and CheckBox box/mark needed by old bindings. No full build or Studio acceptance claimed; no generation or bypass. Evidence: work/ui-decomposition/expedition-full-recovery-20260920-r001/consumer-full-check-r001/report.md and build-result.json. Earlier two-Button probe remains scoped compatibility evidence.

- 2026-09-20: Expedition PNG c01f1952…db6f991 consumer adaptation remains BLOCKED on three alternate Tabs skins (217x74 each). New geometry, authenticated historical popup/checkbox reuse, official zero-generation quantity/row composition-crop pipeline and all-except-Tabs component build completed. Build and actual Edge scoped input/bundle reopen/CLI validation passed; final four-item selection checks avoid price/check overlap. Full semantic candidate retained but official assets-build rejects missing Tabs coverage; full business linkage and complete handoff ZIP roundtrip NOT_RUN. No runtime source changes, no generation, no commit; human_visual_acceptance=false. Evidence: work/ui-component-harness/expedition-png-adaptation-20260920-r001/适配报告.md.

- 2026-09-20: Expedition full PNG + three Tabs supplements integrated with unchanged full semantic target (quantity1–99, retain on selection, three sorts). Original native-alpha quantity/row regions now flow through generic authenticated material_regions derivation (3 offline regressions, zero generation), replacing rejected opaque preview crops. Full official assets-build/component-handoff and isolated CLI import passed. Added generic legacy handoff persistence and saved runtime1.1 using existing runtime_bundle restrictions; original semantic/binding/decomposition bytes preserved, missing reference remains explicit. Consumer559 tests and build passed; final Edge/Studio2 tests passed357.7s including real input, bounds/prices/filter/category/sort/row ownership/events, save/reopen/ZIP/CLI/Studio reimport. Official visual comparison BLOCKED MISSING_REFERENCE_EVIDENCE; human_visual_acceptance=false. Runtime-only draft SHA dcbc85e6bead0d66637dc04d4c7313423ebacf729e94d0fa0ea48d9e2d166a0d. Evidence work/ui-component-harness/expedition-full-adaptation-20260920-r004/验收报告.md; failure traces retained (one previous JSON summary overwritten by reporter-path collision, disclosed in report). tony; other task edits preserved; no commit/push.
### 2026-09-20 Single ZIP assets v2 consumer

- Agreed on producer-owned assets-package-v2 doc SHA256 `443e3cca1f1d0397c8db7dcd88eb209019000025ebbad4e887664f5bfaa812ef` and schema `82146c987207fe53c8675adcde5258b4dd93f6bb01b458e24ad5591370cdfbe7`; no competing schema.
- Implemented explicit legacy/v2 dispatch, full inventory/digest/size/mapping/layer-fact checks and decoded alpha visible bounds. Supplemental intake is allowed; standalone appearance binding/build rejects until deterministic base merge.
- Implemented offline assets-intake/assets-plan and source-bound reviewed-observation compilation, explicit user requirements/semantic/binding gaps. Three-input assets-build remains compatible. V2 Studio/CLI builds preserve exact material archive through bundle0.3 and existing runtime1.1 export; old Studio partial binding behavior retained.
- Final build and 586 offline tests passed. One Edge/Studio test passed: default before input, real mouse/key events, save/reopen, ZIP export, official CLI import/export and Studio reimport. Source ZIP bytes retained, model calls zero. Failures preserved: initial test syntax error; first two keyboard-focus assumptions; stale existing CLI expectation of bundle0.1 corrected to0.3 with archive digest/byte assertions.
- Producer minimal, legacy, supplemental and merged fixtures authenticated. Final isolated Expedition r002 SHA256 `4a2df5796b3c7c5dbd607f058bdee553840907f835d67d81dad133ae509d2dc6` authenticated with30 layers and original/mapping. Only the new ZIP was used for observations/candidate binding plan; no historical target/binding. Missing user business and component/state decisions remain needs_input. Reference acceptance BLOCKED/MISSING_REFERENCE_EVIDENCE; Expedition whole-page interaction/model cold-start NOT_RUN; human_visual_acceptance=false.
- Evidence and actual segmented timings: `work/ui-component-harness/single-zip-consumer-20260920-r001/交付报告.md`. Continued tony, preserved existing changes, no commit/push/generation/private service.

### 2026-09-20 New-ZIP-only local demo follow-up

Shared Tabs content visibility now aggregates active references to each unique child; public contract clarified, independent actual-browser regression passed. Targeted25 tests passed; initial TypeScript narrowing failure preserved, corrected final build-r002 passed. New-source static default and authorized neutral business real-input/JSON-save/reopen/CLI tests passed separately. Authenticated deterministic38-layer candidate validates7 bound controls; strict full-artwork build remains blocked on Select popup and separate CheckBox box/mark. Partial artwork preview open/screenshot passed, not full interaction acceptance. No historical target/binding/assets, generation, commit or human visual approval. No full-suite rerun in this follow-up. Evidence and actual timings: work/ui-component-harness/expedition-cold-demo-20260920-r001/验收报告.md.

### 2026-09-20 Expedition new-source41-layer full artwork acceptance

Official producer41-layer draft SHA b9c8d6ea078340960ac9c87748424e5a2a30365bb0c75f313741ff7f70fdedf6 authenticated and strict full-artwork compiler/export passed. Default checked before interaction. Actual approved business assertions, JSON save/reopen, Studio ZIP, CLI import/export and exact source ZIP preservation completed; composite test timed out at final Studio import (180s total limit, failure retained). Scoped resume on that exact CLI ZIP passed final Studio import, quantity/check state persistence and popup3 options; no expensive prior segments rerun. Technical chain complete through combined evidence, not a single all-green run. Human visual acceptance false; no exact font/pixel match claimed. No consumer generation, historical asset reuse, runtime changes or commit. Evidence/timings: work/ui-component-harness/expedition-full-skin-20260920-r001/验收报告.md.

- Follow-up visual audit found authored target omitted five coin sprites and retained neutral dark purchase text. candidate-r002 restores source coins with per-item ownership, separates price/check geometry, restores observed pale purchase label. Strict compile20.132s and scoped browser1 test106.750s passed (default, selection, sorting, save/reopen, ZIP source identity, CLI/Studio import, ownership/color persistence). Existing r001 failures and evidence preserved; no runtime change, no new generation. Latest artifacts and screenshots in the same full-skin report; human_visual_acceptance remains false.

### 2026-09-21 Independent UI layer package and Pixi viewer

Added an isolated local viewer for producer ui_layer_composition_v1 and ui_layers_package_v1; no component/state/business contract required. Producer experiment verifies frozen inputs, copies registered PNGs, composites from the same placement contract, and emits a closed SHA-256 inventory. Independent build entry: scripts/build-layer-viewer.mjs. Contract and usage: repository-relative experiments/ui-planning-m1/LAYER-PACKAGE.md.

93 Python experiment tests, 30 targeted TypeScript tests, TypeScript check and standalone build passed. Actual local Edge browser tested ZIP import, layer visibility/solo, original/composite/overlay, zoom, mobile, exact PNG and ZIP download roundtrip, invalid ZIP clearing stale state and valid reopen. No page errors or external requests. Initial r001 archive ordering failure retained; ASCII ordering fixed, final r003 browser passed. Final package contains 9 layers, 1536x1024, 11997917 bytes; SHA-256 51a5d4b0dd4b9bccea98b396772dcabcdba3f46406251feffeb4081b19162cc6.

Evidence: work/ui-planning-experiment/layer-viewer-browser-20260921-r003/result.json and screenshots; package: work/ui-planning-experiment/create-hero-layer-package-20260921-r003/. This turn made zero generation/model calls. Reused sample includes prior human-assisted planning/registration; not proof of unattended reference-to-delivery. Business text removed, known redraw differences remain, humanVisualAcceptance=false. Original production decomposition chain unchanged; no commit/push.

### 2026-09-21 Reward revised layer-package viewer acceptance

Producer experiment added conservative whole-surface routing for one card/button enclosing all same-material localized details. Original failed DAG retained; separate revised offline processing made zero model/generation calls. 107 experiment tests passed, 16.167s. Six-layer draft ZIP SHA-256 e18021929579b1acc393e1887346025493e5dce7a1a0ad4f71bf08197f0fef7b, 7684054 bytes, preserves known panel duplication and nonuniform progress fitting warnings. humanVisualAcceptance=false; not first-pass unattended success.

Actual local Edge viewer tested six-layer import, visibility/solo, original/overlay/composite, PNG/ZIP exact download roundtrip, zoom, mobile, corrupt ZIP clearing and valid reopen. No page errors/external requests. Evidence: work/ui-planning-experiment/reward-viewer-browser-20260921-r001/result.json and screenshots. Package: work/ui-planning-experiment/reward-layers-revised-20260921-r001/. Viewer/runtime consumer unchanged. No commit/push.

### 2026-10-02 Direct UI layer-package component consumer

- Added offline `layer-intake` and `layer-build` for `ui_layers_package_v1`, separate from decomposition/assets ZIPs. Build requires a complete explicit v0.2 component document, exact image-pointer bindings and an accounted unused-layer list. Button events carry component IDs; game actions are wired later and are not a build input. No type, text, font size, placement or state is inferred from a layer name. All 16 existing node contracts remain available through the same v0.2 validator and PixiJS runtime.
- Added source-bound bundle 0.4 with exact ZIP bytes and canonical plan digest. Reload/export revalidates ZIP inventory, bytes, plan, component structure and resources; existing runtime value state remains editable. Studio and workbench export retain the attachment.
- At initial intake, the supplied six-layer 1672×941 ZIP passed with SHA-256 `ceb3ab68667969bc3b76e6fd040247a5dbb973bad1875b885c6ac1b96bb0e184`. The ZIP itself still has no business text geometry/font properties or visual acceptance. Upstream warnings include panel resampling, close crop ratio and skipped planning visual review. The later source-bound component candidate is recorded below.
- Synthetic offline fixture: CLI intake/build/validate and negative stale/tampered mapping and cross-handoff tests passed; build and full offline suite 593/593 passed before removing the unnecessary game-action-ID requirement. One actual Edge/Studio browser test passed: render, real Button activation, export/reopen, exact source identity, zero model requests. Human visual acceptance remains false; no media generation, commit or deployment.

### 2026-10-02 Supplied six-layer ZIP component candidate

- Removed the premature requirement for game action IDs after user clarification. Button component IDs and `activate` events suffice for UI rendering and input acceptance; game behavior is wired later. The public plan contract, intake report, skill documentation and synthetic fixture were updated. Final build, 593/593 offline tests and one isolated Edge synthetic browser test passed after this correction.
- Read-only ZIP intake authenticated SHA-256 `ceb3ab68667969bc3b76e6fd040247a5dbb973bad1875b885c6ac1b96bb0e184`, 1672×941 and six PNG layers. Reference text observed as PAUSED, RESUME, RESTART, QUIT with a raster X. Bright reference glyph bounds were measured in manually reviewed regions and retained in local work evidence.
- Authored a source-bound candidate v0.2 tree with one background Image, one Panel, four Buttons and all six layer bindings. Explicit provisional Segoe UI Black sizes 77/46/44/43 px and enabled preview state are recorded in the plan; neither is asserted as source metadata or human visual acceptance. `layer-build` and official `inspect` passed; bundle 0.4 contains exact source ZIP and plan digest.
- Actual local Edge/Studio accepted all four pointer activations once, exported a bundle whose embedded ZIP hashes to the original digest, and reopened it ready with the same plan digest. No page errors or external network requests. Upstream panel-resampling and close-crop warnings remain, system-font portability is unresolved, game actions were not run, and visual acceptance is false. Evidence: `work/ui-component-harness/layer-package-real-20261002-r001/` including the candidate plan, bundle, reference measurement, final screenshot and browser result. No media generation, commit or deployment.

- 2026-10-02 follow-up: User explicitly accepted the current candidate's local visual appearance. This does not change the original layer ZIP's upstream review flag or validate game actions, animation, or font fallback on other devices. Production static preview at `http://127.0.0.1:4173/` imported `component-bundle.segoe-r003.json` through Studio's saved-plan file input. Real browser rechecked all four Button activations, saved and reopened Bundle 0.4, exact embedded source SHA-256 and plan digest, with zero page errors/external requests. Evidence: `work/ui-component-harness/layer-package-real-20261002-r001/production-preview-browser-result.json` and revised `验收报告.md`.

- 2026-10-02 direct Studio layer ZIP intake: Added separate `ui_layers_package_v1` ZIP and explicit component-plan JSON inputs plus local **生成 Bundle 并预览** action. The browser uses the same deterministic intake/compiler as CLI; no semantic inference or provider call. Build and two targeted synthetic browser tests passed, including source-bound export/reopen and stale-plan rejection clearing the prior preview. Actual supplied six-layer ZIP plus reviewed plan was imported through the new page controls; Bundle 0.4 rendered, exported and reopened with exact source SHA-256 `ceb3ab68667969bc3b76e6fd040247a5dbb973bad1875b885c6ac1b96bb0e184` and plan SHA-256 `dc0ed0b2f0e22425430e4fb7b698baae9707d9f53f96b671454ad746b0092a5a`; zero page errors/external requests. Evidence: `work/ui-component-harness/layer-package-real-20261002-r001/direct-layer-zip-browser-result.json` and screenshot. No media generation, commit or deployment.

- 2026-10-02 automatic layer-plan DAG: Added provider-neutral `intake → observation → plan → compile` orchestration with one configured reference-image observation, zero automatic retries, exact ZIP/reference/observation hashes, conservative Panel/Button-to-layer matching and disclosed provisional typography. Studio now offers **识图生成方案草稿并预览** and validated plan JSON download. Automatic source-bound Bundle remains `vision-proposed` / `draft_pending_visual_review`; unmatched layers are static with explicit issues, unresolved observations block and clear the old preview. Build, 6 targeted offline unit tests and 3 targeted browser tests passed using model doubles. Actual six-layer ZIP plus an offline observation derived from the previously reviewed candidate produced 6/6 bindings, Image/Panel/4 Buttons and Bundle 0.4 with exact source ZIP SHA. The real ZIP was also imported via the new browser auto control with a local response double: one request, plan/Bundle downloads, no page errors or external requests. No live provider call was made for this change, so real model observation quality remains unverified. Evidence: `work/ui-component-harness/layer-package-real-20261002-r001/auto-dag-offline-result.json`, `auto-dag-browser-result.json` and screenshot. No media generation, commit or deployment.

- 2026-10-02 Codex session takeover (supersedes the preceding automatic vision route): Replaced the layer DAG with `intake → session-plan → validate → compile`. Studio's **Codex 生成组件方案并预览** sends the exact ZIP to same-origin `/api/ui-layer-plan`; the server reauthenticates it and a local optional CLI adapter attaches reference/composite/all layer images plus public contracts for all 16 node types. No MCP vision/get_task stage, observation matching, proportional font rules, tool calls, automatic retry or review promotion. Codex proposes the complete tree, states, text, typography and bindings; deterministic programs own source binding, validation, canonical proposal evidence, Bundle 0.4 and local execution receipts. Each node and critical semantic/state/text field must have portable observed/inferred/policy evidence. Nonempty business text must be observed; missing evidence, stale inputs, private path notes, tool events and unresolved output block. Original reviewed and legacy vision-proposed bundles remain valid. Build passed; full offline suite passed 603/603, followed by final 14/14 targeted tests after additional portable-note checks; four browser tests passed with response/process doubles, including zero vision requests, source-bound export/reopen, failed replacement cleanup and missing-login ZIP preservation. Local `codex login status` returned `Not logged in`. Actual supplied ZIP (SHA-256 `ceb3ab68667969bc3b76e6fd040247a5dbb973bad1875b885c6ac1b96bb0e184`, six layers, 1672×941) reached native loopback preflight and returned `SESSION_NOT_AUTHENTICATED`, with zero new session directories or model dispatch. Evidence: ignored `.tmp/codex-session-unit-r001.log`, `.tmp/codex-session-build-r001.log` and `work/ui-component-harness/layer-package-real-20261002-r001/codex-native-preflight-result.json`. Local preview restarted on port 4173 with the new bridge. Real Codex planning quality and human acceptance of its future output remain NOT_RUN pending CLI login. No media generation, commit or deployment.

- 2026-10-02 native Codex planning after user login: The signed-in local CLI completed one persistent planning turn for the supplied six-layer ZIP. The adapter initially rejected four bounded WebSocket reconnection notices and one HTTPS fallback despite a completed tool-free turn. Added strict allowance for these specific transport notices; duplicate/unbounded notices, unknown errors, additional sessions and failed/tool turns remain blocked. Added deterministic collection that authenticates the saved prompt/schema/images/digests and exact final-message/output correspondence, without a process launch. Original blocked receipts and raw response remain unchanged. Collected the same native response into a fresh directory: 6/6 bindings, Container/Image/Panel/four Buttons, 55 decision findings, three review issues, Bundle 0.4; canonical proposal SHA-256 `c938fa573608be4adaf668dd4717d692c802d28e0c5681839760298a50299a17`, plan SHA-256 `85fc64ba6332174f4f0b6469997a4a1f7de531ed31fb8c6e297d592de902f2ec`. Initial browser import, four activations and save/reopen passed technically with zero provider requests, but visual inspection found the PAUSED heading replaced by an ellipsis and left-aligned button text. **Native draft visual acceptance failed; no automatic replacement planning invocation.** Added actual-font render inspection and a model-plan gate in Studio/workbench: implicit label/title truncation tears down the preview and disables exports. Planning instructions now specify left-edge label placement, minimum line height and explicit Button alignment, with per-line decision evidence. Build passed, final targeted offline suite 16/16 and browser suite 5/5 passed using doubles; a separate offline replay of this saved native proposal and Bundle both returned `LAYER_PLAN_TEXT_OVERFLOW: pause-panel.label`, ready=false, exports disabled, zero model dispatches and no page errors. Evidence: `work/ui-component-harness/layer-package-real-20261002-r001/codex-live-r001/`, `codex-live-r001-collected/`, `codex-live-r001-render-check/browser-result.json`, and ignored `.tmp/codex-session-build-r002.log`, `.tmp/codex-session-unit-r003.log`, `.tmp/codex-session-browser-r002.log`. Preview restarted on loopback port 4173; GET bridge status configured=true, busy=false. Earlier human approval still applies only to segoe-r003. No media generation, commit or deployment.

- 2026-10-02 user-approved automatic corrections: User explicitly permitted at most three corrections. Updated this Harness's agent contract for the layer ZIP route and implemented one initial turn plus up to three corrections in the same verified Codex session. Each completed response is independently validated/compiled and checked by isolated local Pixi rendering; repairable contract/resource/evidence errors and text overflow feed back into an explicit session resume, with original reference and failed render image when available. Unknown errors, unresolved semantics, source mismatch, failed/incomplete transport, cancellation and renderer infrastructure errors remain terminal. Fixed maximum is three, no fifth turn, no latest-session selection, no automatic transport resubmission. Root/per-turn immutable receipts authenticate every response, feedback and render image/report; deterministic collection supports the complete correction chain with zero model calls. API v2 returns only final proposal and portable execution counts; Studio reports actual corrections and keeps human approval pending. Browser render checks block external/API requests and tear down on abort/timeout. Build passed (`.tmp/codex-corrections-build-r002.log`); targeted offline suite 19/19 passed including budget exhaustion, same-session enforcement, one contract/resource correction, cancellation and no resubmission of terminal errors (`.tmp/codex-corrections-unit-r005.log`). Browser suite 6/6 passed (`.tmp/codex-corrections-browser-r001.log`): one HTTP request, four process-double turns, three real local render failures then a passing full label, preview and actual activation; all four render checks made zero forbidden requests. Native CLI resume argument parsing was checked read-only using `--help`. Current bridge GET reports version 2.0, configured=true, busy=false, maxCorrections=3. No new live model invocation was made for this implementation; original native draft and its failed visual acceptance remain unchanged. Live native correction quality is NOT_RUN. No media generation, commit or deployment.

### 2026-10-02 Immediate layer ZIP preview

Studio now shows authenticated preview.png in the existing Pixi canvas as 交付包预览 after successful ZIP intake. It stays visible during manual plan selection and automatic planning; a passing component build replaces it. Export, motion presets, comparison and appearance targeting stay unavailable until component checks pass. Invalid replacements, generation errors and reset tear down the preview.

Build passed (.tmp/layer-import-preview-build-r001.log). Browser run covered seven cases: six passed initially; the missing-login test submitted a disabled plan input before image mounting completed. A wait for the user-visible enabled input fixed that test, and its isolated rerun passed (.tmp/layer-import-preview-browser-r001.log and r002.log). New regression checks distinctive preview compositor pixels, zero API requests on intake, mobile fit, disabled export, invalid ZIP clearing and reset. Existing manual/automatic tests verify retention, replacement by one component canvas, source-bound export and correction/error gates.

The supplied six-layer ZIP loaded a static 1672x941 preview, with export disabled, zero page errors and no API requests. An extra screenshot diagnostic did not meet its ad hoc 98% sample threshold: 97.26% matched within three RGB levels at native size. Earlier enlarged capture clipping was corrected in the checking script. Failed diagnostic receipts remain in ignored .tmp/layer-import-real-preview-result-r002.json through r005.json; exact pixel equivalence and human visual acceptance are not claimed. No live model call, service restart, commit or deployment.

### 2026-10-02 Frozen layer ZIP consumer adaptations

Consumer planning now receives an explicit immutable-source policy. Source-bound
plan 1.0 supports declared Image.region crops, corrected parent child paint order
and real procedural controls for missing raster parts. Native plans require an
adaptations array; legacy plans may omit it. Deterministic validation checks crop
bounds, node/source identity, declarations and explicit-policy evidence at
/props/region, /children and /props/style. Bundle 0.4 preserves original source
ZIP/resource bytes and the canonical adaptation plan across export/reopen. The
runtime uses existing contracts; no images are generated or replaced.

Final build passed (.tmp/layer-adaptation-build-r004.log). Earlier targeted 23/23
tests passed (r003); final scoped 19/19 passed (r004), including unfinished Draft
completion in the same verified session and genuine Unresolved remaining
terminal. Nine actual-browser tests passed with planning/process doubles
(.tmp/layer-adaptation-browser-r001.log). After the final order-evidence and error
wording changes, the two affected tests passed again (r002): retained source
crops, card-before-fish visibility, progress at 0/12-of-16/full, source identity
through Bundle export/reopen, portable failure reasons and disabled exports.
Full suite was not rerun. Tests made no provider requests.

Separate user-requested native verification authenticated the latest frozen
38-layer 1024x1536 ZIP, SHA-256
0faf3d60cf0853980f2f1ceb7b742a8752ebd363645f16e24f4dfcc63fa64f92.
It completed one tool-free Codex turn and returned terminal
LAYER_PLANNING_UNRESOLVED: the model reported unfinished bindings, controls and
decision findings rather than a missing semantic fact. No plan, compile or render
check was produced; corrections=0, modelTurns=1, transportRetries=0, visual
acceptance=false. The earlier failed attempt and this new terminal receipt were
preserved without modification. Evidence:
work/ui-component-harness/layer-adaptation-native-20261002-r001/response.json and
审计与验证报告.md; private session evidence stays in ignored local storage.

The prompt was subsequently tightened: known-semantics unfinished construction
must use Draft and fail ordinary contract checks, allowing completion within the
already approved three-correction limit. Concrete missing required semantics
remain Unresolved. Studio displays the exact portable reasons as 组件方案未完成,
retains the checked ZIP and disables component output; it does not presume that
upstream must edit the package. The post-tightening native behavior has not been
rerun. This is tested consumer capability, not a successful automatic delivery
for the 38-layer source. No media generation, commit or deployment.

### 2026-10-02 Structured planning outcome and shared correction budget

Native response 1.1 now requires reason/missingInputs. Deterministic programs
recognize construction-incomplete as a repairable completeness error even when
status is Unresolved. Required semantic gaps must supply concrete portable
subject/kind/detail entries. Complete drafts, incomplete work and genuine missing
inputs have distinct checked payloads; no free-text reason guessing. Construction
completion shares the same maximum three corrections with contract/render errors.
Exhaustion preserves the portable last construction diagnostic and checked ZIP;
partial output remains unavailable. Version 1.0 records remain readable and their
unclassified Unresolved stays terminal. Run receipts bind response version and
exact schema; old correction prompts are reconstructed unchanged.

Build passed (.tmp/layer-outcome-build-r001.log); final targeted 26/26 tests passed
(.tmp/layer-outcome-unit-r002.log). Browser group passed 9/9 (r001): one request
and four same-session process-double turns combine incomplete construction, two
actual font-render failures and a passing complete draft using exactly three
corrections. One added exhaustion/diagnostic/source-retention browser test passed
separately (r002). Tests made zero provider calls. Deterministic collection of the
earlier successful native version 1.0 response also passed with modelDispatches=0
(.tmp/layer-outcome-legacy-collection-r001.json). Full suite was not rerun.

An independently requested native preflight for the real 38-layer ZIP returned
SESSION_NOT_AUTHENTICATED before any session/model dispatch. Read-only diagnosis
confirmed login status succeeds with normal host permissions but is invisible to
the restricted shell token. Local-only preview was restarted with permission to
read the existing login; no logout or new login flow was used. Original blocked
preflight evidence remains under
work/ui-component-harness/layer-adaptation-native-20261002-r002/.
Native response-1.1 verification then started in a fresh directory using the same
exact source ZIP and fixed correction limit. Its terminal result will be recorded
below; current implementation/test evidence alone does not claim native success.

- Native terminal outcome: response 1.1 correctly identified construction-incomplete
  despite status=Unresolved, recorded a repairable check and explicitly resumed
  the same verified session. The verification script's generic Node fetch then
  hit its independent five-minute headers timeout, disconnected and cancelled
  the in-progress first correction. Producer receipt is SESSION_ABORTED_NO_RETRY,
  modelTurns=2, corrections=1 (dispatched; that correction did not complete),
  transportRetries=0, one completed check, no plan/Bundle/render output. Original
  records remain unchanged under
  work/ui-component-harness/layer-adaptation-native-20261002-r003/ and ignored
  session storage. This confirms native classification/continuation, not complete
  native delivery.
- Added the explicit Node loopback client with a whole-run deadline instead of
  fetch's unrelated headers timeout. It sends exactly one request and bounds the
  source/response, cancellation and timeout; no automatic transport retries.
  Final combined targeted suite passed 28/28 (.tmp/layer-outcome-unit-r003.log),
  followed by 2/2 client checks after the response grace-period adjustment
  (.tmp/layer-outcome-client-r001.log). Tests use only fixture HTTP servers.
- The cancelled/unfinished model turn requires a new user decision before a
  fresh native dispatch, as required by this Harness's AGENTS.md. The repaired
  runner is prepared; it has not been launched without that decision. No new
  media generation, commit or deployment.

### 2026-10-03 Confirmed native rerun and prompt transport failure detection

User explicitly confirmed one new native run of the unchanged 38-layer ZIP,
SHA-256 0faf3d60cf0853980f2f1ceb7b742a8752ebd363645f16e24f4dfcc63fa64f92.
Existing host CLI login passed read-only preflight. The fresh Node HTTP client
kept the request alive from 01:43:08 to 02:01:28 Asia/Shanghai, avoiding the prior
five-minute fetch cancellation. Initial response completed at 01:46:28 with
version 1.1, status Unresolved, reason construction-incomplete and empty missing
inputs; no plan or findings. Deterministic validation marked it repairable and
resumed the same verified session for correction 1.

Correction 1 emitted bounded connection timeouts, HTTPS fallback and then
response-body decoding/stream-disconnection notices. No completed response or
draft was received within 15 minutes. The untouched execution receipt is terminal
SESSION_TIMEOUT_NO_RETRY: modelTurns=2 and corrections=1 count dispatches, only
the initial turn completed, transportRetries=0 counts Harness resubmissions.
CLI internal notices are recorded separately. No compile/render or human review
ran and no Bundle was produced. This proves structured classification and client
waiting behavior, not complete native planning/delivery. Evidence:
work/ui-component-harness/layer-adaptation-native-20261003-r001/response.json and
执行与诊断报告.md; private per-turn records remain ignored and unchanged.

Follow-up added live stdout-event checks to stop forbidden/duplicate transport
notices and unknown/tool events promptly, preserving split UTF-8 and raw evidence.
Final session/completed-response checks remain authoritative; allowed bounded
notices plus one HTTPS fallback are still accepted only with a completed turn.
No new native request followed the incomplete transport attempt. The saved actual
event stream replayed against a process double terminates at event 8 as
SESSION_TRANSPORT_FAILED_NO_RETRY, one process stop and zero model dispatches
(transport-replay.json); the original timeout receipt remains unchanged.

Final build passed (.tmp/layer-transport-build-20261003-r001.log); 29/29 targeted
offline tests passed (unit-r001), including immediate event termination, UTF-8,
single-process behavior, three-correction limit and terminal failure handling.
Two affected actual-browser tests passed (browser-r001), showing concrete timeout
or transport messages and clearing a previously valid preview/export after one
failed request. Tests used fixtures/doubles with zero provider calls. Full suite
and a native run of the new live event guard were not performed. Local-only
preview is refreshed; no commit, deployment, media generation or human acceptance.

### 2026-10-03 User-requested subagent planning simulation

User reported native Codex CLI quota exhausted and explicitly requested a subagent
simulation. One subagent inspected the authenticated reference, preview and all
38 source images, then authored a complete response 1.1. This simulation used
read-only tools; it does not verify native tool-free planner isolation. Native CLI
dispatches were zero and all previous native failure receipts remain unchanged.

The existing runLayerAutoDag validation/compiler and checkLayerPlanRender passed
on initial proposal: 81 nodes, 552 findings, 53 bindings, 28 disclosed adaptations
and four specifically unused duplicate pond images. Zero corrections followed
the initial proposal; the maximum permitted correction budget remains three.
Bundle uses seven visually supported component types, not all sixteen by force.
Source ZIP SHA-256 remains
0faf3d60cf0853980f2f1ceb7b742a8752ebd363645f16e24f4dfcc63fa64f92.

Actual local Studio verification passed: imported the generated Bundle, activated
all twelve Buttons with the mouse, selected all four pond Tabs, changed the real
ProgressBar to zero/full and observed different pixels. Clicked the actual export
button, downloaded/reopened the saved Bundle and revalidated state, original ZIP
bytes and source-plan SHA. No API/external request or page error occurred.
Evidence: work/ui-component-harness/layer-subagent-simulation-20261003-r001/
proposal-0.json, round-0/check.json, round-0/render.json, browser-result.json and
模拟验证报告.md. Local deterministic helper scripts remain ignored under .tmp/.

Result remains draft_pending_visual_review, humanVisualAcceptance=false. System
font/layout proposals and upstream raster differences need review; the mountain
pond's baked gold border remains fixed and actual selection uses text color.
Buttons emit local events without invented game actions or unseen destination
pages. No runtime fallback, native success, human approval, media generation,
commit or deployment is claimed by this simulation.

### 2026-10-03 Recover Bundle import from an outdated open page

User's actual tab still ran studio-BEBbya-I.js. Read-only inspection exposed
TypeError: Failed to fetch dynamically imported module for the replaced
layer-component-CSKA-fLy.js. The generic damaged/unsupported Bundle message
masked this page-resource error. The same unchanged 28,845,147-byte Bundle
imported successfully in fresh default and SwiftShader Edge contexts at the
user's URL and a narrow viewport, with no page/API/external errors.

Studio now identifies deferred JS/CSS loading failures and offers explicit
page-refresh guidance/button. No automatic navigation or planning resubmission.
Build passed (.tmp/simulation-import-stale-build-r001.log). One actual built-
preview browser regression passed (.tmp/simulation-import-stale-browser-r001.log):
block a deferred module, see the resource message/disabled export, refresh and
reimport successfully, with zero provider requests. Hashed-preview regression
is skipped in the development-server mode where this failure mechanism differs.

Refreshed the user's original in-app tab and reimported the same Bundle through
its real file chooser. Current entry studio-DtWcR-0m.js; actual canvas visible,
saved-plan status shown, export enabled and error hidden. Evidence remains under
work/ui-component-harness/layer-subagent-simulation-20261003-r001/import-diagnosis-r001/
including the current-tab screenshot and 导入恢复说明.md. Source/archive/plan and
earlier receipts unchanged; no CLI/model/media dispatch or visual approval.

### 2026-10-03 User-approved visual revision of the simulation draft

User confirmed continuing the proposed visual fixes. Locally authored revisions
reuse only authenticated regions from the unchanged 38-layer source ZIP: fill the
plaque English gap, move baked metric icons using original blank paper/crops,
separate title/badge, improve card labels and rounded progress corners. Pond
images keep native geometry via supported raster icon parts; real Tabs now show
the current observed pond name without invented pages or actions.

Revision 1 failed native Tabs cell-height constraints; its receipt and proposal
remain preserved. Revision 2 passed contract/compiler/render and local browser
input/export, but actual text measurement found a two-pixel name/count overlap
on Mountain Pond. Revision 3 fixes spacing and reduces paper-label cover areas
based on rendered glyph widths. No native CLI/model-provider/media generation
or public runtime/contract changes occurred during these local plan revisions.

Final revision passed existing runLayerAutoDag and checkLayerPlanRender. Actual
Studio browser checks passed: twelve Button mouse activations, all four choices
with only the selected feedback text visible, real progress zero/full pixels and
values, actual export/reopen preserving ZIP bytes and source-plan SHA. Final
geometry helper reads/validates actual nested rendered-text bounds; all four
metric text/icon pairs do not overlap and every pond name/count gap is four pixels.
The intermediate helper had read the wrong bounds shape; corrected final evidence
is authoritative, previous records remain untouched. No page/API/external error.

Source ZIP SHA-256 remains
0faf3d60cf0853980f2f1ceb7b742a8752ebd363645f16e24f4dfcc63fa64f92.
Final plan SHA-256:
004ae93a58b00ada03ace90b842b92f18758a0df9659634d5d2180a914cf038f.
Imported revision-3/component-bundle.json into the user's original in-app tab:
canvas visible, export enabled, error hidden. Evidence is under
work/ui-component-harness/layer-visual-refinement-20261003-r001/, including
all proposals/checks, layout-measurements.json, 视觉修订说明.md and final
revision-3/browser-result.json/current-studio.jpg. Ninety-five nodes, seven types,
thirty-nine disclosed adaptations. Status remains draft_pending_visual_review;
font/source-art/texture differences and the fixed baked mountain gold border
remain disclosed. No human visual acceptance, commit, release or deployment.

### 2026-10-03 Integrate declared layout measurements into automatic corrections

User approved moving the visual revision lessons into planning and deterministic
render checks. Added source-bound layoutChecks 1.0 to the optional plan extension:
explicit directional separations with finite minimum canvas gaps, plus portable
review explanations covering every unpaired nonempty Text. New native proposals
must supply the declaration; historic plans/Bundles and run receipts remain
readable without gaining a measured-spacing claim. Canonical plan digests include
the declaration. Model-proposed labels remain observed contract data, not game
actions or substituted text.

The neutral checker measures actual nested glyph rectangles and Image target
rectangles. It can precisely select one unique existing built-in Button, Panel,
Dialog or Tabs label/title, needed because this source's pond names are Tabs
labels rather than independent Text nodes. Missing/duplicate/nonfinite evidence
fails terminally. Hidden pairs are explicitly skipped. The render adapter emits
portable gap issues, actual/required gaps, rectangles and PNG evidence to the
same verified session's existing shared three-correction budget. Previously
validated relations cannot be removed, redirected or weakened; measured targets
cannot be hidden to bypass failure. Failed hiding reports and all completed
drafts/checks remain preserved. Collection revalidates policies and measurements
without model dispatch; older correction prompts and receipts keep their scope.

Planning prompt now covers restricted source-paper patches, cropped metric icons,
child order, full glyph spacing, common Tabs geometry retaining original icon
dimensions, disclosed fixed highlights and removal of all baked progress state.
These prompt requirements do not constitute automatic pixel-semantic validation
or human acceptance. Checks cover declared relations in the loaded state, not
every interaction state, all typography or unpaired spacing. Studio rejects
layout failures with a concrete message, clears previous successful output and
displays unpaired Text explanations among review items.

Final build passed (.tmp/layer-layout-build-20261003-r002.log). Final targeted
offline suite passed 36/36 (.tmp/layer-layout-unit-20261003-r004.log), including
strict policy/coverage validation, actual nested bounds, a two-pixel overlap,
owned-label selection, ambiguous/invalid measurements, immutable source/digest
checks and historical compatibility. The first suite exposed missing declarations
in the all-sixteen-types gallery fixture; its coverage was corrected and the
failed output retained. Three final actual-browser tests passed (browser-r003):
one request/four process-double turns use actual Pixi measurements to reject
lowered gaps or hidden targets, then pass at correction 3; export/reopen retains
source and checks. Invalid Bundle import clears successful preview/export. Three
existing affected browser cases also passed in browser-r001 (legacy Bundle
roundtrip, implicit label overflow and mixed three-correction budget). All tests
used synthetic fixtures/doubles, zero native/model-provider/media dispatches.

Local replay of the actual immutable 38-layer source added eleven explicit
relations to copies of earlier proposals, preserving all old evidence. Old draft
fails: Mountain Pond name/count gap -2px; the other three are 3px against their
declared 4px requirement. Corrected draft passes all eleven, including four exact
4px pond gaps, metric icon/text pairs, caption/value pairs and the built-in title
versus badge. Twenty-six other Texts have explicit unpaired scope explanations.
Evidence: work/ui-component-harness/layer-layout-rules-verification-20261003-r001/
result.json and each case's proposal/component-plan/render.json/render.png.
Only the passing corrected case published a Bundle file. Source SHA-256 remains
0faf3d60cf0853980f2f1ceb7b742a8752ebd363645f16e24f4dfcc63fa64f92;
new plan SHA-256 is
e3789dfb43f463d9318c650e6a9aa1ae2817c0546107bc38db195ba37668fc49.
This is local declared-policy replay, not a new native planning run.

Restarted the idle authorized loopback preview to load the current backend rules;
read-only bridge status is configured=true, busy=false, maxCorrections=3. Reloaded
the user's existing tab and imported the passing source-bound Bundle. Actual
entry studio-CcuIXqW1.js, canvas visible, status 可以预览与导出, export enabled and
error hidden; current-studio.jpg is saved in the same evidence directory. Login
was not changed and no planning request was submitted. Native full-chain proof
and human visual acceptance remain pending; no commit, release or deployment.

### 2026-10-03 Eleven-layer real sample and resource-path diagnostics

New user ZIP SHA-256
3eb36c50a1c7bcea9843d8186964476576bab47bb66d8eb84c23a03fad8bc4d6
passed authenticated intake and the existing CLI: 6,066,664 bytes, 1672x941,
11 layers. Preview was shown first; reference labels are SHOP, 250, 30, 50,
20, three BUY labels and BACK. Thirteen PNGs decoded in an actual local browser.
Static Pixi intake, narrow viewport, export refusal before a plan, corrupt
replacement cleanup, reimport and reset passed with no provider/API calls.
Original ZIP and copied source bytes remain identical. Source coins are lowered
and mostly hidden behind BUY artwork; enlarged item art and other source-raster
differences require explicit adaptations and human review.

One explicitly authorized native request dispatched three turns in one verified
session. Initial construction-incomplete output completed; correction 1 produced
a 31-node proposal but image fields used layer IDs, and adaptation validation
rejected it. Correction 2 suffered timeout notices, HTTPS fallback and a new
stream-disconnection reconnect notice; live event guard terminated it as
SESSION_TRANSPORT_FAILED_NO_RETRY. Two turns completed; modelTurns=3 and
corrections=2 count dispatches, transport resubmissions=0. No render or Bundle,
sample component interaction or export ran. No quota failure was observed.
Original receipts and all old work remain untouched. Evidence:
work/ui-component-harness/layer-real-sample-20261003-r001/.

Fixed ambiguous planning wording and generic feedback: image values must be
authenticated layers[].path; IDs remain binding/adaptation identifiers. Rejected
resource aliases now produce portable exact field pointers and required paths,
preserving existing error codes and all source/layout gates. Original failed
proposal replay remains rejected with 25 field diagnostics and no byte changes.
Build passed; 38 targeted offline tests passed, including three new regressions
for crop/Button aliases and same-session diagnostic/collection behavior. Fifteen
affected browser fixture tests passed with doubles and zero native/provider
dispatches. Historic Bundles remain compatible; these fixture results are not
real-sample component acceptance. Idle local preview was restarted for the fix.

After this terminal outcome the user explicitly requested a new real CLI run
and reported restored quota. A fresh source-bound execution spec and one-use
request are prepared under layer-real-sample-20261003-r002, with corrected
prompt and a new session. This does not resume the failed request. Subsequent
evidence will be recorded separately; no subagent simulation was authorized or
started. Human visual acceptance remains false; no commit/release/deployment,
game-engine or business-action integration, or new artwork generation occurred.

### 2026-10-03 Fresh authorized native execution terminates on transport

After the user's explicit new CLI instruction, dispatched one independent native
request with corrected resource-path wording under
work/ui-component-harness/layer-real-sample-20261003-r002/. Execution spec SHA-256:
0b2f0b6ca8b962b8d016e1ffadd10e893dea50a7a302ba8c70fbd7cc3e63c077.
Initial construction-incomplete turn completed with readable semantics; same-
session correction 1 did not complete. The live guard stopped timeout notices,
WebSocket-to-HTTPS fallback and a new response-stream decoding/disconnection
notice as SESSION_TRANSPORT_FAILED_NO_RETRY (HTTP 502). Two turns dispatched,
one completed, one correction dispatched, zero Harness transport resubmissions.
No quota failure was observed. No Bundle, component render, real-sample control
interaction, enabled-state or export/reopen acceptance was produced. No simulation
or additional native request ran; earlier failure receipts remain unchanged.

Program verified the original source ZIP, all copied drafts/checks and original
terminal result fingerprints. Result SHA-256:
6d4d1e1b30866e6aa799bf6980ab1a2e239ab891f6b8b16575fca1b327d18a0e.
Deterministic collection refused this failed session without changing its receipt.
Actual Edge/Pixi replay of the saved HTTP 502 response passed: exact source bytes
in the intercepted browser POST, failed preview/ready cleared, both exports and
resubmit disabled, direct export refused, reimport restored static preview only.
The recorded-response replay had zero model/native submissions, page errors or
external requests; it does not establish a successful native planning chain.
Evidence is in r002/native/ and terminal-browser-replay/; full source differences,
passed gates and blocked acceptance items are in 真实样本测试报告.md. The source
coins remain partly occluded in upstream preview; enlarged item art, font/state
art gaps and upstream warnings still require declared adaptation and human review.
Human visual acceptance remains false. No deployment, game/business integration,
new artwork generation, commit or release occurred; existing local work remains.

### 2026-10-03 User-authorized subagent simulated sample acceptance

User explicitly requested subagent substitution after the two terminal native
transport failures. Started one simulated planner for the same authenticated
11-layer ZIP; no failed CLI request was resumed or resubmitted. Independent
work directory: work/ui-component-harness/layer-subagent-sample-20261003-r001/.
SIMULATED-SUBAGENT remains in summary, requirements, planning issues and document
identity; all verification receipts mark nativeFullChainPassed=false. Original
source bytes and both prior failure evidence fingerprints remain unchanged.

Complete initial proposal has 32 nodes, 27 bindings covering all 11 layers,
192 portable findings, 18 disclosed adaptations and 16 source-bound layout
relations, all requiring at least 4 canvas pixels. No planning correction was
needed. Existing deterministic DAG validation/compile and actual Edge/Pixi
render passed every relation, with no hidden skips or implicit text truncation;
smallest measured gap is 9.141700404858284px. BUY/BACK use exact built-in text
selectors; standalone SHOP is the one explicitly unpaired Text. Frozen card art
is adapted using declared blank-paper regions and aspect-preserving item/coin
crops; no resource bytes are changed or new raster images introduced.

Existing layer-build/validate CLI passed; its Bundle object equals the DAG
Bundle. Actual sample browser acceptance passed four mouse activations, four
Enter activations and four Space activations. Each of four Buttons passed
disabled visual change, mouse refusal, Tab skipping, held-Enter cancellation
and reenable activation. Studio and workbench actual downloads/reimports passed;
normalized Studio initial/reopened PNG bytes match. Workbench export restores
the source enabled states. All four Bundle objects retain exact original ZIP,
plan and all 11 PNG bytes/hashes. Verification has zero planning/model/API or
external submissions, forbidden requests or page errors. These are actual
deterministic/render/interaction checks after simulated planning, not evidence
that the native CLI planning route passed.

First acceptance attempt is preserved: its test wait called getDocument during
workbench loading and failed TREE_NOT_LOADED. Corrected the validation script's
shared import/reimport wait to require export readiness and the target root before
reading the document; full acceptance-r002 passed without changing sample plan
or core runtime. The previously fixed generic resource-path diagnostics and
their 38 offline/15 browser fixture tests retain their separate r001 evidence.
Source SHA-256 remains
3eb36c50a1c7bcea9843d8186964476576bab47bb66d8eb84c23a03fad8bc4d6;
plan SHA-256 is
edbc4c6ff2a7aa540906eca0936f8bb986a85b0e4a03c27c11fabbfce0a48284.
See final-verification.json, drafts/turn-0/, simulation/, acceptance-r002/ and
模拟规划样本测试报告.md for hashes, exports and screenshots. Human review remains
required for Arial typography versus rounded outlined reference lettering,
source frame/card/capsule differences, paper seams, crops and procedural states.
No human visual acceptance, game/action binding, new media generation, deployment,
commit or release; all earlier local work is preserved.

### 2026-10-03 User feedback on the simulated preview

After viewing the simulated Pixi preview and disclosed differences, user said
“问题不是很大”. Recorded that feedback separately in the simulated sample's
用户视觉反馈.md. Retain the current plan as the validation baseline and do not
revise visuals on this feedback alone. This is limited feedback on the current
preview, not an expanded approval of all states or formal delivery. Source/plan,
Bundle, program receipts and both native failure records remain unchanged; no new
CLI model execution is authorized or dispatched by this feedback.

### 2026-10-03 Read-only native CLI transport diagnosis and local Studio recovery

User requested “排查下”. Inspected host CLI 0.160.0, local ChatGPT login status,
actual Harness flags, sanitized user transport settings, Windows proxy state,
and both native executions' five original stdout/stderr traces. Zero new model
dispatches. All five turns report WebSocket timeouts and HTTPS fallback; three
complete after fallback, two fail decoding the incomplete HTTPS response stream.
Longest turn is about 518s, below the 900s Harness timeout. No historical quota
error was observed; quota and next-request availability remain unverified.

Current explicit direct unauthenticated HEAD probes to two public OpenAI URLs
time out at about 8s. The existing loopback HTTP proxy completes TLS and returns
403/401. Windows user proxy is enabled; initial inspection process has no proxy
environment. Proxy/transport routing is the leading hypothesis, not proof of the
historical CLI route or the exact WebSocket/SSE disconnection cause. CLI reports
the old responses_websockets feature switches as removed; no old switch,
provider replacement, global config change or retry/timeout weakening applied.

Studio had stopped listening at 4173. Restored the existing local preview with
process-scoped HTTP/HTTPS/ALL_PROXY and loopback NO_PROXY; read-only planning GET
returns configured=true, busy=false, maxCorrections=3. This does not verify an
authenticated model stream. Original source/prompt/schema and both terminal
result hashes remain unchanged; no new sample session was created. Five offline
historical-event process-double replays pass the existing live guard, accepting
completed turns and stopping incomplete disconnects without actual subprocess
or model dispatch. Runtime code and transport gates are unchanged.

Evidence: work/ui-component-harness/cli-transport-diagnostics-20261003-r001/,
including CLI传输排查报告.md, network/status/guard/recovery JSON, and a reviewed
local-only startup script. Frozen candidate for a fresh independent proxy trial
is unexecuted and explicitly unauthorized; candidate digest:
d7cf5962f9d039053fdf59ba4d182bae142fa2d77960cbd20ee07a30bc5ea2e2.
A new human compute decision is required before that trial; never reuse the
failed native sessions or consumed execution locks. Simulated Bundle acceptance
and limited user visual feedback remain separately recorded. No deployment,
publication, game actions, new media, commit, or change to earlier local work.

### 2026-10-03 Freshly authorized native CLI proxy trial passes the real sample chain

User explicitly said “授权” after reviewing the frozen process-proxy trial.
Bound that fresh single-use authorization to candidate SHA-256
d7cf5962f9d039053fdf59ba4d182bae142fa2d77960cbd20ee07a30bc5ea2e2.
Frozen candidate bytes retain their original pre-authorization fields; a separate
authorization.json records the new human decision and a new native-dispatch-lock
consumes it. Independent directory: work/ui-component-harness/
layer-real-sample-20261003-r003/. Source ZIP/original, prompt/schema, CLI 0.160.0,
local ChatGPT login, reviewed proxy and idle API rechecked before dispatch.

One new native request/session, initial completed construction-incomplete turn,
then one same-session correction produces a complete valid plan. Two model turns
complete, zero reconnect/HTTPS fallback notices and zero Harness transport
resubmissions. Existing DAG/contract/binding/adaptation validation, deterministic
collection, compilation and actual Edge/Pixi render pass. No old failed session
is resumed and no gate is bypassed. The successful long turn under the explicit
process proxy supports the prior transport hypothesis without establishing a
permanent network guarantee or a specific service-side transport protocol.

Native plan has 29 nodes, 23 bindings covering all 11 layers, 159 findings,
13 disclosed crop/order adaptations, 14 layout relations and no unpaired Text.
Every rendered relation passes without hidden skips; smallest actual gap is
7.754px. Source ZIP and all resource PNG bytes remain unchanged. Existing
layer-build/validate CLI passes and its Bundle equals the DAG Bundle. Plan SHA:
9ba2f9029af9bf3db9f6523195fb777f2d000f4af217c7b4a99ddc0236c2b904.
Original native result SHA:
28c2a1a91980fbd8b221d71773d51650eddf7357bd1f76fbd91cb5ed41d50970.

Actual browser acceptance passes four mouse, four Enter and four Space
activations, plus five disabled/reenabled behavior checks for each of four
Buttons. Studio/workbench actual downloads and reopen pass; source, plan, all
11 resources and exported Bundle objects equal the originals. Normalized Studio
initial/reopened PNG bytes match. Acceptance blocks model APIs and external
traffic; zero model dispatches, forbidden requests or page errors during tests.
final-verification.json records nativeFullChainPassed=true and separately
humanVisualAcceptance=false. Prior two terminal result fingerprints remain
unchanged; simulated planning and limited feedback records remain independent.

No new core defect was exposed by this trial; runtime code, gates and the sample
plan were not manually altered. Existing generic resource-path and transport
regression evidence remains preserved. See 真实CLI代理实测报告.md and 视觉复核.md:
system-font typography, outlines/shadows, frozen frame/capsule differences,
paper seams/crops and state visuals require human review. The capsule coin is
still baked into an Image and has no separate coin/value spacing relation;
declared Text coverage does not prove all image/text adjacency measurements.
No game/business binding, new media, deployment, publication, commit or release.

### 2026-10-03 Numeric glyph clipping: generic renderer fix and preserved-sample replay

User identified clipped trailing zeroes in the real r003 render. Reproduction
shows a generic Pixi 8.20.1 text raster defect on the English check page: the
OffscreenCanvas measurement inherits page language, while detached raster canvases
inherit a different language/font fallback. For 44px bold "30", measurement/frame
is 48.941px/49px but actual draw advance is 54.270px and ink reaches 53.135px;
105 painted pixels fall outside the texture frame. At 38px "250", the actual
70.304px advance exceeds both the 64px frame and pooled canvas. The previous
layout gate shares the undersized metrics and therefore missed this defect.

Added a shared renderer preparation that sets standard canvas language through
Pixi's DOMAdapter before canvas/context creation and clears unused canvas/metric
caches. It does not change source resources, text, component layout, thresholds,
checks or visibility. The new real-browser regression checks independent raster
advance/ink, texture-frame size and alpha pixels for 30/50/20/250 in English and
Chinese pages. Before the fix, English fails (required >=55px, observed 49px);
after the fix both languages pass with matching measure/draw and zero outside
pixels. Build passes. Affected browser suite passes 29 tests with one built-only
skip; built preview passes 11 tests including that case and legacy v0.1's 14
probes. There are 40 distinct passing browser tests; final numeric cases pass 2/2.

Replayed the unchanged native r003 Bundle through the existing deterministic
renderer on the built preview. All 14 layout relations pass; the corrected
English screenshot visibly contains complete zeroes. Fresh acceptance-r002
passes four mouse, four Enter and four Space activations, all 20 disabled/state
checks, actual Studio/workbench downloads and reopen, equal normalized Studio
PNG bytes, source ZIP/resource/plan/Bundle identity, and no API/external traffic.
No model dispatch or authorization reuse occurred. Programmatic verification
confirms all 64 original evidence files and all three native result fingerprints
remain unchanged. Historical success receipts retain their original scope; the
earlier report's "no text overflow" wording did not establish complete rasterized
glyphs and is superseded by this correction and its new evidence.

Evidence: work/ui-component-harness/text-raster-clipping-20261003-r001/
数字裁切修复报告.md, post-fix-verification.json, numeric-raster-{en,zh-CN}.png,
regression-before/after/final and affected/built logs, and native-replay/ with
byte-identical Bundle and new render receipts. Original sample adds an independent
数字裁切后续修正说明.md linking this correction. System-font typography, missing
reference outlines/shadows, frozen-art adaptation differences and state artwork
still require human review; humanVisualAcceptance=false. Existing local edits
are preserved; no game binding, image generation, deployment or publication.

### 2026-10-03 Post-fix visual review prepared

In response to the user's next-step question, compared the authenticated reference
with the corrected real r003 screenshot and prepared 修复后视觉复核.md in that
sample directory. It links the current render and acceptance-r002 state evidence,
and identifies typography, frozen-art boundaries, crop/patch and unmeasured
capsule adjacency items. Current digits appear complete; prior clipping receipts
remain preserved. No new user visual decision is inferred: humanVisualAcceptance
remains false. No model execution, source/plan change or additional test run.

### 2026-10-03 User accepts the corrected native sample; sample testing closed

After the post-fix visual review and its listed differences were presented, the
user directly replied “我没啥问题”. Recorded acceptance of the current corrected
native r003 sample and disclosed visual differences in a fresh
layer-real-sample-20261003-r003/visual-acceptance-r001/human-decision.json and
样本收尾记录.md. This is a direct human decision, with archive, plan, Bundle,
reference, corrected render and review/evidence fingerprints attached; it is not
a claim of pixel-exact reproduction or broader component/device coverage.

The deterministic recorder verified all 95 files in the original native and
renderer-fix evidence inventories before and after writing the separate decision
and its inventory. Existing execution receipts and historical
humanVisualAcceptance=false flags remain unchanged; the new record establishes
current humanVisualAcceptance=true. Existing technical validation remains pass.
No new model execution, plan/resource changes, tests, commit or publication.
This UI component real-sample test is complete; additional real samples with
Tabs, scrolling lists or dialogs would extend the present coverage.

### 2026-10-03 User-requested complex UI reference generated for upstream delivery

User explicitly requested one new reference image to run through the layer
delivery workflow themselves. Used the built-in image_gen tool and saved its
unaltered PNG in work/ui-component-harness/layer-complex-reference-20261003-r001/
reference.png, together with the exact prompt and 参考图说明.md. The reference has
three Tabs, four named item rows, a scrollbar, an open details Dialog and a
quantity stepper initially showing 0. Inspected visible labels, digits and
separation; copied output bytes match the generated original. This user-requested
reference generation is independent of the completed native sample and automated
Harness tests. No Codex planning or frozen layer delivery occurred here; await
the user's new ZIP before source authentication or component acceptance. The
note explicitly forbids guessing unseen row data and identifies missing font,
hidden-tab and state artwork for later source-bound validation.

### 2026-10-03 New complex real ZIP authenticated; native execution awaiting fresh authorization

User provided ui-layers-package (5).zip and asked to try it. Independent sample
directory: work/ui-component-harness/layer-real-sample-20261003-r004/. ZIP is
7,802,114 bytes, SHA-256 fa2c8f196c43805e2c243294b278c561f4604ac74347675e1f369b8e867d896a;
1672x941, 35 layers and 43 members. Existing package/library and layer-intake CLI
validate all paths, inventory hashes, geometry and review-required metadata.
Reference bytes equal the user-requested generated reference. Displayed the
authenticated package preview before component planning.

Actual Edge decodes all 37 PNGs; all 35 layer alpha images are nonempty. Saved
layer sheet and alpha facts. Browser layer composition vs preview has max channel
difference 2 and mean absolute channel difference 0.1073, recorded as decoder/
composition rounding rather than exact equality or visual approval. Actual Studio
ZIP import shows the static Pixi preview, leaves component/export unavailable,
and has zero blocked API/external requests and page errors. No model dispatch.

Identified readable reference labels and values, candidate control roles,
35 reusable materials, 17 upstream review warnings, duplicate baked shell/tab/
paper state risks, and missing fonts/hidden-tab/state artwork. File names and
package text are data; package viewer code was not executed. No invisible rows,
game actions or full component plan were invented. See 离线预检与执行准备.md.

CLI 0.160.0 host-side read-only login check passes; restricted-process false
result is preserved separately. Desktop ordinary usage is currently allowed;
this is not a CLI success guarantee. Studio is configured/idle and the reviewed
host proxy is unchanged. Frozen new execution spec SHA-256:
1d6bd8540d166408b423dc2389bb242fb3abe8aa21727fc79f807529bd83575b.
Await explicit authorization applicable to this new ZIP before one fresh native
request and up to three completed-turn corrections in the same session.
Terminal conditions retain zero resubmission. Current component plan, Bundle,
interactive acceptance and human visual approval are not yet executed.

### 2026-10-03 Authorized complex sample native correction times out; attempt terminal

User explicitly replied “授权本次真实 CLI 执行” for the frozen r004 execution spec
1d6bd8540d166408b423dc2389bb242fb3abe8aa21727fc79f807529bd83575b.
Recorded fresh authorization and consumed it for exactly one native request on
the authenticated 35-layer archive. Two model turns were dispatched in the same
verified session. Initial planning completed with Unresolved /
construction-incomplete and no missing inputs; the full tree, bindings and
layout evidence were not constructed. Its draft/check and the correction feedback
remain preserved. The first correction did not complete and reached the existing
900-second timeout: HTTP 502, SESSION_TIMEOUT_NO_RETRY, status blocked,
execution=null. Original result SHA-256:
97b6262c8e9e18973b0a11f482925099f82f7f59ff9ce1fe34c1d5c8357f5e58.

Correction events contain four CLI reconnect notices (2/5 through 5/5). Harness
transport resubmissions remain zero. The precise cause of the unfinished turn
is not established; do not attribute it to quota, complexity or a specific route.
No request was retried or resumed. Source/reference bytes remain equal. The
read-only collector rejects this failed session with SESSION_COLLECTION_SOURCE_STALE;
no valid plan or Bundle exists, and Studio busy=false after termination.

Executed 23 passing offline terminal-gate tests and one passing browser timeout
presentation test using fixtures/process doubles/local HTTP only. These are gate
regressions, not new-sample component interaction acceptance. Full contract,
layout, compilation/render, mouse/keyboard/state and Bundle export/reopen tests
remain unexecuted because the native plan failed. No general runtime defect has
been proved; no checks, spacing, timeout or measured targets were weakened.

Programmatic verification confirms all 158 protected files across the new
preflight, old native sample, text-raster fix and old independent human decision
inventories are unchanged; old terminal-result fingerprints also remain unchanged.
Kept the new failed receipt intact and did not substitute simulation or old
successful output. Report and terminal-verification.json are saved under
work/ui-component-harness/layer-real-sample-20261003-r004/; the report is
本次真实CLI超时报告.md. New full-chain and human visual acceptance remain false.
Existing source preview border/state risks and missing font/hidden-content/state
artwork remain disclosed. No game binding, image generation, deployment,
publication or further model dispatch. Fresh execution or simulation requires
a separate new decision; current authorization is consumed.

### 2026-10-03 User-authorized complex sample subagent simulation passes deterministic UI acceptance

User directly requested “先用subagent来代替cli”. Created a separate
work/ui-component-harness/layer-complex-simulated-20261003-r001/ record, with fresh
simulation authorization and byte-identical source ZIP/frozen input. One subagent
produced the full structured simulated proposal and one correction. Initial
TAB_ITEM_CANVAS_MISMATCH was preserved: ALL's 311px native cell mismatched its
authenticated 314x85 template. The correction uses 314px and retains all 26
layout relations, endpoints, axes, minimum gaps and initial target visibility.

Existing parse/strict source-bound DAG/compiler, public CLI validate and actual
local Pixi render pass. Final plan has 51 nodes, 45 bindings, 12 adaptations and
358 evidence findings. All 35 layers are accounted for; 34 resources are used,
with the baked-selection tab_all explicitly unused and still preserved in the
exact ZIP. Plan SHA-256:
04a4c097fe03862e44f00f0406c7d63bbb3b974918ab51464a98b8b80f767b1d.
Bundle SHA-256:
c004140cfa7cbed4dd8d9f9297aca6bbe506dafbac2a940a1862cceb39ebf121.

Actual final Edge acceptance-r005 passes ten mouse/Enter/Space Button activations,
three Tab choices plus keyboard navigation, wheel/content-drag/keyboard scrolling,
real Input edit 0->17 and persisted export/reopen 17 followed by restored 0,
twelve disable/reenable checks plus one public-control Dialog close/open record,
and actual Studio/workbench downloads and reopen. Source ZIP, plan and all 34
resource bytes remain equal across all three exports. Initial/restored/reopened
normalized Studio PNG bytes match. Initial/open restored/reopened layout measures
all 26 relations; Tab states legitimately close the modal proposal and measure
22 relations, explicitly skipping four hidden Dialog relations. No API/external
traffic or page errors. Buttons have standalone activate events; quantity,
Dialog-close, filtering and game-action linkages are not claimed.

Preserved acceptance-r001 through r004 automation failures and diagnostics.
Two stable-wait timeouts did not reproduce persistent geometry movement: 90
recorded frames have identical canvas bounds. Other failures were waiting for a
nonexistent old canvas on first import and reading getDocument before tree load.
Strengthened new-canvas/readiness synchronization and measured DOM geometry in
the acceptance runner; full r005 passes with all substantive assertions retained.
No public runtime defect was established, so no runtime/gate change or redundant
regression test was added. No layout weakening or image modification occurred.

Programmatic final verification confirms 172 protected prior evidence files are
unchanged, including complete r004 terminal evidence. The r004 native failure
remains SESSION_TIMEOUT_NO_RETRY with original fingerprint
97b6262c8e9e18973b0a11f482925099f82f7f59ff9ce1fe34c1d5c8357f5e58.
Report: 模拟组件交付验证报告.md; verification.json and new evidence inventory
save source/resource hashes, draft/render checks, actual interaction and scripts.
Current result is technical-pass-pending-human-review, planningMode
simulated-subagent, nativeFullChainPassed=false, humanVisualAcceptance=false.
Font/outline, active-tab appearance, 12px viewport/longer thumb, paper/crop seams,
modal/edit-capacity proposals and shared unknown category content remain disclosed.
No Codex CLI/provider dispatch, image generation, game binding, deployment or
publication; this does not establish native automatic planning success.

### 2026-10-04 User-visible browser preview with independent font compatibility proposal

User requested opening the current simulated sample in the browser. The original
Bundle was rejected by the in-app browser with TEXT_OVERFLOW on collection-title;
its earlier Edge acceptance and original bytes remain intact. Exact browser font
fallback/measurement cause is not fully established. The same authorized simulated
subagent supplied correction two, declaring Arial for all 51 node styles while
preserving font sizes, line heights, layouts, bindings, adaptations and all 26
layout relations. Existing strict compiler and actual Edge Pixi render pass all
26 initial checks. The independent Bundle then imported successfully into the
visible in-app Studio; the full component canvas, title and numeric 0 are visible,
and the page shows preview/export readiness. The tab is retained for the user.

Saved screenshot, full accessibility state, deterministic identity/protection
verification, runner sources, report and separate inventory under
work/ui-component-harness/layer-complex-simulated-20261003-r001/
preview-compat-turn-2/browser-preview-20261004-r001/. New Bundle SHA-256:
dbdda73e16dd1eb5d68abc7e5b342fb2223ca29ef4d8d53cd38a8a2c1da65f5c.
Programmatic verification confirms the original Bundle and 286 protected evidence
files are unchanged, with exact source ZIP/reference/34 resource bytes preserved.

This in-app browser check covers initial import and visible preview. Full
mouse/keyboard/state/export-reopen acceptance remains scoped to the original
font proposal; it was not rerun or claimed for this compatibility variant.
Arial remains a disclosed consumer typography proposal requiring visual review.
The restore path currently does not show package reference evidence in the sidebar;
the authenticated reference remains in the source ZIP and saved sample files.
Simulation now totals three planning turns and two corrections; no new native
CLI/provider dispatch, runtime change, game binding, image generation or
publication. The native SESSION_TIMEOUT_NO_RETRY conclusion and unconfirmed
human visual acceptance remain unchanged.

### 2026-10-04 Current visible preview interaction limitation diagnosed

User reported inability to interact. Current compatible Bundle opens a modal
Dialog with a transparent backdrop, blocking background Tabs/list/BACK. Its
close/cancel/OK and +/- Buttons only emit standalone activation events; the
proposal has no Dialog-open/Input-value linkage, and Studio records events
without supplying such behavior. Earlier acceptance-r005 closed the Dialog via
the public control API before background tests and asserted Button events, not
a complete user-facing workflow. Preserve that distinction in acceptance claims.

Actual in-app browser mouse focus and keyboard input changed 0 to 7 visibly;
clicking + and X left value 7 and the Dialog open. Saved screenshot and full
accessibility state in preview-compat-turn-2/interaction-diagnostic-20261004-r001,
with a diagnostic report. Restored 0 through keyboard input and retained the tab.
An initial textbox selector timed out; actual numeric input exposes a stepper.
No Bundle/runtime/gate change or new model dispatch occurred. UI-internal
linkage remains a proposal/preview completeness gap, without game-action binding.

### 2026-10-04 Interactive UI delivery scope corrected and verified

The user clarified that the current chain must deliver UI interaction. Earlier
standalone activate-event checks and control-API Dialog setup were insufficient
for that claim. Close/cancel/details selection and numeric stepping now belong
to the generic portable Button interaction contract, independently of game
integration. Fresh native runs require every Button declaration and complete
actual-pointer evidence, recorded by a version marker; old Bundles/runs remain
compatible. Missing declarations and reachable UI-path failures share the existing
three-correction budget; source/login/cancellation/transport terminals still stop.

The same authorized simulated subagent used its third and final correction for
the 35-layer ZIP. All 51 layouts, Arial/font sizes/line heights, 45 bindings,
12 adaptations, source resources and 26 layout relations remain unchanged from
the second correction. Ten Button declarations plus their explicit evidence were
added. DETAILS copies the observed row name/image and opens the Dialog;
X/CANCEL/OK close it; +/- step the Input within disclosed UI edit-capacity bounds.
BACK has an explicit external reason. No business route, purchase or game action
was invented. Simulation totals four turns/three corrections; no further model
turn occurred during deterministic reverification.

Actual render reset exposed a generic Image texture lifetime error. Redraw now
acquires its next reference before releasing the old one, and keeps declared copy
sources/frozen targets available for repeated choices. The first turn-3 blocked
check and local render diagnostic remain intact; fresh strict render/interaction
receipts are stored separately. No receipt was repaired or failed gate bypassed.

Executed evidence: build passes; 48 targeted offline regressions pass; the new
mouse/Tab/Enter/Space/boundary/repeated-choice/export-reopen browser test passes;
all three existing same-session/layout-evasion browser regressions pass. The actual
sample passes 26 initial layout checks and nine internal Button pointer checks
(minus at zero is disabled). Its full Studio workflow uses actual mouse/keyboard,
three Tabs, wheel/Home/End, four detail choices and three close paths, without
control-API state setup. Actual download then refreshed reimport restores SHIELD,
quantity 9 and Dialog open. Canonical screenshots match exactly after real outside
clicks clear transient Input focus. The source ZIP/reference and 34 resource bytes
remain identical. All 303 existing inventoried evidence files remain unchanged.

The visible in-app browser now contains the interactive Bundle. Actual + changes
0 to 1, X closes the Dialog, GEAR changes selection and SHIELD DETAILS opens the
corresponding name/image. The tab is retained showing SHIELD/quantity 1. Browser
upload of the approximately 16 MB Bundle was slow; this is separate from native
model compute. Preserve prior automation errors, including wrong test selector,
pointer/keyboard-focus assumption, large Buffer difference-output memory failure,
and three connection-refused checks before local preview service restart. Their
corrected fresh checks pass; no model request was resubmitted.

Artifacts, scripts, implementation snapshots, screenshots, failures, Bundle,
checksummed inventory and Chinese report are in
work/ui-component-harness/layer-complex-simulated-20261003-r001/interactive-turn-3/.
Generic regression/diagnostic logs are in
work/ui-component-harness/ui-interactions-20261004-r001/.
Bundle SHA-256: 061f1e7cee9bdffd91db38fbddf93145a26f494e7cdd56da6956fd203a27ee90.
Plan SHA-256: bff6ec7bf0fc19c47e58c8aa04cbc5ee522211406e1d80350d86d223339f35ef.

Arial and procedural surfaces, crop seams, 12px shorter viewport/longer thumb,
disabled-minus appearance, enlarged/stretch row icons in detail view, shared
unknown category content and missing restored sidebar reference evidence remain
disclosed visual-review items. Numeric 0..9999 is an explicit four-digit editing
proposal, not inventory. Technical pass does not set human visual acceptance.
Planning mode remains simulated-subagent, nativeFullChainPassed=false and
humanVisualAcceptance=false. The original native SESSION_TIMEOUT_NO_RETRY result
and bytes are unchanged. No native/provider dispatch, image generation, game
binding, deployment or publication occurred.

### 2026-10-04 Native Codex CLI connectivity preflight

The user requested a fresh CLI connectivity check. The installed native CLI is
0.160.0. Local `login status` exits 1 with the bounded category `not-logged-in`;
the harness authentication preflight also reports unauthenticated. The desktop
account usage tool separately allows ordinary usage (33 percent consumed), which
does not establish the CLI authentication state or model connectivity.

Stop before any model dispatch because login is a terminal preflight condition.
No previous sample request/session was resumed or resubmitted. Model connectivity
remains unverified, and the simulated delivery/native-chain conclusions remain
unchanged. Redacted, programmatically generated local diagnostic evidence is in
work/ui-component-harness/codex-cli-connectivity-preflight-20261004-r001/.
Credential contents were not read or copied; no authentication settings changed.

### 2026-10-04 CLI authentication status corrected for execution environment

The user requested a device-login link/code and then a login-status check.
The login user-code request initially failed in the restricted execution
environment; the permitted login environment obtained the device authorization.
The latest local status check in the restricted environment still exits 1,
but the same check in the actual login execution environment exits 0 and reports
ChatGPT authentication. The earlier broad statement that the CLI was not logged
in was therefore unsupported by the isolated check; retain its evidence and this
explicit correction. The exact cause of environment-dependent credential access
has not been diagnosed, and no claim is made about when authentication changed.

The current actual-environment CLI is authenticated. Model connectivity remains
unverified; no model request or historical sample replay occurred. Fresh redacted
status evidence is in
work/ui-component-harness/codex-cli-connectivity-preflight-20261004-r002/.
No logout was executed. Credential values and the one-time device code are not
stored in repository diagnostics.

### 2026-10-04 User-authorized minimal native CLI connectivity probe terminated

The user explicitly requested actual connectivity testing. In the actual login
execution environment, native CLI 0.160.0 passes authentication and launches one
fresh ephemeral read-only CLI process requesting only CODEX_CONNECTIVITY_OK.
Tools, web search and project-document loading are disabled; no sample ZIP is
submitted and no historical session is resumed. Probe plan SHA-256:
3f178d5fb90a41d006dc99c481ab8af6b06626c847b19635f82ec3638e2827b9.

The process emits thread.started and turn.started, but no model response or
completed turn. After 31.128 seconds the native CLI reports stream disconnected,
request timed out and a planned sampling retry in 201ms. The diagnostic wrapper
immediately terminates the process on that first observed transport error.
No second CLI process or automatic resubmission occurs. Provider acceptance and
any internal transport submission are not independently established by this log;
preserve the terminal result without retrying. Login passes; model connectivity
does not pass this probe. A timeout alone does not diagnose quota, account or
network/service root cause. Local skill-load warnings are retained separately.

Programmatically generated redacted evidence and the Chinese report are in
work/ui-component-harness/codex-cli-connectivity-probe-20261004-r001/.
The result is transport-or-login-error-no-retry with SIGTERM, zero completed turns
and no response. The existing simulated component delivery remains unchanged;
nativeFullChainPassed stays false. No image generation, game integration,
deployment or publication occurred.

### 2026-10-04 Read-only network diagnosis and fresh proxy probe prepared

After the user asked how to proceed, actual-environment network metadata and
anonymous public-site HEAD requests were checked without any model dispatch.
Windows system proxy is enabled at a loopback port 7890, but HTTP_PROXY,
HTTPS_PROXY and ALL_PROXY are absent from the CLI process environment.
The user config specifies gpt-6.1-sol without a custom provider/base URL; the
previous minimal probe deliberately ignored user config, like the harness route.

All three public hosts resolve in DNS. Inherited-environment and direct HEAD
requests to auth.openai.com, chatgpt.com and api.openai.com time out at about six
seconds. Explicit use of the observed system loopback proxy completes TLS and
receives HTTP 403 from the first two hosts in about 0.7/1.7 seconds. The API host
completes TLS but times out awaiting HTTP response at 12 seconds. Anonymous HTTP
403 demonstrates an HTTPS response only, not model/authentication acceptance.
The CLI client's use of Windows proxy settings is not independently established;
this is a concrete route difference, not a proven final root cause or fix.

A fresh minimal request with child-only explicit HTTP/HTTPS proxy variables is
fully prepared but not executed, awaiting the fresh decision required by the
user's terminal transport/no-automatic-retry instruction. Prior fixed prompt,
tool isolation and read-only policy stay the same. Plan SHA-256:
77b77d2ba497afe3472ad02ebfaba73f77d226b24331ee05b230a588441980bc.
Prepared script/plan/prompt hashes and syntax pass verification; a negative
authorization guard check stops before dispatch and creates no run receipt.

Actual redacted network evidence and report are under
work/ui-component-harness/codex-cli-network-diagnostic-20261004-r001/.
Frozen pending inputs/run instructions are under
work/ui-component-harness/codex-cli-connectivity-probe-20261004-r002/.
No model request, logout, global configuration change or historical sample replay
occurred during this diagnosis. Prior failed native evidence is preserved.

### 2026-10-04 Fresh user-authorized proxy-route CLI connectivity passes

The user explicitly authorized the prepared proxy-route connectivity request
bound to plan SHA-256
77b77d2ba497afe3472ad02ebfaba73f77d226b24331ee05b230a588441980bc.
Frozen script, plan and prompt hashes were verified before execution. In the
actual login execution environment, native CLI 0.160.0 authenticates and starts
one fresh ephemeral read-only CLI process. Only this diagnostic shell and its
child CLI receive HTTP_PROXY/HTTPS_PROXY for the observed loopback port 7890.
The fixed prompt and tool isolation remain as in the earlier probe.

Executed result: exit 0, one started turn, one completed turn, actual model reply
CODEX_CONNECTIVITY_OK, elapsed 8.322 seconds. The program validates completed
events plus exact model response to produce passed. No automatic resubmission or
historical sample replay occurs. Explicit proxy routing enables this minimal
request to finish; one pass does not establish persistent stability or uniquely
prove all earlier timeout causes. Local skill-load warnings remain diagnostic.

New actual evidence and report are in
work/ui-component-harness/codex-cli-connectivity-probe-20261004-r002/.
Prior frozen preparation and failed request evidence remain intact. No global
proxy/authentication configuration or Studio runtime configuration changed.
No sample ZIP was submitted, so full native component planning/compile/render/
interaction acceptance remains unverified; existing delivery mode stays
simulated-subagent and nativeFullChainPassed=false. No image generation, game
binding, deployment or publication occurred.

### 2026-10-04 Fresh native 35-layer sample run started after user authorization

After the successful proxy probe, the user sent a new authorization, interpreted
and announced as continuing the current 35-layer sample with a fresh native CLI
component run. Exact ZIP SHA-256 remains
fa2c8f196c43805e2c243294b278c561f4604ac74347675e1f369b8e867d896a;
reference SHA-256 is
0b6d71fe11f7b4a3378bdcc2b51af9e1c5aba4ad465ae391491ed7f5964540ff.
Source ZIP, all 43 package members and the preview/reference are reauthenticated.
The 17 upstream review warnings remain disclosed. No filename-derived business
semantics or game-action integration is introduced.

Fresh execution plan SHA-256:
b3827236817724258b65cf7455336d5cd780b5be93207ef5395db839ea65bf00.
Input prompt/schema, runner and relevant runtime contracts are fingerprinted;
the new authorization is reserved once before dispatch. CLI processes receive
explicit child-only loopback proxy variables and --no-daemon; initial/resumed
turns keep tool isolation, source/adaptation/layout/Button-interaction gates.
At most three completed-error corrections share the same verified session.
The local wrapper stops at the first observed transport error, and never
replays historical failures. Existing compiled local renderer endpoints respond.

Initial native turn completed with version 1.1 construction-incomplete and no
missing semantic inputs: the model acknowledges readable text/roles but has not
submitted the full tree, bindings, adaptations/findings/layout relations.
Deterministic validation records a repairable completeness error and begins
correction 1 in that verified session. This start record does not assert a passing
plan, Bundle or full native chain. All initial/ongoing records are retained under
work/ui-component-harness/layer-complex-native-20261004-r001/.

Local preparation initially misinterpreted an older inventory's pathBase and
stopped before any model invocation. Its corrected file-root handling verifies
264 protected historical evidence entries and reuses only byte-identical prepared
files. That local preparation diagnostic is retained. A separate actual-input
acceptance runner is prepared for the native result; it has not yet been executed.

### 2026-10-04 Fresh native sample terminated during correction 1

The new 35-layer native run terminates as SESSION_TRANSPORT_FAILED_NO_RETRY.
Initial turn completed with construction-incomplete, null planJson and no
missing semantic inputs; deterministic validation saved a repairable receipt.
Correction 1 used the same verified session but produced no draft or completed
turn. After approximately nine minutes its CLI log reports model-catalog refresh
request timeout and a TLS peer closing without close_notify. The wrapper stops
on the first observed stream error before starting any later correction.
Total elapsed 644455 ms; two model processes, one completed initial
turn, zero completed corrections and zero automatic resubmissions. Preserve the
terminal outcome; no retry is authorized by this result.

Verified unchanged: source ZIP, all 43 authenticated package members and 264
protected historical evidence entries. No complete component plan or Bundle was
produced, so contract/layout/binding/adaptation gates, Pixi rendering, actual
input and export-reopen were not executed for this new native run. The prepared
acceptance runner is not acceptance evidence. No pass receipt was edited.
Short proxy connectivity passed earlier; this full sample's connection failed.
Network/endpoint-side attribution remains unproven; do not label this quota
exhaustion or claim nativeFullChainPassed. New visual differences cannot be
measured without a new render; upstream 17 warnings and human review remain.

Drafts, native diagnostics, source files, verified evidence inventory and Chinese
report are under work/ui-component-harness/layer-complex-native-20261004-r001/.
The previous failed native records and simulated interactive delivery are intact.
No game integration, new image generation, global proxy/auth change, deployment
or publication occurred.

### 2026-10-04 CLI config/session diagnosis and strict live transport guard

The user asked to continue diagnosis after comparing ordinary CLI usage with the
Harness. No new sampling request or historical replay occurred. Allowlisted
actual-user config is gpt-6.1-sol/xhigh; the prior sample used ignored personal
config and no explicit model/effort, so its actual model is still unproven.
Retained evidence verifies the expected/observed correction session, source
identity and equal child proxy forwarding. Catalog refresh timeout precedes
sampling disconnect by 5468 ms; retained evidence lacks network request/first/
last-byte times. Do not attribute the full waiting period to model computation.

Native doctor via observed child-only proxy exits 0 with warnings. Provider HTTP
reachability (405) and Responses WebSocket handshake (101) pass. This is no model
request and proves neither stable long streams nor full sample acceptance. Local
configuration/index/MCP warnings are retained without speculative root cause or
configuration/database repair. Secondary redaction excludes credentials, URLs,
query strings, host paths and thread IDs. No logout, installation or global
network/config edits.

Generic adapter invocations now use --no-daemon and terminate on the first
observed live reconnect/fallback/error event or stderr sampling transport/login
warning, including split UTF-8/ASCII chunks. A failure cannot start a later
correction. Historical completed receipt collection remains offline/compatible.
New io-timing.json measures CLI pipes/events only, never network first-byte or
idle timing. Build and 27 targeted offline regressions pass; new coverage
reproduces stderr-only transport interruption during same-session correction.
139 recent protected evidence entries stay byte-identical.

Evidence: work/ui-component-harness/codex-cli-session-diagnostic-20261004-r001/.
A frozen two-turn minimal native diagnostic is prepared separately under
work/ui-component-harness/codex-cli-session-probe-20261004-r001/, plan SHA-256
82a6df238acb407e05053038240f38020cd4767b10cfa00739f776eee6b5f27d. It aligns explicit model/effort,
uses one fresh session plus one verified-ID resume, no images/sample or historical
replay, and 120-second per-turn deadline. New explicit model authorization is
required before execution. A minimal pass would not imply long-stream or native
component acceptance. nativeFullChainPassed remains false; prior simulated
interactive delivery and all failed native evidence remain intact.

### 2026-10-04 User-authorized fresh two-turn native CLI session probe passes

The user explicitly authorized the frozen two-turn diagnostic plan
82a6df238acb407e05053038240f38020cd4767b10cfa00739f776eee6b5f27d. Plan, binary/version,
source and fixed prompt/schema fingerprints verify before one single-use
authorization reservation. Actual gpt-6.1-sol/xhigh child-only proxy invocations
use --ignore-user-config, --no-daemon and disabled tools. No sample or historical
session is submitted. The second request starts only after the first completed
turn passes exact fixed-response checks, resuming that verified session ID.

Executed: two native processes and two completed turns, initial 15131 ms,
resume 9090 ms, total 24263 ms. The second actual response recalls
the preceding marker. Complete events equal the saved responses; zero observed
transport notices, zero Harness resubmissions and zero historical replays.
139 prior protected evidence entries plus 11 preceding diagnosis entries
remain byte-identical. Program-generated result/verification, raw private events
and secondary-redacted derivatives are retained under
work/ui-component-harness/codex-cli-session-probe-20261004-r001/.

This establishes current minimal CLI request and verified-ID resume availability,
not long-stream stability or causation of the previous TLS failure. No 35-layer
component proposal/compile/render/input/export acceptance was attempted;
nativeFullChainPassed=false. Previous native terminal records and simulated
interactive Bundle are unchanged. No global configuration/login edits, image
generation, game integration, deployment or publication. This two-turn
authorization is consumed; it does not authorize a full sample rerun.

### 2026-10-04 User-requested fresh native 35-layer rerun with explicit model starts

After the minimal two-turn probe passes, the user explicitly requests a current-
sample rerun. This is announced as a fresh 35-layer run with gpt-6.1-sol/xhigh and
the verified child-only proxy, never an automatic replay of a failed session.
New immutable plan SHA-256:
b4591d2559ce5d074334c99b9cb88c1ab21da1db6db911b9827c4c1c24e62be1.
Source ZIP remains fa2c8f196c43805e2c243294b278c561f4604ac74347675e1f369b8e867d896a;
43 members, 35 layers and all 17 intake review warnings are reauthenticated.
421 historical evidence entries verify unchanged. The saved package preview is
shown before model dispatch. CLI version/binary, prompt/schema, contracts and
runner are frozen; one single-use authorization binds the user's new instruction.

Initial planning starts under a new session in
work/ui-component-harness/layer-complex-native-20261004-r002/. The existing
deterministic adapter owns contract/layout/binding/adaptation checks, compile
and actual Pixi render feedback, with at most three completed-error corrections
in that verified session. First observed transport/login/cancellation/source or
required-semantics failure is terminal. This is a start record, not a passing
plan/Bundle/interaction claim. No global config/auth edits, new image generation,
game integration, deployment or publication.

### 2026-10-04 Explicit-model native sample rerun ends: blocked

Program evidence under work/ui-component-harness/layer-complex-native-20261004-r002/
verifies immutable plan b4591d2559ce5d074334c99b9cb88c1ab21da1db6db911b9827c4c1c24e62be1,
unchanged source ZIP, 43 exact package members and 421 protected historical
entries. Requested gpt-6.1-sol/xhigh, one fresh verified session, 1 native
processes, 0 completed turns, elapsed 900996 ms, zero Harness
transport resubmissions. Outcome blocked; failure SESSION_TIMEOUT_NO_RETRY.
Component plan/Bundle produced=false; contract/bindings/adaptation/layout/
compile/Pixi render passed=false; actual input and export/reopen passed=false.
nativeFullChainPassed=false; humanVisualAcceptance=false. Preserve all
rounds/drafts/feedback/raw private events, secondary-redacted diagnostics and
actual rendering/acceptance evidence when reached. No historical request replay,
global config/auth edits, game binding, image generation, deployment or publication.
Upstream 17 warnings remain disclosed.

The initial CLI pipe trace has only thread.started/turn.started, zero agent
messages/reasoning items and no completed turn. Model-catalog refresh timeout
occurs around 13m40s, then the local 15-minute deadline ends the process. Unlike
the prior failure, this attempt reports no observed sampling-disconnect/TLS
close_notify notice. Provider acceptance and network first-byte timing remain
unknown; do not call the entire waiting period model computation. This is a
terminal timeout and does not authorize automatic model resubmission.

### 2026-10-04 Offline request-stage diagnosis finds retained reasoning progress

No model request, historical replay, credential read, login/global config change
or game/image/deployment work occurs. Bundled CLI model metadata exports offline
in 103 ms and includes gpt-6.1-sol and medium/xhigh efforts. Local
debug prompt-input constructs all 37 images in 5476 ms; decoded image
bytes match source fingerprints. It uses a short diagnostic prompt, whose exact
text hash does not match the wrapped model input; it does not test the full
sample prompt. The exact failed current thread's own rollout separately verifies
all 37 images and the complete 53210-byte stdin prompt against the frozen plan.

Supplemental evidence corrects the interpretation of exec stdout silence:
that rollout contains 30 Reasoning item-completed events from about 29.5 seconds
to 648.8 seconds, although exec stdout contains no reasoning items. Only event
metadata is inspected; raw reasoning content is not read or reported. Thus no
stdout progress does not prove the model never started. There is no final
assistant response/completed turn, and the later catalog timeout is not
established as the root cause. Network first-byte/provider acceptance timing
and cause of missing final completion remain unresolved.

421 protected prior entries plus 116 latest failed-run entries remain
byte-identical. Evidence and program verification:
work/ui-component-harness/codex-cli-request-stage-diagnostic-20261004-r001/.
SESSION_TIMEOUT_NO_RETRY and nativeFullChainPassed=false remain unchanged.
A reduced-effort fresh sample plan may be prepared; it requires new explicit
authorization and must preserve all component/interaction/layout gates.

### 2026-10-04 Fresh medium-effort 35-layer plan prepared, not executed

New plan f15d8e67cd36106609bbd8e56fa56730e08b4afc159033214e499748b53d2ae3 is prepared under
work/ui-component-harness/layer-complex-native-20261004-r003/. gpt-6.1-sol
reasoning effort changes from xhigh to medium; the source ZIP, all 37 attached
images, complete prompt, schema, contracts/layout/interaction gates, same-session
three-correction maximum and 15-minute per-turn terminal deadline stay identical.
Only three allowlisted preparation/execution/acceptance helpers are reused; no
old output, session, authorization, receipt or Bundle is copied.

546 existing evidence entries verify unchanged. The runner without a
new authorization token deterministically refuses before dispatch. Zero model
requests; no native acceptance claimed. New explicit authorization is required
after the previous terminal timeout. Reducing effort is an unverified runtime
choice to reduce planning latency, not an established timeout fix.

### 2026-10-04 User-authorized medium native 35-layer execution starts

The user explicitly authorizes this medium run after reviewing frozen plan
f15d8e67cd36106609bbd8e56fa56730e08b4afc159033214e499748b53d2ae3. Single-use reservation
verifies that digest before dispatch. gpt-6.1-sol/medium uses a new session and
child-only proxy. 546 prior evidence entries and the same source/prompt/
37 images/contracts/layout/interaction gates reauthenticate. The package preview
is shown before dispatch. One initial planning turn starts under
work/ui-component-harness/layer-complex-native-20261004-r003/. At most three
checked corrections may follow completed repairable errors in that verified
session; transport/login/cancel/timeout/source/required semantics are terminal.
This records a start, not a passing plan or Bundle.

### 2026-10-04 Explicit-model native sample rerun ends: blocked

Program evidence under work/ui-component-harness/layer-complex-native-20261004-r003/
verifies immutable plan f15d8e67cd36106609bbd8e56fa56730e08b4afc159033214e499748b53d2ae3,
unchanged source ZIP, 43 exact package members and 546 protected historical
entries. Requested gpt-6.1-sol/medium, one fresh verified session, 2 native
processes, 1 completed turns, elapsed 459641 ms, zero Harness
transport resubmissions. Outcome blocked; failure SESSION_TRANSPORT_FAILED_NO_RETRY.
Component plan/Bundle produced=false; contract/bindings/adaptation/layout/
compile/Pixi render passed=false; actual input and export/reopen passed=false.
nativeFullChainPassed=false; humanVisualAcceptance=false. Preserve all
rounds/drafts/feedback/raw private events, secondary-redacted diagnostics and
actual rendering/acceptance evidence when reached. No historical request replay,
global config/auth edits, game binding, image generation, deployment or publication.
Upstream 17 warnings remain disclosed.

The initial turn completes in 103155 ms (process 105725 ms) with version 1.1
Unresolved/construction-incomplete and no planJson. Same-session correction 1
reports sampling stream disconnection at about 353055 ms: TLS peer closes
without close_notify. The first notice triggers terminal teardown; no later
correction/Harness resubmission occurs. No catalog timeout or explicit quota
error is observed. Which network hop closed and any internal CLI retry timing
remain unknown. Current CLI process count verifies zero. Contract/render/input/
export gates were not reached, rather than executed and failed. Recorded local
progress metadata preserves five reasoning item-completed events; no raw
reasoning text is exported. New model execution requires a new user decision.

### 2026-10-04 User-authorized medium native 35-layer execution starts

The user explicitly authorizes this medium run after reviewing frozen plan
f15d8e67cd36106609bbd8e56fa56730e08b4afc159033214e499748b53d2ae3. Single-use reservation
verifies that digest before dispatch. gpt-6.1-sol/medium uses a new session and
child-only proxy. 683 prior evidence entries and the same source/prompt/
37 images/contracts/layout/interaction gates reauthenticate. The package preview
is shown before dispatch. One initial planning turn starts under
work/ui-component-harness/layer-complex-native-20261004-r004/. At most three
checked corrections may follow completed repairable errors in that verified
session; transport/login/cancel/timeout/source/required semantics are terminal.
This records a start, not a passing plan or Bundle.

### 2026-10-04 Explicit-model native sample rerun ends: blocked

Program evidence under work/ui-component-harness/layer-complex-native-20261004-r004/
verifies immutable plan f15d8e67cd36106609bbd8e56fa56730e08b4afc159033214e499748b53d2ae3,
unchanged source ZIP, 43 exact package members and 683 protected historical
entries. Requested gpt-6.1-sol/medium, one fresh verified session, 1 native
processes, 0 completed turns, elapsed 334331 ms, zero Harness
transport resubmissions. Outcome blocked; failure SESSION_TRANSPORT_FAILED_NO_RETRY.
Component plan/Bundle produced=false; contract/bindings/adaptation/layout/
compile/Pixi render passed=false; actual input and export/reopen passed=false.
nativeFullChainPassed=false; humanVisualAcceptance=false. Preserve all
rounds/drafts/feedback/raw private events, secondary-redacted diagnostics and
actual rendering/acceptance evidence when reached. No historical request replay,
global config/auth edits, game binding, image generation, deployment or publication.
Upstream 17 warnings remain disclosed.

Specific failure: idle timeout waiting for websocket. The sole initial turn
records one reasoning progress event, then the notice follows 300011 ms
later. No completed turn/draft, contract/render/input/export acceptance is
reached. No catalog timeout or explicit quota failure is observed. The interval
is local event timing, not network packet timing; why new progress ceased remains
unconfirmed. Official docs describe the provider idle setting for SSE and reject
reserved builtin provider overrides; current builtin ChatGPT WebSocket idle
tuning has not been verified or changed. No further model request is submitted.

Current transport timing and redacted notices are preserved in transport-diagnostic.json. First observed failure is terminal; no further correction/Harness resubmission. The network hop and internal CLI retry timing are not established. Recorded metadata shows at most 1 reasoning progress items; raw reasoning is not exported. New model execution requires a new user decision.

### 2026-10-04 Subagent-supported technical closeout of current 35-layer sample

The user switches to subagent and asks whether to finish this round before more
samples. A read-only subagent audits existing final interactive-turn-3 evidence;
no new planning turn or duplicate browser run is needed. Parent program revalidates
current Bundle and actual Studio export, exact source ZIP and 34 resources, and
the exported/reopened canonical PNG pair. 808 existing evidence entries stay
byte-identical. Of 15 saved implementation snapshots, 13 are identical; only
the later native CLI adapter and its test differ. Prior 48 offline / 4 browser
regression passes and complete actual UI workflow retain their original scope.

Current delivery is layer-complex-simulated-20261003-r001/interactive-turn-3/,
not the root activate-only historic Bundle. Technical sample closeout is eligible
with simulated-subagent attribution. nativeFullChainPassed=false and
humanVisualAcceptance=false remain; latest native r004 websocket idle terminal
is preserved. Fonts, selected tab background, frame seams, procedural fills,
scroll geometry and enlarged details icon remain visual review items. Disclosed
unknown categories/BACK destination/OK business action remain UI-only boundaries.

Fresh closeout verification, snapshot comparison, report and inventory:
work/ui-component-harness/layer-complex-closeout-20261004-r001/. Next samples
are planned, not executed: settings controls (Switch/CheckBox/RadioGroup/Slider/
ProgressBar/Select), portrait long Chinese/multiline/numeric boundaries, then
explicitly different Tabs content/long lists/dialog layering. No native model
request, image generation, game integration, deployment or publication is added.

### 2026-10-04 User-requested first next-batch reference image produced

After current sample technical closeout, the user asks for reference artwork and
whether to split the next samples into batches. One built-in imagegen request
produces an opaque 1536x1024 settings screen, saved without pixel edits under
work/ui-component-harness/reference-settings-20261004-r001/reference.png.
Image SHA-256 1b9df45ec7ce0b6d7b4d5be6b2b67173b30d031545151e0655820377c839038c; prompt/plan and
byte-identical copy evidence are saved alongside. The new explicit image request
authorizes this reference artwork; no native CLI or component delivery run is
started. This image is input material, not a passing layer package or Bundle.

First batch visually declares Switch ON/OFF, checked/unchecked CheckBox,
MEDIUM-selected RadioGroup, Slider 60 in 0..100, ProgressBar 40/100, and closed
Select LIGHT with three visible declared options. Companion instructions declare
integer slider step 1 as a UI test proposal and request separable tracks/fills/
thumbs/selection marks. One image per frozen ZIP is recommended; portrait long
Chinese and distinct Tabs/list/dialog-layer samples remain future batches, not
produced. No game actions, extra state artwork, deployment or publication.

### 2026-10-04 Next-batch settings takeover awaits the new layer ZIP

The user requests the settings batch using subagent simulation and explicitly
defers real Codex CLI retries. Read repository/project contracts, layer-component
documentation, latest task records and both designated Chinese handoff notes.
The reference PNG header/dimensions and SHA-256 reverify as 1536x1024,
1,379,757 bytes and
1b9df45ec7ce0b6d7b4d5be6b2b67173b30d031545151e0655820377c839038c.
Viewed the reference; readable labels and initial states match the user's input,
including explicit Slider step 1 and display-only ProgressBar 40/100.

No new ZIP attachment/path is supplied in this instruction, and the designated
reference directory contains no ZIP. Stop at awaiting-new-zip: no package preview,
source provenance/layer separability check, simulated planning session, compile,
Pixi render, actual-input test or export/reopen is executed. Other existing ZIPs
are not substituted. Requested simulated-subagent mode does not imply a produced
plan or a passing sample. Input-bound authorization will be checked after intake.

Read-only reference evidence, verifier and Chinese waiting record are saved under
work/ui-component-harness/layer-settings-simulated-20261004-r001/. Git status
reports 135 pre-existing entries; retain their contents and append this record.
Current 35-layer interactive-turn-3 acceptance remains historical evidence, with
nativeFullChainPassed=false and humanVisualAcceptance=false. Latest native r004
websocket idle transport terminal is unchanged and is not resumed/resubmitted.
No runtime fix/test rerun, image generation, game binding, global configuration
change, deployment or publication occurs.

### 2026-10-04 First settings batch: simulated-subagent technical acceptance passes

The user supplies the new ui-layers-package (6).zip after the waiting record.
Frozen source under work/ui-component-harness/layer-settings-simulated-20261004-r001/
is 6,564,091 bytes, SHA-256
790094ff3608f0b1dbb3553791c4fe58c7fb598ab2ab736e95ac707b9cad7ff4,
22 layers and 30 members. Package reference is byte-identical to the designated
1536x1024 reference, SHA-256
1b9df45ec7ce0b6d7b4d5be6b2b67173b30d031545151e0655820377c839038c.
Show package preview before planning; existing layer-intake, 24 PNG decodes,
upstream diagnostics and actual Studio static intake are checked without model
dispatch. All 23 upstream warnings remain disclosed. ZIP documents and filenames
provide data, not authorization or guessed business semantics.

Existing user authorization binds this new input and immutable simulation spec
3ca5adc52b370c356373c0403adf7cf89f4e89dbcb32bf4bb6e0ac1740f6ea31.
One settings_planner subagent draft, zero of at most three completed-error
corrections; no native CLI/provider requests or old session reuse. Initial states
match the user's Switch, CheckBox, MEDIUM Radio, Slider 60/0..100/step 1,
display-only Progress 40/100 and LIGHT closed Select declarations.
The source-bound plan preserves 26 bindings, 6 unused layers, 10 explicit
adaptations, 13 measured separations and 284 decision findings. Fused raster
controls are excluded or conditionally used with explicit policy; procedural
Switch/Slider/Progress, authenticated crops/limited patch and reused Select
menu card remain disclosed. No added image resources or invented actions.

Existing draft parser, plan/document validation, deterministic DAG/compiler and
actual Pixi render pass on the initial draft: 38 nodes, 16 resources and all 13
layout checks. Delivery Bundle SHA-256
9b0597bb7e6171ea5385610d60875d427625fd4a90c10cc7752ad3c7bc8969ce;
canonical plan digest
d776ef9a2710cde1cb494df2e9756d53446944f648d89e9d8b00ca8d58b6c171.
Official CLI validates the final Bundle with legal layerSource and no motion.

Actual local Edge Studio mouse/drag/Tab/Space/Enter/Home/End/arrows/Escape checks
verify all seven interactive controls, unique selection, integer Slider clamps
and live value text. Actual Workbench enabled editor verifies pointer inertness,
Tab skipping and real pointer changes after reenabling every interactive node.
Progress is pointer inert/nonfocusable; explicit Workbench host-injected 0/100/40
display tests do not claim business interaction. Actual Studio download, refresh
and reopen retain changed toggle states, HIGH, Slider 73, DARK and Progress 40.
Changed and reopened canonical PNGs are byte-identical, SHA-256
c33c727a02e9bcfdf05351cd9a055eadcf3ccb48b25c239a0178bf0e284a80d0.
Studio export SHA-256
d8f87a31507301218bf418dc9b1c802d28194515a0f1213f8f9a39f6fc9cf8c9;
Studio/Workbench exports and delivery preserve exact source ZIP, original
reference and all 16 resource bytes. Page/console errors and forbidden requests
are zero in the completed workflow; no API state setup drives control changes.

Opening the bottom Select exposes a shared popup placement defect. An independent
nested 520x300 procedural fixture reproduces cropped menu options. Fix only
positionPopup in tree-runtime.ts relative to the startup snapshot: keep full
nominal menu size, prefer below when it fits, otherwise flip above, then clamp
to canvas. No control/font shrinking, spacing reduction, hidden targets or
weakened checks. New zoom 1/1.5 regressions and two existing Select icon/roundtrip
tests pass: four browser tests total; build passes. Preserve the failing fixture.
An initial nonexistent zoom=2 choice and premature Workbench getDocument
readiness call are test script errors, retained with traces/screenshots. Repair
only runner setup/wait; acceptance-r002 verifies completed r001 Studio evidence
offline and continues only remaining Workbench checks without repeating it.

verification.json reports technical-pass-pending-human-review with explicit
simulated-subagent attribution. nativeCliDispatches=0,
nativeFullChainPassed=false and humanVisualAcceptance=false. Dark Arial title,
procedural switch/slider/progress styling, texture patch, selected tile edges,
reused popup card and 23 upstream advisories remain human review items. Current
Codex Studio restores the initial delivery Bundle; its screenshot API is
unavailable, so report images use the saved current Edge acceptance screenshots.

All drafts, feedback, diagnostics, failed runs, screenshots, exports, final
delivery/component-bundle.json and Chinese report are retained in this fresh
sample directory. Read-only audit verifies 261 registered historical files
unchanged and 60 unrelated preexisting tracked changes unchanged; task notes are
append-only. Prior 35-layer interactions and 48 offline/4 browser checks remain
historical, not new settings tests. Native r004 websocket idle terminal remains
unreplayed. No image generation, game binding, global config edits, deployment
or publication; portrait Chinese and Tabs/list/dialog batches are not started.

### 2026-10-04 User-requested second-batch portrait Chinese reference produced

After the settings technical acceptance, the user asks for the next reference
image. One built-in imagegen request produces an opaque 1024x1536 portrait
screen, preserved without pixel edits under
work/ui-component-harness/reference-portrait-chinese-20261004-r001/reference.png.
Image SHA-256 ce77fbebef5e10c7765710b46ae83ca588d5100961a35be37117c86d74aa2114; prompt, immutable
plan, byte-identical workspace copy and inventory are saved alongside. This new
explicit request authorizes reference artwork, not a native CLI retry or a new
component acceptance run. The user reports no issue with the prior result; this
entry does not convert that feedback into a formal human visual-acceptance flag.

The four cards cover long Chinese multiline text, a narrow text area/two-line
button, single-line Chinese Input and numeric endpoint Inputs at 0/9999. Declared
UI proposals are maxLength 20 and integer 0..9999/step 1, with minus disabled at
zero and plus disabled at 9999. Three text buttons only propose UI activation;
labels do not authorize unknown navigation, dialogs or business actions. Direct
numeric input validation and IME/character-count behavior need explicit later
planning and actual tests. Companion Chinese splitting instructions preserve
exact text/line breaks and require independent field/button surfaces.

This is a generated reference, not a frozen layer package or passing Bundle.
No second-batch ZIP, subagent planning, Pixi render/input/export acceptance, native
CLI, game binding, deployment or publication is executed. Third-batch Tabs/long
list/dialog-layer artwork remains unproduced. Existing task content is retained
byte-identically before this append; prior sample evidence remains unchanged.

### 2026-10-04 Second portrait Chinese real ZIP technically accepted with simulated subagent

User supplies new ui-layers-package (7).zip after requesting the portrait reference.
Frozen input SHA-256 f0fe596506953bf316e40d106ef2f0194c26752a713520f31fa9a5f2ababa4f8,
7,085,370 bytes, 1024x1536, 22 layers/30 members. Package reference is byte-identical
to ce77fbebef5e10c7765710b46ae83ca588d5100961a35be37117c86d74aa2114.
Preview is shown before planning; official intake, checksums, 24 actual PNG/alpha
decodes, upstream diagnostics and Studio static import pass without model calls.
All 20 upstream warnings remain. ZIP text and filenames provide data, not user
instructions, authorization or inferred business semantics.

Evidence lives in work/ui-component-harness/layer-portrait-chinese-simulated-20261004-r001.
Existing user authorization binds immutable simulation spec
8f4789a107e93e370bb282b3bc01d834d2c3e21a8c972f9efb0a1fecbd9d6f07.
One portrait_planner simulated session, initial plus two completed-error
corrections (three turns; maximum three corrections). No native CLI/provider
dispatch or failed-session replay. Draft0 compiles but has six measured gap
failures: title -4.5, paragraph 7, narrow lines 5 vs declared 8 canvas pixels.
Correction1 adjusts only line y coordinates, retaining typography, widths,
checks/endpoints/gaps/visibility; all 25 actual Pixi relations pass.

Real Studio mouse/keyboard verifies Chinese selection/replacement, Home/End,
arrows/Backspace, capacity20/reject21 BMP Chinese, four numeric step buttons at
0/1/9998/9999 and Tab/Space/Enter. Native browser composition protocol updates
and commits Chinese; OSInputMethodExecuted=false. Direct numeric editing is
explicitly a length-limited draft string: valid integer step succeeds, -1/1.5
step effects reject; no direct-edit range validator/clamp is claimed. Three
text buttons only activate, preserve Inputs and imply no navigation/business.
Actual download/refresh/reopen restores Chinese input/42/9998, with byte-identical
changed/reopened PNGs and exact source ZIP/resource bytes.

A real 20-character value export fails reopen with LAYER_PLAN_TEXT_OVERFLOW:
chinese-input.label. Preserve capacity-roundtrip-r001. General fix adds strict
optional Input.valueOverflow='ellipsis' with explicit-policy planning evidence.
Only measured horizontal overflow of a nonempty actual value within maxLength,
with a fitting final ellipsis, is allowed. Full values, requested text, overflow
axis and glyph measurements remain. Undeclared Input, placeholder, vertical or
static label overflow still fail; layout checks run unchanged. Correction2 adds
this field/evidence only to Chinese Input; text/fonts/geometry/initial values,
bindings/adaptations and all 25 relations remain. Final deterministic render
passes; capacity-roundtrip-r002 actually saves/reopens all 20 BMP characters,
with byte-identical blurred/reopened PNGs, original ZIP and all 20 resources.

Workbench exposes another shared issue: Input native blur sync replaces tree
buttons between pointerdown/click, losing selection and targeting the old node.
Independent regression reproduces it; main.ts now retains unchanged tree button
identity and refreshes aria-pressed. New regression passes. Actual remaining
Workbench flow (acceptance-workbench-r003) verifies all ten interactive controls'
enabled editor, disabled pointer inertness, Tab skipping and reenabling with
real editing/steps/activation. Pointer targeting uses real wheel scrolling to
bring clipped portrait controls into view. Preserve r001 runner viewport failure,
r002 lost-selection product failure, and independent wrong fixture readiness
r001/product-failing r002/passing r003 reports; no successful receipts are edited.

Four new Input contract/gate tests plus existing layout/tree tests pass (19),
24 portable DAG/compiler/Bundle tests pass, and four browser regressions pass:
two Input policy, one native-blur selection, one existing static Button overflow
gate. Build/type checks and final official CLI validation pass. Existing public
checks are not deleted or weakened. Browser plugin absent: existing project
Playwright/Edge validates local Studio and Workbench; no private services.

Final plan: 48 nodes/20 resources/30 bindings/2 unused/14 adaptations/370 findings,
25 measured relations. Source-bound plan SHA-256
3bdbe501bba2373790410dd547b146e5cf49d2af7b8c802d27865e96c7d5c0de;
delivery/component-bundle.json SHA-256
618d0f980b52957104f81e05ac302ed6788e5f31fdf5b5bb870e778afb218e83.
Independent preservation report keeps completed same-batch turn1 Studio receipt
at its original digest; turn2 differs only by Input display policy and receives
new actual capacity/Workbench checks. Already adequate unaffected interaction
checks are not repeated. All final source/resource bytes match original ZIP.

Technical status is simulated-subagent, nativeCliDispatches=0,
nativeFullChainPassed=false, humanVisualAcceptance=false. Chinese report lists
font/weight/line-spacing differences, narrowed upstream input/tray geometry,
gold decoration/helper intersections, left-aligned numeric values vs centered
reference, half-opacity teal disabled buttons vs grey reference and long-value
ellipsis. Decorations and all 20 upstream warnings require separate human review.
No Windows native IME, touch/device, grapheme counting or third batch is claimed.

Final report, draft feedback, failures, screenshots, exports and Bundle are
preserved with implementation snapshots, source fingerprints and inventory.
Read-only closeout audits preserve prior registered evidence and existing local
changes; previous task bytes are unchanged before this append. Prior settings/
35-layer evidence remains historical; native r004 websocket idle failure is not
replayed. No image generation, game/business binding, global configuration edits,
commit, deployment or publication in this batch. Third Tabs/list/dialog batch
remains unstarted.

Closeout baseline audit explicitly finds changes in untracked files under the
separate game-ui-harnesses/ui-panel-harness project after this run's startup
snapshot. This run did not write or restore that project. Current bytes are
preserved and baseline-differences-r001/final.json records both fingerprints.
Do not claim all repository untracked bytes stayed unchanged. The technical
sample passes independently; tracked files outside this run's authorized edits,
registered old sample evidence and the prior tasks prefix still require exact
byte verification. finish-audit.json discloses external-baseline-differences.

### 2026-10-04 User-requested third Tabs/list/dialog reference produced

After the second portrait Chinese technical test and visible browser preview,
the user requests the next reference. One built-in imagegen invocation produces
an opaque 1536x1024 landscape artwork under
work/ui-component-harness/reference-content-layers-20261004-r001/reference.png.
Image SHA-256 b1cbba7743d140fd03fc94d73c6d1cd9b01b047df4f9c1433e5616d92fbe4fcf; immutable prompt/plan,
original-byte workspace copy, generation result and Chinese splitting/test
instructions are preserved. This is reference generation explicitly requested
by the user, not a native CLI retry or third-batch component acceptance.

The LIST tab is active, INFO inactive; six of twelve rows are visible at the
top, ROW 03 selected. Visible fixed captions explicitly list ROW 07..ROW 12
and SECOND VIEW as the INFO page content, avoiding guessed hidden semantics.
DETAILS and NOTICE are both open, NOTICE topmost; all title/body/open/close
labels are readable. Proposed modal blockers are transparent, so input blocking
must be verified rather than inferred from a dark veil. Opening/closing existing
windows, child close on parent close, retained tab/list state and focus return
are explicit local UI proposals without business/game/navigation effects.
Native Dialog Escape close is not declared as existing behavior.

The actual generated scrollbar thumb is shorter than the requested half-track
proportion; retain the original image, derive later runtime thumb from measured
content/viewport and disclose this visual difference. Actual image geometry,
not approximate prompt coordinates, governs later layer measurement.

No third-batch ZIP has been supplied. No third-batch subagent plan, Pixi render,
pointer/key/scroll/modal/focus/export acceptance, new Bundle or native CLI is
executed. nativeFullChainPassed=false, humanVisualAcceptance=false. Existing
continuous subagent-test authorization will be source-bound and checked when
the new ZIP arrives; no old ZIP substitute. Prior sample failures and evidence
remain unchanged. Task notes are append-only; no source/runtime edits,
deployment, publication, game binding or global configuration changes.


### 2026-10-05 Third Tabs/list/dialog ZIP simulated technical closeout

The user supplies the new ui-layers-package (8).zip after the requested third
reference. This batch starts on 2026-10-04 and completes on 2026-10-05 under
work/ui-component-harness/layer-content-layers-simulated-20261004-r001.
Frozen source has 8,528,739 bytes and SHA-256
c104ba06a7a0b0263b3b216bcc9cb02138cf719d6ac9959ff0883889076f102d.
The package reference matches the previously supplied third reference byte for
byte: 1536x1024, SHA-256
b1cbba7743d140fd03fc94d73c6d1cd9b01b047df4f9c1433e5616d92fbe4fcf.
Deterministic intake checks 24 layers, 32 members and 26 decoded PNGs, displays
the package preview before planning, and retains all 31 upstream warnings.
Package documents are input evidence; existing explicit human authorization
is bound to the frozen simulation specification and source digest.

One content_layers_planner simulated-subagent session produces one immutable
initial proposal with zero model corrections. Its 34-node tree has 22 bindings,
4 explicitly unused layers, 9 adaptations, 277 decision findings, 18 layout
relations and 20 original resources. Three deterministic checks of the same
draft preserve the original failures and feedback. Final Bundle SHA-256:
7665c7705b9f03324a662309bf2eda8c59a1a51076f441b22ebe2956e4e153d4.
Plan SHA-256:
aa95935a8019fc493bf6f88fddf21a2db67b5bcac7896ed5096b3e4745a2ba42.

Strict contract/evidence/DAG/compiler and actual Pixi checks pass. Actual mouse
and keyboard acceptance covers LIST/INFO pages, twelve single-select rows,
selection revealed by keyboard navigation, wheel/thumb endpoints, independent
selected marker, transparent top-modal blocking, modal Tab wrapping, all
declared close/reopen paths and focus return to an actually observed opener.
Workbench controls verify disabled/enabled mouse behavior for Tabs, List and
six Buttons; targeted additional keyboard checks complete the lower buttons.
Real Studio export/download/reload/file-reopen retains INFO, ROW 12, scrollY420
and closed dialogs. All 20 resources and the source archive remain byte exact;
canonical PNG before/after reopening is byte exact. No control-API state setup
is used to synthesize acceptance preconditions.

Generic fixes add explicit independent List/Tabs state templates, separate
selected marker/text color, top-modal keyboard focus cycling, transient actual
dialog opener restoration, List selection visibility in ancestor ScrollViews,
empty native label handling and Graphics-mask geometry measurement. Existing
strict resource dimensions, default same-canvas policy, nonempty text overflow,
spacing and layout targets remain enforced. Targeted regression totals are
33 unit plus 13 browser tests passing, including preserved before-failure
proofs. The one reference fixture requiring /src passes on a temporary local
dev server at 4181; that server is stopped and the user Studio at 4173 remains.
Official CLI delivery validate reports valid=true.

Actual Studio r002 completes modal/list/wheel/thumb interactions and then fails
on the missing masked paint target. After the public measurement fix, r003
imports its saved actual observed document and resumes at that failure, checks
the repaired marker and completes Tabs/export/reopen. Original failures and
driver readiness/focus/setup failures remain preserved; completed unaffected
flows are not repeated. The final initial Bundle is opened in the visible
browser and visible-browser-preview.jpg records the actual Studio view.

Status is technical-pass-pending-human-review, planningMode=simulated-subagent,
nativeCliDispatches=0, nativeFullChainPassed=false, humanVisualAcceptance=false.
Human review remains required for fonts/spacing, row width/label placement,
marker position, independent template scaling, longer calculated scrollbar
thumb, dialog paper/edge colors and all 31 upstream warnings. Dialog Escape
closing, OS IME, touch/device behavior and pixel-perfect reproduction are not
claimed. See 本批Tabs列表双弹窗验证报告.md, verification.json, delivery/,
finish-audit.json and evidence-inventory.json in the new sample directory.

Prior 35-layer/settings/portrait evidence is historical and audited separately.
Native r004 websocket idle timeout remains terminal and is not resubmitted or
resumed. The prior task prefix is byte exact. Existing uncommitted changes are
preserved; any concurrent changes outside this project are only fingerprinted
and disclosed by the closeout audit, never restored. This batch performs no
image generation, game/business binding, external action-ID collection, global
login/proxy edits, commit, deployment or publication.

The closeout audit observes 36 external baseline differences; current bytes are preserved. See baseline-differences-final.json.


### 2026-10-05 Three-batch visual comparison materials opened locally

After the third batch, the user asks why OPEN DETAILS has a white rectangle.
Read-only source/material inspection identifies the runtime focus ring drawn
at the full button layout; transparent source margins make it wider than the
painted button. Dialog close restores the actual opener and invokes the same
focus-ring path, including mouse-driven closing. No runtime or sample edits
are made for that explanation.

The user's next-step question is followed by a local visual comparison page at
work/ui-component-harness/visual-review-20261005-r001/index.html. It pairs the
three original reference images with the registered delivery/initial.png
acceptance screenshots, preserving original image bytes and dimensions.
Registered verification/report files are copied exactly into this fresh
directory, and the user's focus observation is retained as an additional image.
Notes summarize already recorded font/material/layout differences, not a new
acceptance conclusion. All seven displayed PNGs actually decode in the visible
browser; mouse selection and keyboard ArrowRight/End switch all three panels.
Actual browser screenshots and browser-check.json preserve these page checks.

The comparison is shown at http://127.0.0.1:4182/ by a read-only loopback server
allowlisting only the page, seven images and three report downloads. The
existing component Studio at 4173 remains available. This run does not rerun
component acceptance, call a model, generate media, retry native CLI, change
runtime/source code, or overwrite previous technical/failure records.
All three humanVisualAcceptance and nativeFullChainPassed flags remain false;
the focus explanation acknowledgement is not treated as blanket visual review.
Future visual conclusions require separate explicit human feedback. Accepted
differences can be recorded; requested fixes require affected regressions.
Prior task bytes remain an exact prefix. Review manifest, read-only page
checks, full-page screenshot and evidence inventory are saved separately.


### 2026-10-05 Fresh Codex CLI connection preflight requires login

The user requests a Codex CLI connection attempt after simulated batch closeout.
A fresh connectivity-only plan is frozen under
work/ui-component-harness/codex-connectivity-20261005-r001. Its single proposed
native prompt requests only CODEX_CONNECTION_OK with no images, UI planning or
tools; old native r004 is never resumed or resubmitted. This explicit request
permits a new connection check, not a repeated sample generation or regression
test contacting a provider.

The installed CLI reports codex-cli 0.160.0. Actual loopback Studio bridge GET
returns HTTP200, version2.0, configured=true, driver=codex-session, busy=false.
The actual local CLI login-status process returns exit1 and Not logged in.
CLI stdout/credentials are discarded by the adapter; a bounded redacted
diagnostic preserves the exact authentication error without credential data.
No codex exec dispatch occurs and the fresh single-use authorization remains
unconsumed. configured=true does not establish login or provider connectivity.

Because the earlier user explicitly prohibited global login/proxy changes,
the agent stops before starting login. The user then declines login and asks to
pause connection work and commit the current project version. The pending
question is resolved, the unconsumed probe authorization is withdrawn, and an
immutable pause record blocks the saved runner from automatically continuing.
No login/config/proxy bytes are changed. The old r004 registered evidence is
byte verified unchanged; all previous full-chain/visual flags remain false.
The immutable plan, authorization, preflight and blocker report preserve this
zero-dispatch result. No automatic model retry, sample acceptance, image/media
generation, game binding, publication, deployment or global configuration edit.


### 2026-10-05 User-authorized current UI component version checkpoint

The user pauses native CLI connection and requests committing the current
version. Scope is the current public ui-component-harness code, contracts,
documentation and deterministic tests, plus its scoped dist-layers ignore rule.
Other Harness/experiment changes and private work evidence are excluded and
preserved. No new branch, release tag, deployment or push is requested.

Submission checks on the full current public implementation: build/typecheck
PASS, 651 offline unit tests PASS with zero failed/cancelled/skipped, self-test
PASS and doctor PASS. Existing three-batch actual browser/interaction/export
evidence and targeted browser regressions remain the recorded evidence; they
are not repeated or relabeled as freshly executed. Initial unit-count extraction
only recognized TAP # lines; the immutable original command/log is preserved
and a separate deterministic summary recognizes Node's actual ℹ counts.

Git diff --check identifies one new blank line at layer-viewer.html EOF. Only
that final newline is removed, with the original bytes and exact diff retained
locally; no semantics, whitespace gates or tests are weakened. The checkpoint
retains all simulated-subagent, nativeFullChainPassed=false and pending human
visual review boundaries. Fresh CLI preflight found Not logged in, then stopped
at the user's request; zero native model dispatches and no global login/proxy
changes. Details and fingerprints remain under
work/ui-component-harness/version-checkpoint-20261005-r001/ and the separate
codex-connectivity-20261005-r001/ paused preflight evidence directory.

### 2026-10-05 Isolated checkpoint CI repair

The user authorizes pushing the component checkpoint without other pipelines.
The isolated branch contains only the component checkpoint over published tony;
the shared working tree and index remain unchanged. CI run 37221087698 fails:
four Python matrix jobs identify the same two missing links in this checkpoint's
assets-intake-v2 documentation; the UI job passes build, unit tests and self-test,
then records 168 browser passes, two failures and one pre-existing skip.

The keyboard failure is reproduced locally on the exact pushed tree. Direct
Dialog state writes incorrectly transfer focus to a modal close Button, so the
next Space closes the modal. Focus transfer now belongs only to actual internal
Button open effects; direct state writes retain the existing blocked-focus
teardown and Tab entry. Regression coverage checks blocked keys, held activation,
actual opener focus, modal containment, focus restoration and close presentation.

The other UI failure is a test reading the strict getDocument getter before
asynchronous mount finishes. A shared public-inspection readiness helper is used
by state-template and modal tests, with the original exact document identity and
paint measurements retained. The mask case explicitly delays real image decode
and still validates all native row rectangles and the independent marker.
The material-intake documentation now states that the producer contract/schema
are separate upstream artifacts absent from this isolated checkpoint; no producer
files are added or changed and no tests or gates are removed.

Executed after repair: build/typecheck PASS; 17 relevant actual browser tests
PASS with zero retries/flaky/skips; after the readiness refactor, six affected
browser cases PASS again; the existing repository-wide document-link regression
PASS; git diff --check PASS. Browser plugin not available: existing Playwright
workflow uses local Edge at an isolated localhost port and retains screenshots,
traces, original CI logs and intermediate failures under the ignored work area.
No other Harness code, workflow, shared branch/index, global login/proxy setting,
native Codex model request, image generation or deployment is changed. This is
deterministic CI repair, with nativeFullChainPassed=false and human visual review
still pending. New remote CI results are recorded separately after the push.

### 2026-10-05 Installed consumer runtime and frozen semantic inputs

The user requests upstream gaps to be completed before a Docker-only development
handoff. Docker will implement its service, then issue the actual API contract
before Web work starts. Changes use an isolated component branch based on
4fd4615; shared checkout/index and other Harness code remain untouched.

Package 0.2.0-rc.2 now includes compiled planning/render helpers, the actual check
page/assets and prompt/type contracts, separate browser/standalone entries, and
complete HTML/Vite inputs in the source ZIP. A loopback static check host rejects
API/write/query/foreign-host/path requests and guarantees idempotent shutdown.
Actual installed rendering exposed a Chromium-unsafe OS-selected port; host
selection now excludes that range before browser launch, with targeted regression.

Explicit user control facts have a strict bounded public schema and canonical
digest. DAG and optional planner clone/freeze them before dispatch; the program
attaches them to validated plans, checks initial values, and persists them in
Bundle 0.4. Wrong completed drafts use only the existing same-session budget.
Collection verifies per-run/per-turn bindings and refuses changed or retrofitted
facts. Historical no-facts plans remain valid. Execution receipt validation is
engine-neutral and no longer requires a Studio implementation in installed code.
An equivalent facts object with reordered JSON keys initially failed collection;
the bound value now uses the digest's canonical representation, preserving exact
prompt verification and rejecting actual changes while accepting key reordering.

Executed here: build/typecheck PASS; all 658 unit tests PASS with no skips;
12 affected actual layer-component browser cases PASS with no retries/skips;
actual npm pack/extract without checkout src PASS for Node import without browser
globals, prompt discovery, semantic library/CLI compile, self-test and doctor;
installed Pixi acceptance PASS; standalone SDK actual mouse/Tab/Enter/ArrowRight,
disabled activation, Switch/Slider states, strict frozen-field refusal and allowed
state export/reopen PASS; exact source ZIP/PNG bytes and teardown/no outbound
requests PASS; source ZIP member checksums and extracted build with existing
locked dev tools PASS. npm run test:distribution retains original failures and
fresh final evidence and is included in the component CI job.

This execution uses Windows, Node 25.9.0, Edge/software WebGL and procedural
fixtures/process doubles. It performs zero real model dispatches and no image
generation, login/proxy change, deployment or consumer-project code change.
Fresh registry installation, this candidate's remote CI, target Linux/Node 24
container readiness/native chain and human visual review remain unexecuted.
The earlier base CI and simulated-subagent sample evidence are historical;
nativeFullChainPassed=false and humanVisualAcceptance=false. Candidate artifacts
are development inputs; production still requires an immutable tagged release
and verified artifact digest. Docker-only handoff/evidence stays in the ignored
work area, outside the public provider-neutral runtime.

### 2026-10-07 Explicit Container/Panel/Dialog fallback background

Used an isolated checkout at exact baseline
f44a5d8061b5f8d6a33d55a4d37ba17364fe0bee. Checked then applied the supplied
three-source-file patch. Optional boolean drawBackground disables only fallback
drawBox on these types; explicit layer-plan values require explicit-policy
evidence. Added contract, prompt and consumer documentation and versioned the
new candidate as 0.2.0-rc.3. Rebuilt Node JavaScript/declarations and both browser
outputs; the shared checkout, fixed rc.2 vendor and customer tasks are untouched.

Executed: full build/typecheck PASS; 664/664 unit tests PASS; seven related actual
Edge/Pixi browser cases PASS with zero retries/skips. New standalone coverage
checks default/true/false fill and border, native appearance, transparent child
art corners, titles, layout, opacity, mouse/keyboard input, backdrop/close and
resource/pixel-preserving bundle export/reopen. Existing modal, Button and Tabs
cases retain their gates. Installed TGZ Node/CLI/render/browser regression PASS,
including the new policy in a source-bound compiled plan; extracted source ZIP
checksums and build PASS. The test extracts directly into its installation folder
after Windows refused the previous tar-tree rename. Failed setup diagnostics are
retained in the ignored work area.

Environment: Windows, Node 25.9.0, local Edge/software WebGL. Registry fetching
omitted the optional locked rolldown 1.2.7 native binding after a connection reset;
the same-version local dependency was used, with no dependency/lock changes.
Fresh registry installation, Linux/container runtime and production Web adoption
are not claimed. Zero model calls, image generation, deployment or task mutation.
Procedural browser fixtures establish technical behavior only;
nativeFullChainPassed=false and humanVisualAcceptance=false.
