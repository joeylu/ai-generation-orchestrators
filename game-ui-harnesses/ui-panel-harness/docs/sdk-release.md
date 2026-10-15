# Portable Panel SDK rc.7

The distribution contains the Panel Node API, local workbench model, optional
single-invocation Codex adapter, pinned Component dependency closure, 12 owned
core icons, planning prompts and schemas, offline Pixi browser runtime, and Unity
UGUI import-kit source. Loading it does not start a service or call a model.

The contract is `release/contract.json`, version `0.1.0-rc.7`, tag
`ui-panel-harness-v0.1.0-rc.7`. Obtain the immutable tagged archive and verify its
bytes and SHA-256 against `SHA256SUMS` and `release-receipt.json`. A dirty local
working-tree package is not a published release. Earlier tags and assets retain
their original bytes. See [the rc.7 policy](sdk-rc7.md).

Extract the complete archive. No package installation, sibling checkout, Vite,
TypeScript loader, browser or network access is needed to load the Node SDK.

```js
import { loadPanelSdk } from './package/src/sdk.mjs';
const sdk = await loadPanelSdk();
const { panel, core, seed, createWorkbenchModel, planner, delivery } = sdk;
const model = await createWorkbenchModel(seed, core);
// Preparing, compiling and exporting do not invoke the optional planner.
// Call model.dispose() when finished.
```

The package exports `ai-ui-panel-harness` (pure API), `ai-ui-panel-harness/sdk`
(verified installed Node SDK) and `ai-ui-panel-harness/browser/standalone`
(self-contained ES browser module). `runtime/panel-runtime.js` exposes the same
browser API as `PanelDelivery`, version 0.1.0. Use `createPixiPanelHost`,
`validateBundle` and the returned instance's state, export and cleanup methods.
Importing the module does not mount a panel automatically.

## Current defaults

The catalog is `modern-readable-game-card-layout`, with sixteen themes at
0.33.0/0.33.1 and the complete verified builtin asset pool. PanelSpec/Bundle 0.16,
native intent 0.12 and Compiler 0.45 retain [all sixteen components](all-components.md).
The installed planner and Studio use the same production short-input prompt.

- Body and button fonts inherit 24 logical pixels; main titles inherit 32.
  Ordinary single-column panels start around 420 wide, button menus around 360.
  Explicit dimensions, typography, no-wrap, order and user exclusions take priority.
- Main titles retain their centered Panel. Related controls share one semantic
  section Panel; audio and graphics remain distinct categories. Labeled readonly
  data gets an inner Panel around the complete label and value. sectionSurface
  panel-v2 and concise-v6 retain useful headings and hide exact repeated ordinary
  data headings without deleting their data.
- Each repeated item keeps its description, values, progress and related actions
  together. Unspecified collections of complete item sections default to desktop
  or landscape composition with two or three columns. Explicit mobile, portrait
  or single-column requirements retain priority. A List is not mechanically split
  into cards. See [composition rules](card-composition-2026-10-15.md). Fixed canvases
  scale; they do not reflow at runtime.
- Broad achievement drafts include identifiable names, attainment conditions and
  progress or completion state. Proposed content is visibly sample data and is
  readonly unless actions were requested. Explicit name-only requests and existing
  content in unrelated edits are preserved. See [achievement content](achievement-draft-content-2026-10-15.md).
- Confirmations use message.text 0.2.0. Complete prose determines height; short
  prose and its action group are centered, longer paragraphs keep their left edge.
  Two choices remain ordinary independently operable buttons.
- Select, RadioGroup and List each have exactly one initial option. Explicit
  defaults are preserved; unsupported no-selection or multi-selection requests
  require clarification. Invalid output fails without automatic repair.

Saved catalogs, compiler versions, state, assets and bindings replay unchanged.
Opening a package does not migrate it. Static images use fixed PNGs or labeled
neutral placeholders; no image generation is added. See [image rows](image-slots.md).

Unity UGUI source is version 0.1.8. Use its matching runtime source files and the
candidate ES/IIFE digests. `delivery` exposes `createPanelDelivery`,
`createUnityKitFiles`, `createStoredZip`, verified runtime bytes and the six UGUI
source files. Export is deterministic and needs no Unity, model or browser process.
A per-panel manifest verifies bytes; it does not certify native Unity execution,
consumer business integration or human visual approval.

## Planner and validation

The optional planner fixes gpt-6-luna/xhigh, one invocation and zero retries.
Each call needs an absolute explicitly owned `outputRoot`, an available logged-in
CLI and fresh task-specific compute authorization enforced by the calling host.
The SDK never grants authorization or starts execution merely because it loads.
Its scoped output root permits a readonly install; the development Studio retains
its confined output rule. No external skill is loaded at runtime.

Two independently authorized finite batches made seven real calls with zero
automatic retries. Latest samples demonstrate complete achievement content,
three-column default tasks and explicitly requested single-column mobile tasks.
The earlier narrow task result remains preserved. Collection actions below the
first viewport were verified by actual scrolling; their original initial-view
records remain separate. See [the five-case batch](card-content-real-results-2026-10-15.md)
and [the target-default follow-up](card-target-real-results-2026-10-15.md).
These samples do not certify arbitrary inputs or repeated-request reliability.
Native Unity and consumer game services remain separately unverified. Fonts are
environment-provided; the SDK does not embed font files.

Build from existing local dependencies without installing or downloading:

```sh
node scripts/package-release.mjs --component-package <pinned-component.tgz> --output output/sdk-release
node scripts/check-release.mjs --package output/sdk-release/ai-ui-panel-harness-0.1.0-rc.7.zip --output output/sdk-installed-check
node scripts/check-release-browser.mjs --acceptance output/sdk-installed-check --output output/sdk-browser-check
node scripts/check-all-components-browser.mjs --review output/sdk-installed-check/all-components --output output/sdk-components-browser-check
node scripts/check-installed-compact-message-browser.mjs --acceptance output/sdk-installed-check --output output/sdk-compact-check
```

The builder verifies the Component archive before parsing, follows the required
compiled module closure, pins Pixi 8.20.1, and records licenses, file bytes and
hashes, source commit and dirty state. It never tags, uploads or publishes.
Installed acceptance uses explicit fake planner transports, real compilation,
ZIP rereading and offline browser checks. These commands make no real model call.
Use a fresh output directory after a failed acceptance.
