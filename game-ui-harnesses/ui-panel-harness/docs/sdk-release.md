# Portable Panel SDK release candidate

This independently packaged SDK contains the Panel Node API, local workbench model,
optional single-invocation Codex adapter, pinned Component dependency closure,
12 owned core icons, planning prompts/schemas, offline Pixi browser runtime,
and Unity UGUI import-kit source. It does not start a service or invoke a model.

The release contract is `release/contract.json`. Install only an immutable tagged
release after checking its archive bytes and SHA-256 against the published receipt.
The rc.6 release contract uses the immutable tag `ui-panel-harness-v0.1.0-rc.6`. Check the published receipt and SHA256SUMS before installing. Previous tags and assets retain their original bytes. See [the short-input default policy](sdk-rc6.md).
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

The default seed uses modern-compact-message 0.1.0 and the complete verified builtin asset
pool. [PanelSpec/Bundle 0.16](all-components.md), native intent 0.12 and Compiler 0.34.0 retain all sixteen components and use concise-v4 headings. The shared short-input draft prompt is used directly by the installed planner. Standalone confirmation prose uses message.text 0.2.0 and Compiler 0.36.0: short prose and its action group are centered, long paragraphs retain their left edge, and height follows complete copy. Explicit requirements win. Main titles remain centered by default. Previously saved catalogs and compiler versions replay unchanged. PanelSpec/Bundle 0.15 adds [static image rows](image-slots.md): fixed PNG
assets or labeled placeholders, without image generation or image-click actions.
Compiler 0.30.0 applies [card text alignment](card-alignment.md) in 0.21.0/0.21.1
themes: one image plus one standalone emit button aligns its title and placeholder
on the center line. Settings, form labels and descriptions retain their alignment.
Existing imported bundles retain their own catalog, assets and compiler.
The compiler retains [versioned section-heading presentation](section-headings.md).
The new concise-v4 default removes redundant single-content and pure-action headings,
including a single content group in a tab; distinct content groups and explicitly requested
headings remain visible. Older catalogs retain their own heading policy. The [recipe-aware geometry fix](section-geometry.md)
keeps the first hidden-title row at y=0 while meeting the pinned section recipe's
minimum height, including single Select, Switch and Progress groups. Existing
0.27.0, 0.28.0 and 0.29.0 catalogs/bundles retain their exact meaning. UGUI source
is version 0.1.7; use its matching runtime files and candidate ES/IIFE digests.
Explicit heading adoption preserves state/history and does not adopt card alignment
on an existing image bundle. Adoption consumes one of the original ten successful
edits; loading never migrates.
The optional planner fixes gpt-6-luna/xhigh, one invocation and zero retries.
The daily prompt states the existing single-selection invariant for every Select,
RadioGroup and List: exactly one default option. Explicit defaults are preserved;
unsupported no-selection or multiple-selection requests require clarification.
Invalid defaults still fail validation without an automatic repair or retry.
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
node scripts/check-release.mjs --package output/sdk-release/ai-ui-panel-harness-0.1.0-rc.6.zip --output output/sdk-installed-check
node scripts/check-release-browser.mjs --acceptance output/sdk-installed-check --output output/sdk-browser-check
node scripts/check-all-components-browser.mjs --review output/sdk-installed-check/all-components --output output/sdk-components-browser-check
node scripts/check-heading-browser.mjs --acceptance output/sdk-installed-check --output output/sdk-heading-browser-check
```

These checks never exercise a consumer's remote service or real model. Failed
acceptance directories are retained; use a fresh output directory after a repair.
