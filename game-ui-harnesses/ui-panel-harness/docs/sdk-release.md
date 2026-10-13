# Portable Panel SDK release candidate

This independently packaged SDK contains the Panel Node API, local workbench model,
optional single-invocation Codex adapter, pinned Component dependency closure,
12 owned core icons, planning prompts/schemas, offline Pixi browser runtime,
and Unity UGUI import-kit source. It does not start a service or invoke a model.

The release contract is `release/contract.json`. Install only an immutable tagged
release after checking its archive bytes and SHA-256 against the published receipt.
The current source builds `ui-panel-harness-v0.1.0-rc.5` as a local candidate; it has not been published. Previously published tags and assets remain unchanged.
Extract the entire archive. No package install, sibling checkout, Vite, browser,
TypeScript loader, or network access is needed to load the Node SDK.

```js
import { loadPanelSdk } from './package/src/sdk.mjs';
const sdk = await loadPanelSdk();
const { panel, core, seed, createWorkbenchModel, planner, delivery } = sdk;
const model = await createWorkbenchModel(seed, core);
// Loading/preparing/compiling/exporting never calls the optional planner.
// model.dispose() when finished.
```

The package exports `ai-ui-panel-harness` (pure API), `ai-ui-panel-harness/sdk`
(checked installed Node SDK) and `ai-ui-panel-harness/browser/standalone`
(self-contained ES browser module). The offline `runtime/panel-runtime.js`
exposes the same browser API as the `PanelDelivery` global, version 0.1.0.
Use `createPixiPanelHost`, `validateBundle`, and the returned instance's state,
export and cleanup methods. Importing it does not automatically mount a panel.

The default seed uses modern-all-components 0.1.0 and the complete verified builtin asset
pool. [PanelSpec/Bundle 0.16](all-components.md), Compiler 0.32.0 and native intent 0.12 support independent CheckBox, RadioGroup, List and Dialog generation, editing and state. Compiler 0.32.0 centers main titles by default; explicit alignment wins and saved 0.31.0 bundles replay unchanged. PanelSpec/Bundle 0.15 adds [static image rows](image-slots.md): fixed PNG
assets or labeled placeholders, without image generation or image-click actions.
Compiler 0.30.0 applies [card text alignment](card-alignment.md) in 0.21.0/0.21.1
themes: one image plus one standalone emit button aligns its title and placeholder
on the center line. Settings, form labels and descriptions retain their alignment.
Existing imported bundles retain their own catalog, assets and compiler.
The compiler retains [versioned section-heading presentation](section-headings.md):
new single-control panels omit the extra section-title band, while multiple
groups and Tabs keep their headings. The [recipe-aware geometry fix](section-geometry.md)
keeps the first hidden-title row at y=0 while meeting the pinned section recipe's
minimum height, including single Select, Switch and Progress groups. Existing
0.27.0, 0.28.0 and 0.29.0 catalogs/bundles retain their exact meaning. UGUI source
is version 0.1.7; use its matching runtime files and candidate ES/IIFE digests.
Explicit heading adoption preserves state/history and does not adopt card alignment
on an existing image bundle. Adoption consumes one of the original ten successful
edits; loading never migrates.
The optional planner fixes gpt-6-luna/xhigh, one invocation and zero retries.
Each call needs an absolute, explicitly owned `outputRoot`, an available logged-in
CLI and fresh task-specific compute authorization enforced by the calling host.
The SDK never grants authorization, persists a server task, or starts execution
merely because it was loaded. Its scoped output root permits a read-only install;
the development Studio keeps its existing confined output rule.

`delivery` contains `createPanelDelivery`, `createUnityKitFiles`, `createStoredZip`,
verified runtime bytes and the six UGUI adapter source files. Exporting is
deterministic and requires no Unity, model or browser process. Per-panel export
manifests remain technical byte checks; they do not certify browser rendering,
human visual approval, business integration or Unity native import.

No fonts are embedded: font family availability remains an environment contract.
Native Unity verification and real model acceptance must be reported separately.
This release candidate is not evidence that a consumer's service is deployed.

Build from existing local dependencies without installing or downloading:

```sh
node scripts/package-release.mjs --component-package <pinned-component.tgz> --output output/sdk-release
```

The builder verifies the Component archive before parsing it, follows only required
compiled modules, and bundles the browser using that same release plus Pixi 8.20.1.
It records file bytes, hashes, licenses, source commit and dirty state. A dirty
candidate is for local verification only and is not eligible for publication.
The builder never uploads, tags, publishes or calls a model.

Installed-artifact acceptance uses a fresh system temporary directory, ten explicit
fake CLI generation/edit transports, real compilation and ZIP re-reading. Browser acceptance opens
the actual exported ZIP offline and serves the ES module on loopback only:

```sh
node scripts/check-release.mjs --package output/sdk-release/ai-ui-panel-harness-0.1.0-rc.5.zip --output output/sdk-installed-check
node scripts/check-release-browser.mjs --acceptance output/sdk-installed-check --output output/sdk-browser-check
node scripts/check-all-components-browser.mjs --review output/sdk-installed-check/all-components --output output/sdk-components-browser-check
node scripts/check-heading-browser.mjs --acceptance output/sdk-installed-check --output output/sdk-heading-browser-check
```

These checks never exercise a consumer's remote service or real model. Failed
acceptance directories are retained; use a fresh output directory after a repair.
