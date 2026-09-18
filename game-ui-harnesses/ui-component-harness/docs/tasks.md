# Implementation tasks

## 2026-09-18 CI repair

CI now prepares Chromium before Node browser-backed fixtures and builds the local
consumer for the offline Python integration matrix. The four Python matrix jobs,
dependency audit and release build passed in run 35343685393. Browser CLI paths
are resolved relative to the test module, and source-import contract probes use
the development server in CI and `npm run verify`. Motion profiles run as separate
cases with unchanged assertions and timeouts. Local baseline motion: 16 passed;
targeted follow-up and Linux CI results are recorded in
`work/ci-repair-20260918-r001/`. No provider calls or visual acceptance claims.

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
