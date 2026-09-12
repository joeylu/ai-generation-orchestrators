# Parallel sample preflight and main CLI integration — 2026-09-12

Main `ai-ui-stateful` now integrates Slider, ProgressBar and Dialog acceptance,
native unequal Tabs rectangles/per-item state bases/hit areas, and Button direct
Image children. Legacy equal-width Tabs remain supported. Image children have
independent resource/pixel/alpha evidence and real pixel/geometry checks under
the parent's press transform; their alpha masks cover background pixels, rather
than silently excluding their whole rectangles.

Two real runtime defects were reproduced with local fixtures: Dialog header
covered the clickable Close button; clearing keyboard focus on pointer-down
left its ring in the rendered frame. Header now paints below children. The
concurrent task's pointer-focus/capture logic was retained, adding an immediate
render after focus removal. No screenshot-only refresh or relaxed threshold was
introduced. Earlier failed receipts and diagnostics remain unchanged.

Validation against the current working tree:

- Component TypeScript/static build passed.
- Full decomposition suite with `STATEFUL_BROWSER_TESTS=1`: **163 tests passed**
  in 55.307 seconds, including official CLI import and actual PixiJS cases.
- Native Tabs main CLI tests passed with 368/276/275px bases and 9px gaps.
- `git diff --check` passed; branch remained `tony`; nothing was committed.

Full log: `work/ui-decomposition/parallel-main-full-tests-20260912-r001.log`.
Build log: `work/ui-decomposition/stateful-main-component-build-20260912-r001.log`.
Successful main-CLI layered Button/Dialog fixture evidence:
`work/ui-decomposition/reward-dialog-fullchain-20260912-r001/main-acceptance-child-images-r001`.
These are fixture results, not generated sample acceptance.

## Frozen proposals — generation not authorized

Verified summary:
`work/ui-decomposition/parallel-generation-20260912-r001/confirmation.json`.
Proposal digest:
`d8136672035722d104c0832eb461800f102a78d8f024f75039116a2b7a91692a`.

| Sample | Frozen run | New calls | Immutable plan digest |
|---|---|---:|---|
| Inventory/shop | inventory-shop-r002 | 24 | a9e5157c07aca24ee867ac7a7c7e8f2faff8a6d97a1d8f6e4686647a775b2f66 |
| Battle HUD | battle-hud-r003 | 39 | c853bbe65bf9081ec4cb66732cfbec86fb608ba3e882dd401963433272f3aa1f |
| Reward dialog | reward-dialog-r001 | 15 | 68fc04cdf95be4074417c1bc599f41c8828b56c951449ae2c7bf70f28398cb8d |

Inventory's unexecuted earlier proposal is preserved. Native List intervals are
now 109px (104px painted row plus 5px gap), six intervals total 654px in a 649px
viewport: only 5px known overflow, with no invented extra items. HUD takes the
observed 70% Slider text as semantics and derives its thumb position from track
endpoints; the painted reference thumb is inconsistent with 70%. Differences
remain explicit proposal limitations.

Maximum calls: 78; automatic retries: zero. No generation/private service was
invoked. None of the three real samples has a new delivery ZIP or real-art
browser acceptance. Generate only after fresh authorization bound to these
plans. Every draft remains `human_visual_acceptance: false`.

## Authorised parallel execution — stopped at native Alpha gates

The user subsequently authorised the three frozen proposals and explicitly
requested parallel subagents. Inventory ran in the parent task, Battle HUD and
Reward Dialog in separate subagents. Actual generation calls: Inventory 3,
HUD 2, Reward 2. Officially received assets: Inventory scene and active tab,
HUD scene, Reward scene. Each next isolated component returned RGB with a
painted checkerboard and was rejected by `TRANSPARENT_RESULT_REQUIRED`.
All three stopped; no generation retries or automatic resubmissions occurred.
Failed request records and result files remain intact. No complete delivery ZIP
or real-sample browser acceptance was produced. Human visual acceptance is false.

The local 163-test pass above remains a fixture result. It does not certify these
unfinished generated samples. The gate correctly rejected opaque components;
it was not weakened to accommodate generator output.

New explicit fixed-#F808F8 proposals are being frozen into separate runs, using
official result-binding/reuse-result only for successfully received sources.
They require a fresh compute decision because output modes and plan digests
change. The previous proposal and authorisation are not rewritten or transferred.
