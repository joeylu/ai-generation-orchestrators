# Installed component runtime

This contract covers local, offline consumer integration. It does not implement
an account system, job service, public network route or deployment workflow.
Install an immutable tagged release by its artifact SHA-256. Package version
`0.2.0-rc.2` alone is not a release identity or native compute acceptance.

## Entries

- `ai-ui-component-harness`: engine-neutral validation and compilation. No
  browser globals or Pixi imports are needed to import this entry.
- `ai-ui-component-harness/browser`: typed browser-only `createTreePreview`,
  `validateBundle`, `bundleResources` and their interfaces.
- `ai-ui-component-harness/browser/standalone`: the same browser API, bundled
  with this release's Pixi version. It does not reuse a host application's Pixi
  instance. Load it only in a browser lifecycle.
- `ai-ui-component-harness/render`: `startLayerRenderServer` and
  `checkLayerPlanRender`. The static host binds an ephemeral loopback port,
  serves only the built check entry/assets, and exposes no API middleware.
- `ai-ui-component-harness/planning`: optional `createCodexLayerPlanner`,
  deterministic `collectCodexLayerPlan`, error type and fixed correction limits.
  Importing it never checks login or dispatches a model.

The consumer must explicitly install matching optional peer `playwright@1.63.0`
and provision its Chromium before calling render/planning. The deterministic
Node entry and CLI require no browser. Missing rendering infrastructure is a
failure, never grounds to skip acceptance. Node >=22.18 is required; CI uses 24.
CLI setup, authentication and compute authorization remain operator-owned.

```js
import { intakeLayerComponents, compileLayerComponents, validateBundle }
  from 'ai-ui-component-harness';
import { startLayerRenderServer, checkLayerPlanRender }
  from 'ai-ui-component-harness/render';

const intake = await intakeLayerComponents(archiveBytes); // no model
const bundle = await compileLayerComponents(archiveBytes, explicitPlan);
await validateBundle(bundle);
const host = await startLayerRenderServer();
try {
  const report = await checkLayerPlanRender(bundle, {
    origin: host.origin, folder: freshEvidenceDirectory, signal,
  });
  // Independently inspect report.status/code/coverage before publishing a draft.
} finally { await host.close(); }
```

`checkLayerPlanRender` measures actual layout/text and verifies declared Button
effects with real pointer input. It does not certify all supported control types,
keyboard behavior, exports, or human visual review. Consumers still perform the
sample-specific acceptance matrix and export/reopen byte checks.

## Frozen user semantic inputs

`layerPlanningInput(bytes,{semanticInputs})`,
`runLayerAutoDag(bytes,callback,{semanticInputs})` and
`planner.planRun(bytes,{semanticInputs,origin,signal,onProgress})` accept:

```json
{
  "version": "1.0",
  "controls": [
    {"subject":"MUSIC","target":{"type":"Switch","label":"MUSIC"},"values":{"checked":true}},
    {"subject":"quality","target":{"type":"RadioGroup"},"values":{"optionLabels":["LOW","MEDIUM","HIGH"],"selectedLabel":"MEDIUM"}},
    {"subject":"volume","target":{"type":"Slider"},"values":{"value":60,"min":0,"max":100,"step":1}},
    {"subject":"progress","target":{"type":"ProgressBar"},"values":{"value":40,"max":100}}
  ]
}
```

Targets have a required supported type and optional exact node ID and/or visible
label/title/text. A type-only target is allowed only when the complete proposal
has exactly one matching node. Missing/ambiguous targets or mismatched values
fail deterministic validation; they are not assigned to the first matching node.
No filename semantics, selectors, commands, URLs-to-fetch, model settings or
business actions are accepted as fields. Subjects/targets are unique, maximum
64 controls, maximum 16 KiB canonical UTF-8. No state default is supplied.

Allowed keys are deliberately limited: Switch/CheckBox checked/enabled;
RadioGroup/Select/List/Tabs selectedLabel/optionLabels/enabled; Slider
value/min/max/step/enabled; ProgressBar value/max; Input
value/placeholder/inputType/readOnly/maxLength/enabled; Button label/enabled;
Text text; Panel title; Dialog title/open/modal. The normal full document
validator still owns numeric ranges, step alignment and all component contracts.
Selected labels must uniquely resolve to a declared choice. Optional labels on
targets match visible props, not resource filenames. No `Select` popup-open state
is invented: it is a runtime state, separate from initial selected props.

The program normalizes/clones input and binds SHA-256 of recursively key-sorted
JSON, UTF-8 without trailing newline. `semanticInputs={sha256,value}` is attached
to the validated plan by the program, not authored in the model proposal. An
explicit plan may carry a bound declaration created with `bindLayerSemanticInputs`.
All declared values are checked against the initial document before compilation.
Bundle 0.4 persists the original declaration and plan digest. Runtime state saves
remain governed by the existing source identity rules; initial facts are not
rewritten to claim a different original request.

The optional planner freezes `semantic-inputs.json` and its digest in run,
dispatch and result records, includes all facts in initial/correction prompts,
and verifies them before rendering. A completed wrong-value draft can use the
existing bounded same-session correction budget. Required semantics that remain
unknown, source/auth/transport/cancellation failures remain terminal.

`collectCodexLayerPlan(bytes,folder,{semanticInputs})` verifies a completed run
against its exact facts and prompts. Passing external facts is optional when
the stored facts are present; external facts must match. Changed facts, digest,
prompt, or per-turn binding fail collection. Historical runs without facts remain
readable and cannot retrospectively claim facts from a new request. Collection
starts no process and grants no compute authorization.

The local Studio HTTP request format is unchanged. Its existing archive-only
request does not implicitly add semantic facts; embedding consumers use the
above library/adapter parameters after their own review/authorization.

## Release verification

Build emits `lib`, acceptance `dist`, and self-contained `dist-browser`. npm
pack contains compiled contracts, planning/render helpers, prompt/type contract
and check page/assets. Source ZIP includes every HTML/Vite input needed to build.
Installed-package tests must omit the checkout's `src` and development server,
exercise library and CLI compilation, run real Pixi acceptance from the loopback
host, and revalidate the original ZIP and resource bytes. No test may call a real
provider. Transport/auth/session checks use process doubles with explicit evidence
labels. Technical drafts always require separate human visual review.

Run `npm run test:distribution` after installing the locked development tools.
It uses a local Python 3 executable (`UI_HARNESS_PYTHON` can select one), system
`tar`, and the already provisioned browser; it never downloads them. It builds,
packs/extracts the npm artifact without checkout `src`, compiles through its
library/CLI, runs Pixi and standalone SDK input/export checks, verifies source ZIP
checksums, and builds the extracted source with the existing locked dev tools.
This last check proves complete build inputs, not a fresh registry install.
Fresh evidence, failures included, stays in `.tmp/distribution-*`.

Runtime `setEnabled` is supported for interactive acceptance. Bundle 0.4 does not
permit changing frozen `enabled` fields in saved documents. Restore such fields
before export; allowed persisted values remain checked/selected/value, scrolling,
Tabs active state and Dialog open state. These values may differ from initial
semantic facts; the original plan and its fact digest remain unchanged.
